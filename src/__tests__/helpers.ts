import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@/db/schema'
import { migrate } from '@/db/migrate'
import { beforeEach, afterEach, vi } from 'vitest'

/**
 * Pin "today" for a test file. Several handlers fall back to
 * todayInAppTz() (e.g. the ±1-month effectiveFrom window, nextPayment
 * normalisation on create), so suites written around fixed 2026 dates
 * started failing once the real date moved past them. Only Date is
 * faked, so pglite's timers keep working. Noon in Asia/Shanghai keeps
 * the app-timezone date equal to `date`.
 */
export function pinToday(date: string): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${date}T04:00:00Z`))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

export type TestDb = ReturnType<typeof drizzle<typeof schema>>

export interface SqliteShim {
  pragma: (s: string) => void
  exec: (s: string) => Promise<void>
  prepare: (sql: string) => {
    get: <T = unknown>(...args: unknown[]) => Promise<T | undefined>
    all: <T = unknown>(...args: unknown[]) => Promise<T[]>
    run: (
      ...args: unknown[]
    ) => Promise<{ changes: number; lastInsertRowid: number }>
  }
}

function sqliteToPg(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

function makeShim(pg: PGlite): SqliteShim {
  return {
    pragma: () => {
      // no-op on Postgres
    },
    exec: async (s) => {
      await pg.exec(s)
    },
    prepare: (sql: string) => {
      const pgSql = sqliteToPg(sql)
      return {
        get: async <T = unknown>(...args: unknown[]) => {
          const { rows } = await pg.query(pgSql, args)
          return (rows[0] as T) ?? undefined
        },
        all: async <T = unknown>(...args: unknown[]) => {
          const { rows } = await pg.query(pgSql, args)
          return rows as T[]
        },
        run: async (...args: unknown[]) => {
          const res = await pg.query(pgSql, args)
          return {
            changes: res.affectedRows ?? res.rows.length,
            lastInsertRowid: 0,
          }
        },
      }
    },
  }
}

export async function setupTestDb(): Promise<{
  db: TestDb
  pg: PGlite
  sqlite: SqliteShim
}> {
  const pg = new PGlite()
  const db = drizzle(pg, { schema })
  await migrate(db)
  return { db, pg, sqlite: makeShim(pg) }
}

/** Insert a test user and return their id. */
export async function createUser(
  db: TestDb,
  opts: { name?: string; email?: string; currency?: string } = {}
): Promise<number> {
  const name = opts.name || 'Test User'
  const email =
    opts.email ||
    `user${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.com`
  const currency = opts.currency || 'CNY'

  const [row] = await db
    .insert(schema.users)
    .values({
      name,
      email,
      googleId: `test-google-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      preferredCurrency: currency,
    })
    .returning({ id: schema.users.id })

  return row.id
}

/**
 * Insert a subscription_members row directly (bypassing addMemberToSubscription
 * so tests can exercise specific addedAt / leftAt states without triggering
 * R2 bills or friendships).
 */
export async function addSubMember(
  sqlite: SqliteShim,
  subscriptionId: number,
  userId: number,
  opts: { addedAt?: string; addedBy?: number; leftAt?: string | null } = {}
): Promise<void> {
  const addedAt = opts.addedAt ?? new Date().toISOString().slice(0, 10)
  const addedBy = opts.addedBy ?? userId
  const leftAt = opts.leftAt ?? null
  await sqlite
    .prepare(
      `INSERT INTO subscription_members (subscription_id, user_id, added_at, added_by, left_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(subscriptionId, userId, addedAt, addedBy, leftAt)
}
