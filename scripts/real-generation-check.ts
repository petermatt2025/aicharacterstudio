// Phase 0 gate with the REAL OpenAI provider:
// 1) text-to-image: a synthetic (non-real) portrait via the adapter,
// 2) full app pipeline: upload (real moderation) → quote → atomic reservation → worker → private output → settlement.
// Usage: set -a; . ./.env.local; set +a; npm run -s provider:check
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { signup, verifyEmail, createSession, userFromSessionToken } from "../src/server/accounts";
import { uploadAsset, readAssetBytes } from "../src/server/assets";
import { createQuote, createJob, getJob } from "../src/server/generation";
import { claimJob, processJob } from "../src/server/jobs";
import { imageProvider } from "../src/server/providers";
import { checkInvariants, grantCredits } from "../src/server/credits";
import { closePool, one, q, tx } from "../src/server/db";
import { env } from "../src/server/env";

const OUT = path.join(process.cwd(), "test-results", "real-provider");
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) failures++;
};

async function main() {
  check(env().IMAGE_PROVIDER === "openai", `provider = ${env().IMAGE_PROVIDER}/${env().OPENAI_IMAGE_MODEL}`);
  const provider = imageProvider();

  // 1. Synthetic portrait (text-to-image).
  const t0 = Date.now();
  const cached = path.join(OUT, "1-synthetic-portrait.png");
  const portrait = fs.existsSync(cached) && !process.env.REGENERATE
    ? { outputs: [{ bytes: fs.readFileSync(cached) }], usage: { reused: "previous synthetic portrait (set REGENERATE=1 to make a new one)" } }
    : await provider.generate({
    userId: "provider-check", workspaceId: "provider-check", featureKey: "provider_check",
    prompt: "Photorealistic head-and-shoulders portrait of a fictional adult woman in her 30s with curly dark hair, neutral light-grey studio backdrop, soft key light, friendly expression. A fictional person, not a real individual.",
    references: [], referenceImages: [], requestedOutputs: 1, aspectRatio: "4:5", quality: "standard",
  });
  fs.writeFileSync(path.join(OUT, "1-synthetic-portrait.png"), portrait.outputs[0]!.bytes);
  check(portrait.outputs.length === 1, `text-to-image OK in ${((Date.now() - t0) / 1000).toFixed(1)}s, usage ${JSON.stringify(portrait.usage)}`);

  // 2. Through the app.
  const email = `provider-check+${Date.now()}@example.com`;
  const { id, workspaceId } = await signup({ email, password: "correct horse battery", acceptTerms: true });
  const mail = await one<{ body_text: string }>(`SELECT body_text FROM email_outbox WHERE to_email=$1`, [email]);
  await verifyEmail(decodeURIComponent(/token=([^\s]+)/.exec(mail!.body_text)![1]!));
  await q(`UPDATE workspaces SET plan_key='creator' WHERE id=$1`, [workspaceId]);
  await q(`UPDATE users SET beta_allowlisted=true WHERE id=$1`, [id]);
  // Trial credits are once per canonical email, so check accounts get an explicit grant instead.
  await tx((c) => grantCredits(c, { workspaceId, source: "admin", sourceRef: `provider-check:${id}`, amount: 15, expiresAt: null, description: "Provider check credits" }));
  const user = (await userFromSessionToken((await createSession(id)).token))!;

  const asset = await uploadAsset(user, { kind: "character", consent: "self" }, portrait.outputs[0]!.bytes, "synthetic-portrait.png");
  check(asset.moderation_status === "passed", `upload passed real OpenAI moderation (${asset.moderation_status})`);

  const quote = await createQuote(user, { featureKey: "environment_switch", references: [{ assetId: asset.id, role: "character" }], presetKeys: ["cafe"], aspectRatio: "4:5", quality: "standard" });
  check(quote.credits === 3, `quote: ${quote.credits} credits for ${quote.outputs} image (reference edit)`);
  const before = (await checkInvariants(workspaceId))!.balance;
  const { jobId } = await createJob(user, { quoteId: quote.quoteId, idempotencyKey: crypto.randomUUID() });
  check((await checkInvariants(workspaceId))!.reserved === 3, "3 credits reserved atomically");

  // Process the queue (it may also contain older jobs) until this job reaches a final state.
  const t1 = Date.now();
  let result = "";
  for (let i = 0; i < 10; i++) {
    const job = await claimJob("provider-check");
    if (!job) break;
    const r = await processJob(job, "provider-check");
    if (job.id === jobId) {
      result = r;
      break;
    }
  }
  const view = await getJob(user, jobId);
  check(result === "succeeded" && view.outputs.length === 1, `worker: ${result} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  if (view.errorMessage) console.log("   job error:", view.errorCode, view.errorMessage);
  if (view.outputs[0]) {
    const { bytes } = await readAssetBytes(user, view.outputs[0].assetId, "original");
    fs.writeFileSync(path.join(OUT, "2-environment-switch-cafe.png"), bytes);
  }
  const after = await checkInvariants(workspaceId);
  check(after!.balance === before - 3 && after!.reserved === 0, `credits settled: ${before} → ${after!.balance}`);
  const usage = await q<{ model: string; operation: string; usage: unknown; cost_usd: string | null; duration_ms: number }>(`SELECT model, operation, usage, cost_usd, duration_ms FROM usage_events WHERE job_id=$1`, [jobId]);
  console.log("   usage event:", JSON.stringify(usage[0]));
  check(usage.length === 1 && usage[0]!.model === env().OPENAI_IMAGE_MODEL, "usage/cost recorded per job");
}

main()
  .catch((e) => {
    failures++;
    console.error("ERROR", e?.kind ?? "", e?.message ?? e);
  })
  .finally(async () => {
    await closePool();
    console.log(failures ? `${failures} FAILURE(S)` : "REAL PROVIDER GATE PASSED");
    process.exit(failures ? 1 : 0);
  });
