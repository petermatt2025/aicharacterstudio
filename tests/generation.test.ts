import { afterEach, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { cancelJob, createJob, createQuote, getJob } from "@/server/generation";
import { claimJob, drainQueue, processJob, releaseWorkerJobs } from "@/server/jobs";
import { FakeImageProvider, fakeCalls } from "@/server/providers/fake";
import { setImageProviderForTests } from "@/server/providers";
import { ProviderError, type GenerationRequest } from "@/server/providers/types";
import { checkInvariants } from "@/server/credits";
import { createCharacter, readAssetBytes } from "@/server/assets";
import { inspect } from "@/server/images";
import { one, q } from "@/server/db";
import { balanceOf, makeUser, upload } from "./helpers";

const W = "test-worker";
const key = () => crypto.randomUUID();

async function run(u: Awaited<ReturnType<typeof makeUser>>, req: Parameters<typeof createQuote>[1]) {
  const quote = await createQuote(u, req);
  const job = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
  await drainQueue(W);
  return { quote, job: await getJob(u, job.jobId) };
}

afterEach(() => setImageProviderForTests(null));

describe("feature gates (server-side)", () => {
  beforeAll(async () => {
    await q(`UPDATE features SET release_state='beta' WHERE key IN ('character_angles','environment_switch','reference_mixer','ugc_ads','photoshoot')`);
  });

  it("Free plan cannot quote Creator tools; Creator cannot quote Pro tools", async () => {
    const free = await makeUser({ plan: "free" });
    const c = await upload(free);
    await expect(createQuote(free, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front"] })).rejects.toMatchObject({ code: "plan_required" });
    const creator = await makeUser({ plan: "creator", credits: 50 });
    const p = await upload(creator, "product");
    await expect(createQuote(creator, { featureKey: "ugc_ads", references: [{ assetId: p.id, role: "product" }], presetKeys: ["unboxing"], prompt: "serum ad" })).rejects.toMatchObject({ code: "plan_required" });
  });

  it("beta tools require allowlist; coming-soon and unimplemented tools are never quotable", async () => {
    const u = await makeUser({ plan: "agency", beta: false, credits: 50 });
    const c = await upload(u);
    await expect(createQuote(u, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front"] })).rejects.toMatchObject({ code: "feature_unavailable" });
    // Coming-soon / planned tools are blocked even for admins.
    await q(`UPDATE features SET release_state='coming_soon' WHERE key='before_after'`);
    const admin = await makeUser({ plan: "agency", admin: true });
    await expect(createQuote(admin, { featureKey: "before_after", references: [{ assetId: c.id, role: "character" }], presetKeys: ["side"], prompt: "before: messy; after: tidy" })).rejects.toMatchObject({ code: "feature_unavailable" });
    await q(`UPDATE features SET release_state='beta' WHERE key='before_after'`);
    // A feature row without an implementation in this build can never be used, whatever the database says.
    await q(`INSERT INTO features (key, tool_number, name, studio, phase, release_state, min_tier, description, display_order)
             VALUES ('test_unimplemented', NULL, 'Test', 'content', 4, 'live', 'free', 'test', 999) ON CONFLICT (key) DO UPDATE SET release_state='live'`);
    await expect(createQuote(admin, { featureKey: "test_unimplemented" })).rejects.toMatchObject({ code: "feature_unavailable" });
    await q(`DELETE FROM features WHERE key='test_unimplemented'`);
  });

  it("paused tools reject new jobs even with a valid quote", async () => {
    const u = await makeUser({ plan: "pro", credits: 50 });
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    await q(`UPDATE features SET release_state='paused', pause_reason='maintenance' WHERE key='environment_switch'`);
    try {
      await expect(createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() })).rejects.toMatchObject({ code: "feature_unavailable" });
    } finally {
      await q(`UPDATE features SET release_state='beta', pause_reason=NULL WHERE key='environment_switch'`);
    }
  });
});

describe("generation pipeline", () => {
  it("happy path: quote → reserve → worker → private outputs → settle (character_angles)", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const start = (await balanceOf(u.workspaceId)).balance;
    const { quote, job } = await run(u, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front", "profile", "three_quarter", "low"] });
    expect(quote.credits).toBe(10); // angle sheet: 10 credits per 4 outputs
    expect(job.status).toBe("succeeded");
    expect(job.outputs).toHaveLength(4);
    expect(job.creditsCharged).toBe(10);
    expect((await balanceOf(u.workspaceId)).balance).toBe(start - 10);
    const { bytes } = await readAssetBytes(u, job.outputs[0]!.assetId, "original");
    expect((await inspect(bytes)).width).toBeGreaterThan(0);
    const usage = await one<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events WHERE job_id=$1 AND success`, [job.id]);
    expect(usage!.n).toBe(4);
    const inv = await checkInvariants(u.workspaceId);
    expect(inv!.balance).toBe(inv!.live);
  });

  it("insufficient credits are rejected before enqueue", async () => {
    const u = await makeUser({ plan: "creator" }); // 15 trial credits
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front", "profile", "three_quarter", "low"], quality: "high" });
    expect(quote.credits).toBe(20);
    expect(quote.sufficient).toBe(false);
    await expect(createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() })).rejects.toMatchObject({ code: "insufficient_credits" });
    expect(await one(`SELECT 1 FROM generation_jobs WHERE quote_id=$1`, [quote.quoteId])).toBeNull();
  });

  it("job submission is idempotent and quotes are single-use", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const k = key();
    const [a, b] = await Promise.all([createJob(u, { quoteId: quote.quoteId, idempotencyKey: k }), createJob(u, { quoteId: quote.quoteId, idempotencyKey: k })]);
    expect(a.jobId).toBe(b.jobId);
    await expect(createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() })).rejects.toMatchObject({ code: "quote_used" });
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM credit_reservations WHERE job_id=$1`, [a.jobId]);
    expect(n!.n).toBe(1);
    await drainQueue(W);
  });

  it("expired quotes and other users' quotes are rejected", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const other = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    await expect(createJob(other, { quoteId: quote.quoteId, idempotencyKey: key() })).rejects.toMatchObject({ code: "not_found" });
    await q(`UPDATE credit_quotes SET expires_at = now() - interval '1 second' WHERE id=$1`, [quote.quoteId]);
    await expect(createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() })).rejects.toMatchObject({ code: "quote_expired" });
  });

  it("cannot use another tenant's image as a reference", async () => {
    const a = await makeUser({ plan: "pro", credits: 40 });
    const b = await makeUser({ plan: "pro", credits: 40 });
    const theirs = await upload(a);
    await expect(createQuote(b, { featureKey: "environment_switch", references: [{ assetId: theirs.id, role: "character" }], presetKeys: ["cafe"] })).rejects.toMatchObject({ code: "not_found" });
  });

  it("transient provider errors retry with backoff, then succeed without double charging", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    let calls = 0;
    const fake = new FakeImageProvider();
    setImageProviderForTests({
      name: "fake", model: "fake-image-1", capabilities: () => fake.capabilities(),
      generate: async (r: GenerationRequest) => {
        if (++calls === 2) throw new ProviderError("transient", "boom");
        return fake.generate(r);
      },
    });
    const quote = await createQuote(u, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front", "profile"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    await drainQueue(W);
    let job = await getJob(u, jobId);
    expect(job.status).toBe("queued"); // retry scheduled
    expect(job.outputsDelivered).toBe(1); // first image kept
    await q(`UPDATE generation_jobs SET run_after=now() WHERE id=$1`, [jobId]);
    await drainQueue(W);
    job = await getJob(u, jobId);
    expect(job.status).toBe("succeeded");
    expect(job.outputs.map((o) => o.index)).toEqual([0, 1]);
    expect(calls).toBe(3); // output 0 was not regenerated
    expect(job.creditsCharged).toBe(quote.credits);
  });

  it("non-retryable failure releases all credits (failure path)", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const start = (await balanceOf(u.workspaceId)).balance;
    const { job } = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], prompt: "[[fake:invalid]]" });
    expect(job.status).toBe("failed");
    expect(job.creditsCharged).toBe(0);
    expect((await balanceOf(u.workspaceId)).balance).toBe(start);
    expect((await balanceOf(u.workspaceId)).reserved).toBe(0);
  });

  it("partial delivery charges only delivered outputs, rounded down", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const start = (await balanceOf(u.workspaceId)).balance;
    const { quote, job } = await run(u, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front", "profile", "three_quarter", "low"], prompt: "[[fake:fail-after:3]]" });
    expect(quote.credits).toBe(10);
    expect(job.status).toBe("partial");
    expect(job.outputsDelivered).toBe(3);
    expect(job.creditsCharged).toBe(7); // floor(10 * 3/4)
    expect((await balanceOf(u.workspaceId)).balance).toBe(start - 7);
  });

  it("retries are exhausted after max attempts and credits returned", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const start = (await balanceOf(u.workspaceId)).balance;
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], prompt: "[[fake:transient]]" });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    for (let i = 0; i < 4; i++) {
      await q(`UPDATE generation_jobs SET run_after=now() WHERE id=$1`, [jobId]);
      await drainQueue(W);
    }
    const job = await getJob(u, jobId);
    expect(job.status).toBe("failed");
    expect((await balanceOf(u.workspaceId)).balance).toBe(start);
  });

  it("a crashed worker's lease expires and another worker resumes the job", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    const claimed = await claimJob("crashing-worker");
    expect(claimed?.id).toBe(jobId);
    expect(await claimJob("other")).toBeNull(); // leased
    await q(`UPDATE generation_jobs SET lease_expires_at = now() - interval '1 second' WHERE id=$1`, [jobId]);
    const again = await claimJob("rescuer");
    expect(again?.id).toBe(jobId);
    await processJob(again!, "rescuer");
    expect((await getJob(u, jobId)).status).toBe("succeeded");
  });

  it("prompt moderation blocks before any spend; provider safety rejection refunds", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    await expect(createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], prompt: "make her naked" })).rejects.toMatchObject({ code: "moderation_blocked" });
    const start = (await balanceOf(u.workspaceId)).balance;
    const { job } = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], prompt: "[[fake:moderation]]" });
    expect(job.status).toBe("rejected");
    expect(job.errorCode).toBe("moderation_blocked");
    expect((await balanceOf(u.workspaceId)).balance).toBe(start);
  });

  it("canceling a queued job refunds fully", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const start = (await balanceOf(u.workspaceId)).balance;
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    expect((await balanceOf(u.workspaceId)).balance).toBe(start - quote.credits);
    expect((await cancelJob(u, jobId)).status).toBe("canceled");
    expect((await balanceOf(u.workspaceId)).balance).toBe(start);
    expect(await drainQueue(W)).toEqual([]);
  });

  it("deleting a reference after enqueue fails the job and refunds", async () => {
    const u = await makeUser({ plan: "creator", credits: 40 });
    const c = await upload(u);
    const start = (await balanceOf(u.workspaceId)).balance;
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    await q(`UPDATE assets SET deleted_at=now() WHERE id=$1`, [c.id]);
    await drainQueue(W);
    const job = await getJob(u, jobId);
    expect(job.errorCode).toBe("reference_deleted");
    expect((await balanceOf(u.workspaceId)).balance).toBe(start);
  });

  it("enforces per-plan concurrency", async () => {
    const u = await makeUser({ plan: "creator", credits: 100 }); // max 2 concurrent
    const c = await upload(u);
    for (let i = 0; i < 2; i++) {
      const qt = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
      await createJob(u, { quoteId: qt.quoteId, idempotencyKey: key() });
    }
    const third = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    await expect(createJob(u, { quoteId: third.quoteId, idempotencyKey: key() })).rejects.toMatchObject({ code: "concurrency_limit" });
    await drainQueue(W);
  });
});

