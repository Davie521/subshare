/**
 * Edit a member's `addedAt` retroactively.
 *
 * Permission: **owner only** (sub.owner_id === actorUserId).
 *
 * Validation:
 *   - sub.startDate ≤ newAddedAt ≤ today (in app TZ)
 *   - newAddedAt within the 6-month edit window (≥ first day of month
 *     6 calendar months prior to today). Earlier edits rejected to bound
 *     blast radius — historical settled months stay frozen.
 *
 * Side effects:
 *   - UPDATE subscription_members.added_at
 *   - For every affected month (from min(oldAddedAt, newAddedAt) through
 *     today's month), call `recomputeMonth(...)` to reconcile bills
 *     and adjustments.
 *   - Emit `bill_adjusted` notifications via the recompute path.
 *
 * NOT YET IMPLEMENTED — tests are RED.
 */

import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type EditMemberAddedAtInput = {
  subscriptionId: number
  /** User whose addedAt is being changed. */
  targetUserId: number
  /** Caller — must equal sub.owner_id. */
  actorUserId: number
  /** New addedAt in ISO YYYY-MM-DD. */
  newAddedAt: string
  /** Today's date in app TZ. */
  today: string
  /** FX rates for any new bills, keyed `${currency}_${preferredCurrency}`. */
  rates?: Record<string, number>
}

export type EditMemberAddedAtOutput = {
  /** Months that had their fair allocation recomputed. ISO YYYY-MM. */
  affectedMonths: string[]
  /** Idempotency key passed to recomputeMonth (one per affected month). */
  eventIdPrefix: string
}

export async function editMemberAddedAt(
  _db: DB,
  _input: EditMemberAddedAtInput
): Promise<EditMemberAddedAtOutput> {
  throw new Error('editMemberAddedAt: not implemented')
}
