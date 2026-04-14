import { and, eq, or } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

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
  isPaid: boolean
}

async function fetchBills(db: DB, viewerId: number, paid: boolean): Promise<BillRow[]> {
  // Outgoing: bills I owe (user_id = viewerId).
  const outgoing = await db
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
        eq(schema.billingRecords.isPaid, paid)
      )
    )
    

  // Incoming: bills owed TO me (I'm the payer of the sub).
  const incoming = await db
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
        eq(schema.billingRecords.isPaid, paid)
      )
    )
    

  return [...outgoing, ...incoming]
}

function bucketByPairCurrency(
  bills: BillRow[],
  viewerId: number
): SettlementRow[] {
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
 * T16 — netting per (counterparty, currency) bucket.
 * Returns one row per counterparty per currency; may emit multiple rows
 * for the same counterparty if debts span multiple currencies.
 */
export async function getSettlementSummary(
  db: DB,
  viewerId: number
): Promise<SettlementRow[]> {
  return bucketByPairCurrency(await fetchBills(db, viewerId, false), viewerId)
}

/**
 * T26 — historical paid view. Same bucketing as getSettlementSummary but
 * over is_paid=1 bills. `owedByMe` / `owedToMe` represent flow (what you
 * paid them vs. what they paid you) rather than current balance.
 */
export async function getSettledHistory(
  db: DB,
  viewerId: number
): Promise<SettlementRow[]> {
  return bucketByPairCurrency(await fetchBills(db, viewerId, true), viewerId)
}

/**
 * T16 — mark all unpaid bills between userA and userB in `currency` paid.
 * Direction-agnostic. Idempotent. Returns number of rows updated.
 * Other currencies and third parties are untouched.
 */
export async function markPairSettled(
  db: DB,
  input: { userA: number; userB: number; currency: string }
): Promise<number> {
  const { userA, userB, currency } = input
  if (userA === userB) return 0

  // Single atomic UPDATE ... FROM ... WHERE — no select/update race window.
  // Matches unpaid bills in the (A → payer=B) or (B → payer=A) direction only.
  const paidAt = new Date().toISOString()
  const updated = await db
    .update(schema.billingRecords)
    .set({ isPaid: true, paidAt })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, schema.subscriptions.id),
        eq(schema.billingRecords.isPaid, false),
        eq(schema.billingRecords.currency, currency),
        or(
          and(
            eq(schema.billingRecords.userId, userA),
            eq(schema.subscriptions.payerId, userB)
          ),
          and(
            eq(schema.billingRecords.userId, userB),
            eq(schema.subscriptions.payerId, userA)
          )
        )
      )
    )
    .returning({ id: schema.billingRecords.id })

  return updated.length
}
