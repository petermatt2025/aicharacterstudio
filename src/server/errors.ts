export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "email_taken"
  | "invalid_credentials"
  | "email_not_verified"
  | "feature_unavailable"
  | "plan_required"
  | "insufficient_credits"
  | "quote_expired"
  | "quote_used"
  | "rate_limited"
  | "concurrency_limit"
  | "daily_limit"
  | "consent_required"
  | "moderation_blocked"
  | "unsupported_file"
  | "file_too_large"
  | "provider_not_configured"
  | "provider_unavailable"
  | "provider_capability"
  | "cost_cap_reached"
  | "billing_not_configured"
  | "billing_unavailable"
  | "billing_live_mode_blocked"
  | "conflict"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  email_taken: 409,
  invalid_credentials: 401,
  email_not_verified: 403,
  feature_unavailable: 403,
  plan_required: 402,
  insufficient_credits: 402,
  quote_expired: 409,
  quote_used: 409,
  rate_limited: 429,
  concurrency_limit: 429,
  daily_limit: 429,
  consent_required: 400,
  moderation_blocked: 422,
  unsupported_file: 415,
  file_too_large: 413,
  provider_not_configured: 503,
  provider_unavailable: 503,
  provider_capability: 422,
  cost_cap_reached: 503,
  billing_not_configured: 503,
  billing_unavailable: 503,
  billing_live_mode_blocked: 503,
  conflict: 409,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
