// Verifies the billing integration against the REAL Stripe test-mode API (refuses live keys).
// Stripe Checkout's hosted page needs a browser on checkout.stripe.com, so the subscription is created via the API
// for the customer the app created; the resulting REAL Stripe events are then pulled from /v1/events, signed with the
// local webhook secret and fed through the app's webhook verification + handler, exactly as `stripe listen` would.
// Usage: set -a; . ./.env.local; set +a; npm run -s stripe:check
import Stripe from "stripe";
import { signup, verifyEmail, userFromSessionToken, createSession } from "../src/server/accounts";
import { createSubscriptionCheckout, createTopupCheckout, handleStripeEvent, verifyWebhook } from "../src/server/billing";
import { checkInvariants } from "../src/server/credits";
import { closePool, one } from "../src/server/db";
import { env } from "../src/server/env";

const s = new Stripe(env().STRIPE_SECRET_KEY!, { httpClient: Stripe.createFetchHttpClient() });
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seen = new Set<string>();

/** Pull this customer's real events and deliver them (oldest first) through signature verification + handler. */
async function sync(customer: string, since: number, expectTypes: string[] = []) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(2500);
    const evs = (await s.events.list({ created: { gte: since }, limit: 100 })).data
      .filter((e) => (e.data.object as { customer?: string | { id: string } }).customer === customer || ((e.data.object as { customer?: { id: string } }).customer as { id?: string } | undefined)?.id === customer)
      .sort((a, b) => a.created - b.created);
    const fresh = evs.filter((e) => !seen.has(e.id));
    const types = new Set<string>(evs.map((e) => e.type));
    if (!expectTypes.every((t) => types.has(t))) continue;
    for (const e of fresh) {
      seen.add(e.id);
      const raw = JSON.stringify(e);
      const sig = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: env().STRIPE_WEBHOOK_SECRET! });
      const r = await handleStripeEvent(verifyWebhook(raw, sig), raw);
      console.log(`   event ${e.type.padEnd(34)} → ${r}`);
    }
    return evs;
  }
  throw new Error(`Timed out waiting for events: ${expectTypes.join(", ")}`);
}

async function main() {
  const bal = await s.balance.retrieve();
  if (bal.livemode) throw new Error("Refusing to run with a LIVE Stripe key");
  check(true, "Stripe key is test mode");
  const start = Math.floor(Date.now() / 1000) - 5;

  const email = `stripe-check+${Date.now()}@example.com`;
  const { id } = await signup({ email, password: "correct horse battery", acceptTerms: true });
  const mail = await one<{ body_text: string }>(`SELECT body_text FROM email_outbox WHERE to_email=$1`, [email]);
  await verifyEmail(decodeURIComponent(/token=([^\s]+)/.exec(mail!.body_text)![1]!));
  const { token } = await createSession(id);
  let user = (await userFromSessionToken(token))!;

  // 1. Real Checkout Session (what the "Choose Creator" button does).
  const co = await createSubscriptionCheckout(user, { planKey: "creator", interval: "month" });
  check(!!co.url?.startsWith("https://checkout.stripe.com/"), `real Checkout Session created (${co.url?.slice(0, 40)}…)`);
  const customer = (await one<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM billing_customers WHERE workspace_id=$1`, [user.workspaceId]))!.stripe_customer_id;

  // 2. Complete the purchase the way Checkout would (test card), then process Stripe's real events.
  const pm = await s.paymentMethods.attach("pm_card_visa", { customer });
  await s.customers.update(customer, { invoice_settings: { default_payment_method: pm.id } });
  const creator = (await one<{ p: string }>(`SELECT stripe_price_monthly AS p FROM plan_catalog WHERE key='creator'`))!.p;
  const pro = (await one<{ p: string }>(`SELECT stripe_price_monthly AS p FROM plan_catalog WHERE key='pro'`))!.p;
  const sub = await s.subscriptions.create({ customer, items: [{ price: creator }], metadata: { workspaceId: user.workspaceId, planKey: "creator" } });
  await sync(customer, start, ["customer.subscription.created", "invoice.paid"]);
  user = (await userFromSessionToken(token))!;
  let w = await checkInvariants(user.workspaceId);
  check(user.planKey === "creator", `plan is now creator (${user.planKey})`);
  check(w!.balance === 215, `credits after Creator purchase = 15 trial + 200 (${w!.balance})`);

  // 3. Upgrade to Pro with proration (what the Billing Portal does).
  await s.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0]!.id, price: pro }], proration_behavior: "always_invoice", metadata: { workspaceId: user.workspaceId, planKey: "pro" } });
  await sync(customer, start, ["customer.subscription.updated", "invoice.paid"]);
  await sleep(2000);
  await sync(customer, start);
  user = (await userFromSessionToken(token))!;
  w = await checkInvariants(user.workspaceId);
  check(user.planKey === "pro", `plan upgraded to pro (${user.planKey})`);
  check(w!.balance === 665, `credits after upgrade = 15 + 650 allowance (${w!.balance})`);

  // 4. Top-up: real Checkout Session, then the payment as Checkout would create it.
  const tu = await createTopupCheckout(user, { packKey: "small" });
  check(!!tu.url?.startsWith("https://checkout.stripe.com/"), "real top-up Checkout Session created");
  const pi = await s.paymentIntents.create({
    amount: 1200, currency: "usd", customer, payment_method: pm.id, confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { kind: "topup", workspaceId: user.workspaceId, packKey: "small", credits: "100" },
  });
  await sync(customer, start, ["payment_intent.succeeded"]);
  w = await checkInvariants(user.workspaceId);
  check(w!.balance === 765, `top-up added 100 credits (${w!.balance})`);

  // 5. Partial refund revokes the matching share of unspent top-up credits.
  await s.refunds.create({ payment_intent: pi.id, amount: 600 });
  await sync(customer, start, ["charge.refunded"]);
  w = await checkInvariants(user.workspaceId);
  check(w!.balance === 715, `half refund revoked 50 credits (${w!.balance})`);

  // 6. Replaying every real event changes nothing (idempotency).
  const before = w!.balance;
  const all = (await s.events.list({ created: { gte: start }, limit: 100 })).data.filter((e) => seen.has(e.id));
  for (const e of all) await handleStripeEvent(e, JSON.stringify(e));
  check((await checkInvariants(user.workspaceId))!.balance === before, `replaying ${all.length} events is a no-op`);

  // 7. Cancel → back to Free (credits already paid for remain until their period ends).
  await s.subscriptions.cancel(sub.id);
  await sync(customer, start, ["customer.subscription.deleted"]);
  user = (await userFromSessionToken(token))!;
  check(user.planKey === "free", `subscription canceled → plan free (${user.planKey})`);
  w = await checkInvariants(user.workspaceId);
  check(w!.ledger_sum === w!.balance && w!.balance >= 0, `ledger consistent, balance never negative (${w!.balance})`);

  // Clean up the test customer in Stripe.
  await s.customers.del(customer);
}

main()
  .catch((e) => {
    failures++;
    console.error("ERROR", e?.message ?? e);
  })
  .finally(async () => {
    await closePool();
    console.log(failures ? `${failures} FAILURE(S)` : "ALL STRIPE TEST-MODE CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  });
