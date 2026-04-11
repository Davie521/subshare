import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { getSubscriptionsForUser } from '@/lib/db-operations'
import { handleCreateSubscription } from '@/lib/api-handlers'

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

  const body = await req.json()
  const { name, price, currency, nextPayment, groupId, logo, url, notes, categoryId } = body

  if (!name || !price || !currency || !nextPayment) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const result = handleCreateSubscription(db, userId, {
    name, price, currency, nextPayment, groupId, logo, url, notes, categoryId,
  })

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.data, { status: 201 })
}
