import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleGetDashboard } from '@/lib/api-handlers'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const dashboard = handleGetDashboard(db, userId)
  return NextResponse.json(dashboard)
}
