import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleLeaveGroup } from '@/lib/api-handlers'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params

  const result = handleLeaveGroup(db, userId, parseInt(id))
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
