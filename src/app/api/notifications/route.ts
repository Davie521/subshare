import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleListNotifications } from '@/lib/api-handlers'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const limitRaw = req.nextUrl.searchParams.get('limit')
  const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200)

  const result = handleListNotifications(db, userId, limit)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}
