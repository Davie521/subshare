import { eq, and, inArray, or, desc } from 'drizzle-orm'
<<<<<<< HEAD
import { nanoid } from 'nanoid'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
||||||| edd84f2
import { nanoid } from 'nanoid'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
=======
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
>>>>>>> origin/main
import * as schema from '@/db/schema'
import {
  createSubscription,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
  addMemberToSubscription,
  leaveSubscription,
  transferPayer,
  changeSubscriptionPrice,
  generateMonthlyBills,
} from './db-operations'
import { calculateMonthlySpending } from './billing'
import { getRate } from './fx-cache'
import {
  getSettlementSummary,
  getSettledHistory,
  markPairSettled,
  type SettlementRow,
} from './settlement'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnreadNotifications,
  type NotificationRecord,
} from './notifications'
import {
  createCircle,
  listCirclesForOwner,
  getCircle,
  updateCircle,
  deleteCircle,
  type CircleSummary,
} from './circles'

type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>
type Result<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string }

<<<<<<< HEAD
const MAX_GROUP_MEMBERS = 20

export async function handleCreateGroup(
  db: DB,
  userId: number,
  input: { name: string }
): Promise<Result<{ id: number; name: string; publicId: string }>> {
  const publicId = nanoid(10)

  const [group] = await db
    .insert(schema.groups)
    .values({
      name: input.name,
      publicId,
      createdBy: userId,
    })
    .returning()

  // Add creator as member
  await db
    .insert(schema.groupMembers)
    .values({ groupId: group.id, userId })

  return {
    success: true,
    data: { id: group.id, name: group.name, publicId: group.publicId },
  }
}

export async function handleJoinGroup(
  db: DB,
  userId: number,
  publicId: string
): Promise<Result> {
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.publicId, publicId))

  if (!group) return { success: false, error: 'Group not found' }

  // Check if already a member
  const [existing] = await db
    .select()
    .from(schema.groupMembers)
    .where(
      and(
        eq(schema.groupMembers.groupId, group.id),
        eq(schema.groupMembers.userId, userId)
      )
    )

  if (existing) return { success: false, error: 'Already a member' }

  const memberRows = await db
    .select({ userId: schema.groupMembers.userId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, group.id))

  if (memberRows.length >= MAX_GROUP_MEMBERS) {
    return { success: false, error: 'Group is full' }
  }

  await db
    .insert(schema.groupMembers)
    .values({ groupId: group.id, userId })

  return { success: true }
}

export async function handleLeaveGroup(
  db: DB,
  userId: number,
  groupId: number
): Promise<Result> {
  if (!(await canLeaveGroup(db, groupId, userId))) {
    const [group] = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, groupId))

    if (group && group.createdBy === userId) {
      return {
        success: false,
        error: 'Creator cannot leave. Dissolve the group instead.',
      }
    }
    return { success: false, error: 'Cannot leave with unpaid bills' }
  }

  await removeGroupMember(db, groupId, userId)
  return { success: true }
}

export async function handleDeleteGroup(
  db: DB,
  userId: number,
  groupId: number
): Promise<Result> {
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))

  if (!group) return { success: false, error: 'Group not found' }
  if (group.createdBy !== userId)
    return {
      success: false,
      error: 'Only the creator can delete the group',
    }

  // Check for unpaid bills
  const unpaid = await db
    .select({ id: schema.billingRecords.id })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.subscriptions.groupId, groupId),
        eq(schema.billingRecords.isPaid, false)
      )
    )
    .limit(1)

  if (unpaid.length > 0)
    return { success: false, error: 'Cannot delete group with unpaid bills' }

  // Cascade delete: group → group_members, subscriptions → billing_records
  await db.delete(schema.groups).where(eq(schema.groups.id, groupId))

  return { success: true }
}

