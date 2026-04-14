import { eq, and, sql, inArray, isNull, or, gte, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { calculateShares, calculateJoinProRata } from './billing'
import { insertNotification } from './notifications'

type DB = BetterSQLite3Database<typeof schema>

export function createSubscription(
  db: DB,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    ownerId: number
    payerId?: number
    groupId?: number
    logo?: string
    url?: string
    notes?: string
    categoryId?: number
    startDate?: string // defaults to today; owner's addedAt matches this
  }
): { id: number; name: string; groupId: number | null } {
  const today = new Date().toISOString().slice(0, 10)
  const startDate = input.startDate ?? today

  const result = db
    .insert(schema.subscriptions)
    .values({
      name: input.name,
      price: input.price,
      currency: input.currency,
      nextPayment: input.nextPayment,
      startDate,
      ownerId: input.ownerId,
      payerId: input.payerId ?? input.ownerId,
      groupId: input.groupId ?? null,
      logo: input.logo ?? null,
      url: input.url ?? null,
      notes: input.notes ?? null,
      categoryId: input.categoryId ?? null,
    })
    .returning()
    .get()

  // Owner is automatically the first member (and payer by default).
  db.insert(schema.subscriptionMembers)
    .values({
      subscriptionId: result.id,
      userId: input.ownerId,
      addedBy: input.ownerId,
      addedAt: startDate,
    })
    .onConflictDoNothing()
    .run()

  return { id: result.id, name: result.name, groupId: result.groupId }
}

export function addMemberToSubscription(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    addedBy: number
    addedAt: string // ISO date YYYY-MM-DD
  },
  rates: Record<string, number> = {}
): void {
  // Detect whether this is a genuine new insert vs. a no-op re-add.
  const existingMember = db
    .select({ userId: schema.subscriptionMembers.userId })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )
    .get()
  const isNewMember = !existingMember

  db.insert(schema.subscriptionMembers)
    .values({
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      addedBy: input.addedBy,
      addedAt: input.addedAt,
    })
    .onConflictDoNothing()
    .run()

  // Auto-create friendship between inviter and invitee (T7).
  // Self-adds (owner-insert) produce no friendship.
  if (input.addedBy !== input.userId) {
    const [lo, hi] =
      input.addedBy < input.userId
        ? [input.addedBy, input.userId]
        : [input.userId, input.addedBy]
    db.insert(schema.friendships)
      .values({ userAId: lo, userBId: hi })
      .onConflictDoNothing()
      .run()
  }

  // R2 — immediate pro-rata bill for the joiner (except when joiner is payer).
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, input.subscriptionId))
    .get()

  if (!sub || sub.payerId === input.userId) return

  // Use the CANONICAL addedAt from the DB (first successful insert wins,
  // re-adds are no-ops) so billing_date is stable across re-adds.
  const memberRow = db
    .select({ addedAt: schema.subscriptionMembers.addedAt })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )
    .get()
  if (!memberRow) return
  const canonicalAddedAt = memberRow.addedAt

  const members = getActiveMembersAt(
    db,
    input.subscriptionId,
    canonicalAddedAt
  )
  if (members.length < 2) return

  const share = calculateShares(sub.price, members.length)
  const [year, month, day] = canonicalAddedAt.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const amount = calculateJoinProRata(share, day, daysInMonth)
  if (amount <= 0) return

  const user = db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .get()
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
  const existing = db
    .select({ id: schema.billingRecords.id })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, input.subscriptionId),
        eq(schema.billingRecords.userId, input.userId),
        eq(schema.billingRecords.billingDate, canonicalAddedAt)
      )
    )
    .get()
  if (existing) return

  db.insert(schema.billingRecords)
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
    .run()

  // T11 — added_to_sub notification (only on first-time insert).
  if (isNewMember) {
    const inviter = db
      .select({
        name: schema.users.name,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, input.addedBy))
      .get()
    const payer = db
      .select({
        name: schema.users.name,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, sub.payerId))
      .get()

    const [yy, mm] = canonicalAddedAt.split('-').map(Number)
    const nextBillingDate =
      mm === 12
        ? `${yy + 1}-01-01`
        : `${yy}-${String(mm + 1).padStart(2, '0')}-01`

    insertNotification(db, {
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
}

/**
 * Remove a member from a subscription. Sets left_at on the membership row.
 * Generates NO billing records (R3 — pre-paid, no refund).
 * Rejects when the leaving user is the payer (R7) — transfer first.
 * Idempotent: re-calling on an already-left member is a no-op (keeps
 * the original leftAt so accounting history is stable).
 */
export function leaveSubscription(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    leftAt: string // ISO date YYYY-MM-DD
    actorId?: number // defaults to userId (self-leave)
  }
): void {
  const actorId = input.actorId ?? input.userId
  const isKick = actorId !== input.userId

  const sub = db
    .select({
      name: schema.subscriptions.name,
      payerId: schema.subscriptions.payerId,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, input.subscriptionId))
    .get()

  if (!sub) throw new Error('Subscription not found')

  if (sub.payerId === input.userId) {
    throw new Error(
      'Payer cannot leave — transfer payer to another member first'
    )
  }

  const row = db
    .select({ leftAt: schema.subscriptionMembers.leftAt })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )
    .get()

  if (!row) throw new Error('User is not a member of this subscription')

  if (row.leftAt !== null) return // idempotent

  db.update(schema.subscriptionMembers)
    .set({ leftAt: input.leftAt })
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )
    .run()

  if (isKick) {
    const actor = db
      .select({
        name: schema.users.name,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, actorId))
      .get()
    insertNotification(db, {
      userId: input.userId,
      type: 'removed_from_sub',
      subscriptionId: input.subscriptionId,
      payload: {
        sub_name: sub.name,
        actor_name: actor?.displayName || actor?.name || 'Someone',
      },
    })
  }
}

