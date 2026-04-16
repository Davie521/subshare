import { NextRequest, NextResponse } from 'next/server'
import {
  requireAuth,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { acceptInvite } from '@/lib/invites'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  return guard('invites.accept', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'invites-accept', 30, 60_000)
    if (limited) return limited

    const { token } = await params
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const result = await acceptInvite(db, userId, token)
    return resultResponse(result)
  })
}
