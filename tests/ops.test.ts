import { afterAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { raiseAlert, runHealthChecks, workerHeartbeat } from "@/server/alerts";
import { createQuote, createJob, getJob } from "@/server/generation";
import { claimJob, processJob } from "@/server/jobs";
import { one, q } from "@/server/db";
import { systemStatus } from "@/server/status";
import { createSubscriptionCheckout, setStripeForTests, type StripeLike } from "@/server/billing";
import { makeUser, upload, uid } from "./helpers";

afterAll(async () => {
  setStripeForTests(null);
  await q(`UPDATE app_settings SET value='50' WHERE key='global_daily_cost_cap_usd'`);
});

describe("operations", () => {
  it("alerts are logged and emailed at most once per kind per cooldown", async () => {
    const kind = `test_${uid()}`;
    const first = await raiseAlert(kind, "Test alert", "body");
    const second = await raiseAlert(kind, "Test alert", "body again");
    expect(first === "sent" || first === "logged").toBe(true); // "logged" when ADMIN_EMAILS is empty in the test env
    expect(second === "throttled" || second === "logged").toBe(true);
    const rows = await q<{ emailed: boolean }>(`SELECT emailed FROM alert_log WHERE kind=$1 ORDER BY id`, [kind]);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.emailed).toBe(false);
  });

  it("every delivered image gets a cost (per-image estimate when the engine reports none), and the daily cap stops new quotes", async () => {
    const u = await makeUser({ plan: "pro", credits: 100 });
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: `k_${uid()}` });
    let j = await claimJob("ops-worker");
    while (j && j.id !== jobId) j = await claimJob("ops-worker");
    await processJob(j!, "ops-worker");
    expect((await getJob(u, jobId)).status).toBe("succeeded");
    const ev = await one<{ cost_usd: string | null }>(`SELECT cost_usd FROM usage_events WHERE job_id=$1 AND success`, [jobId]);
    expect(Number(ev!.cost_usd)).toBeGreaterThan(0);

    await q(`UPDATE app_settings SET value='0' WHERE key='global_daily_cost_cap_usd'`);
    await expect(createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] })).rejects.toMatchObject({ code: "cost_cap_reached" });
    await q(`UPDATE app_settings SET value='50' WHERE key='global_daily_cost_cap_usd'`);
  });

  it("Stripe errors are explained to admins and hidden from customers", async () => {
    const failing = {
      customers: { create: async () => ({ id: `cus_${uid()}` }) },
      checkout: { sessions: { create: async () => { throw new Stripe.errors.StripeInvalidRequestError({ message: "No such price: 'price_abc'", type: "invalid_request_error" }); } } },
    } as unknown as StripeLike;
    setStripeForTests(failing);
    await q(`UPDATE plan_catalog SET stripe_price_monthly=COALESCE(stripe_price_monthly,'price_test_creator') WHERE key='creator'`);
    const admin = await makeUser({ plan: "free", admin: true });
    const customer = await makeUser({ plan: "free" });
    await expect(createSubscriptionCheckout(admin, { planKey: "creator", interval: "month" })).rejects.toMatchObject({ code: "billing_unavailable", message: expect.stringContaining("No such price") });
    await expect(createSubscriptionCheckout(customer, { planKey: "creator", interval: "month" })).rejects.toMatchObject({ code: "billing_unavailable", message: expect.not.stringContaining("price") });
    setStripeForTests(null);
  });

  it("status page reports worker liveness, queue and storage", async () => {
    await workerHeartbeat(`test-worker-${uid()}`, { engines: ["openai"] });
    await runHealthChecks();
    const s = await systemStatus();
    const by = Object.fromEntries(s.checks.map((c) => [c.name, c]));
    expect(by.Database!.ok).toBe(true);
    expect(by.Worker!.ok).toBe(true);
    expect(by.Storage!.ok).toBe(true);
    expect(by["AI spend (24h)"]).toBeDefined();
  });
});
