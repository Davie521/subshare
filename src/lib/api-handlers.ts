import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '@/db/schema'

type DB = BetterSQLite3Database<typeof schema>
type Result<T = unknown> = { success: true; data?: T } | { success: false; error: string }

export function handleCreateGroup(
  db: DB, userId: number, input: { name: string }
): Result<{ id: number; name: string; publicId: string }> {
  throw new Error('Not implemented')
}

export function handleJoinGroup(
  db: DB, userId: number, publicId: string
): Result {
  throw new Error('Not implemented')
}

export function handleLeaveGroup(
  db: DB, userId: number, groupId: number
): Result {
  throw new Error('Not implemented')
}

export function handleDeleteGroup(
  db: DB, userId: number, groupId: number
): Result {
  throw new Error('Not implemented')
}

export function handleCreateSubscription(
  db: DB, userId: number, input: {
    name: string; price: number; currency: string; nextPayment: string;
    groupId?: number; logo?: string; url?: string; notes?: string; categoryId?: number
  }
): Result<{ id: number; name: string; groupId: number | null }> {
  throw new Error('Not implemented')
}

export function handleUpdateSubscription(
  db: DB, userId: number, subId: number, input: {
    name?: string; price?: number; nextPayment?: string; inactive?: number
  }
): Result {
  throw new Error('Not implemented')
}

export function handleDeleteSubscription(
  db: DB, userId: number, subId: number
): Result {
  throw new Error('Not implemented')
}

export function handleMarkPaid(
  db: DB, userId: number, billId: number
): Result {
  throw new Error('Not implemented')
}

export function handleGetDashboard(
  db: DB, userId: number
): {
  monthlyTotal: number
  pendingBills: Array<{ id: number; subscriptionName: string; amount: number; currency: string }>
  subscriptions: Array<{ name: string; price: number; currency: string; memberCount: number }>
} {
  throw new Error('Not implemented')
}
