-- AI Character Studio: initial schema
-- Conventions: UUID PKs, timestamptz, CHECK constraints, explicit indexes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── Identity ─────────────────────────
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   text NOT NULL,
  email_canonical         text NOT NULL,            -- lowercased, +tag stripped; trial abuse control
  password_hash           text NOT NULL,
  display_name            text NOT NULL DEFAULT '',
  email_verified_at       timestamptz,
  onboarding_completed_at timestamptz,
  is_admin                boolean NOT NULL DEFAULT false,
  beta_allowlisted        boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);
CREATE UNIQUE INDEX users_email_active_uq ON users (lower(email)) WHERE status <> 'deleted';
CREATE INDEX users_email_canonical_idx ON users (email_canonical);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email','password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body_text  text NOT NULL,
  transport  text NOT NULL,
  status     text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Trial credits granted once per canonical email, surviving account deletion/recreation.
CREATE TABLE trial_claims (
  email_canonical text PRIMARY KEY,          -- sha256 of the canonical email
  claimed_at      timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Catalog ─────────────────────────
CREATE TABLE plan_catalog (
  key                  text PRIMARY KEY CHECK (key IN ('free','creator','pro','agency')),
  rank                 int  NOT NULL UNIQUE,
  display_name         text NOT NULL,
  description          text NOT NULL,
  monthly_price_cents  int  NOT NULL CHECK (monthly_price_cents >= 0),
  annual_price_cents   int  NOT NULL CHECK (annual_price_cents >= 0),
  monthly_credits      int  NOT NULL CHECK (monthly_credits >= 0),
  stripe_price_monthly text,
  stripe_price_annual  text,
  seat_cap             int  NOT NULL DEFAULT 1,
  max_concurrent_jobs  int  NOT NULL DEFAULT 1,
  max_jobs_per_day     int  NOT NULL DEFAULT 20,
  max_outputs_per_job  int  NOT NULL DEFAULT 4,
  max_long_edge_px     int  NOT NULL DEFAULT 1024,
  watermark            boolean NOT NULL DEFAULT false,
  allows_photoshoot    boolean NOT NULL DEFAULT false,
  allows_topups        boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan_price_monthly_uq ON plan_catalog (stripe_price_monthly) WHERE stripe_price_monthly IS NOT NULL;
CREATE UNIQUE INDEX plan_price_annual_uq  ON plan_catalog (stripe_price_annual)  WHERE stripe_price_annual  IS NOT NULL;

CREATE TABLE features (
  key               text PRIMARY KEY,
  tool_number       int UNIQUE,                       -- 1..30; NULL for cross-cutting capabilities
  name              text NOT NULL,
  studio            text NOT NULL CHECK (studio IN ('character','scene','mixer','ugc_ads','product','content')),
  phase             int  NOT NULL CHECK (phase BETWEEN 1 AND 4),
  release_state     text NOT NULL CHECK (release_state IN ('planned','coming_soon','beta','live','paused')),
  min_tier          text NOT NULL REFERENCES plan_catalog(key),
  credit_multiplier numeric(6,3) NOT NULL DEFAULT 1 CHECK (credit_multiplier > 0 AND credit_multiplier <= 20),
  description       text NOT NULL,
  pause_reason      text,
  display_order     int NOT NULL,
  daily_cost_cap_usd numeric(10,2),                    -- auto-pause new quotes when breached
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_entitlements (
  plan_key    text NOT NULL REFERENCES plan_catalog(key),
  feature_key text NOT NULL REFERENCES features(key),
  is_enabled  boolean NOT NULL,
  PRIMARY KEY (plan_key, feature_key)
);

CREATE TABLE credit_rules (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  credits     numeric(8,2) NOT NULL CHECK (credits > 0),
  per_outputs int NOT NULL DEFAULT 1 CHECK (per_outputs >= 1),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topup_packs (
  key             text PRIMARY KEY,
  display_name    text NOT NULL,
  price_cents     int  NOT NULL CHECK (price_cents > 0),
  currency        text NOT NULL DEFAULT 'usd',
  credits         int  NOT NULL CHECK (credits > 0),
  stripe_price_id text UNIQUE,
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Workspaces ─────────────────────────
CREATE TABLE workspaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  name          text NOT NULL,
  plan_key      text NOT NULL DEFAULT 'free' REFERENCES plan_catalog(key),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX workspaces_owner_idx ON workspaces (owner_user_id);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner','admin','member')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','removed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

-- ───────────────────────── Billing ─────────────────────────
CREATE TABLE billing_customers (
  workspace_id       uuid PRIMARY KEY REFERENCES workspaces(id),
  stripe_customer_id text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id),
  stripe_customer_id     text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_price_id        text NOT NULL,
  plan_key               text NOT NULL REFERENCES plan_catalog(key),
  billing_interval       text NOT NULL CHECK (billing_interval IN ('month','year')),
  status                 text NOT NULL,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  last_event_created     timestamptz,                -- ignore out-of-order older events
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_workspace_idx ON subscriptions (workspace_id);

CREATE TABLE payment_events (
  stripe_event_id text PRIMARY KEY,
  type            text NOT NULL,
  livemode        boolean NOT NULL,
  status          text NOT NULL CHECK (status IN ('processing','processed','ignored','failed')),
  payload_sha256  text NOT NULL,
  error           text,
  attempts        int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- ───────────────────────── Credits ─────────────────────────
CREATE TABLE credit_wallets (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  balance      int NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- spendable (cached; ledger is source of truth)
  reserved     int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  source       text NOT NULL CHECK (source IN ('trial','subscription','annual_allocation','topup','admin')),
  source_ref   text NOT NULL,              -- invoice id, payment intent id, etc.
  priority     int  NOT NULL,              -- 0 = included/trial (spent first), 1 = purchased
  amount       int  NOT NULL CHECK (amount > 0),
  remaining    int  NOT NULL CHECK (remaining >= 0 AND remaining <= amount),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  expired_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX credit_grants_spend_idx ON credit_grants (workspace_id, priority, expires_at) WHERE remaining > 0;

CREATE TABLE credit_quotes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  feature_key  text NOT NULL REFERENCES features(key),
  request      jsonb NOT NULL,             -- immutable normalized request snapshot
  credits      int  NOT NULL CHECK (credits > 0),
  outputs      int  NOT NULL CHECK (outputs > 0),
  plan_key     text NOT NULL,
  model        text NOT NULL,
  breakdown    jsonb NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_quotes_ws_idx ON credit_quotes (workspace_id, created_at DESC);

-- ───────────────────────── Assets & consent ─────────────────────────
CREATE TABLE consent_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  subject           text NOT NULL CHECK (subject IN ('self','third_party_with_permission','no_identifiable_people','owned_product_or_asset')),
  statement_version text NOT NULL,
  statement         text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  owner_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind              text NOT NULL CHECK (kind IN ('character','product','outfit','background','style','other','output')),
  storage_key       text NOT NULL UNIQUE,
  thumb_key         text,
  original_filename text,
  title             text NOT NULL DEFAULT '',
  mime              text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  bytes             int  NOT NULL CHECK (bytes > 0),
  width             int  NOT NULL CHECK (width > 0),
  height            int  NOT NULL CHECK (height > 0),
  sha256            text NOT NULL,
  provenance        jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_receipt_id uuid REFERENCES consent_receipts(id),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','passed','flagged','baseline_only')),
  feature_key       text REFERENCES features(key),
  favorite          boolean NOT NULL DEFAULT false,
  watermarked       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX assets_ws_kind_idx ON assets (workspace_id, kind, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE character_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  owner_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  primary_asset_id  uuid REFERENCES assets(id),
  identity_strength text NOT NULL DEFAULT 'balanced' CHECK (identity_strength IN ('loose','balanced','strict')),
  notes             text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX character_profiles_ws_idx ON character_profiles (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE character_profile_assets (
  profile_id uuid NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
  asset_id   uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, asset_id)
);

-- ───────────────────────── Jobs ─────────────────────────
CREATE TABLE generation_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  feature_key       text NOT NULL REFERENCES features(key),
  quote_id          uuid NOT NULL UNIQUE REFERENCES credit_quotes(id),
  idempotency_key   text NOT NULL,
  status            text NOT NULL CHECK (status IN ('queued','running','succeeded','partial','failed','canceled','rejected')),
  request           jsonb NOT NULL,
  outputs_requested int NOT NULL CHECK (outputs_requested > 0),
  outputs_delivered int NOT NULL DEFAULT 0,
  credits_reserved  int NOT NULL CHECK (credits_reserved > 0),
  credits_charged   int NOT NULL DEFAULT 0,
  attempts          int NOT NULL DEFAULT 0,
  max_attempts      int NOT NULL DEFAULT 3,
  run_after         timestamptz NOT NULL DEFAULT now(),
  lease_expires_at  timestamptz,
  locked_by         text,
  cancel_requested  boolean NOT NULL DEFAULT false,
  provider          text,
  model             text,
  error_code        text,
  error_message     text,
  warnings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX generation_jobs_claim_idx ON generation_jobs (run_after) WHERE status IN ('queued','running');
CREATE INDEX generation_jobs_ws_idx ON generation_jobs (workspace_id, created_at DESC);

CREATE TABLE credit_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  job_id       uuid NOT NULL UNIQUE REFERENCES generation_jobs(id),
  amount       int NOT NULL CHECK (amount > 0),
  status       text NOT NULL CHECK (status IN ('held','settled','released')),
  charged      int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

CREATE TABLE credit_reservation_allocations (
  reservation_id uuid NOT NULL REFERENCES credit_reservations(id),
  grant_id       uuid NOT NULL REFERENCES credit_grants(id),
  amount         int NOT NULL CHECK (amount > 0),
  PRIMARY KEY (reservation_id, grant_id)
);

CREATE TABLE credit_ledger (
  id             bigserial PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  entry_type     text NOT NULL CHECK (entry_type IN ('grant','reserve','settle','release','expire','revoke','admin_adjust')),
  amount         int  NOT NULL,          -- signed effect on spendable balance (settle = 0: already deducted at reserve)
  balance_after  int  NOT NULL CHECK (balance_after >= 0),
  grant_id       uuid REFERENCES credit_grants(id),
  job_id         uuid REFERENCES generation_jobs(id),
  description    text NOT NULL,
  idempotency_key text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_ws_idx ON credit_ledger (workspace_id, id DESC);

CREATE TABLE generation_job_inputs (
  job_id   uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id),
  role     text NOT NULL CHECK (role IN ('character','product','outfit','background','style','other')),
  position int  NOT NULL,
  PRIMARY KEY (job_id, position)
);

CREATE TABLE generation_job_outputs (
  job_id       uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  output_index int  NOT NULL,
  asset_id     uuid NOT NULL REFERENCES assets(id),
  PRIMARY KEY (job_id, output_index)
);

CREATE TABLE usage_events (
  id            bigserial PRIMARY KEY,
  job_id        uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  feature_key   text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  operation     text NOT NULL,           -- generate | edit | moderation
  attempt       int  NOT NULL,
  success       boolean NOT NULL,
  error_code    text,
  usage         jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd      numeric(12,6),
  duration_ms   int NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_created_idx ON usage_events (created_at DESC);
CREATE INDEX usage_events_feature_idx ON usage_events (feature_key, created_at DESC);

-- ───────────────────────── Ops ─────────────────────────
CREATE TABLE rate_limit_buckets (
  bucket_key   text NOT NULL,
  window_start timestamptz NOT NULL,
  count        int NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE TABLE admin_audit_events (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  status       text NOT NULL CHECK (status IN ('requested','completed','failed')),
  reason       text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error        text
);

CREATE TABLE analytics_events (
  id           bigserial PRIMARY KEY,
  user_id      uuid,
  name         text NOT NULL,
  props        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
