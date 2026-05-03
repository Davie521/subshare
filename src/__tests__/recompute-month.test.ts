import { describe, it, expect, beforeEach } from 'vitest'
import { eq, and, isNotNull, isNull } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { setupTestDb, createUser, addSubMember, type TestDb, type SqliteShim } from './helpers'
import { recomputeMonth } from '@/lib/engine/recompute'

// ────────────────────────────────────────────────────────────────────
// Test scaffolding
// ────────────────────────────────────────────────────────────────────

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const env = await setupTestDb()
  db = env.db
  sqlite = env.sqlite
})

/**
 * Insert a subscription row. Caller is responsible for inserting members
 * separately via addSubMember (which doesn't run R2 logic).
 */
async function makeSub(opts: {
  payerId: number
  ownerId?: number
  price: number
  currency?: string
  startDate: string
  nextPayment?: string
  name?: string
}): Promise<number> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      name: opts.name ?? 'Test Sub',
      price: opts.price,
      currency: opts.currency ?? 'USD',
      nextPayment: opts.nextPayment ?? opts.startDate,
      startDate: opts.startDate,
      ownerId: opts.ownerId ?? opts.payerId,
      payerId: opts.payerId,
    })
    .returning({ id: schema.subscriptions.id })
  return row.id
}

/** Insert a billing_records row directly (for setting up pre-existing state). */
async function insertBill(opts: {
  subscriptionId: number
  userId: number
  amount: number
  currency: string
  localAmount?: number
  localCurrency?: string
  exchangeRate?: number
  billingDate: string
  isPaid?: boolean
  paidAt?: string | null
  adjustmentForBillId?: number | null
  eventId?: string | null
}): Promise<number> {
  const [row] = await db
    .insert(schema.billingRecords)
    .values({
      subscriptionId: opts.subscriptionId,
      userId: opts.userId,
      amount: opts.amount,
      currency: opts.currency,
      localAmount: opts.localAmount ?? opts.amount,
      localCurrency: opts.localCurrency ?? opts.currency,
      exchangeRate: opts.exchangeRate ?? 1_000_000,
      billingDate: opts.billingDate,
      isPaid: opts.isPaid ?? false,
      paidAt: opts.paidAt ?? null,
      adjustmentForBillId: opts.adjustmentForBillId ?? null,
      eventId: opts.eventId ?? null,
    })
    .returning({ id: schema.billingRecords.id })
  return row.id
}

/** Convenience: fetch all bills for (sub, month) including adjustments. */
async function getBillsForMonth(
  subId: number,
  yearMonth: string // YYYY-MM
): Promise<Array<typeof schema.billingRecords.$inferSelect>> {
  const all = await db
    .select()
    .from(schema.billingRecords)
    .where(eq(schema.billingRecords.subscriptionId, subId))
  return all.filter((b) => b.billingDate.startsWith(yearMonth))
}

/** Convenience: fetch only the regular (non-adjustment) bills. */
async function getRegularBills(subId: number, yearMonth: string) {
  const all = await getBillsForMonth(subId, yearMonth)
  return all.filter((b) => b.adjustmentForBillId === null)
}

/** Convenience: fetch only adjustment rows. */
async function getAdjustments(subId: number, yearMonth: string) {
  const all = await getBillsForMonth(subId, yearMonth)
  return all.filter((b) => b.adjustmentForBillId !== null)
}

