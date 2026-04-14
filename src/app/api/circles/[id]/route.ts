import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, parseId } from '@/lib/api-utils'
import {
  handleGetCircle,
  handleUpdateCircle,
  handleDeleteCircle,
} from '@/lib/api-handlers'
import { updateCircleSchema } from '@/lib/validators'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const result = await handleGetCircle(db, userId, numId)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === 'Not found' ? 404 : 400 }
    )
  }
  return NextResponse.json(result.data)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const parsed = updateCircleSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const result = await handleUpdateCircle(db, userId, numId, parsed.data)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === 'Not found' ? 404 : 400 }
    )
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const result = await handleDeleteCircle(db, userId, numId)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === 'Not found' ? 404 : 400 }
    )
  }
  return NextResponse.json({ ok: true })
}
