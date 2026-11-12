import "server-only";
import Stripe from "stripe";
import type pg from "pg";
import { z } from "zod";
import type { SessionUser } from "./accounts";
import { one, q, tx } from "./db";
import { env } from "./env";
import { AppError } from "./errors";
import { sha256 } from "./crypto";
import { expireSubscriptionGrantsBefore, grantCredits, revokeGrantCredits } from "./credits";
import { getPlan, type PlanRow } from "./entitlements";
import { audit, log, track } from "./audit";
import { raiseAlert } from "./alerts";

/** Minimal surface we use, so tests can inject a fake. */
export type StripeLike = Pick<Stripe, "customers" | "checkout" | "billingPortal" | "subscriptions" | "invoicePayments" | "prices" | "products" | "balance">;

let override: StripeLike | null = null;
let client: Stripe | null = null;

export function setStripeForTests(s: StripeLike | null) {
  override = s;
}

export function billingConfigured() {
  return !!env().STRIPE_SECRET_KEY;
}

/** Test mode only unless the owner explicitly enables live mode. */
export function stripe(): StripeLike {
  if (override) return override;
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new AppError("billing_not_configured", "Billing is not configured yet.");
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    if (!env().STRIPE_ALLOW_LIVE_MODE) throw new AppError("billing_live_mode_blocked", "Live Stripe keys are blocked until the owner approves real payments.");
  }
  const base = env().STRIPE_API_BASE ? new URL(env().STRIPE_API_BASE!) : null;
  client ??= new Stripe(key, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "ai-character-studio" },
    httpClient: Stripe.createFetchHttpClient(), // uses global fetch (proxy-aware with NODE_USE_ENV_PROXY=1)
    ...(base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
  });
  return client;
}

/**
 * Runs a Stripe call made on behalf of a user. Stripe errors become a clear 503: admins see Stripe's own message
 * (e.g. "No such price") so they can fix the configuration; customers see a generic message. The owner is alerted.
 */
async function stripeCall<T>(user: SessionUser, what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof Stripe.errors.StripeError)) throw e; // only Stripe's own errors are reported as Stripe errors
    const msg = e.message.slice(0, 300);
    log("error", "stripe.call_failed", { what, error: msg });
    void raiseAlert(`stripe_call:${what}`, `Stripe ${what} failed`, `Stripe returned an error during ${what}: ${msg}\n\nIf it says "No such price", open Admin and click "Set up Stripe prices". If it says "Invalid API Key", fix STRIPE_SECRET_KEY on Railway.`);
    throw new AppError("billing_unavailable", user.isAdmin ? `Stripe error (${what}): ${msg}` : "Payments are temporarily unavailable. Please try again later.");
  }
}

async function getOrCreateCustomer(user: SessionUser): Promise<string> {
  const existing = await one<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM billing_customers WHERE workspace_id=$1`, [user.workspaceId]);
  if (existing) return existing.stripe_customer_id;
  const c = await stripeCall(user, "customer creation", () => stripe().customers.create({ email: user.email, metadata: { workspaceId: user.workspaceId } }, { idempotencyKey: `customer:${user.workspaceId}` }));
  await q(`INSERT INTO billing_customers (workspace_id, stripe_customer_id) VALUES ($1,$2) ON CONFLICT (workspace_id) DO NOTHING`, [user.workspaceId, c.id]);
  return (await one<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM billing_customers WHERE workspace_id=$1`, [user.workspaceId]))!.stripe_customer_id;
}

async function activeSubscription(workspaceId: string) {
  return one<{ stripe_subscription_id: string; plan_key: string; status: string; billing_interval: string; current_period_end: Date | null; cancel_at_period_end: boolean }>(
    `SELECT stripe_subscription_id, plan_key, status, billing_interval, current_period_end, cancel_at_period_end FROM subscriptions
      WHERE workspace_id=$1 AND status IN ('active','trialing','past_due','incomplete') ORDER BY updated_at DESC LIMIT 1`,
    [workspaceId],
  );
}