// ────────────────────────────────────────────────────────────────────
// A. Fresh-month scenarios — no existing bills
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — fresh month, no existing bills', () => {
  it('payer-only sub: inserts auto-paid row for payer, no others', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      currency: 'USD',
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })

    const result = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:2026-05',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    expect(bills).toHaveLength(1)
    expect(bills[0].userId).toBe(payer)
    expect(bills[0].amount).toBe(20000)
    expect(bills[0].isPaid).toBe(true)
    expect(bills[0].paidAt).toBe('2026-05-01')
    expect(result.insertedBillIds).toHaveLength(1)
  })

  it('2 members full month: payer auto-paid, non-payer unpaid, both at half', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:2026-05',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    expect(bills).toHaveLength(2)
    const payerBill = bills.find((b) => b.userId === payer)!
    const m2Bill = bills.find((b) => b.userId === m2)!
    expect(payerBill.amount).toBe(10000)
    expect(payerBill.isPaid).toBe(true)
    expect(m2Bill.amount).toBe(10000)
    expect(m2Bill.isPaid).toBe(false)
  })

  it('3 members full month, non-divisible: rounding distributed, sum = price', async () => {
    const u1 = await createUser(db, { email: 'u1@test.com', currency: 'USD' })
    const u2 = await createUser(db, { email: 'u2@test.com', currency: 'USD' })
    const u3 = await createUser(db, { email: 'u3@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: u1,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, u1, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, u2, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, u3, { addedAt: '2026-05-01' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:2026-05',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const totalAmount = bills.reduce((s, b) => s + b.amount, 0)
    expect(totalAmount).toBe(20000)
    expect(bills).toHaveLength(3)
  })

  it('mid-cycle joiner: gets prorated bill for active days only', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const joiner = await createUser(db, { email: 'j@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 6200,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, joiner, { addedAt: '2026-05-15' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:2026-05',
      today: '2026-05-15',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const joinerBill = bills.find((b) => b.userId === joiner)!
    // Days 1-14 N=1 (payer alone) = 14 days. Days 15-31 N=2 = 17 days.
    // dailyCost = 6200/31 = 200. joiner active 17 days, share = 17 × 100 = 1700.
    expect(joinerBill.amount).toBe(1700)
    expect(joinerBill.isPaid).toBe(false)
  })

  it('mid-cycle leaver: prorated to active days only', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const leaver = await createUser(db, { email: 'l@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 6200,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-05-01',
      leftAt: '2026-05-15',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:2026-05',
      today: '2026-05-15',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const leaverBill = bills.find((b) => b.userId === leaver)!
    // Closed [5/1, 5/15] = 15 days × 100 = 1500.
    expect(leaverBill.amount).toBe(1500)
  })
})

// ────────────────────────────────────────────────────────────────────
// B. Existing unpaid bills — rewrite in place
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — existing unpaid bills', () => {
  it('unpaid bill matches new fair → no DB change, no notification', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // Pre-insert correct bills as if R1 ran.
    await insertBill({
      subscriptionId: subId,
      userId: payer,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-01',
    })
    const m2BillId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })

    const result = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'edit:1',
      today: '2026-05-15',
    })

    const m2Bill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, m2BillId))
      .then((r) => r[0])
    expect(m2Bill.amount).toBe(10000)
    expect(result.updatedBillIds).toHaveLength(0)
    expect(result.notifiedUserIds).toHaveLength(0)
  })

  it('unpaid bill amount differs from fair → UPDATE in place', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // Buggy pre-existing amount.
    const m2BillId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 9000, // wrong — should be 10000
      currency: 'USD',
      billingDate: '2026-05-01',
    })

    const result = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'fix:1',
      today: '2026-05-03',
    })

    const m2Bill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, m2BillId))
      .then((r) => r[0])
    expect(m2Bill.amount).toBe(10000)
    expect(m2Bill.localAmount).toBe(10000)
    expect(result.updatedBillIds).toContain(m2BillId)
  })

  it('user removed mid-month: their unpaid bill amount drops to prorated', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    // Member added then later removed (leftAt set).
    await addSubMember(sqlite, subId, m2, {
      addedAt: '2026-05-01',
      leftAt: '2026-05-15',
    })
    // Bill was for full month $100; user left mid-month so should drop.
    const m2BillId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'remove:1',
      today: '2026-05-15',
    })

    const m2Bill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, m2BillId))
      .then((r) => r[0])
    // Closed [5/1, 5/15] = 15 days × 645.16/2 ≈ 4838 (per-day model)
    // Days 1-15 (15 days) N=2 each 322.58/day ≈ 4838.71. Days 16-31 (16 days) N=1, payer only.
    // m2 fair = 15 × (20000/31/2) = 15 × 322.58 ≈ 4838.71 → floor 4838
    // payer fair = 4838.71 + 16×645.16 = 4838.71 + 10322.58 ≈ 15161.29 → floor 15161
    // sum = 19999, residue 1 → distributed by seed
    expect(m2Bill.amount).toBeGreaterThanOrEqual(4838)
    expect(m2Bill.amount).toBeLessThanOrEqual(4839)
  })
})