/**
 * Active membership at a specific date. A member is active iff:
 *   addedAt <= atDate  AND  (leftAt IS NULL OR leftAt >= atDate)
 *
 * The "leftAt >= atDate" convention treats the leave day as still-billable
 * (last active day) — pre-paid model, member used the service that day.
 */
export function getActiveMembersAt(
  db: DB,
  subscriptionId: number,
  atDate: string
): Array<{
  userId: number
  addedAt: string
  addedBy: number
  leftAt: string | null
}> {
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
          gte(schema.subscriptionMembers.leftAt, atDate)
        )
      )
    )
    .all()
}

export function getMembersOfSubscription(
  db: DB,
  subscriptionId: number
): Array<{
  userId: number
  addedAt: string
  addedBy: number
  leftAt: string | null
}> {
  return db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(eq(schema.subscriptionMembers.subscriptionId, subscriptionId))
    .all()
}

export function getSubscriptionsForUser(
  db: DB,
  userId: number
): Array<{
  id: number
  name: string
  price: number
  currency: string
  nextPayment: string
  groupId: number | null
  memberCount: number
  inactive: number
}> {
  // Personal subscriptions (no group)
  const personal = db
    .select({
      id: schema.subscriptions.id,
      name: schema.subscriptions.name,
      price: schema.subscriptions.price,
      currency: schema.subscriptions.currency,
      nextPayment: schema.subscriptions.nextPayment,
      groupId: schema.subscriptions.groupId,
      inactive: schema.subscriptions.inactive,
    })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.ownerId, userId),
        isNull(schema.subscriptions.groupId)
      )
    )
    .all()
    .map((s) => ({ ...s, memberCount: 1 }))

  // Shared subscriptions (user is a group member)
  const userGroups = db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, userId))
    .all()

  const groupIds = userGroups.map((g) => g.groupId)

  if (groupIds.length === 0) return personal

  // Single query with subquery for member count (avoids N+1)
  const shared = db
    .select({
      id: schema.subscriptions.id,
      name: schema.subscriptions.name,
      price: schema.subscriptions.price,
      currency: schema.subscriptions.currency,
      nextPayment: schema.subscriptions.nextPayment,
      groupId: schema.subscriptions.groupId,
      inactive: schema.subscriptions.inactive,
      memberCount: sql<number>`(
        SELECT count(*) FROM group_members WHERE group_id = ${schema.subscriptions.groupId}
      )`,
    })
    .from(schema.subscriptions)
    .where(inArray(schema.subscriptions.groupId, groupIds))
    .all()

  return [...personal, ...shared]
}

export function getGroupWithMembers(
  db: DB,
  groupId: number
): {
  id: number
  name: string
  publicId: string
  createdBy: number
  members: Array<{ userId: number; name: string }>
} | null {
  const group = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .get()

  if (!group) return null

  const members = db
    .select({
      userId: schema.groupMembers.userId,
      name: schema.users.name,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.groupMembers.userId, schema.users.id))
    .where(eq(schema.groupMembers.groupId, groupId))
    .all()

  return {
    id: group.id,
    name: group.name,
    publicId: group.publicId,
    createdBy: group.createdBy,
    members,
  }
}

