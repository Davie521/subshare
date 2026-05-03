/**
 * Fair-engine R1 monthly cron.
 *
 * Runs on the 1st of each calendar month (in APP_TIMEZONE). For every
 * active subscription, it does two things:
 *
 *   1. **`recomputeMonth` for the current month** — writes new R1 bills
 *      (auto-paid for payer, unpaid for non-payers) at fair allocation.
 *   2. **Fold prior-month unpaid adjustments**: any adjustment row from
 *      a prior month that's still `is_paid=false` gets summed into the
 *      user's fresh R1 bill, then marked `is_paid=true, paid_at=today`
 *      because its delta has been absorbed into the new bill.
 *
 * If a user has pending adjustments but no active membership in the
 * current month (e.g., a former member with a refund still due), a
 * standalone bill is inserted so the refund flows through settlement.
 *
 * Idempotent on (sub, current_month): a second run with the same `today`
 * is a no-op because (a) recomputeMonth short-circuits on event_id and
 * (b) the prior-month adjustments are already marked paid.
 */

import { and, eq, gte, lt, lte, isNotNull, inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { recomputeMonth } from './recompute'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type R1CronInput = {
  /** ISO date in app TZ. Normal R1 cron runs with today = first of month. */
  today: string
  /** FX rates for new bills, keyed `${currency}_${preferredCurrency}`. */
  rates?: Record<string, number>
  /** Optional: limit to a specific subscription. */
  subscriptionId?: number
}

export type R1CronOutput = {
  subscriptionsProcessed: number
  billsInserted: number
  billsUpdated: number
  adjustmentsFolded: number
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export async function runR1Cron(
  db: DB,
  input: R1CronInput
): Promise<R1CronOutput> {
  const { today, rates, subscriptionId } = input

  const [yearStr, monthStr] = today.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error(`runR1Cron: invalid today "${today}"`)
  }

  const result: R1CronOutput = {
    subscriptionsProcessed: 0,
    billsInserted: 0,
    billsUpdated: 0,
    adjustmentsFolded: 0,
  }

  // Fetch active subs (optionally scoped to one).
  const subFilter =
    subscriptionId !== undefined
      ? and(
          eq(schema.subscriptions.inactive, false),
          eq(schema.subscriptions.id, subscriptionId)
        )
      : eq(schema.subscriptions.inactive, false)
  const subs = await db.select().from(schema.subscriptions).where(subFilter)

  for (const sub of subs) {
    const eventId = `cron:${year}-${pad2(month)}:sub${sub.id}`

    // Step 1 — recomputeMonth (own transaction).
    const recResult = await recomputeMonth(db, {
      subscriptionId: sub.id,
      year,
      month,
      eventId,
      today,
      rates,
    })

    // Step 2 — fold prior-month unpaid adjustments (own transaction).
    const monthDays = new Date(year, month, 0).getDate()
    const monthStart = `${year}-${pad2(month)}-01`
    const monthEnd = `${year}-${pad2(month)}-${pad2(monthDays)}`

    const foldResult = await db.transaction(async (tx) => {
      const pendingAdjs = await tx
        .select()
        .from(schema.billingRecords)
        .where(
          and(
            eq(schema.billingRecords.subscriptionId, sub.id),
            eq(schema.billingRecords.isPaid, false),
            isNotNull(schema.billingRecords.adjustmentForBillId),
            lt(schema.billingRecords.billingDate, monthStart)
          )
        )

      if (pendingAdjs.length === 0) {
        return { billsUpdated: 0, billsInserted: 0, adjustmentsFolded: 0 }
      }

      // Group by user.
      type AdjRow = (typeof pendingAdjs)[number]
      const adjsByUser = new Map<number, AdjRow[]>()
      for (const a of pendingAdjs) {
        const arr = adjsByUser.get(a.userId) ?? []
        arr.push(a)
        adjsByUser.set(a.userId, arr)
      }

      let billsUpdated = 0
      let billsInserted = 0
      let adjustmentsFolded = 0

      for (const [userId, adjs] of adjsByUser) {
        const totalAdj = adjs.reduce((s, a) => s + a.amount, 0)

        // Look for the user's R1 bill (regular, this month).
        const monthBills = await tx
          .select()
          .from(schema.billingRecords)
          .where(
            and(
              eq(schema.billingRecords.subscriptionId, sub.id),
              eq(schema.billingRecords.userId, userId),
              gte(schema.billingRecords.billingDate, monthStart),
              lte(schema.billingRecords.billingDate, monthEnd)
            )
          )
        // Prefer an unpaid regular bill (non-adjustment) so we fold into the
        // R1 line item, not the payer's auto-paid one.
        const r1Bill = monthBills.find(
          (b) => b.adjustmentForBillId === null && !b.isPaid
        )

        if (r1Bill && totalAdj !== 0) {
          const newAmount = r1Bill.amount + totalAdj
          const newLocalAmount = Math.floor(
            (newAmount * r1Bill.exchangeRate) / 1_000_000
          )
          await tx
            .update(schema.billingRecords)
            .set({ amount: newAmount, localAmount: newLocalAmount })
            .where(eq(schema.billingRecords.id, r1Bill.id))
          billsUpdated++
        } else if (!r1Bill && totalAdj !== 0) {
          // No active R1 bill (e.g., user is a former member). Insert a
          // standalone settlement row so the refund/top-up still flows
          // through the pair bucket.
          const sample = adjs[0]
          const localAmount = Math.floor(
            (totalAdj * sample.exchangeRate) / 1_000_000
          )
          await tx.insert(schema.billingRecords).values({
            subscriptionId: sub.id,
            userId,
            amount: totalAdj,
            currency: sample.currency,
            localAmount,
            localCurrency: sample.localCurrency,
            exchangeRate: sample.exchangeRate,
            billingDate: monthStart,
            isPaid: false,
          })
          billsInserted++
        }

        // Mark the consumed adjustments as paid (folded into the new bill).
        const adjIds = adjs.map((a) => a.id)
        await tx
          .update(schema.billingRecords)
          .set({ isPaid: true, paidAt: today })
          .where(inArray(schema.billingRecords.id, adjIds))
        adjustmentsFolded += adjs.length
      }

      return { billsUpdated, billsInserted, adjustmentsFolded }
    })

    result.subscriptionsProcessed++
    result.billsInserted += recResult.insertedBillIds.length + foldResult.billsInserted
    result.billsUpdated += recResult.updatedBillIds.length + foldResult.billsUpdated
    result.adjustmentsFolded += foldResult.adjustmentsFolded
  }

  return result
}
