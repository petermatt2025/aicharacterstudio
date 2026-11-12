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
      { key: "anime", label: "Anime", text: "high-quality anime illustration, clean line art, cel shading, vibrant colors" },
      { key: "animated3d", label: "3D animated", text: "3D animated movie style, soft global illumination, expressive stylized features" },
      { key: "pop_art", label: "Pop art", text: "bold pop art, flat bright colors, halftone dots, thick black outlines" },
      { key: "comic", label: "Comic book", text: "comic book illustration, ink outlines, dramatic shading, halftone texture" },
      { key: "watercolor", label: "Watercolor", text: "soft watercolor painting on textured paper, delicate washes" },
      { key: "oil", label: "Oil painting", text: "classical oil painting, visible brush strokes, rich glazes" },
      { key: "pencil", label: "Pencil sketch", text: "detailed graphite pencil sketch, cross-hatching" },
      { key: "pixel", label: "Pixel art", text: "retro 16-bit pixel art, limited palette, crisp pixels" },
      { key: "clay", label: "Claymation", text: "claymation stop-motion look, handmade clay textures" },
      { key: "cyberpunk", label: "Cyberpunk", text: "cyberpunk aesthetic, neon magenta and cyan, rainy futuristic city glow" },
      { key: "synthwave", label: "Synthwave", text: "80s synthwave, neon grid, purple-pink sunset gradients" },
      { key: "fantasy", label: "Fantasy art", text: "epic fantasy digital painting, magical atmosphere, dramatic lighting" },
      { key: "vector", label: "Flat vector", text: "clean flat vector illustration, simple shapes, solid colors" },
      { key: "lowpoly", label: "Low poly", text: "low-poly 3D style, faceted geometric shapes" },
      { key: "ukiyoe", label: "Japanese woodblock", text: "traditional Japanese woodblock print style, flat colors, fine outlines, textured paper" },
      { key: "stained_glass", label: "Stained glass", text: "stained glass artwork, bold lead lines, glowing jewel colors" },
      { key: "sticker", label: "Sticker", text: "die-cut sticker design, thick white border, glossy vibrant colors" },
      { key: "noir", label: "Film noir", text: "black and white film noir, hard shadows, venetian-blind light" },
      { key: "polaroid", label: "Polaroid", text: "instant polaroid photo, soft faded colors, white frame" },
      { key: "chibi", label: "Chibi", text: "cute chibi style, big head, small body, kawaii expressions" },
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
  character_interactions: ["style", "mood", "lighting", "framing", "wardrobe", "setting"],
  testimonial_layouts: ["style", "setting"],
  influencer_campaigns: ["style", "mood", "lighting", "framing", "setting"],
  before_after: ["style", "lighting"],
  ad_variations: ["style", "mood", "setting"],
  fashion_model: ["style", "mood", "lighting", "setting"],
  product_lifestyle: ["style", "lighting", "setting"],
  digital_mockups: ["style", "lighting", "setting"],
  product_demonstrator: ["style", "mood", "lighting", "framing", "setting"],
  brand_mascots: ["style", "mood", "setting"],
  marketplace_images: ["style", "lighting"],
  storyboards: ["style", "mood", "lighting"],
  video_prep: ["style", "lighting", "wardrobe"],
  restore_enhance: [],
  scene_recreation: ["mood", "wardrobe"],
  batch_campaigns: ["style", "mood", "setting"],
  image_edit: ["style", "lighting"],
  animate: ["mood"],
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

