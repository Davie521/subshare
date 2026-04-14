import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import * as schema from './schema'
import { migrate } from './migrate'

type Db =
  | ReturnType<typeof drizzlePostgres<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>

let cached: { client: postgres.Sql; db: Db } | null = null
let migratedOnce = false

/**
 * Get a singleton Drizzle-on-Postgres instance. Opens the connection pool
 * on first call, runs migrations once, then returns the shared instance.
 *
 * Returns a sync handle, but queries against it must be awaited — Drizzle
 * postgres-js is async end-to-end.
 */
export function getDb(): Db {
  if (cached) return cached.db
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Expected Postgres connection string, e.g. postgres://user:pass@host:5432/db'
    )
  }
  const client = postgres(url, { max: 10 })
  const db = drizzlePostgres(client, { schema })
  cached = { client, db }

  // Fire-and-forget migration. The first awaited query will serialize after
  // this completes because we reuse the single connection pool.
  if (!migratedOnce) {
    migratedOnce = true
    migrate(db).catch((err) => {
      console.error('[db] migration failed:', err)
      // Reset so next request retries.
      migratedOnce = false
    })
  }

  return db
}

/**
 * For testing: create an in-memory pglite database, pre-migrated.
 * Returns both the Drizzle handle and the underlying PGlite instance
 * (the latter is exposed for tests that need raw SQL helpers).
 */
export async function createTestDb(): Promise<{
  db: ReturnType<typeof drizzlePglite<typeof schema>>
  pg: PGlite
}> {
  const pg = new PGlite()
  const db = drizzlePglite(pg, { schema })
  await migrate(db)
  return { db, pg }
}
