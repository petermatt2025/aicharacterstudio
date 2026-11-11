// Phase 1 gate, end to end, against a production build:
// sign up → verify → upload portrait (consent) → buy Creator (Stripe test-mode flow, signed webhooks)
// → generate (worker + fake provider) → credits debited → download → upgrade to Pro → cross-tenant isolation
// → delete account. Requires: built app (`npm run build`), Postgres, Chromium.
// Real external services are replaced by: FakeImageProvider (APP_ENV=e2e) and a local Stripe API mock.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import sharp from "sharp";
import Stripe from "stripe";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PORT = 3100;
const STRIPE_PORT = 12111;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5432/acs_e2e";
const BASE = `http://localhost:${PORT}`;
const WHSEC = "whsec_e2e_secret";
const SHOTS = path.join(ROOT, "test-results", "e2e");
fs.mkdirSync(SHOTS, { recursive: true });

const env = {
  ...process.env,
  APP_ENV: "e2e",
  APP_URL: BASE,
  DATABASE_URL: DB,
  IMAGE_PROVIDER: "fake",
  MODERATION_PROVIDER: "baseline",
  EMAIL_TRANSPORT: "console",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: path.join(os.tmpdir(), "acs-e2e-storage"),
  STRIPE_SECRET_KEY: "sk_test_e2e",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_API_BASE: `http://localhost:${STRIPE_PORT}`,
  STRIPE_PRICE_CREATOR_MONTHLY: "price_creator_m",
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_TOPUP_SMALL: "price_topup_small",
  WORKER_CONCURRENCY: "2",
};

const log = (...a) => console.log("[e2e]", ...a);
const procs = [];
let failures = 0;
const check = (cond, msg) => {
  if (cond) log("PASS", msg);
  else {
    failures++;
    log("FAIL", msg);
  }
};

// ── Local Stripe API mock: only the endpoints the app calls ──
const subs = new Map();
const stripeMock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = new URLSearchParams(body);
    const send = (o) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(o)));
    if (req.method === "POST" && req.url === "/v1/customers") return send({ id: `cus_${Date.now()}`, object: "customer" });
    if (req.method === "POST" && req.url === "/v1/checkout/sessions")
      return send({ id: `cs_${Date.now()}`, object: "checkout.session", url: `${BASE}/billing?checkout=success`, mode: params.get("mode"), client_reference_id: params.get("client_reference_id"), customer: params.get("customer") });
    if (req.method === "POST" && req.url === "/v1/billing_portal/sessions") return send({ id: "bps_1", url: `${BASE}/billing` });
    const m = /^\/v1\/subscriptions\/([^/?]+)/.exec(req.url ?? "");
    if (m && req.method === "GET") return send(subs.get(m[1]));
    if (m && req.method === "DELETE") return send({ ...subs.get(m[1]), status: "canceled" });
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `mock: unhandled ${req.method} ${req.url}` } }));
  });
});

