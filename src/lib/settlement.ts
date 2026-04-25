import { and, eq, or, inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { getRate } from './fx-cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export interface SettlementBill {
  id: number
  subscriptionId: number
  subscriptionName: string
  subscriptionLogo: string | null
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
  subscriptionLogo: string | null
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
    subscriptionLogo: schema.subscriptions.logo,
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
      subscriptionLogo: b.subscriptionLogo,
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
 * T16 — mark unpaid bills between userA and userB in `currency` paid.
 *
 * Default behavior (no `billIds`): settles **every** unpaid bill in the
 * (A, B, currency) bucket. With `currency` omitted, settles every unpaid
 * bill between the pair regardless of currency.
 *
 * With `billIds` present: scopes the update to that exact set of bill
 * IDs. The (A, B, currency) predicate still gates the update — IDs from
 * other pairs / currencies are silently filtered out, so a caller can't
 * escape pair scope by crafting IDs. An empty array is a true no-op
 * (returns 0 without any UPDATE), never a fall-back to "settle all".
 *
 * Direction-agnostic, idempotent. Other parties are untouched.
 */
export async function markPairSettled(
  db: DB,
  input: {
    userA: number
    userB: number
    currency?: string
    /**
     * Optional bill-ID scope. When set, only these bills are considered
     * for the update (still subject to the pair / currency predicates).
     * `[]` means "settle nothing" — explicit no-op.
     */
    billIds?: number[]
  }
): Promise<number> {
  const { userA, userB, currency, billIds } = input
  if (userA === userB) return 0
  // Empty scope = explicit no-op. Skipping this check would let the
  // inArray() condition below evaluate against an empty list — Drizzle's
  // behavior on empty IN is dialect-dependent, so just short-circuit.
  if (billIds && billIds.length === 0) return 0

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
  if (billIds && billIds.length > 0) {
    conditions.push(inArray(schema.billingRecords.id, billIds))
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
  subscriptionLogo: string | null
  billingDate: string
  /** Bill amount converted into `displayCurrency` (cents). */
  convertedAmount: number
  direction: 'outgoing' | 'incoming'
  /** True when the FX lookup failed — `convertedAmount` is 0 as fallback. */
  fxIncomplete: boolean
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
  /**
   * True when ANY bill in this bucket couldn't be converted to
   * `displayCurrency` — callers should warn before "settle all" and suppress
   * `netAmount` as a trusted total.
   */
  fxIncomplete: boolean
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
 *  - Fallback (FX unavailable): amount=0 with fxAvailable=false so callers
 *    can warn the user before treating the net as trustworthy.
 *
 * Accepts a pre-fetched rate map (see `prefetchRates`) so callers batching
 * over many bills avoid N serial `await getRate` hops.
 */
function convertBillToDisplay(
  bill: BillRow,
  displayCurrency: string,
  rateMap: Map<string, number | null>
): { amount: number; fxAvailable: boolean } {
  if (bill.localCurrency === displayCurrency) {
    return { amount: bill.localAmount, fxAvailable: true }
  }
  if (bill.currency === displayCurrency) {
    return { amount: bill.amount, fxAvailable: true }
  }
  const rate = rateMap.get(`${bill.currency}_${displayCurrency}`) ?? null
  if (rate === null) return { amount: 0, fxAvailable: false }
  // Floor (not round) to match how localAmount is stored at bill
  // generation (`Math.floor(amount * rate)`). Keeps dashboard and
  // settlement totals consistent for the same underlying bill.
  return { amount: Math.floor(bill.amount * rate), fxAvailable: true }
}

/**
 * Pre-fetch every (from, to) FX rate a caller will need in one
 * Promise.all batch. Missing rates land in the map as `null` so the
 * consumer can distinguish "not looked up" (absent key) from "lookup
 * failed" (null).
 */
async function prefetchRates(
  pairs: Iterable<{ from: string; to: string }>
): Promise<Map<string, number | null>> {
  const unique = new Set<string>()
  for (const p of pairs) {
    if (p.from !== p.to) unique.add(`${p.from}_${p.to}`)
  }
  const entries = await Promise.all(
    Array.from(unique).map(async (key) => {
      const [from, to] = key.split('_')
      const rate = await getRate(from, to)
      return [key, rate] as const
    })
  )
  return new Map(entries)
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

  // Batch every FX pair we'll need up front. One Promise.all round-trip
  // beats N serial awaits inside the per-bill loop, even with the cache.
  const pairs = bills
    .map((b) => {
      const iOwe = b.userId === viewerId
      const counterparty = iOwe ? b.payerId : b.userId
      if (counterparty === viewerId) return null
      const displayCurrency = resolve(counterparty) || fallbackCurrency
      if (b.localCurrency === displayCurrency) return null
      if (b.currency === displayCurrency) return null
      return { from: b.currency, to: displayCurrency }
    })
    .filter((p): p is { from: string; to: string } => p !== null)
  const rateMap = await prefetchRates(pairs)

  type Bucket = {
    counterpartyUserId: number
    displayCurrency: string
    netAmount: number
    bills: NormalizedSettlementBill[]
    fxIncomplete: boolean
  }
  const buckets = new Map<number, Bucket>()

  for (const b of bills) {
    const iOwe = b.userId === viewerId
    const counterparty = iOwe ? b.payerId : b.userId
    if (counterparty === viewerId) continue

    const displayCurrency = resolve(counterparty) || fallbackCurrency
    const { amount: converted, fxAvailable } = convertBillToDisplay(
      b,
      displayCurrency,
      rateMap
    )
    let bucket = buckets.get(counterparty)
    if (!bucket) {
      bucket = {
        counterpartyUserId: counterparty,
        displayCurrency,
        netAmount: 0,
        bills: [],
        fxIncomplete: false,
      }
      buckets.set(counterparty, bucket)
    }
    bucket.netAmount += iOwe ? -converted : converted
    if (!fxAvailable) bucket.fxIncomplete = true
    bucket.bills.push({
      id: b.id,
      subscriptionId: b.subscriptionId,
      subscriptionName: b.subscriptionName,
      subscriptionLogo: b.subscriptionLogo,
      billingDate: b.billingDate,
      convertedAmount: converted,
      direction: iOwe ? 'outgoing' : 'incoming',
      fxIncomplete: !fxAvailable,
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
    fxIncomplete: b.fxIncomplete,
  }))
}
