// Prompt Builder: pick a situation and a few options, get a strong, editable prompt for any tool.
// Deterministic and free (no extra model call). Client-safe.

export type BuilderGroupKey = "style" | "mood" | "lighting" | "framing" | "wardrobe" | "setting";
export type BuilderOption = { key: string; label: string; text: string };
export type BuilderGroup = { key: BuilderGroupKey; label: string; options: BuilderOption[] };
export type Idea = { label: string; text: string };
export type BuilderChoices = Partial<Record<BuilderGroupKey, string>>;

export const BUILDER_GROUPS: BuilderGroup[] = [
  {
    key: "style",
    label: "Style",
    options: [
      { key: "photoreal", label: "Photorealistic", text: "ultra-realistic photography, natural skin texture, true-to-life colors" },
      { key: "cinematic", label: "Cinematic", text: "cinematic film still, anamorphic look, rich color grading, shallow depth of field" },
      { key: "editorial", label: "Editorial", text: "high-end fashion magazine editorial, polished retouching, bold composition" },
      { key: "ugc", label: "UGC phone photo", text: "casual smartphone photo, authentic and unpolished, natural imperfect framing" },
      { key: "luxury", label: "Luxury", text: "luxury brand aesthetic, refined details, elegant premium feel" },
      { key: "minimal", label: "Clean minimal", text: "clean minimalist composition, lots of negative space, simple neutral palette" },
      { key: "vintage", label: "Vintage film", text: "vintage 35mm film look, subtle grain, warm faded tones" },
      { key: "bright", label: "Bright & airy", text: "bright and airy, pastel tones, soft high-key exposure" },
      { key: "moody", label: "Dark & moody", text: "dark and moody, deep shadows, rich contrast" },
      { key: "bold", label: "Bold & colorful", text: "bold saturated colors, high contrast, punchy and eye-catching" },
    ],
  },
  {
    key: "mood",
    label: "Mood",
    options: [
      { key: "happy", label: "Happy", text: "genuinely happy, warm natural smile" },
      { key: "confident", label: "Confident", text: "confident and self-assured, strong eye contact" },
      { key: "calm", label: "Calm", text: "calm, relaxed and content" },
      { key: "energetic", label: "Energetic", text: "energetic, dynamic and full of life" },
      { key: "serious", label: "Serious", text: "serious and focused" },
      { key: "playful", label: "Playful", text: "playful and fun, a little mischievous" },
      { key: "surprised", label: "Surprised", text: "surprised and excited, wide eyes" },
    ],
  },
  {
    key: "lighting",
    label: "Lighting",
    options: [
      { key: "golden", label: "Golden hour", text: "warm golden-hour sunlight with soft rim light" },
      { key: "window", label: "Soft window light", text: "soft natural window light, gentle shadows" },
      { key: "studio", label: "Studio softbox", text: "professional studio softbox lighting, even and flattering" },
      { key: "neon", label: "Neon night", text: "night scene with colorful neon lights and reflections" },
      { key: "dramatic", label: "Dramatic", text: "dramatic directional light, strong highlights and shadows" },
      { key: "overcast", label: "Soft daylight", text: "soft overcast daylight, no harsh shadows" },
    ],
  },
  {
    key: "framing",
    label: "Framing",
    options: [
      { key: "closeup", label: "Close-up", text: "close-up of the face and shoulders, 85mm lens" },
      { key: "half", label: "Half body", text: "waist-up framing, 50mm lens" },
      { key: "full", label: "Full body", text: "full body in frame, head to toe" },
      { key: "wide", label: "Wide scene", text: "wide environmental shot showing the surroundings, 35mm lens" },
      { key: "low", label: "Low angle", text: "low camera angle looking up, heroic feel" },
      { key: "candid", label: "Candid", text: "candid moment, subject not posing, as if caught naturally" },
    ],
  },
  {
    key: "wardrobe",
    label: "Outfit",
    options: [
      { key: "casual", label: "Casual", text: "casual everyday outfit, jeans and a simple top" },
      { key: "business", label: "Business", text: "smart business outfit, tailored blazer" },
      { key: "streetwear", label: "Streetwear", text: "trendy streetwear, sneakers and layered pieces" },
      { key: "elegant", label: "Elegant", text: "elegant evening outfit" },
      { key: "sporty", label: "Sporty", text: "athletic sportswear" },
      { key: "cozy", label: "Cozy", text: "cozy knitwear and soft comfortable clothes" },
      { key: "summer", label: "Summer", text: "light summer clothes, linen and bright colors" },
    ],
  },
  {
    key: "setting",
    label: "Background",
    options: [
      { key: "studio_plain", label: "Plain studio", text: "plain seamless studio backdrop" },
      { key: "home", label: "Home", text: "stylish modern home interior" },
      { key: "office", label: "Office", text: "bright modern office" },
      { key: "city", label: "City", text: "vibrant city street" },
      { key: "nature", label: "Nature", text: "beautiful natural landscape with greenery" },
      { key: "beach", label: "Beach", text: "sunny beach with turquoise water" },
      { key: "cafe", label: "Café", text: "cozy café with warm interior" },
      { key: "color", label: "Solid color", text: "solid bold color background" },
    ],
  },
];

