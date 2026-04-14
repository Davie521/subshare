import { NextRequest, NextResponse } from 'next/server'
import { eq, and, sql, inArray, isNull, or, gte } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { generateAndSaveBillingRecords } from '@/lib/db-operations'
import { getRate } from '@/lib/fx-cache'
import { runBillingCron } from '@/lib/api-handlers'

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

  // All active auto-renew subs whose next_payment has arrived.
  // Personal subs (1 member) are no-ops in generateAndSaveBillingRecords
  // but still get next_payment advanced for correct display.
  const dueSubs = db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
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

  // A10 — monthly R1 pass. Runs the new subscription-centric cron on
  // top of the legacy per-sub due advancement. No-op on non-1st days.
  const monthly = await runBillingCron(db)

  return NextResponse.json({
    processed: dueSubs.length,
    billsGenerated: totalGenerated,
    monthlyBillsGenerated: monthly.success
      ? monthly.data!.monthlyBillsGenerated
      : 0,
  })
}

type Sub = typeof schema.subscriptions.$inferSelect

async function fetchRequiredRates(
  db: ReturnType<typeof getDb>,
  subs: Sub[]
): Promise<Record<string, number>> {
  if (subs.length === 0) return {}

  const subIds = subs.map((s) => s.id)
  const today = new Date().toISOString().slice(0, 10)

  // For each due sub, collect its active members' preferred currencies via
  // subscription_members (authoritative). Legacy group_members is no longer
  // consulted — migrated data must also live in subscription_members.
  const memberCurrencies = db
    .select({
      subscriptionId: schema.subscriptionMembers.subscriptionId,
      preferredCurrency: schema.users.preferredCurrency,
    })
    .from(schema.subscriptionMembers)
    .innerJoin(
      schema.users,
      eq(schema.subscriptionMembers.userId, schema.users.id)
    )
    .where(
      and(
        inArray(schema.subscriptionMembers.subscriptionId, subIds),
        or(
          isNull(schema.subscriptionMembers.leftAt),
          gte(schema.subscriptionMembers.leftAt, today)
        )
      )
    )
    .all()

  const bySub = new Map<number, Set<string>>()
  for (const row of memberCurrencies) {
    const s = bySub.get(row.subscriptionId) ?? new Set<string>()
    s.add(row.preferredCurrency)
    bySub.set(row.subscriptionId, s)
  }

  const pairs = new Set<string>()
  for (const sub of subs) {
    const currencies = bySub.get(sub.id)
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