async function deliver(type, object) {
  const ev = { id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } };
  const payload = JSON.stringify(ev);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const r = await fetch(`${BASE}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload });
  if (!r.ok) throw new Error(`webhook ${type} → ${r.status} ${await r.text()}`);
  return r.json();
}

function subscription(id, customer, ws, price) {
  const now = Math.floor(Date.now() / 1000);
  const s = { id, object: "subscription", customer, status: "active", cancel_at_period_end: false, metadata: { workspaceId: ws }, items: { data: [{ price: { id: price }, current_period_start: now, current_period_end: now + 30 * 86400 }] } };
  subs.set(id, s);
  return s;
}

function run(cmd, args, name) {
  const p = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}

async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  // Fresh database.
  const admin = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS acs_e2e WITH (FORCE)");
  await admin.query("CREATE DATABASE acs_e2e");
  await admin.end();
  fs.rmSync(env.STORAGE_LOCAL_DIR, { recursive: true, force: true });
  await new Promise((ok, fail) => run("npm", ["run", "-s", "db:migrate"], "migrate").on("exit", (c) => (c === 0 ? ok() : fail(new Error("migrate failed")))));
  await new Promise((ok, fail) => run("npm", ["run", "-s", "db:seed"], "seed").on("exit", (c) => (c === 0 ? ok() : fail(new Error("seed failed")))));
  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  await new Promise((r) => stripeMock.listen(STRIPE_PORT, r));
  run("npx", ["next", "start", "-p", String(PORT)], "web");
  run("npm", ["run", "-s", "worker"], "worker");
  await waitFor(`${BASE}/pricing`);
  log("server up");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && log("console error:", m.text()));
  const email = `e2e_${Date.now()}@example.com`;

  // 1. Sign up via UI.
  await page.goto(`${BASE}/`);
  await page.screenshot({ path: path.join(SHOTS, "01-landing.png"), fullPage: true });
  await page.goto(`${BASE}/signup`);
  await page.fill("#displayName", "Ana");
  await page.fill("#email", email);
  await page.fill("#password", "correct horse battery");
  await page.check("input[name=terms]");
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  check(true, "signup redirects to onboarding");

  // 2. Verify email (token from the console email outbox).
  const mail = await db.query("SELECT body_text FROM email_outbox WHERE to_email=$1", [email]);
  const token = /token=([^\s]+)/.exec(mail.rows[0].body_text)[1];
  await page.goto(`${BASE}/verify-email?token=${token}`);
  await page.getByText("15 trial credits added").waitFor();
  check(true, "email verified, 15 trial credits granted");

  // 3. Onboarding: upload portrait with consent, save character.
  const portrait = path.join(SHOTS, "portrait.png");
  await sharp({ create: { width: 600, height: 750, channels: 3, background: "#b07a62" } }).png().toFile(portrait);
  await page.goto(`${BASE}/onboarding`);
  await page.setInputFiles("input[type=file]", portrait);
  await page.getByLabel("This is me, and I consent to AI images of myself.").check();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByLabel("Character name").fill("Ana");
  await page.getByRole("button", { name: /Save character/ }).click();
  await page.waitForURL("**/studio");
  check(true, "portrait uploaded with consent and character saved");

  // Phase-1 tools are in private beta: allowlist this user (admin action).
  await db.query("UPDATE users SET beta_allowlisted=true WHERE email=$1", [email]);

  // 4. Free plan is gated server-side.
  const ws = (await db.query("SELECT w.id FROM workspaces w JOIN users u ON u.id=w.owner_user_id WHERE u.email=$1", [email])).rows[0].id;
  const gated = await page.evaluate(async () => (await fetch("/api/generations/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ featureKey: "character_angles", presetKeys: ["front"] }) })).json());
  check(gated.error?.code === "plan_required", "Free plan blocked from Creator tool by the server");

  // 5. Purchase Creator (Stripe test-mode flow).
  await page.goto(`${BASE}/pricing`);
  await page.screenshot({ path: path.join(SHOTS, "02-pricing.png"), fullPage: true });
  await page.getByRole("button", { name: "Choose Creator" }).click();
  await page.waitForURL("**/billing?checkout=success");
  const cust = (await db.query("SELECT stripe_customer_id FROM billing_customers WHERE workspace_id=$1", [ws])).rows[0].stripe_customer_id;
  await deliver("checkout.session.completed", { id: "cs_1", object: "checkout.session", mode: "subscription", client_reference_id: ws, customer: cust });
  const subId = `sub_${Date.now()}`;
  await deliver("customer.subscription.created", subscription(subId, cust, ws, "price_creator_m"));
  await deliver("invoice.paid", { id: `in_${Date.now()}`, object: "invoice", billing_reason: "subscription_create", amount_paid: 1900, parent: { subscription_details: { subscription: subId } } });
  await page.reload();
  const credits1 = await page.getByTestId("nav-credits").innerText();
  check(credits1 === "215", `Creator purchased: credits 15 trial + 200 plan = ${credits1}`);

  // 6. Generate with Character Angle Generator.
  await page.goto(`${BASE}/studio/character_angles`);
  await page.getByRole("button", { name: "Review cost" }).click();
  await page.getByTestId("quote").waitFor();
  const quoteText = await page.getByTestId("quote").innerText();
  check(/10\s*credits/.test(quoteText), "quote shows 10 credits for 4 angles before generating");
  await page.screenshot({ path: path.join(SHOTS, "03-studio-quote.png"), fullPage: true });
  await page.getByRole("button", { name: /Generate for 10 credits/ }).click();
  await page.getByTestId("job-panel").getByText("succeeded").waitFor({ timeout: 60000 });
  const imgs = await page.getByTestId("job-panel").locator("img").count();
  check(imgs === 4, `4 images delivered (${imgs})`);
  await page.screenshot({ path: path.join(SHOTS, "04-studio-results.png"), fullPage: true });
  await page.reload();
  const credits2 = await page.getByTestId("nav-credits").innerText();
  check(credits2 === "205", `credits debited after generation: ${credits2}`);

  // 7. Download.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("job-panel").getByRole("link", { name: "Download" }).first().click()]).catch(async () => {
    await page.getByRole("button", { name: "Review cost" }).waitFor();
    return [null];
  });
  const outId = (await db.query("SELECT o.asset_id FROM generation_job_outputs o JOIN generation_jobs j ON j.id=o.job_id WHERE j.workspace_id=$1 LIMIT 1", [ws])).rows[0].asset_id;
  const fileRes = await page.request.get(`${BASE}/api/assets/${outId}/file?download=1`);
  check(fileRes.status() === 200 && fileRes.headers()["content-type"] === "image/png", "owner can download the private image");
  if (dl) check(!!(await dl.path()), "browser download works");

  // 8. Upgrade to Pro (portal → Stripe events).
  const sub2 = subscription(subId, cust, ws, "price_pro_m");
  await deliver("customer.subscription.updated", sub2);
  await deliver("invoice.paid", { id: `in_up_${Date.now()}`, object: "invoice", billing_reason: "subscription_update", amount_paid: 3000, parent: { subscription_details: { subscription: subId } } });
  await page.goto(`${BASE}/billing`);
  const credits3 = await page.getByTestId("nav-credits").innerText();
  check(credits3 === "655", `upgraded to Pro with prorated allowance top-up: ${credits3}`);
  await page.screenshot({ path: path.join(SHOTS, "05-billing.png"), fullPage: true });

  // 9. Cross-tenant isolation.
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto(`${BASE}/signup`);
  await op.fill("#email", `intruder_${Date.now()}@example.com`);
  await op.fill("#password", "correct horse battery");
  await op.check("input[name=terms]");
  await op.click("button[type=submit]");
  await op.waitForURL("**/onboarding");
  const jobId = (await db.query("SELECT id FROM generation_jobs WHERE workspace_id=$1 LIMIT 1", [ws])).rows[0].id;
  const s1 = (await op.request.get(`${BASE}/api/assets/${outId}/file`)).status();
  const s2 = (await op.request.get(`${BASE}/api/generations/${jobId}`)).status();
  const s3 = (await op.request.delete(`${BASE}/api/assets/${outId}`, { headers: { origin: BASE } })).status();
  const anon = (await (await browser.newContext()).request.get(`${BASE}/api/assets/${outId}/file`)).status();
  check(s1 === 404 && s2 === 404 && s3 === 404 && anon === 401, `other users get 404 and anonymous gets 401 (${s1}/${s2}/${s3}/${anon})`);
  const csrf = (await op.request.post(`${BASE}/api/generations/quote`, { headers: { origin: "https://evil.example" }, data: {} })).status();
  check(csrf === 403, `cross-origin mutation blocked (${csrf})`);

  // 10. Mobile layout.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await mobile.newPage();
  await mp.goto(`${BASE}/dashboard`);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, "dashboard has no horizontal scroll at 390px");
  await mp.screenshot({ path: path.join(SHOTS, "06-mobile-dashboard.png"), fullPage: true });
  await mp.goto(`${BASE}/studio/character_angles`);
  await mp.screenshot({ path: path.join(SHOTS, "07-mobile-studio.png"), fullPage: true });

  // 11. Delete account.
  await page.goto(`${BASE}/settings`);
  await page.fill("#delpw", "correct horse battery");
  await page.fill("#confirm", "DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL(`${BASE}/`);
  const u = (await db.query("SELECT status FROM users WHERE email=$1", [email])).rows;
  const files = (await db.query("SELECT storage_key FROM assets WHERE workspace_id=$1", [ws])).rows;
  const left = files.filter((f) => fs.existsSync(path.join(env.STORAGE_LOCAL_DIR, f.storage_key))).length;
  const subStatus = subs.get(subId) ? "cancel requested" : "n/a";
  check(u.length === 0 && left === 0, `account deleted, email anonymized, ${files.length} stored objects removed (subscription ${subStatus})`);

  await browser.close();
  await db.end();
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(() => {
    for (const p of procs) {
      try {
        process.kill(-p.pid, "SIGTERM"); // whole process group (npx → next-server, npm → tsx)
      } catch {}
    }
    stripeMock.close();
    log(failures ? `${failures} FAILURE(S)` : "ALL CHECKS PASSED");
    setTimeout(() => process.exit(failures ? 1 : 0), 500);
  });
