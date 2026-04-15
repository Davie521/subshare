import { NextRequest, NextResponse } from 'next/server'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { timingSafeEqual } from 'crypto'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { generateAndSaveBillingRecords } from '@/lib/db-operations'
import { getRate } from '@/lib/fx-cache'
import { runBillingCron } from '@/lib/api-handlers'

const CRON_SECRET = process.env.CRON_SECRET

function authMatches(authHeader: string | null): boolean {
  if (!authHeader || !CRON_SECRET) return false
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`)
  const provided = Buffer.from(authHeader)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

/**
 * POST /api/cron/billing
 * Advances next_payment for due subscriptions and generates billing records.
 * Protected by CRON_SECRET header in production.
 */
export async function POST(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
  }
  if (!authMatches(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = await getDb()
  const today = new Date().toISOString().split('T')[0]

  const dueSubs = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        sql`${schema.subscriptions.nextPayment} <= ${today}`,
        eq(schema.subscriptions.inactive, false),
        eq(schema.subscriptions.autoRenew, true)
      )
    )

  const rates = await fetchRequiredRates(db, dueSubs)

  let totalGenerated = 0
  const errors: Array<{ subId: number; error: string }> = []

  for (const sub of dueSubs) {
    try {
      // R1/R2 — bills + nextPayment advance must be atomic. A crash between
      // them would re-bill the same period on the next cron tick.
      const count = await db.transaction(async (tx) => {
        const inserted = await generateAndSaveBillingRecords(tx, sub.id, rates)

        const [y, m, d] = sub.nextPayment.split('-').map(Number)
        const nextMonth = m === 12 ? 1 : m + 1
        const nextYear = m === 12 ? y + 1 : y
        const maxDay = new Date(nextYear, nextMonth, 0).getDate()
        const clampedDay = Math.min(d, maxDay)
        const newNextPayment = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`

        await tx
          .update(schema.subscriptions)
          .set({ nextPayment: newNextPayment })
          .where(eq(schema.subscriptions.id, sub.id))

        return inserted
      })
      totalGenerated += count
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[cron/billing] sub', sub.id, 'failed:', message)
      errors.push({ subId: sub.id, error: message })
    }
  }

  // A10 — monthly R1 pass. No-op on non-1st days.
  const monthly = await runBillingCron(db)

  return NextResponse.json({
    processed: dueSubs.length,
    failed: errors.length,
    errors,
    billsGenerated: totalGenerated,
    monthlyBillsGenerated: monthly.success
      ? monthly.data!.monthlyBillsGenerated
      : 0,
    monthlyError: monthly.success ? null : monthly.error,
  })
}

type Sub = typeof schema.subscriptions.$inferSelect

async function fetchRequiredRates(
  db: Awaited<ReturnType<typeof getDb>>,
  subs: Sub[]
): Promise<Record<string, number>> {
  if (subs.length === 0) return {}

  const subIds = subs.map((s) => s.id)
  const memberCurrencies = await db
    .select({
      subscriptionId: schema.subscriptionMembers.subscriptionId,
      preferredCurrency: schema.users.preferredCurrency,
    })
    .from(schema.subscriptionMembers)
    .innerJoin(
      schema.users,
      eq(schema.subscriptionMembers.userId, schema.users.id)
    )
    .where(inArray(schema.subscriptionMembers.subscriptionId, subIds))

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
