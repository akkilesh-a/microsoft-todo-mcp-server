-- {{prefix}} is substituted by the migration runner from DB_TABLE_PREFIX.
--
-- Column names here are camelCase, unlike the Postgres migration's snake_case. That is
-- deliberate: this exact shape already exists in every lists.db created before the
-- multi-driver split, so CREATE TABLE IF NOT EXISTS is a no-op on those files and no
-- data migration is needed. Postgres tables are new, so they get idiomatic snake_case.

CREATE TABLE IF NOT EXISTS {{prefix}}lists (
  id                TEXT PRIMARY KEY,
  displayName       TEXT NOT NULL,
  wellknownListName TEXT DEFAULT 'none',
  isOwner           INTEGER DEFAULT 1,
  isShared          INTEGER DEFAULT 0,
  createdAt         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS {{prefix}}lists_createdAt_idx
  ON {{prefix}}lists (createdAt);
