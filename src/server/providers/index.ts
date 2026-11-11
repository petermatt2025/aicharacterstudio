import "server-only";
import { env } from "../env";
import { AppError } from "../errors";
import { FakeImageProvider } from "./fake";
import { OpenAIImageProvider } from "./openai";
import type { ImageProvider } from "./types";

let override: ImageProvider | null = null;
let cached: ImageProvider | null = null;

export function imageProvider(): ImageProvider {
  if (override) return override;
  if (cached) return cached;
  const e = env();
  if (e.IMAGE_PROVIDER === "fake") {
    if (e.APP_ENV === "production" || e.APP_ENV === "staging") throw new Error("Fake provider is forbidden in production");
    cached = new FakeImageProvider();
  } else {
    if (!e.OPENAI_API_KEY) throw new AppError("provider_not_configured", "Image generation is not configured yet (OPENAI_API_KEY missing).");
    cached = new OpenAIImageProvider({ apiKey: e.OPENAI_API_KEY, model: e.OPENAI_IMAGE_MODEL, timeoutMs: e.OPENAI_TIMEOUT_MS });
  }
  return cached;
}

export function setImageProviderForTests(p: ImageProvider | null) {
  override = p;
}

export function providerConfigured(): boolean {
  const e = env();
  return e.IMAGE_PROVIDER === "fake" || !!e.OPENAI_API_KEY;
}
