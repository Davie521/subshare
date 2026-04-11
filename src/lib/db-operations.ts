import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '@/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export function createSubscription(
  db: DB,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    ownerId: number
    groupId?: number
    logo?: string
    url?: string
    notes?: string
    categoryId?: number
  }
): { id: number; name: string; groupId: number | null } {
  throw new Error('Not implemented')
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
  throw new Error('Not implemented')
}

export function getGroupWithMembers(
  db: DB,
  groupId: number
): {
  id: number
  name: string
  publicId: string
  createdBy: number
  members: Array<{ userId: number; name: string; email: string }>
} | null {
  throw new Error('Not implemented')
}

export function generateAndSaveBillingRecords(
  db: DB,
  subscriptionId: number
): number {
  throw new Error('Not implemented')
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
  throw new Error('Not implemented')
}

export function markBillPaid(db: DB, billId: number): void {
  throw new Error('Not implemented')
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
  throw new Error('Not implemented')
}

export function canLeaveGroup(
  db: DB,
  groupId: number,
  userId: number
): boolean {
  throw new Error('Not implemented')
}

export function removeGroupMember(
  db: DB,
  groupId: number,
  userId: number
): void {
  throw new Error('Not implemented')
}
