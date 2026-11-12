import "server-only";
import { z } from "zod";
import type { SessionUser } from "./accounts";
import { one, q, tx } from "./db";
import { AppError } from "./errors";
import { getSetting } from "./seed";
import { audit } from "./audit";
import { grantCredits } from "./credits";

export function assertAdmin(user: SessionUser | null): asserts user is SessionUser {
  if (!user) throw new AppError("unauthenticated", "Sign in required");
  if (!user.isAdmin) throw new AppError("forbidden", "Admins only");
}

export const featurePatchSchema = z
  .object({
    releaseState: z.enum(["planned", "coming_soon", "beta", "live", "paused"]).optional(),
    minTier: z.enum(["free", "creator", "pro", "agency"]).optional(),
    creditMultiplier: z.number().positive().max(20).optional(),
    pauseReason: z.string().max(300).nullable().optional(),
    description: z.string().min(1).max(500).optional(),
    dailyCostCapUsd: z.number().nonnegative().max(100000).nullable().optional(),
  })
  .strict();

export async function patchFeature(admin: SessionUser, key: string, input: z.input<typeof featurePatchSchema>) {
  assertAdmin(admin);
  const p = featurePatchSchema.parse(input);
  return tx(async (c) => {
    const before = await one(`SELECT * FROM features WHERE key=$1 FOR UPDATE`, [key], c);
    if (!before) throw new AppError("not_found", "Unknown feature");
    const after = await one(
      `UPDATE features SET release_state=COALESCE($2,release_state), min_tier=COALESCE($3,min_tier), credit_multiplier=COALESCE($4,credit_multiplier),
         pause_reason=CASE WHEN $5::boolean THEN $6 ELSE pause_reason END, description=COALESCE($7,description),
         daily_cost_cap_usd=CASE WHEN $8::boolean THEN $9 ELSE daily_cost_cap_usd END, updated_at=now()
       WHERE key=$1 RETURNING *`,
      [key, p.releaseState ?? null, p.minTier ?? null, p.creditMultiplier ?? null, p.pauseReason !== undefined, p.pauseReason ?? null, p.description ?? null,
        p.dailyCostCapUsd !== undefined, p.dailyCostCapUsd ?? null],
      c,
    );
    await audit(admin.id, "feature.update", `feature:${key}`, { before, after: p }, c);
    return after;
  });
}

export const creditRulePatchSchema = z.object({ credits: z.number().positive().max(10000), perOutputs: z.number().int().min(1).max(100).optional() }).strict();

export async function patchCreditRule(admin: SessionUser, key: string, input: z.input<typeof creditRulePatchSchema>) {
  assertAdmin(admin);
  const p = creditRulePatchSchema.parse(input);
  return tx(async (c) => {
    const before = await one(`SELECT * FROM credit_rules WHERE key=$1 FOR UPDATE`, [key], c);
    if (!before) throw new AppError("not_found", "Unknown credit rule");
    const after = await one(`UPDATE credit_rules SET credits=$2, per_outputs=COALESCE($3,per_outputs), updated_at=now() WHERE key=$1 RETURNING *`, [key, p.credits, p.perOutputs ?? null], c);
    await audit(admin.id, "credit_rule.update", `credit_rule:${key}`, { before, after }, c);
    return after;
  });
}

export const settingPatchSchema = z.object({ value: z.unknown() });
const SETTING_VALIDATORS: Record<string, z.ZodType> = {
  generation_enabled: z.boolean(),
  global_daily_cost_cap_usd: z.number().nonnegative(),
  workspace_monthly_cost_cap_usd: z.number().nonnegative(),
  quote_ttl_seconds: z.number().int().min(60).max(3600),
  rate_limit_quotes_per_minute: z.number().int().min(1).max(1000),
  rate_limit_uploads_per_hour: z.number().int().min(1).max(10000),
  rate_limit_auth_per_15min: z.number().int().min(1).max(1000),
  storage_quota_mb: z.record(z.string(), z.number().int().nonnegative()),
  price_openai_standard_usd: z.number().nonnegative().max(5),
  price_openai_high_usd: z.number().nonnegative().max(5),
  price_gemini_standard_usd: z.number().nonnegative().max(5),
  price_gemini_high_usd: z.number().nonnegative().max(5),
  credit_value_usd: z.number().nonnegative().max(10),
  alert_cooldown_minutes: z.number().int().min(5).max(1440),
  signup_invites: z.array(z.string().trim().toLowerCase().email().max(254)).max(1000).transform((xs) => [...new Set(xs)]),
  signup_open: z.boolean(),
};

