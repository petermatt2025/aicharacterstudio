import { describe, expect, it } from "vitest";
import { OpenAIImageProvider } from "@/server/providers/openai";
import { GeminiImageProvider } from "@/server/providers/gemini";
import { ProviderError } from "@/server/providers/types";
import { OPENAI_MODEL_CAPABILITIES, providerSize } from "@/server/providers/capabilities";
import { computeCredits } from "@/server/generation";
import { TOOLS } from "@/lib/tools";
import { CREDIT_RULES } from "@/lib/catalog";
import { directScene, specToPrompt } from "@/lib/scene-director";
import { baselineModerate } from "@/server/moderation";
import { pngBytes } from "./helpers";

const rules = Object.fromEntries(CREDIT_RULES.map((r) => [r.key, { credits: r.credits, per_outputs: r.perOutputs }]));
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Captured = { url: string; body: FormData | Record<string, unknown> | null };

function mockFetch(respond: (url: string) => Response) {
  const calls: Captured[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("data:")) return globalThis.fetch(input, init); // SDK capability probe
    let body: Captured["body"] = null;
    if (init?.body instanceof FormData) body = init.body;
    else if (typeof init?.body === "string") body = JSON.parse(init.body);
    calls.push({ url, body });
    return respond(url);
  }) as typeof fetch;
  return { fn, calls };
}

const ok = () => new Response(JSON.stringify({ created: 1, data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 50, output_tokens: 4000, input_tokens_details: { image_tokens: 40, text_tokens: 10 } } }), { status: 200, headers: { "content-type": "application/json" } });

const baseReq = { userId: "u1", workspaceId: "w1", featureKey: "environment_switch", prompt: "p", references: [], referenceImages: [], requestedOutputs: 1, aspectRatio: "16:9" as const, quality: "standard" as const };

describe("OpenAI adapter (HTTP mocked)", () => {
  it("uses /images/generations without references and never sends input_fidelity to gpt-image-2", async () => {
    const m = mockFetch(ok);
    const p = new OpenAIImageProvider({ apiKey: "sk-test", model: "gpt-image-2", timeoutMs: 5000, fetch: m.fn });
    const r = await p.generate(baseReq);
    expect(m.calls[0]!.url).toMatch(/\/images\/generations$/);
    const body = m.calls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ model: "gpt-image-2", n: 1, size: "1536x864", quality: "medium", output_format: "png" });
    expect(body).not.toHaveProperty("input_fidelity");
    expect(String(body.safety_identifier)).not.toContain("u1"); // hashed
    expect(r.outputs).toHaveLength(1);
    expect(r.usage).toMatchObject({ input_tokens: 50, output_tokens: 4000, image_input_tokens: 40 });
    expect(r.providerCostUsdEstimate).toBeNull(); // no unverified pricing assumed
  });

  it("uses /images/edits with all references as image[] and input_fidelity on gpt-image-1.5", async () => {
    const m = mockFetch(ok);
    const p = new OpenAIImageProvider({ apiKey: "sk-test", model: "gpt-image-1.5", timeoutMs: 5000, fetch: m.fn });
    const img = await pngBytes(64, 64);
    await p.generate({ ...baseReq, referenceImages: [{ role: "character", bytes: img, mime: "image/png" }, { role: "product", bytes: img, mime: "image/png" }], options: { identityStrength: "strict" } });
    expect(m.calls[0]!.url).toMatch(/\/images\/edits$/);
    const fd = m.calls[0]!.body as FormData;
    expect(fd.getAll("image[]").length + fd.getAll("image").length).toBe(2);
    expect(fd.get("input_fidelity")).toBe("high");
    expect(fd.get("size")).toBe("1536x1024"); // snapped to a standard size
  });

  it.each([
    [400, { error: { message: "Your request was rejected by the safety system", code: "moderation_blocked", type: "invalid_request_error" } }, "moderation", false],
    [429, { error: { message: "Rate limit reached", type: "requests" } }, "rate_limit", true],
    [500, { error: { message: "server error" } }, "transient", true],
    [401, { error: { message: "bad key" } }, "auth", false],
    [400, { error: { message: "Invalid size" } }, "invalid_request", false],
  ])("maps HTTP %i to %s", async (status, body, kind, retryable) => {
    const m = mockFetch(() => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    const p = new OpenAIImageProvider({ apiKey: "sk-test", model: "gpt-image-2", timeoutMs: 5000, fetch: m.fn });
    await expect(p.generate(baseReq)).rejects.toMatchObject({ kind, retryable });
  });

  it("refuses unverified models", () => {
    expect(() => new OpenAIImageProvider({ apiKey: "k", model: "gpt-image-1", timeoutMs: 1000 })).toThrow(/capability map/);
  });
});

