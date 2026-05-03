/**
 * Member lifecycle helpers for the fair-engine.
 *
 * `getMembersForDisplay` returns the list of members shown on the
 * subscription detail page, applying the lifecycle rules:
 *
 *   - Active members (leftAt == null OR leftAt > today): always shown.
 *   - Past leavers (leftAt <= today) with NO outstanding obligations:
 *     filtered out (they've fully cleared their account on this sub).
 *   - Past leavers with unpaid bills/adjustments: shown with status
 *     `'left_unsettled'` and `outstandingAmount` so the UI can render
 *     them grayed with "owes/owed $X".
 *   - The payer is always shown regardless of state.
 *
 * Friendship rows are NOT affected by leave — they persist independently.
 *
 * NOT YET IMPLEMENTED — tests are RED.
 */

import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type DisplayMember = {
  userId: number
  addedAt: string
  leftAt: string | null
  status: 'active' | 'future' | 'left_unsettled'
  /**
   * Sum of unpaid `billing_records.amount` for this user on this sub
   * (signed cents, original sub.currency). Set only for `left_unsettled`.
   * Positive = owes the payer; negative = owed by the payer.
   */
  outstandingAmount?: number
}

export async function getMembersForDisplay(
  _db: DB,
  _input: { subscriptionId: number; today: string }
): Promise<DisplayMember[]> {
  throw new Error('getMembersForDisplay: not implemented')
}
