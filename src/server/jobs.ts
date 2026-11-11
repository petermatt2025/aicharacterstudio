import "server-only";
import crypto from "node:crypto";
import sharp from "sharp";
import { one, q, tx } from "./db";
import { settleReservation } from "./credits";
import { imageProvider } from "./providers";
import { ProviderError, type ImageProvider, type ReferenceRole } from "./providers/types";
import { applyWatermark, makeThumbnail, resizeLongEdge, sanitizeImage, EXT } from "./images";
import { storage } from "./storage";
import { moderate } from "./moderation";
import { env } from "./env";
import { log, track } from "./audit";
import type { JobSnapshot } from "./generation";

export const LEASE_SECONDS = 300;

type JobRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  feature_key: string;
  status: string;
  request: JobSnapshot;
  outputs_requested: number;
  credits_reserved: number;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
};

/** Claim one runnable job (queued and due, or running with an expired lease) using SKIP LOCKED. */
export async function claimJob(workerId: string): Promise<JobRow | null> {
  return one<JobRow>(
    `UPDATE generation_jobs SET status='running', attempts=attempts+1, locked_by=$1, lease_expires_at=now() + ($2 || ' seconds')::interval,
            started_at=COALESCE(started_at, now())
      WHERE id = (
        SELECT id FROM generation_jobs
         WHERE (status='queued' AND run_after <= now()) OR (status='running' AND lease_expires_at < now())
         ORDER BY run_after ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, workspace_id, user_id, feature_key, status, request, outputs_requested, credits_reserved, attempts, max_attempts, cancel_requested`,
    [workerId, String(LEASE_SECONDS)],
  );
}

async function heartbeat(jobId: string, workerId: string): Promise<{ owned: boolean; cancel: boolean }> {
  const r = await one<{ cancel_requested: boolean }>(
    `UPDATE generation_jobs SET lease_expires_at=now() + ($3 || ' seconds')::interval WHERE id=$1 AND locked_by=$2 AND status='running' RETURNING cancel_requested`,
    [jobId, workerId, String(LEASE_SECONDS)],
  );
  return { owned: !!r, cancel: !!r?.cancel_requested };
}

