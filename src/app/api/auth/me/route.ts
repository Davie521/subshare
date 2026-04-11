import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { getSession } from '@/lib/session'
import * as schema from '@/db/schema'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const db = getDb()
  const user = db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      preferredCurrency: schema.users.preferredCurrency,
      monthlyBudget: schema.users.monthlyBudget,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get()

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json(user)
}
