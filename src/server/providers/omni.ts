import "server-only";
import { ProviderError } from "./types";
import type { VideoProvider, VideoRequest, VideoResult } from "./video";

/**
 * Google Gemini Omni (photo → video with native audio) via the Gemini Interactions API.
 * Verified live on 2026-11-13 with gemini-omni-1.2-flash: POST /v1beta/interactions (background), poll
 * GET /v1beta/interactions/{id}; the MP4 arrives inline in steps[].content[] of type "video".
 */
type Content = { type: string; data?: string; uri?: string; mime_type?: string; text?: string };
type Interaction = {
  id?: string;
  status?: string;
  steps?: Array<{ type: string; content?: Content[] }>;
  usage?: { total_output_tokens?: number; total_input_tokens?: number; total_thought_tokens?: number };
  error?: { code?: number; message?: string; status?: string };
};

export function mapOmniError(status: number, message: string): ProviderError {
  const m = message.slice(0, 250);
  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(m)) return new ProviderError("auth", `Google rejected the key: ${m}`);
  if (status === 402 || /prepayment|billing|credits are depleted/i.test(m)) return new ProviderError("auth", `Google account has no credit: ${m}`);
  if (status === 429) return new ProviderError("rate_limit", "Google video is busy; retrying");
  if (/safety|blocked|prohibited|policy/i.test(m)) return new ProviderError("moderation", "Google's safety system blocked this video");
  if (status >= 500) return new ProviderError("transient", `Google server error: ${m}`);
  if (status === 404) return new ProviderError("invalid_request", `Video model unavailable: ${m}`);
  return new ProviderError("invalid_request", `Google rejected the request: ${m}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DONE = new Set(["completed", "failed", "cancelled", "incomplete"]);

export class OmniVideoProvider implements VideoProvider {
  readonly name = "gemini";
  readonly model: string;
  /** Output-token usage of the last video (for cost estimates). */
  lastUsage: Interaction["usage"] | undefined;
  constructor(private opts: { apiKey: string; model: string; fetch?: typeof fetch; pollMs?: number; timeoutMs?: number; baseUrl?: string }) {
    this.model = opts.model;
  }
  private async call(path: string, init: RequestInit = {}): Promise<Interaction> {
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"}${path}`, {
        ...init,
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ProviderError("transient", "Could not reach Google");
    }
    const raw = (await res.json().catch(() => ({}))) as Interaction | Interaction[];
    const json = Array.isArray(raw) ? raw[0]! : raw;
    if (!res.ok || json.error) throw mapOmniError(res.status === 200 ? json.error?.code ?? 400 : res.status, json.error?.message ?? `HTTP ${res.status}`);
    return json;
  }

  async generate(req: VideoRequest): Promise<VideoResult> {
    const seconds = Math.max(4, Math.min(15, Math.round(req.seconds)));
    let it = await this.call("/interactions", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        input: [
          { type: "image", data: req.image.bytes.toString("base64"), mime_type: req.image.mime },
          { type: "text", text: req.prompt.slice(0, 4000) },
        ],
        response_format: { type: "video", aspect_ratio: req.aspectRatio, duration: `${seconds}s`, delivery: "inline" },
        background: true,
      }),
    });
    if (!it.id) throw new ProviderError("transient", "Google did not return a job id");
    const id = it.id;
    const deadline = Date.now() + (this.opts.timeoutMs ?? 10 * 60_000);
    while (!DONE.has(it.status ?? "")) {
      if (Date.now() > deadline) throw new ProviderError("timeout", "Google took too long to make the video");
      if (req.onWait && !(await req.onWait())) throw new ProviderError("transient", "Job lease lost while waiting for the video");
      await sleep(this.opts.pollMs ?? 6_000);
      it = await this.call(`/interactions/${encodeURIComponent(id)}`);
    }
    if (it.status !== "completed") throw new ProviderError(it.status === "incomplete" ? "moderation" : "transient", `Google video ${it.status}`);
    this.lastUsage = it.usage;
    const video = it.steps?.filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).find((c) => c.type === "video");
    if (!video) {
      const text = it.steps?.flatMap((s) => s.content ?? []).find((c) => c.type === "text" && c.text)?.text ?? "";
      throw /safety|policy|cannot|can't|unable/i.test(text) ? new ProviderError("moderation", "Google's safety system declined this video") : new ProviderError("transient", "Google returned no video");
    }
    let bytes: Buffer;
    if (video.data) bytes = Buffer.from(video.data, "base64");
    else if (video.uri) {
      const r = await (this.opts.fetch ?? fetch)(video.uri, { headers: { "x-goog-api-key": this.opts.apiKey } });
      if (!r.ok) throw new ProviderError("transient", `Video download failed (HTTP ${r.status})`);
      bytes = Buffer.from(await r.arrayBuffer());
    } else throw new ProviderError("transient", "Google returned an empty video");
    const [w, h] = req.aspectRatio === "16:9" ? [1280, 720] : [720, 1280];
    return { bytes, mime: video.mime_type || "video/mp4", provider: this.name, model: this.model, width: w, height: h };
  }
}
