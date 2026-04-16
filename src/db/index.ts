import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import * as schema from './schema'
import { migrate } from './migrate'

type Db =
  | ReturnType<typeof drizzlePostgres<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>

let pending: Promise<Db> | null = null

/**
 * Get a singleton Drizzle-on-Postgres instance. Opens the connection pool
 * on first call, runs migrations once, then returns the shared instance.
 *
 * Async so that callers are guaranteed never to hit an un-migrated schema.
 * The underlying promise is cached, so concurrent calls during startup all
 * wait on the same migration run.
 */
export function getDb(): Promise<Db> {
  if (pending) return pending
  pending = (async () => {
    const url = process.env.DATABASE_URL
    if (!url) {
      pending = null
      throw new Error(
        'DATABASE_URL is not set. Expected Postgres connection string, e.g. postgres://user:pass@host:5432/db'
      )
    }
    const ssl = process.env.PGSSLMODE === 'disable' ? false : 'prefer'
    const client = postgres(url, { max: 10, ssl })
    const db = drizzlePostgres(client, { schema })
    try {
      await migrate(db)
    } catch (err) {
      console.error('[db] migration failed:', err)
      pending = null
      await client.end().catch(() => {})
      throw err
    }
    return db
  })()
  return pending
}
