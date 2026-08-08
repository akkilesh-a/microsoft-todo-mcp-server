/**
 * Database configuration shared by the drivers and the migration runner.
 *
 * Which driver runs is decided by one variable: DATABASE_URL. Set it and you get Postgres;
 * leave it unset and you get the SQLite file, exactly as this server has always behaved.
 */

export type Dialect = "postgres" | "sqlite"

/**
 * Table names are prefixed so this server can share a Postgres database with other
 * applications. The prefix covers every table it creates, including the migration
 * bookkeeping table — otherwise two apps both using a bare `schema_migrations` would
 * overwrite each other's version history and silently skip migrations.
 */
const PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function getTablePrefix(): string {
  const raw = process.env.DB_TABLE_PREFIX?.trim() ?? ""
  if (raw === "") return ""
  if (!PREFIX_PATTERN.test(raw)) {
    throw new Error(
      `Invalid DB_TABLE_PREFIX ${JSON.stringify(raw)}. It is interpolated directly into SQL ` +
        `identifiers, so it must match ${PREFIX_PATTERN} — letters, digits and underscores only, ` +
        `not starting with a digit. Example: mstodo_`,
    )
  }
  return raw
}

export function getDialect(): Dialect {
  return process.env.DATABASE_URL ? "postgres" : "sqlite"
}

/** Applies the validated prefix to a template's {{prefix}} placeholders. */
export function applyPrefix(sql: string, prefix: string): string {
  return sql.replaceAll("{{prefix}}", prefix)
}
