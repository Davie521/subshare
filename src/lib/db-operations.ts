import { eq, and, sql, inArray, isNull, or, gt, gte, lte, ne } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { calculateShares, calculateJoinProRata } from './billing'
import { insertNotification } from './notifications'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export async function createSubscription(
  db: DB,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    ownerId: number
    payerId?: number
    logo?: string
    url?: string
    notes?: string
    categoryId?: number
    startDate?: string // defaults to today; owner's addedAt matches this
    refundPolicy?: 'payer_absorbs' | 'redistribute'
  }
): Promise<{ id: number; name: string }> {
  const today = new Date().toISOString().slice(0, 10)
  const startDate = input.startDate ?? today

  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(schema.subscriptions)
      .values({
        name: input.name,
        price: input.price,
        currency: input.currency,
        nextPayment: input.nextPayment,
        startDate,
        ownerId: input.ownerId,
        payerId: input.payerId ?? input.ownerId,
        logo: input.logo ?? null,
        url: input.url ?? null,
        notes: input.notes ?? null,
        categoryId: input.categoryId ?? null,
        refundPolicy: input.refundPolicy ?? 'payer_absorbs',
      })
      .returning()

    // Owner is automatically the first member (and payer by default).
    await tx.insert(schema.subscriptionMembers)
      .values({
        subscriptionId: result.id,
        userId: input.ownerId,
        addedBy: input.ownerId,
        addedAt: startDate,
      })
      .onConflictDoNothing()

    return { id: result.id, name: result.name }
  })
}

export async function addMemberToSubscription(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    addedBy: number
    addedAt: string // ISO date YYYY-MM-DD
  },
  rates: Record<string, number> = {}
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.addedAt)) {
    throw new Error(
      `addedAt must be ISO date YYYY-MM-DD, got "${input.addedAt}"`
    )
  }

  await db.transaction(async (tx) => {
    // Detect: (a) genuine new insert, (b) no-op re-add of active member,
    // or (c) rejoin of a member who previously left. (c) reuses the row
    // per schema's `(sub, user)` primary key — we UPDATE addedAt + clear
    // leftAt so downstream R2 billing uses the fresh join date.
    const [existingMember] = await tx
      .select({
        userId: schema.subscriptionMembers.userId,
        leftAt: schema.subscriptionMembers.leftAt,
      })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
          eq(schema.subscriptionMembers.userId, input.userId)
        )
      )
    const isNewMember = !existingMember
    const isRejoin = existingMember !== undefined && existingMember.leftAt !== null

    if (isNewMember) {
      await tx.insert(schema.subscriptionMembers)
        .values({
          subscriptionId: input.subscriptionId,
          userId: input.userId,
          addedBy: input.addedBy,
          addedAt: input.addedAt,
        })
    } else if (isRejoin) {
      await tx
        .update(schema.subscriptionMembers)
        .set({
          addedAt: input.addedAt,
          addedBy: input.addedBy,
          leftAt: null,
        })
        .where(
          and(
            eq(
              schema.subscriptionMembers.subscriptionId,
              input.subscriptionId
            ),
            eq(schema.subscriptionMembers.userId, input.userId)
          )
        )
    }
    // else: active member already — no-op (legacy behaviour preserved).

    // Auto-create friendship between inviter and invitee (T7).
    // Self-adds (owner-insert) produce no friendship.
    if (input.addedBy !== input.userId) {
      const [lo, hi] =
        input.addedBy < input.userId
          ? [input.addedBy, input.userId]
          : [input.userId, input.addedBy]
      await tx.insert(schema.friendships)
        .values({ userAId: lo, userBId: hi })
        .onConflictDoNothing()
    }

    // R2 — immediate pro-rata bill for the joiner (except when joiner is payer).
    const [sub] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, input.subscriptionId))

    if (!sub || sub.payerId === input.userId) return
    // Inactive subs: add to member list (for record-keeping / friendship),
    // but skip R2 — no charges are incurring for the dormant service.
    if (sub.inactive) return

    // Use the CANONICAL addedAt from the DB (first successful insert wins,
    // re-adds are no-ops) so billing_date is stable across re-adds.
    const [memberRow] = await tx
      .select({ addedAt: schema.subscriptionMembers.addedAt })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
          eq(schema.subscriptionMembers.userId, input.userId)
        )
      )

    if (!memberRow) return
    const canonicalAddedAt = memberRow.addedAt

    const members = await getActiveMembersAt(
      tx,
      input.subscriptionId,
      canonicalAddedAt
    )
    if (members.length < 2) return

    const share = calculateShares(sub.price, members.length)
    const [year, month, day] = canonicalAddedAt.split('-').map(Number)
    const daysInMonth = new Date(year, month, 0).getDate()
    const amount = calculateJoinProRata(share, day, daysInMonth)
    if (amount <= 0) return

    const [user] = await tx
      .select({ preferredCurrency: schema.users.preferredCurrency })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))

    if (!user) return

    const rate =
      sub.currency === user.preferredCurrency
        ? 1
        : rates[`${sub.currency}_${user.preferredCurrency}`]
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(
        `Missing exchange rate for ${sub.currency}_${user.preferredCurrency}`
      )
    }
    const localAmount = Math.floor(amount * rate)

    // Idempotent: skip if a bill already exists for this sub/user/canonicalDate.
    const [existing] = await tx
      .select({ id: schema.billingRecords.id })
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, input.subscriptionId),
          eq(schema.billingRecords.userId, input.userId),
          eq(schema.billingRecords.billingDate, canonicalAddedAt)
        )
      )
    if (existing) return

    await tx.insert(schema.billingRecords)
      .values({
        subscriptionId: input.subscriptionId,
        userId: input.userId,
        amount,
        currency: sub.currency,
        localAmount,
        localCurrency: user.preferredCurrency,
        exchangeRate: Math.round(rate * 1_000_000),
        billingDate: canonicalAddedAt,
      })

    // T11 — added_to_sub notification (only on first-time insert).
    if (isNewMember) {
      const [inviter] = await tx
        .select({
          name: schema.users.name,
          displayName: schema.users.displayName,
        })
        .from(schema.users)
        .where(eq(schema.users.id, input.addedBy))

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
        userId: input.userId,
        type: 'added_to_sub',
        subscriptionId: input.subscriptionId,
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
  })
}

