import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createSubscriptionCheckout, createTopupCheckout, handleStripeEvent, setStripeForTests, verifyWebhook, allocateAnnualCredits, type StripeLike } from "@/server/billing";
import { one, q } from "@/server/db";
import { checkInvariants } from "@/server/credits";
import { makeUser, refresh, uid } from "./helpers";

// ── Fake Stripe API (only the calls we make) ──
const subs = new Map<string, Stripe.Subscription>();
const sessions: Array<Record<string, unknown>> = [];
const invoiceByPi = new Map<string, string>();
const fakeStripe = {
  customers: { create: async (p: { metadata: { workspaceId: string } }) => ({ id: `cus_${p.metadata.workspaceId.slice(0, 8)}${uid()}` }) },
  checkout: { sessions: { create: async (p: Record<string, unknown>) => (sessions.push(p), { id: `cs_${uid()}`, url: "https://checkout.stripe.test/session" }) } },
  billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.test/portal" }) } },
  invoicePayments: {
    list: async (p: { payment: { payment_intent: string } }) => ({ data: invoiceByPi.has(p.payment.payment_intent) ? [{ invoice: invoiceByPi.get(p.payment.payment_intent) }] : [] }),
  },
  subscriptions: {
    retrieve: async (id: string) => subs.get(id)!,
    cancel: async (id: string) => ({ ...subs.get(id)!, status: "canceled" }),
  },
} as unknown as StripeLike;

const PRICES = { creatorM: "price_creatorM", proM: "price_proM", proY: "price_proY" };

beforeAll(async () => {
  setStripeForTests(fakeStripe);
  await q(`UPDATE plan_catalog SET stripe_price_monthly=$1 WHERE key='creator'`, [PRICES.creatorM]);
  await q(`UPDATE plan_catalog SET stripe_price_monthly=$1, stripe_price_annual=$2 WHERE key='pro'`, [PRICES.proM, PRICES.proY]);
  await q(`UPDATE topup_packs SET stripe_price_id='price_topup_small' WHERE key='small'`);
});
afterAll(() => setStripeForTests(null));

let clock = Math.floor(Date.now() / 1000);
function event<T>(type: string, object: T, opts: { id?: string; livemode?: boolean; created?: number } = {}): { event: Stripe.Event; raw: string } {
  const ev = { id: opts.id ?? `evt_${uid()}`, object: "event", type, livemode: opts.livemode ?? false, created: opts.created ?? ++clock, data: { object }, api_version: "2026-10-28.endive" };
  return { event: ev as unknown as Stripe.Event, raw: JSON.stringify(ev) };
}
async function deliver(type: string, object: unknown, opts?: Parameters<typeof event>[2]) {
  const { raw } = event(type, object, opts);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: "whsec_test_secret" });
  return handleStripeEvent(verifyWebhook(raw, sig), raw);
}

function subscription(id: string, customer: string, ws: string, price: string, status = "active", periodStart = Math.floor(Date.now() / 1000), months = 1) {
  const end = new Date(periodStart * 1000);
  end.setUTCMonth(end.getUTCMonth() + months);
  const s = {
    id, object: "subscription", customer, status, cancel_at_period_end: false, metadata: { workspaceId: ws },
    items: { data: [{ price: { id: price }, current_period_start: periodStart, current_period_end: Math.floor(end.getTime() / 1000) }] },
  } as unknown as Stripe.Subscription;
  subs.set(id, s);
  return s;
}
const invoice = (subId: string, reason = "subscription_create") =>
  ({ id: `in_${uid()}`, object: "invoice", billing_reason: reason, amount_paid: 1900, parent: { subscription_details: { subscription: subId } } }) as unknown as Stripe.Invoice;

async function subscribedUser(price = PRICES.creatorM) {
  const u = await makeUser({ plan: "free", verified: true });
  const customer = `cus_${uid()}`;
  await deliver("checkout.session.completed", { id: `cs_${uid()}`, object: "checkout.session", mode: "subscription", client_reference_id: u.workspaceId, customer });
  const subId = `sub_${uid()}`;
  await deliver("customer.subscription.created", subscription(subId, customer, u.workspaceId, price));
  return { u, customer, subId };
}

