-- Free-trial abuse protection: remember which network (hashed IP) claimed a trial, and where each account signed up.
ALTER TABLE trial_claims ADD COLUMN IF NOT EXISTS ip_hash text;
CREATE INDEX IF NOT EXISTS trial_claims_ip_idx ON trial_claims (ip_hash, claimed_at) WHERE ip_hash IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip_hash text;
-- Free plan copy now describes the small protected trial.
UPDATE plan_catalog SET description = 'Try it free with a few watermarked test images. No card needed.'
 WHERE key = 'free' AND description LIKE '15 one-time trial credits%';
