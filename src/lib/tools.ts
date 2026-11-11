// UI + server definitions for implemented generator tools. Client-safe (no secrets).
import type { AspectRatio, Quality, ReferenceRole } from "@/server/providers/types";

export type Slot = { role: ReferenceRole; label: string; hint: string; required: boolean; uploadKind: "character" | "product" | "outfit" | "background" };
export type Preset = { key: string; label: string; prompt: string };

export type ToolDef = {
  key: string;
  title: string;
  tagline: string;
  instructions: string[];
  examples: string[];
  warnings: string[];
  slots: Slot[];
  presetLabel: string;
  presets: Preset[];
  /** "shots": each selected preset becomes its own output. "single": presets are style chips merged into one prompt. */
  presetMode: "shots" | "single";
  minPresets: number;
  maxPresets: number;
  defaultPresets: string[];
  defaultAspect: AspectRatio;
  allowVariations: boolean; // outputs per shot
  promptPlaceholder: string;
  promptRequired: boolean;
  creditRule: "auto" | "angle_sheet" | "photoshoot";
};

export const ASPECT_RATIOS: AspectRatio[] = ["1:1", "4:5", "9:16", "16:9", "3:2"];
export const QUALITIES: Quality[] = ["standard", "high"];

const characterSlot: Slot = { role: "character", label: "Character", hint: "A clear, well-lit photo of the person (you, or someone who gave permission).", required: true, uploadKind: "character" };

