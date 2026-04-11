import { hashSync, compareSync } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export function registerUser(
  db: DB,
  input: { name: string; email: string; password: string; preferredCurrency?: string }
): { id: number; name: string; email: string } | { error: string } {
  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .get()

  if (existing) return { error: 'Email already registered' }

  const hash = hashSync(input.password, 10)
  const user = db
    .insert(schema.users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash: hash,
      preferredCurrency: input.preferredCurrency ?? 'CNY',
    })
    .returning()
    .get()

  return { id: user.id, name: user.name, email: user.email }
}

export function loginUser(
  db: DB,
  input: { email: string; password: string }
): { id: number; name: string; email: string } | { error: string } {
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .get()

  if (!user) return { error: 'Invalid email or password' }
  if (!compareSync(input.password, user.passwordHash))
    return { error: 'Invalid email or password' }

  return { id: user.id, name: user.name, email: user.email }
}
