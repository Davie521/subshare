import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, readJson, resultResponse, rateLimitUser, guard } from '@/lib/api-utils'
import { getSubscriptionsForUser } from '@/lib/db-operations'
import { handleCreateSubscription } from '@/lib/api-handlers'
import { createSubscriptionSchema } from '@/lib/validators'

export async function GET() {
  return guard('subscriptions.list', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const subs = await getSubscriptionsForUser(db, userId)
    return NextResponse.json(subs)
  })
}

export async function POST(req: NextRequest) {
  return guard('subscriptions.create', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'sub-create', 30, 60_000)
    if (limited) return limited

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = createSubscriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const result = await handleCreateSubscription(db, userId, parsed.data)
    return resultResponse(result, 201)
  })
}
