import { NextResponse } from 'next/server'
import {
  requireAuth,
  parseId,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleRemoveMember } from '@/lib/api-handlers'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  return guard('subscriptions.members.remove', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId: actorId, db } = auth

    const limited = rateLimitUser(actorId, 'members-remove', 30, 60_000)
    if (limited) return limited

    const p = await params
    const subId = parseId(p.id)
    const targetUserId = parseId(p.userId)
    if (subId === null || targetUserId === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = await handleRemoveMember(db, actorId, subId, targetUserId)
    return resultResponse(result)
  })
}
