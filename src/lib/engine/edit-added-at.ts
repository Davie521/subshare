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
 */

import { and, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { recomputeMonth } from './recompute'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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
  /** Idempotency key prefix passed to recomputeMonth (one per month). */
  eventIdPrefix: string
}

export async function editMemberAddedAt(
  db: DB,
  input: EditMemberAddedAtInput
): Promise<EditMemberAddedAtOutput> {
  const { subscriptionId, targetUserId, actorUserId, newAddedAt, today, rates } =
    input

  if (!ISO_DATE_RE.test(newAddedAt)) {
    throw new Error(`newAddedAt must be ISO YYYY-MM-DD: ${newAddedAt}`)
  }
  if (!ISO_DATE_RE.test(today)) {
    throw new Error(`today must be ISO YYYY-MM-DD: ${today}`)
  }

  const subRows = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
  const sub = subRows[0]
  if (!sub) {
    throw new Error(`subscription ${subscriptionId} not found`)
  }

  // Permission: owner-only.
  if (sub.ownerId !== actorUserId) {
    throw new Error(
      `permission denied: only the sub owner can edit member dates`
    )
  }

  // Target must already be a member.
  const memberRows = await db
    .select()
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subscriptionId),
        eq(schema.subscriptionMembers.userId, targetUserId)
      )
    )
  const member = memberRows[0]
  if (!member) {
    throw new Error(
      `user ${targetUserId} is not a member of subscription ${subscriptionId}`
    )
  }

  // Range validation.
  if (newAddedAt < sub.startDate) {
    throw new Error(
      `newAddedAt ${newAddedAt} earlier than sub.startDate ${sub.startDate}`
    )
  }
  if (newAddedAt > today) {
    throw new Error(
      `newAddedAt ${newAddedAt} cannot be in the future (today=${today})`
    )
  }

  // 6-month horizon — earliest editable = first day of month 6 calendar
  // months prior to today.
  const horizonStart = monthsBackToFirstDay(today, 6)
  if (newAddedAt < horizonStart) {
    throw new Error(
      `newAddedAt ${newAddedAt} is outside the 6-month edit window (earliest=${horizonStart})`
    )
  }

  // No-op if unchanged.
  const oldAddedAt = member.addedAt
  if (oldAddedAt === newAddedAt) {
    return { affectedMonths: [], eventIdPrefix: '' }
  }

  // Update the member row.
  await db
    .update(schema.subscriptionMembers)
    .set({ addedAt: newAddedAt })
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subscriptionId),
        eq(schema.subscriptionMembers.userId, targetUserId)
      )
    )

  // Affected months: from min(old, new) month through today's month.
  const minDate = oldAddedAt < newAddedAt ? oldAddedAt : newAddedAt
  const minMonth = minDate.slice(0, 7)
  const todayMonth = today.slice(0, 7)
  const affectedMonths: string[] = []
  let cursor = minMonth
  while (cursor <= todayMonth) {
    affectedMonths.push(cursor)
    cursor = nextMonth(cursor)
  }

  // Trigger recompute for each affected month.
  const eventIdPrefix = `editAddedAt:sub${subscriptionId}:user${targetUserId}:${Date.now()}`
  for (const ym of affectedMonths) {
    const [yy, mm] = ym.split('-').map(Number)
    await recomputeMonth(db, {
      subscriptionId,
      year: yy,
      month: mm,
      eventId: `${eventIdPrefix}:${ym}`,
      today,
      rates,
    })
  }

  return { affectedMonths, eventIdPrefix }
}

function monthsBackToFirstDay(today: string, monthsBack: number): string {
  const [y, m] = today.split('-').map(Number)
  let newM = m - monthsBack
  let newY = y
  while (newM < 1) {
    newM += 12
    newY--
  }
  return `${newY}-${String(newM).padStart(2, '0')}-01`
}

function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  let nm = m + 1
  let ny = y
  if (nm > 12) {
    nm = 1
    ny++
  }
  return `${ny}-${String(nm).padStart(2, '0')}`
}
