import { NextResponse } from 'next/server'
import { requireAuth, rateLimitUser, guard } from '@/lib/api-utils'
import { handleGetDashboard } from '@/lib/api-handlers'

export async function GET() {
  return guard('dashboard.get', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'dashboard', 60, 60_000)
    if (limited) return limited

    const dashboard = await handleGetDashboard(db, userId)
    return NextResponse.json(dashboard)
  })
}