export const checkoutSchema = z.object({ planKey: z.enum(["creator", "pro", "agency"]), interval: z.enum(["month", "year"]) });

export async function createSubscriptionCheckout(user: SessionUser, input: z.input<typeof checkoutSchema>, baseUrl = env().APP_URL) {
  const { planKey, interval } = checkoutSchema.parse(input);
  if (!user.emailVerified) throw new AppError("email_not_verified", "Verify your email before subscribing.");
  if (await activeSubscription(user.workspaceId)) throw new AppError("conflict", "You already have a subscription. Use Manage billing to change plans.");
  const plan = await getPlan(planKey);
  const price = interval === "month" ? plan.stripe_price_monthly : plan.stripe_price_annual;
  if (!price) throw new AppError("billing_not_configured", "This plan isn't purchasable yet (missing Stripe price).");
  const customer = await getOrCreateCustomer(user);
  const s = await stripeCall(user, "checkout", () => stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.workspaceId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { workspaceId: user.workspaceId, planKey } },
    metadata: { workspaceId: user.workspaceId, kind: "subscription", planKey },
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/pricing?checkout=canceled`,
    automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
    customer_update: process.env.STRIPE_AUTOMATIC_TAX === "true" ? { address: "auto" } : undefined,
  }));
  await track(user.id, "checkout_started", { planKey, interval });
  return { url: s.url };
}

export const topupSchema = z.object({ packKey: z.string().max(40) });

export async function createTopupCheckout(user: SessionUser, input: z.input<typeof topupSchema>, baseUrl = env().APP_URL) {
  const { packKey } = topupSchema.parse(input);
  const plan = await getPlan(user.planKey);
  if (!plan.allows_topups) throw new AppError("plan_required", "Top-ups are available on paid plans.");
  const pack = await one<{ key: string; credits: number; stripe_price_id: string | null; active: boolean }>(`SELECT * FROM topup_packs WHERE key=$1`, [packKey]);
  if (!pack || !pack.active) throw new AppError("not_found", "Unknown credit pack");
  if (!pack.stripe_price_id) throw new AppError("billing_not_configured", "This pack isn't purchasable yet (missing Stripe price).");
  const customer = await getOrCreateCustomer(user);
  const meta = { kind: "topup", workspaceId: user.workspaceId, packKey: pack.key, credits: String(pack.credits) };
  const s = await stripeCall(user, "top-up checkout", () => stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: user.workspaceId,
    line_items: [{ price: pack.stripe_price_id!, quantity: 1 }],
    payment_intent_data: { metadata: meta },
    metadata: meta,
    invoice_creation: { enabled: true },
    success_url: `${baseUrl}/billing?topup=success`,
    cancel_url: `${baseUrl}/billing?topup=canceled`,
    automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
  }));
  return { url: s.url };
}

export async function createPortalSession(user: SessionUser, baseUrl = env().APP_URL) {
  const existing = await one<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM billing_customers WHERE workspace_id=$1`, [user.workspaceId]);
  if (!existing) throw new AppError("not_found", "No billing account yet.");
  const s = await stripeCall(user, "billing portal", () => stripe().billingPortal.sessions.create({ customer: existing.stripe_customer_id, return_url: `${baseUrl}/billing` }));
  return { url: s.url };
}

// ───────────────────────── Webhooks ─────────────────────────

export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new AppError("billing_not_configured", "Webhook secret not configured");
  if (!signature) throw new AppError("validation_failed", "Missing signature");
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret, 300);
  } catch {
    throw new AppError("validation_failed", "Invalid webhook signature");
  }
}

