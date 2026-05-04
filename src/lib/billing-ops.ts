import { eq, and, inArray, gte, lte } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import {
  calculateShares,
  calculateJoinProRata,
  recomputeLocalAmount,
  calculateR5NewAmount,
} from './billing'
import { insertNotification } from './notifications'
import { todayInAppTz } from './date-utils'
import { getActiveMembersAt, lockSubscription } from './db-operations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

/* ──────────────────────────────────────────────────────────────────────
 * R2 — mid-cycle join bill
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Compute the R2 join bill numbers (share, amount, localAmount, rate)
 * from a subscription snapshot, a joiner's canonical addedAt, and a
 * final memberCount. Pure of DB I/O — just math + FX lookup against the
 * pre-fetched rate map. Returns `null` when no bill should be emitted
 * (share would be 0, joiner is the payer, etc).
 *
 * The bill is anchored to `effectiveBillingDate = max(addedAt, startDate)`
 * — when a member is added before the sub's startDate (sub hasn't begun
 * billing yet), their bill must wait until startDate. The returned
 * `effectiveBillingDate` is what the caller uses for `billing_date` and
 * the idempotency key.
 */
function computeR2JoinBillAmounts(input: {
  sub: typeof schema.subscriptions.$inferSelect
  userId: number
  canonicalAddedAt: string
  memberCount: number
  joinerPreferredCurrency: string
  rates: Record<string, number>
}): {
  share: number
  amount: number
  localAmount: number
  rate: number
  effectiveBillingDate: string
} | null {
  const { sub, userId, canonicalAddedAt, memberCount, joinerPreferredCurrency, rates } = input

  if (sub.payerId === userId) return null
  if (memberCount < 2) return null

  // String compare works for ISO YYYY-MM-DD.
  const effectiveBillingDate =
    canonicalAddedAt >= sub.startDate ? canonicalAddedAt : sub.startDate

  const share = calculateShares(sub.price, memberCount)
  const [year, month, day] = effectiveBillingDate.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const amount = calculateJoinProRata(share, day, daysInMonth)
  if (amount <= 0) return null

  const rate =
    sub.currency === joinerPreferredCurrency
      ? 1
      : rates[`${sub.currency}_${joinerPreferredCurrency}`]
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Missing exchange rate for ${sub.currency}_${joinerPreferredCurrency}`
    )
  }
  const localAmount = Math.floor(amount * rate)

  return { share, amount, localAmount, rate, effectiveBillingDate }
}

/**
 * Insert the `added_to_sub` notification for a joiner. Fires on both
 * first-time inserts AND rejoins — a reactivated member needs to know
 * they're back on the sub and their fresh R2 bill just dropped.
 */
async function notifyJoiner(
  tx: DB,
  input: {
    sub: typeof schema.subscriptions.$inferSelect
    userId: number
    addedBy: number
    canonicalAddedAt: string
    share: number
    amount: number
  }
): Promise<void> {
  const { sub, userId, addedBy, canonicalAddedAt, share, amount } = input

  const [inviter] = await tx
    .select({
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, addedBy))

  const [payer] = await tx
    .select({
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, sub.payerId))

  const [yy, mm] = canonicalAddedAt.split('-').map(Number)
  const nextBillingDate =
    mm === 12
      ? `${yy + 1}-01-01`
      : `${yy}-${String(mm + 1).padStart(2, '0')}-01`

  await insertNotification(tx, {
    userId,
    type: 'added_to_sub',
    subscriptionId: sub.id,
    payload: {
      sub_name: sub.name,
      actor_name: inviter?.displayName || inviter?.name || 'Someone',
      payer_name: payer?.displayName || payer?.name || 'Payer',
      share,
      share_currency: sub.currency,
      this_cycle_prorated: amount,
      next_billing_date: nextBillingDate,
    },
  })
}

/**
 * Emit the R2 pro-rata join bill + `added_to_sub` notification for a
 * single freshly-inserted member. Accepts the EXPLICIT `memberCount` the
 * caller has computed against the final post-batch state — this is the
 * core of the batch-fairness fix: when `handleAddMembers` invites two
 * people in one call, both bills use the same memberCount and therefore
 * the same share.
 *
 * Idempotent on (sub, user, canonicalAddedAt) — if a bill already exists
 * for that date the function is a no-op.
 */
export async function createR2JoinBill(
  tx: DB,
  input: {
    sub: typeof schema.subscriptions.$inferSelect
    userId: number
    addedBy: number
    canonicalAddedAt: string
    memberCount: number
    rates: Record<string, number>
    status: 'added' | 'rejoin'
  }
): Promise<void> {
  const { sub, userId, addedBy, canonicalAddedAt, memberCount, rates } = input

  const [user] = await tx
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (!user) return

  const amounts = computeR2JoinBillAmounts({
    sub,
    userId,
    canonicalAddedAt,
    memberCount,
    joinerPreferredCurrency: user.preferredCurrency,
    rates,
  })
  if (!amounts) return

  // Idempotent: same (sub, user, effective date) → skip. Idempotency keys
  // off the effective billing date so two adds in the same pre-startDate
  // window can't both insert (they'd both clamp to startDate and collide).
  const [existing] = await tx
    .select({ id: schema.billingRecords.id })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, sub.id),
        eq(schema.billingRecords.userId, userId),
        eq(schema.billingRecords.billingDate, amounts.effectiveBillingDate)
      )
    )
  if (existing) return

  await tx.insert(schema.billingRecords).values({
    subscriptionId: sub.id,
    userId,
    amount: amounts.amount,
    currency: sub.currency,
    localAmount: amounts.localAmount,
    localCurrency: user.preferredCurrency,
    exchangeRate: Math.round(amounts.rate * 1_000_000),
    billingDate: amounts.effectiveBillingDate,
  })

  await notifyJoiner(tx, {
    sub,
    userId,
    addedBy,
    canonicalAddedAt: amounts.effectiveBillingDate,
    share: amounts.share,
    amount: amounts.amount,
  })
}

/**
 * Creation-time backfill: generate one bill per calendar month from
 * `sub.startDate`'s month through `today`'s month for a single member.
 *
 *   - First month (the one containing startDate): prorate from
 *     startDate's day to end-of-month. billing_date = sub.startDate.
 *   - Subsequent months (including current): full share.
 *     billing_date = first-of-month.
 *
 * Caller is responsible for only invoking this on creation (initial
 * member set), and only when sub.startDate is strictly earlier than
 * `today`. For startDate >= today, the regular R2 single-bill path
 * handles it correctly. Idempotent on (sub, user, billing_date) for
 * each emitted bill — safe to retry the whole flow.
 */
export async function createBackfillJoinBills(
  tx: DB,
  input: {
    sub: typeof schema.subscriptions.$inferSelect
    userId: number
    addedBy: number
    today: string
    memberCount: number
    rates: Record<string, number>
    status: 'added' | 'rejoin'
  }
): Promise<void> {
  const { sub, userId, addedBy, today, memberCount, rates } = input

  if (sub.payerId === userId) return
  if (memberCount < 2) return
  if (sub.startDate >= today) return // caller should have used createR2JoinBill

  const [user] = await tx
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (!user) return

  const share = calculateShares(sub.price, memberCount)
  const rate =
    sub.currency === user.preferredCurrency
      ? 1
      : rates[`${sub.currency}_${user.preferredCurrency}`]
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Missing exchange rate for ${sub.currency}_${user.preferredCurrency}`
    )
  }

  const todayMonth = today.slice(0, 7)
  let cursor = sub.startDate
  let lastInsertedAmount = 0

  while (cursor.slice(0, 7) <= todayMonth) {
    const [yy, mm, dd] = cursor.split('-').map(Number)
    const daysInMonth = new Date(yy, mm, 0).getDate()
    const amount =
      dd === 1 ? share : calculateJoinProRata(share, dd, daysInMonth)

    if (amount > 0) {
      const [existing] = await tx
        .select({ id: schema.billingRecords.id })
        .from(schema.billingRecords)
        .where(
          and(
            eq(schema.billingRecords.subscriptionId, sub.id),
            eq(schema.billingRecords.userId, userId),
            eq(schema.billingRecords.billingDate, cursor)
          )
        )

      if (!existing) {
        const localAmount = Math.floor(amount * rate)
        await tx.insert(schema.billingRecords).values({
          subscriptionId: sub.id,
          userId,
          amount,
          currency: sub.currency,
          localAmount,
          localCurrency: user.preferredCurrency,
          exchangeRate: Math.round(rate * 1_000_000),
          billingDate: cursor,
        })
      }
      lastInsertedAmount = amount
    }

    if (mm === 12) cursor = `${yy + 1}-01-01`
    else cursor = `${yy}-${String(mm + 1).padStart(2, '0')}-01`
  }

  // One summary notification per joiner; reference today for the
  // next-billing-date hint (= first of next month after today).
  await notifyJoiner(tx, {
    sub,
    userId,
    addedBy,
    canonicalAddedAt: today,
    share,
    amount: lastInsertedAmount,
  })
}

