import "server-only";
import { one, q } from "./db";
import { env } from "./env";
import { storage } from "./storage";
import { availableEngines } from "./providers";
import { billingConfigured, stripe } from "./billing";
import { getSetting } from "./seed";

export type Check = { name: string; ok: boolean | null; detail: string };

async function timed<T>(fn: () => Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

const ago = (d: Date) => Math.round((Date.now() - new Date(d).getTime()) / 60_000);

/** Live checks for the admin status page. Each check is independent and never throws. */
export async function systemStatus() {
  const checks: Check[] = [];
  const add = async (name: string, fn: () => Promise<{ ok: boolean | null; detail: string }>) => {
    try {
      checks.push({ name, ...(await timed(fn)) });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message.slice(0, 200) });
    }
  };
  const e = env();

  await add("Database", async () => {
    const t0 = Date.now();
    await one(`SELECT 1`);
    return { ok: true, detail: `responding in ${Date.now() - t0} ms` };
  });

  await add("Worker", async () => {
    const w = await q<{ worker_id: string; last_seen: Date; info: { engines?: string[]; version?: string | null } }>(
      `SELECT worker_id, last_seen, info FROM worker_heartbeats ORDER BY last_seen DESC LIMIT 3`,
    );
    const live = w.filter((x) => ago(x.last_seen) < 3);
    if (!w.length) return { ok: false, detail: "no worker has ever checked in (is the worker service running?)" };
    if (!live.length) return { ok: false, detail: `last seen ${ago(w[0]!.last_seen)} min ago` };
    const info = live[0]!.info;
    return { ok: true, detail: `${live.length} running · engines: ${info.engines?.join(", ") || "none"}${info.version ? ` · build ${info.version}` : ""}` };
  });

  await add("Queue", async () => {
    const r = await one<{ queued: number; running: number; waiting: number }>(
      `SELECT count(*) FILTER (WHERE status='queued')::int AS queued, count(*) FILTER (WHERE status='running')::int AS running,
              count(*) FILTER (WHERE status='queued' AND run_after < now() - interval '10 minutes')::int AS waiting FROM generation_jobs`,
    );
    return { ok: r!.waiting === 0, detail: `${r!.queued} queued · ${r!.running} running${r!.waiting ? ` · ${r!.waiting} waiting more than 10 min` : ""}` };
  });

  for (const engine of ["openai", "gemini"] as const) {
    await add(`Engine: ${engine === "openai" ? "OpenAI" : "Gemini"}`, async () => {
      if (!availableEngines().includes(engine)) return { ok: null, detail: "not configured on the web service (no API key)" };
      const r = await one<{ good: number; bad: number; last_ok: Date | null; last_err: string | null }>(
        `SELECT count(*) FILTER (WHERE success)::int AS good, count(*) FILTER (WHERE NOT success)::int AS bad,
                max(created_at) FILTER (WHERE success) AS last_ok,
                (SELECT error_code FROM usage_events WHERE provider=$1 AND NOT success ORDER BY created_at DESC LIMIT 1) AS last_err
           FROM usage_events WHERE provider=$1 AND created_at > now() - interval '24 hours'`,
        [engine],
      );
      const failing = r!.good + r!.bad > 0 && r!.bad > r!.good;
      const lastOk = r!.last_ok ? ` · last success ${ago(r!.last_ok)} min ago` : "";
      const lastErr = r!.bad && r!.last_err ? ` (last error: ${r!.last_err})` : "";
      return { ok: !failing, detail: `24h: ${r!.good} ok, ${r!.bad} failed${lastErr}${lastOk}` };
    });
  }

  await add("Storage", async () => {
    const key = `healthcheck/${Date.now()}.txt`;
    await storage().put(key, Buffer.from("ok"), "text/plain");
    const back = await storage().get(key);
    await storage().delete(key);
    return { ok: back.toString() === "ok", detail: `${e.STORAGE_DRIVER} storage: write, read and delete work` };
  });

  await add("Payments (Stripe)", async () => {
    if (!billingConfigured()) return { ok: false, detail: "STRIPE_SECRET_KEY missing" };
    const bal = await stripe().balance.retrieve();
    const missing = await one<{ n: number }>(`SELECT count(*)::int AS n FROM plan_catalog WHERE monthly_price_cents > 0 AND stripe_price_monthly IS NULL`);
    const webhook = e.STRIPE_WEBHOOK_SECRET ? "webhook secret set" : "WEBHOOK SECRET MISSING";
    const prices = missing!.n ? ` · ${missing!.n} plan(s) without a price (Admin → Set up Stripe prices)` : "";
    return { ok: !!e.STRIPE_WEBHOOK_SECRET && missing!.n === 0, detail: `${bal.livemode ? "LIVE" : "test"} mode · ${webhook}${prices}` };
  });

  await add("Email", async () => {
    if (e.EMAIL_TRANSPORT === "console") return { ok: null, detail: "console only (development): emails are not sent" };
    return { ok: !!e.RESEND_API_KEY, detail: `Resend · from ${e.EMAIL_FROM}` };
  });

  await add("AI spend (24h)", async () => {
    const cap = Number(await getSetting<number>("global_daily_cost_cap_usd"));
    const r = await one<{ usd: string }>(`SELECT COALESCE(sum(cost_usd),0) AS usd FROM usage_events WHERE created_at > now() - interval '24 hours'`);
    const used = Number(r!.usd);
    const note = used >= cap ? " · NEW GENERATIONS PAUSED" : used >= cap * 0.8 ? " · close to the cap" : "";
    return { ok: used < cap * 0.8, detail: `USD ${used.toFixed(2)} of USD ${cap.toFixed(0)} daily cap${note}` };
  });

  const alerts = await q<{ kind: string; subject: string; body: string; emailed: boolean; created_at: Date }>(
    `SELECT kind, subject, body, emailed, created_at FROM alert_log ORDER BY created_at DESC LIMIT 20`,
  );
  return { checks, alerts, appUrl: e.APP_URL, appEnv: e.APP_ENV };
}
