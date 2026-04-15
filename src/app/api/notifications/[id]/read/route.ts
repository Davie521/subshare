import { NextResponse } from 'next/server'
import {
  requireAuth,
  parseId,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleMarkNotificationRead } from '@/lib/api-handlers'

export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('notifications.read', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'notif-read', 120, 60_000)
    if (limited) return limited

    const id = parseId((await params).id)
    if (id === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = await handleMarkNotificationRead(db, userId, id)
    return resultResponse(result)
  })
}
