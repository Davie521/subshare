import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, resultResponse, guard } from '@/lib/api-utils'
import { handleListNotifications } from '@/lib/api-handlers'

export async function GET(req: NextRequest) {
  return guard('notifications.list', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200)

    const result = await handleListNotifications(db, userId, limit)
    return resultResponse(result)
  })
}
