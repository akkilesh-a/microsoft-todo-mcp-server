import { existsSync, readdirSync, readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"
import { getDialect, getTablePrefix, type Dialect } from "./config.js"
import type { MigrationTarget } from "./types.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Locates migrations/<dialect>/ by walking up from the compiled file. Walking rather than
 * hardcoding a depth keeps this working whether the bundle lands in dist/ or dist/db/, and
 * whether it runs from the repo, an npm install, or /app in the container.
 */
function resolveMigrationsDir(dialect: Dialect): string {
  const override = process.env.MIGRATIONS_DIR
  if (override) return resolve(override, dialect)

  let dir = __dirname
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "migrations", dialect)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `Could not find a migrations/${dialect} directory above ${__dirname}. ` +
      `Set MIGRATIONS_DIR to the directory containing postgres/ and sqlite/.`,
  )
}

async function createTarget(dialect: Dialect): Promise<MigrationTarget> {
  if (dialect === "postgres") {
    const { PostgresMigrationTarget } = await import("./postgres.js")
    return PostgresMigrationTarget.create()
  }
  const { SqliteMigrationTarget } = await import("./sqlite.js")
  return SqliteMigrationTarget.create()
}

export interface MigrateResult {
  dialect: Dialect
  applied: string[]
  alreadyApplied: number
}

/**
 * Applies every migration file not yet recorded, in filename order. Safe to call on every
 * boot: already-applied versions are skipped, so it is a no-op once the schema is current.
 */
export async function migrate(options: { silent?: boolean } = {}): Promise<MigrateResult> {
  const dialect = getDialect()
  const prefix = getTablePrefix()
  const dir = resolveMigrationsDir(dialect)

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  const log = (msg: string) => {
    if (!options.silent) console.error(msg)
  }

  log(`Migrations: ${dialect}${prefix ? ` (table prefix "${prefix}")` : ""} — ${files.length} file(s) in ${dir}`)

  const target = await createTarget(dialect)
  const applied: string[] = []
  try {
    await target.ensureVersionTable()
    const done = await target.appliedVersions()

    for (const file of files) {
      const version = file.replace(/\.sql$/, "")
      if (done.has(version)) continue
      const sql = readFileSync(join(dir, file), "utf8")
      await target.apply(version, sql)
      applied.push(version)
      log(`  applied ${version}`)
    }

    if (applied.length === 0) log("  already up to date")
    return { dialect, applied, alreadyApplied: done.size }
  } finally {
    await target.close()
  }
}

// The `npm run migrate` entry point lives in migrate-cli.ts, NOT here. This module is
// bundled into the server, and a run-if-invoked-directly guard would compare import.meta.url
// against argv[1] — both of which point at todo-index.js once inlined. The guard would pass,
// the CLI would run on import, and the server would exit 0 after migrating instead of
// listening.