/**
 * Remove a member from a subscription. Sets left_at on the membership row.
 * Generates NO billing records (R3 — pre-paid, no refund).
 * Rejects when the leaving user is the payer (R7) — transfer first.
 * Idempotent: re-calling on an already-left member is a no-op (keeps
 * the original leftAt so accounting history is stable).
 */
export async function leaveSubscription(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    leftAt: string // ISO date YYYY-MM-DD
    actorId?: number // defaults to userId (self-leave)
  }
): Promise<void> {
  const actorId = input.actorId ?? input.userId
  const isKick = actorId !== input.userId

  const [sub] = await db
    .select({
      name: schema.subscriptions.name,
      payerId: schema.subscriptions.payerId,
      price: schema.subscriptions.price,
      refundPolicy: schema.subscriptions.refundPolicy,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, input.subscriptionId))


  if (!sub) throw new Error('Subscription not found')

  if (sub.payerId === input.userId) {
    throw new Error(
      'Payer cannot leave — transfer payer to another member first'
    )
  }

  const [row] = await db
    .select({
      leftAt: schema.subscriptionMembers.leftAt,
      addedAt: schema.subscriptionMembers.addedAt,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )


  if (!row) throw new Error('User is not a member of this subscription')

  if (row.leftAt !== null) return // idempotent

  // No minimum-cycle commitment — members can leave at any time and only
  // pay for the days they actually used (calculateLeaveProRata below).
  const leftAt = input.leftAt

  // Atomic: leftAt + bill prorate + redistribute + notification must all
  // succeed or all roll back, otherwise a mid-flight crash can leave the
  // leaver off the sub but their unpaid bill not prorated.
  await db.transaction(async (tx) => {
    await tx.update(schema.subscriptionMembers)
      .set({ leftAt })
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
          eq(schema.subscriptionMembers.userId, input.userId)
        )
      )

    // Rewrite the leaver's unpaid bill for the current month to reflect
    // only the days they actually used.  Paid bills stay locked.
    // `stintStart` is this stint's addedAt — bills from earlier stints (in
    // a rejoin scenario) have billingDate < stintStart and must not be
    // touched, since they were already prorated when the earlier stint ended.
    await prorateLeaverBill(tx, {
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      payerId: sub.payerId,
      leftAt,
      stintStart: row.addedAt,
      refundPolicy: sub.refundPolicy as 'payer_absorbs' | 'redistribute',
      subPrice: sub.price,
      subName: sub.name,
    })

    if (isKick) {
      const [actor] = await tx
        .select({
          name: schema.users.name,
          displayName: schema.users.displayName,
        })
        .from(schema.users)
        .where(eq(schema.users.id, actorId))

      await insertNotification(tx, {
        userId: input.userId,
        type: 'removed_from_sub',
        subscriptionId: input.subscriptionId,
        payload: {
          sub_name: sub.name,
          actor_name: actor?.displayName || actor?.name || 'Someone',
        },
      })
    }
  })
}

