// Seed defaults for the commercial catalog. The database is authoritative at runtime;
// admin edits there are never overwritten by re-seeding (seed only inserts missing rows).

export type PlanKey = "free" | "creator" | "pro" | "agency";
export type Studio = "character" | "scene" | "mixer" | "ugc_ads" | "product" | "content";
export type ReleaseState = "planned" | "coming_soon" | "beta" | "live" | "paused";

export const PLAN_RANK: Record<PlanKey, number> = { free: 0, creator: 1, pro: 2, agency: 3 };

export const STUDIOS: Array<{ key: Studio; name: string; blurb: string }> = [
  { key: "character", name: "Character", blurb: "Consistent people and personas from your references" },
  { key: "scene", name: "Scene", blurb: "Place characters in new environments" },
  { key: "mixer", name: "Image Mixer", blurb: "Combine people, products, outfits and backgrounds" },
  { key: "ugc_ads", name: "UGC & Ads", blurb: "Illustrative ad concepts and creative variations" },
  { key: "product", name: "Product", blurb: "Product photography and mockups" },
  { key: "content", name: "Content", blurb: "Thumbnails, social posts and storyboards" },
];

export type FeatureSeed = {
  key: string;
  toolNumber: number | null;
  name: string;
  studio: Studio;
  phase: 1 | 2 | 3 | 4;
  minTier: PlanKey;
  releaseState: ReleaseState;
  description: string;
};

// Phase-1 and Phase-2 tools start as `beta` (allowlisted users + admins). They are flipped to `live` by an admin
// only after the real-provider gate passes. Phase 2 tools are teasers; phases 3-4 are roadmap only.
const p1: ReleaseState = "beta";
const p2: ReleaseState = "beta"; // Phase 2 tools implemented 2026-11-12 (beta until each passes a real-provider check)
const p34: ReleaseState = "beta"; // Phase 3/4 tools implemented 2026-11-12

