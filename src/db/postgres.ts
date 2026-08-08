import type { Pool, PoolClient, PoolConfig } from "pg"
import { applyPrefix, getTablePrefix } from "./config.js"
import type { ListEntry, ListInput, ListStore, MigrationTarget } from "./types.js"

interface Row {
  id: string
  display_name: string
  wellknown_list_name: string
  is_owner: boolean
  is_shared: boolean
  created_at: Date
}

function toEntry(row: Row): ListEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    wellknownListName: row.wellknown_list_name,
    isOwner: row.is_owner,
    isShared: row.is_shared,
    createdAt: row.created_at.toISOString(),
  }
}

function poolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is not set")

  const config: PoolConfig = { connectionString }

  // Hosted Postgres (Neon, Supabase, RDS) terminates TLS with a chain Node often will not
  // verify out of the box. `no-verify` keeps the connection encrypted but skips chain
  // validation, mirroring libpq's sslmode=no-verify. Anything else is left to the
  // connection string, which pg parses for sslmode= on its own.
  if (process.env.DATABASE_SSL === "no-verify") {
    config.ssl = { rejectUnauthorized: false }
  }
  return config
}

/** `pg` is loaded lazily so a SQLite-only deployment never needs it installed. */
async function createPool(): Promise<Pool> {
  const pg = await import("pg")
  // pg ships as CJS; the default export is the namespace under ESM interop.
  const PoolCtor = (pg.default ?? pg).Pool
  return new PoolCtor(poolConfig())
}

export class PostgresListStore implements ListStore {
  private constructor(
    private readonly pool: Pool,
    private readonly table: string,
  ) {}

  static async create(): Promise<PostgresListStore> {
    const prefix = getTablePrefix()
    return new PostgresListStore(await createPool(), `${prefix}lists`)
  }

  async save(list: ListInput): Promise<void> {
    await this.saveMany([list])
  }

  async saveMany(lists: ListInput[]): Promise<void> {
    if (lists.length === 0) return

    const values: unknown[] = []
    const tuples = lists.map((list, i) => {
      const base = i * 5
      values.push(
        list.id,
        list.displayName,
        list.wellknownListName ?? "none",
        list.isOwner !== false,
        list.isShared === true,
      )
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
    })

    // created_at is deliberately absent from the DO UPDATE list: re-saving a list that is
    // already known must not move it to the end of the ordering. getAll() sorts by
    // created_at, and every get-task-lists call re-saves every list returned by the API.
    await this.pool.query(
      `INSERT INTO ${this.table} (id, display_name, wellknown_list_name, is_owner, is_shared)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (id) DO UPDATE SET
         display_name        = EXCLUDED.display_name,
         wellknown_list_name = EXCLUDED.wellknown_list_name,
         is_owner            = EXCLUDED.is_owner,
         is_shared           = EXCLUDED.is_shared`,
      values,
    )
  }

  async getAll(): Promise<ListEntry[]> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM ${this.table} ORDER BY created_at ASC, id ASC`)
    return rows.map(toEntry)
  }

  async getById(id: string): Promise<ListEntry | undefined> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM ${this.table} WHERE id = $1`, [id])
    return rows[0] ? toEntry(rows[0]) : undefined
  }

  async updateDisplayName(id: string, displayName: string): Promise<void> {
    await this.pool.query(`UPDATE ${this.table} SET display_name = $1 WHERE id = $2`, [displayName, id])
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [id])
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PostgresMigrationTarget implements MigrationTarget {
  private constructor(
    private readonly pool: Pool,
    private readonly versionTable: string,
    private readonly prefix: string,
  ) {}

  static async create(): Promise<PostgresMigrationTarget> {
    const prefix = getTablePrefix()
    return new PostgresMigrationTarget(await createPool(), `${prefix}schema_migrations`, prefix)
  }

  async ensureVersionTable(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.versionTable} (
         version    TEXT        PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
  }

  async appliedVersions(): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ version: string }>(`SELECT version FROM ${this.versionTable}`)
    return new Set(rows.map((r) => r.version))
  }

  async apply(version: string, sql: string): Promise<void> {
    const client: PoolClient = await this.pool.connect()
    try {
      // Postgres has transactional DDL, so a migration that fails halfway leaves no
      // partially-created schema behind and no version row claiming it succeeded.
      await client.query("BEGIN")
      await client.query(applyPrefix(sql, this.prefix))
      await client.query(`INSERT INTO ${this.versionTable} (version) VALUES ($1)`, [version])
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
