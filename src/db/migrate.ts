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

// `npm run migrate` — also what the container entrypoint calls before starting the server.
// Paths are resolved on both sides rather than compared as file:// strings, so this still
// detects direct invocation on Windows, where argv[1] is a drive-letter path.
const invokedDirectly = !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const { default: dotenv } = await import("dotenv")
  dotenv.config()
  migrate()
    .then((r) => {
      console.error(
        r.applied.length > 0
          ? `Migration complete: applied ${r.applied.length} migration(s).`
          : "Migration complete: no changes.",
      )
      process.exit(0)
    })
    .catch((err) => {
      console.error("Migration failed:", err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