/** Idempotent processing: each Stripe event id is processed at most once successfully; failures are retried by Stripe. */
export async function handleStripeEvent(event: Stripe.Event, rawBody: string): Promise<"processed" | "ignored" | "duplicate"> {
  if (event.livemode && !env().STRIPE_ALLOW_LIVE_MODE) {
    log("warn", "stripe.live_event_blocked", { id: event.id, type: event.type });
    await recordEvent(event, rawBody, "ignored", "live mode blocked");
    return "ignored";
  }
  await q(
    `INSERT INTO payment_events (stripe_event_id, type, livemode, status, payload_sha256) VALUES ($1,$2,$3,'processing',$4) ON CONFLICT (stripe_event_id) DO NOTHING`,
    [event.id, event.type, event.livemode, sha256(rawBody)],
  );
  try {
    const handled = await tx(async (c) => {
      // Row lock serializes concurrent deliveries of the same event; the status check makes redelivery a no-op.
      const st = await one<{ status: string }>(`SELECT status FROM payment_events WHERE stripe_event_id=$1 FOR UPDATE`, [event.id], c);
      if (st?.status === "processed" || st?.status === "ignored") return "duplicate" as const;
      await c.query(`UPDATE payment_events SET attempts = attempts + 1 WHERE stripe_event_id=$1 AND status='failed'`, [event.id]);
      const r = await dispatch(c, event);
      await c.query(`UPDATE payment_events SET status=$2, processed_at=now(), error=NULL WHERE stripe_event_id=$1`, [event.id, r]);
      return r;
    });
    return handled;
  } catch (e) {
    await q(`UPDATE payment_events SET status='failed', error=$2 WHERE stripe_event_id=$1`, [event.id, (e as Error).message.slice(0, 500)]);
    log("error", "stripe.event_failed", { id: event.id, type: event.type, error: (e as Error).message });
    throw e;
  }
}

async function recordEvent(event: Stripe.Event, rawBody: string, status: string, error: string | null) {
  await q(
    `INSERT INTO payment_events (stripe_event_id, type, livemode, status, payload_sha256, error, processed_at) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT DO NOTHING`,
    [event.id, event.type, event.livemode, status, sha256(rawBody), error],
  );
}