/**
 * R1 monthly cron. On the 1st of month `yearMonth`, insert one billing_record
 * per active non-payer member per shared subscription.
 *
 * A "shared" sub is any non-inactive sub that has more than one active member.
 * Skips personal subs (no co-members) and inactive subs.
 * Active members = getActiveMembersAt(sub.id, '<YYYY-MM>-01').
 * Share = floor(price / activeMemberCount).
 * Idempotent via UNIQUE(subscription_id, user_id, billing_date).
 *
 * @param yearMonth like '2026-05'
 * @param rates optional FX map, keys like 'USD_CNY' → numeric rate
 * @returns number of bills inserted
 */
/**
 * T13 — transfer the payer role to another active member.
 *
 * Updates subscriptions.payer_id. Emits one payer_changed notification to
 * every active member (including old and new payer) so everyone sees where
 * money now flows.
 *
 * Rejects if new payer is not an active member, or equals current payer.
 * Existing billing_records are unchanged; next monthly cron will exclude
 * the new payer and include the former payer (if they're still a member).
 */
export function transferPayer(
  db: DB,
  input: { subscriptionId: number; newPayerId: number }
): void {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, input.subscriptionId))
    .get()
  if (!sub) throw new Error('Subscription not found')

  if (sub.payerId === input.newPayerId) {
    throw new Error('User is already the payer')
  }

  const today = new Date().toISOString().slice(0, 10)
  const members = getActiveMembersAt(db, input.subscriptionId, today)
  const isMember = members.some((m) => m.userId === input.newPayerId)
  if (!isMember) {
    throw new Error('New payer must be an active member of the subscription')
  }

  const oldPayer = db
    .select({
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, sub.payerId))
    .get()
  const newPayer = db
    .select({
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, input.newPayerId))
    .get()

  db.update(schema.subscriptions)
    .set({ payerId: input.newPayerId })
    .where(eq(schema.subscriptions.id, input.subscriptionId))
    .run()

  const oldPayerName = oldPayer?.displayName || oldPayer?.name || 'Previous'
  const newPayerName = newPayer?.displayName || newPayer?.name || 'New'

  for (const m of members) {
    insertNotification(db, {
      userId: m.userId,
      type: 'payer_changed',
      subscriptionId: input.subscriptionId,
      payload: {
        sub_name: sub.name,
        old_payer_id: sub.payerId,
        old_payer_name: oldPayerName,
        new_payer_id: input.newPayerId,
        new_payer_name: newPayerName,
      },
    })
  }
}

/**
 * T12 — change the price of a subscription (R5 non-retroactive).
 *
 * Updates subscriptions.price only. Does NOT touch any existing
 * billing_records. Emits one price_changed notification to each active
 * non-payer member with old/new price, old/new share, delta, and the
 * first billing date the new price takes effect (YYYY-MM-01 of next month).
 */
export function changeSubscriptionPrice(
  db: DB,
  input: { subscriptionId: number; newPrice: number }
): void {
  if (
    typeof input.newPrice !== 'number' ||
    !Number.isFinite(input.newPrice) ||
    input.newPrice < 0
  ) {
    throw new Error('newPrice must be a non-negative number')
  }

  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, input.subscriptionId))
    .get()
  if (!sub) throw new Error('Subscription not found')

  const oldPrice = sub.price
  if (oldPrice === input.newPrice) return

  db.update(schema.subscriptions)
    .set({ price: input.newPrice })
    .where(eq(schema.subscriptions.id, input.subscriptionId))
    .run()

  const today = new Date().toISOString().slice(0, 10)
  const members = getActiveMembersAt(db, input.subscriptionId, today)
  const nonPayers = members.filter((m) => m.userId !== sub.payerId)
  if (nonPayers.length === 0) return

  const n = members.length
  const oldShare = calculateShares(oldPrice, n)
  const newShare = calculateShares(input.newPrice, n)

  const [yy, mm] = today.split('-').map(Number)
  const effectiveFrom =
    mm === 12
      ? `${yy + 1}-01-01`
      : `${yy}-${String(mm + 1).padStart(2, '0')}-01`

  for (const m of nonPayers) {
    insertNotification(db, {
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
        effective_from: effectiveFrom,
      },
    })
  }
}

