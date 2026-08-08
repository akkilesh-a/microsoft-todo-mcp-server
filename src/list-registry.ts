/**
 * The local list registry.
 *
 * Microsoft Graph only returns well-known lists for personal accounts, so lists created
 * through this server are tracked here and merged back in. The storage behind it is either
 * a SQLite file (default) or Postgres (when DATABASE_URL is set) — see src/db/.
 *
 * These functions became async when Postgres was added. The SQLite path is still
 * synchronous underneath and resolves immediately.
 */
import { getStore } from "./db/index.js"
import type { ListEntry, ListInput } from "./db/types.js"

export type { ListEntry, ListInput }

export async function saveList(list: ListInput): Promise<void> {
  await (await getStore()).save(list)
}

export async function getAllLists(): Promise<ListEntry[]> {
  return (await getStore()).getAll()
}

export async function updateList(id: string, displayName: string): Promise<void> {
  await (await getStore()).updateDisplayName(id, displayName)
}

export async function removeList(id: string): Promise<void> {
  await (await getStore()).remove(id)
}

export async function getListById(id: string): Promise<ListEntry | undefined> {
  return (await getStore()).getById(id)
}

/** Merge API-returned lists (well-known) with locally tracked lists, deduplicating by ID. */
export async function mergeLists(apiLists: ListInput[]): Promise<ListEntry[]> {
  const store = await getStore()
  // One batched write rather than one per list: this runs on every get-task-lists call, and
  // against a remote Postgres a per-list round trip is the difference between 1 and N.
  await store.saveMany(apiLists)
  return store.getAll()
}
