export const ASSET_KINDS = ["character", "product", "outfit", "background", "style", "other"] as const;
export type UploadKind = (typeof ASSET_KINDS)[number];
export type ConsentSubject = "self" | "third_party_with_permission" | "no_identifiable_people" | "owned_product_or_asset";

/** Which consent statements are acceptable per upload kind. People-bearing kinds need person consent. */
export const ALLOWED_CONSENT: Record<UploadKind, ConsentSubject[]> = {
  character: ["self", "third_party_with_permission"],
  product: ["owned_product_or_asset", "no_identifiable_people", "self", "third_party_with_permission"],
  outfit: ["owned_product_or_asset", "no_identifiable_people", "self", "third_party_with_permission"],
  background: ["no_identifiable_people", "owned_product_or_asset", "self", "third_party_with_permission"],
  style: ["no_identifiable_people", "owned_product_or_asset", "self", "third_party_with_permission"],
  other: ["no_identifiable_people", "owned_product_or_asset", "self", "third_party_with_permission"],
};

export const CONSENT_LABELS: Record<ConsentSubject, string> = {
  self: "This is me, and I consent to AI images of myself.",
  third_party_with_permission: "This is someone else, and I have their explicit permission.",
  no_identifiable_people: "No identifiable people, and I have the right to use it.",
  owned_product_or_asset: "I own this product/asset or have the right to use it.",
};
