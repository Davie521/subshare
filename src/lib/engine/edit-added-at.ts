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

  // Wrap the whole flow in one outer transaction so a partial crash
  // (e.g. crash mid-loop after some months wrote) rolls back cleanly.
  // recomputeMonth opens its own `tx.transaction(...)` which becomes
  // a savepoint under postgres-js — safe to nest.
  return await db.transaction(async (tx) => {
    const subRows = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscriptionId))
    const sub = subRows[0]
    if (!sub) {
      throw new Error(`subscription ${subscriptionId} not found`)
    }

    if (sub.ownerId !== actorUserId) {
      throw new Error(
        `permission denied: only the sub owner can edit member dates`
      )
    }

    const memberRows = await tx
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

    const horizonStart = monthsBackToFirstDay(today, 6)
    if (newAddedAt < horizonStart) {
      throw new Error(
        `newAddedAt ${newAddedAt} is outside the 6-month edit window (earliest=${horizonStart})`
      )
    }

    const oldAddedAt = member.addedAt
    if (oldAddedAt === newAddedAt) {
      return { affectedMonths: [], eventIdPrefix: '' }
    }

    await tx
      .update(schema.subscriptionMembers)
      .set({ addedAt: newAddedAt })
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, subscriptionId),
          eq(schema.subscriptionMembers.userId, targetUserId)
        )
      )

    // Clamp affected month range to the 6-month horizon: an old
    // misrecorded `oldAddedAt` (e.g. years back) must not extend the
    // recompute past the window validated for `newAddedAt`.
    const minDate = oldAddedAt < newAddedAt ? oldAddedAt : newAddedAt
    const horizonMonth = horizonStart.slice(0, 7)
    const candidateMonth = minDate.slice(0, 7)
    const minMonth =
      candidateMonth < horizonMonth ? horizonMonth : candidateMonth
    const todayMonth = today.slice(0, 7)
    const affectedMonths: string[] = []
    let cursor = minMonth
    while (cursor <= todayMonth) {
      affectedMonths.push(cursor)
      cursor = nextMonth(cursor)
    }

    // Deterministic eventId encodes the (sub, user, oldAddedAt → newAddedAt)
    // transition + a timestamp. The outer transaction handles partial-
    // failure retries (rollback wipes everything; client retry sees
    // unchanged state and computes a fresh transition). The timestamp
    // disambiguates round-trip edits (1→3, 3→1, 1→3 each get distinct
    // eventIds despite same target value).
    const eventIdPrefix = `editAddedAt:sub${subscriptionId}:user${targetUserId}:${oldAddedAt}-to-${newAddedAt}:${Date.now()}`
    for (const ym of affectedMonths) {
      const [yy, mm] = ym.split('-').map(Number)
      await recomputeMonth(tx, {
        subscriptionId,
        year: yy,
        month: mm,
        eventId: `${eventIdPrefix}:${ym}`,
        today,
        rates,
      })
    }

    return { affectedMonths, eventIdPrefix }
  })
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
