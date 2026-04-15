import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  requireAuth,
  parseId,
  readJson,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleTransferPayer } from '@/lib/api-handlers'

const payerSchema = z.object({
  newPayerId: z.number().int().positive(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.payer.transfer', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'payer-transfer', 20, 60_000)
    if (limited) return limited

    const subId = parseId((await params).id)
    if (subId === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = payerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const result = await handleTransferPayer(db, userId, subId, parsed.data.newPayerId)
    return resultResponse(result)
  })
}
