import { and, eq, inArray, or } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface SettlementRow {
  counterpartyUserId: number
  currency: string
  /** Amount I owe to counterparty, in `currency` (cents). */
  owedByMe: number
  /** Amount counterparty owes me, in `currency` (cents). */
  owedToMe: number
  /** owedToMe − owedByMe. Negative = I owe. Positive = I collect. */
  net: number
  /** Bill ids in both directions (for bulk settle). */
  billIds: number[]
}

interface BillRow {
  id: number
  subscriptionId: number
  userId: number
  amount: number
  currency: string
  payerId: number
  isPaid: number
}

function fetchOutstandingBills(db: DB, viewerId: number): BillRow[] {
  // Outgoing: bills I owe (user_id = viewerId).
  const outgoing = db
    .select({
      id: schema.billingRecords.id,
      subscriptionId: schema.billingRecords.subscriptionId,
      userId: schema.billingRecords.userId,
      amount: schema.billingRecords.amount,
      currency: schema.billingRecords.currency,
      payerId: schema.subscriptions.payerId,
      isPaid: schema.billingRecords.isPaid,
    })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.billingRecords.userId, viewerId),
        eq(schema.billingRecords.isPaid, 0)
      )
    )
    .all()

  // Incoming: bills owed TO me (I'm the payer of the sub).
  const incoming = db
    .select({
      id: schema.billingRecords.id,
      subscriptionId: schema.billingRecords.subscriptionId,
      userId: schema.billingRecords.userId,
      amount: schema.billingRecords.amount,
      currency: schema.billingRecords.currency,
      payerId: schema.subscriptions.payerId,
      isPaid: schema.billingRecords.isPaid,
    })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.subscriptions.payerId, viewerId),
        eq(schema.billingRecords.isPaid, 0)
      )
    )
    .all()

  return [...outgoing, ...incoming]
}

/**
 * T16 — netting per (counterparty, currency) bucket.
 * Returns one row per counterparty per currency; may emit multiple rows
 * for the same counterparty if debts span multiple currencies.
 */
export function getSettlementSummary(
  db: DB,
  viewerId: number
): SettlementRow[] {
  const bills = fetchOutstandingBills(db, viewerId)

  // bucket key = counterparty|currency
  type Bucket = {
    counterpartyUserId: number
    currency: string
    owedByMe: number
    owedToMe: number
    billIds: number[]
  }
  const buckets = new Map<string, Bucket>()

  for (const b of bills) {
    const iOwe = b.userId === viewerId
    const counterparty = iOwe ? b.payerId : b.userId
    if (counterparty === viewerId) continue // self — should not happen
    const key = `${counterparty}|${b.currency}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        counterpartyUserId: counterparty,
        currency: b.currency,
        owedByMe: 0,
        owedToMe: 0,
        billIds: [],
      }
      buckets.set(key, bucket)
    }
    if (iOwe) bucket.owedByMe += b.amount
    else bucket.owedToMe += b.amount
    bucket.billIds.push(b.id)
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    net: b.owedToMe - b.owedByMe,
  }))
}

/**
 * T16 — mark all unpaid bills between userA and userB in `currency` paid.
 * Direction-agnostic. Idempotent. Returns number of rows updated.
 * Other currencies and third parties are untouched.
 */
export function markPairSettled(
  db: DB,
  input: { userA: number; userB: number; currency: string }
): number {
  const { userA, userB, currency } = input
  if (userA === userB) return 0

  // Unpaid bills where user_id ∈ {A,B} AND sub.payer_id ∈ {A,B} AND currency = given.
  const rows = db
    .select({
      id: schema.billingRecords.id,
      userId: schema.billingRecords.userId,
      payerId: schema.subscriptions.payerId,
    })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.billingRecords.isPaid, 0),
        eq(schema.billingRecords.currency, currency),
        or(
          eq(schema.billingRecords.userId, userA),
          eq(schema.billingRecords.userId, userB)
        )
      )
    )
    .all()

  const targetIds = rows
    .filter(
      (r) =>
        (r.userId === userA && r.payerId === userB) ||
        (r.userId === userB && r.payerId === userA)
    )
    .map((r) => r.id)

  if (targetIds.length === 0) return 0

  const paidAt = new Date().toISOString()
  db.update(schema.billingRecords)
    .set({ isPaid: 1, paidAt })
    .where(inArray(schema.billingRecords.id, targetIds))
    .run()

  return targetIds.length
}