export const TOOLS: Record<string, ToolDef> = {
  character_angles: {
    key: "character_angles",
    title: "Character Angle Generator",
    tagline: "One portrait in, a set of consistent camera angles out.",
    instructions: ["Pick a saved character or upload one clear portrait.", "Choose the angles you need (each angle is one image).", "Review the credit quote, then generate."],
    examples: ["Reference sheet for a recurring brand persona", "Profile and three-quarter views for thumbnails", "Consistent angles before a photoshoot"],
    warnings: ["Likeness is approximate. Faces, hands and fine details can drift between angles; regenerate any view that misses."],
    slots: [characterSlot],
    presetLabel: "Angles",
    presets: [
      { key: "front", label: "Front", prompt: "straight-on front view, eye-level camera, face fully visible" },
      { key: "profile", label: "Side profile", prompt: "clean side profile view, camera at 90 degrees to the face" },
      { key: "three_quarter", label: "Three-quarter", prompt: "three-quarter view, face turned about 45 degrees from camera" },
      { key: "high", label: "High angle", prompt: "high-angle shot looking down at the subject from above" },
      { key: "low", label: "Low angle", prompt: "low-angle shot looking up at the subject" },
      { key: "back_three_quarter", label: "Over-shoulder", prompt: "over-the-shoulder rear three-quarter view" },
    ],
    presetMode: "shots",
    minPresets: 1,
    maxPresets: 6,
    defaultPresets: ["front", "profile", "three_quarter", "low"],
    defaultAspect: "4:5",
    allowVariations: false,
    promptPlaceholder: "Optional: wardrobe, lighting or background, e.g. 'plain light-grey studio backdrop, soft key light'",
    promptRequired: false,
    creditRule: "angle_sheet",
  },
  environment_switch: {
    key: "environment_switch",
    title: "Environment & Lifestyle",
    tagline: "Put your character into new places and lifestyle moments.",
    instructions: ["Choose your character.", "Pick one or more scenes (each scene is one image) or describe your own.", "Adjust aspect ratio and quality, then generate."],
    examples: ["Coffee shop content for a creator brand", "Travel and outdoor lifestyle shots", "Home-office scenes for a coach"],
    warnings: ["Scenes are synthetic. Do not present them as real events or locations you visited."],
    slots: [characterSlot, { role: "background", label: "Background (optional)", hint: "Optional photo of a place you have the right to use.", required: false, uploadKind: "background" }],
    presetLabel: "Scenes",
    presets: [
      { key: "cafe", label: "Cozy café", prompt: "sitting at a window table in a cozy café, warm morning light, latte on the table" },
      { key: "office", label: "Modern office", prompt: "in a bright modern office with plants, working at a laptop" },
      { key: "beach", label: "Beach golden hour", prompt: "walking on a beach at golden hour, gentle breeze, warm backlight" },
      { key: "city", label: "City street", prompt: "on a lively city street at dusk, bokeh lights in the background" },
      { key: "gym", label: "Gym", prompt: "in a clean modern gym, athletic wear, energetic natural pose" },
      { key: "kitchen", label: "Home kitchen", prompt: "in a sunlit home kitchen preparing a healthy meal" },
      { key: "studio", label: "Podcast studio", prompt: "in a podcast studio with a microphone and soft colored lighting" },
      { key: "mountain", label: "Mountain trail", prompt: "on a mountain trail with a scenic valley behind, outdoor gear" },
    ],
    presetMode: "shots",
    minPresets: 0,
    maxPresets: 4,
    defaultPresets: ["cafe"],
    defaultAspect: "4:5",
    allowVariations: true,
    promptPlaceholder: "Describe the scene or add details, e.g. 'wearing a navy blazer, laughing naturally'",
    promptRequired: false,
    creditRule: "auto",
  },
  reference_mixer: {
    key: "reference_mixer",
    title: "Multi-Reference Image Mixer",
    tagline: "Combine a person, product, outfit and background in one scene.",
    instructions: ["Fill the slots you need: Character, Product/Object, Outfit, Background. At least two.", "Describe how they should come together.", "Generate and regenerate until the composition works."],
    examples: ["Creator holding your product in their kitchen", "Model wearing a reference jacket in a city scene", "Product placed in a specific room"],
    warnings: ["Product shape, labels, logos and text may not be reproduced exactly. Check every output before using it commercially."],
    slots: [
      { ...characterSlot, required: false },
      { role: "product", label: "Product / Object", hint: "A product or object you own or have rights to.", required: false, uploadKind: "product" },
      { role: "outfit", label: "Outfit", hint: "Clothing reference (flat lay or worn).", required: false, uploadKind: "outfit" },
      { role: "background", label: "Background", hint: "A place or setting you have the right to use.", required: false, uploadKind: "background" },
    ],
    presetLabel: "Style",
    presets: [
      { key: "ugc_phone", label: "UGC phone photo", prompt: "casual smartphone photo style, natural imperfect framing" },
      { key: "editorial", label: "Editorial", prompt: "polished editorial photography, magazine lighting" },
      { key: "studio_clean", label: "Clean studio", prompt: "clean seamless studio backdrop, softbox lighting" },
      { key: "lifestyle", label: "Lifestyle", prompt: "authentic lifestyle photography, candid moment" },
    ],
    presetMode: "single",
    minPresets: 0,
    maxPresets: 2,
    defaultPresets: ["lifestyle"],
    defaultAspect: "4:5",
    allowVariations: true,
    promptPlaceholder: "e.g. 'The woman holds the skincare bottle near her face in a bright bathroom, smiling at the camera'",
    promptRequired: true,
    creditRule: "auto",
  },
  ugc_ads: {
    key: "ugc_ads",
    title: "UGC Ad Creative Factory",
    tagline: "Illustrative UGC-style ad concepts for your product.",
    instructions: ["Add your product (required) and optionally a character.", "Pick ad angles (each angle is one concept image).", "Describe the product and audience, then generate."],
    examples: ["Unboxing concept for a skincare launch", "Problem/solution creative for a gadget", "Testimonial-style framing for internal concept review"],
    warnings: [
      "These are synthetic, illustrative concepts. Never present them as real customers, real reviews or real results.",
      "Label synthetic ads where platform rules or law require it. Product details and text may be inaccurate.",
    ],
    slots: [
      { role: "product", label: "Product", hint: "Your product photo (required).", required: true, uploadKind: "product" },
      { ...characterSlot, required: false, hint: "Optional creator/model who consented to appear in ads." },
    ],
    presetLabel: "Ad angles",
    presets: [
      { key: "unboxing", label: "Unboxing", prompt: "UGC unboxing moment, hands opening the package, excited natural expression" },
      { key: "problem_solution", label: "Problem → solution", prompt: "relatable everyday problem moment with the product shown as the solution" },
      { key: "in_use", label: "Product in use", prompt: "person naturally using the product in a real-life setting" },
      { key: "selfie_review", label: "Selfie-style concept", prompt: "selfie-style creator photo holding the product toward the camera" },
      { key: "flatlay", label: "Flat lay", prompt: "aesthetic top-down flat lay with complementary props" },
      { key: "before_routine", label: "Daily routine", prompt: "product as part of a morning routine on a bathroom or desk counter" },
    ],
    presetMode: "shots",
    minPresets: 1,
    maxPresets: 6,
    defaultPresets: ["unboxing", "in_use"],
    defaultAspect: "9:16",
    allowVariations: true,
    promptPlaceholder: "Product + audience, e.g. 'vegan vitamin C serum for busy women 30-45, minimal beige branding'",
    promptRequired: true,
    creditRule: "auto",
  },
  photoshoot: {
    key: "photoshoot",
    title: "One-Click Photoshoot",
    tagline: "A full set of varied photos of your character from one recipe.",
    instructions: ["Pick a saved character.", "Choose a photoshoot recipe.", "Confirm the total quote; images arrive as they finish and can be downloaded as a ZIP."],
    examples: ["A month of social content in one go", "Personal brand photos for a website", "Dating/profile-style variety pack"],
    warnings: ["Some images in a set may miss on likeness or details; you are charged only for delivered images."],
    slots: [characterSlot],
    presetLabel: "Recipe",
    presets: [
      { key: "personal_brand", label: "Personal brand (12)", prompt: "personal_brand" },
      { key: "lifestyle_mix", label: "Lifestyle mix (12)", prompt: "lifestyle_mix" },
      { key: "professional", label: "Professional (6)", prompt: "professional" },
    ],
    presetMode: "single",
    minPresets: 1,
    maxPresets: 1,
    defaultPresets: ["personal_brand"],
    defaultAspect: "4:5",
    allowVariations: false,
    promptPlaceholder: "Optional styling notes applied to every photo, e.g. 'earth-tone wardrobe, natural makeup'",
    promptRequired: false,
    creditRule: "photoshoot",
  },
};

