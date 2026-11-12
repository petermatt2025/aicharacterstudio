-- Operator alerts (emailed to ADMIN_EMAILS, throttled per kind) and worker liveness for the status page.
CREATE TABLE alert_log (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  emailed    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_log_kind_idx ON alert_log (kind, created_at DESC);

CREATE TABLE worker_heartbeats (
  worker_id  text PRIMARY KEY,
  info       jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen  timestamptz NOT NULL DEFAULT now()
);
