/**
 * `npm run migrate` — applies outstanding migrations and exits.
 *
 * Deliberately a separate entry point from migrate.ts. That module is bundled into the
 * server, so anything here that runs on import would also run when the server starts.
 * Keeping the process-exiting half in its own file makes that impossible rather than
 * merely unlikely.
 */
import dotenv from "dotenv"
import { migrate } from "./migrate.js"

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