Object.assign(TOOL_IDEAS, {
  character_interactions: [
    { label: "Podcast co-hosts", text: "co-hosts recording an episode in a cozy studio, laughing at a joke" },
    { label: "Couple at sunset", text: "a happy couple on a beach at sunset, relaxed and affectionate" },
    { label: "Coach & client", text: "a coach and a client celebrating a breakthrough in a bright office" },
    { label: "Friends brunch", text: "friends enjoying brunch together at a sunny café terrace" },
  ],
  testimonial_layouts: [
    { label: "Sales page card", text: "testimonial card for a sales page, warm and trustworthy, quote \"PASTE THE REAL QUOTE HERE\" - First name" },
    { label: "Instagram proof", text: "social-proof post for Instagram, quote \"PASTE THE REAL QUOTE HERE\" - First name" },
  ],
  influencer_campaigns: [
    { label: "Launch week", text: "launch week of a new product, excited and aspirational" },
    { label: "Summer campaign", text: "summer campaign, sunny and fresh, outdoor lifestyle" },
    { label: "Holiday gifting", text: "holiday gifting campaign, cozy and festive" },
  ],
  before_after: [
    { label: "Room makeover", text: "before: dull cluttered living room; after: bright, styled, cozy living room" },
    { label: "Desk glow-up", text: "before: messy desk with cables; after: clean minimal desk setup with plants" },
    { label: "Brand refresh", text: "before: outdated plain flyer design; after: modern bold branded design" },
    { label: "Garden", text: "before: overgrown backyard; after: tidy garden with lights and seating" },
  ],
  ad_variations: [
    { label: "Fresh colors", text: "keep the headline and product, try a warmer color palette" },
    { label: "New hook", text: "same product, focus on a pain point the audience feels" },
    { label: "Premium look", text: "make it look more premium and minimal" },
  ],
  fashion_model: [
    { label: "Online store", text: "online store product photos, clean and consistent" },
    { label: "Lookbook", text: "seasonal lookbook with a confident model" },
    { label: "Instagram drop", text: "new collection drop for Instagram, trendy and bold" },
  ],
  product_lifestyle: [
    { label: "Website hero", text: "hero image for the brand website, aspirational and clean" },
    { label: "Cozy home", text: "cozy home atmosphere, morning light" },
    { label: "Premium ad", text: "premium advertising look, dramatic shadows" },
  ],
  digital_mockups: [
    { label: "Ebook launch", text: "ebook launch mockup, clean desk, soft shadows" },
    { label: "Course bundle", text: "online course bundle with all bonuses displayed" },
    { label: "App showcase", text: "mobile app showcase, modern and bright" },
  ],
  product_demonstrator: [
    { label: "Kitchen gadget", text: "showing how a kitchen gadget makes cooking faster" },
    { label: "Skincare routine", text: "applying a skincare product in a bright bathroom" },
    { label: "Tech accessory", text: "using a tech accessory at a desk, productive" },
  ],
  brand_mascots: [
    { label: "Coffee bean", text: "a cheerful round coffee bean with big eyes and a red scarf, 3D cartoon style" },
    { label: "Friendly robot", text: "a friendly small robot with rounded shapes and a glowing smile, 3D style" },
    { label: "Wise owl", text: "a wise but playful owl wearing glasses, flat vector style" },
    { label: "Fox mascot", text: "an energetic orange fox in a hoodie, modern cartoon style" },
  ],
  marketplace_images: [
    { label: "Amazon set", text: "complete Amazon listing set, clean and professional" },
    { label: "Etsy handmade", text: "handmade product for Etsy, warm natural look" },
  ],
  storyboards: [
    { label: "App ad", text: "a busy professional discovers an app that saves them two hours a day" },
    { label: "Coffee story", text: "a quiet morning ritual with a new coffee brand, from sunrise to first sip" },
    { label: "Course trailer", text: "a beginner learns a new skill and gets their first client" },
  ],
  video_prep: [
    { label: "Walk into café", text: "the character walks into a sunny café, sits down and smiles at the camera" },
    { label: "Turn to camera", text: "the character looks out of a window, then turns and smiles at the camera" },
    { label: "Product reveal", text: "the character lifts a product from a table and shows it to the camera" },
  ],
  restore_enhance: [
    { label: "Family photo", text: "old family portrait from the 1960s" },
    { label: "Wedding photo", text: "vintage wedding photo, the dress was white and the flowers were pink" },
  ],
  scene_recreation: [
    { label: "Same vibe, my city", text: "same vibe but in my own city" },
    { label: "Magazine cover feel", text: "magazine-cover feel with me as the subject" },
  ],
  batch_campaigns: [
    { label: "Black Friday", text: "Black Friday sale, headline \"40% OFF THIS WEEK\"" },
    { label: "New launch", text: "new product launch, headline \"IT'S HERE\"" },
    { label: "Webinar", text: "free live webinar promotion, headline \"FREE LIVE TRAINING\"" },
  ],
  animate: [
    { label: "Laugh & sunset", text: "she laughs and looks toward the sunset, hair blowing in the wind" },
    { label: "Coffee sip", text: "takes a slow sip of coffee, then smiles at the camera" },
    { label: "Wave hello", text: "looks at the camera and waves hello warmly" },
    { label: "Product reveal", text: "lifts the product toward the camera and turns it slowly" },
  ],
  image_edit: [
    { label: "Remove object", text: "remove the object in the background, fill naturally" },
    { label: "Change outfit color", text: "change the jacket color to navy blue" },
    { label: "Sunset sky", text: "replace the sky with a warm sunset" },
  ],
} satisfies Record<string, Idea[]>);

export function groupsForTool(toolKey: string): BuilderGroup[] {
  const keys = TOOL_GROUPS[toolKey] ?? ["style", "mood", "lighting", "framing"];
  if (!keys.length) return [];
  return keys.map((k) => BUILDER_GROUPS.find((g) => g.key === k)!).filter(Boolean);
}

/** Non-photographic styles (they replace the photoreal default). */
export const ART_STYLES = new Set(["anime", "animated3d", "pop_art", "comic", "watercolor", "oil", "pencil", "pixel", "clay", "cyberpunk", "synthwave", "fantasy", "vector", "lowpoly", "ukiyoe", "stained_glass", "sticker", "chibi"]);
const ART_TAIL = "Clean, consistent artwork, no watermarks, no random text.";

const QUALITY_TAIL = "Sharp focus, natural anatomy and hands, realistic proportions, no watermarks, no random text.";

/** Compose an editable direction prompt from an idea + chosen options. Empty choices produce an empty string. */
export function buildDirection(toolKey: string, idea: string, choices: BuilderChoices): string {
  const parts: string[] = [];
  if (idea.trim()) parts.push(`${idea.trim().replace(/\.$/, "")}.`);
  const artistic = !!choices.style && ART_STYLES.has(choices.style);
  for (const g of groupsForTool(toolKey)) {
    const opt = g.options.find((o) => o.key === choices[g.key]);
    if (!opt) continue;
    // Art styles override the tool's default "photorealistic" framing.
    parts.push(g.key === "style" && artistic ? `Style: not a photograph; render it as ${opt.text}, keeping the same person recognizable.` : `${g.label}: ${opt.text}.`);
  }
  if (!parts.length) return "";
  // Text tools render quoted text; everything else must not add text.
  const textTool = ["thumbnails", "social_content", "memes", "testimonial_layouts", "batch_campaigns"].includes(toolKey);
  parts.push(textTool ? "Text must be spelled exactly as written in quotes, large and easy to read." : artistic ? ART_TAIL : QUALITY_TAIL);
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
