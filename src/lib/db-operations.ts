import { eq, and, sql, inArray, isNull, or, gte, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { calculateShares } from './billing'

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
  }
): void {
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
  }
): void {
  const sub = db
    .select({ payerId: schema.subscriptions.payerId })
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