||||||| edd84f2
export function handleCreateGroup(
  db: DB,
  userId: number,
  input: { name: string }
): Result<{ id: number; name: string; publicId: string }> {
  const publicId = nanoid(10)

  const group = db
    .insert(schema.groups)
    .values({
      name: input.name,
      publicId,
      createdBy: userId,
    })
    .returning()
    .get()

  // Add creator as member
  db.insert(schema.groupMembers)
    .values({ groupId: group.id, userId })
    .run()

  return {
    success: true,
    data: { id: group.id, name: group.name, publicId: group.publicId },
  }
}

export function handleJoinGroup(
  db: DB,
  userId: number,
  publicId: string
): Result {
  const group = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.publicId, publicId))
    .get()

  if (!group) return { success: false, error: 'Group not found' }

  // Check if already a member
  const existing = db
    .select()
    .from(schema.groupMembers)
    .where(
      and(
        eq(schema.groupMembers.groupId, group.id),
        eq(schema.groupMembers.userId, userId)
      )
    )
    .get()

  if (existing) return { success: false, error: 'Already a member' }

  const memberCount = db
    .select({ userId: schema.groupMembers.userId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, group.id))
    .all().length

  if (memberCount >= MAX_GROUP_MEMBERS) {
    return { success: false, error: 'Group is full' }
  }

  db.insert(schema.groupMembers)
    .values({ groupId: group.id, userId })
    .run()

  return { success: true }
}

const MAX_GROUP_MEMBERS = 20

export function handleLeaveGroup(
  db: DB,
  userId: number,
  groupId: number
): Result {
  if (!canLeaveGroup(db, groupId, userId)) {
    const group = db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, groupId))
      .get()

    if (group && group.createdBy === userId) {
      return { success: false, error: 'Creator cannot leave. Dissolve the group instead.' }
    }
    return { success: false, error: 'Cannot leave with unpaid bills' }
  }

  removeGroupMember(db, groupId, userId)
  return { success: true }
}

export function handleDeleteGroup(
  db: DB,
  userId: number,
  groupId: number
): Result {
  const group = db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .get()

  if (!group) return { success: false, error: 'Group not found' }
  if (group.createdBy !== userId)
    return { success: false, error: 'Only the creator can delete the group' }

  // Check for unpaid bills
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
        eq(schema.billingRecords.isPaid, 0)
      )
    )
    .limit(1)
    .all()

  if (unpaid.length > 0)
    return { success: false, error: 'Cannot delete group with unpaid bills' }

  // Cascade delete: group → group_members, subscriptions → billing_records
  db.delete(schema.groups).where(eq(schema.groups.id, groupId)).run()

  return { success: true }
}

=======
>>>>>>> origin/main
export async function handleCreateSubscription(
  db: DB,
  userId: number,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    members?: number[]
    payerId?: number
    logo?: string
    url?: string
    notes?: string
    categoryId?: number
  }
<<<<<<< HEAD
): Promise<Result<{ id: number; name: string; groupId: number | null }>> {
  if (input.groupId) {
    const [membership] = await db
      .select()
      .from(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.groupId, input.groupId),
          eq(schema.groupMembers.userId, userId)
        )
      )

    if (!membership)
      return { success: false, error: 'You are not a member of this group' }
  }

||||||| edd84f2
): Promise<Result<{ id: number; name: string; groupId: number | null }>> {
  if (input.groupId) {
    const membership = db
      .select()
      .from(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.groupId, input.groupId),
          eq(schema.groupMembers.userId, userId)
        )
      )
      .get()

    if (!membership)
      return { success: false, error: 'You are not a member of this group' }
  }

