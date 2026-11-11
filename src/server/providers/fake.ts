import "server-only";
import sharp from "sharp";
import { sha256 } from "../crypto";
import { providerSize } from "./capabilities";
import { ProviderError, type GenerationRequest, type GenerationResult, type ImageProvider, type ProviderCapabilities } from "./types";

/**
 * Deterministic fake provider. FOR TESTS AND OFFLINE UI DEVELOPMENT ONLY.
 * env() refuses IMAGE_PROVIDER=fake in production, and every output is stamped "TEST IMAGE".
 * Failure injection for tests: include a marker in the prompt, e.g. "[[fake:transient]]",
 * "[[fake:moderation]]", "[[fake:fail-after:1]]" (fails each call after the first N successful calls per job).
 */
const CAPS: ProviderCapabilities = { textToImage: true, imageEdit: true, maxReferenceImages: 16, maxOutputsPerCall: 10, arbitrarySizes: true, inputFidelity: false, mask: false, seed: true };

export const fakeCalls: Array<{ featureKey: string; prompt: string; refs: number; roles: string[] }> = [];

export class FakeImageProvider implements ImageProvider {
  readonly name = "fake";
  readonly model = "fake-image-1";
  async capabilities() {
    return CAPS;
  }
  async generate(input: GenerationRequest): Promise<GenerationResult> {
    fakeCalls.push({ featureKey: input.featureKey, prompt: input.prompt, refs: input.referenceImages.length, roles: input.referenceImages.map((r) => r.role) });
    const marker = /\[\[fake:([a-z-]+)(?::(\d+))?\]\]/.exec(input.prompt);
    if (marker) {
      const kind = marker[1];
      if (kind === "moderation") throw new ProviderError("moderation", "Blocked by fake safety system");
      if (kind === "transient") throw new ProviderError("transient", "Fake transient failure");
      if (kind === "invalid") throw new ProviderError("invalid_request", "Fake invalid request");
      if (kind === "fail-after") {
        const n = Number(marker[2] ?? 0);
        const callNo = Number(input.options?.callIndex ?? 0);
        if (callNo >= n) throw new ProviderError("invalid_request", "Fake failure after N outputs");
      }
    }
    const [w, h] = providerSize(input.aspectRatio, input.quality, CAPS).split("x").map(Number) as [number, number];
    const hue = parseInt(sha256(input.prompt).slice(0, 6), 16) % 360;
    const outputs = [];
    for (let i = 0; i < input.requestedOutputs; i++) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="100%" height="100%" fill="hsl(${(hue + i * 40) % 360},45%,35%)"/>
        <text x="50%" y="46%" font-family="sans-serif" font-size="${Math.round(w / 14)}" fill="#fff" text-anchor="middle">TEST IMAGE</text>
        <text x="50%" y="56%" font-family="sans-serif" font-size="${Math.round(w / 40)}" fill="#fff" text-anchor="middle">fake provider · ${input.featureKey} · refs ${input.referenceImages.length}</text>
      </svg>`;
      outputs.push({ bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: "image/png" });
    }
    return { outputs, provider: this.name, model: this.model, usage: { input_tokens: 100, output_tokens: 1000 * input.requestedOutputs }, providerCostUsdEstimate: 0.01 * input.requestedOutputs, warnings: [] };
  }
}