export const PHOTOSHOOT_RECIPES: Record<string, string[]> = {
  personal_brand: [
    "confident portrait in a modern office, arms relaxed, soft window light",
    "speaking on a small stage with a microphone, audience bokeh",
    "working on a laptop in a stylish café",
    "walking outdoors in a city, candid smile",
    "headshot against a neutral textured wall",
    "writing in a notebook at a wooden desk with plants",
    "seated interview-style shot in a podcast studio",
    "laughing with arms crossed, bright studio backdrop",
    "holding a coffee cup on a sunny balcony",
    "presenting at a whiteboard in a meeting room",
    "relaxed pose on a sofa in a minimalist living room",
    "golden-hour outdoor portrait with trees behind",
  ],
  lifestyle_mix: [
    "morning coffee by a sunny kitchen window",
    "yoga pose on a mat in a bright room",
    "browsing a farmers market with a tote bag",
    "cycling through a park path",
    "reading a book in a cozy armchair",
    "cooking a colorful meal",
    "beach walk at sunset",
    "city rooftop at dusk",
    "hiking on a forest trail",
    "picnic on a blanket in a meadow",
    "casual mirror selfie in a stylish outfit",
    "evening dinner at a candlelit restaurant",
  ],
  professional: [
    "corporate headshot, light-grey backdrop, navy blazer",
    "standing in a glass-walled office lobby",
    "seated at a conference table, attentive expression",
    "arms crossed, confident, modern workspace",
    "speaking on a video call at a desk",
    "outdoor business portrait with city skyline",
  ],
};

/** Identity Lock levels → prompt clauses (and input_fidelity=high on models that support it, for "strict"). */
export const IDENTITY_LOCK: Record<"loose" | "balanced" | "strict", { label: string; help: string; clause: string }> = {
  loose: { label: "Loose", help: "More creative freedom; likeness may vary more.", clause: "Keep the person recognizably similar to the character reference." },
  balanced: { label: "Balanced", help: "Good default for most scenes.", clause: "Preserve the character's identity from the reference: face shape, eyes, nose, hairline, hair color and skin tone." },
  strict: {
    label: "Strict",
    help: "Prioritizes likeness over scene creativity. Costs more. Not guaranteed.",
    clause: "Preserve the character's identity from the reference as exactly as possible: facial structure, eye shape and color, nose, lips, hairline, hairstyle, skin tone, freckles, moles and age. Do not beautify or alter facial features.",
  },
};
