import "server-only";
import { one } from "./db";
import { AppError } from "./errors";

/** Fixed-window counter in Postgres: works across instances. Throws rate_limited when exceeded. */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const row = await one<{ count: number }>(
    `INSERT INTO rate_limit_buckets (bucket_key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
     RETURNING count`,
    [key, windowSeconds],
  );
  if (row && row.count > limit) throw new AppError("rate_limited", "Too many requests. Please wait a moment and try again.");
}

export async function pruneRateLimits() {
  await one(`DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 day'`);
}
