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
  handleGetSubscription,
  handleUpdateSubscription,
  handleDeleteSubscription,
  statusForResultCode,
} from '@/lib/api-handlers'
import { updateSubscriptionSchema } from '@/lib/validators'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.get', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth
    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const result = await handleGetSubscription(db, userId, numId)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: statusForResultCode(result.code) }
      )
    }
    return NextResponse.json(result.data)
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.update', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'sub-update', 60, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = updateSubscriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const result = await handleUpdateSubscription(db, userId, numId, parsed.data)
    return resultResponse(result)
  })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.delete', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'sub-delete', 30, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const result = await handleDeleteSubscription(db, userId, numId)
    return resultResponse(result)
  })
}
