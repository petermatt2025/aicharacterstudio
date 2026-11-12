import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { TOOLS, type ToolDef } from "@/lib/tools";
import type { SessionUser } from "./accounts";
import { one, q, tx } from "./db";
import { AppError } from "./errors";
import { assertFeatureAccess, getPlan, limitsPlanKey, type FeatureRow } from "./entitlements";
import { reserveCredits, settleReservation, getBalance } from "./credits";
import { moderate } from "./moderation";
import { rateLimit } from "./rate-limit";
import { getSetting } from "./seed";
import { imageProvider } from "./providers";
import { APP_MAX_REFERENCES } from "./providers/capabilities";
import { buildShots, type Shot } from "./prompting";
import type { AspectRatio, Quality, ReferenceRole } from "./providers/types";
import { track } from "./audit";

const ROLES = ["character", "product", "outfit", "background", "style", "other"] as const;

export const quoteRequestSchema = z.object({
  featureKey: z.string().max(60),
  characterId: z.string().uuid().optional(),
  references: z.array(z.object({ assetId: z.string().uuid(), role: z.enum(ROLES) })).max(APP_MAX_REFERENCES).default([]),
  prompt: z.string().max(2000).default(""),
  presetKeys: z.array(z.string().max(40)).max(12).default([]),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9", "3:2"]).default("4:5"),
  quality: z.enum(["standard", "high"]).default("standard"),
  variations: z.number().int().min(1).max(4).default(1),
  identityStrength: z.enum(["loose", "balanced", "strict"]).optional(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/** Immutable snapshot stored on the quote and copied to the job. The worker only trusts this. */
export type JobSnapshot = {
  featureKey: string;
  characterId: string | null;
  references: Array<{ assetId: string; role: ReferenceRole }>;
  userPrompt: string;
  presetKeys: string[];
  aspectRatio: AspectRatio;
  quality: Quality;
  identityStrength: "loose" | "balanced" | "strict";
  shots: Shot[];
  planKey: string;
  watermark: boolean;
  maxLongEdgePx: number;
  collageOverflow: boolean;
};

type Rules = Record<string, { credits: number; per_outputs: number }>;

export function computeCredits(args: { tool: ToolDef; rules: Rules; refs: number; quality: Quality; identityStrength: "loose" | "balanced" | "strict"; outputs: number; multiplier: number }) {
  const { tool, rules, refs, quality, identityStrength, outputs, multiplier } = args;
  const rate = (k: string) => {
    const r = rules[k];
    if (!r) throw new Error(`Missing credit rule ${k}`);
    return r.credits / r.per_outputs;
  };
  let ruleKey: string;
  let perOutput: number;
  if (tool.creditRule === "angle_sheet" || tool.creditRule === "photoshoot") {
    ruleKey = tool.creditRule;
    perOutput = rate(ruleKey);
    if (quality === "high") perOutput = Math.max(perOutput, rate("high_quality"));
  } else {
    ruleKey = refs === 0 ? "standard" : refs === 1 ? "reference_edit" : "multi_reference";
    perOutput = rate(ruleKey);
    if (quality === "high" && rate("high_quality") > perOutput) {
      ruleKey = "high_quality";
      perOutput = rate(ruleKey);
    }
  }
  if (identityStrength === "strict" && refs > 0 && rate("identity_strict") > perOutput) {
    ruleKey = "identity_strict";
    perOutput = rate(ruleKey);
  }
  const credits = Math.ceil(perOutput * outputs * multiplier - 1e-9);
  return { credits, ruleKey, perOutput, multiplier };
}

async function costGuards(featureKey: string, f: FeatureRow, workspaceId: string) {
  if (!(await getSetting<boolean>("generation_enabled"))) throw new AppError("cost_cap_reached", "Generation is temporarily paused by the operator.");
  const globalCap = await getSetting<number>("global_daily_cost_cap_usd");
  const wsCap = await getSetting<number>("workspace_monthly_cost_cap_usd");
  const r = await one<{ global: string; feature: string; ws: string }>(
    `SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at > now() - interval '24 hours'),0) AS global,
            COALESCE(sum(cost_usd) FILTER (WHERE created_at > now() - interval '24 hours' AND feature_key=$1),0) AS feature,
            COALESCE(sum(cost_usd) FILTER (WHERE created_at > now() - interval '30 days' AND workspace_id=$2),0) AS ws
       FROM usage_events WHERE created_at > now() - interval '30 days'`,
    [featureKey, workspaceId],
  );
  if (Number(r!.global) >= globalCap) throw new AppError("cost_cap_reached", "Generation is temporarily paused (daily capacity reached). Please try again later.");
  if (f.daily_cost_cap_usd !== null && Number(r!.feature) >= Number(f.daily_cost_cap_usd)) throw new AppError("cost_cap_reached", "This tool has reached its daily capacity. Please try again later.");
  if (Number(r!.ws) >= wsCap) throw new AppError("cost_cap_reached", "Your workspace reached its monthly fair-use limit. Contact support.");
}

export async function createQuote(user: SessionUser, input: z.input<typeof quoteRequestSchema>) {
  const req = quoteRequestSchema.parse(input);
  if (!user.emailVerified) throw new AppError("email_not_verified", "Verify your email before generating images.");
  const tool = TOOLS[req.featureKey];
  if (!tool) throw new AppError("feature_unavailable", "This tool is not available yet.");
  const f = await assertFeatureAccess(user, req.featureKey);
  await rateLimit(`quote:${user.id}`, await getSetting<number>("rate_limit_quotes_per_minute"), 60);
  const plan = await getPlan(limitsPlanKey(user));

  // Resolve references: explicit slots + saved character profile.
  const refs: Array<{ assetId: string; role: ReferenceRole }> = [];
  let identityStrength = req.identityStrength ?? "balanced";
  if (req.characterId) {
    const ch = await one<{ id: string; identity_strength: "loose" | "balanced" | "strict"; asset_ids: string[] }>(
      `SELECT p.id, p.identity_strength, array_agg(pa.asset_id ORDER BY (pa.asset_id = p.primary_asset_id) DESC) AS asset_ids
         FROM character_profiles p JOIN character_profile_assets pa ON pa.profile_id=p.id
        WHERE p.id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL GROUP BY p.id`,
      [req.characterId, user.workspaceId],
    );
    if (!ch) throw new AppError("not_found", "Character not found");
    identityStrength = req.identityStrength ?? ch.identity_strength;
    if (req.references.some((r) => r.role === "character")) throw new AppError("validation_failed", "Choose either a saved character or a character photo, not both.");
    const otherSlots = req.references.length;
    const charRefs = Math.max(1, Math.min(tool.slots.length === 1 ? 3 : 1, APP_MAX_REFERENCES - otherSlots));
    for (const a of ch.asset_ids.slice(0, charRefs)) refs.push({ assetId: a, role: "character" });
  }
  refs.push(...req.references);
  if (refs.length > APP_MAX_REFERENCES) throw new AppError("validation_failed", `At most ${APP_MAX_REFERENCES} reference images per generation.`);

  // Slot rules.
  for (const slot of tool.slots) {
    if (slot.required && !refs.some((r) => r.role === slot.role)) throw new AppError("validation_failed", `${slot.label} is required for this tool.`);
  }
  for (const r of req.references) {
    if (!tool.slots.some((s) => s.role === r.role)) throw new AppError("validation_failed", `This tool does not take a ${r.role} reference.`);
  }
  if (tool.key === "reference_mixer" && new Set(refs.map((r) => r.role)).size < 2) throw new AppError("validation_failed", "Fill at least two different slots for the mixer.");

  // Ownership + consent of every reference.
  const ids = [...new Set(refs.map((r) => r.assetId))];
  const rows = await q<{ id: string; kind: string; consent_receipt_id: string | null; moderation_status: string }>(
    `SELECT id, kind, consent_receipt_id, moderation_status FROM assets WHERE id = ANY($1) AND workspace_id=$2 AND deleted_at IS NULL`,
    [ids, user.workspaceId],
  );
  if (rows.length !== ids.length) throw new AppError("not_found", "One or more reference images were not found.");
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of refs) {
    const a = byId.get(r.assetId)!;
    if (a.moderation_status === "flagged") throw new AppError("moderation_blocked", "A reference image was flagged and can't be used.");
    if (r.role === "character" && a.kind !== "character") throw new AppError("consent_required", "Only photos uploaded as Character (with person consent) can be used as a character reference.");
    if (a.kind !== "output" && !a.consent_receipt_id) throw new AppError("consent_required", "A reference image is missing a rights confirmation.");
  }

  // Presets.
  const presetKeys = [...new Set(req.presetKeys)];
  if (presetKeys.some((k) => !tool.presets.some((p) => p.key === k))) throw new AppError("validation_failed", "Unknown preset.");
  if (presetKeys.length < tool.minPresets || presetKeys.length > tool.maxPresets) {
    throw new AppError("validation_failed", `Choose between ${tool.minPresets} and ${tool.maxPresets} ${tool.presetLabel.toLowerCase()}.`);
  }
  if (tool.promptRequired && req.prompt.trim().length < 3) throw new AppError("validation_failed", "Please describe what you want.");
  if (tool.presetMode === "shots" && presetKeys.length === 0 && req.prompt.trim().length < 3) throw new AppError("validation_failed", `Pick at least one of the ${tool.presetLabel.toLowerCase()} or describe a scene.`);

  // Moderation of user text before any spend.
  if (req.prompt.trim()) {
    const mod = await moderate({ text: req.prompt });
    if (mod.flagged) {
      await track(user.id, "prompt_rejected_moderation", { featureKey: req.featureKey, categories: mod.categories });
      throw new AppError("moderation_blocked", "This request isn't allowed under our acceptable use policy.", { categories: mod.categories });
    }
  }

  const variations = tool.allowVariations ? req.variations : 1;
  const shots = buildShots({ tool, roles: refs.map((r) => r.role), presetKeys, userPrompt: req.prompt, identityStrength, variations });
  const outputs = shots.length;
  if (tool.key !== "photoshoot" && outputs > plan.max_outputs_per_job) {
    throw new AppError("plan_required", `Your plan allows up to ${plan.max_outputs_per_job} images per generation.`);
  }

  // Provider readiness + capability fallback.
  const provider = imageProvider();
  const caps = await provider.capabilities();
  const warnings: string[] = [...tool.warnings];
  let collageOverflow = false;
  if (refs.length > caps.maxReferenceImages) {
    if (caps.maxReferenceImages < 1) throw new AppError("provider_capability", "The current image model can't use reference images.");
    collageOverflow = true;
    warnings.push("The current model accepts fewer reference images than you provided; extra references are combined into one labeled reference sheet, which may reduce fidelity.");
  }
  if (refs.length > 0 && !caps.imageEdit) throw new AppError("provider_capability", "The current image model can't use reference images.");
  await costGuards(req.featureKey, f, user.workspaceId);

  const ruleRows = await q<{ key: string; credits: string; per_outputs: number }>(`SELECT key, credits, per_outputs FROM credit_rules`);
  const rules: Rules = Object.fromEntries(ruleRows.map((r) => [r.key, { credits: Number(r.credits), per_outputs: r.per_outputs }]));
  const calc = computeCredits({ tool, rules, refs: refs.length, quality: req.quality, identityStrength, outputs, multiplier: Number(f.credit_multiplier) });

  const snapshot: JobSnapshot = {
    featureKey: req.featureKey,
    characterId: req.characterId ?? null,
    references: refs,
    userPrompt: req.prompt,
    presetKeys,
    aspectRatio: req.aspectRatio,
    quality: req.quality,
    identityStrength,
    shots,
    planKey: plan.key,
    watermark: plan.watermark,
    maxLongEdgePx: plan.max_long_edge_px,
    collageOverflow,
  };
  const ttl = await getSetting<number>("quote_ttl_seconds");
  const breakdown = { ...calc, outputs, warnings, provider: provider.name, chargePolicy: "You are charged only for images delivered. Unused credits are returned automatically." };
  const quote = await one<{ id: string; expires_at: Date }>(
    `INSERT INTO credit_quotes (workspace_id, user_id, feature_key, request, credits, outputs, plan_key, model, breakdown, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' seconds')::interval) RETURNING id, expires_at`,
    [user.workspaceId, user.id, req.featureKey, JSON.stringify(snapshot), calc.credits, outputs, plan.key, provider.model, JSON.stringify(breakdown), String(ttl)],
  );
  const balance = await getBalance(user.workspaceId);
  await track(user.id, "quote_created", { featureKey: req.featureKey, credits: calc.credits });
  return { quoteId: quote!.id, credits: calc.credits, outputs, expiresAt: quote!.expires_at, balance: balance.balance, sufficient: balance.balance >= calc.credits, warnings, breakdown };
}

export const createJobSchema = z.object({ quoteId: z.string().uuid(), idempotencyKey: z.string().min(8).max(100) });

export async function createJob(user: SessionUser, input: z.input<typeof createJobSchema>) {
  const { quoteId, idempotencyKey } = createJobSchema.parse(input);
  const result = await tx(async (c) => {
    // Lock the wallet first: serializes all job creation per workspace (concurrency + balance checks are race-free).
    await c.query(`INSERT INTO credit_wallets (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, [user.workspaceId]);
    await c.query(`SELECT 1 FROM credit_wallets WHERE workspace_id=$1 FOR UPDATE`, [user.workspaceId]);
    const existing = await one<{ id: string; quote_id: string }>(`SELECT id, quote_id FROM generation_jobs WHERE workspace_id=$1 AND idempotency_key=$2`, [user.workspaceId, idempotencyKey], c);
    if (existing) {
      if (existing.quote_id !== quoteId) throw new AppError("conflict", "Idempotency key was already used for a different request.");
      return { jobId: existing.id, duplicate: true };
    }
    const quote = await one<{ id: string; feature_key: string; request: JobSnapshot; credits: number; outputs: number; used_at: Date | null; expired: boolean; plan_key: string }>(
      `SELECT id, feature_key, request, credits, outputs, used_at, expires_at <= now() AS expired, plan_key FROM credit_quotes WHERE id=$1 AND workspace_id=$2 AND user_id=$3 FOR UPDATE`,
      [quoteId, user.workspaceId, user.id],
      c,
    );
    if (!quote) throw new AppError("not_found", "Quote not found");
    if (quote.used_at) throw new AppError("quote_used", "This quote was already used. Request a new quote.");
    if (quote.expired) throw new AppError("quote_expired", "This quote expired. Request a new quote.");
    if (quote.plan_key !== limitsPlanKey(user)) throw new AppError("quote_expired", "Your plan changed since this quote. Request a new quote.");
    await assertFeatureAccess(user, quote.feature_key, c);
    const plan = await getPlan(limitsPlanKey(user), c);
    const active = await one<{ n: number; today: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('queued','running'))::int AS n, count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
         FROM generation_jobs WHERE workspace_id=$1`,
      [user.workspaceId],
      c,
    );
    if (active!.n >= plan.max_concurrent_jobs) throw new AppError("concurrency_limit", `Your plan runs up to ${plan.max_concurrent_jobs} generation(s) at once. Wait for one to finish.`);
    if (active!.today >= plan.max_jobs_per_day) throw new AppError("daily_limit", "Daily generation limit reached for your plan.");
    // Re-verify references still exist (they may have been deleted after quoting).
    const ids = [...new Set(quote.request.references.map((r) => r.assetId))];
    if (ids.length) {
      const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM assets WHERE id = ANY($1) AND workspace_id=$2 AND deleted_at IS NULL`, [ids, user.workspaceId], c);
      if (n!.n !== ids.length) throw new AppError("not_found", "A reference image was deleted. Request a new quote.");
    }
    const jobId = crypto.randomUUID();
    await c.query(
      `INSERT INTO generation_jobs (id, workspace_id, user_id, feature_key, quote_id, idempotency_key, status, request, outputs_requested, credits_reserved)
       VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9)`,
      [jobId, user.workspaceId, user.id, quote.feature_key, quote.id, idempotencyKey, JSON.stringify(quote.request), quote.outputs, quote.credits],
    );
    let pos = 0;
    for (const r of quote.request.references) {
      await c.query(`INSERT INTO generation_job_inputs (job_id, asset_id, role, position) VALUES ($1,$2,$3,$4)`, [jobId, r.assetId, r.role, pos++]);
    }
    await reserveCredits(c, user.workspaceId, jobId, quote.credits); // throws insufficient_credits → whole tx rolls back
    await c.query(`UPDATE credit_quotes SET used_at=now() WHERE id=$1`, [quote.id]);
    return { jobId, duplicate: false };
  });
  if (!result.duplicate) await track(user.id, "job_created", { jobId: result.jobId });
  await one(`SELECT pg_notify('generation_jobs', $1)`, [result.jobId]).catch(() => {});
  return result;
}

export type JobView = {
  id: string;
  featureKey: string;
  status: string;
  outputsRequested: number;
  outputsDelivered: number;
  creditsReserved: number;
  creditsCharged: number;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: string[];
  createdAt: Date;
  finishedAt: Date | null;
  cancelRequested: boolean;
  outputs: Array<{ assetId: string; index: number; width: number; height: number; watermarked: boolean }>;
  prompt: string;
  aspectRatio: string;
};

export async function getJob(user: SessionUser, id: string): Promise<JobView> {
  if (!z.string().uuid().safeParse(id).success) throw new AppError("not_found", "Job not found");
  const j = await one<{
    id: string; feature_key: string; status: string; outputs_requested: number; outputs_delivered: number; credits_reserved: number; credits_charged: number;
    error_code: string | null; error_message: string | null; warnings: string[]; created_at: Date; finished_at: Date | null; cancel_requested: boolean; request: JobSnapshot;
  }>(`SELECT * FROM generation_jobs WHERE id=$1 AND workspace_id=$2`, [id, user.workspaceId]);
  if (!j) throw new AppError("not_found", "Job not found");
  const outs = await q<{ asset_id: string; output_index: number; width: number; height: number; watermarked: boolean }>(
    `SELECT o.asset_id, o.output_index, a.width, a.height, a.watermarked FROM generation_job_outputs o JOIN assets a ON a.id=o.asset_id
      WHERE o.job_id=$1 AND a.deleted_at IS NULL ORDER BY o.output_index`,
    [id],
  );
  return {
    id: j.id,
    featureKey: j.feature_key,
    status: j.status,
    outputsRequested: j.outputs_requested,
    outputsDelivered: j.outputs_delivered,
    creditsReserved: j.credits_reserved,
    creditsCharged: j.credits_charged,
    errorCode: j.error_code,
    errorMessage: j.error_message,
    warnings: j.warnings,
    createdAt: j.created_at,
    finishedAt: j.finished_at,
    cancelRequested: j.cancel_requested,
    outputs: outs.map((o) => ({ assetId: o.asset_id, index: o.output_index, width: o.width, height: o.height, watermarked: o.watermarked })),
    prompt: j.request.userPrompt,
    aspectRatio: j.request.aspectRatio,
  };
}

export async function listJobs(user: SessionUser, limit = 20) {
  return q<{ id: string; feature_key: string; status: string; outputs_requested: number; outputs_delivered: number; credits_charged: number; credits_reserved: number; created_at: Date; first_output: string | null }>(
    `SELECT j.id, j.feature_key, j.status, j.outputs_requested, j.outputs_delivered, j.credits_charged, j.credits_reserved, j.created_at,
            (SELECT o.asset_id FROM generation_job_outputs o JOIN assets a ON a.id=o.asset_id AND a.deleted_at IS NULL WHERE o.job_id=j.id ORDER BY o.output_index LIMIT 1) AS first_output
       FROM generation_jobs j WHERE j.workspace_id=$1 ORDER BY j.created_at DESC LIMIT $2`,
    [user.workspaceId, Math.min(100, Math.max(1, limit))],
  );
}

/** Queued jobs cancel immediately with a full refund; running jobs stop after the current image (charged for delivered only). */
export async function cancelJob(user: SessionUser, id: string) {
  await getJob(user, id);
  return tx(async (c) => {
    const j = await one<{ status: string }>(`SELECT status FROM generation_jobs WHERE id=$1 FOR UPDATE`, [id], c);
    if (j!.status === "queued") {
      await settleReservation(c, id, 0);
      await c.query(`UPDATE generation_jobs SET status='canceled', cancel_requested=true, finished_at=now(), error_code='canceled', error_message='Canceled before start; credits returned.' WHERE id=$1`, [id]);
      return { status: "canceled" };
    }
    if (j!.status === "running") {
      await c.query(`UPDATE generation_jobs SET cancel_requested=true WHERE id=$1`, [id]);
      return { status: "cancel_requested" };
    }
    return { status: j!.status };
  });
}
