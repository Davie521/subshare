import { eq, and, inArray, or, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
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

type DB = BetterSQLite3Database<typeof schema>
type Result<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string }

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
): Promise<Result<{ id: number; name: string }>> {
  const invitees = (input.members ?? []).filter((id) => id !== userId)
  const payerId = input.payerId ?? userId

  // payer must be the owner or one of the invitees.
  if (payerId !== userId && !invitees.includes(payerId)) {
    return {
      success: false,
      error: 'payerId must be the owner or one of the members',
    }
  }

  const sub = createSubscription(db, {
    ...input,
    ownerId: userId,
    payerId,
  })

  // Seed invitees. Rates are needed for cross-currency R2 bills.
  if (invitees.length > 0) {
    const rates = await fetchRatesForUsers(db, invitees, input.currency)
    const today = new Date().toISOString().slice(0, 10)
    for (const uid of invitees) {
      addMemberToSubscription(
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

  return { success: true, data: sub }
}

async function fetchRatesForUsers(
  db: DB,
  userIds: number[],
  subCurrency: string
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {}
  const rows = db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds))
    .all()
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

export async function handleAddMembers(
  db: DB,
  actorId: number,
  subId: number,
  memberIds: number[]
): Promise<Result<{ added: number }>> {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
    .get()
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
    const before = db
      .select({ userId: schema.subscriptionMembers.userId })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, subId),
          eq(schema.subscriptionMembers.userId, uid)
        )
      )
      .get()
    if (before) continue
    addMemberToSubscription(
      db,
      { subscriptionId: subId, userId: uid, addedBy: actorId, addedAt: today },
      rates
    )
    added++
  }

  return { success: true, data: { added } }
}

export function handleRemoveMember(
  db: DB,
  actorId: number,
  subId: number,
  targetUserId: number
): Result {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
    .get()
  if (!sub) return { success: false, error: 'Subscription not found' }

  const isSelf = actorId === targetUserId
  if (!isSelf && sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or payer can remove another member',
    }
  }

  try {
    leaveSubscription(db, {
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
  const pairs = db
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
    .where(eq(schema.subscriptions.inactive, 0))
    .all()

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

  const generated = generateMonthlyBills(db, yearMonth, rates)
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

export function handleGetSettlement(
  db: DB,
  userId: number,
  opts: { view?: 'unpaid' | 'paid' } = {}
): Result<EnrichedSettlementRow[]> {
  const rows =
    opts.view === 'paid'
      ? getSettledHistory(db, userId)
      : getSettlementSummary(db, userId)
  if (rows.length === 0) return { success: true, data: [] }

  const counterpartyIds = Array.from(
    new Set(rows.map((r) => r.counterpartyUserId))
  )
  const users = db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, counterpartyIds))
    .all()
  const byId = new Map(users.map((u) => [u.id, u]))

  const enriched: EnrichedSettlementRow[] = rows.map((r) => {
    const u = byId.get(r.counterpartyUserId)
    const counterpartyName = u?.displayName?.trim() || u?.name || 'Unknown'
    return { ...r, counterpartyName }
  })
  return { success: true, data: enriched }
}

export function handleMarkPairSettled(
  db: DB,
  userId: number,
  counterpartyUserId: number,
  currency: string
): Result<{ marked: number }> {
  if (userId === counterpartyUserId) {
    return { success: false, error: 'Cannot settle with yourself' }
  }
  if (!CURRENCY_WHITELIST.has(currency)) {
    return { success: false, error: 'Unsupported currency' }
  }
  const marked = markPairSettled(db, {
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

export function handleListFriends(
  db: DB,
  userId: number
): Result<FriendRow[]> {
  const rows = db
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
    .all()

  if (rows.length === 0) return { success: true, data: [] }

  const otherIds = rows.map((r) =>
    r.userAId === userId ? r.userBId : r.userAId
  )
  const users = db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      displayName: schema.users.displayName,
      email: schema.users.email,
      showEmail: schema.users.showEmail,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, otherIds))
    .all()

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
      if (u.showEmail === 1) out.email = u.email
      return out
    })
    .filter((x): x is FriendRow => x !== null)

  return { success: true, data: result }
}

