import { NextResponse } from 'next/server'
import { requireAuth, parseId } from '@/lib/api-utils'
import { handleRemoveMember } from '@/lib/api-handlers'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId: actorId, db } = auth

  const p = await params
  const subId = parseId(p.id)
  const targetUserId = parseId(p.userId)
  if (subId === null || targetUserId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const result = handleRemoveMember(db, actorId, subId, targetUserId)
  if (!result.success) {
    const isPermission = /owner|payer|permission/i.test(result.error)
    return NextResponse.json(
      { error: result.error },
      { status: isPermission ? 403 : 400 }
    )
  }
  return NextResponse.json({ ok: true })
}
