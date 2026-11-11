// AI Scene Director: turns a short brief into a structured, editable prompt.
// Deterministic (no extra model call or cost). The user can edit every field and the final text.

export type SceneSpec = {
  subject: string;
  scene: string;
  lens: string;
  lighting: string;
  expression: string;
  pose: string;
  constraints: string;
  avoid: string;
  aspectRatio: string;
};

const LIGHTING: Array<[RegExp, string]> = [
  [/sunset|golden hour|dusk/i, "warm golden-hour backlight with soft rim light"],
  [/night|neon|club|evening/i, "moody low-key lighting with neon accents"],
  [/studio|headshot|backdrop/i, "soft key light with gentle fill, clean studio lighting"],
  [/office|indoor|kitchen|caf[eé]|home/i, "soft natural window light"],
  [/beach|outdoor|park|mountain|trail|street/i, "bright natural daylight"],
];
const LENS: Array<[RegExp, string]> = [
  [/headshot|portrait|close/i, "85mm portrait lens, shallow depth of field"],
  [/product|flat ?lay|unbox/i, "50mm lens, product in sharp focus"],
  [/wide|landscape|city|mountain|beach/i, "35mm lens, environmental framing"],
];
const EXPRESSION: Array<[RegExp, string]> = [
  [/laugh|happy|joy|excited/i, "genuine laugh, relaxed eyes"],
  [/serious|confident|professional|corporate/i, "confident, composed expression"],
  [/calm|relax|cozy/i, "calm, content expression"],
];
const POSE: Array<[RegExp, string]> = [
  [/walk/i, "mid-stride walking naturally"],
  [/sit|seated|caf[eé]|desk/i, "seated comfortably, natural posture"],
  [/hold|holding/i, "holding the item naturally toward the camera"],
];

const pick = (rules: Array<[RegExp, string]>, text: string, fallback: string) => rules.find(([re]) => re.test(text))?.[1] ?? fallback;

export function directScene(brief: string, aspectRatio = "4:5"): SceneSpec {
  const b = brief.trim().replace(/\s+/g, " ").slice(0, 600);
  return {
    subject: "the character from the reference image",
    scene: b || "a clean, well-composed setting that suits the character",
    lens: pick(LENS, b, "50mm lens, natural perspective"),
    lighting: pick(LIGHTING, b, "flattering soft natural light"),
    expression: pick(EXPRESSION, b, "natural, approachable expression"),
    pose: pick(POSE, b, "natural relaxed pose"),
    constraints: "photorealistic, realistic skin texture, anatomically correct hands, no added text or logos",
    avoid: "distorted faces, extra fingers, watermarks, garbled text, cartoon style unless requested",
    aspectRatio,
  };
}

export function specToPrompt(s: SceneSpec): string {
  return [
    `Subject: ${s.subject}.`,
    `Scene: ${s.scene}.`,
    `Camera: ${s.lens}.`,
    `Lighting: ${s.lighting}.`,
    `Expression: ${s.expression}. Pose: ${s.pose}.`,
    `Requirements: ${s.constraints}.`,
    `Avoid: ${s.avoid}.`,
  ].join("\n");
}
