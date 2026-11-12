import "server-only";
import { GoogleGenAI } from "@google/genai";
import { env } from "../env";
import { AppError } from "../errors";
import { ProviderError } from "./types";

/** Photo → short video. One engine for now (Google Veo via the Gemini API key). */
export type VideoRequest = {
  prompt: string;
  image: { bytes: Buffer; mime: string };
  aspectRatio: "16:9" | "9:16";
  seconds: number;
  /** Called while waiting (every poll) so the worker can renew its job lease. Return false to stop. */
  onWait?: () => Promise<boolean>;
};
export type VideoResult = { bytes: Buffer; mime: string; provider: string; model: string; width: number; height: number };

export interface VideoProvider {
  readonly name: string;
  readonly model: string;
  generate(req: VideoRequest): Promise<VideoResult>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VeoVideoProvider implements VideoProvider {
  readonly name = "gemini";
  readonly model: string;
  private ai: GoogleGenAI;
  private usedModel: string;
  constructor(private opts: { apiKey: string; model: string; fallbackModel?: string; timeoutMs?: number; pollMs?: number }) {
    this.model = opts.model;
    this.usedModel = opts.model;
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async generate(req: VideoRequest): Promise<VideoResult> {
    const deadline = Date.now() + (this.opts.timeoutMs ?? 8 * 60_000);
    let op;
    try {
      const start = (model: string) => this.ai.models.generateVideos({
        model,
        prompt: req.prompt,
        image: { imageBytes: req.image.bytes.toString("base64"), mimeType: req.image.mime },
        config: { aspectRatio: req.aspectRatio, durationSeconds: req.seconds, personGeneration: "allow_adult", numberOfVideos: 1 },
      });
      try {
        op = await start(this.model);
      } catch (e) {
        // Preview model names change; fall back once to the documented Veo 3.1 model if the configured one is unknown.
        if (!this.opts.fallbackModel || mapVeoError(e).kind !== "invalid_request" || !/not found|NOT_FOUND|404|not supported/i.test(String((e as Error)?.message))) throw e;
        this.usedModel = this.opts.fallbackModel;
        op = await start(this.opts.fallbackModel);
      }
      while (!op.done) {
        if (Date.now() > deadline) throw new ProviderError("timeout", "Video generation took too long");
        if (req.onWait && !(await req.onWait())) throw new ProviderError("transient", "Job lease lost while waiting for the video");
        await sleep(this.opts.pollMs ?? 10_000);
        op = await this.ai.operations.getVideosOperation({ operation: op });
      }
    } catch (e) {
      throw mapVeoError(e);
    }
    if (op.error) throw mapVeoError(new Error(String((op.error as { message?: string }).message ?? JSON.stringify(op.error))));
    const res = op.response;
    if (!res?.generatedVideos?.length) {
      if (res?.raiMediaFilteredCount) throw new ProviderError("moderation", "The provider's safety system blocked this video");
      throw new ProviderError("transient", "The provider returned no video");
    }
    const v = res.generatedVideos[0]!.video!;
    let bytes: Buffer;
    if (v.videoBytes) bytes = Buffer.from(v.videoBytes, "base64");
    else if (v.uri) {
      const r = await fetch(v.uri, { headers: { "x-goog-api-key": this.opts.apiKey } });
      if (!r.ok) throw new ProviderError("transient", `Video download failed (HTTP ${r.status})`);
      bytes = Buffer.from(await r.arrayBuffer());
    } else throw new ProviderError("transient", "The provider returned an empty video");
    const [w, h] = req.aspectRatio === "16:9" ? [1280, 720] : [720, 1280];
    return { bytes, mime: v.mimeType || "video/mp4", provider: this.name, model: this.usedModel, width: w, height: h };
  }
}

export function mapVeoError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = String((e as Error)?.message ?? e).slice(0, 300);
  if (/api key|permission|PERMISSION_DENIED|UNAUTHENTICATED|401|403|billing|prepayment|credits are depleted|402/i.test(msg)) return new ProviderError("auth", `Video engine rejected the request: ${msg}`);
  if (/not found|404|is not supported|NOT_FOUND/i.test(msg)) return new ProviderError("invalid_request", `Video model unavailable: ${msg}`);
  if (/safety|blocked|prohibited|responsible ai|RAI/i.test(msg)) return new ProviderError("moderation", "The provider's safety system blocked this video");
  if (/429|RESOURCE_EXHAUSTED|rate/i.test(msg)) return new ProviderError("rate_limit", "Video engine is busy; retrying");
  if (/5\d\d|UNAVAILABLE|INTERNAL|timeout|ETIMEDOUT|ECONNRESET/i.test(msg)) return new ProviderError("transient", msg);
  return new ProviderError("invalid_request", msg);
}

/** Tests / offline UI: returns a tiny placeholder file instantly. Refused in production. */
export class FakeVideoProvider implements VideoProvider {
  readonly name = "fake";
  readonly model = "fake-video-1";
  async generate(req: VideoRequest): Promise<VideoResult> {
    if (/\[\[fake:video-fail\]\]/.test(req.prompt)) throw new ProviderError("invalid_request", "Fake video failure");
    if (req.onWait) await req.onWait();
    const [w, h] = req.aspectRatio === "16:9" ? [1280, 720] : [720, 1280];
    // A minimal ISO-BMFF 'ftyp' box: not playable, but a valid-looking MP4 header for storage/serving tests.
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")]);
    return { bytes, mime: "video/mp4", provider: this.name, model: this.model, width: w, height: h };
  }
}

let override: VideoProvider | null = null;
let cached: VideoProvider | null = null;
export function setVideoProviderForTests(p: VideoProvider | null) {
  override = p;
}

export function videoProvider(): VideoProvider {
  if (override) return override;
  if (cached) return cached;
  const e = env();
  if (e.IMAGE_PROVIDER === "fake") {
    if (e.APP_ENV === "production" || e.APP_ENV === "staging") throw new Error("Fake provider is forbidden in production");
    return (cached = new FakeVideoProvider());
  }
  if (!e.GEMINI_API_KEY) throw new AppError("provider_not_configured", "Video needs the Gemini engine (GEMINI_API_KEY).");
  return (cached = new VeoVideoProvider({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_VIDEO_MODEL, fallbackModel: "veo-3.1-generate-preview" }));
}

export function videoConfigured(): boolean {
  const e = env();
  return e.IMAGE_PROVIDER === "fake" || !!e.GEMINI_API_KEY;
}

/** Status page helper: which Veo models this key can use (native list endpoint). */
export async function listVeoModels(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const e = env();
  if (!e.GEMINI_API_KEY) return [];
  const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": e.GEMINI_API_KEY }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { models?: Array<{ name: string }> };
  return (j.models ?? []).map((m) => m.name.replace(/^models\//, "")).filter((n) => n.startsWith("veo"));
}
