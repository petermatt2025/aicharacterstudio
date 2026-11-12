export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "3:2";
export type Quality = "standard" | "high";
export type ReferenceRole = "character" | "product" | "outfit" | "background" | "style" | "other";

/** Blueprint contract (§5). `references` are asset IDs; the worker resolves them to bytes in `referenceImages`. */
export type GenerationRequest = {
  userId: string;
  workspaceId: string;
  featureKey: string;
  prompt: string;
  references: Array<{ assetId: string; role: ReferenceRole }>;
  referenceImages: Array<{ role: ReferenceRole; bytes: Buffer; mime: string; label?: string }>;
  requestedOutputs: number;
  aspectRatio: AspectRatio;
  quality: Quality;
  maskAssetId?: string;
  options?: { identityStrength?: "loose" | "balanced" | "strict"; timeoutMs?: number; [k: string]: unknown };
};

export type GenerationResult = {
  outputs: Array<{ bytes: Buffer; mimeType: string }>;
  provider: string;
  model: string;
  usage: Record<string, number | string>;
  providerCostUsdEstimate: number | null;
  warnings: string[];
};

export type ProviderCapabilities = {
  textToImage: boolean;
  imageEdit: boolean;
  maxReferenceImages: number;
  maxOutputsPerCall: number;
  arbitrarySizes: boolean;
  inputFidelity: boolean; // supports the input_fidelity parameter
  mask: boolean;
  seed: boolean;
};

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  capabilities(): Promise<ProviderCapabilities>;
  generate(input: GenerationRequest): Promise<GenerationResult>;
}

export type ProviderErrorKind = "moderation" | "rate_limit" | "timeout" | "transient" | "invalid_request" | "auth" | "capability";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly usage: Record<string, number | string> = {},
  ) {
    super(message);
  }
  get retryable() {
    return this.kind === "rate_limit" || this.kind === "timeout" || this.kind === "transient";
  }
}
