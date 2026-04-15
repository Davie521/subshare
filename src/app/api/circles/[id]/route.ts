import { NextRequest, NextResponse } from 'next/server'
import {
  requireAuth,
  parseId,
  readJson,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
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
  return guard('circles.get', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth
    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const result = await handleGetCircle(db, userId, numId)
    return resultResponse(result)
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('circles.update', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'circle-update', 30, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = updateCircleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const result = await handleUpdateCircle(db, userId, numId, parsed.data)
    return resultResponse(result)
  })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('circles.delete', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'circle-delete', 30, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const result = await handleDeleteCircle(db, userId, numId)
    return resultResponse(result)
  })
}
