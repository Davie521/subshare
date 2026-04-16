import { and, eq, or } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { getRate } from './fx-cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export interface SettlementBill {
  id: number
  subscriptionId: number
  subscriptionName: string
  billingDate: string
  amount: number
  /** 'outgoing' = I owe counterparty; 'incoming' = counterparty owes me. */
  direction: 'outgoing' | 'incoming'
}

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
  /** Per-bill detail, sorted by billingDate ASC (oldest first). */
  bills: SettlementBill[]
}

interface BillRow {
  id: number
  subscriptionId: number
  subscriptionName: string
  billingDate: string
  userId: number
  amount: number
  currency: string
  localAmount: number
  localCurrency: string
  payerId: number
  isPaid: boolean
}

async function fetchBills(db: DB, viewerId: number, paid: boolean): Promise<BillRow[]> {
  const baseSelect = {
    id: schema.billingRecords.id,
    subscriptionId: schema.billingRecords.subscriptionId,
    subscriptionName: schema.subscriptions.name,
    billingDate: schema.billingRecords.billingDate,
    userId: schema.billingRecords.userId,
    amount: schema.billingRecords.amount,
    currency: schema.billingRecords.currency,
    localAmount: schema.billingRecords.localAmount,
    localCurrency: schema.billingRecords.localCurrency,
    payerId: schema.subscriptions.payerId,
    isPaid: schema.billingRecords.isPaid,
  }

  // Outgoing: bills I owe (user_id = viewerId).
  const outgoing = await db
    .select(baseSelect)
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
    .select(baseSelect)
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
    bills: SettlementBill[]
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
        bills: [],
      }
      buckets.set(key, bucket)
    }
    if (iOwe) bucket.owedByMe += b.amount
    else bucket.owedToMe += b.amount
    bucket.billIds.push(b.id)
    bucket.bills.push({
      id: b.id,
      subscriptionId: b.subscriptionId,
      subscriptionName: b.subscriptionName,
      billingDate: b.billingDate,
      amount: b.amount,
      direction: iOwe ? 'outgoing' : 'incoming',
    })
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    bills: b.bills.slice().sort((x, y) => x.billingDate.localeCompare(y.billingDate)),
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
 * T16 — mark all unpaid bills between userA and userB in `currency` paid.
 * If `currency` is omitted, settles **every** unpaid bill between the pair
 * regardless of currency (used by the netted single-currency settlement
 * flow). Direction-agnostic, idempotent. Other parties are untouched.
 */
export async function markPairSettled(
  db: DB,
  input: { userA: number; userB: number; currency?: string }
): Promise<number> {
  const { userA, userB, currency } = input
  if (userA === userB) return 0

  const paidAt = new Date().toISOString()
  const conditions = [
    eq(schema.billingRecords.subscriptionId, schema.subscriptions.id),
    eq(schema.billingRecords.isPaid, false),
    or(
      and(
        eq(schema.billingRecords.userId, userA),
        eq(schema.subscriptions.payerId, userB)
      ),
      and(
        eq(schema.billingRecords.userId, userB),
        eq(schema.subscriptions.payerId, userA)
      )
    ),
  ]
  if (currency) {
    conditions.push(eq(schema.billingRecords.currency, currency))
  }

  const updated = await db
    .update(schema.billingRecords)
    .set({ isPaid: true, paidAt })
    .from(schema.subscriptions)
    .where(and(...conditions))
    .returning({ id: schema.billingRecords.id })

  return updated.length
}

/* ---------------- Normalized (single-currency) aggregation ---------------- */

export interface NormalizedSettlementBill {
  id: number
  subscriptionId: number
  subscriptionName: string
  billingDate: string
  /** Bill amount converted into `displayCurrency` (cents). */
  convertedAmount: number
  direction: 'outgoing' | 'incoming'
}

export interface NormalizedSettlementRow {
  counterpartyUserId: number
  displayCurrency: string
  /** owedToMe − owedByMe, all in displayCurrency. Negative = I owe. */
  netAmount: number
  /** Total bills in this bucket (both directions). */
  billCount: number
  /** Per-bill detail with converted amounts, sorted oldest first. */
  bills: NormalizedSettlementBill[]
}

