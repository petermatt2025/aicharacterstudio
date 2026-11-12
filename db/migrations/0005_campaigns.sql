-- Campaign folders: group images, keep a brief, auto-collect generations, download as ZIP.
CREATE TABLE campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  brief         text NOT NULL DEFAULT '' CHECK (length(brief) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX campaigns_ws_idx ON campaigns (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE campaign_items (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  asset_id    uuid NOT NULL REFERENCES assets(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, asset_id)
);
CREATE INDEX campaign_items_asset_idx ON campaign_items (asset_id);