/**
 * Rewrite the leaver's current-month unpaid bill(s) to charge only for
 * the days they actually used. If the resulting amount is zero, delete
 * the bill outright. If the subscription's `refund_policy` is
 * 'redistribute', the diff is split across the remaining unpaid
 * non-payer members' bills in the same month (falls back silently to
 * 'payer_absorbs' if no such member exists).
 */
async function prorateLeaverBill(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    payerId: number
    leftAt: string
    stintStart: string
    refundPolicy: 'payer_absorbs' | 'redistribute'
    subPrice: number
    subName: string
  }
): Promise<void> {
  const [y, m, d] = input.leftAt.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const monthEndExclusive = (() => {
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    return `${ny}-${String(nm).padStart(2, '0')}-01`
  })()
  // Earlier-stint bills have billingDate < stintStart — already locked from
  // when that stint ended, must not be re-prorated here.
  const floor = input.stintStart > monthStart ? input.stintStart : monthStart

  const bills = await db
    .select({
      id: schema.billingRecords.id,
      amount: schema.billingRecords.amount,
      localAmount: schema.billingRecords.localAmount,
      billingDate: schema.billingRecords.billingDate,
    })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, input.subscriptionId),
        eq(schema.billingRecords.userId, input.userId),
        eq(schema.billingRecords.isPaid, false),
        gte(schema.billingRecords.billingDate, floor),
        sql`${schema.billingRecords.billingDate} < ${monthEndExclusive}`
      )
    )

  for (const bill of bills) {
    const cycleStartDay = Number(bill.billingDate.slice(8, 10))
    // R1 bills (billing_date = YYYY-MM-01) cover the whole month.
    // R2 bills (billing_date = join day) cover join..month-end.
    // bill.amount already reflects this coverage; we prorate against
    // it directly rather than trying to reconstruct the original share.
    const coverageDays = daysInMonth - cycleStartDay + 1

    let usageDays = d - cycleStartDay
    // Last-day leave = full coverage (user-specified override).
    if (d >= daysInMonth) usageDays = coverageDays

    if (usageDays <= 0) {
      await db
        .delete(schema.billingRecords)
        .where(eq(schema.billingRecords.id, bill.id))
      continue
    }
    if (usageDays >= coverageDays) continue // nothing to adjust

    const newAmount = Math.floor((bill.amount * usageDays) / coverageDays)
    const newLocalAmount = Math.floor(
      (bill.localAmount * usageDays) / coverageDays
    )

    const diffAmount = bill.amount - newAmount
    const diffLocalAmount = bill.localAmount - newLocalAmount

    await db
      .update(schema.billingRecords)
      .set({ amount: newAmount, localAmount: newLocalAmount })
      .where(eq(schema.billingRecords.id, bill.id))

    if (input.refundPolicy !== 'redistribute' || diffAmount <= 0) continue

    // Redistribute the diff across other unpaid non-payer bills in the
    // same calendar month.
    const others = await db
      .select({
        id: schema.billingRecords.id,
        amount: schema.billingRecords.amount,
        localAmount: schema.billingRecords.localAmount,
        localCurrency: schema.billingRecords.localCurrency,
        userId: schema.billingRecords.userId,
      })
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, input.subscriptionId),
          eq(schema.billingRecords.isPaid, false),
          gte(schema.billingRecords.billingDate, monthStart),
          sql`${schema.billingRecords.billingDate} < ${monthEndExclusive}`,
          ne(schema.billingRecords.userId, input.userId),
          // Defensive: payer should never have billing_records per R8, but
          // exclude explicitly so a stray row can't be inadvertently topped up.
          ne(schema.billingRecords.userId, input.payerId)
        )
      )

    if (others.length === 0) continue

    const addPer = Math.floor(diffAmount / others.length)
    const addPerLocal = Math.floor(diffLocalAmount / others.length)
    let remainderAmount = diffAmount - addPer * others.length
    let remainderLocal = diffLocalAmount - addPerLocal * others.length

    for (const o of others) {
      const extra = addPer + (remainderAmount > 0 ? 1 : 0)
      const extraLocal = addPerLocal + (remainderLocal > 0 ? 1 : 0)
      if (remainderAmount > 0) remainderAmount--
      if (remainderLocal > 0) remainderLocal--

      await db
        .update(schema.billingRecords)
        .set({
          amount: o.amount + extra,
          localAmount: o.localAmount + extraLocal,
        })
        .where(eq(schema.billingRecords.id, o.id))

      // Notify the member whose bill just went up.
      if (extra > 0) {
        await insertNotification(db, {
          userId: o.userId,
          type: 'bill_adjusted',
          subscriptionId: input.subscriptionId,
          payload: {
            sub_name: input.subName,
            delta_amount: extra,
            delta_local_amount: extraLocal,
            local_currency: o.localCurrency,
            reason: 'member_left',
          },
        })
      }
    }
  }
}

