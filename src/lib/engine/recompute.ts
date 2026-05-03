/**
 * Fair-engine recompute orchestrator.
 *
 * Single entry point used by all events that affect billing:
 *   - R1 monthly cron (1st of each month)
 *   - Add member
 *   - Remove member (sets leftAt)
 *   - Owner edits addedAt / leftAt
 *   - Price change
 *
 * For a given (sub, year, month):
 *   1. Compute target fair allocation via `fairAllocation(...)`.
 *   2. Read existing billing_records for this (sub, month).
 *   3. For each affected user, reconcile actual vs fair:
 *        - delta = fair_u - actual_u
 *        - If member has unpaid bill in this month → UPDATE its amount.
 *        - If member has only paid bills and delta ≠ 0 → INSERT adjustment row.
 *        - If member has an OPEN adjustment from a prior recompute → UPDATE it.
 *   4. Insert auto-paid row for the payer (is_paid=true, paid_at=billingDate).
 *   5. Emit `bill_adjusted` notifications for each user with non-zero delta.
 *
 * Idempotent on `eventId`: rows produced by a prior call with the same
 * eventId are upserted, not duplicated.
 *
 * NOT YET IMPLEMENTED — tests are RED.
 */

import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type RecomputeMonthInput = {
  subscriptionId: number
  year: number
  month: number // 1-12
  /** Idempotency key — repeated calls with the same eventId no-op. */
  eventId: string
  /**
   * Today's ISO date in app TZ. Used as `billing_date` for adjustment rows
   * created against settled bills.
   */
  today: string
  /**
   * Live FX rates for new bills. Keyed `${currency}_${preferredCurrency}`,
   * value = rate × 1_000_000. Required when a member's preferred currency
   * differs from sub.currency and no parent bill's locked rate can be reused.
   */
  rates?: Record<string, number>
}

export type RecomputeMonthOutput = {
  insertedBillIds: number[]
  updatedBillIds: number[]
  insertedAdjustmentIds: number[]
  updatedAdjustmentIds: number[]
  notifiedUserIds: number[]
}

export async function recomputeMonth(
  _db: DB,
  _input: RecomputeMonthInput
): Promise<RecomputeMonthOutput> {
  throw new Error('recomputeMonth: not implemented')
}
