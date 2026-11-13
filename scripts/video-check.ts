// Real end-to-end check of the Photo Animator with the configured Google video engine (Gemini Omni).
// Usage: set -a; . ./.env.local; set +a; GEMINI_API_KEY=proxy-injected npx tsx --conditions=react-server scripts/video-check.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { signup, verifyEmail, createSession, userFromSessionToken } from "../src/server/accounts";
import { uploadAsset } from "../src/server/assets";
import { createQuote, createJob, getJob } from "../src/server/generation";
import { claimJob, processJob } from "../src/server/jobs";
import { grantCredits, getBalance } from "../src/server/credits";
import { closePool, one, q, tx } from "../src/server/db";
import { storage } from "../src/server/storage";

async function main() {
  const email = `video-check+${Date.now()}@example.com`;
  const { id, workspaceId } = await signup({ email, password: "correct horse battery", acceptTerms: true });
  const mail = await one<{ body_text: string }>(`SELECT body_text FROM email_outbox WHERE to_email=$1`, [email]);
  await verifyEmail(decodeURIComponent(/token=([^\s]+)/.exec(mail!.body_text)![1]!));
  await q(`UPDATE workspaces SET plan_key='pro' WHERE id=$1`, [workspaceId]);
  await q(`UPDATE users SET beta_allowlisted=true WHERE id=$1`, [id]);
  await tx((c) => grantCredits(c, { workspaceId, source: "admin", sourceRef: `video-check:${Date.now()}`, amount: 100, expiresAt: null, description: "video check" }));
  const { token } = await createSession(id);
  const user = (await userFromSessionToken(token))!;
  const photo = await sharp("public/showcase/walk.webp").png().toBuffer();
  const asset = await uploadAsset(user, { kind: "other", consent: "no_identifiable_people", title: "walk" }, photo, "walk.png");
  const before = (await getBalance(workspaceId)).balance;
  const quote = await createQuote(user, { featureKey: "animate", references: [{ assetId: asset.id, role: "other" }], presetKeys: ["walk"], aspectRatio: "9:16" });
  console.log("quote", quote.credits, "credits");
  const { jobId } = await createJob(user, { quoteId: quote.quoteId, idempotencyKey: `vc_${Date.now()}` });
  const t0 = Date.now();
  let j = await claimJob("video-check");
  while (j && j.id !== jobId) j = await claimJob("video-check");
  console.log("result", await processJob(j!, "video-check"), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const job = await getJob(user, jobId);
  console.log("status", job.status, "charged", job.creditsCharged, "balance", before, "->", (await getBalance(workspaceId)).balance, job.errorMessage ?? "");
  if (job.outputs[0]) {
    const a = await one<{ storage_key: string; mime: string; bytes: number }>(`SELECT storage_key, mime, bytes FROM assets WHERE id=$1`, [job.outputs[0].assetId]);
    const out = path.join("test-results", "real-provider", "animate-walk.mp4");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await storage().get(a!.storage_key));
    console.log("stored", a!.mime, a!.bytes, "bytes ->", out);
  }
  await closePool();
}
main().catch(async (e) => { console.error(e); await closePool(); process.exit(1); });
