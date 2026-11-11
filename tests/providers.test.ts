import { describe, expect, it } from "vitest";
import { OpenAIImageProvider } from "@/server/providers/openai";
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
    expect(computeCredits({ tool: t.character_angles!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 4, multiplier: 1 }).credits).toBe(10);
    expect(computeCredits({ tool: t.character_angles!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 1, multiplier: 1 }).credits).toBe(3);
    expect(computeCredits({ tool: t.photoshoot!, rules, refs: 1, quality: "standard", identityStrength: "balanced", outputs: 12, multiplier: 1 }).credits).toBe(24);
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
