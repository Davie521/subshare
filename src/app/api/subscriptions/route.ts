import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { getSubscriptionsForUser } from '@/lib/db-operations'
import { handleCreateSubscription } from '@/lib/api-handlers'
import { createSubscriptionSchema } from '@/lib/validators'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const subs = getSubscriptionsForUser(db, userId)
  return NextResponse.json(subs)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const parsed = createSubscriptionSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const result = handleCreateSubscription(db, userId, parsed.data)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.data, { status: 201 })
}