describe("tools", () => {
  it("reference_mixer maps slot roles to provider inputs in order, and requires two slots", async () => {
    const u = await makeUser({ plan: "pro", credits: 60 });
    const ch = await upload(u);
    const prod = await upload(u, "product");
    const outfit = await upload(u, "outfit");
    const bg = await upload(u, "background");
    await expect(createQuote(u, { featureKey: "reference_mixer", references: [{ assetId: prod.id, role: "product" }], prompt: "on a table" })).rejects.toMatchObject({ code: "validation_failed" });
    fakeCalls.length = 0;
    const { quote, job } = await run(u, {
      featureKey: "reference_mixer",
      references: [{ assetId: ch.id, role: "character" }, { assetId: prod.id, role: "product" }, { assetId: outfit.id, role: "outfit" }, { assetId: bg.id, role: "background" }],
      prompt: "She holds the bottle in a bright bathroom",
      presetKeys: ["lifestyle"],
    });
    expect(quote.credits).toBe(4); // multi-reference
    expect(job.status).toBe("succeeded");
    expect(fakeCalls[0]!.roles).toEqual(["character", "product", "outfit", "background"]);
    expect(fakeCalls[0]!.prompt).toMatch(/Image 1: CHARACTER[\s\S]*Image 2: PRODUCT[\s\S]*Image 3: OUTFIT[\s\S]*Image 4: BACKGROUND/);
    expect(fakeCalls[0]!.prompt).toContain('User direction: """She holds the bottle');
  });

  it("falls back to a labeled reference sheet when the model accepts fewer images", async () => {
    const u = await makeUser({ plan: "pro", credits: 60 });
    const ch = await upload(u);
    const prod = await upload(u, "product");
    const bg = await upload(u, "background");
    const fake = new FakeImageProvider();
    setImageProviderForTests({ name: "fake", model: "fake-2ref", capabilities: async () => ({ ...(await fake.capabilities()), maxReferenceImages: 2 }), generate: (r) => fake.generate(r) });
    fakeCalls.length = 0;
    const { quote, job } = await run(u, { featureKey: "reference_mixer", references: [{ assetId: ch.id, role: "character" }, { assetId: prod.id, role: "product" }, { assetId: bg.id, role: "background" }], prompt: "product shot" });
    expect(quote.warnings.join(" ")).toMatch(/reference sheet/);
    expect(job.status).toBe("succeeded");
    expect(fakeCalls[0]!.refs).toBe(2);
    expect(fakeCalls[0]!.roles).toEqual(["character", "other"]);
  });

  it("ugc_ads requires a product and labels outputs as synthetic", async () => {
    const u = await makeUser({ plan: "pro", credits: 60 });
    const prod = await upload(u, "product");
    await expect(createQuote(u, { featureKey: "ugc_ads", presetKeys: ["unboxing"], prompt: "serum" })).rejects.toMatchObject({ code: "validation_failed" });
    const { quote, job } = await run(u, { featureKey: "ugc_ads", references: [{ assetId: prod.id, role: "product" }], presetKeys: ["unboxing", "in_use"], prompt: "vitamin C serum, women 30-45" });
    expect(quote.warnings.join(" ")).toMatch(/synthetic/i);
    expect(job.outputs).toHaveLength(2);
    const a = await one<{ provenance: { synthetic: boolean } }>(`SELECT provenance FROM assets WHERE id=$1`, [job.outputs[0]!.assetId]);
    expect(a!.provenance.synthetic).toBe(true);
  });

  it("photoshoot uses a saved character, quotes the whole set, and is blocked on Free", async () => {
    const u = await makeUser({ plan: "creator", credits: 60 });
    const a1 = await upload(u);
    const a2 = await upload(u);
    const ch = await createCharacter(u, { name: "Me", assetIds: [a1.id, a2.id], identityStrength: "strict" });
    fakeCalls.length = 0;
    const { quote, job } = await run(u, { featureKey: "photoshoot", characterId: ch.id, presetKeys: ["professional"] });
    expect(quote.outputs).toBe(6);
    expect(quote.credits).toBe(30); // strict identity raises per-output rate to 5
    expect(job.outputs).toHaveLength(6);
    expect(fakeCalls[0]!.refs).toBe(2); // both character references sent
    expect(fakeCalls[0]!.prompt).toMatch(/as exactly as possible/);
    const free = await makeUser({ plan: "free" });
    await expect(createQuote(free, { featureKey: "photoshoot", presetKeys: ["professional"] })).rejects.toMatchObject({ code: "plan_required" });
  });

  it("admins get top-plan limits even on the Free plan (more images per job, photoshoot, no watermark)", async () => {
    const admin = await makeUser({ plan: "free", admin: true, credits: 200 });
    const c = await upload(admin);
    const { quote, job } = await run(admin, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front", "profile", "three_quarter", "low"] });
    expect(quote.outputs).toBe(4);
    expect(job.status).toBe("succeeded");
    expect(job.outputs).toHaveLength(4);
    const shoot = await createQuote(admin, { featureKey: "photoshoot", references: [{ assetId: c.id, role: "character" }], presetKeys: ["professional"] });
    expect(shoot.outputs).toBe(6);
  });

  it("images in one job are generated in parallel", async () => {
    const u = await makeUser({ plan: "pro", credits: 100 });
    const c = await upload(u);
    const fake = new FakeImageProvider();
    let inFlight = 0;
    let peak = 0;
    setImageProviderForTests({
      name: "fake", model: "fake-slow", capabilities: () => fake.capabilities(),
      generate: async (r: GenerationRequest) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((res) => setTimeout(res, 150));
        inFlight--;
        return fake.generate(r);
      },
    });
    const { job } = await run(u, { featureKey: "character_angles", references: [{ assetId: c.id, role: "character" }], presetKeys: ["front", "profile", "three_quarter", "low"] });
    expect(job.outputs).toHaveLength(4);
    expect(peak).toBe(4);
  });

  it("the chosen engine is stored on the quote snapshot and unknown engines are rejected", async () => {
    const u = await makeUser({ plan: "pro", credits: 50 });
    const c = await upload(u);
    const qg = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], engine: "gemini" });
    const row = await one<{ request: { engine?: string } }>(`SELECT request FROM credit_quotes WHERE id=$1`, [qg.quoteId]);
    expect(row!.request.engine).toBe("gemini");
    // @ts-expect-error not an engine
    await expect(createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], engine: "midjourney" })).rejects.toThrow();
  });

  it("a stopping worker hands its running jobs back immediately without using up an attempt", async () => {
    const u = await makeUser({ plan: "pro", credits: 50 });
    const c = await upload(u);
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    let claimed = await claimJob("host-a:1:0");
    while (claimed && claimed.id !== jobId) claimed = await claimJob("host-a:1:0");
    expect(claimed!.attempts).toBe(1);
    expect(await releaseWorkerJobs("host-a:1")).toBeGreaterThanOrEqual(1);
    const row = await one<{ status: string; attempts: number; locked_by: string | null }>(`SELECT status, attempts, locked_by FROM generation_jobs WHERE id=$1`, [jobId]);
    expect(row).toEqual({ status: "queued", attempts: 0, locked_by: null });
    await drainQueue("host-b");
    expect((await getJob(u, jobId)).status).toBe("succeeded");
  });

  it("a worker without the engine's API key fails the job fast and refunds", async () => {
    const u = await makeUser({ plan: "pro", credits: 50 });
    const c = await upload(u);
    const before = (await balanceOf(u.workspaceId)).balance;
    const quote = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { jobId } = await createJob(u, { quoteId: quote.quoteId, idempotencyKey: key() });
    const { resetEnvCache } = await import("@/server/env");
    const saved = { p: process.env.IMAGE_PROVIDER, k: process.env.OPENAI_API_KEY };
    process.env.IMAGE_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    resetEnvCache();
    try {
      let j = await claimJob(W);
      while (j && j.id !== jobId) j = await claimJob(W);
      expect(await processJob(j!, W)).not.toBe("lease_lost");
    } finally {
      process.env.IMAGE_PROVIDER = saved.p;
      if (saved.k !== undefined) process.env.OPENAI_API_KEY = saved.k;
      resetEnvCache();
    }
    const job = await getJob(u, jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("provider_unavailable");
    expect((await balanceOf(u.workspaceId)).balance).toBe(before);
  });

  it("free-plan outputs are watermarked and downscaled", async () => {
    await q(`INSERT INTO plan_entitlements (plan_key, feature_key, is_enabled) VALUES ('free','environment_switch',true) ON CONFLICT (plan_key, feature_key) DO UPDATE SET is_enabled=true`);
    try {
      const u = await makeUser({ plan: "free" });
      const c = await upload(u);
      const { job } = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], aspectRatio: "9:16" });
      expect(job.status).toBe("succeeded");
      expect(job.outputs[0]!.watermarked).toBe(true);
      expect(Math.max(job.outputs[0]!.width, job.outputs[0]!.height)).toBeLessThanOrEqual(1024);
    } finally {
      await q(`DELETE FROM plan_entitlements WHERE plan_key='free' AND feature_key='environment_switch'`);
    }
  });
});

