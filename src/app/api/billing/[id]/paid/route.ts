import { NextResponse } from 'next/server'
import { requireAuth, parseId } from '@/lib/api-utils'
import { handleMarkPaid } from '@/lib/api-handlers'

export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const result = await handleMarkPaid(db, userId, numId)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