export async function patchSetting(admin: SessionUser, key: string, value: unknown) {
  assertAdmin(admin);
  const v = SETTING_VALIDATORS[key];
  if (!v) throw new AppError("not_found", "Unknown setting");
  const parsed = v.parse(value);
  await q(`INSERT INTO app_settings (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(parsed)]);
  await audit(admin.id, "setting.update", `setting:${key}`, { value: parsed });
}

export const planPatchSchema = z
  .object({
    stripePriceMonthly: z.string().regex(/^price_[A-Za-z0-9]+$/).nullable().optional(),
    stripePriceAnnual: z.string().regex(/^price_[A-Za-z0-9]+$/).nullable().optional(),
    monthlyCredits: z.number().int().min(0).max(100000).optional(),
    maxConcurrentJobs: z.number().int().min(1).max(50).optional(),
    maxJobsPerDay: z.number().int().min(1).max(10000).optional(),
    description: z.string().min(1).max(300).optional(),
  })
  .strict();

/** Price IDs are swapped (never mutated): existing subscribers keep their Stripe price until migrated deliberately. */
export async function patchPlan(admin: SessionUser, key: string, input: z.input<typeof planPatchSchema>) {
  assertAdmin(admin);
  const p = planPatchSchema.parse(input);
  return tx(async (c) => {
    const before = await one(`SELECT * FROM plan_catalog WHERE key=$1 FOR UPDATE`, [key], c);
    if (!before) throw new AppError("not_found", "Unknown plan");
    const after = await one(
      `UPDATE plan_catalog SET
         stripe_price_monthly=CASE WHEN $2::boolean THEN $3 ELSE stripe_price_monthly END,
         stripe_price_annual=CASE WHEN $4::boolean THEN $5 ELSE stripe_price_annual END,
         monthly_credits=COALESCE($6,monthly_credits), max_concurrent_jobs=COALESCE($7,max_concurrent_jobs),
         max_jobs_per_day=COALESCE($8,max_jobs_per_day), description=COALESCE($9,description), updated_at=now()
       WHERE key=$1 RETURNING *`,
      [key, p.stripePriceMonthly !== undefined, p.stripePriceMonthly ?? null, p.stripePriceAnnual !== undefined, p.stripePriceAnnual ?? null,
        p.monthlyCredits ?? null, p.maxConcurrentJobs ?? null, p.maxJobsPerDay ?? null, p.description ?? null],
      c,
    );
    await audit(admin.id, "plan.update", `plan:${key}`, { before, after: p }, c);
    return after;
  });
}

export async function adminGrantCredits(admin: SessionUser, workspaceId: string, amount: number, note: string) {
  assertAdmin(admin);
  const n = z.number().int().min(1).max(100000).parse(amount);
  const why = z.string().trim().min(3).max(200).parse(note);
  return tx(async (c) => {
    const r = await grantCredits(c, { workspaceId, source: "admin", sourceRef: `admin:${crypto.randomUUID()}`, amount: n, expiresAt: null, description: `Admin grant: ${why}` });
    await audit(admin.id, "credits.grant", `workspace:${workspaceId}`, { amount: n, note: why }, c);
    return r;
  });
}

export async function usageReport(admin: SessionUser, days: 7 | 30) {
  assertAdmin(admin);
  const since = `${days} days`;
  const byFeature = await q<{ feature_key: string; calls: number; failures: number; cost_usd: string | null; unpriced: number; credits: number }>(
    `SELECT u.feature_key, count(*)::int AS calls, count(*) FILTER (WHERE NOT u.success)::int AS failures, sum(u.cost_usd) AS cost_usd,
            count(*) FILTER (WHERE u.cost_usd IS NULL AND u.success)::int AS unpriced,
            COALESCE((SELECT sum(j.credits_charged) FROM generation_jobs j WHERE j.feature_key=u.feature_key AND j.created_at > now() - $1::interval),0)::int AS credits
       FROM usage_events u WHERE u.created_at > now() - $1::interval GROUP BY u.feature_key ORDER BY 4 DESC NULLS LAST`,
    [since],
  );
  const byModel = await q<{ provider: string; model: string; calls: number; cost_usd: string | null; avg_ms: number }>(
    `SELECT provider, model, count(*)::int AS calls, sum(cost_usd) AS cost_usd, avg(duration_ms)::int AS avg_ms FROM usage_events WHERE created_at > now() - $1::interval GROUP BY 1,2 ORDER BY 3 DESC`,
    [since],
  );
  const jobs = await q<{ status: string; n: number; credits: number; outputs: number }>(
    `SELECT status, count(*)::int AS n, COALESCE(sum(credits_charged),0)::int AS credits, COALESCE(sum(outputs_delivered),0)::int AS outputs FROM generation_jobs WHERE created_at > now() - $1::interval GROUP BY status`,
    [since],
  );
  const byPlan = await q<{ plan_key: string; workspaces: number; cost_usd: string | null; credits_charged: number }>(
    `SELECT w.plan_key, count(DISTINCT w.id)::int AS workspaces, sum(u.cost_usd) AS cost_usd,
            COALESCE((SELECT sum(j.credits_charged) FROM generation_jobs j JOIN workspaces w2 ON w2.id=j.workspace_id WHERE w2.plan_key=w.plan_key AND j.created_at > now() - $1::interval),0)::int AS credits_charged
       FROM workspaces w LEFT JOIN usage_events u ON u.workspace_id=w.id AND u.created_at > now() - $1::interval
      WHERE w.deleted_at IS NULL GROUP BY w.plan_key`,
    [since],
  );
  const topUsers = await q<{ workspace_id: string; email: string; cost_usd: string | null; calls: number; credits: number }>(
    `SELECT u.workspace_id, us.email, sum(u.cost_usd) AS cost_usd, count(*)::int AS calls,
            COALESCE((SELECT sum(j.credits_charged) FROM generation_jobs j WHERE j.workspace_id=u.workspace_id AND j.created_at > now() - $1::interval),0)::int AS credits
       FROM usage_events u
       JOIN workspaces w ON w.id=u.workspace_id JOIN users us ON us.id=w.owner_user_id
      WHERE u.created_at > now() - $1::interval GROUP BY 1,2 ORDER BY 3 DESC NULLS LAST LIMIT 10`,
    [since],
  );
  // Revenue proxy from active subscriptions (list price; Stripe is the source of truth for actual receipts).
  const mrr = await one<{ cents: number }>(
    `SELECT COALESCE(sum(CASE WHEN s.billing_interval='month' THEN p.monthly_price_cents ELSE p.annual_price_cents/12 END),0)::int AS cents
       FROM subscriptions s JOIN plan_catalog p ON p.key=s.plan_key WHERE s.status IN ('active','trialing','past_due')`,
  );
  const funnel = await q<{ name: string; n: number }>(`SELECT name, count(DISTINCT user_id)::int AS n FROM analytics_events WHERE created_at > now() - $1::interval GROUP BY name`, [since]);
  const creditValue = Number(await getSetting<number>("credit_value_usd").catch(() => 0.095));
  return { days, byFeature, byModel, jobs, byPlan, topUsers, mrrCents: mrr?.cents ?? 0, funnel, creditValue };
}

export async function recentJobs(admin: SessionUser) {
  assertAdmin(admin);
  return q(
    `SELECT j.id, j.feature_key, j.status, j.attempts, j.error_code, j.error_message, j.outputs_requested, j.outputs_delivered, j.credits_charged, j.created_at, j.finished_at, u.email
       FROM generation_jobs j LEFT JOIN users u ON u.id=j.user_id ORDER BY j.created_at DESC LIMIT 50`,
  );
}

export async function listUsers(admin: SessionUser, search = "") {
  assertAdmin(admin);
  return q(
    `SELECT u.id, u.email, u.status, u.is_admin, u.beta_allowlisted, u.email_verified_at, u.created_at, w.id AS workspace_id, w.plan_key, cw.balance
       FROM users u LEFT JOIN workspaces w ON w.owner_user_id=u.id AND w.deleted_at IS NULL LEFT JOIN credit_wallets cw ON cw.workspace_id=w.id
      WHERE u.status <> 'deleted' AND ($1 = '' OR u.email ILIKE '%' || $1 || '%') ORDER BY u.created_at DESC LIMIT 100`,
    [search.slice(0, 100)],
  );
}

export async function auditLog(admin: SessionUser) {
  assertAdmin(admin);
  return q(`SELECT a.id, a.action, a.target, a.context, a.created_at, u.email AS actor FROM admin_audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100`);
}
