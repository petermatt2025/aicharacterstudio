import "server-only";
import OpenAI, { toFile, APIError, APIConnectionTimeoutError, APIConnectionError } from "openai";
import { env } from "../env";
import { sha256 } from "../crypto";
import { OPENAI_MODEL_CAPABILITIES, providerSize } from "./capabilities";
import { ProviderError, type GenerationRequest, type GenerationResult, type ImageProvider, type ProviderCapabilities } from "./types";

type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { image_tokens?: number; text_tokens?: number } };

export function estimateOpenAICostUsd(usage: Usage): number | null {
  const e = env();
  if (e.OPENAI_IMAGE_OUTPUT_USD_PER_MTOK === undefined || e.OPENAI_IMAGE_INPUT_USD_PER_MTOK === undefined) return null;
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
  const textIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageIn);
  const imageInRate = e.OPENAI_IMAGE_INPUT_IMAGE_USD_PER_MTOK ?? e.OPENAI_IMAGE_INPUT_USD_PER_MTOK;
  return (textIn * e.OPENAI_IMAGE_INPUT_USD_PER_MTOK + imageIn * imageInRate + (usage.output_tokens ?? 0) * e.OPENAI_IMAGE_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;
  private caps: ProviderCapabilities;

  private stream: boolean;

  constructor(opts: { apiKey: string; model: string; timeoutMs: number; baseURL?: string; fetch?: typeof fetch; stream?: boolean }) {
    const caps = OPENAI_MODEL_CAPABILITIES[opts.model];
    if (!caps) throw new Error(`Model ${opts.model} is not in the verified capability map`);
    this.caps = caps;
    this.model = opts.model;
    this.stream = !!opts.stream;
    // Retries are handled by the job queue (idempotent per output), not the SDK.
    this.client = new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 0, baseURL: opts.baseURL, fetch: opts.fetch });
  }

  async capabilities() {
    return this.caps;
  }

  async generate(input: GenerationRequest): Promise<GenerationResult> {
    const caps = this.caps;
    if (input.referenceImages.length > caps.maxReferenceImages) throw new ProviderError("capability", `Model accepts at most ${caps.maxReferenceImages} reference images`);
    if (input.requestedOutputs > caps.maxOutputsPerCall) throw new ProviderError("capability", `Model returns at most ${caps.maxOutputsPerCall} images per call`);
    const size = providerSize(input.aspectRatio, input.quality, caps);
    const quality = input.quality === "high" ? "high" : "medium";
    const safety_identifier = sha256(`acs:${input.userId}`).slice(0, 32); // hashed, no PII
    const warnings: string[] = [];
    let res: OpenAI.Images.ImagesResponse;
    try {
      if (input.referenceImages.length > 0) {
        const files = await Promise.all(
          input.referenceImages.map((r, i) => toFile(r.bytes, `ref-${i}.${r.mime === "image/png" ? "png" : r.mime === "image/webp" ? "webp" : "jpg"}`, { type: r.mime })),
        );
        const params: OpenAI.Images.ImageEditParamsNonStreaming = {
          model: this.model,
          image: files,
          prompt: input.prompt,
          n: input.requestedOutputs,
          size,
          quality,
          output_format: "png",
          safety_identifier,
        };
        if (caps.inputFidelity) params.input_fidelity = input.options?.identityStrength === "strict" ? "high" : "low";
        res = this.stream && input.requestedOutputs === 1
          ? await collect(await this.client.images.edit({ ...params, stream: true, partial_images: 2 }))
          : await this.client.images.edit(params);
      } else {
        const params: OpenAI.Images.ImageGenerateParamsNonStreaming = { model: this.model, prompt: input.prompt, n: input.requestedOutputs, size, quality, output_format: "png", moderation: "auto", safety_identifier };
        res = this.stream && input.requestedOutputs === 1
          ? await collect(await this.client.images.generate({ ...params, stream: true, partial_images: 2 }))
          : await this.client.images.generate(params);
      }
    } catch (e) {
      throw mapOpenAIError(e);
    }
    const outputs = (res.data ?? []).filter((d) => d.b64_json).map((d) => ({ bytes: Buffer.from(d.b64_json!, "base64"), mimeType: "image/png" }));
    if (outputs.length === 0) throw new ProviderError("transient", "Provider returned no images");
    if (outputs.length < input.requestedOutputs) warnings.push(`Provider returned ${outputs.length} of ${input.requestedOutputs} images`);
    const usage = (res.usage ?? {}) as Usage;
    return {
      outputs,
      provider: this.name,
      model: this.model,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        image_input_tokens: usage.input_tokens_details?.image_tokens ?? 0,
        text_input_tokens: usage.input_tokens_details?.text_tokens ?? 0,
        size,
        quality,
      },
      providerCostUsdEstimate: estimateOpenAICostUsd(usage),
      warnings,
    };
  }
}

/** Reduce a streamed response to the same shape as a non-streamed one (final image + usage; partials discarded). */
async function collect(stream: AsyncIterable<OpenAI.Images.ImageEditStreamEvent | OpenAI.Images.ImageGenStreamEvent>): Promise<OpenAI.Images.ImagesResponse> {
  for await (const ev of stream) {
    if (ev.type === "image_edit.completed" || ev.type === "image_generation.completed") {
      return { created: ev.created_at, data: [{ b64_json: ev.b64_json }], usage: ev.usage as OpenAI.Images.ImagesResponse["usage"] };
    }
  }
  throw new ProviderError("transient", "Image stream ended without a completed image");
}

export function mapOpenAIError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof APIConnectionTimeoutError) return new ProviderError("timeout", "Image provider timed out");
  if (e instanceof APIError) {
    const code = (e.code ?? (e.error as { code?: string } | undefined)?.code ?? "") as string;
    if (code === "moderation_blocked" || /safety system|content policy/i.test(e.message)) return new ProviderError("moderation", "The request was blocked by the provider's safety system");
    const type = ((e.error as { type?: string } | undefined)?.type ?? (e as { type?: string }).type ?? "") as string;
    if (e.status === 429 && (/insufficient_quota|credit_balance_exhausted|billing_hard_limit/.test(`${code} ${type}`) || /quota|billing|no credits remaining/i.test(e.message))) {
      return new ProviderError("auth", "Image provider account is out of credit");
    }
    if (e.status === 429) return new ProviderError("rate_limit", "Image provider is rate limiting requests");
    if (e.status === 401 || e.status === 403) return new ProviderError("auth", "Image provider rejected our credentials");
    if (e.status && e.status >= 500) return new ProviderError("transient", `Image provider error (${e.status})`);
    if (e.status === 400) return new ProviderError("invalid_request", `Provider rejected the request: ${e.message.slice(0, 200)}`);
  }
  if (e instanceof APIConnectionError) return new ProviderError("transient", "Could not reach the image provider");
  return new ProviderError("transient", (e as Error)?.message?.slice(0, 200) ?? "Unknown provider error");
}
