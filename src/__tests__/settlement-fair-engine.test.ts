import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { setupTestDb, createUser, addSubMember, type TestDb, type SqliteShim } from './helpers'
import { getSettlementSummary, markPairSettled } from '@/lib/settlement'

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const env = await setupTestDb()
  db = env.db
  sqlite = env.sqlite
})

async function makeSub(opts: {
  payerId: number
  price: number
  currency?: string
  startDate: string
}): Promise<number> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      name: 'Test Sub',
      price: opts.price,
      currency: opts.currency ?? 'USD',
      nextPayment: opts.startDate,
      startDate: opts.startDate,
      ownerId: opts.payerId,
      payerId: opts.payerId,
    })
    .returning({ id: schema.subscriptions.id })
  return row.id
}

async function insertBill(opts: {
  subscriptionId: number
  userId: number
  amount: number
  currency?: string
  billingDate: string
  isPaid?: boolean
  paidAt?: string | null
  adjustmentForBillId?: number | null
}): Promise<number> {
  const cur = opts.currency ?? 'USD'
  const [row] = await db
    .insert(schema.billingRecords)
    .values({
      subscriptionId: opts.subscriptionId,
      userId: opts.userId,
      amount: opts.amount,
      currency: cur,
      localAmount: opts.amount,
      localCurrency: cur,
      exchangeRate: 1_000_000,
      billingDate: opts.billingDate,
      isPaid: opts.isPaid ?? false,
      paidAt: opts.paidAt ?? null,
      adjustmentForBillId: opts.adjustmentForBillId ?? null,
    })
    .returning({ id: schema.billingRecords.id })
  return row.id
}

// ────────────────────────────────────────────────────────────────────
// A. Bucket aggregation handles signed amounts
// ────────────────────────────────────────────────────────────────────

describe('settlement with signed adjustments — bucket aggregation', () => {
  it('positive bill + positive adjustment → bucket owedByMe = sum', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const billId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 1500,
      billingDate: '2026-05-15',
      adjustmentForBillId: billId,
    })

    const rows = await getSettlementSummary(db, m2)
    expect(rows).toHaveLength(1)
    expect(rows[0].owedByMe).toBe(11500)
    expect(rows[0].counterpartyUserId).toBe(payer)
  })

  it('positive bill + negative adjustment (refund) → bucket owedByMe nets down', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const billId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: -2000, // refund
      billingDate: '2026-05-15',
      adjustmentForBillId: billId,
    })

    const rows = await getSettlementSummary(db, m2)
    expect(rows[0].owedByMe).toBe(8000)
  })

  it('payers view: positive bill + negative adjustment → owedToMe nets down', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const billId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: -2000,
      billingDate: '2026-05-15',
      adjustmentForBillId: billId,
    })

    const rows = await getSettlementSummary(db, payer)
    expect(rows).toHaveLength(1)
    expect(rows[0].owedToMe).toBe(8000)
    expect(rows[0].counterpartyUserId).toBe(m2)
  })

  it('only-negative-adjustment (counterparty owes me) → bucket has negative owedByMe', async () => {
    // Edge: a refund-only situation. m2 has a -$5 adjustment. payer must pay m2.
    // From m2's perspective: bucket.owedByMe = -500 (counterparty payer owes them).
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const paidBill = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: -500,
      billingDate: '2026-05-15',
      adjustmentForBillId: paidBill,
    })

    const rows = await getSettlementSummary(db, m2)
    expect(rows[0].owedByMe).toBe(-500)
    expect(rows[0].net).toBe(500) // I'm net owed $5
  })
})

// ────────────────────────────────────────────────────────────────────
// B. Payer auto-paid bills excluded from unpaid bucket
// ────────────────────────────────────────────────────────────────────