async function dispatch(c: pg.PoolClient, event: Stripe.Event): Promise<"processed" | "ignored"> {
  switch (event.type) {
    case "checkout.session.completed": {
      // Links the Stripe customer to the workspace. Never grants credits by itself.
      const s = event.data.object;
      const ws = s.client_reference_id;
      const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
      if (!ws || !customer) return "ignored";
      const exists = await one(`SELECT 1 FROM workspaces WHERE id=$1`, [ws], c);
      if (!exists) return "ignored";
      await c.query(`INSERT INTO billing_customers (workspace_id, stripe_customer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ws, customer]);
      return "processed";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(c, event.data.object, new Date(event.created * 1000));
      return "processed";
    case "invoice.paid":
      return (await onInvoicePaid(c, event.data.object)) ? "processed" : "ignored";
    case "invoice.payment_failed": {
      const inv = event.data.object;
      const subId = invoiceSubscriptionId(inv);
      if (!subId) return "ignored";
      await c.query(`UPDATE subscriptions SET status='past_due', updated_at=now() WHERE stripe_subscription_id=$1 AND status IN ('active','trialing')`, [subId]);
      return "processed";
    }
    case "payment_intent.succeeded":
      return (await onTopupPaid(c, event.data.object)) ? "processed" : "ignored";
    case "charge.refunded":
      return (await onChargeRefunded(c, event.data.object)) ? "processed" : "ignored";
    case "charge.dispute.created": {
      const d = event.data.object;
      const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
      if (!pi) return "ignored";
      return (await onDisputeCreated(c, pi)) ? "processed" : "ignored";
    }
    default:
      return "ignored";
  }
}

function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const s = inv.parent?.subscription_details?.subscription;
  if (!s) return null;
  return typeof s === "string" ? s : s.id;
}

async function planForPrice(c: pg.PoolClient, priceId: string): Promise<{ plan: PlanRow; interval: "month" | "year" } | null> {
  const p = await one<PlanRow & { which: string }>(
    `SELECT *, CASE WHEN stripe_price_monthly=$1 THEN 'month' ELSE 'year' END AS which FROM plan_catalog WHERE stripe_price_monthly=$1 OR stripe_price_annual=$1`,
    [priceId],
    c,
  );
  return p ? { plan: p, interval: p.which as "month" | "year" } : null;
}

const ENTITLED = new Set(["active", "trialing", "past_due"]);

async function syncSubscription(c: pg.PoolClient, sub: Stripe.Subscription, eventCreated: Date) {
  const item = sub.items.data[0];
  if (!item) return;
  const mapped = await planForPrice(c, item.price.id);
  if (!mapped) throw new Error(`Unknown Stripe price ${item.price.id}: map it to a plan before processing`);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  let ws = sub.metadata?.workspaceId ?? null;
  const linked = await one<{ workspace_id: string }>(`SELECT workspace_id FROM billing_customers WHERE stripe_customer_id=$1`, [customer], c);
  if (linked) {
    if (ws && ws !== linked.workspace_id) throw new Error("Subscription workspace metadata does not match customer");
    ws = linked.workspace_id;
  }
  if (!ws) throw new Error(`No workspace for customer ${customer}`);
  const prev = await one<{ last_event_created: Date | null }>(`SELECT last_event_created FROM subscriptions WHERE stripe_subscription_id=$1 FOR UPDATE`, [sub.id], c);
  if (prev?.last_event_created && prev.last_event_created > eventCreated) return; // stale, out-of-order event
  const ts = (n: number | null | undefined) => (n ? new Date(n * 1000) : null);
  await c.query(
    `INSERT INTO subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_key, billing_interval, status, current_period_start, current_period_end, cancel_at_period_end, last_event_created)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET stripe_price_id=EXCLUDED.stripe_price_id, plan_key=EXCLUDED.plan_key, billing_interval=EXCLUDED.billing_interval,
       status=EXCLUDED.status, current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end,
       cancel_at_period_end=EXCLUDED.cancel_at_period_end, last_event_created=EXCLUDED.last_event_created, updated_at=now()`,
    [ws, customer, sub.id, item.price.id, mapped.plan.key, mapped.interval, sub.status, ts(item.current_period_start), ts(item.current_period_end), sub.cancel_at_period_end, eventCreated],
  );
  const newPlan = ENTITLED.has(sub.status) ? mapped.plan.key : "free";
  const before = await one<{ plan_key: string }>(`SELECT plan_key FROM workspaces WHERE id=$1 FOR UPDATE`, [ws], c);
  if (before?.plan_key !== newPlan) {
    await c.query(`UPDATE workspaces SET plan_key=$2 WHERE id=$1`, [ws, newPlan]);
    await audit(null, "workspace.plan_changed", `workspace:${ws}`, { from: before?.plan_key, to: newPlan, subscription: sub.id, status: sub.status }, c);
  }
}

/** Grants included credits once per paid invoice. Upgrades (proration invoices) top up to the new plan's allowance. */
async function onInvoicePaid(c: pg.PoolClient, inv: Stripe.Invoice): Promise<boolean> {
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return false;
  // Authoritative state comes from Stripe (avoids webhook ordering issues).
  const sub = await stripe().subscriptions.retrieve(subId);
  await syncSubscription(c, sub, new Date());
  const row = await one<{ workspace_id: string; plan_key: string; billing_interval: "month" | "year"; current_period_start: Date; current_period_end: Date }>(
    `SELECT workspace_id, plan_key, billing_interval, current_period_start, current_period_end FROM subscriptions WHERE stripe_subscription_id=$1`,
    [subId],
    c,
  );
  if (!row || inv.amount_paid < 0) return false;
  const plan = await getPlan(row.plan_key, c);
  const periodEnd = row.billing_interval === "month" ? row.current_period_end : addMonths(row.current_period_start, 1, row.current_period_end);
  const source = row.billing_interval === "month" ? "subscription" : "annual_allocation";
  const already = await one<{ n: number }>(
    // Allowance already granted for the live period = unexpired, unrevoked plan grants (previous periods are expired on renewal).
    `SELECT COALESCE(sum(amount),0)::int AS n FROM credit_grants WHERE workspace_id=$1 AND source IN ('subscription','annual_allocation')
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [row.workspace_id],
    c,
  );
  const isUpdate = inv.billing_reason === "subscription_update";
  const amount = isUpdate ? Math.max(0, plan.monthly_credits - already!.n) : plan.monthly_credits;
  if (amount <= 0) return true;
  const g = await grantCredits(c, {
    workspaceId: row.workspace_id,
    source,
    sourceRef: row.billing_interval === "month" ? inv.id! : `${subId}:${row.current_period_start.toISOString()}:m0:${inv.id}`,
    amount,
    expiresAt: periodEnd,
    description: isUpdate ? `Plan upgrade: ${plan.display_name} allowance top-up` : `${plan.display_name} monthly credits`,
  });
  if (g.created && !isUpdate) await expireSubscriptionGrantsBefore(c, row.workspace_id, g.grantId); // no rollover
  return true;
}

function addMonths(d: Date, n: number, cap: Date) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x > cap ? cap : x;
}