/** Which option groups make sense per tool (others are hidden to keep the panel short). */
const TOOL_GROUPS: Record<string, BuilderGroupKey[]> = {
  character_angles: ["style", "lighting", "wardrobe", "setting"],
  environment_switch: ["style", "mood", "lighting", "framing", "wardrobe"],
  reference_mixer: ["style", "mood", "lighting", "framing", "setting"],
  ugc_ads: ["style", "mood", "lighting", "framing", "setting"],
  photoshoot: ["style", "lighting", "wardrobe"],
  expressions: ["style", "lighting", "framing", "setting"],
  outfit_swap: ["style", "mood", "lighting", "framing", "setting"],
  style_transform: ["mood", "setting"],
  poses: ["style", "mood", "lighting", "wardrobe", "setting"],
  headshots: ["style", "mood", "lighting", "wardrobe"],
  ai_twin: ["lighting", "wardrobe"],
  thumbnails: ["style", "mood", "setting"],
  social_content: ["style", "mood", "lighting", "setting"],
  memes: ["style", "mood", "setting"],
};

/** Ready-made situations per tool. Text in quotes is rendered as exact on-image text by the text tools. */
export const TOOL_IDEAS: Record<string, Idea[]> = {
  character_angles: [
    { label: "Brand persona sheet", text: "consistent brand persona reference sheet, same outfit and hairstyle in every view" },
    { label: "Casting card", text: "clean casting-card style reference, neutral expression, simple outfit" },
    { label: "Game/story character", text: "character design reference for a story, distinctive outfit kept identical across views" },
  ],
  environment_switch: [
    { label: "Working from a café", text: "working on a laptop in a trendy café, coffee beside the laptop, focused and productive" },
    { label: "Morning routine", text: "relaxed morning routine at home, sunlight through the window, holding a coffee mug" },
    { label: "Travel in Paris", text: "travelling in Paris, Eiffel Tower softly blurred in the background, happy tourist moment" },
    { label: "Speaking on stage", text: "speaking on a conference stage with a microphone, audience lights in the background" },
    { label: "Luxury lifestyle", text: "on the terrace of a luxury hotel overlooking the sea, elegant and relaxed" },
    { label: "Fitness moment", text: "after a workout in a modern gym, water bottle in hand, healthy glow" },
    { label: "Cozy evening", text: "cozy evening on a sofa with a blanket and a book, warm lamp light" },
    { label: "Podcast recording", text: "recording a podcast with a professional microphone and headphones" },
  ],
  reference_mixer: [
    { label: "Holding the product", text: "the person holds the product near their face and smiles at the camera, product label clearly visible" },
    { label: "Product on the table", text: "the product sits on a table in front of the person, who points at it while explaining" },
    { label: "Wearing the outfit", text: "the person wears the reference outfit in the reference background, natural confident pose" },
    { label: "Unboxing scene", text: "the person opens a box revealing the product, excited reaction" },
  ],
  ugc_ads: [
    { label: "Skincare launch", text: "new skincare serum for women 30-45 who want glowing skin with a simple routine" },
    { label: "Fitness supplement", text: "protein supplement for busy people who work out before work" },
    { label: "Tech gadget", text: "portable gadget that makes everyday life easier for remote workers" },
    { label: "Online course", text: "online course for beginners who want to start a side business with AI" },
    { label: "Coffee brand", text: "specialty coffee brand for people who love a calm morning ritual" },
  ],
  photoshoot: [
    { label: "Earth tones", text: "earth-tone wardrobe, natural makeup, warm consistent color grading across the set" },
    { label: "Black & white chic", text: "black and white outfits, chic minimal styling, consistent look across the set" },
    { label: "Bright colors", text: "bright colorful outfits, fun energetic vibe" },
  ],
  expressions: [
    { label: "YouTube reactions", text: "exaggerated reaction faces for YouTube thumbnails, bright solid background" },
    { label: "Sticker pack", text: "sticker-pack style, clean white background, head and shoulders" },
    { label: "Acting headshots", text: "subtle realistic expressions like actor headshots, neutral grey background" },
  ],
  outfit_swap: [
    { label: "Wedding guest", text: "attending a summer wedding as a guest, garden venue" },
    { label: "First day at work", text: "first day at a new corporate job, modern office lobby" },
    { label: "Night out", text: "night out in the city, stylish evening look" },
    { label: "Vacation", text: "on vacation at a tropical resort" },
  ],
  style_transform: [
    { label: "Profile avatar", text: "friendly avatar for social media profiles, simple background" },
    { label: "Channel mascot", text: "fun mascot version for a YouTube channel, waving at the viewer" },
    { label: "Gift portrait", text: "beautiful portrait suitable for framing as a gift" },
  ],
  poses: [
    { label: "Fashion lookbook", text: "fashion lookbook, clean studio, same outfit in every pose" },
    { label: "Fitness poses", text: "fitness instructor poses in sportswear" },
    { label: "Business presenter", text: "business presenter poses for slides and websites" },
  ],
  headshots: [
    { label: "LinkedIn profile", text: "approachable LinkedIn profile photo, trustworthy and friendly" },
    { label: "Executive", text: "executive leadership portrait for a company website" },
    { label: "Creative professional", text: "modern creative professional, relaxed but polished" },
    { label: "Real estate agent", text: "friendly real estate agent headshot, warm and trustworthy" },
  ],
  ai_twin: [
    { label: "Neutral basics", text: "plain black t-shirt, hair neat, no accessories, consistent across the pack" },
    { label: "Brand look", text: "signature brand outfit, consistent across the pack" },
  ],
  thumbnails: [
    { label: "Top 5 tools", text: "video about the best AI tools, headline \"5 AI TOOLS\"" },
    { label: "Mistakes to avoid", text: "video about common mistakes, headline \"STOP DOING THIS\"" },
    { label: "Make money online", text: "video about earning online, headline \"$10K/MONTH?\"" },
    { label: "Tutorial", text: "step-by-step tutorial, headline \"EASY GUIDE\"" },
    { label: "Before vs after", text: "transformation video, headline \"BEFORE vs AFTER\"" },
  ],
  social_content: [
    { label: "Motivation quote", text: "motivational post, quote \"Small steps every day\"" },
    { label: "Launch announcement", text: "announcing a new program, headline \"DOORS ARE OPEN\"" },
    { label: "3 tips carousel", text: "carousel about productivity, headline \"3 HABITS THAT CHANGED MY LIFE\"" },
    { label: "Event promo", text: "promoting a free live webinar, headline \"FREE WEBINAR THIS THURSDAY\"" },
  ],
  memes: [
    { label: "Monday mood", text: "relatable Monday morning struggle, caption \"ME ON MONDAY\"" },
    { label: "Client feedback", text: "freelancer receiving endless revisions, caption \"JUST ONE MORE SMALL CHANGE\"" },
    { label: "AI vs me", text: "AI doing the work in seconds, caption \"ME VS AI\"" },
    { label: "Diet starts tomorrow", text: "eating pizza while holding a salad, caption \"DIET STARTS TOMORROW\"" },
  ],
};

