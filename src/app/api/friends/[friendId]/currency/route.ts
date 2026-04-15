import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api-utils'
import { handleSetFriendCurrency } from '@/lib/api-handlers'

const bodySchema = z.object({
  /** ISO currency code, or null to clear and use preferredCurrency. */
  currency: z
    .enum(['CNY', 'USD', 'HKD', 'CAD', 'EUR', 'GBP', 'JPY'])
    .nullable(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const { friendId } = await params
  const friendIdNum = Number(friendId)
  if (!Number.isInteger(friendIdNum) || friendIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid friendId' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const result = await handleSetFriendCurrency(
    db,
    userId,
    friendIdNum,
    parsed.data.currency
  )
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}
