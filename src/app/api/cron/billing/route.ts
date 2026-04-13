import { NextRequest, NextResponse } from 'next/server'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { generateAndSaveBillingRecords } from '@/lib/db-operations'
import { getRate } from '@/lib/fx-cache'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * POST /api/cron/billing
 * Advances next_payment for due subscriptions and generates billing records.
 * Protected by CRON_SECRET header in production.
 */
export async function POST(req: NextRequest) {
  // Auth: fail closed — refuse to run without a configured secret
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()
  const today = new Date().toISOString().split('T')[0]

  // Find shared subscriptions where next_payment <= today
  const dueSubs = db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        sql`${schema.subscriptions.groupId} IS NOT NULL`,
        sql`${schema.subscriptions.nextPayment} <= ${today}`,
        eq(schema.subscriptions.inactive, 0),
        eq(schema.subscriptions.autoRenew, 1)
      )
    )
    .all()

  const rates = await fetchRequiredRates(db, dueSubs)

  let totalGenerated = 0

  for (const sub of dueSubs) {
    const count = generateAndSaveBillingRecords(db, sub.id, rates)
    totalGenerated += count

    // Advance next_payment by one month
    const [y, m, d] = sub.nextPayment.split('-').map(Number)
    const nextMonth = m === 12 ? 1 : m + 1
    const nextYear = m === 12 ? y + 1 : y
    const maxDay = new Date(nextYear, nextMonth, 0).getDate()
    const clampedDay = Math.min(d, maxDay)
    const newNextPayment = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`

    db.update(schema.subscriptions)
      .set({ nextPayment: newNextPayment })
      .where(eq(schema.subscriptions.id, sub.id))
      .run()
  }

  return NextResponse.json({
    processed: dueSubs.length,
    billsGenerated: totalGenerated,
  })
}

type Sub = typeof schema.subscriptions.$inferSelect

async function fetchRequiredRates(
  db: ReturnType<typeof getDb>,
  subs: Sub[]
): Promise<Record<string, number>> {
  const groupIds = Array.from(
    new Set(subs.map((s) => s.groupId).filter((g): g is number => g !== null))
  )
  if (groupIds.length === 0) return {}

  const memberCurrencies = db
    .select({
      groupId: schema.groupMembers.groupId,
      preferredCurrency: schema.users.preferredCurrency,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.groupMembers.userId, schema.users.id))
    .where(inArray(schema.groupMembers.groupId, groupIds))
    .all()

  const byGroup = new Map<number, Set<string>>()
  for (const row of memberCurrencies) {
    const s = byGroup.get(row.groupId) ?? new Set<string>()
    s.add(row.preferredCurrency)
    byGroup.set(row.groupId, s)
  }

  const pairs = new Set<string>()
  for (const sub of subs) {
    if (sub.groupId === null) continue
    const currencies = byGroup.get(sub.groupId)
    if (!currencies) continue
    for (const to of currencies) {
      if (to !== sub.currency) pairs.add(`${sub.currency}_${to}`)
    }
  }

  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(pairs).map(async (key) => {
      const [from, to] = key.split('_')
      const rate = await getRate(from, to)
      if (rate !== null) rates[key] = rate
    })
  )
  return rates
}
