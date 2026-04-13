import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleGetDashboard } from '@/lib/api-handlers'
import { checkRateLimit } from '@/lib/rate-limit'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  if (!checkRateLimit(`dashboard:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const dashboard = await handleGetDashboard(db, userId)
  return NextResponse.json(dashboard)
}
