-- Style boards (moodboards): named sets of images whose look can be applied to any generation.
CREATE TABLE style_boards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX style_boards_ws_idx ON style_boards (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE style_board_items (
  board_id  uuid NOT NULL REFERENCES style_boards(id) ON DELETE CASCADE,
  asset_id  uuid NOT NULL REFERENCES assets(id),
  position  int  NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, asset_id)
);