export const FEATURES: FeatureSeed[] = [
  { key: "character_angles", toolNumber: 1, name: "Character Angle Generator", studio: "character", phase: 1, minTier: "creator", releaseState: p1, description: "Turn one portrait into front, profile, three-quarter, high and low views." },
  { key: "environment_switch", toolNumber: 2, name: "Environment & Lifestyle", studio: "scene", phase: 1, minTier: "creator", releaseState: p1, description: "Place your character in new locations and lifestyle scenes." },
  { key: "reference_mixer", toolNumber: 3, name: "Multi-Reference Image Mixer", studio: "mixer", phase: 1, minTier: "pro", releaseState: p1, description: "Combine a character, product, outfit and background into one scene." },
  { key: "expressions", toolNumber: 4, name: "Facial Expression Studio", studio: "character", phase: 2, minTier: "creator", releaseState: p2, description: "Generate an expression sheet from one portrait." },
  { key: "outfit_swap", toolNumber: 5, name: "Outfit & Style Switcher", studio: "character", phase: 2, minTier: "creator", releaseState: p2, description: "Dress your character in a reference outfit or described look." },
  { key: "style_transform", toolNumber: 6, name: "Character Style Transformer", studio: "character", phase: 2, minTier: "creator", releaseState: p2, description: "Re-render a photo in an artistic style." },
  { key: "poses", toolNumber: 7, name: "Pose Generator", studio: "character", phase: 2, minTier: "creator", releaseState: p2, description: "Pose variations of a saved character." },
  { key: "headshots", toolNumber: 8, name: "Professional Headshot Factory", studio: "character", phase: 2, minTier: "creator", releaseState: p2, description: "Professional headshots in curated styles." },
  { key: "ai_twin", toolNumber: 9, name: "AI Twin / Identity Profile", studio: "character", phase: 2, minTier: "pro", releaseState: p2, description: "A reusable identity profile built from several consented photos." },
  { key: "character_interactions", toolNumber: 10, name: "Character Interaction Studio", studio: "scene", phase: 4, minTier: "agency", releaseState: p34, description: "Group scenes with two or three consented character profiles." },
  { key: "ugc_ads", toolNumber: 11, name: "UGC Ad Creative Factory", studio: "ugc_ads", phase: 1, minTier: "pro", releaseState: p1, description: "Illustrative UGC-style ad concepts featuring your product." },
  { key: "thumbnails", toolNumber: 12, name: "Thumbnail Generator", studio: "content", phase: 2, minTier: "pro", releaseState: p2, description: "Thumbnail compositions with editable text overlay." },
  { key: "social_content", toolNumber: 13, name: "Social Media Content Factory", studio: "content", phase: 2, minTier: "pro", releaseState: p2, description: "Post, story and carousel cover assets." },
  { key: "testimonial_layouts", toolNumber: 14, name: "Testimonial Scene Creator", studio: "ugc_ads", phase: 3, minTier: "pro", releaseState: p34, description: "Labeled layouts for verified customer quotes with licensed photos." },
  { key: "influencer_campaigns", toolNumber: 15, name: "Influencer Brand Campaigns", studio: "ugc_ads", phase: 3, minTier: "agency", releaseState: p34, description: "Campaign series with a consented virtual model and brand assets." },
  { key: "memes", toolNumber: 16, name: "AI Meme Creator", studio: "content", phase: 2, minTier: "creator", releaseState: p2, description: "Humor layouts starring your character." },
  { key: "before_after", toolNumber: 17, name: "Before/After Creator", studio: "content", phase: 3, minTier: "pro", releaseState: p34, description: "Clearly labeled concept transformation comparisons." },
  { key: "ad_variations", toolNumber: 18, name: "Ad Variation Generator", studio: "ugc_ads", phase: 3, minTier: "pro", releaseState: p34, description: "Alternative angles and layouts for an existing creative." },
  { key: "fashion_model", toolNumber: 19, name: "AI Fashion Model Studio", studio: "product", phase: 3, minTier: "agency", releaseState: p34, description: "Fashion scenes with licensed characters; fit is illustrative." },
  { key: "product_lifestyle", toolNumber: 20, name: "Product Lifestyle Photography", studio: "product", phase: 3, minTier: "pro", releaseState: p34, description: "Lifestyle images from a product photo." },
  { key: "digital_mockups", toolNumber: 21, name: "Digital Product Mockup Builder", studio: "product", phase: 3, minTier: "pro", releaseState: p34, description: "Device, box and bundle displays for digital products." },
  { key: "product_demonstrator", toolNumber: 22, name: "Virtual Product Demonstrator", studio: "product", phase: 3, minTier: "pro", releaseState: p34, description: "Illustrative product-in-hand scenes." },
  { key: "brand_mascots", toolNumber: 23, name: "Brand Mascot Factory", studio: "character", phase: 3, minTier: "pro", releaseState: p34, description: "A reusable fictional mascot reference library." },
  { key: "marketplace_images", toolNumber: 24, name: "Marketplace Image Optimizer", studio: "product", phase: 3, minTier: "pro", releaseState: p34, description: "Product image variants sized to marketplace specifications." },
  { key: "storyboards", toolNumber: 25, name: "Storyboard Generator", studio: "content", phase: 4, minTier: "agency", releaseState: p34, description: "6 to 12 scene storyboards from a brief." },
  { key: "video_prep", toolNumber: 26, name: "AI Character Video Preparation", studio: "content", phase: 4, minTier: "agency", releaseState: p34, description: "Consistent still frames and prompts for video tools (not video generation)." },
  { key: "image_to_prompt", toolNumber: 27, name: "Image-to-Prompt Analyzer", studio: "mixer", phase: 4, minTier: "pro", releaseState: p34, description: "Structured, editable prompts from a source image." },
  { key: "restore_enhance", toolNumber: 28, name: "Photo Restoration & Enhancement", studio: "scene", phase: 4, minTier: "creator", releaseState: p34, description: "Repair and enhance damaged portraits, with stated limitations." },
  { key: "scene_recreation", toolNumber: 29, name: "Scene Recreation", studio: "scene", phase: 4, minTier: "agency", releaseState: p34, description: "Original recreations inspired by a source composition." },
  { key: "batch_campaigns", toolNumber: 30, name: "Batch Campaign Generator", studio: "ugc_ads", phase: 4, minTier: "agency", releaseState: p34, description: "Queued multi-format images from a campaign brief." },
  // Cross-cutting capabilities (not one of the 30 tool IDs).
  { key: "image_edit", toolNumber: null, name: "Image Editor", studio: "mixer", phase: 1, minTier: "creator", releaseState: "beta", description: "Edit, enhance, upscale, expand or remove the background of any image." },
  { key: "photoshoot", toolNumber: null, name: "One-Click Photoshoot", studio: "character", phase: 1, minTier: "creator", releaseState: p1, description: "Many varied scenes of one character from a preset recipe." },
];

