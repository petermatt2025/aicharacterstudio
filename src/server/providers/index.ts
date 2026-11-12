import "server-only";
import { env } from "../env";
import { AppError } from "../errors";
import { FakeImageProvider } from "./fake";
import { GeminiImageProvider } from "./gemini";
import { OpenAIImageProvider } from "./openai";
import type { ImageProvider } from "./types";

/** Image engines a user can pick. `openai` = best detail, `gemini` = fastest. */
export const ENGINES = ["openai", "gemini"] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_INFO: Record<Engine, { label: string; hint: string }> = {
  openai: { label: "OpenAI (best detail)", hint: "Highest detail and text accuracy; about 30–90 s per image." },
  gemini: { label: "Gemini (fastest)", hint: "Much faster, about 5–20 s per image; strong at keeping a face consistent." },
};

let override: ImageProvider | null = null;
const cached = new Map<string, ImageProvider>();

/** Engines with credentials configured, in display order. The first is the default. */
export function availableEngines(): Engine[] {
  const e = env();
  if (e.IMAGE_PROVIDER === "fake") return [...ENGINES];
  const list: Engine[] = [];
  if (e.OPENAI_API_KEY) list.push("openai");
  if (e.GEMINI_API_KEY) list.push("gemini");
  // Put the configured default first.
  return list.sort((a, b) => (a === e.DEFAULT_IMAGE_ENGINE ? -1 : b === e.DEFAULT_IMAGE_ENGINE ? 1 : 0));
}

export function imageProvider(engine?: Engine | null): ImageProvider {
  if (override) return override;
  const e = env();
  const chosen: Engine = engine ?? availableEngines()[0] ?? "openai";
  const key = e.IMAGE_PROVIDER === "fake" ? `fake:${chosen}` : chosen;
  const hit = cached.get(key);
  if (hit) return hit;
  let p: ImageProvider;
  if (e.IMAGE_PROVIDER === "fake") {
    if (e.APP_ENV === "production" || e.APP_ENV === "staging") throw new Error("Fake provider is forbidden in production");
    p = new FakeImageProvider();
  } else if (chosen === "gemini") {
    if (!e.GEMINI_API_KEY) throw new AppError("provider_not_configured", "The Gemini engine is not configured (GEMINI_API_KEY missing).");
    p = new GeminiImageProvider({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_IMAGE_MODEL, timeoutMs: e.OPENAI_TIMEOUT_MS });
  } else {
    if (!e.OPENAI_API_KEY) throw new AppError("provider_not_configured", "Image generation is not configured yet (OPENAI_API_KEY missing).");
    p = new OpenAIImageProvider({ apiKey: e.OPENAI_API_KEY, model: e.OPENAI_IMAGE_MODEL, timeoutMs: e.OPENAI_TIMEOUT_MS, stream: e.OPENAI_IMAGE_STREAM });
  }
  cached.set(key, p);
  return p;
}

export function setImageProviderForTests(p: ImageProvider | null) {
  override = p;
}

export function providerConfigured(): boolean {
  return availableEngines().length > 0;
}
