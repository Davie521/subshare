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
 */

import { and, eq } from 'drizzle-orm'
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
  db: DB,
  input: { subscriptionId: number; today: string }
): Promise<DisplayMember[]> {
  const { subscriptionId, today } = input

  const subRows = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
  const sub = subRows[0]
  if (!sub) return []

  const members = await db
    .select()
    .from(schema.subscriptionMembers)
    .where(eq(schema.subscriptionMembers.subscriptionId, subscriptionId))

  // Sum unpaid bills + adjustments per user (signed cents).
  const unpaidBills = await db
    .select()
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, subscriptionId),
        eq(schema.billingRecords.isPaid, false)
      )
    )
  const unpaidByUser = new Map<number, number>()
  for (const b of unpaidBills) {
    unpaidByUser.set(b.userId, (unpaidByUser.get(b.userId) ?? 0) + b.amount)
  }

  const result: DisplayMember[] = []
  for (const m of members) {
    const isPayer = m.userId === sub.payerId
    const isPastLeaver = m.leftAt !== null && m.leftAt <= today

    if (!isPastLeaver) {
      result.push({
        userId: m.userId,
        addedAt: m.addedAt,
        leftAt: m.leftAt,
        status: 'active',
      })
      continue
    }

    const owed = unpaidByUser.get(m.userId) ?? 0
    if (owed === 0 && !isPayer) continue // filter out: cleared

    result.push({
      userId: m.userId,
      addedAt: m.addedAt,
      leftAt: m.leftAt,
      status: 'left_unsettled',
      outstandingAmount: owed,
    })
  }

  // Stable sort: addedAt ASC, userId ASC.
  result.sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt.localeCompare(b.addedAt)
    return a.userId - b.userId
  })

  return result
}
