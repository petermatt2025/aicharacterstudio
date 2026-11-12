import "server-only";
import { CREDIT_RULES, FEATURES, PLANS, PLAN_RANK, TOPUP_PACKS } from "@/lib/catalog";
import { pool, tx } from "./db";

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  generation_enabled: true, // global kill switch
  global_daily_cost_cap_usd: 50, // hard stop for all new jobs when the 24h provider spend exceeds this
  workspace_monthly_cost_cap_usd: 40, // per-workspace provider spend hard stop (30 days)
  quote_ttl_seconds: 600,
  rate_limit_quotes_per_minute: 20,
  rate_limit_uploads_per_hour: 60,
  rate_limit_auth_per_15min: 10,
  storage_quota_mb: { free: 200, creator: 2000, pro: 10000, agency: 30000 },
  // Estimated provider cost per delivered image (USD), used when the provider doesn't report a price.
  // Starting estimates only: copy the real numbers from your OpenAI / Google pricing pages in Admin.
  price_openai_standard_usd: 0.06,
  price_openai_high_usd: 0.2,
  price_gemini_standard_usd: 0.04,
  price_gemini_high_usd: 0.07,
  // What one credit earns you on average (Creator: $19 / 200 credits). Used for margin estimates.
  credit_value_usd: 0.095,
  // Alert emails go to ADMIN_EMAILS; at most one email per alert type per this many minutes.
  alert_cooldown_minutes: 60,
  // Private beta: emails allowed to sign up (in addition to SIGNUP_ALLOWED_EMAILS); signup_open lets anyone in.
  signup_invites: [],
  signup_open: false,
};

/** Per-image cost estimate for a provider/quality (falls back to the OpenAI standard estimate). */
export async function imagePriceUsd(provider: string, quality: "standard" | "high"): Promise<number | null> {
  if (provider === "fake") return 0.01;
  const key = `price_${provider === "gemini" ? "gemini" : "openai"}_${quality}_usd`;
  const v = await getSetting<number | undefined>(key).catch(() => undefined);
  return typeof v === "number" ? v : null;
}

/** Inserts missing catalog rows. Never overwrites admin edits. Safe to run repeatedly. */
export async function seedCatalog() {
  await tx(async (c) => {
    for (const p of PLANS) {
      await c.query(
        `INSERT INTO plan_catalog (key, rank, display_name, description, monthly_price_cents, annual_price_cents, monthly_credits,
           seat_cap, max_concurrent_jobs, max_jobs_per_day, max_outputs_per_job, max_long_edge_px, watermark, allows_photoshoot, allows_topups)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (key) DO NOTHING`,
        [p.key, PLAN_RANK[p.key], p.displayName, p.description, p.monthlyCents, p.annualCents, p.monthlyCredits, p.seatCap, p.maxConcurrentJobs,
          p.maxJobsPerDay, p.maxOutputsPerJob, p.maxLongEdgePx, p.watermark, p.allowsPhotoshoot, p.allowsTopups],
      );
      const upper = p.key.toUpperCase();
      const monthly = process.env[`STRIPE_PRICE_${upper}_MONTHLY`];
      const annual = process.env[`STRIPE_PRICE_${upper}_ANNUAL`];
      if (monthly) await c.query(`UPDATE plan_catalog SET stripe_price_monthly=$2 WHERE key=$1 AND stripe_price_monthly IS NULL`, [p.key, monthly]);
      if (annual) await c.query(`UPDATE plan_catalog SET stripe_price_annual=$2 WHERE key=$1 AND stripe_price_annual IS NULL`, [p.key, annual]);
    }
    let order = 0;
    for (const f of FEATURES) {
      await c.query(
        `INSERT INTO features (key, tool_number, name, studio, phase, release_state, min_tier, description, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (key) DO NOTHING`,
        [f.key, f.toolNumber, f.name, f.studio, f.phase, f.releaseState, f.minTier, f.description, (order += 10)],
      );
    }
    for (const r of CREDIT_RULES) {
      await c.query(`INSERT INTO credit_rules (key, label, credits, per_outputs) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`, [r.key, r.label, r.credits, r.perOutputs]);
    }
    for (const t of TOPUP_PACKS) {
      await c.query(`INSERT INTO topup_packs (key, display_name, price_cents, credits) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`, [t.key, t.displayName, t.priceCents, t.credits]);
      const price = process.env[`STRIPE_PRICE_TOPUP_${t.key.toUpperCase()}`];
      if (price) await c.query(`UPDATE topup_packs SET stripe_price_id=$2 WHERE key=$1 AND stripe_price_id IS NULL`, [t.key, price]);
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query(`INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)]);
    }
  });
}

export async function getSetting<T>(key: string): Promise<T> {
  const r = await pool().query<{ value: T }>(`SELECT value FROM app_settings WHERE key=$1`, [key]);
  if (r.rows[0]) return r.rows[0].value;
  return DEFAULT_SETTINGS[key] as T;
}