describe("sizes, credits, prompts", () => {
  it("produces sizes divisible by 16 within ratio limits", () => {
    for (const ar of ["1:1", "4:5", "9:16", "16:9", "3:2"] as const) {
      for (const q of ["standard", "high"] as const) {
        const [w, h] = providerSize(ar, q, OPENAI_MODEL_CAPABILITIES["gpt-image-2"]!).split("x").map(Number) as [number, number];
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(3);
      }
    }
  });

  it("computes credits from configurable rules", () => {
    const t = TOOLS;
    expect(computeCredits({ tool: t.environment_switch!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 2, multiplier: 1 }).credits).toBe(6);
    expect(computeCredits({ tool: t.environment_switch!, rules, refs: 1, quality: "high", identityStrength: "balanced", outputs: 1, multiplier: 1 }).credits).toBe(5);
    expect(computeCredits({ tool: t.reference_mixer!, rules, refs: 3, quality: "standard", identityStrength: "balanced", outputs: 1, multiplier: 1.5 }).credits).toBe(6);
    expect(computeCredits({ tool: t.character_angles!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 4, multiplier: 1 }).credits).toBe(12);
    expect(computeCredits({ tool: t.character_angles!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 1, multiplier: 1 }).credits).toBe(3);
    expect(computeCredits({ tool: t.photoshoot!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 12, multiplier: 1 }).credits).toBe(36);
  });

  it("Scene Director builds a structured, editable prompt", () => {
    const s = directScene("laughing at a cafe at golden hour", "4:5");
    expect(s.lighting).toMatch(/golden/);
    expect(s.expression).toMatch(/laugh/);
    expect(specToPrompt(s)).toContain("Scene: laughing at a cafe at golden hour.");
  });

  it("baseline moderation catches clear abuse and deceptive endorsements", () => {
    expect(baselineModerate("a nude photo").flagged).toBe(true);
    expect(baselineModerate("real customer testimonial with results").categories).toContain("deceptive_endorsement");
    expect(baselineModerate("a person drinking coffee").flagged).toBe(false);
  });
});

describe("Gemini image provider", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const req = (over: Partial<Parameters<GeminiImageProvider["generate"]>[0]> = {}) => ({
    userId: "u1", workspaceId: "w1", featureKey: "environment_switch", prompt: "in a café", references: [],
    referenceImages: [], requestedOutputs: 1, aspectRatio: "9:16" as const, quality: "standard" as const, ...over,
  });

  it("sends labeled references + prompt to generateContent with aspect ratio and size, and returns the image", async () => {
    const { fn, calls } = mockFetch(() => json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1290 } }));
    const p = new GeminiImageProvider({ apiKey: "k", model: "gemini-3.1-flash-image", timeoutMs: 5000, fetch: fn });
    const bytes = await pngBytes(64, 64);
    const r = await p.generate(req({ referenceImages: [{ role: "character", bytes, mime: "image/png" }], quality: "high" }));
    expect(calls[0]!.url).toMatch(/\/models\/gemini-3\.1-flash-image:generateContent$/);
    const body = calls[0]!.body as { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: { responseModalities: string[]; imageConfig: Record<string, string> } };
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "2K" } });
    const parts = body.contents[0]!.parts;
    expect(parts[0]!.text).toMatch(/Reference image 1: the person/);
    expect(parts[1]!.inlineData).toMatchObject({ mimeType: "image/png" });
    expect(parts.at(-1)!.text).toBe("in a café");
    expect(r).toMatchObject({ provider: "gemini", model: "gemini-3.1-flash-image", usage: { input_tokens: 300, output_tokens: 1290 } });
    expect(r.outputs[0]!.bytes.length).toBeGreaterThan(10);
  });

  it("omits imageSize on gemini-2.5-flash-image", async () => {
    const { fn, calls } = mockFetch(() => json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }));
    await new GeminiImageProvider({ apiKey: "k", model: "gemini-2.5-flash-image", timeoutMs: 5000, fetch: fn }).generate(req());
    expect((calls[0]!.body as { generationConfig: { imageConfig: object } }).generationConfig.imageConfig).toEqual({ aspectRatio: "9:16" });
  });

  it("maps safety blocks, billing, rate limits and empty responses to the right error kinds", async () => {
    const run = async (res: Response) => {
      const p = new GeminiImageProvider({ apiKey: "k", model: "gemini-3.1-flash-image", timeoutMs: 5000, fetch: mockFetch(() => res).fn });
      return p.generate(req()).then(() => "ok", (e: ProviderError) => e.kind);
    };
    expect(await run(json(200, { promptFeedback: { blockReason: "SAFETY" } }))).toBe("moderation");
    expect(await run(json(200, { candidates: [{ content: { parts: [{ text: "no" }] }, finishReason: "IMAGE_SAFETY" }] }))).toBe("moderation");
    expect(await run(json(200, { candidates: [{ content: { parts: [{ text: "hmm" }] }, finishReason: "STOP" }] }))).toBe("transient");
    expect(await run(json(402, { error: { code: 402, message: "Your prepayment credits are depleted.", status: "RESOURCE_EXHAUSTED" } }))).toBe("auth");
    expect(await run(json(429, { error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } }))).toBe("rate_limit");
    expect(await run(json(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }))).toBe("auth");
    expect(await run(json(503, { error: { code: 503, message: "overloaded" } }))).toBe("transient");
  });

  it("refuses unverified Gemini models", () => {
    expect(() => new GeminiImageProvider({ apiKey: "k", model: "gemini-made-up", timeoutMs: 1 })).toThrow(/verified/);
  });
});

