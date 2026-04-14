import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@/db/schema'
import { migrate } from '@/db/migrate'
import { hashSync } from 'bcryptjs'

export type TestDb = ReturnType<typeof drizzle<typeof schema>>

export async function setupTestDb(): Promise<{ db: TestDb; pg: PGlite }> {
  const pg = new PGlite()
  const db = drizzle(pg, { schema })
  await migrate(db)
  return { db, pg }
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

  // Auto-add creator as member
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