export function generateMonthlyBills(
  db: DB,
  yearMonth: string,
  rates: Record<string, number> = {}
): number {
  const billingDate = `${yearMonth}-01`

  const subs = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.inactive, 0))
    .all()

  let inserted = 0

  for (const sub of subs) {
    const members = getActiveMembersAt(db, sub.id, billingDate)
    if (members.length < 2) continue // personal or empty

    const nonPayers = members.filter((m) => m.userId !== sub.payerId)
    if (nonPayers.length === 0) continue

    const share = Math.floor(sub.price / members.length)

    inserted += db.transaction((tx) => {
      let count = 0
      for (const member of nonPayers) {
        const user = tx
          .select({ preferredCurrency: schema.users.preferredCurrency })
          .from(schema.users)
          .where(eq(schema.users.id, member.userId))
          .get()
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

        const existing = tx
          .select({ id: schema.billingRecords.id })
          .from(schema.billingRecords)
          .where(
            and(
              eq(schema.billingRecords.subscriptionId, sub.id),
              eq(schema.billingRecords.userId, member.userId),
              eq(schema.billingRecords.billingDate, billingDate)
            )
          )
          .get()
        if (existing) continue

        tx.insert(schema.billingRecords)
          .values({
            subscriptionId: sub.id,
            userId: member.userId,
            amount: share,
            currency: sub.currency,
            localAmount,
            localCurrency: user.preferredCurrency,
            exchangeRate: Math.round(rate * 1000000),
            billingDate,
          })
          .run()
        count++
      }
      return count
    })
  }

  return inserted
}

export function generateAndSaveBillingRecords(
  db: DB,
  subscriptionId: number,
  rates?: Record<string, number>
): number {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .get()

  if (!sub || !sub.groupId || sub.inactive) return 0

  const group = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, sub.groupId))
    .get()

  if (!group) return 0

  const members = db
    .select({
      userId: schema.groupMembers.userId,
      preferredCurrency: schema.users.preferredCurrency,
      joinedAt: schema.groupMembers.joinedAt,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.groupMembers.userId, schema.users.id))
    .where(eq(schema.groupMembers.groupId, sub.groupId))
    .all()

  const nonPayerMembers = members.filter((m) => m.userId !== group.createdBy)
  if (nonPayerMembers.length === 0) return 0

  const memberCount = members.length
  const share = calculateShares(sub.price, memberCount)

  return db.transaction((tx) => {
    let inserted = 0

    for (const member of nonPayerMembers) {
      const existing = tx
        .select({ id: schema.billingRecords.id })
        .from(schema.billingRecords)
        .where(
          and(
            eq(schema.billingRecords.subscriptionId, subscriptionId),
            eq(schema.billingRecords.userId, member.userId),
            eq(schema.billingRecords.billingDate, sub.nextPayment)
          )
        )
        .get()

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

      tx.insert(schema.billingRecords)
        .values({
          subscriptionId,
          userId: member.userId,
          amount: share,
          currency: sub.currency,
          localAmount,
          localCurrency: member.preferredCurrency,
          exchangeRate: rate * 1000000,
          billingDate: sub.nextPayment,
        })
        .run()

      inserted++
    }

    return inserted
  })
}

export function getPendingBills(
  db: DB,
  userId: number
): Array<{
  id: number
  subscriptionName: string
  amount: number
  currency: string
  localAmount: number
  localCurrency: string
  billingDate: string
  isPaid: number
}> {
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
        eq(schema.billingRecords.isPaid, 0)
      )
    )
    .all()
}

export function markBillPaid(db: DB, billId: number): void {
  db.update(schema.billingRecords)
    .set({
      isPaid: 1,
      paidAt: new Date().toISOString(),
    })
    .where(eq(schema.billingRecords.id, billId))
    .run()
}

export function getMonthlySpendingData(
  db: DB,
  userId: number
): Array<{
  name: string
  price: number
  currency: string
  memberCount: number
}> {
  const subs = getSubscriptionsForUser(db, userId)
  return subs
    .filter((s) => !s.inactive)
    .map((s) => ({
      name: s.name,
      price: s.price,
      currency: s.currency,
      memberCount: s.memberCount,
    }))
}

export function canLeaveGroup(
  db: DB,
  groupId: number,
  userId: number
): boolean {
  // Creator cannot leave
  const group = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .get()

  if (!group || group.createdBy === userId) return false

  // Check for unpaid bills in any subscription of this group
  const unpaid = db
    .select({ id: schema.billingRecords.id })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.subscriptions.groupId, groupId),
        eq(schema.billingRecords.userId, userId),
        eq(schema.billingRecords.isPaid, 0)
      )
    )
    .limit(1)
    .all()

  return unpaid.length === 0
}

export function removeGroupMember(
  db: DB,
  groupId: number,
  userId: number
): void {
  db.delete(schema.groupMembers)
    .where(
      and(
        eq(schema.groupMembers.groupId, groupId),
        eq(schema.groupMembers.userId, userId)
      )
    )
    .run()
}