// ────────────────────────────────────────────────────────────────────
// C. Existing paid bills — write adjustment row
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — existing paid bills (immutable)', () => {
  it('paid bill < fair → INSERT positive adjustment', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // m2 already paid $80, but new fair is $100 → owes additional $20.
    const m2PaidId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })

    const result = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'fix:underpay',
      today: '2026-05-10',
    })

    const adjustments = await getAdjustments(subId, '2026-05')
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0].userId).toBe(m2)
    expect(adjustments[0].amount).toBe(2000)
    expect(adjustments[0].adjustmentForBillId).toBe(m2PaidId)
    expect(adjustments[0].isPaid).toBe(false)
    expect(result.insertedAdjustmentIds).toHaveLength(1)

    // Original paid bill is untouched (immutable).
    const m2Paid = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, m2PaidId))
      .then((r) => r[0])
    expect(m2Paid.amount).toBe(8000)
    expect(m2Paid.isPaid).toBe(true)
  })

  it('paid bill > fair → INSERT negative (refund) adjustment', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // m2 overpaid $120, new fair is $100 → refund $20.
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 12000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'fix:overpay',
      today: '2026-05-10',
    })

    const adjustments = await getAdjustments(subId, '2026-05')
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0].amount).toBe(-2000) // refund
  })

  it('paid bill = fair → no adjustment created', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'no-op',
      today: '2026-05-10',
    })

    const adjustments = await getAdjustments(subId, '2026-05')
    expect(adjustments).toHaveLength(0)
  })

  it('adjustment row uses parent bills locked exchange_rate', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'CNY' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      currency: 'USD',
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // Parent bill locked at rate 7.0 (CNY per USD), so $80 = ¥560.
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      localAmount: 56000,
      localCurrency: 'CNY',
      exchangeRate: 7_000_000,
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'fx:test',
      today: '2026-05-10',
      // Even though live rate would be different, adjustment must reuse parent's locked.
      rates: { USD_CNY: 7_500_000 },
    })

    const adjustments = await getAdjustments(subId, '2026-05')
    expect(adjustments).toHaveLength(1)
    // delta = 2000 cents USD; localAmount at locked rate 7.0 = 14000 ¥
    expect(adjustments[0].amount).toBe(2000)
    expect(adjustments[0].localAmount).toBe(14000)
    expect(adjustments[0].exchangeRate).toBe(7_000_000)
    expect(adjustments[0].localCurrency).toBe('CNY')
  })
})

