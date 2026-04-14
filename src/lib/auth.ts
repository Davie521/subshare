import { hashSync, compareSync } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export async function registerUser(
  db: DB,
  input: {
    name: string
    email: string
    password: string
    preferredCurrency?: string
  }
): Promise<{ id: number; name: string; email: string } | { error: string }> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))

  if (existing) return { error: 'Email already registered' }

  const hash = hashSync(input.password, 10)
  const [user] = await db
    .insert(schema.users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash: hash,
      preferredCurrency: input.preferredCurrency ?? 'CNY',
    })
    .returning()

  return { id: user.id, name: user.name, email: user.email }
}

export async function loginUser(
  db: DB,
  input: { email: string; password: string }
): Promise<{ id: number; name: string; email: string } | { error: string }> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, input.email))

  if (!user) return { error: 'Invalid email or password' }
  if (!compareSync(input.password, user.passwordHash))
    return { error: 'Invalid email or password' }

  return { id: user.id, name: user.name, email: user.email }
}