export function groupsForTool(toolKey: string): BuilderGroup[] {
  const keys = TOOL_GROUPS[toolKey] ?? ["style", "mood", "lighting", "framing"];
  return keys.map((k) => BUILDER_GROUPS.find((g) => g.key === k)!).filter(Boolean);
}

const QUALITY_TAIL = "Sharp focus, natural anatomy and hands, realistic proportions, no watermarks, no random text.";

/** Compose an editable direction prompt from an idea + chosen options. Empty choices produce an empty string. */
export function buildDirection(toolKey: string, idea: string, choices: BuilderChoices): string {
  const parts: string[] = [];
  if (idea.trim()) parts.push(`${idea.trim().replace(/\.$/, "")}.`);
  for (const g of groupsForTool(toolKey)) {
    const opt = g.options.find((o) => o.key === choices[g.key]);
    if (opt) parts.push(`${g.label}: ${opt.text}.`);
  }
  if (!parts.length) return "";
  // Text tools render quoted text; everything else must not add text.
  const textTool = ["thumbnails", "social_content", "memes"].includes(toolKey);
  parts.push(textTool ? "Text must be spelled exactly as written in quotes, large and easy to read." : QUALITY_TAIL);
  return parts.join(" ");
}

/** Random idea + one option per visible group, for a "Surprise me" button. */
export function surprise(toolKey: string, rand: () => number = Math.random): { idea: string; choices: BuilderChoices } {
  const pickOne = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const ideas = TOOL_IDEAS[toolKey] ?? [];
  const choices: BuilderChoices = {};
  for (const g of groupsForTool(toolKey)) choices[g.key] = pickOne(g.options).key;
  return { idea: ideas.length ? pickOne(ideas).text : "", choices };
}
