import { NextResponse } from 'next/server'
import { requireAuth, resultResponse, guard } from '@/lib/api-utils'
import { handleListFriends } from '@/lib/api-handlers'

export async function GET() {
  return guard('friends.list', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const result = await handleListFriends(db, userId)
    return resultResponse(result)
  })
}