/** Annual plans: grant the monthly allocation for each elapsed month of the current period (run by the worker). */
export async function allocateAnnualCredits() {
  const subs = await q<{ stripe_subscription_id: string; workspace_id: string; plan_key: string; current_period_start: Date; current_period_end: Date }>(
    `SELECT stripe_subscription_id, workspace_id, plan_key, current_period_start, current_period_end FROM subscriptions
      WHERE billing_interval='year' AND status IN ('active','trialing') AND current_period_start IS NOT NULL`,
  );
  let granted = 0;
  for (const s of subs) {
    const plan = await getPlan(s.plan_key);
    for (let m = 1; m < 12; m++) {
      const start = addMonths(s.current_period_start, m, s.current_period_end);
      if (start >= s.current_period_end || start > new Date()) break;
      await tx(async (c) => {
        const r = await grantCredits(c, {
          workspaceId: s.workspace_id,
          source: "annual_allocation",
          sourceRef: `${s.stripe_subscription_id}:${s.current_period_start.toISOString()}:m${m}`,
          amount: plan.monthly_credits,
          expiresAt: addMonths(s.current_period_start, m + 1, s.current_period_end),
          description: `${plan.display_name} (annual) monthly credits`,
        });
        if (r.created) {
          granted++;
          await expireSubscriptionGrantsBefore(c, s.workspace_id, r.grantId);
        }
      });
    }
  }
  return granted;
}

async function onTopupPaid(c: pg.PoolClient, pi: Stripe.PaymentIntent): Promise<boolean> {
  if (pi.metadata?.kind !== "topup") return false;
  const ws = pi.metadata.workspaceId;
  const pack = await one<{ key: string; credits: number; price_cents: number; currency: string }>(`SELECT * FROM topup_packs WHERE key=$1`, [pi.metadata.packKey], c);
  if (!ws || !pack) throw new Error("Top-up metadata references unknown workspace or pack");
  const customer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  const linked = await one<{ workspace_id: string }>(`SELECT workspace_id FROM billing_customers WHERE stripe_customer_id=$1`, [customer], c);
  if (!linked || linked.workspace_id !== ws) throw new Error("Top-up customer does not match workspace");
  // Verify the paid amount against the pack (automatic tax may add on top, never less).
  if (pi.currency !== pack.currency || pi.amount_received < pack.price_cents) throw new Error(`Top-up amount mismatch for ${pi.id}`);
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + env().TOPUP_EXPIRY_MONTHS);
  await grantCredits(c, { workspaceId: ws, source: "topup", sourceRef: pi.id, amount: pack.credits, expiresAt: expires, description: `Purchased ${pack.credits} credits` });
  return true;
}

/**
 * The credit grant a payment funded: a top-up (keyed by payment intent) or a subscription invoice
 * (monthly: keyed by invoice id; annual: first month keyed "...:m0:<invoice>"). Invoice lookup uses the
 * Invoice Payments API because charges no longer carry an invoice reference.
 */
