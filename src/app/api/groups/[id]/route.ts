import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { getGroupWithMembers } from '@/lib/db-operations'
import { handleDeleteGroup } from '@/lib/api-handlers'
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

  // Membership check — prevent IDOR
  const membership = db
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, numId), eq(schema.groupMembers.userId, userId)))
    .get()
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const group = getGroupWithMembers(db, numId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const subs = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.groupId, numId))
    .all()

  return NextResponse.json({ ...group, subscriptions: subs })
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

  const result = handleDeleteGroup(db, userId, numId)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
