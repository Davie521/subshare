import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { getGroupWithMembers } from '@/lib/db-operations'
import { handleDeleteGroup } from '@/lib/api-handlers'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { db } = auth
  const { id } = await params

  const group = getGroupWithMembers(db, parseInt(id))
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const subs = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.groupId, parseInt(id)))
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

  const result = handleDeleteGroup(db, userId, parseInt(id))
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