async function grantForPayment(c: pg.PoolClient, pi: string): Promise<{ source: "topup" | "subscription" | "annual_allocation"; source_ref: string; amount: number } | null> {
  const topup = await one<{ source: "topup"; source_ref: string; amount: number }>(`SELECT source, source_ref, amount FROM credit_grants WHERE source='topup' AND source_ref=$1`, [pi], c);
  if (topup) return topup;
  let invoiceId: string | null = null;
  try {
    const list = await stripe().invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
    const inv = list.data[0]?.invoice;
    invoiceId = typeof inv === "string" ? inv : inv?.id ?? null;
  } catch (e) {
    log("warn", "billing.invoice_lookup_failed", { pi, error: (e as Error).message });
  }
  if (!invoiceId) return null;
  return one<{ source: "subscription" | "annual_allocation"; source_ref: string; amount: number }>(
    `SELECT source, source_ref, amount FROM credit_grants
      WHERE (source='subscription' AND source_ref=$1) OR (source='annual_allocation' AND source_ref LIKE '%:m0:' || $1)
      ORDER BY created_at LIMIT 1`,
    [invoiceId],
    c,
  );
}

/**
 * Refunds revoke the matching share of the still-unspent credits the payment bought (top-ups and subscription
 * invoices). Spent credits are never clawed back into a negative balance. Repeated partial refunds are cumulative.
 */
async function onChargeRefunded(c: pg.PoolClient, ch: Stripe.Charge): Promise<boolean> {
  const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
  if (!pi) return false;
  const g = await grantForPayment(c, pi);
  if (!g) return false;
  const target = ch.amount > 0 ? Math.floor((g.amount * ch.amount_refunded) / ch.amount) : g.amount;
  const done = await one<{ n: number }>(
    `SELECT COALESCE(-sum(l.amount),0)::int AS n FROM credit_ledger l JOIN credit_grants cg ON cg.id=l.grant_id WHERE cg.source=$1 AND cg.source_ref=$2 AND l.entry_type='revoke'`,
    [g.source, g.source_ref],
    c,
  );
  const toRevoke = Math.max(0, target - done!.n);
  if (toRevoke > 0) await revokeGrantCredits(c, g.source, g.source_ref, toRevoke, "Credits revoked: payment refunded");
  return true;
}

/** A dispute (chargeback) revokes all unspent credits the disputed payment bought. */
async function onDisputeCreated(c: pg.PoolClient, pi: string): Promise<boolean> {
  const g = await grantForPayment(c, pi);
  if (!g) return false;
  await revokeGrantCredits(c, g.source, g.source_ref, "all", "Credits revoked: payment disputed");
  return true;
}

export async function billingSummary(user: SessionUser) {
  const sub = await activeSubscription(user.workspaceId);
  const ledger = await q<{ id: number; entry_type: string; amount: number; balance_after: number; description: string; created_at: Date; job_id: string | null }>(
    `SELECT id, entry_type, amount, balance_after, description, created_at, job_id FROM credit_ledger WHERE workspace_id=$1 ORDER BY id DESC LIMIT 50`,
    [user.workspaceId],
  );
  const grants = await q<{ source: string; amount: number; remaining: number; expires_at: Date | null; created_at: Date }>(
    `SELECT source, amount, remaining, expires_at, created_at FROM credit_grants WHERE workspace_id=$1 AND remaining > 0 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY priority, expires_at`,
    [user.workspaceId],
  );
  const hasCustomer = !!(await one(`SELECT 1 FROM billing_customers WHERE workspace_id=$1`, [user.workspaceId]));
  return { subscription: sub, ledger, grants, hasCustomer, configured: billingConfigured() };
}

