import { NextRequest, NextResponse } from 'next/server'
import { eq, and, sql } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { generateAndSaveBillingRecords } from '@/lib/db-operations'

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

  let totalGenerated = 0

  for (const sub of dueSubs) {
    // Generate billing records for current period
    const count = generateAndSaveBillingRecords(db, sub.id)
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
