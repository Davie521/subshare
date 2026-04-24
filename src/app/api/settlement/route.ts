import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  requireAuth,
  readJson,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { CURRENCIES } from '@/lib/validators'
import {
  handleGetSettlement,
  handleMarkPairSettled,
} from '@/lib/api-handlers'

export async function GET() {
  return guard('settlement.get', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const result = await handleGetSettlement(db, userId)
    return resultResponse(result)
  })
}

const settleSchema = z.object({
  counterpartyUserId: z.number().int().positive(),
  /** Omit to settle every unpaid bill with this counterparty regardless of currency. */
  currency: z.enum(CURRENCIES).optional(),
  /**
   * Optional scope for the settle: only flip these bill IDs. Used by
   * the Settlement page's "Show upcoming" toggle (Phase 3) so a press
   * doesn't sweep bills the user can't see. Empty array means no-op.
   * Capped at 200 to keep the SQL `IN` list bounded.
   */
  billIds: z.array(z.number().int().positive()).max(200).optional(),
})

export async function POST(req: NextRequest) {
  return guard('settlement.markPaid', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'settlement-mark', 30, 60_000)
    if (limited) return limited

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = settleSchema.safeParse(body)
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
      parsed.data.currency,
      parsed.data.billIds
    )
    return resultResponse(result)
  })
}
