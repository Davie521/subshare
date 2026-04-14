import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleListFriends } from '@/lib/api-handlers'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const result = handleListFriends(db, userId)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}