/**
 * Active membership at a specific date. A member is active iff:
 *   addedAt <= atDate  AND  (leftAt IS NULL OR leftAt > atDate)
 *
 * leftAt is the first day the member is no longer on the service, so a
 * member whose leftAt equals atDate is NOT active that day. Using strict
 * > here prevents R1 from billing someone kicked on the 1st.
 */
export async function getActiveMembersAt(
  db: DB,
  subscriptionId: number,
  atDate: string
): Promise<Array<{
  userId: number
  addedAt: string
  addedBy: number
  leftAt: string | null
}>> {
  return db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subscriptionId),
        lte(schema.subscriptionMembers.addedAt, atDate),
        or(
          isNull(schema.subscriptionMembers.leftAt),
          gt(schema.subscriptionMembers.leftAt, atDate)
        )
      )
    )
}

export async function getMembersOfSubscription(
  db: DB,
  subscriptionId: number
): Promise<Array<{
  userId: number
  addedAt: string
  addedBy: number
  leftAt: string | null
}>> {
  return db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(eq(schema.subscriptionMembers.subscriptionId, subscriptionId))
    
}

export async function getSubscriptionsForUser(
  db: DB,
  userId: number
): Promise<Array<{
  id: number
  name: string
  price: number
  currency: string
  nextPayment: string
  memberCount: number
  inactive: boolean
}>> {
  // All subs the user is an active member of (subscription_members is
  // authoritative). Covers both owned personal subs (owner auto-added on
  // create) and shared subs where the user was added later.
  const subIds = (await db
    .select({ subscriptionId: schema.subscriptionMembers.subscriptionId })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.userId, userId),
        isNull(schema.subscriptionMembers.leftAt)
      )
    )
  ).map((r) => r.subscriptionId)

  if (subIds.length === 0) return []

  return db
    .select({
      id: schema.subscriptions.id,
      name: schema.subscriptions.name,
      price: schema.subscriptions.price,
      currency: schema.subscriptions.currency,
      nextPayment: schema.subscriptions.nextPayment,
      inactive: schema.subscriptions.inactive,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM subscription_members
        WHERE subscription_id = ${schema.subscriptions.id}
          AND left_at IS NULL
      )`,
    })
    .from(schema.subscriptions)
    .where(inArray(schema.subscriptions.id, subIds))
    
}

/**
 * R1 monthly cron. On the 1st of month `yearMonth`, insert one billing_record
 * per active non-payer member per shared subscription.
 *
 * A "shared" sub is any non-inactive sub that has more than one active member.
 * Skips personal subs (no co-members) and inactive subs.
 * Active members = await getActiveMembersAt(sub.id, '<YYYY-MM>-01').
 * Share = floor(price / activeMemberCount).
 * Idempotent via UNIQUE(subscription_id, user_id, billing_date).
 *
 * @param yearMonth like '2026-05'
 * @param rates optional FX map, keys like 'USD_CNY' → numeric rate
 * @returns number of bills inserted
 */
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
 * Emits one price_changed notification per active non-payer member with
 * effective_from = current month's 1st.
 */
export async function changeSubscriptionPrice(
  db: DB,
  input: { subscriptionId: number; newPrice: number }
): Promise<void> {
  if (
    typeof input.newPrice !== 'number' ||
    !Number.isFinite(input.newPrice) ||
    input.newPrice < 0
  ) {
    throw new Error('newPrice must be a non-negative number')
  }

  await db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, input.subscriptionId))

    if (!sub) throw new Error('Subscription not found')

    const oldPrice = sub.price
    if (oldPrice === input.newPrice) return

    await tx.update(schema.subscriptions)
      .set({ price: input.newPrice })
      .where(eq(schema.subscriptions.id, input.subscriptionId))

    const today = new Date().toISOString().slice(0, 10)
    const members = await getActiveMembersAt(tx, input.subscriptionId, today)
    const nonPayers = members.filter((m) => m.userId !== sub.payerId)

    const n = members.length
    const oldShare = n > 0 ? calculateShares(oldPrice, n) : 0
    const newShare = n > 0 ? calculateShares(input.newPrice, n) : 0

    const [yy, mm] = today.split('-').map(Number)
    const monthStart = `${yy}-${String(mm).padStart(2, '0')}-01`
    const daysInMonth = new Date(yy, mm, 0).getDate()
    const monthEnd = `${yy}-${String(mm).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

    // Only rewrite bills belonging to members still active today — a member
    // who already left keeps their existing (possibly R4-stale) amount so
    // the price change never retroactively enlarges a departed member's debt.
    const activeUserIds = members.map((m) => m.userId)
    const currentMonthBills =
      activeUserIds.length === 0
        ? []
        : await tx
            .select()
            .from(schema.billingRecords)
            .where(
              and(
                eq(schema.billingRecords.subscriptionId, input.subscriptionId),
                eq(schema.billingRecords.isPaid, false),
                gte(schema.billingRecords.billingDate, monthStart),
                lte(schema.billingRecords.billingDate, monthEnd),
                inArray(schema.billingRecords.userId, activeUserIds)
              )
            )

    for (const bill of currentMonthBills) {
      let newAmount: number
      if (bill.billingDate === monthStart) {
        newAmount = newShare
      } else {
        const dayOfMonth = Number(bill.billingDate.slice(8, 10))
        const daysCovered = daysInMonth - dayOfMonth + 1
        newAmount = Math.floor((newShare * daysCovered) / daysInMonth)
      }
      const newLocalAmount = Math.floor(
        (newAmount * bill.exchangeRate) / 1_000_000
      )
      await tx.update(schema.billingRecords)
        .set({ amount: newAmount, localAmount: newLocalAmount })
        .where(eq(schema.billingRecords.id, bill.id))
    }

    if (nonPayers.length === 0) return

    for (const m of nonPayers) {
      await insertNotification(tx, {
        userId: m.userId,
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
          effective_from: monthStart,
        },
      })
    }
  })
}