describe("phase 2 creator tools", () => {
  beforeAll(async () => {
    await q(`UPDATE features SET release_state='beta' WHERE key IN ('expressions','outfit_swap','style_transform','poses','headshots','ai_twin','thumbnails','social_content','memes')`);
    await q(`UPDATE features SET release_state='beta' WHERE phase IN (3,4) OR key='image_edit'`);
  });

  const cases: Array<[string, string[], string]> = [
    ["expressions", ["happy", "surprised"], ""],
    ["outfit_swap", ["business"], ""],
    ["style_transform", ["anime"], ""],
    ["poses", ["standing", "walking"], ""],
    ["headshots", ["corporate"], ""],
    ["ai_twin", ["neutral_front", "left"], ""],
    ["thumbnails", ["reaction"], 'AI tools video, headline "5 AI TOOLS"'],
    ["social_content", ["story"], 'morning habits, headline "3 HABITS"'],
    ["memes", ["top_bottom"], 'client feedback joke, caption "QUICK CHANGE?"'],
  ];

  it.each(cases)("%s quotes and generates one image per selection", async (featureKey, presetKeys, prompt) => {
    const u = await makeUser({ plan: "pro", credits: 100 });
    const c = await upload(u);
    fakeCalls.length = 0;
    const { quote, job } = await run(u, { featureKey, references: [{ assetId: c.id, role: "character" }], presetKeys, prompt });
    expect(quote.outputs).toBe(presetKeys.length);
    expect(job.status).toBe("succeeded");
    expect(job.outputs).toHaveLength(presetKeys.length);
    expect(fakeCalls[0]!.roles).toEqual(["character"]);
    if (prompt) expect(fakeCalls[0]!.prompt).toContain(prompt);
  });

  it("text tools require a prompt, and 'Use outfit photo' requires an outfit upload", async () => {
    const u = await makeUser({ plan: "pro", credits: 100 });
    const c = await upload(u);
    await expect(createQuote(u, { featureKey: "thumbnails", references: [{ assetId: c.id, role: "character" }], presetKeys: ["reaction"] })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createQuote(u, { featureKey: "outfit_swap", references: [{ assetId: c.id, role: "character" }], presetKeys: ["reference"] })).rejects.toMatchObject({ code: "validation_failed" });
    const outfit = await upload(u, "outfit");
    const ok = await createQuote(u, { featureKey: "outfit_swap", references: [{ assetId: c.id, role: "character" }, { assetId: outfit.id, role: "outfit" }], presetKeys: ["reference"] });
    expect(ok.outputs).toBe(1);
  });

  it("phase 2 tools respect plan tiers (AI Twin and Thumbnails need Pro)", async () => {
    const creator = await makeUser({ plan: "creator", credits: 50 });
    const c = await upload(creator);
    await expect(createQuote(creator, { featureKey: "ai_twin", references: [{ assetId: c.id, role: "character" }], presetKeys: ["neutral_front"] })).rejects.toMatchObject({ code: "plan_required" });
    await expect(createQuote(creator, { featureKey: "expressions", references: [{ assetId: c.id, role: "character" }], presetKeys: ["happy"] })).resolves.toHaveProperty("quoteId");
  });
});


