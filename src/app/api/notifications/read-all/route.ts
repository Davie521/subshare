import { NextResponse } from 'next/server'
import { requireAuth, resultResponse, rateLimitUser, guard } from '@/lib/api-utils'
import { handleMarkAllNotificationsRead } from '@/lib/api-handlers'

export async function PUT() {
  return guard('notifications.readAll', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'notif-read-all', 30, 60_000)
    if (limited) return limited

    const result = await handleMarkAllNotificationsRead(db, userId)
    return resultResponse(result)
  })
}
