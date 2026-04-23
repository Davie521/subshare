import { NextRequest, NextResponse } from 'next/server'
import { eq, and, sql } from 'drizzle-orm'
import { timingSafeEqual } from 'crypto'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { runBillingCron } from '@/lib/api-handlers'
import { todayInAppTz } from '@/lib/date-utils'

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
 *
 * Two-phase flow:
 *   1. Advance `nextPayment` on every due (auto-renew) subscription —
 *      pure field update, no bill generation.
 *   2. Run the monthly R1 pass via `runBillingCron`, which calls
 *      `generateMonthlyBills` and relies on the UNIQUE(sub, user,
 *      billing_date) index to stay idempotent if the day-1 tick already
 *      succeeded earlier this month.
 *
 * Splitting these responsibilities (vs the legacy
 * `generateAndSaveBillingRecords` that did both per-sub) keeps R1
 * generation a single authoritative path.
 *
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
  const today = todayInAppTz()

  const dueSubs = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        sql`${schema.subscriptions.nextPayment} <= ${today}`,
        eq(schema.subscriptions.autoRenew, true),
        // Dormant subs (flagged cancelled in the seed/legacy path) must not
        // auto-advance their nextPayment or they'd silently roll forward
        // month after month.
        eq(schema.subscriptions.inactive, false)
      )
    )

  const errors: Array<{ subId: number; error: string }> = []

  for (const sub of dueSubs) {
    try {
      const [y, m, d] = sub.nextPayment.split('-').map(Number)
      const nextMonth = m === 12 ? 1 : m + 1
      const nextYear = m === 12 ? y + 1 : y
      const maxDay = new Date(nextYear, nextMonth, 0).getDate()
      const clampedDay = Math.min(d, maxDay)
      const newNextPayment = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`

      await db
        .update(schema.subscriptions)
        .set({ nextPayment: newNextPayment })
        .where(eq(schema.subscriptions.id, sub.id))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[cron/billing] advance nextPayment sub', sub.id, 'failed:', message)
      errors.push({ subId: sub.id, error: message })
    }
  }

  // R1 monthly pass. Idempotent via UNIQUE — safe to run every cron tick.
  const monthly = await runBillingCron(db)

  return NextResponse.json({
    processed: dueSubs.length,
    failed: errors.length,
    errors,
    monthlyBillsGenerated: monthly.success
      ? monthly.data!.monthlyBillsGenerated
      : 0,
    monthlyError: monthly.success ? null : monthly.error,
  })
}
