import "server-only";
import { ProviderError, type AspectRatio, type GenerationRequest, type GenerationResult, type ImageProvider, type ProviderCapabilities } from "./types";

/**
 * Google Gemini image models via the native REST API (generateContent, responseModalities IMAGE).
 * Model ids verified against the live models list on 2026-11-12. One image per call; the worker
 * runs a job's images in parallel. `imageSize` is only sent to models that support it (Gemini 3+).
 */
const BASE: ProviderCapabilities = { textToImage: true, imageEdit: true, maxReferenceImages: 4, maxOutputsPerCall: 1, arbitrarySizes: false, inputFidelity: false, mask: false, seed: false };

export const GEMINI_MODELS: Record<string, { caps: ProviderCapabilities; imageSize: boolean }> = {
  "gemini-3.1-flash-image": { caps: BASE, imageSize: true },
  "gemini-3.1-flash-image-preview": { caps: BASE, imageSize: true },
  "gemini-3.1-flash-lite-image": { caps: BASE, imageSize: true },
  "gemini-3-pro-image": { caps: BASE, imageSize: true },
  "gemini-3-pro-image-preview": { caps: BASE, imageSize: true },
  "gemini-nano-banana-2.1": { caps: BASE, imageSize: true },
  "gemini-2.5-flash-image": { caps: { ...BASE, maxReferenceImages: 3 }, imageSize: false },
};

const ROLE_LABEL: Record<string, string> = {
  character: "the person (keep their identity, face and features)",
  product: "the product (keep its shape, colors, labels and logo exact)",
  outfit: "the outfit to wear",
  background: "the background / location",
  style: "the visual style reference",
  other: "an additional reference",
};

const BLOCKED = new Set(["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "IMAGE_PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_RECITATION"]);

type Part = { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";
  readonly model: string;
  private cfg: (typeof GEMINI_MODELS)[string];

  constructor(private opts: { apiKey: string; model: string; timeoutMs: number; baseURL?: string; fetch?: typeof fetch }) {
    const cfg = GEMINI_MODELS[opts.model];
    if (!cfg) throw new Error(`Gemini model ${opts.model} is not in the verified model list`);
    this.cfg = cfg;
    this.model = opts.model;
  }

  async capabilities() {
    return this.cfg.caps;
  }

  async generate(input: GenerationRequest): Promise<GenerationResult> {
    const parts: Part[] = [];
    input.referenceImages.forEach((r, i) => {
      parts.push({ text: `Reference image ${i + 1}: ${ROLE_LABEL[r.role] ?? ROLE_LABEL.other}.` });
      parts.push({ inlineData: { mimeType: r.mime, data: r.bytes.toString("base64") } });
    });
    parts.push({ text: input.prompt });

    const imageConfig: Record<string, string> = { aspectRatio: input.aspectRatio satisfies AspectRatio };
    if (this.cfg.imageSize) imageConfig.imageSize = input.quality === "high" ? "2K" : "1K";
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig },
    };

    const url = `${this.opts.baseURL ?? "https://generativelanguage.googleapis.com/v1beta"}/models/${this.model}:generateContent`;
    const doFetch = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(input.options?.timeoutMs ?? this.opts.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new ProviderError("timeout", "Image provider timed out");
      throw new ProviderError("transient", "Could not reach the image provider");
    }

    let json: GeminiResponse = {};
    try {
      json = (await res.json()) as GeminiResponse;
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) throw mapGeminiHttpError(res.status, json.error?.message ?? "", json.error?.status ?? "");

    const usage: Record<string, number> = {
      input_tokens: json.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
    if (json.promptFeedback?.blockReason) throw new ProviderError("moderation", "The request was blocked by the provider's safety system", usage);
    const cand = json.candidates?.[0];
    const img = cand?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
    if (!img) {
      if (cand?.finishReason && BLOCKED.has(cand.finishReason)) throw new ProviderError("moderation", "The request was blocked by the provider's safety system", usage);
      throw new ProviderError("transient", `Provider returned no image (${cand?.finishReason ?? "no candidate"})`, usage);
    }
    const data = img.inlineData?.data ?? img.inline_data!.data;
    const mimeType = img.inlineData?.mimeType ?? img.inline_data?.mime_type ?? "image/png";
    return {
      outputs: [{ bytes: Buffer.from(data, "base64"), mimeType }],
      provider: this.name,
      model: this.model,
      usage,
      providerCostUsdEstimate: null,
      warnings: [],
    };
  }
}

export function mapGeminiHttpError(status: number, message: string, apiStatus: string): ProviderError {
  const short = message.slice(0, 200);
  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID/i.test(message)) return new ProviderError("auth", "Image provider rejected our credentials");
  if (status === 402 || /prepayment|billing|credits are depleted/i.test(message)) return new ProviderError("auth", "Image provider account has no credit");
  if (status === 429) return new ProviderError("rate_limit", "Image provider is rate limiting requests");
  if (status >= 500) return new ProviderError("transient", `Image provider error (${status})`);
  if (/safety|blocked|prohibited/i.test(message)) return new ProviderError("moderation", "The request was blocked by the provider's safety system");
  if (status === 400) return new ProviderError("invalid_request", `Provider rejected the request: ${short || apiStatus}`);
  return new ProviderError("transient", short || `Image provider error (${status})`);
}