describe("image to prompt", () => {
  it("is a special tool that can't be quoted as an image job", async () => {
    const { SPECIAL_TOOLS, TOOLS } = await import("@/lib/tools");
    expect(SPECIAL_TOOLS).toContain("image_to_prompt");
    expect(TOOLS.image_to_prompt).toBeUndefined();
  });
});

describe("OpenAI error mapping", () => {
  it("treats an exhausted credit balance as a non-retryable account problem, not a rate limit", async () => {
    const { mapOpenAIError } = await import("@/server/providers/openai");
    const { APIError } = await import("openai");
    const quota = APIError.generate(429, { error: { message: "You have no credits remaining. Add credits to continue.", type: "insufficient_quota", code: "credit_balance_exhausted" } }, undefined, new Headers());
    const mapped = mapOpenAIError(quota);
    expect(mapped.kind).toBe("auth");
    expect(mapped.retryable).toBe(false);
    const rl = APIError.generate(429, { error: { message: "Rate limit reached for images per minute", type: "requests", code: "rate_limit_exceeded" } }, undefined, new Headers());
    expect(mapOpenAIError(rl).kind).toBe("rate_limit");
  });
});

describe("Kling video engine", () => {
  const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: "SUCCEED", data }), { status: 200 });

  it("signs a valid HS256 JWT with the access key as issuer", async () => {
    const { klingToken } = await import("@/server/providers/kling");
    const crypto = await import("node:crypto");
    const t = klingToken("AK123", "SK456", 1_800_000_000);
    const [h, b, sig] = t.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(b!, "base64url").toString())).toEqual({ iss: "AK123", exp: 1_800_001_800, nbf: 1_799_999_995 });
    expect(sig).toBe(crypto.createHmac("sha256", "SK456").update(`${h}.${b}`).digest("base64url"));
  });

  it("creates an image-to-video task cropped to the requested shape, polls until done and downloads the MP4", async () => {
    const { KlingVideoProvider } = await import("@/server/providers/kling");
    const sharp = (await import("sharp")).default;
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown>; auth?: string }> = [];
    let polls = 0;
    const fakeFetch = (async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method ?? "GET", body, auth: (init.headers as Record<string, string> | undefined)?.authorization });
      if (url.endsWith("/v1/videos/image2video") && init.method === "POST") return ok({ task_id: "t1", task_status: "submitted" });
      if (url.endsWith("/v1/videos/image2video/t1")) return ++polls < 2 ? ok({ task_id: "t1", task_status: "processing" }) : ok({ task_id: "t1", task_status: "succeed", task_result: { videos: [{ url: "https://cdn.kling.test/v.mp4" }] } });
      if (url === "https://cdn.kling.test/v.mp4") return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const p = new KlingVideoProvider({ accessKey: "AK", secretKey: "SK", model: "kling-v2-1", mode: "std", fetch: fakeFetch, pollMs: 1 });
    const photo = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#a55" } }).png().toBuffer();
    let waits = 0;
    const r = await p.generate({ prompt: "she smiles", image: { bytes: photo, mime: "image/png" }, aspectRatio: "9:16", seconds: 6, onWait: async () => (++waits, true) });
    expect(r).toMatchObject({ provider: "kling", model: "kling-v2-1", mime: "video/mp4", width: 720, height: 1280 });
    expect(r.bytes.length).toBe(8);
    const create = calls[0]!;
    expect(create.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(create.body).toMatchObject({ model_name: "kling-v2-1", mode: "std", duration: "5", prompt: "she smiles" });
    const sent = await sharp(Buffer.from(String(create.body!.image), "base64")).metadata();
    expect([sent.width, sent.height]).toEqual([720, 1280]); // cropped to vertical
    expect(waits).toBeGreaterThanOrEqual(2);
  });

  it("maps Kling errors (keys, balance, content, rate limits) to the right kinds", async () => {
    const { mapKlingError } = await import("@/server/providers/kling");
    expect(mapKlingError(401, 1002, "Authorization is invalid").kind).toBe("auth");
    expect(mapKlingError(429, 1102, "Account balance not enough").kind).toBe("auth");
    expect(mapKlingError(400, 1301, "Trigger the content security policy").kind).toBe("moderation");
    expect(mapKlingError(429, 1302, "Too many requests").kind).toBe("rate_limit");
    expect(mapKlingError(500, 5000, "Server error").kind).toBe("transient");
  });
});
