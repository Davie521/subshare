import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api-utils'
import {
  handleGetSettlement,
  handleMarkPairSettled,
} from '@/lib/api-handlers'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const result = await handleGetSettlement(db, userId)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}

const settleSchema = z.object({
  counterpartyUserId: z.number().int().positive(),
  currency: z.string().min(3).max(5),
})

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const parsed = settleSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const result = await handleMarkPairSettled(
    db,
    userId,
    parsed.data.counterpartyUserId,
    parsed.data.currency
  )
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}