// ────────────────────────────────────────────────────────────────────
// D. Existing adjustment rows — fold/update
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — existing adjustment rows', () => {
  it('open adjustment exists, recompute changes need → UPDATE existing', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const parentId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })
    const adjId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 1500, // existing adjustment for +$15
      currency: 'USD',
      billingDate: '2026-05-10',
      isPaid: false,
      adjustmentForBillId: parentId,
      eventId: 'old-event',
    })

    // New recompute says fair = $100, paid = $80 + open adj $15 = $95 → delta $5.
    // Should UPDATE the existing adjustment from $15 → $20.
    const result = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'new-event',
      today: '2026-05-12',
    })

    const adjustments = await getAdjustments(subId, '2026-05')
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0].id).toBe(adjId)
    expect(adjustments[0].amount).toBe(2000)
    expect(result.updatedAdjustmentIds).toContain(adjId)
    expect(result.insertedAdjustmentIds).not.toContain(adjId)
  })

  it('paid adjustment is immutable; new delta creates NEW adjustment row', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    const parentId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })
    const closedAdjId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 1500,
      currency: 'USD',
      billingDate: '2026-05-10',
      isPaid: true, // already settled
      paidAt: '2026-05-11',
      adjustmentForBillId: parentId,
      eventId: 'old-event',
    })

    // Now another event makes the fair $103 → need additional $0.50.
    // The closed adjustment must NOT be touched.
    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'new-event',
      today: '2026-05-15',
    })

    const closedAdj = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, closedAdjId))
      .then((r) => r[0])
    expect(closedAdj.amount).toBe(1500) // untouched
    expect(closedAdj.isPaid).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────
// E. Idempotency on eventId
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — idempotency', () => {
  it('same eventId twice → second call is a no-op (no duplicate inserts)', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'same-event',
      today: '2026-05-01',
    })

    const billsAfterFirst = await getRegularBills(subId, '2026-05')

    const result2 = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'same-event',
      today: '2026-05-01',
    })

    const billsAfterSecond = await getRegularBills(subId, '2026-05')
    expect(billsAfterSecond.length).toBe(billsAfterFirst.length)
    expect(result2.insertedBillIds).toHaveLength(0)
    expect(result2.insertedAdjustmentIds).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────
// F. Payer-specific behavior
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — payer behavior', () => {
  it('payer bill is auto-paid (is_paid=true, paid_at=monthStart)', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const payerBill = bills.find((b) => b.userId === payer)!
    expect(payerBill.isPaid).toBe(true)
    expect(payerBill.paidAt).toBe('2026-05-01')
    expect(payerBill.billingDate).toBe('2026-05-01')
  })

  it('payer bill amount equals their fair share (not 0)', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const payerBill = bills.find((b) => b.userId === payer)!
    expect(payerBill.amount).toBe(10000)
  })

  it('payer fair changing also adjusts payer bill', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    // Use price = 6200 so dailyCost = 200/day for clean per-day arithmetic.
    const subId = await makeSub({
      payerId: payer,
      price: 6200,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-15' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1',
      today: '2026-05-15',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const payerBill = bills.find((b) => b.userId === payer)!
    // activeDays = 31 (every day has ≥1 member). dailyCost = 6200/31 = 200.
    // Days 1-14 N=1 (payer alone): 14 × 200 = 2800.
    // Days 15-31 N=2 (closed [5/15, 5/31] = 17 days): payer 17 × 100 = 1700.
    // payer fair = 4500.
    expect(payerBill.amount).toBe(4500)
  })
})

// ────────────────────────────────────────────────────────────────────
// G. Notifications
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — notifications', () => {
  it('emits bill_adjusted notification per user with non-zero delta', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'fix:1',
      today: '2026-05-10',
    })

    const notifs = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.subscriptionId, subId))
    const m2Notifs = notifs.filter((n) => n.userId === m2)
    expect(m2Notifs.length).toBeGreaterThanOrEqual(1)
    expect(m2Notifs[0].type).toBe('bill_adjusted')
  })

  it('no notification when delta = 0 for everyone', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    await insertBill({
      subscriptionId: subId,
      userId: payer,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-01',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'no-op',
      today: '2026-05-10',
    })

    const notifs = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.subscriptionId, subId))
    expect(notifs).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────
