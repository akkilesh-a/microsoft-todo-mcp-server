export interface ListEntry {
  id: string
  displayName: string
  wellknownListName: string
  isOwner: boolean
  isShared: boolean
  createdAt: string
}

export interface ListInput {
  id: string
  displayName: string
  wellknownListName?: string
  isOwner?: boolean
  isShared?: boolean
}

/**
 * The storage contract, implemented once per dialect. Everything is async because the
 * Postgres driver has to be — the SQLite driver is synchronous underneath and simply
 * returns resolved promises.
 */
export interface ListStore {
  save(list: ListInput): Promise<void>
  saveMany(lists: ListInput[]): Promise<void>
  getAll(): Promise<ListEntry[]>
  getById(id: string): Promise<ListEntry | undefined>
  updateDisplayName(id: string, displayName: string): Promise<void>
  remove(id: string): Promise<void>
  close(): Promise<void>
}

/**
 * The minimal surface the migration runner needs. Each driver supplies one; the runner
 * itself is dialect-agnostic.
 */
export interface MigrationTarget {
  ensureVersionTable(): Promise<void>
  appliedVersions(): Promise<Set<string>>
  /** Must apply the statements and record the version atomically. */
  apply(version: string, sql: string): Promise<void>
  close(): Promise<void>
}