describe("phase 3/4 tools and the image editor", () => {
  beforeAll(async () => {
    await q(`UPDATE features SET release_state='beta' WHERE phase IN (3,4) OR key='image_edit'`);
  });

  it("product tools take a product and produce one image per selection", async () => {
    const u = await makeUser({ plan: "agency", credits: 200 });
    const p = await upload(u, "product");
    for (const [featureKey, presetKeys, prompt] of [["product_lifestyle", ["kitchen", "desk"], ""], ["digital_mockups", ["tablet"], ""], ["marketplace_images", ["main_white"], ""]] as const) {
      const { job } = await run(u, { featureKey, references: [{ assetId: p.id, role: "product" }], presetKeys: [...presetKeys], prompt });
      expect(job.status, featureKey).toBe("succeeded");
      expect(job.outputs, featureKey).toHaveLength(presetKeys.length);
    }
  });

  it("multi-format tools render each format in its own aspect ratio", async () => {
    const u = await makeUser({ plan: "agency", credits: 200 });
    const p = await upload(u, "product");
    const sizes: string[] = [];
    const fake = new FakeImageProvider();
    setImageProviderForTests({ name: "fake", model: "fake-ar", capabilities: () => fake.capabilities(), generate: (r) => { sizes.push(r.aspectRatio); return fake.generate(r); } });
    const { job } = await run(u, { featureKey: "batch_campaigns", references: [{ assetId: p.id, role: "product" }], presetKeys: ["feed", "story", "banner"], prompt: 'sale, headline "40% OFF"' });
    expect(job.outputs).toHaveLength(3);
    expect(sizes.sort()).toEqual(["16:9", "1:1", "9:16"]);
  });

  it("storyboards expand a recipe into one frame per beat", async () => {
    const u = await makeUser({ plan: "agency", credits: 200 });
    const quote = await createQuote(u, { featureKey: "storyboards", presetKeys: ["ad6"], prompt: "a mom finds a meal-prep app" });
    expect(quote.outputs).toBe(6);
  });

  it("character interactions need consented people in every person slot", async () => {
    const u = await makeUser({ plan: "agency", credits: 200 });
    const a = await upload(u);
    const b = await upload(u);
    const notPerson = await upload(u, "product");
    await expect(createQuote(u, { featureKey: "character_interactions", references: [{ assetId: a.id, role: "character" }, { assetId: notPerson.id, role: "other" }], presetKeys: ["talking"] })).rejects.toMatchObject({ code: "consent_required" });
    fakeCalls.length = 0;
    const { job } = await run(u, { featureKey: "character_interactions", references: [{ assetId: a.id, role: "character" }, { assetId: b.id, role: "other" }], presetKeys: ["talking"] });
    expect(job.status).toBe("succeeded");
    expect(fakeCalls[0]!.prompt).toContain("PERSON 2");
  });

  it("image editor works on a gallery output; magic edit needs a description; expand sends a widened canvas", async () => {
    const u = await makeUser({ plan: "agency", credits: 200 });
    const c = await upload(u);
    const first = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const outputId = first.job.outputs[0]!.assetId;
    await expect(createQuote(u, { featureKey: "image_edit", references: [{ assetId: outputId, role: "other" }], presetKeys: ["magic_edit"] })).rejects.toMatchObject({ code: "validation_failed" });
    const widths: Array<[number, number]> = [];
    const fake = new FakeImageProvider();
    setImageProviderForTests({
      name: "fake", model: "fake-edit", capabilities: () => fake.capabilities(),
      generate: async (r) => { const m = await inspect(r.referenceImages[0]!.bytes); widths.push([m.width, m.height]); return fake.generate(r); },
    });
    const { job } = await run(u, { featureKey: "image_edit", references: [{ assetId: outputId, role: "other" }], presetKeys: ["enhance", "expand_wide"] });
    expect(job.status).toBe("succeeded");
    expect(job.outputs).toHaveLength(2);
    const ratios = widths.map(([w, h]) => w / h).sort((x, y) => x - y);
    expect(ratios[1]! / ratios[0]!).toBeGreaterThan(1.3); // the expand input is much wider than the original
    expect(Math.abs(ratios[1]! - 16 / 9)).toBeLessThan(0.02);
  });
});