describe('settlement — payer self-bills excluded', () => {
  it('payer auto-paid row (is_paid=true, user=payer) does not appear in any bucket', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // Payer's own fair-share bill, auto-paid.
    await insertBill({
      subscriptionId: subId,
      userId: payer,
      amount: 10000,
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-01',
    })
    // m2's unpaid bill.
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
    })

    // From payer's view: only the m2 unpaid bill in the bucket; total owedToMe = 10000.
    const payerRows = await getSettlementSummary(db, payer)
    expect(payerRows).toHaveLength(1)
    expect(payerRows[0].owedToMe).toBe(10000)
    // Payer's own auto-paid row not double-counted.
    expect(payerRows[0].billIds).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────
// C. markPairSettled clears bills + adjustments together
// ────────────────────────────────────────────────────────────────────

describe('settlement — markPairSettled with adjustments', () => {
  it('settles regular bills AND adjustment rows in one call', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const billId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
    })
    const adjId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 1500,
      billingDate: '2026-05-15',
      adjustmentForBillId: billId,
    })

    const settledCount = await markPairSettled(db, {
      userA: m2,
      userB: payer,
      currency: 'USD',
    })
    expect(settledCount).toBe(2)

    const billRows = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
    expect(billRows.every((r) => r.isPaid)).toBe(true)
    void adjId
  })

  it('settles negative adjustments (refund clears the row too)', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const paidBill = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })
    const refundId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: -1500,
      billingDate: '2026-05-15',
      adjustmentForBillId: paidBill,
    })

    const settledCount = await markPairSettled(db, {
      userA: m2,
      userB: payer,
      currency: 'USD',
    })
    expect(settledCount).toBe(1) // only the refund (orig was already paid)

    const refundRow = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, refundId))
      .then((r) => r[0])
    expect(refundRow.isPaid).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────
// D. Currency separation
// ────────────────────────────────────────────────────────────────────

describe('settlement — currency separation', () => {
  it('two subs different currencies → two separate buckets', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subUsd = await makeSub({
      payerId: payer,
      price: 20000,
      currency: 'USD',
      startDate: '2026-05-01',
    })
    const subCny = await makeSub({
      payerId: payer,
      price: 30000,
      currency: 'CNY',
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subUsd, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subUsd, m2, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subCny, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subCny, m2, { addedAt: '2026-05-01' })
    await insertBill({
      subscriptionId: subUsd,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })
    await insertBill({
      subscriptionId: subCny,
      userId: m2,
      amount: 15000,
      currency: 'CNY',
      billingDate: '2026-05-01',
    })

    const rows = await getSettlementSummary(db, m2)
    expect(rows).toHaveLength(2)
    const usdRow = rows.find((r) => r.currency === 'USD')!
    const cnyRow = rows.find((r) => r.currency === 'CNY')!
    expect(usdRow.owedByMe).toBe(10000)
    expect(cnyRow.owedByMe).toBe(15000)
  })

  it('markPairSettled with currency=USD only settles USD rows, not CNY', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subUsd = await makeSub({
      payerId: payer,
      price: 20000,
      currency: 'USD',
      startDate: '2026-05-01',
    })
    const subCny = await makeSub({
      payerId: payer,
      price: 30000,
      currency: 'CNY',
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subUsd, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subUsd, m2, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subCny, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subCny, m2, { addedAt: '2026-05-01' })
    const usdBill = await insertBill({
      subscriptionId: subUsd,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })
    const cnyBill = await insertBill({
      subscriptionId: subCny,
      userId: m2,
      amount: 15000,
      currency: 'CNY',
      billingDate: '2026-05-01',
    })

    await markPairSettled(db, { userA: m2, userB: payer, currency: 'USD' })

    const usdRow = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, usdBill))
      .then((r) => r[0])
    const cnyRow = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, cnyBill))
      .then((r) => r[0])

    expect(usdRow.isPaid).toBe(true)
    expect(cnyRow.isPaid).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────
// E. Bills array ordering (chronological with adjustments)
// ────────────────────────────────────────────────────────────────────

describe('settlement — bill ordering with adjustments', () => {
  it('bucket.bills sorted by billingDate ASC, including adjustments', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const orig = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      billingDate: '2026-05-01',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 1000,
      billingDate: '2026-05-15',
      adjustmentForBillId: orig,
    })

    const rows = await getSettlementSummary(db, m2)
    const dates = rows[0].bills.map((b) => b.billingDate)
    expect(dates).toEqual(['2026-05-01', '2026-05-15'])
  })
})