export async function generateMonthlyBills(
  db: DB,
  yearMonth: string,
  rates: Record<string, number> = {}
): Promise<number> {
  const billingDate = `${yearMonth}-01`

  const subs = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.inactive, false))
    

  let inserted = 0

  for (const sub of subs) {
    const members = await getActiveMembersAt(db, sub.id, billingDate)
    if (members.length < 2) continue // personal or empty

    const nonPayers = members.filter((m) => m.userId !== sub.payerId)
    if (nonPayers.length === 0) continue

    const share = calculateShares(sub.price, members.length)

    // Isolate FX / insertion failures to a single sub so one bad rate
    // does not abort the cron for the rest of the month's subscriptions.
    // The transaction rolls this sub back atomically; other subs are
    // unaffected because each runs in its own `db.transaction`.
    try {
      inserted += await db.transaction(async (tx) => {
        let count = 0
        for (const member of nonPayers) {
          const [user] = await tx
            .select({ preferredCurrency: schema.users.preferredCurrency })
            .from(schema.users)
            .where(eq(schema.users.id, member.userId))
          if (!user) continue

          const rate =
            sub.currency === user.preferredCurrency
              ? 1
              : rates[`${sub.currency}_${user.preferredCurrency}`]
          if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
            throw new Error(
              `Missing exchange rate for ${sub.currency}_${user.preferredCurrency}`
            )
          }

          const localAmount = Math.floor(share * rate)

          const [existing] = await tx
            .select({ id: schema.billingRecords.id })
            .from(schema.billingRecords)
            .where(
              and(
                eq(schema.billingRecords.subscriptionId, sub.id),
                eq(schema.billingRecords.userId, member.userId),
                eq(schema.billingRecords.billingDate, billingDate)
              )
            )
          if (existing) continue

          await tx.insert(schema.billingRecords)
            .values({
              subscriptionId: sub.id,
              userId: member.userId,
              amount: share,
              currency: sub.currency,
              localAmount,
              localCurrency: user.preferredCurrency,
              exchangeRate: Math.round(rate * 1_000_000),
              billingDate,
            })
          count++
        }
        return count
      })
    } catch (err) {
      // Per-sub best-effort. Log loud enough that operators can notice a
      // stuck billing run (e.g. missing FX rate); the transaction above
      // already rolled back, so other subs are unaffected.
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[billing] generateMonthlyBills sub=${sub.id} name="${sub.name}" failed: ${message}`
      )
    }
  }

  return inserted
}

export async function generateAndSaveBillingRecords(
  db: DB,
  subscriptionId: number,
  rates?: Record<string, number>
): Promise<number> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    

  if (!sub || sub.inactive) return 0

  const memberRows = await getActiveMembersAt(db, subscriptionId, sub.nextPayment)
  if (memberRows.length < 2) return 0 // personal sub — no bills to generate

  const memberIds = memberRows.map((m) => m.userId)
  const users = await db
    .select({
      id: schema.users.id,
      preferredCurrency: schema.users.preferredCurrency,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, memberIds))
    
  const prefByUser = new Map(
    users.map((u) => [u.id, u.preferredCurrency])
  )

  const members = memberRows.map((m) => ({
    userId: m.userId,
    preferredCurrency: prefByUser.get(m.userId) ?? 'CNY',
  }))

  const nonPayerMembers = members.filter((m) => m.userId !== sub.payerId)
  if (nonPayerMembers.length === 0) return 0

  const memberCount = members.length
  const share = calculateShares(sub.price, memberCount)

  return db.transaction(async (tx) => {
    let inserted = 0

    for (const member of nonPayerMembers) {
      const [existing] = await tx
        .select({ id: schema.billingRecords.id })
        .from(schema.billingRecords)
        .where(
          and(
            eq(schema.billingRecords.subscriptionId, subscriptionId),
            eq(schema.billingRecords.userId, member.userId),
            eq(schema.billingRecords.billingDate, sub.nextPayment)
          )
        )

      if (existing) continue

      let rate: number
      if (sub.currency === member.preferredCurrency) {
        rate = 1
      } else {
        const rateKey = `${sub.currency}_${member.preferredCurrency}`
        const r = rates?.[rateKey]
        if (r === undefined || !Number.isFinite(r) || r <= 0) {
          throw new Error(`Missing exchange rate for ${rateKey}`)
        }
        rate = r
      }
      const localAmount = Math.floor(share * rate)

      await tx.insert(schema.billingRecords)
        .values({
          subscriptionId,
          userId: member.userId,
          amount: share,
          currency: sub.currency,
          localAmount,
          localCurrency: member.preferredCurrency,
          exchangeRate: Math.round(rate * 1_000_000),
          billingDate: sub.nextPayment,
        })
        

      inserted++
    }

    return inserted
  })
}

export async function getPendingBills(
  db: DB,
  userId: number
): Promise<Array<{
  id: number
  subscriptionName: string
  amount: number
  currency: string
  localAmount: number
  localCurrency: string
  billingDate: string
  isPaid: boolean
}>> {
  return db
    .select({
      id: schema.billingRecords.id,
      subscriptionName: schema.subscriptions.name,
      amount: schema.billingRecords.amount,
      currency: schema.billingRecords.currency,
      localAmount: schema.billingRecords.localAmount,
      localCurrency: schema.billingRecords.localCurrency,
      billingDate: schema.billingRecords.billingDate,
      isPaid: schema.billingRecords.isPaid,
    })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.billingRecords.userId, userId),
        eq(schema.billingRecords.isPaid, false)
      )
    )
    
}

export async function markBillPaid(db: DB, billId: number): Promise<void> {
  await db.update(schema.billingRecords)
    .set({
      isPaid: true,
      paidAt: new Date().toISOString(),
    })
    .where(eq(schema.billingRecords.id, billId))
    
}

export async function getMonthlySpendingData(
  db: DB,
  userId: number
): Promise<Array<{
  id: number
  name: string
  price: number
  currency: string
  memberCount: number
}>> {
  const subs = await getSubscriptionsForUser(db, userId)
  return subs
    .filter((s) => !s.inactive)
    .map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      currency: s.currency,
      memberCount: s.memberCount,
    }))
}

