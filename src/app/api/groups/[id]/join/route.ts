import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleJoinGroup } from '@/lib/api-handlers'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params

  // id here is the publicId from the invite link
  const result = await handleJoinGroup(db, userId, id)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