describe("Stripe webhooks", () => {
  it("rejects bad signatures", () => {
    const { raw } = event("invoice.paid", {});
    expect(() => verifyWebhook(raw, "t=1,v1=deadbeef")).toThrow(/signature/i);
    const forged = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: "whsec_wrong" });
    expect(() => verifyWebhook(raw, forged)).toThrow(/signature/i);
    expect(() => verifyWebhook(raw, null)).toThrow();
  });

  it("checkout.session.completed alone grants nothing; subscription sets plan; invoice.paid grants once", async () => {
    const { u, subId } = await subscribedUser();
    expect((await refresh(u)).planKey).toBe("creator");
    const before = (await checkInvariants(u.workspaceId))!.balance;
    expect(before).toBe(15); // trial only so far
    const inv = invoice(subId);
    const evId = `evt_${uid()}`;
    expect(await deliver("invoice.paid", inv, { id: evId })).toBe("processed");
    expect(await deliver("invoice.paid", inv, { id: evId })).toBe("duplicate"); // same event redelivered
    await deliver("invoice.paid", inv); // same invoice, different event id
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(before + 200);
  });

  it("renewal expires the previous period's included credits (no rollover)", async () => {
    const { u, subId } = await subscribedUser();
    await deliver("invoice.paid", invoice(subId));
    await deliver("invoice.paid", invoice(subId, "subscription_cycle"));
    const g = await q<{ source: string; remaining: number }>(`SELECT source, remaining FROM credit_grants WHERE workspace_id=$1 AND source='subscription' ORDER BY created_at`, [u.workspaceId]);
    expect(g.map((x) => x.remaining)).toEqual([0, 200]);
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(215);
  });

  it("upgrade proration invoice tops up to the new plan's allowance", async () => {
    const { u, customer, subId } = await subscribedUser();
    await deliver("invoice.paid", invoice(subId));
    subscription(subId, customer, u.workspaceId, PRICES.proM);
    await deliver("customer.subscription.updated", subs.get(subId));
    expect((await refresh(u)).planKey).toBe("pro");
    await deliver("invoice.paid", invoice(subId, "subscription_update"));
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(15 + 650); // 200 + 450 difference
  });

  it("upgrade top-up is correct even when Stripe resets the billing anchor", async () => {
    const { u, customer, subId } = await subscribedUser();
    await deliver("invoice.paid", invoice(subId));
    subscription(subId, customer, u.workspaceId, PRICES.proM, "active", Math.floor(Date.now() / 1000) + 5);
    await deliver("customer.subscription.updated", subs.get(subId));
    await deliver("invoice.paid", invoice(subId, "subscription_update"));
    await deliver("invoice.paid", invoice(subId, "subscription_update")); // a second proration invoice adds nothing
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(15 + 650);
  });

  it("ignores stale out-of-order subscription events", async () => {
    const { u, customer, subId } = await subscribedUser();
    const canceled = subscription(subId, customer, u.workspaceId, PRICES.creatorM, "canceled");
    await deliver("customer.subscription.deleted", canceled, { created: clock + 100 });
    expect((await refresh(u)).planKey).toBe("free");
    const stale = subscription(subId, customer, u.workspaceId, PRICES.creatorM, "active");
    await deliver("customer.subscription.updated", stale, { created: clock - 50 });
    expect((await refresh(u)).planKey).toBe("free");
  });

  it("payment failure keeps access during Stripe retries (past_due), cancellation downgrades", async () => {
    const { u, customer, subId } = await subscribedUser();
    await deliver("invoice.payment_failed", invoice(subId));
    expect((await one<{ status: string }>(`SELECT status FROM subscriptions WHERE stripe_subscription_id=$1`, [subId]))!.status).toBe("past_due");
    await deliver("customer.subscription.updated", subscription(subId, customer, u.workspaceId, PRICES.creatorM, "past_due"));
    expect((await refresh(u)).planKey).toBe("creator");
    await deliver("customer.subscription.updated", subscription(subId, customer, u.workspaceId, PRICES.creatorM, "unpaid"));
    expect((await refresh(u)).planKey).toBe("free");
  });

  it("top-up: granted on payment_intent.succeeded with verified amount; refunds and disputes revoke unspent credits", async () => {
    const { u, customer } = await subscribedUser();
    const pi = (amount: number) => ({ id: `pi_${uid()}`, object: "payment_intent", amount_received: amount, currency: "usd", customer, metadata: { kind: "topup", workspaceId: u.workspaceId, packKey: "small", credits: "100" } });
    const base = (await checkInvariants(u.workspaceId))!.balance;
    await expect(deliver("payment_intent.succeeded", pi(100))).rejects.toThrow(/amount mismatch/);
    const good = pi(1200);
    await deliver("payment_intent.succeeded", good);
    await deliver("payment_intent.succeeded", good); // duplicate business event
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base + 100);
    await deliver("charge.refunded", { id: `ch_${uid()}`, object: "charge", payment_intent: good.id, amount: 1200, amount_refunded: 600 });
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base + 50);
    await deliver("charge.dispute.created", { id: `dp_${uid()}`, object: "dispute", payment_intent: good.id });
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base);
    const inv = await checkInvariants(u.workspaceId);
    expect(inv!.ledger_sum).toBe(inv!.balance);
  });

  it("refunding a subscription payment takes back the matching share of unspent plan credits; a dispute takes the rest", async () => {
    const { u, subId } = await subscribedUser();
    const base = (await checkInvariants(u.workspaceId))!.balance;
    const inv = invoice(subId);
    await deliver("invoice.paid", inv);
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base + 200);
    const pi = `pi_${uid()}`;
    invoiceByPi.set(pi, inv.id!);
    await deliver("charge.refunded", { id: `ch_${uid()}`, object: "charge", payment_intent: pi, amount: 1900, amount_refunded: 950 });
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base + 100);
    // Same refund event content again (cumulative amount unchanged) revokes nothing more.
    await deliver("charge.refunded", { id: `ch_${uid()}`, object: "charge", payment_intent: pi, amount: 1900, amount_refunded: 950 });
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base + 100);
    await deliver("charge.dispute.created", { id: `dp_${uid()}`, object: "dispute", payment_intent: pi });
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(base);
    const unknown = `pi_${uid()}`;
    expect(await deliver("charge.refunded", { id: `ch_${uid()}`, object: "charge", payment_intent: unknown, amount: 1900, amount_refunded: 1900 })).toBe("ignored");
    const final = await checkInvariants(u.workspaceId);
    expect(final!.ledger_sum).toBe(final!.balance);
  });

  it("top-up for another workspace's customer is rejected", async () => {
    const a = await subscribedUser();
    const b = await subscribedUser();
    const forged = { id: `pi_${uid()}`, object: "payment_intent", amount_received: 1200, currency: "usd", customer: a.customer, metadata: { kind: "topup", workspaceId: b.u.workspaceId, packKey: "small" } };
    await expect(deliver("payment_intent.succeeded", forged)).rejects.toThrow(/does not match/);
  });

  it("live-mode events are ignored until the owner enables live billing", async () => {
    const { u, subId } = await subscribedUser();
    const before = (await checkInvariants(u.workspaceId))!.balance;
    expect(await deliver("invoice.paid", invoice(subId), { livemode: true })).toBe("ignored");
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(before);
  });

  it("annual plans receive monthly allocations, not 12 months at once", async () => {
    const u = await makeUser({ plan: "free" });
    const customer = `cus_${uid()}`;
    await deliver("checkout.session.completed", { id: `cs_${uid()}`, object: "checkout.session", client_reference_id: u.workspaceId, customer });
    const subId = `sub_${uid()}`;
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3);
    threeMonthsAgo.setUTCDate(threeMonthsAgo.getUTCDate() - 1);
    await deliver("customer.subscription.created", subscription(subId, customer, u.workspaceId, PRICES.proY, "active", Math.floor(threeMonthsAgo.getTime() / 1000), 12));
    await q(`UPDATE subscriptions SET created_at=$2 WHERE stripe_subscription_id=$1`, [subId, threeMonthsAgo]);
    await deliver("invoice.paid", invoice(subId));
    await allocateAnnualCredits();
    await allocateAnnualCredits(); // idempotent
    const grants = await q<{ remaining: number; amount: number }>(`SELECT amount, remaining FROM credit_grants WHERE workspace_id=$1 AND source='annual_allocation' ORDER BY created_at`, [u.workspaceId]);
    expect(grants.map((g) => g.amount)).toEqual([650, 650, 650, 650]); // m0..m3
    expect(grants.filter((g) => g.remaining > 0)).toHaveLength(1); // only the current month is spendable
  });

  it("checkout sessions are created server-side with metadata and blocked when already subscribed", async () => {
    const u = await makeUser({ plan: "free" });
    const r = await createSubscriptionCheckout(u, { planKey: "creator", interval: "month" });
    expect(r.url).toContain("stripe.test");
    expect(sessions.at(-1)).toMatchObject({ mode: "subscription", client_reference_id: u.workspaceId, line_items: [{ price: PRICES.creatorM, quantity: 1 }] });
    await expect(createTopupCheckout(u, { packKey: "small" })).rejects.toMatchObject({ code: "plan_required" });
    const { u: subbed } = await subscribedUser();
    await expect(createSubscriptionCheckout(await refresh(subbed), { planKey: "pro", interval: "month" })).rejects.toMatchObject({ code: "conflict" });
    const t = await createTopupCheckout(await refresh(subbed), { packKey: "small" });
    expect(t.url).toBeTruthy();
    expect(sessions.at(-1)).toMatchObject({ mode: "payment", payment_intent_data: { metadata: { kind: "topup", packKey: "small" } } });
  });

  it("refuses live secret keys unless explicitly allowed", async () => {
    setStripeForTests(null);
    const prev = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    const { resetEnvCache } = await import("@/server/env");
    resetEnvCache();
    try {
      const { stripe } = await import("@/server/billing");
      expect(() => stripe()).toThrow(/Live Stripe keys are blocked/);
    } finally {
      process.env.STRIPE_SECRET_KEY = prev;
      resetEnvCache();
      setStripeForTests(fakeStripe);
    }
  });
});