/* ──────────────────────────────────────────────────────────────────────
 * R5 — price change rewrites current-month unpaid bills
 * ────────────────────────────────────────────────────────────────────── */

/**
 * T19 — change the price of a subscription (R5 NEW: rewrite current-month).
 *
 * Updates subscriptions.price, then rewrites every is_paid=0 billing_record
 * for this sub whose billing_date falls in the current calendar month:
 *   - R1 full-share bill (billing_date = YYYY-MM-01) → amount = newShare
 *   - R2 pro-rata bill (billing_date = join day) → amount preserves ratio
 *     days_covered/D_M against newShare
 *   - localAmount recomputed using the bill's stored exchange_rate
 *     (FX rate is NOT re-fetched; it stays locked from original generation)
 *   - is_paid=1 bills and bills outside current month are untouched
 * Emits one price_changed notification per active non-payer member +
 * per leaver with unpaid current-month bills; effective_from = month start.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = Date.UTC(ay, am - 1, ad)
  const db = Date.UTC(by, bm - 1, bd)
  return Math.round((db - da) / (1000 * 60 * 60 * 24))
}

export async function changeSubscriptionPrice(
  db: DB,
  input: {
    subscriptionId: number
    newPrice: number
    /**
     * ISO YYYY-MM-DD inclusive — from this day forward `newPrice` applies.
     * Default = today (legacy behavior: rewrite the current month). Pass
     * `sub.nextPayment` to align with the user's real billing cycle. The
     * date must be within ±30 days of `today` (anti-foot-gun cap).
     */
    effectiveFrom?: string
    /** Today's ISO date in app TZ. Default = real today. */
    today?: string
  }
): Promise<void> {
  if (
    typeof input.newPrice !== 'number' ||
    !Number.isFinite(input.newPrice) ||
    input.newPrice < 0
  ) {
    throw new Error('newPrice must be a non-negative number')
  }

  const today = input.today ?? todayInAppTz()
  if (!ISO_DATE_RE.test(today)) {
    throw new Error(`today must be YYYY-MM-DD: ${today}`)
  }
  const effectiveFrom = input.effectiveFrom ?? today
  if (!ISO_DATE_RE.test(effectiveFrom)) {
    throw new Error(`effectiveFrom must be YYYY-MM-DD: ${effectiveFrom}`)
  }
  const delta = daysBetween(today, effectiveFrom)
  if (delta < -31 || delta > 31) {
    throw new Error(
      `effectiveFrom ${effectiveFrom} is out of the ±1-month window from today ${today}`
    )
  }

  await db.transaction(async (tx) => {
    await lockSubscription(tx, input.subscriptionId)

    const [sub] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, input.subscriptionId))

    if (!sub) throw new Error('Subscription not found')

    const oldPrice = sub.price
    if (oldPrice === input.newPrice) return

    // Append the new entry to price_history; sub.price (denormalized) is
    // updated only when effectiveFrom <= today so reads from sub.price
    // continue to mean "currently in effect".
    const oldHistory =
      Array.isArray(sub.priceHistory) && sub.priceHistory.length > 0
        ? sub.priceHistory
        : [{ price: oldPrice, effectiveFrom: sub.startDate }]
    const newHistory = oldHistory
      .filter((e) => e.effectiveFrom !== effectiveFrom) // overwrite same-day entries
      .concat([{ price: input.newPrice, effectiveFrom }])
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

    const cachedPrice =
      effectiveFrom <= today ? input.newPrice : oldPrice

    await tx
      .update(schema.subscriptions)
      .set({ price: cachedPrice, priceHistory: newHistory })
      .where(eq(schema.subscriptions.id, input.subscriptionId))

    const members = await getActiveMembersAt(tx, input.subscriptionId, today)
    const nonPayers = members.filter((m) => m.userId !== sub.payerId)

    const n = members.length
    const oldShare = n > 0 ? calculateShares(oldPrice, n) : 0
    const newShare = n > 0 ? calculateShares(input.newPrice, n) : 0

    const [yy, mm] = today.split('-').map(Number)
    const monthStart = `${yy}-${String(mm).padStart(2, '0')}-01`
    const daysInMonth = new Date(yy, mm, 0).getDate()
    const monthEnd = `${yy}-${String(mm).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

    // Legacy R5 rewrite only runs when the change takes effect today or
    // earlier within the current calendar month — it adjusts unpaid R1/R2
    // bills directly. For changes effective in a future month we rely on
    // the engine's per-day timeline at recompute time.
    if (effectiveFrom <= today && effectiveFrom >= monthStart) {
      await rewriteCurrentMonthBillsForR5(tx, {
        subscriptionId: input.subscriptionId,
        oldPrice,
        newShare,
        monthStart,
        monthEnd,
        daysInMonth,
        activeUserIds: members.map((m) => m.userId),
      })
    }

    const recipients = await buildR5NotificationRecipients(tx, {
      subscriptionId: input.subscriptionId,
      nonPayerIds: nonPayers.map((m) => m.userId),
      payerId: sub.payerId,
      monthStart,
      monthEnd,
    })

    for (const uid of recipients) {
      await insertNotification(tx, {
        userId: uid,
        type: 'price_changed',
        subscriptionId: input.subscriptionId,
        payload: {
          sub_name: sub.name,
          currency: sub.currency,
          old_price: oldPrice,
          new_price: input.newPrice,
          old_share: oldShare,
          new_share: newShare,
          delta: newShare - oldShare,
          effective_from: effectiveFrom,
        },
      })
    }
  })
}

/**
 * Rewrite every current-month unpaid bill belonging to a still-active
 * member so that its amount reflects the new share WHILE preserving any
 * R11 redistribute delta that was previously added. Leaver bills are
 * left alone (they're filtered out via `activeUserIds`).
 */
async function rewriteCurrentMonthBillsForR5(
  tx: DB,
  input: {
    subscriptionId: number
    oldPrice: number
    newShare: number
    monthStart: string
    monthEnd: string
    daysInMonth: number
    activeUserIds: number[]
  }
): Promise<void> {
  if (input.activeUserIds.length === 0) return

  const bills = await tx
    .select()
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, input.subscriptionId),
        eq(schema.billingRecords.isPaid, false),
        gte(schema.billingRecords.billingDate, input.monthStart),
        lte(schema.billingRecords.billingDate, input.monthEnd),
        inArray(schema.billingRecords.userId, input.activeUserIds)
      )
    )

  // Cache member count at each distinct billing date (R1 bills share
  // monthStart; R2 bills each have their own join date).
  const memberCountAt = new Map<string, number>()
  async function countAt(date: string): Promise<number> {
    const cached = memberCountAt.get(date)
    if (cached !== undefined) return cached
    const active = await getActiveMembersAt(tx, input.subscriptionId, date)
    memberCountAt.set(date, active.length)
    return active.length
  }

  for (const bill of bills) {
    const nAtBilling = await countAt(bill.billingDate)
    const oldShareAtBilling =
      nAtBilling > 0 ? Math.floor(input.oldPrice / nAtBilling) : 0

    const daysCovered =
      bill.billingDate === input.monthStart
        ? input.daysInMonth
        : input.daysInMonth - Number(bill.billingDate.slice(8, 10)) + 1

    const newAmount = calculateR5NewAmount({
      currentAmount: bill.amount,
      oldShare: oldShareAtBilling,
      newShare: input.newShare,
      daysCovered,
      daysInMonth: input.daysInMonth,
    })
    const newLocalAmount = recomputeLocalAmount(newAmount, bill.exchangeRate)

    await tx
      .update(schema.billingRecords)
      .set({ amount: newAmount, localAmount: newLocalAmount })
      .where(eq(schema.billingRecords.id, bill.id))
  }
}

/**
 * Collect user IDs who should receive the `price_changed` notification:
 * all active non-payer members + any leavers who still have unpaid bills
 * in the current month (their R3-adjusted bill wasn't rewritten, but
 * they're still on the hook and should know the price shifted).
 */
async function buildR5NotificationRecipients(
  tx: DB,
  input: {
    subscriptionId: number
    nonPayerIds: number[]
    payerId: number
    monthStart: string
    monthEnd: string
  }
): Promise<number[]> {
  const billsForNotice = await tx
    .select({ userId: schema.billingRecords.userId })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, input.subscriptionId),
        eq(schema.billingRecords.isPaid, false),
        gte(schema.billingRecords.billingDate, input.monthStart),
        lte(schema.billingRecords.billingDate, input.monthEnd)
      )
    )
  const activeSet = new Set(input.nonPayerIds)
  const leaverRecipients = Array.from(
    new Set(billsForNotice.map((b) => b.userId))
  ).filter((uid) => !activeSet.has(uid) && uid !== input.payerId)

  return [...input.nonPayerIds, ...leaverRecipients]
}
