import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import {
  createSubscription,
  generateAndSaveBillingRecords,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
  canLeaveGroup,
  removeGroupMember,
} from './db-operations'
import { calculateMonthlySpending } from './billing'

type DB = BetterSQLite3Database<typeof schema>
type Result<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string }

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

  db.insert(schema.groupMembers)
    .values({ groupId: group.id, userId })
    .run()

  return { success: true }
}

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

export function handleCreateSubscription(
  db: DB,
  userId: number,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    groupId?: number
    logo?: string
    url?: string
    notes?: string
    categoryId?: number
  }
): Result<{ id: number; name: string; groupId: number | null }> {
  // If groupId provided, verify user is a member
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

  const sub = createSubscription(db, { ...input, ownerId: userId })

  // Generate initial billing records for shared subscriptions
  if (sub.groupId) {
    generateAndSaveBillingRecords(db, sub.id)
  }

  return { success: true, data: sub }
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

  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.price !== undefined) updates.price = input.price
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

  // Fetch all rates in parallel
  await Promise.all(
    [...foreignCurrencies].map(async (cur) => {
      try {
        const res = await fetch(
          `https://api.frankfurter.dev/v1/latest?base=${cur}&symbols=${preferredCurrency}`,
          { signal: AbortSignal.timeout(3000) }
        )
        const data = await res.json()
        const rate = data.rates?.[preferredCurrency]
        if (rate) rates[`${cur}_${preferredCurrency}`] = rate
      } catch {
        // If rate fetch fails, skip — calculateMonthlySpending will use 1 as fallback
      }
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
