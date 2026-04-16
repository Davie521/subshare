import { NextRequest, NextResponse } from 'next/server'
import {
  requireAuth,
  parseId,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { createInvite } from '@/lib/invites'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.invites.create', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'invites-create', 10, 60_000)
    if (limited) return limited

    const subId = parseId((await params).id)
    if (subId === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = await createInvite(db, userId, subId)
    return resultResponse(result, 201)
  })
}