=======
): Promise<Result<{ id: number; name: string }>> {
>>>>>>> origin/main
  const invitees = (input.members ?? []).filter((id) => id !== userId)
  const payerId = input.payerId ?? userId

  // payer must be the owner or one of the invitees.
  if (payerId !== userId && !invitees.includes(payerId)) {
    return {
      success: false,
      error: 'payerId must be the owner or one of the members',
    }
  }

  const sub = await createSubscription(db, {
    ...input,
    ownerId: userId,
    payerId,
  })

  // Seed invitees. Rates are needed for cross-currency R2 bills.
  if (invitees.length > 0) {
    const rates = await fetchRatesForUsers(db, invitees, input.currency)
    const today = new Date().toISOString().slice(0, 10)
    for (const uid of invitees) {
      await addMemberToSubscription(
        db,
        {
          subscriptionId: sub.id,
          userId: uid,
          addedBy: userId,
          addedAt: today,
        },
        rates
      )
    }
  }

<<<<<<< HEAD
  if (sub.groupId) {
    void fetchRatesForGroup(db, sub.groupId, input.currency)
      .then((rates) => generateAndSaveBillingRecords(db, sub.id, rates))
      .catch((err) =>
        console.error(
          '[billing] initial generation failed for sub',
          sub.id,
          err
        )
      )
  }

||||||| edd84f2
  if (sub.groupId) {
    void fetchRatesForGroup(db, sub.groupId, input.currency)
      .then((rates) => generateAndSaveBillingRecords(db, sub.id, rates))
      .catch((err) =>
        console.error('[billing] initial generation failed for sub', sub.id, err)
      )
  }

=======
>>>>>>> origin/main
  return { success: true, data: sub }
}

async function fetchRatesForUsers(
  db: DB,
  userIds: number[],
  subCurrency: string
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {}
  const rows = await db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds))
  const targets = new Set(
    rows.map((r) => r.preferredCurrency).filter((c) => c !== subCurrency)
  )
  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(targets).map(async (to) => {
      const rate = await getRate(subCurrency, to)
      if (rate !== null) rates[`${subCurrency}_${to}`] = rate
    })
  )
  return rates
}

<<<<<<< HEAD
async function fetchRatesForGroup(
  db: DB,
  groupId: number,
  subCurrency: string
): Promise<Record<string, number>> {
  const memberCurrencies = await db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.groupMembers.userId, schema.users.id))
    .where(eq(schema.groupMembers.groupId, groupId))

  const targets = new Set(
    memberCurrencies
      .map((m) => m.preferredCurrency)
      .filter((c) => c !== subCurrency)
  )
  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(targets).map(async (to) => {
      const rate = await getRate(subCurrency, to)
      if (rate !== null) rates[`${subCurrency}_${to}`] = rate
    })
  )
  return rates
}

||||||| edd84f2
async function fetchRatesForGroup(
  db: DB,
  groupId: number,
  subCurrency: string
): Promise<Record<string, number>> {
  const memberCurrencies = db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.groupMembers.userId, schema.users.id))
    .where(eq(schema.groupMembers.groupId, groupId))
    .all()

  const targets = new Set(
    memberCurrencies
      .map((m) => m.preferredCurrency)
      .filter((c) => c !== subCurrency)
  )
  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(targets).map(async (to) => {
      const rate = await getRate(subCurrency, to)
      if (rate !== null) rates[`${subCurrency}_${to}`] = rate
    })
  )
  return rates
}

=======
>>>>>>> origin/main
export async function handleAddMembers(
  db: DB,
  actorId: number,
  subId: number,
  memberIds: number[]
): Promise<Result<{ added: number }>> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
  if (!sub) return { success: false, error: 'Subscription not found' }

  if (sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or payer can add members',
    }
  }

  const invitees = memberIds.filter((id) => id !== actorId)
  if (invitees.length === 0) return { success: true, data: { added: 0 } }

  const rates = await fetchRatesForUsers(db, invitees, sub.currency)
  const today = new Date().toISOString().slice(0, 10)
  let added = 0
  for (const uid of invitees) {
    const [before] = await db
      .select({ userId: schema.subscriptionMembers.userId })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, subId),
          eq(schema.subscriptionMembers.userId, uid)
        )
      )
    if (before) continue
    await addMemberToSubscription(
      db,
      { subscriptionId: subId, userId: uid, addedBy: actorId, addedAt: today },
      rates
    )
    added++
  }

  return { success: true, data: { added } }
}