/**
 * Build a `counterpartyUserId → currency` map from friendship rows for one
 * viewer. The friendship row stores `agreedCurrencyA` (set by userA) and
 * `agreedCurrencyB` (set by userB); we read the side that matches viewer.
 */
export async function getAgreedCurrencyMap(
  db: DB,
  viewerId: number
): Promise<Map<number, string>> {
  const rows = await db
    .select({
      userAId: schema.friendships.userAId,
      userBId: schema.friendships.userBId,
      agreedCurrencyA: schema.friendships.agreedCurrencyA,
      agreedCurrencyB: schema.friendships.agreedCurrencyB,
    })
    .from(schema.friendships)
    .where(
      or(
        eq(schema.friendships.userAId, viewerId),
        eq(schema.friendships.userBId, viewerId)
      )
    )

  const map = new Map<number, string>()
  for (const r of rows) {
    const isViewerA = r.userAId === viewerId
    const counterparty = isViewerA ? r.userBId : r.userAId
    const agreed = isViewerA ? r.agreedCurrencyA : r.agreedCurrencyB
    if (agreed) map.set(counterparty, agreed)
  }
  return map
}

/**
 * Convert one bill amount to `displayCurrency` (cents).
 *  - Hot path: bill.localCurrency === displayCurrency → use stored localAmount
 *  - Cold path: live FX from bill.currency → displayCurrency
 *  - Fallback (FX unavailable): treat as zero so we never silently inflate.
 */
async function convertBillToDisplay(
  bill: BillRow,
  displayCurrency: string
): Promise<number> {
  if (bill.localCurrency === displayCurrency) return bill.localAmount
  if (bill.currency === displayCurrency) return bill.amount
  const rate = await getRate(bill.currency, displayCurrency)
  if (rate === null) return 0
  return Math.round(bill.amount * rate)
}

/**
 * One row per counterparty. All bills converted to the viewer's chosen
 * display currency for that counterparty (per-friend agreed currency if
 * set, else viewer's preferredCurrency) and netted into a single number.
 *
 * @param resolveDisplayCurrency  Function mapping counterpartyUserId →
 *   currency code. Defaults to a constant fallback. Caller is responsible
 *   for looking up per-friend agreed currencies.
 */
export async function getNormalizedSettlement(
  db: DB,
  viewerId: number,
  fallbackCurrency: string,
  resolveDisplayCurrency?: (counterpartyUserId: number) => string
): Promise<NormalizedSettlementRow[]> {
  const bills = await fetchBills(db, viewerId, false)
  const resolve =
    resolveDisplayCurrency ?? (() => fallbackCurrency)

  type Bucket = {
    counterpartyUserId: number
    displayCurrency: string
    netAmount: number
    bills: NormalizedSettlementBill[]
  }
  const buckets = new Map<number, Bucket>()

  for (const b of bills) {
    const iOwe = b.userId === viewerId
    const counterparty = iOwe ? b.payerId : b.userId
    if (counterparty === viewerId) continue

    const displayCurrency = resolve(counterparty) || fallbackCurrency
    const converted = await convertBillToDisplay(b, displayCurrency)
    let bucket = buckets.get(counterparty)
    if (!bucket) {
      bucket = {
        counterpartyUserId: counterparty,
        displayCurrency,
        netAmount: 0,
        bills: [],
      }
      buckets.set(counterparty, bucket)
    }
    bucket.netAmount += iOwe ? -converted : converted
    bucket.bills.push({
      id: b.id,
      subscriptionId: b.subscriptionId,
      subscriptionName: b.subscriptionName,
      billingDate: b.billingDate,
      convertedAmount: converted,
      direction: iOwe ? 'outgoing' : 'incoming',
    })
  }

  return [...buckets.values()].map((b) => ({
    counterpartyUserId: b.counterpartyUserId,
    displayCurrency: b.displayCurrency,
    netAmount: b.netAmount,
    billCount: b.bills.length,
    bills: b.bills
      .slice()
      .sort((x, y) => x.billingDate.localeCompare(y.billingDate)),
  }))
}
