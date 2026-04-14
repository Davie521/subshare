import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleMarkAllNotificationsRead } from '@/lib/api-handlers'

export async function PUT() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const result = await handleMarkAllNotificationsRead(db, userId)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
