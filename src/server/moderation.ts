import "server-only";
import OpenAI from "openai";
import { env } from "./env";
import { log } from "./audit";

export type ModerationResult = { flagged: boolean; categories: string[]; source: "openai" | "baseline" };

/**
 * Local baseline: blocks clear-cut abuse terms even when the remote moderation API is unavailable.
 * It is intentionally narrow; the provider's own safety system and OpenAI moderation are the primary layers.
 */
const BASELINE: Array<[RegExp, string]> = [
  [/\b(nude|naked|topless|nsfw|porn|explicit sex|undress(ed|ing)?|strip(ped)? (her|him|them))\b/i, "sexual"],
  [/\b(child|kid|minor|teen|underage|schoolgirl|schoolboy)\b[\s\S]{0,40}\b(sexy|nude|naked|lingerie|bikini|seductive)\b/i, "sexual/minors"],
  [/\b(deepfake|impersonat(e|ion)|pretend to be|fake (id|passport|license|receipt))\b/i, "deception"],
  [/\b(gore|behead|dismember|mutilat)/i, "violence/graphic"],
  [/\b(real|genuine|verified) (customer )?testimonial\b/i, "deceptive_endorsement"],
];

export function baselineModerate(text: string): ModerationResult {
  const categories = BASELINE.filter(([re]) => re.test(text)).map(([, c]) => c);
  return { flagged: categories.length > 0, categories, source: "baseline" };
}

let client: OpenAI | null = null;
let override: ((input: { text?: string; imageDataUrl?: string }) => Promise<ModerationResult>) | null = null;
export function setModerationForTests(fn: typeof override) {
  override = fn;
}

/** Moderate text and/or an image. Fails closed in production if the remote check errors. */
export async function moderate(input: { text?: string; imageDataUrl?: string }): Promise<ModerationResult> {
  if (override) return override(input);
  const base = input.text ? baselineModerate(input.text) : { flagged: false, categories: [], source: "baseline" as const };
  if (base.flagged) return base;
  const e = env();
  if (e.MODERATION_PROVIDER === "baseline" || !e.OPENAI_API_KEY) return base;
  client ??= new OpenAI({ apiKey: e.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
  try {
    const content: OpenAI.Moderations.ModerationMultiModalInput[] = [];
    if (input.text) content.push({ type: "text", text: input.text });
    if (input.imageDataUrl) content.push({ type: "image_url", image_url: { url: input.imageDataUrl } });
    const r = await client.moderations.create({ model: e.OPENAI_MODERATION_MODEL, input: content });
    const result = r.results[0];
    const categories = result ? Object.entries(result.categories).filter(([, v]) => v).map(([k]) => k) : [];
    return { flagged: !!result?.flagged, categories, source: "openai" };
  } catch (err) {
    log("error", "moderation.failed", { error: (err as Error).message });
    if (e.APP_ENV === "production" || e.APP_ENV === "staging") return { flagged: true, categories: ["moderation_unavailable"], source: "openai" };
    return base;
  }
}
