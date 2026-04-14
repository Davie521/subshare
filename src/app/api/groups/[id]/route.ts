import { NextResponse } from 'next/server'
import { requireAuth, parseId } from '@/lib/api-utils'
import { getGroupWithMembers } from '@/lib/db-operations'
import { handleDeleteGroup } from '@/lib/api-handlers'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema'

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
  const [membership] = await db
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, numId), eq(schema.groupMembers.userId, userId)))
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const group = await getGroupWithMembers(db, numId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const subs = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.groupId, numId))

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

  const result = await handleDeleteGroup(db, userId, numId)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