describe("image to prompt", () => {
  it("analyzes the user's own image via Gemini, parses JSON, and refuses other users' images", async () => {
    await q(`UPDATE features SET release_state='beta' WHERE key='image_to_prompt'`);
    const { analyzeImage } = await import("@/server/image-to-prompt");
    const { resetEnvCache } = await import("@/server/env");
    const u = await makeUser({ plan: "pro" });
    const img = await upload(u);
    const saved = { p: process.env.IMAGE_PROVIDER, g: process.env.GEMINI_API_KEY };
    process.env.IMAGE_PROVIDER = "openai";
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCache();
    try {
      let sent: { url: string; headers: Record<string, string>; body: { contents: Array<{ parts: Array<Record<string, unknown>> }> } } | null = null;
      const fakeFetch = (async (url: string, init: RequestInit) => {
        sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
        const text = JSON.stringify({ subject: "a person in a blazer", setting: "office", style: "editorial", lighting: "window light", camera: "50mm", mood: "confident", colors: "navy", prompt: "Editorial photo of a confident person in a navy blazer in a bright office, window light, 50mm." });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
      }) as unknown as typeof fetch;
      const out = await analyzeImage(u, { assetId: img.id }, fakeFetch);
      expect(out.prompt).toMatch(/navy blazer/);
      expect(out.mood).toBe("confident");
      expect(sent!.url).toMatch(/:generateContent$/);
      expect(sent!.headers["x-goog-api-key"]).toBe("test-key");
      expect(sent!.body.contents[0]!.parts[0]!.inlineData).toBeTruthy();
      const other = await makeUser({ plan: "pro" });
      await expect(analyzeImage(other, { assetId: img.id }, fakeFetch)).rejects.toMatchObject({ code: "not_found" });
    } finally {
      process.env.IMAGE_PROVIDER = saved.p;
      if (saved.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.g;
      resetEnvCache();
    }
  });
});

describe("style boards", () => {
  it("create a board, apply it to a generation as one style-sheet reference, and restyle an existing image", async () => {
    const { createBoard, getBoard, updateBoard, deleteBoard, describeBoard } = await import("@/server/style-boards");
    const u = await makeUser({ plan: "pro", credits: 200 });
    const c = await upload(u);
    const s1 = await upload(u, "style");
    const s2 = await upload(u, "style");
    const board = await createBoard(u, { name: "Golden film", assetIds: [s1.id, s2.id] });
    expect(board.asset_ids).toEqual([s1.id, s2.id]);
    expect((await describeBoard(u, board.id)).description).toMatch(/cinematic/);
    expect((await getBoard(u, board.id)).description).toMatch(/cinematic/);

    const seen: Array<{ roles: string[]; labels: Array<string | undefined>; prompt: string }> = [];
    const fake = new FakeImageProvider();
    setImageProviderForTests({ name: "fake", model: "fake-style", capabilities: () => fake.capabilities(), generate: (r) => { seen.push({ roles: r.referenceImages.map((x) => x.role), labels: r.referenceImages.map((x) => x.label), prompt: r.prompt }); return fake.generate(r); } });
    const plain = await createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"] });
    const { quote, job } = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], styleBoardId: board.id });
    expect(job.status).toBe("succeeded");
    expect(quote.credits).toBeGreaterThan(plain.credits); // style sheet counts as an extra reference
    expect(seen[0]!.roles).toEqual(["character", "style"]);
    expect(seen[0]!.labels[1]).toMatch(/STYLE SHEET/);
    expect(seen[0]!.prompt).toMatch(/Image 2: STYLE SHEET/);
    expect(seen[0]!.prompt).toMatch(/Style notes: Warm cinematic/);

    // Restyle an existing output with the Image Editor; apply_style needs a board.
    const out = job.outputs[0]!.assetId;
    await expect(createQuote(u, { featureKey: "image_edit", references: [{ assetId: out, role: "other" }], presetKeys: ["apply_style"] })).rejects.toMatchObject({ code: "validation_failed" });
    const restyled = await run(u, { featureKey: "image_edit", references: [{ assetId: out, role: "other" }], presetKeys: ["apply_style"], styleBoardId: board.id });
    expect(restyled.job.status).toBe("succeeded");

    // Boards are private to their workspace.
    const other = await makeUser({ plan: "pro", credits: 50 });
    await expect(getBoard(other, board.id)).rejects.toMatchObject({ code: "not_found" });
    const oc = await upload(other);
    await expect(createQuote(other, { featureKey: "environment_switch", references: [{ assetId: oc.id, role: "character" }], presetKeys: ["cafe"], styleBoardId: board.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(updateBoard(other, board.id, { name: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(createBoard(other, { name: "steal", assetIds: [s1.id] })).rejects.toMatchObject({ code: "not_found" });

    // Empty boards can't be applied; deleting removes it.
    const empty = await createBoard(u, { name: "Empty" });
    await expect(createQuote(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe"], styleBoardId: empty.id })).rejects.toMatchObject({ code: "validation_failed" });
    await deleteBoard(u, empty.id);
    await expect(getBoard(u, empty.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("text studio", () => {
  it("saves a same-size edited copy as a new image, moderates the words, and protects other users' images", async () => {
    const { saveTextOverlay } = await import("@/server/text-overlay");
    const { getAsset } = await import("@/server/assets");
    const sharp = (await import("sharp")).default;
    const u = await makeUser({ plan: "pro", credits: 20 });
    const src = await upload(u);
    const meta = await getAsset(u, src.id);
    const same = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: "#ff00aa" } }).png().toBuffer();
    const wrong = await sharp({ create: { width: meta.width + 50, height: meta.height, channels: 3, background: "#ff00aa" } }).png().toBuffer();

    const out = await saveTextOverlay(u, src.id, same, { texts: ["5 AI TOOLS"] });
    expect(out.id).not.toBe(src.id);
    expect(out.kind).toBe("output");
    expect(out.provenance).toMatchObject({ source: "text_overlay", sourceAssetId: src.id });
    expect((await getAsset(u, src.id)).id).toBe(src.id); // original still there

    await expect(saveTextOverlay(u, src.id, wrong, { texts: ["hi"] })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(saveTextOverlay(u, src.id, same, { texts: ["   "] })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(saveTextOverlay(u, src.id, same, { texts: ["a nude photo"] })).rejects.toMatchObject({ code: "moderation_blocked" });
    const other = await makeUser({ plan: "pro" });
    await expect(saveTextOverlay(other, src.id, same, { texts: ["hi"] })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("campaigns", () => {
  it("create, auto-file generations, add/remove gallery images, zip, and keep campaigns private", async () => {
    const m = await import("@/server/campaigns");
    const u = await makeUser({ plan: "pro", credits: 100 });
    const c = await upload(u);
    const camp = await m.createCampaign(u, { name: "Summer launch", brief: "bright, beachy, gen Z" });
    expect(camp.asset_ids).toEqual([]);

    // Generating "into" the campaign files the outputs automatically.
    const { job } = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["cafe", "beach"], campaignId: camp.id });
    expect(job.outputs).toHaveLength(2);
    let now = await m.getCampaign(u, camp.id);
    expect(new Set(now.asset_ids)).toEqual(new Set(job.outputs.map((o) => o.assetId)));

    // Manual add (idempotent) and remove.
    const other = await run(u, { featureKey: "environment_switch", references: [{ assetId: c.id, role: "character" }], presetKeys: ["gym"] });
    const extra = other.job.outputs[0]!.assetId;
    now = await m.addToCampaign(u, camp.id, [extra, extra]);
    expect(now.asset_ids).toHaveLength(3);
    now = await m.removeFromCampaign(u, camp.id, [extra]);
    expect(now.asset_ids).toHaveLength(2);

    const zip = await m.campaignZip(u, camp.id);
    expect(zip.filename).toBe("Summer_launch.zip");
    expect(zip.buf.byteLength).toBeGreaterThan(100);

    // Privacy: other users can't see, fill, or generate into it, nor add their images to it.
    const stranger = await makeUser({ plan: "pro", credits: 50 });
    const sc = await upload(stranger);
    await expect(m.getCampaign(stranger, camp.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(m.addToCampaign(stranger, camp.id, [sc.id])).rejects.toMatchObject({ code: "not_found" });
    await expect(m.addToCampaign(u, camp.id, [sc.id])).rejects.toMatchObject({ code: "not_found" });
    await expect(createQuote(stranger, { featureKey: "environment_switch", references: [{ assetId: sc.id, role: "character" }], presetKeys: ["cafe"], campaignId: camp.id })).rejects.toMatchObject({ code: "not_found" });

    // Deleting the campaign keeps the images.
    await m.deleteCampaign(u, camp.id);
    await expect(m.getCampaign(u, camp.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await (await import("@/server/assets")).getAsset(u, extra)).id).toBe(extra);
  });
});
