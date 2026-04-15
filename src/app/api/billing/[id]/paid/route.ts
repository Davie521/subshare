import { NextResponse } from 'next/server'
import {
  requireAuth,
  parseId,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleMarkPaid } from '@/lib/api-handlers'

async function markPaid(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guard('billing.markPaid', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'bill-paid', 60, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const result = await handleMarkPaid(db, userId, numId)
    return resultResponse(result)
  })
}

// POST is the idiomatic verb for a state transition like unpaid -> paid.
// PUT is preserved as an alias for backwards compatibility with existing
// clients.
export const POST = markPaid
export const PUT = markPaid
