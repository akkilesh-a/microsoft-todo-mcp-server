import { getDialect } from "./config.js"
import type { ListStore } from "./types.js"

export type { ListEntry, ListInput, ListStore } from "./types.js"
export { getDialect, getTablePrefix } from "./config.js"
export { migrate } from "./migrate.js"

let storePromise: Promise<ListStore> | null = null

/**
 * The process-wide store, created on first use. The promise itself is cached rather than the
 * resolved value so that concurrent callers during startup share one connection pool instead
 * of racing to create several.
 */
export function getStore(): Promise<ListStore> {
  if (!storePromise) {
    storePromise = (async () => {
      if (getDialect() === "postgres") {
        const { PostgresListStore } = await import("./postgres.js")
        return PostgresListStore.create()
      }
      const { SqliteListStore } = await import("./sqlite.js")
      return SqliteListStore.create()
    })()
  }
  return storePromise
}

export async function closeStore(): Promise<void> {
  if (!storePromise) return
  const store = await storePromise
  storePromise = null
  await store.close()
}
