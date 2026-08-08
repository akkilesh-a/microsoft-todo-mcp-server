-- {{prefix}} is substituted by the migration runner from DB_TABLE_PREFIX.
-- It is validated against ^[A-Za-z_][A-Za-z0-9_]*$ before it ever reaches SQL.

CREATE TABLE IF NOT EXISTS {{prefix}}lists (
  id                  TEXT        PRIMARY KEY,
  display_name        TEXT        NOT NULL,
  wellknown_list_name TEXT        NOT NULL DEFAULT 'none',
  is_owner            BOOLEAN     NOT NULL DEFAULT TRUE,
  is_shared           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS {{prefix}}lists_created_at_idx
  ON {{prefix}}lists (created_at);
