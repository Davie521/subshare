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
 * Idempotent on `eventId`: if any row already exists with this event_id
 * for this sub, the entire recompute is a no-op.
 */

import { and, eq, gte, lte, inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { fairAllocation, type MemberInterval } from '@/lib/fair-allocation'
import { lockSubscription } from '@/lib/db-operations'

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

const empty = (): RecomputeMonthOutput => ({
  insertedBillIds: [],
  updatedBillIds: [],
  insertedAdjustmentIds: [],
  updatedAdjustmentIds: [],
  notifiedUserIds: [],
})

const pad2 = (n: number): string => String(n).padStart(2, '0')

export async function recomputeMonth(
  db: DB,
  input: RecomputeMonthInput
): Promise<RecomputeMonthOutput> {
  const { subscriptionId, year, month, eventId, today, rates } = input

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`month out of range: ${month}`)
  }
  if (!Number.isInteger(year) || year < 1) {
    throw new Error(`year out of range: ${year}`)
  }

  return await db.transaction(async (tx) => {
    await lockSubscription(tx, subscriptionId)

    const subRows = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscriptionId))
    const sub = subRows[0]
    if (!sub) {
      throw new Error(`subscription ${subscriptionId} not found`)
    }

    // Idempotency: if any row was already produced by this eventId for this
    // sub, the recompute already happened.
    const eventRows = await tx
      .select({ id: schema.billingRecords.id })
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, subscriptionId),
          eq(schema.billingRecords.eventId, eventId)
        )
      )
    if (eventRows.length > 0) return empty()

    const members = await tx
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.subscriptionId, subscriptionId))

    const intervals: MemberInterval[] = members.map((m) => ({
      userId: m.userId,
      addedAt: m.addedAt,
      leftAt: m.leftAt,
    }))

    const fair = fairAllocation({
      price: sub.price,
      year,
      month,
      intervals,
      roundingSeed: subscriptionId + year * 12 + month,
    })

    const monthDays = new Date(year, month, 0).getDate()
    const monthStart = `${year}-${pad2(month)}-01`
    const monthEnd = `${year}-${pad2(month)}-${pad2(monthDays)}`

    const existingBills = await tx
      .select()
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, subscriptionId),
          gte(schema.billingRecords.billingDate, monthStart),
          lte(schema.billingRecords.billingDate, monthEnd)
        )
      )

    type BillRow = (typeof existingBills)[number]
    const billsByUser = new Map<number, BillRow[]>()
    for (const b of existingBills) {
      const arr = billsByUser.get(b.userId) ?? []
      arr.push(b)
      billsByUser.set(b.userId, arr)
    }

    const allUserIds = new Set<number>([...fair.keys(), ...billsByUser.keys()])
    if (allUserIds.size === 0) return empty()

    const userIdsArr = [...allUserIds]
    const userRows = await tx
      .select({
        id: schema.users.id,
        preferredCurrency: schema.users.preferredCurrency,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, userIdsArr))
    const userPrefs = new Map<number, string>()
    for (const u of userRows) userPrefs.set(u.id, u.preferredCurrency)

    const result = empty()

    for (const userId of allUserIds) {
      const targetFair = fair.get(userId) ?? 0
      const userBills = billsByUser.get(userId) ?? []
      const actualSum = userBills.reduce((s, b) => s + b.amount, 0)
      const delta = targetFair - actualSum

      if (delta === 0) continue

      const isPayer = userId === sub.payerId
      const userPref = userPrefs.get(userId) ?? sub.currency

      // Find the row to apply the delta to, in priority order.
      const unpaidRegular = userBills.find(
        (b) => !b.isPaid && b.adjustmentForBillId === null
      )
      const unpaidAdj = userBills.find(
        (b) => !b.isPaid && b.adjustmentForBillId !== null
      )
      const paidParent = userBills.find(
        (b) => b.isPaid && b.adjustmentForBillId === null
      )

      let didChange = false

      // Apply delta to the unpaid regular bill ONLY if the result stays
      // non-negative. Regular bill rows represent "what the user is
      // billed for the month"; negative would be semantically nonsense
      // and confuses settlement display. If the delta would push it
      // below zero, we fall through and write the delta as a separate
      // adjustment row (which is signed-aware by design).
      const proposedRegular =
        unpaidRegular !== undefined ? unpaidRegular.amount + delta : null
      const canUpdateRegular =
        unpaidRegular !== undefined && proposedRegular! >= 0

      if (canUpdateRegular) {
        const newAmount = proposedRegular!
        const newLocalAmount = Math.floor(
          (newAmount * unpaidRegular!.exchangeRate) / 1_000_000
        )
        await tx
          .update(schema.billingRecords)
          .set({ amount: newAmount, localAmount: newLocalAmount })
          .where(eq(schema.billingRecords.id, unpaidRegular!.id))
        result.updatedBillIds.push(unpaidRegular!.id)
        didChange = true
      } else if (unpaidAdj) {
        const newAmount = unpaidAdj.amount + delta
        const newLocalAmount = Math.floor(
          (newAmount * unpaidAdj.exchangeRate) / 1_000_000
        )
        await tx
          .update(schema.billingRecords)
          .set({ amount: newAmount, localAmount: newLocalAmount })
          .where(eq(schema.billingRecords.id, unpaidAdj.id))
        result.updatedAdjustmentIds.push(unpaidAdj.id)
        didChange = true
      } else if (userBills.length === 0 && targetFair !== 0) {
        // Fresh insert — new R1 bill.
        const rate = resolveRate(sub.currency, userPref, rates)
        const localAmount = Math.floor((targetFair * rate) / 1_000_000)
        const inserted = await tx
          .insert(schema.billingRecords)
          .values({
            subscriptionId,
            userId,
            amount: targetFair,
            currency: sub.currency,
            localAmount,
            localCurrency: userPref,
            exchangeRate: rate,
            billingDate: monthStart,
            isPaid: isPayer,
            paidAt: isPayer ? monthStart : null,
            eventId,
          })
          .returning({ id: schema.billingRecords.id })
        result.insertedBillIds.push(inserted[0].id)
        didChange = true
      } else if (paidParent || unpaidRegular) {
        // Insert an adjustment row. Two scenarios:
        //   (a) `paidParent`: classic case — user has only paid bills,
        //       delta needs to live in a new signed adjustment row.
        //   (b) `unpaidRegular` and the regular branch above bailed
        //       because the proposed amount would have gone negative.
        //       Fall through here and write the delta as an adjustment
        //       parented on the unpaid regular bill.
        const parent = (paidParent ?? unpaidRegular)!
        // billing_date must be IN the source month so that subsequent
        // recomputes for OTHER months don't see this adj in their range
        // and accidentally fold it into their actual sum. Use today when
        // it falls in this month, else clamp to monthEnd of the source.
        const adjBillingDate =
          today >= monthStart && today <= monthEnd ? today : monthEnd
        const newLocalAmount = Math.floor(
          (delta * parent.exchangeRate) / 1_000_000
        )
        const inserted = await tx
          .insert(schema.billingRecords)
          .values({
            subscriptionId,
            userId,
            amount: delta,
            currency: sub.currency,
            localAmount: newLocalAmount,
            localCurrency: parent.localCurrency,
            exchangeRate: parent.exchangeRate,
            billingDate: adjBillingDate,
            isPaid: false,
            adjustmentForBillId: parent.id,
            eventId,
          })
          .returning({ id: schema.billingRecords.id })
        result.insertedAdjustmentIds.push(inserted[0].id)
        didChange = true
      }

      if (didChange) {
        await tx.insert(schema.notifications).values({
          userId,
          type: 'bill_adjusted',
          subscriptionId,
          payload: JSON.stringify({ delta, fair: targetFair }),
        })
        result.notifiedUserIds.push(userId)
      }
    }

    return result
  })
}

/** Returns FX rate × 1_000_000. Defaults to 1:1 if rate not provided. */
function resolveRate(
  subCurrency: string,
  userCurrency: string,
  rates: Record<string, number> | undefined
): number {
  if (subCurrency === userCurrency) return 1_000_000
  const key = `${subCurrency}_${userCurrency}`
  const provided = rates?.[key]
  if (provided && Number.isFinite(provided) && provided > 0) return provided
  return 1_000_000
}
