import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Deployment environment. Safety guards key off APP_ENV=production (defaults to NODE_ENV).
  APP_ENV: z.enum(["development", "test", "e2e", "staging", "production"]).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("AI Character Studio"),
  DATABASE_URL: z.string().min(1).default("postgres://localhost:5432/acs_dev"),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  // Image provider
  IMAGE_PROVIDER: z.enum(["openai", "fake"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  OPENAI_MODERATION_MODEL: z.string().default("omni-moderation-latest"),
  // Stream image responses (keeps long requests alive behind proxies with short idle timeouts; partial previews add a few output tokens).
  OPENAI_IMAGE_STREAM: bool,
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  // Optional pricing inputs for cost estimates (USD per 1M tokens). Leave empty until verified on the pricing page.
  OPENAI_IMAGE_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  OPENAI_IMAGE_INPUT_IMAGE_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  OPENAI_IMAGE_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().optional(),
  MODERATION_PROVIDER: z.enum(["openai", "baseline"]).default("openai"),

  // Stripe (TEST MODE ONLY until owner approval)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_ALLOW_LIVE_MODE: bool,
  STRIPE_API_BASE: z.string().url().optional(), // local Stripe mock for e2e only; ignored in production

  // Email
  EMAIL_TRANSPORT: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("AI Character Studio <no-reply@example.com>"),

  // Comma-separated emails that become admin + beta when they verify (owner bootstrap).
  ADMIN_EMAILS: z.string().default(""),
  // Comma-separated emails allowed to create accounts (private beta). Empty = open sign-up.
  SIGNUP_ALLOWED_EMAILS: z.string().default(""),
  // Ops
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  TRIAL_CREDITS: z.coerce.number().int().min(0).default(15),
  TRIAL_CREDIT_DAYS: z.coerce.number().int().min(1).default(30),
  TOPUP_EXPIRY_MONTHS: z.coerce.number().int().min(1).default(12),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
});

export type Env = z.infer<typeof schema> & { APP_ENV: "development" | "test" | "e2e" | "staging" | "production" };

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // Values pasted into hosting dashboards often carry stray whitespace/line breaks, which break HTTP auth headers.
  const raw = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === "string" ? v.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim() : v]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const e = { ...parsed.data, APP_ENV: parsed.data.APP_ENV ?? parsed.data.NODE_ENV } as Env;
  if (e.APP_ENV === "production" || e.APP_ENV === "staging") {
    if (e.IMAGE_PROVIDER === "fake") throw new Error("IMAGE_PROVIDER=fake is forbidden in staging/production");
    if (e.STORAGE_DRIVER === "local") throw new Error("STORAGE_DRIVER=local is forbidden in production");
    if (e.MODERATION_PROVIDER === "baseline") throw new Error("MODERATION_PROVIDER=baseline is forbidden in production");
    if (e.EMAIL_TRANSPORT === "console") throw new Error("EMAIL_TRANSPORT=console is forbidden in production");
    if (e.STRIPE_API_BASE) throw new Error("STRIPE_API_BASE is for local testing only");
  }
  cached = e;
  return e;
}

/** Test helper: force re-read of process.env. */
export function resetEnvCache() {
  cached = null;
}