/** Cancel any subscription immediately (used by account deletion). */
export async function cancelSubscriptionsForWorkspace(workspaceId: string) {
  const subs = await q<{ stripe_subscription_id: string }>(`SELECT stripe_subscription_id FROM subscriptions WHERE workspace_id=$1 AND status NOT IN ('canceled','incomplete_expired')`, [workspaceId]);
  for (const s of subs) await stripe().subscriptions.cancel(s.stripe_subscription_id);
  return subs.length;
}

/**
 * Admin "Set up Stripe prices": finds or creates the products and prices for every paid plan and top-up pack in
 * the Stripe account of the configured key (matched by lookup_key, which includes the amount, so price changes
 * create new prices instead of mutating old ones), then stores the IDs in the catalog. Idempotent.
 */
export async function syncStripePrices(admin: SessionUser) {
  if (!admin.isAdmin) throw new AppError("forbidden", "Admins only.");
  const s = stripe();
  return stripeCall(admin, "price setup", async () => {
    const livemode = (await s.balance.retrieve()).livemode;
    const plans = await q<{ key: string; display_name: string; monthly_price_cents: number; annual_price_cents: number }>(
      `SELECT key, display_name, monthly_price_cents, annual_price_cents FROM plan_catalog WHERE monthly_price_cents > 0 ORDER BY rank`,
    );
    const packs = await q<{ key: string; display_name: string; credits: number; price_cents: number; currency: string }>(`SELECT key, display_name, credits, price_cents, currency FROM topup_packs WHERE active ORDER BY price_cents`);
    type Item = { kind: "plan" | "pack"; ref: string; field?: "monthly" | "annual"; product: string; lookup: string; amount: number; currency: string; interval?: "month" | "year" };
    const items: Item[] = [];
    for (const p of plans) {
      items.push({ kind: "plan", ref: p.key, field: "monthly", product: `AI Character Studio ${p.display_name}`, lookup: `acs_${p.key}_month_${p.monthly_price_cents}`, amount: p.monthly_price_cents, currency: "usd", interval: "month" });
      if (p.annual_price_cents > 0) items.push({ kind: "plan", ref: p.key, field: "annual", product: `AI Character Studio ${p.display_name}`, lookup: `acs_${p.key}_year_${p.annual_price_cents}`, amount: p.annual_price_cents, currency: "usd", interval: "year" });
    }
    for (const k of packs) items.push({ kind: "pack", ref: k.key, product: `${k.credits.toLocaleString("en-US")} credits (top-up)`, lookup: `acs_topup_${k.key}_${k.price_cents}`, amount: k.price_cents, currency: k.currency || "usd" });

    const existing = await s.prices.list({ lookup_keys: items.map((i) => i.lookup), limit: 100, active: true });
    const byLookup = new Map(existing.data.map((p) => [p.lookup_key, p.id]));
    const products = new Map<string, string>();
    let created = 0;
    for (const it of items) {
      let priceId = byLookup.get(it.lookup);
      if (!priceId) {
        let productId = products.get(it.product);
        if (!productId) {
          const found = await s.products.search({ query: `name:'${it.product.replace(/'/g, "")}' AND active:'true'` });
          productId = found.data[0]?.id ?? (await s.products.create({ name: it.product, metadata: { app: "ai-character-studio" } })).id;
          products.set(it.product, productId);
        }
        priceId = (await s.prices.create({
          product: productId, currency: it.currency, unit_amount: it.amount, lookup_key: it.lookup, tax_behavior: "exclusive",
          ...(it.interval ? { recurring: { interval: it.interval } } : {}), metadata: { app: "ai-character-studio" },
        })).id;
        created++;
      }
      if (it.kind === "plan") await q(`UPDATE plan_catalog SET ${it.field === "monthly" ? "stripe_price_monthly" : "stripe_price_annual"}=$2 WHERE key=$1`, [it.ref, priceId]);
      else await q(`UPDATE topup_packs SET stripe_price_id=$2 WHERE key=$1`, [it.ref, priceId]);
    }
    return { created, total: items.length, livemode };
  }).then(async (r) => {
    await audit(admin.id, "billing.sync_prices", "stripe", r);
    return r;
  });
}