/** Combine overflow references into one labeled sheet when the model accepts fewer images than provided. */
async function collage(images: Array<{ role: ReferenceRole; bytes: Buffer }>): Promise<Buffer> {
  const cell = 768;
  const tiles = await Promise.all(images.map((i) => sharp(i.bytes).resize(cell, cell, { fit: "contain", background: "#ffffff" }).png().toBuffer()));
  const cols = Math.min(2, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const labels = images
    .map((img, i) => `<text x="${(i % cols) * cell + 16}" y="${Math.floor(i / cols) * cell + 40}" font-family="sans-serif" font-size="32" fill="#000" stroke="#fff" stroke-width="1">${img.role.toUpperCase()}</text>`)
    .join("");
  return sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: "#ffffff" } })
    .composite([
      ...tiles.map((t, i) => ({ input: t, left: (i % cols) * cell, top: Math.floor(i / cols) * cell })),
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}">${labels}</svg>`), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

function backoffSeconds(attempt: number) {
  return Math.min(600, 15 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 5);
}

/**
 * Process a claimed job. Each output index is persisted as soon as it exists, so a retry or a crashed worker
 * resumes without regenerating (or double-charging) delivered images.
 */
export async function processJob(job: JobRow, workerId: string, provider: ImageProvider = imageProvider()): Promise<string> {
  const snap = job.request;
  const started = Date.now();

  if (job.attempts > job.max_attempts) {
    return finalize(job, workerId, { code: "retries_exhausted", message: "The image provider kept failing. Your unused credits were returned." });
  }

  // Load references (owned by the job's workspace; deleted references fail the job and refund).
  const inputs = await q<{ asset_id: string; role: ReferenceRole; storage_key: string; mime: string; deleted_at: Date | null }>(
    `SELECT i.asset_id, i.role, a.storage_key, a.mime, a.deleted_at FROM generation_job_inputs i JOIN assets a ON a.id=i.asset_id AND a.workspace_id=$2
      WHERE i.job_id=$1 ORDER BY i.position`,
    [job.id, job.workspace_id],
  );
  if (inputs.length !== snap.references.length || inputs.some((i) => i.deleted_at)) {
    return finalize(job, workerId, { code: "reference_deleted", message: "A reference image was deleted before generation; credits returned." });
  }
  let referenceImages = await Promise.all(inputs.map(async (i) => ({ role: i.role, bytes: await storage().get(i.storage_key), mime: i.mime })));
  const caps = await provider.capabilities();
  if (referenceImages.length > caps.maxReferenceImages) {
    const keep = referenceImages.slice(0, Math.max(0, caps.maxReferenceImages - 1));
    const overflow = referenceImages.slice(keep.length);
    referenceImages = [...keep, { role: "other", bytes: await collage(overflow), mime: "image/png" }];
  }

  const done = new Set((await q<{ output_index: number }>(`SELECT output_index FROM generation_job_outputs WHERE job_id=$1`, [job.id])).map((r) => r.output_index));
  const warnings: string[] = [];
  let failure: { code: string; message: string } | null = null;

  for (let index = 0; index < snap.shots.length; index++) {
    if (done.has(index)) continue;
    const hb = await heartbeat(job.id, workerId);
    if (!hb.owned) return "lease_lost";
    if (hb.cancel) {
      failure = { code: "canceled", message: "Canceled; you were charged only for images already delivered." };
      break;
    }
    const shot = snap.shots[index]!;
    const t0 = Date.now();
    try {
      const res = await provider.generate({
        userId: job.user_id ?? "deleted",
        workspaceId: job.workspace_id,
        featureKey: job.feature_key,
        prompt: shot.prompt,
        references: snap.references,
        referenceImages,
        requestedOutputs: 1,
        aspectRatio: snap.aspectRatio,
        quality: snap.quality,
        options: { identityStrength: snap.identityStrength, callIndex: done.size },
      });
      await q(
        `INSERT INTO usage_events (job_id, workspace_id, feature_key, provider, model, operation, attempt, success, usage, cost_usd, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10)`,
        [job.id, job.workspace_id, job.feature_key, res.provider, res.model, referenceImages.length ? "edit" : "generate", job.attempts, JSON.stringify(res.usage), res.providerCostUsdEstimate, Date.now() - t0],
      );
      await q(`UPDATE generation_jobs SET provider=$2, model=$3 WHERE id=$1`, [job.id, res.provider, res.model]);
      warnings.push(...res.warnings);
      const out = res.outputs[0];
      if (!out) throw new ProviderError("transient", "Provider returned no image");
      const stored = await storeOutput(job, index, out.bytes, res.provider, res.model);
      if (stored === "flagged") warnings.push(`Image ${index + 1} was withheld by output moderation.`);
      else done.add(index);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("transient", (e as Error).message ?? "error");
      await q(
        `INSERT INTO usage_events (job_id, workspace_id, feature_key, provider, model, operation, attempt, success, error_code, usage, cost_usd, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,NULL,$10)`,
        [job.id, job.workspace_id, job.feature_key, provider.name, provider.model, referenceImages.length ? "edit" : "generate", job.attempts, pe.kind, JSON.stringify(pe.usage), Date.now() - t0],
      );
      log("warn", "job.provider_error", { jobId: job.id, kind: pe.kind, attempt: job.attempts });
      if (pe.retryable && job.attempts < job.max_attempts) {
        await q(
          `UPDATE generation_jobs SET status='queued', locked_by=NULL, lease_expires_at=NULL, run_after=now() + ($3 || ' seconds')::interval, error_code=$4, error_message=$5,
                  outputs_delivered=$6 WHERE id=$1 AND locked_by=$2`,
          [job.id, workerId, String(backoffSeconds(job.attempts)), pe.kind, "Retrying after a temporary provider problem…", done.size],
        );
        return "retry_scheduled";
      }
      failure =
        pe.kind === "moderation"
          ? { code: "moderation_blocked", message: "The provider's safety system blocked this request. Unused credits were returned." }
          : pe.kind === "auth"
            ? { code: "provider_unavailable", message: "Image generation is temporarily unavailable. Unused credits were returned." }
            : { code: pe.kind, message: `Generation failed (${pe.kind}). Unused credits were returned.` };
      if (pe.kind === "auth") log("error", "provider.auth_failure", { provider: provider.name });
      break;
    }
  }
  const result = await finalize(job, workerId, failure, warnings);
  log("info", "job.finished", { jobId: job.id, result, ms: Date.now() - started });
  return result;
}

async function storeOutput(job: JobRow, index: number, raw: Buffer, provider: string, model: string): Promise<"stored" | "flagged"> {
  const snap = job.request;
  const clean = await sanitizeImage(raw, { maxBytes: 50 * 1024 * 1024 }); // validates format/dimensions, strips metadata
  let bytes = await resizeLongEdge(clean.bytes, snap.maxLongEdgePx);
  if (snap.watermark) bytes = await applyWatermark(bytes, `${env().APP_NAME} · Free preview`);
  const final = await sanitizeImage(bytes, { maxBytes: 50 * 1024 * 1024 });
  const thumb = await makeThumbnail(final.bytes);
  if (env().MODERATION_PROVIDER === "openai" && env().OPENAI_API_KEY) {
    const mod = await moderate({ imageDataUrl: `data:image/webp;base64,${thumb.toString("base64")}` });
    if (mod.flagged) return "flagged";
  }
  const id = crypto.randomUUID();
  const key = `ws/${job.workspace_id}/outputs/${job.id}/${index}-${id}.${EXT[final.mime]}`;
  const thumbKey = `ws/${job.workspace_id}/thumbs/${id}.webp`;
  await storage().put(key, final.bytes, final.mime);
  await storage().put(thumbKey, thumb, "image/webp");
  const inserted = await tx(async (c) => {
    const exists = await one(`SELECT 1 FROM generation_job_outputs WHERE job_id=$1 AND output_index=$2 FOR UPDATE`, [job.id, index], c);
    if (exists) return false;
    await c.query(
      `INSERT INTO assets (id, workspace_id, owner_user_id, kind, storage_key, thumb_key, title, mime, bytes, width, height, sha256, provenance, moderation_status, feature_key, watermarked)
       VALUES ($1,$2,$3,'output',$4,$5,$6,$7,$8,$9,$10,encode(sha256($11),'hex'),$12,$13,$14,$15)`,
      [id, job.workspace_id, job.user_id, key, thumbKey, `${job.feature_key} #${index + 1}`, final.mime, final.bytes.length, final.width, final.height, final.bytes,
        JSON.stringify({ source: "generation", jobId: job.id, provider, model, synthetic: true }), env().MODERATION_PROVIDER === "openai" ? "passed" : "baseline_only", job.feature_key, snap.watermark],
    );
    await c.query(`INSERT INTO generation_job_outputs (job_id, output_index, asset_id) VALUES ($1,$2,$3)`, [job.id, index, id]);
    await c.query(`UPDATE generation_jobs SET outputs_delivered = outputs_delivered + 1 WHERE id=$1`, [job.id]);
    return true;
  });
  if (!inserted) {
    await storage().delete(key);
    await storage().delete(thumbKey);
  }
  return "stored";
}

/** Settle credits for delivered outputs (rounded down in the customer's favor) and close the job. Idempotent. */
async function finalize(job: JobRow, workerId: string, failure: { code: string; message: string } | null, warnings: string[] = []): Promise<string> {
  return tx(async (c) => {
    const j = await one<{ status: string; locked_by: string | null; outputs_requested: number; credits_reserved: number }>(
      `SELECT status, locked_by, outputs_requested, credits_reserved FROM generation_jobs WHERE id=$1 FOR UPDATE`,
      [job.id],
      c,
    );
    if (!j || j.status !== "running" || j.locked_by !== workerId) return "lease_lost";
    const delivered = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM generation_job_outputs WHERE job_id=$1`, [job.id], c))!.n;
    const charge = delivered >= j.outputs_requested ? j.credits_reserved : Math.floor((j.credits_reserved * delivered) / j.outputs_requested);
    const settled = await settleReservation(c, job.id, charge);
    const status =
      delivered >= j.outputs_requested ? "succeeded" : delivered > 0 ? "partial" : failure?.code === "canceled" ? "canceled" : failure?.code === "moderation_blocked" ? "rejected" : "failed";
    await c.query(
      `UPDATE generation_jobs SET status=$2, outputs_delivered=$3, credits_charged=$4, finished_at=now(), lease_expires_at=NULL,
              error_code=$5, error_message=$6, warnings = warnings || $7::jsonb WHERE id=$1`,
      [job.id, status, delivered, settled.charged, status === "succeeded" ? null : failure?.code ?? (delivered < j.outputs_requested ? "partial" : null),
        status === "succeeded" ? null : failure?.message ?? "Some images could not be generated; you were charged only for delivered images.", JSON.stringify([...new Set(warnings)])],
    );
    if (job.user_id) await track(job.user_id, status === "succeeded" ? "generation_succeeded" : "generation_" + status, { featureKey: job.feature_key });
    return status;
  });
}

/** Fail jobs whose lease expired after the final attempt (e.g. worker crashed repeatedly). */
export async function reapExhaustedJobs(workerId: string) {
  const stuck = await q<JobRow>(
    `UPDATE generation_jobs SET locked_by=$1, lease_expires_at=now() + interval '60 seconds'
      WHERE status='running' AND lease_expires_at < now() AND attempts >= max_attempts
      RETURNING id, workspace_id, user_id, feature_key, status, request, outputs_requested, credits_reserved, attempts, max_attempts, cancel_requested`,
    [workerId],
  );
  for (const j of stuck) await finalize(j, workerId, { code: "retries_exhausted", message: "Generation did not complete. Unused credits were returned." });
  return stuck.length;
}

/** Test/worker helper: claim and process until the queue is empty or `max` jobs ran. */
export async function drainQueue(workerId: string, max = 50, provider?: ImageProvider) {
  const results: string[] = [];
  for (let i = 0; i < max; i++) {
    const j = await claimJob(workerId);
    if (!j) break;
    results.push(await processJob(j, workerId, provider));
  }
  return results;
}
