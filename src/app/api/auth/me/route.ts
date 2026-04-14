import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db'
import { getSession } from '@/lib/session'
import * as schema from '@/db/schema'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const db = getDb()
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      preferredCurrency: schema.users.preferredCurrency,
      monthlyBudget: schema.users.monthlyBudget,
      displayName: schema.users.displayName,
      showEmail: schema.users.showEmail,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    ...user,
    displayName: user.displayName ?? '',
    showEmail: user.showEmail,
  })
}

const updateProfileSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  showEmail: z.boolean().optional(),
})

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const parsed = updateProfileSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.displayName !== undefined) {
    updates.displayName = parsed.data.displayName || null
  }
  if (parsed.data.showEmail !== undefined) {
    updates.showEmail = parsed.data.showEmail
  }

  if (Object.keys(updates).length > 0) {
    const db = getDb()
    await db
      .update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, session.userId))
  }

  return NextResponse.json({ ok: true })
}
