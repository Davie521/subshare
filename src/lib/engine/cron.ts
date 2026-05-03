/**
 * Fair-engine R1 monthly cron.
 *
 * Runs on the 1st of each calendar month (in APP_TIMEZONE). For every
 * active subscription, it does two things in one transaction:
 *
 *   1. **Fold prior unpaid adjustments into a new R1 bill**: any
 *      adjustment row from PRIOR months that is still `is_paid=false`
 *      gets summed into the user's fresh R1 bill for the current month.
 *      The adjustment rows are marked `is_paid=true, paid_at=today`
 *      because their delta has been absorbed into the new bill.
 *
 *   2. **Run `recomputeMonth` for the current month**: writes the new
 *      R1 bills (= fair share + folded adjustments).
 *
 * The fold-in step ensures users see at most one outstanding bill per
 * (sub, payer) pair per cycle, never separate "you owe $X for last
 * month's correction" line items.
 *
 * NOT YET IMPLEMENTED — tests are RED.
 */

import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type R1CronInput = {
  /**
   * ISO date in app TZ. Normal R1 cron runs with today = first of month;
   * tests / replays may pass any date.
   */
  today: string
  /**
   * Live FX rates for new bills, keyed `${currency}_${preferredCurrency}`,
   * value = rate × 1_000_000.
   */
  rates?: Record<string, number>
  /**
   * Optional: limit to a specific subscription. When omitted, processes
   * every active sub.
   */
  subscriptionId?: number
}

export type R1CronOutput = {
  subscriptionsProcessed: number
  billsInserted: number
  billsUpdated: number
  adjustmentsFolded: number
}

export async function runR1Cron(
  _db: DB,
  _input: R1CronInput
): Promise<R1CronOutput> {
  throw new Error('runR1Cron: not implemented')
}