// H. Edge cases
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — edge cases', () => {
  it('no members at all → no DB writes, no error', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    // Note: not adding any members (not even payer).

    const result = await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'empty',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    expect(bills).toHaveLength(0)
    expect(result.insertedBillIds).toHaveLength(0)
  })

  it('member with addedAt > monthEnd is ignored for this month', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const futureUser = await createUser(db, { email: 'f@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    // futureUser only joins in June.
    await addSubMember(sqlite, subId, futureUser, { addedAt: '2026-06-15' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:may',
      today: '2026-05-01',
    })

    const bills = await getRegularBills(subId, '2026-05')
    const futureBill = bills.find((b) => b.userId === futureUser)
    expect(futureBill).toBeUndefined()
  })

  it('subscription not found → throws', async () => {
    await expect(
      recomputeMonth(db, {
        subscriptionId: 9999,
        year: 2026,
        month: 5,
        eventId: 'bad-sub',
        today: '2026-05-01',
      })
    ).rejects.toThrow(/subscription/i)
  })

  it('invalid month range → throws', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })

    await expect(
      recomputeMonth(db, {
        subscriptionId: subId,
        year: 2026,
        month: 13,
        eventId: 'bad-month',
        today: '2026-05-01',
      })
    ).rejects.toThrow(/month/i)
  })
})

// ────────────────────────────────────────────────────────────────────
// I. Sub 24 production canary (per-day model)
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — Sub 24 production canary', () => {
  it('reproduces sub 24 May 2026 fair allocation under per-day model', async () => {
    // Match production: payer + Daviefan added 4/27 (after backdate), Albert added 5/3
    const magicAlpha = await createUser(db, { email: 'magic@test.com', currency: 'USD' })
    const daviefan = await createUser(db, { email: 'daviefan@test.com', currency: 'USD' })
    const albert = await createUser(db, { email: 'albert@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: magicAlpha,
      price: 20000,
      currency: 'USD',
      startDate: '2026-04-27',
    })
    await addSubMember(sqlite, subId, magicAlpha, { addedAt: '2026-04-27' })
    await addSubMember(sqlite, subId, daviefan, { addedAt: '2026-04-27' })
    await addSubMember(sqlite, subId, albert, { addedAt: '2026-05-03' })

    await recomputeMonth(db, {
      subscriptionId: subId,
      year: 2026,
      month: 5,
      eventId: 'r1:2026-05',
      today: '2026-05-03',
    })

    const bills = await getRegularBills(subId, '2026-05')
    expect(bills).toHaveLength(3)
    const total = bills.reduce((s, b) => s + b.amount, 0)
    expect(total).toBe(20000)

    // Per per-day model with deterministic seed (sub.id × month_index):
    // - Magic-Alpha and Daviefan active full 31 days
    // - Albert active 5/3-5/31 (29 days under closed semantic)
    const albertBill = bills.find((b) => b.userId === albert)!
    expect(albertBill.amount).toBeGreaterThanOrEqual(6236)
    expect(albertBill.amount).toBeLessThanOrEqual(6237)
  })
})

// ────────────────────────────────────────────────────────────────────
// J. Index sanity checks
// ────────────────────────────────────────────────────────────────────

describe('recomputeMonth — schema invariant checks', () => {
  it('adjustment row can share billing_date with parent (partial unique allows it)', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    const parentId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 5000,
      currency: 'USD',
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-05',
    })

    // Insert adjustment with same billing_date — should NOT violate unique.
    const adjId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 100,
      currency: 'USD',
      billingDate: '2026-05-01',
      adjustmentForBillId: parentId,
      eventId: 'adj-1',
    })

    expect(adjId).toBeGreaterThan(0)
  })

  it('two regular (non-adjustment) bills with same (sub, user, billing_date) → conflict', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-05-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 5000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })

    // Inserting another non-adjustment row for same (sub, user, billing_date) should fail.
    await expect(
      insertBill({
        subscriptionId: subId,
        userId: m2,
        amount: 6000,
        currency: 'USD',
        billingDate: '2026-05-01',
      })
    ).rejects.toThrow()
  })
})

// Suppress unused-import warnings for utilities meant for future tests.
void and
void isNotNull
void isNull
