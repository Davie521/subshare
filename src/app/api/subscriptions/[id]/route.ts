import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleUpdateSubscription, handleDeleteSubscription } from '@/lib/api-handlers'
import { updateSubscriptionSchema } from '@/lib/validators'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema'

function parseId(id: string): number | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, numId))
    .get()

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorization: owner or group member
  if (sub.ownerId !== userId) {
    if (!sub.groupId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const membership = db
      .select()
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, sub.groupId), eq(schema.groupMembers.userId, userId)))
      .get()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(sub)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const parsed = updateSubscriptionSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const result = handleUpdateSubscription(db, userId, numId, parsed.data)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const result = handleDeleteSubscription(db, userId, numId)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
