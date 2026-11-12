-- Earlier successful generations were stored without a cost (providers don't report prices).
-- Backfill with the starting per-image estimates so spending caps and margins include past usage.
UPDATE usage_events SET cost_usd = CASE provider WHEN 'gemini' THEN 0.04 WHEN 'fake' THEN 0.01 ELSE 0.06 END
 WHERE success AND cost_usd IS NULL;
