import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { resultResponse, guard } from '@/lib/api-utils'
import { getInviteMetadata } from '@/lib/invites'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  return guard('invites.get', async () => {
    const { token } = await params
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }
    const db = await getDb()
    const result = await getInviteMetadata(db, token)
    return resultResponse(result)
  })
}
