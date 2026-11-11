import "server-only";
import { PLAN_RANK, type PlanKey, type ReleaseState } from "@/lib/catalog";
import { TOOLS } from "@/lib/tools";
import type { SessionUser } from "./accounts";
import { one, q, type Db, pool } from "./db";
import { AppError } from "./errors";

export type FeatureRow = {
  key: string;
  tool_number: number | null;
  name: string;
  studio: string;
  phase: number;
  release_state: ReleaseState;
  min_tier: PlanKey;
  credit_multiplier: string;
  description: string;
  pause_reason: string | null;
  display_order: number;
  daily_cost_cap_usd: string | null;
};

export type PlanRow = {
  key: PlanKey;
  rank: number;
  display_name: string;
  description: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  monthly_credits: number;
  stripe_price_monthly: string | null;
  stripe_price_annual: string | null;
  seat_cap: number;
  max_concurrent_jobs: number;
  max_jobs_per_day: number;
  max_outputs_per_job: number;
  max_long_edge_px: number;
  watermark: boolean;
  allows_photoshoot: boolean;
  allows_topups: boolean;
};

export async function getFeature(key: string, db: Db = pool()) {
  const f = await one<FeatureRow>(`SELECT * FROM features WHERE key=$1`, [key], db);
  if (!f) throw new AppError("not_found", "Unknown tool");
  return f;
}

export async function listFeatures() {
  return q<FeatureRow>(`SELECT * FROM features ORDER BY display_order`);
}

export async function getPlan(key: string, db: Db = pool()) {
  const p = await one<PlanRow>(`SELECT * FROM plan_catalog WHERE key=$1`, [key], db);
  if (!p) throw new AppError("not_found", "Unknown plan");
  return p;
}

export async function listPlans() {
  return q<PlanRow>(`SELECT * FROM plan_catalog ORDER BY rank`);
}

export type Access =
  | { ok: true; beta: boolean }
  | { ok: false; reason: "not_implemented" | "coming_soon" | "planned" | "paused" | "beta_only" | "plan_required"; requiredPlan?: PlanKey; message: string };

/** Single source of truth for feature gating. UI uses the same answer; the server enforces it on quote AND job creation. */
export async function featureAccess(user: Pick<SessionUser, "planKey" | "isAdmin" | "betaAllowlisted">, f: FeatureRow, db: Db = pool()): Promise<Access> {
  if (!TOOLS[f.key]) {
    // No implementation in this build: never usable, whatever the database says.
    return { ok: false, reason: f.release_state === "planned" ? "planned" : "not_implemented", message: "This tool is not available yet." };
  }
  switch (f.release_state) {
    case "planned":
      return { ok: false, reason: "planned", message: "This tool is on the roadmap." };
    case "coming_soon":
      return { ok: false, reason: "coming_soon", message: "Coming soon." };
    case "paused":
      return { ok: false, reason: "paused", message: f.pause_reason || "This tool is temporarily paused." };
    case "beta":
      if (!user.betaAllowlisted && !user.isAdmin) return { ok: false, reason: "beta_only", message: "This tool is in private beta." };
      break;
    case "live":
      break;
  }
  if (!user.isAdmin) {
    const override = await one<{ is_enabled: boolean }>(`SELECT is_enabled FROM plan_entitlements WHERE plan_key=$1 AND feature_key=$2`, [user.planKey, f.key], db);
    const allowed = override ? override.is_enabled : PLAN_RANK[user.planKey] >= PLAN_RANK[f.min_tier];
    if (!allowed) return { ok: false, reason: "plan_required", requiredPlan: f.min_tier, message: `Requires the ${f.min_tier[0]!.toUpperCase()}${f.min_tier.slice(1)} plan or higher.` };
    if (f.key === "photoshoot") {
      const plan = await getPlan(user.planKey, db);
      if (!plan.allows_photoshoot) return { ok: false, reason: "plan_required", requiredPlan: "creator", message: "Photoshoots require a paid plan." };
    }
  }
  return { ok: true, beta: f.release_state === "beta" };
}

export async function assertFeatureAccess(user: SessionUser, featureKey: string, db: Db = pool()) {
  const f = await getFeature(featureKey, db);
  const a = await featureAccess(user, f, db);
  if (!a.ok) throw new AppError(a.reason === "plan_required" ? "plan_required" : "feature_unavailable", a.message, { reason: a.reason, requiredPlan: a.ok ? undefined : a.requiredPlan });
  return f;
}
