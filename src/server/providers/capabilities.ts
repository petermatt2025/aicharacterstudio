import type { AspectRatio, ProviderCapabilities, Quality } from "./types";

/**
 * Model capability map, verified against the openai SDK v7.55.0 type docs (images.d.ts) on 2026-11-11:
 * - gpt-image-1 was shut down on 2026-10-23 (not listed).
 * - GPT image models accept up to 16 input images on /images/edits; n is 1..10.
 * - gpt-image-2 / 2.5: arbitrary WxH sizes (multiples of 16, ratio 1:3..3:1, <= 3840x2160); omit input_fidelity.
 * - gpt-image-1.5 supports input_fidelity low|high; gpt-image-1-mini only low.
 * Re-verify against https://developers.openai.com/api/docs/guides/image-generation before changing models.
 */
const GPT2: ProviderCapabilities = { textToImage: true, imageEdit: true, maxReferenceImages: 16, maxOutputsPerCall: 10, arbitrarySizes: true, inputFidelity: false, mask: true, seed: false };

export const OPENAI_MODEL_CAPABILITIES: Record<string, ProviderCapabilities> = {
  "gpt-image-2": GPT2,
  "gpt-image-2-2026-04-21": GPT2,
  "gpt-image-2.5-sunburst": GPT2,
  "gpt-image-2.5-sunburst-2026-09-08": GPT2,
  "gpt-image-2.5-flare": GPT2,
  "gpt-image-2.5-flare-2026-09-08": GPT2,
  "gpt-image-1.5": { ...GPT2, arbitrarySizes: false, inputFidelity: true },
  "gpt-image-1-mini": { ...GPT2, arbitrarySizes: false, inputFidelity: false },
};

/** App-level cap on references per request (blueprint: up to 4 initially). */
export const APP_MAX_REFERENCES = 4;

const RATIOS: Record<AspectRatio, [number, number]> = { "1:1": [1, 1], "4:5": [4, 5], "9:16": [9, 16], "16:9": [16, 9], "3:2": [3, 2] };

/** Pick a provider size. Arbitrary-size models get exact ratios (multiples of 16); others snap to the three standard sizes. */
export function providerSize(aspect: AspectRatio, quality: Quality, caps: ProviderCapabilities): string {
  const [rw, rh] = RATIOS[aspect];
  if (!caps.arbitrarySizes) {
    if (rw === rh) return "1024x1024";
    return rw > rh ? "1536x1024" : "1024x1536";
  }
  const long = rw === rh ? (quality === "high" ? 1536 : 1024) : 1536;
  const snap = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return rw >= rh ? `${long}x${snap((long * rh) / rw)}` : `${snap((long * rw) / rh)}x${long}`;
}