export type PlanSeed = {
  key: PlanKey;
  displayName: string;
  description: string;
  monthlyCents: number;
  annualCents: number;
  monthlyCredits: number;
  seatCap: number;
  maxConcurrentJobs: number;
  maxJobsPerDay: number;
  maxOutputsPerJob: number;
  maxLongEdgePx: number;
  watermark: boolean;
  allowsPhotoshoot: boolean;
  allowsTopups: boolean;
};

export const PLANS: PlanSeed[] = [
  { key: "free", displayName: "Free", description: "Try it free with a few watermarked test images. No card needed.", monthlyCents: 0, annualCents: 0, monthlyCredits: 0, seatCap: 1, maxConcurrentJobs: 1, maxJobsPerDay: 10, maxOutputsPerJob: 2, maxLongEdgePx: 1024, watermark: true, allowsPhotoshoot: false, allowsTopups: false },
  { key: "creator", displayName: "Creator", description: "For individual creators: personal character and scene studios.", monthlyCents: 1900, annualCents: 19000, monthlyCredits: 200, seatCap: 1, maxConcurrentJobs: 2, maxJobsPerDay: 100, maxOutputsPerJob: 4, maxLongEdgePx: 1536, watermark: false, allowsPhotoshoot: true, allowsTopups: true },
  { key: "pro", displayName: "Pro", description: "For marketers and sellers: mixer, UGC and product tools as they ship.", monthlyCents: 4900, annualCents: 49000, monthlyCredits: 650, seatCap: 1, maxConcurrentJobs: 4, maxJobsPerDay: 300, maxOutputsPerJob: 8, maxLongEdgePx: 2048, watermark: false, allowsPhotoshoot: true, allowsTopups: true },
  { key: "agency", displayName: "Agency", description: "For teams: everything in Pro plus agency tools as they ship.", monthlyCents: 9900, annualCents: 99000, monthlyCredits: 1500, seatCap: 3, maxConcurrentJobs: 8, maxJobsPerDay: 800, maxOutputsPerJob: 12, maxLongEdgePx: 2048, watermark: false, allowsPhotoshoot: true, allowsTopups: true },
];

export const CREDIT_RULES: Array<{ key: string; label: string; credits: number; perOutputs: number }> = [
  { key: "standard", label: "Standard image (no references)", credits: 2, perOutputs: 1 },
  { key: "high_quality", label: "High quality image", credits: 5, perOutputs: 1 },
  { key: "reference_edit", label: "Reference edit, one input", credits: 3, perOutputs: 1 },
  { key: "multi_reference", label: "Multi-reference composition (2-4 inputs)", credits: 4, perOutputs: 1 },
  { key: "identity_strict", label: "Advanced identity-preserving generation", credits: 5, perOutputs: 1 },
  { key: "angle_sheet", label: "Character angle sheet", credits: 12, perOutputs: 4 },
  { key: "photoshoot", label: "One-click photoshoot", credits: 36, perOutputs: 12 },
  { key: "upscale", label: "Upscale / enhance", credits: 2, perOutputs: 1 },
];

export const TOPUP_PACKS: Array<{ key: string; displayName: string; priceCents: number; credits: number }> = [
  { key: "small", displayName: "Small", priceCents: 1200, credits: 100 },
  { key: "growth", displayName: "Growth", priceCents: 4900, credits: 500 },
  { key: "studio", displayName: "Studio", priceCents: 9900, credits: 1200 },
];

export const CONSENT_STATEMENT_VERSION = "2026-11-11";
export const CONSENT_STATEMENTS: Record<string, string> = {
  self: "I am the person shown in this image, and I consent to it being processed to create AI images in my private library.",
  third_party_with_permission:
    "I have the explicit, documented permission of every identifiable person in this image to upload it and create AI images of them.",
  no_identifiable_people: "This image contains no identifiable people, and I own it or have the right to use it.",
  owned_product_or_asset: "I own this product, design or asset, or have the right to use it for this purpose.",
};
