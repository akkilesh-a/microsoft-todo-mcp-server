import { defineConfig } from 'tsup'
import { copyFileSync } from 'fs'

export default defineConfig({
  entry: [
    'src/todo-index.ts',
    'src/list-registry.ts',
    'src/dashboard.ts',
    'src/db/migrate.ts'
  ],
  outDir: 'dist',
  format: ['esm'],
  target: 'node16',
  shims: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  // The two database drivers must stay external. better-sqlite3 is a native addon and
  // cannot be bundled at all; pg is left external so that the lazy `await import()` in each
  // driver is still a real runtime import, which is what lets a Postgres-only deployment
  // run without better-sqlite3 present and vice versa.
  external: ['dotenv', 'better-sqlite3', 'pg'],
  esbuildOptions(options) {
    options.platform = 'node'
  },
  async onSuccess() {
    copyFileSync('src/dashboard.html', 'dist/dashboard.html')
    console.log('Copied dashboard.html to dist/')
  }
})
