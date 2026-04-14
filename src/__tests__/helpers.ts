import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@/db/schema'
import { migrate } from '@/db/migrate'
import { hashSync } from 'bcryptjs'

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
  const hash = hashSync('password123', 10)

  const [row] = await db
    .insert(schema.users)
    .values({
      name,
      email,
      passwordHash: hash,
      preferredCurrency: currency,
    })
    .returning({ id: schema.users.id })

  return row.id
}

/** Insert a test group and auto-add the creator as a member. */
export async function createGroup(
  db: TestDb,
  opts: {
    name?: string
    createdBy: number
    publicId?: string
    currency?: string
  }
): Promise<{ id: number; publicId: string }> {
  const name = opts.name || 'Test Group'
  const publicId =
    opts.publicId ||
    `test-${Date.now()}.${Math.random().toString(36).slice(2, 7)}`
  const currency = opts.currency || 'CNY'

  const [row] = await db
    .insert(schema.groups)
    .values({
      name,
      publicId,
      createdBy: opts.createdBy,
      defaultCurrency: currency,
    })
    .returning({ id: schema.groups.id })

  await db
    .insert(schema.groupMembers)
    .values({ groupId: row.id, userId: opts.createdBy })

  return { id: row.id, publicId }
}

/** Add a member to a group. */
export async function addMember(
  db: TestDb,
  groupId: number,
  userId: number
): Promise<void> {
  await db.insert(schema.groupMembers).values({ groupId, userId })
}