export function handleListNotifications(
  db: DB,
  userId: number,
  limit = 50
): Result<{ items: NotificationRecord[]; unreadCount: number }> {
  const items = listNotifications(db, userId, limit)
  const unreadCount = countUnreadNotifications(db, userId)
  return { success: true, data: { items, unreadCount } }
}

export function handleMarkNotificationRead(
  db: DB,
  userId: number,
  notificationId: number
): Result {
  const row = db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .where(eq(schema.notifications.id, notificationId))
    .get()
  if (!row) return { success: false, error: 'Notification not found' }
  if (row.userId !== userId) {
    return { success: false, error: 'Not your notification' }
  }
  markNotificationRead(db, notificationId)
  return { success: true }
}

export function handleMarkAllNotificationsRead(
  db: DB,
  userId: number
): Result {
  markAllNotificationsRead(db, userId)
  return { success: true }
}

export function handleTransferPayer(
  db: DB,
  actorId: number,
  subId: number,
  newPayerId: number
): Result {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
    .get()
  if (!sub) return { success: false, error: 'Subscription not found' }

  if (sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or current payer can transfer payer',
    }
  }

  try {
    transferPayer(db, { subscriptionId: subId, newPayerId })
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to transfer payer',
    }
  }
  return { success: true }
}

export function handleUpdateSubscription(
  db: DB,
  userId: number,
  subId: number,
  input: {
    name?: string
    price?: number
    nextPayment?: string
    inactive?: number
  }
): Result {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
    .get()

  if (!sub) return { success: false, error: 'Subscription not found' }
  if (sub.ownerId !== userId)
    return { success: false, error: 'Only the owner can update this subscription' }

  // Price changes go through changeSubscriptionPrice so R5 notifications fire.
  if (input.price !== undefined && input.price !== sub.price) {
    changeSubscriptionPrice(db, { subscriptionId: subId, newPrice: input.price })
  }

  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.nextPayment !== undefined) updates.nextPayment = input.nextPayment
  if (input.inactive !== undefined) updates.inactive = input.inactive

  if (Object.keys(updates).length > 0) {
    db.update(schema.subscriptions)
      .set(updates)
      .where(eq(schema.subscriptions.id, subId))
      .run()
  }

  return { success: true }
}

export function handleDeleteSubscription(
  db: DB,
  userId: number,
  subId: number
): Result {
  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
    .get()

  if (!sub) return { success: false, error: 'Subscription not found' }
  if (sub.ownerId !== userId)
    return { success: false, error: 'Only the owner can delete this subscription' }

  // Check for unpaid bills
  const unpaid = db
    .select({ id: schema.billingRecords.id })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, subId),
        eq(schema.billingRecords.isPaid, 0)
      )
    )
    .limit(1)
    .all()

  if (unpaid.length > 0) {
    // Soft delete
    db.update(schema.subscriptions)
      .set({ inactive: 1 })
      .where(eq(schema.subscriptions.id, subId))
      .run()
  } else {
    // Hard delete
    db.delete(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subId))
      .run()
  }

  return { success: true }
}

export function handleMarkPaid(
  db: DB,
  userId: number,
  billId: number
): Result {
  const bill = db
    .select()
    .from(schema.billingRecords)
    .where(eq(schema.billingRecords.id, billId))
    .get()

  if (!bill) return { success: false, error: 'Bill not found' }
  if (bill.userId !== userId)
    return { success: false, error: 'This bill does not belong to you' }

  markBillPaid(db, billId)
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
  const spendingData = getMonthlySpendingData(db, userId)

  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()

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

  const pendingBills = getPendingBills(db, userId).map((b) => ({
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