export async function handleRemoveMember(
  db: DB,
  actorId: number,
  subId: number,
  targetUserId: number
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
  if (!sub) return { success: false, error: 'Subscription not found' }

  const isSelf = actorId === targetUserId
  if (!isSelf && sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or payer can remove another member',
    }
  }

  try {
    await leaveSubscription(db, {
      subscriptionId: subId,
      userId: targetUserId,
      leftAt: new Date().toISOString().slice(0, 10),
      actorId,
    })
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to remove member',
    }
  }
  return { success: true }
}

/**
 * A10 — billing cron dispatcher. Runs on every invocation; only kicks
 * off the R1 monthly pass when today is the 1st of the month. Rates are
 * fetched once per (from, to) pair touched by any shared subscription.
 */
export async function runBillingCron(
  db: DB,
  opts: { today?: string } = {}
): Promise<Result<{ monthlyBillsGenerated: number }>> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const [year, month, day] = today.split('-').map(Number)
  if (day !== 1) {
    return { success: true, data: { monthlyBillsGenerated: 0 } }
  }

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`

  // Pre-load rates for every (sub.currency, member.preferredCurrency) pair.
  const pairs = await db
    .select({
      subCurrency: schema.subscriptions.currency,
      memberCurrency: schema.users.preferredCurrency,
    })
    .from(schema.subscriptionMembers)
    .innerJoin(
      schema.subscriptions,
      eq(schema.subscriptionMembers.subscriptionId, schema.subscriptions.id)
    )
    .innerJoin(
      schema.users,
      eq(schema.subscriptionMembers.userId, schema.users.id)
    )
    .where(eq(schema.subscriptions.inactive, false))

  const need = new Set<string>()
  for (const p of pairs) {
    if (p.subCurrency !== p.memberCurrency) {
      need.add(`${p.subCurrency}_${p.memberCurrency}`)
    }
  }

  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(need).map(async (key) => {
      const [from, to] = key.split('_')
      const rate = await getRate(from, to)
      if (rate !== null) rates[key] = rate
    })
  )

  const generated = await generateMonthlyBills(db, yearMonth, rates)
  return { success: true, data: { monthlyBillsGenerated: generated } }
}

export type EnrichedSettlementRow = SettlementRow & {
  counterpartyName: string
}

const CURRENCY_WHITELIST = new Set([
  'CNY',
  'USD',
  'HKD',
  'CAD',
  'EUR',
  'GBP',
  'JPY',
])

export async function handleGetSettlement(
  db: DB,
<<<<<<< HEAD
  userId: number
): Promise<Result<EnrichedSettlementRow[]>> {
  const rows = await getSettlementSummary(db, userId)
||||||| edd84f2
  userId: number
): Result<EnrichedSettlementRow[]> {
  const rows = getSettlementSummary(db, userId)
=======
  userId: number,
  opts: { view?: 'unpaid' | 'paid' } = {}
): Result<EnrichedSettlementRow[]> {
  const rows =
    opts.view === 'paid'
      ? getSettledHistory(db, userId)
      : getSettlementSummary(db, userId)
>>>>>>> origin/main
  if (rows.length === 0) return { success: true, data: [] }

  const counterpartyIds = Array.from(
    new Set(rows.map((r) => r.counterpartyUserId))
  )
  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, counterpartyIds))
  const byId = new Map(users.map((u) => [u.id, u]))

  const enriched: EnrichedSettlementRow[] = rows.map((r) => {
    const u = byId.get(r.counterpartyUserId)
    const counterpartyName = u?.displayName?.trim() || u?.name || 'Unknown'
    return { ...r, counterpartyName }
  })
  return { success: true, data: enriched }
}

export async function handleMarkPairSettled(
  db: DB,
  userId: number,
  counterpartyUserId: number,
  currency: string
): Promise<Result<{ marked: number }>> {
  if (userId === counterpartyUserId) {
    return { success: false, error: 'Cannot settle with yourself' }
  }
  if (!CURRENCY_WHITELIST.has(currency)) {
    return { success: false, error: 'Unsupported currency' }
  }
  const marked = await markPairSettled(db, {
    userA: userId,
    userB: counterpartyUserId,
    currency,
  })
  return { success: true, data: { marked } }
}

export interface FriendRow {
  userId: number
  displayName: string
  email?: string
  since: string
}

export async function handleListFriends(
  db: DB,
  userId: number
): Promise<Result<FriendRow[]>> {
  const rows = await db
    .select({
      userAId: schema.friendships.userAId,
      userBId: schema.friendships.userBId,
      since: schema.friendships.createdAt,
    })
    .from(schema.friendships)
    .where(
      or(
        eq(schema.friendships.userAId, userId),
        eq(schema.friendships.userBId, userId)
      )
    )
    .orderBy(desc(schema.friendships.createdAt))

  if (rows.length === 0) return { success: true, data: [] }

  const otherIds = rows.map((r) =>
    r.userAId === userId ? r.userBId : r.userAId
  )
  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      displayName: schema.users.displayName,
      email: schema.users.email,
      showEmail: schema.users.showEmail,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, otherIds))

  const byId = new Map(users.map((u) => [u.id, u]))
  const result: FriendRow[] = rows
    .map((r) => {
      const other = r.userAId === userId ? r.userBId : r.userAId
      const u = byId.get(other)
      if (!u) return null
      const out: FriendRow = {
        userId: u.id,
        displayName: u.displayName?.trim() || u.name,
        since: r.since,
      }
      if (u.showEmail) out.email = u.email
      return out
    })
    .filter((x): x is FriendRow => x !== null)

  return { success: true, data: result }
}

export async function handleListNotifications(
  db: DB,
  userId: number,
  limit = 50
): Promise<Result<{ items: NotificationRecord[]; unreadCount: number }>> {
  const items = await listNotifications(db, userId, limit)
  const unreadCount = await countUnreadNotifications(db, userId)
  return { success: true, data: { items, unreadCount } }
}

export async function handleMarkNotificationRead(
  db: DB,
  userId: number,
  notificationId: number
): Promise<Result> {
  const [row] = await db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .where(eq(schema.notifications.id, notificationId))
  if (!row) return { success: false, error: 'Notification not found' }
  if (row.userId !== userId) {
    return { success: false, error: 'Not your notification' }
  }
  await markNotificationRead(db, notificationId)
  return { success: true }
}

export async function handleMarkAllNotificationsRead(
  db: DB,
  userId: number
): Promise<Result> {
  await markAllNotificationsRead(db, userId)
  return { success: true }
}

export async function handleTransferPayer(
  db: DB,
  actorId: number,
  subId: number,
  newPayerId: number
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
  if (!sub) return { success: false, error: 'Subscription not found' }

  if (sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or current payer can transfer payer',
    }
  }

  try {
    await transferPayer(db, { subscriptionId: subId, newPayerId })
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to transfer payer',
    }
  }
  return { success: true }
}

export async function handleUpdateSubscription(
  db: DB,
  userId: number,
  subId: number,
  input: {
    name?: string
    price?: number
    nextPayment?: string
    inactive?: boolean
  }
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  if (!sub) return { success: false, error: 'Subscription not found' }
  if (sub.ownerId !== userId)
    return {
      success: false,
      error: 'Only the owner can update this subscription',
    }

  // Price changes go through changeSubscriptionPrice so R5 notifications fire.
  if (input.price !== undefined && input.price !== sub.price) {
    await changeSubscriptionPrice(db, {
      subscriptionId: subId,
      newPrice: input.price,
    })
  }

  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.nextPayment !== undefined) updates.nextPayment = input.nextPayment
  if (input.inactive !== undefined) updates.inactive = input.inactive

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.subscriptions)
      .set(updates)
      .where(eq(schema.subscriptions.id, subId))
  }

  return { success: true }
}

export async function handleDeleteSubscription(
  db: DB,
  userId: number,
  subId: number
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  if (!sub) return { success: false, error: 'Subscription not found' }
  if (sub.ownerId !== userId)
    return {
      success: false,
      error: 'Only the owner can delete this subscription',
    }

  // Check for unpaid bills
  const unpaid = await db
    .select({ id: schema.billingRecords.id })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, subId),
        eq(schema.billingRecords.isPaid, false)
      )
    )
    .limit(1)

  if (unpaid.length > 0) {
    // Soft delete
    await db
      .update(schema.subscriptions)
      .set({ inactive: true })
      .where(eq(schema.subscriptions.id, subId))
  } else {
    // Hard delete
    await db
      .delete(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subId))
  }

  return { success: true }
}

export async function handleMarkPaid(
  db: DB,
  userId: number,
  billId: number
): Promise<Result> {
  const [bill] = await db
    .select()
    .from(schema.billingRecords)
    .where(eq(schema.billingRecords.id, billId))

  if (!bill) return { success: false, error: 'Bill not found' }
  if (bill.userId !== userId)
    return { success: false, error: 'This bill does not belong to you' }

  await markBillPaid(db, billId)
  return { success: true }
}

export async function handleGetDashboard(
  db: DB,
  userId: number
): Promise<{
  monthlyTotal: number
  pendingBills: Array<{
    id: number
    subscriptionName: string
    amount: number
    currency: string
  }>
  subscriptions: Array<{
    name: string
    price: number
    currency: string
    memberCount: number
  }>
}> {
  const spendingData = await getMonthlySpendingData(db, userId)

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))

  const preferredCurrency = user?.preferredCurrency ?? 'CNY'

  // Fetch real FX rates for cross-currency subscriptions
  const rates: Record<string, number> = {}
  const foreignCurrencies = new Set(
    spendingData
      .filter((s) => s.currency !== preferredCurrency)
      .map((s) => s.currency)
  )

  await Promise.all(
    [...foreignCurrencies].map(async (cur) => {
      const rate = await getRate(cur, preferredCurrency)
      if (rate !== null) rates[`${cur}_${preferredCurrency}`] = rate
    })
  )

  const monthlyTotal = calculateMonthlySpending(
    spendingData,
    preferredCurrency,
    rates
  )

  const pendingBills = (await getPendingBills(db, userId)).map((b) => ({
    id: b.id,
    subscriptionName: b.subscriptionName,
    amount: b.amount,
    currency: b.currency,
  }))

  return {
    monthlyTotal,
    pendingBills,
    subscriptions: spendingData,
  }
}

// --- Circles (member preset templates; UI label: "Group") ---

export function handleListCircles(
  db: DB,
  userId: number
): Result<CircleSummary[]> {
  return { success: true, data: listCirclesForOwner(db, userId) }
}

export function handleCreateCircle(
  db: DB,
  userId: number,
  input: {
    name: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): Result<{ id: number }> {
  try {
    const result = createCircle(db, {
      ownerUserId: userId,
      name: input.name,
      memberIds: input.memberIds,
      defaultPayerId: input.defaultPayerId,
    })
    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create circle',
    }
  }
}

export function handleGetCircle(
  db: DB,
  userId: number,
  circleId: number
): Result<CircleSummary> {
  const circle = getCircle(db, circleId, userId)
  if (!circle) return { success: false, error: 'Not found' }
  return { success: true, data: circle }
}

export function handleUpdateCircle(
  db: DB,
  userId: number,
  circleId: number,
  patch: {
    name?: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): Result {
  try {
    const ok = updateCircle(db, circleId, userId, patch)
    if (!ok) return { success: false, error: 'Not found' }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update circle',
    }
  }
}

export function handleDeleteCircle(
  db: DB,
  userId: number,
  circleId: number
): Result {
  const ok = deleteCircle(db, circleId, userId)
  if (!ok) return { success: false, error: 'Not found' }
  return { success: true }
}
