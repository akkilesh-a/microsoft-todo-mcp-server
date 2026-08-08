import type DatabaseType from "better-sqlite3"
import { join } from "path"
import { applyPrefix, getTablePrefix } from "./config.js"
import type { ListEntry, ListInput, ListStore, MigrationTarget } from "./types.js"

interface Row {
  id: string
  displayName: string
  wellknownListName: string
  isOwner: number
  isShared: number
  createdAt: string
}

function toEntry(row: Row): ListEntry {
  return {
    id: row.id,
    displayName: row.displayName,
    wellknownListName: row.wellknownListName,
    isOwner: row.isOwner === 1,
    isShared: row.isShared === 1,
    createdAt: row.createdAt,
  }
}

/** `better-sqlite3` is loaded lazily so a Postgres-only deployment never needs the native build. */
async function openDatabase(): Promise<DatabaseType.Database> {
  const mod = await import("better-sqlite3")
  const Ctor = (mod.default ?? mod) as unknown as typeof DatabaseType
  const path = process.env.LIST_DB_PATH || join(process.cwd(), "lists.db")
  return new Ctor(path)
}

export class SqliteListStore implements ListStore {
  private constructor(
    private readonly db: DatabaseType.Database,
    private readonly table: string,
  ) {}

  static async create(): Promise<SqliteListStore> {
    const prefix = getTablePrefix()
    return new SqliteListStore(await openDatabase(), `${prefix}lists`)
  }

  async save(list: ListInput): Promise<void> {
    return this.saveMany([list])
  }

  async saveMany(lists: ListInput[]): Promise<void> {
    if (lists.length === 0) return

    // createdAt is absent from the DO UPDATE list on purpose — see the Postgres driver.
    // This is an upsert rather than the INSERT OR REPLACE used before the multi-driver
    // split, which deleted and re-inserted the row and so reset createdAt on every merge.
    const stmt = this.db.prepare(
      `INSERT INTO ${this.table} (id, displayName, wellknownListName, isOwner, isShared, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         displayName       = excluded.displayName,
         wellknownListName = excluded.wellknownListName,
         isOwner           = excluded.isOwner,
         isShared          = excluded.isShared`,
    )
    const now = new Date().toISOString()
    const insertAll = this.db.transaction((batch: ListInput[]) => {
      for (const list of batch) {
        stmt.run(
          list.id,
          list.displayName,
          list.wellknownListName ?? "none",
          list.isOwner !== false ? 1 : 0,
          list.isShared ? 1 : 0,
          now,
        )
      }
    })
    insertAll(lists)
  }

  async getAll(): Promise<ListEntry[]> {
    const rows = this.db.prepare(`SELECT * FROM ${this.table} ORDER BY createdAt ASC, id ASC`).all() as Row[]
    return rows.map(toEntry)
  }

  async getById(id: string): Promise<ListEntry | undefined> {
    const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id) as Row | undefined
    return row ? toEntry(row) : undefined
  }

  async updateDisplayName(id: string, displayName: string): Promise<void> {
    this.db.prepare(`UPDATE ${this.table} SET displayName = ? WHERE id = ?`).run(displayName, id)
  }

  async remove(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

export class SqliteMigrationTarget implements MigrationTarget {
  private constructor(
    private readonly db: DatabaseType.Database,
    private readonly versionTable: string,
    private readonly prefix: string,
  ) {}

  static async create(): Promise<SqliteMigrationTarget> {
    const prefix = getTablePrefix()
    return new SqliteMigrationTarget(await openDatabase(), `${prefix}schema_migrations`, prefix)
  }

  async ensureVersionTable(): Promise<void> {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.versionTable} (
         version    TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    )
  }

  async appliedVersions(): Promise<Set<string>> {
    const rows = this.db.prepare(`SELECT version FROM ${this.versionTable}`).all() as {
      version: string
    }[]
    return new Set(rows.map((r) => r.version))
  }

  async apply(version: string, sql: string): Promise<void> {
    // SQLite also has transactional DDL. db.exec cannot run inside better-sqlite3's
    // transaction() helper (which forbids nested BEGIN), so the statements are issued
    // directly and rolled back by hand on failure.
    this.db.exec("BEGIN")
    try {
      this.db.exec(applyPrefix(sql, this.prefix))
      this.db
        .prepare(`INSERT INTO ${this.versionTable} (version, applied_at) VALUES (?, ?)`)
        .run(version, new Date().toISOString())
      this.db.exec("COMMIT")
    } catch (err) {
      try {
        this.db.exec("ROLLBACK")
      } catch {}
      throw err
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
