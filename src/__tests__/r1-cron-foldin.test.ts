import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { setupTestDb, createUser, addSubMember, type TestDb, type SqliteShim } from './helpers'
import { runR1Cron } from '@/lib/engine/cron'

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
  startDate: string
  currency?: string
  inactive?: boolean
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
      inactive: opts.inactive ?? false,
    })
    .returning({ id: schema.subscriptions.id })
  return row.id
}

async function insertBill(opts: {
  subscriptionId: number
  userId: number
  amount: number
  currency: string
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
      localAmount: opts.amount,
      localCurrency: opts.currency,
      exchangeRate: 1_000_000,
      billingDate: opts.billingDate,
      isPaid: opts.isPaid ?? false,
      paidAt: opts.paidAt ?? null,
      adjustmentForBillId: opts.adjustmentForBillId ?? null,
      eventId: opts.eventId ?? null,
    })
    .returning({ id: schema.billingRecords.id })
  return row.id
}

// ────────────────────────────────────────────────────────────────────
// A. Basic cron behavior
// ────────────────────────────────────────────────────────────────────

describe('runR1Cron — basic', () => {
  it('processes a single active sub: inserts new R1 bills for the month', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-04-01',
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    const out = await runR1Cron(db, {
      today: '2026-05-01',
    })

    expect(out.subscriptionsProcessed).toBe(1)
    const mayBills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) => rows.filter((r) => r.billingDate.startsWith('2026-05')))
    expect(mayBills.length).toBeGreaterThanOrEqual(2)
  })

  it('skips inactive subs', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const subId = await makeSub({
      payerId: payer,
      price: 20000,
      startDate: '2026-04-01',
      inactive: true,
    })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })

    const out = await runR1Cron(db, {
      today: '2026-05-01',
    })

    expect(out.subscriptionsProcessed).toBe(0)
    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
    expect(bills).toHaveLength(0)
  })

  it('processes multiple subs in one run', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const subA = await makeSub({ payerId: payer, price: 10000, startDate: '2026-04-01' })
    const subB = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subA, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subB, payer, { addedAt: '2026-04-01' })

    const out = await runR1Cron(db, { today: '2026-05-01' })
    expect(out.subscriptionsProcessed).toBe(2)
  })

  it('subscriptionId arg limits processing to that sub only', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const subA = await makeSub({ payerId: payer, price: 10000, startDate: '2026-04-01' })
    const subB = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subA, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subB, payer, { addedAt: '2026-04-01' })

    const out = await runR1Cron(db, { today: '2026-05-01', subscriptionId: subA })
    expect(out.subscriptionsProcessed).toBe(1)

    const subBBills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subB))
    expect(subBBills).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────
// B. Fold-in: pending adjustments absorbed into new R1 bill
// ────────────────────────────────────────────────────────────────────

describe('runR1Cron — fold-in of pending adjustments', () => {
  it('pending +adjustment from prior month folds into new R1 bill', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    // April: m2 paid $80 but fair was $100. Mid-April recompute wrote +$20 adj.
    const aprilPaidBill = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-05',
    })
    const aprilAdjId = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 2000,
      currency: 'USD',
      billingDate: '2026-04-15',
      isPaid: false,
      adjustmentForBillId: aprilPaidBill,
      eventId: 'fix:april',
    })

    // May 1 R1 fires.
    await runR1Cron(db, { today: '2026-05-01' })

    // m2's May bill should be $100 (fair) + $20 (folded adj) = $120
    const mayBills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) =>
        rows.filter(
          (r) =>
            r.billingDate.startsWith('2026-05') &&
            r.userId === m2 &&
            r.adjustmentForBillId === null
        )
      )
    expect(mayBills).toHaveLength(1)
    expect(mayBills[0].amount).toBe(12000)

    // Folded adjustment is now closed.
    const aprilAdj = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, aprilAdjId))
      .then((r) => r[0])
    expect(aprilAdj.isPaid).toBe(true)
    expect(aprilAdj.paidAt).toBe('2026-05-01')
  })

  it('pending -adjustment (refund) folds: new R1 bill = fair − refund', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    // April: m2 paid $120 but fair was $100. Refund -$20 adj exists.
    const aprilPaidBill = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 12000,
      currency: 'USD',
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-05',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: -2000,
      currency: 'USD',
      billingDate: '2026-04-15',
      isPaid: false,
      adjustmentForBillId: aprilPaidBill,
      eventId: 'refund:april',
    })

    await runR1Cron(db, { today: '2026-05-01' })

    // m2's May bill = $100 (fair) − $20 (refund) = $80
    const mayBill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) =>
        rows.find(
          (r) =>
            r.billingDate.startsWith('2026-05') &&
            r.userId === m2 &&
            r.adjustmentForBillId === null
        )
      )
    expect(mayBill?.amount).toBe(8000)
  })

  it('multiple pending adjustments fold cumulatively', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-03-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-03-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-03-01' })

    const marchPaid = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 9000,
      currency: 'USD',
      billingDate: '2026-03-01',
      isPaid: true,
      paidAt: '2026-03-05',
    })
    const aprilPaid = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 9500,
      currency: 'USD',
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-05',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 1000,
      currency: 'USD',
      billingDate: '2026-04-15',
      adjustmentForBillId: marchPaid,
      eventId: 'fix:march',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 500,
      currency: 'USD',
      billingDate: '2026-04-20',
      adjustmentForBillId: aprilPaid,
      eventId: 'fix:april',
    })

    await runR1Cron(db, { today: '2026-05-01' })

    // m2 May bill = $100 fair + $10 + $5 = $115
    const mayBill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) =>
        rows.find(
          (r) =>
            r.billingDate.startsWith('2026-05') &&
            r.userId === m2 &&
            r.adjustmentForBillId === null
        )
      )
    expect(mayBill?.amount).toBe(11500)
  })

  it('no pending adjustments → R1 bill = fair only', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    await runR1Cron(db, { today: '2026-05-01' })

    const mayBill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) => rows.find((r) => r.userId === m2 && r.adjustmentForBillId === null))
    expect(mayBill?.amount).toBe(10000) // fair only
  })

  it('current-month adjustments are NOT folded (only prior-month)', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    // R1 already ran on May 1, then a mid-May edit created an adjustment.
    const mayBill = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-05-01',
    })
    // Adjustment created mid-May targeting an earlier May settled item.
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 500,
      currency: 'USD',
      billingDate: '2026-05-15', // current month
      adjustmentForBillId: mayBill,
      eventId: 'fix:may',
    })

    // Re-running R1 (e.g., manual rerun) on May 20 should NOT fold the may adj.
    await runR1Cron(db, { today: '2026-05-20' })

    // The may adj should still be unpaid.
    const adjStill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) => rows.find((r) => r.eventId === 'fix:may'))
    expect(adjStill?.isPaid).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────
// C. Idempotency
// ────────────────────────────────────────────────────────────────────

describe('runR1Cron — idempotency', () => {
  it('running R1 twice on the same date is a no-op the second time', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    await runR1Cron(db, { today: '2026-05-01' })
    const billsAfterFirst = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
    const countFirst = billsAfterFirst.length

    const out2 = await runR1Cron(db, { today: '2026-05-01' })
    const billsAfterSecond = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
    expect(billsAfterSecond.length).toBe(countFirst)
    expect(out2.billsInserted).toBe(0)
  })

  it('replaying R1 does not double-fold an already-folded adjustment', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const m2 = await createUser(db, { email: 'm2@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    const aprilPaid = await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 8000,
      currency: 'USD',
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-05',
    })
    await insertBill({
      subscriptionId: subId,
      userId: m2,
      amount: 2000,
      currency: 'USD',
      billingDate: '2026-04-15',
      adjustmentForBillId: aprilPaid,
      eventId: 'fix:april',
    })

    await runR1Cron(db, { today: '2026-05-01' })
    await runR1Cron(db, { today: '2026-05-01' })

    const mayBill = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) =>
        rows.find(
          (r) =>
            r.billingDate.startsWith('2026-05') &&
            r.userId === m2 &&
            r.adjustmentForBillId === null
        )
      )
    expect(mayBill?.amount).toBe(12000) // not 14000 (would be double-fold)
  })
})

// ────────────────────────────────────────────────────────────────────
// D. Edge: orphan adjustments (user no longer active)
// ────────────────────────────────────────────────────────────────────

describe('runR1Cron — orphan adjustments', () => {
  it('left member with pending adjustment still gets a settle row this month', async () => {
    const payer = await createUser(db, { email: 'p@test.com', currency: 'USD' })
    const leaver = await createUser(db, { email: 'l@test.com', currency: 'USD' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-03-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-03-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-03-01',
      leftAt: '2026-04-15',
    })

    // Leaver had paid March, then April retro-adjustment created refund -$5.
    const marchPaid = await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 10000,
      currency: 'USD',
      billingDate: '2026-03-01',
      isPaid: true,
      paidAt: '2026-03-05',
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: -500,
      currency: 'USD',
      billingDate: '2026-04-15',
      adjustmentForBillId: marchPaid,
      eventId: 'refund:leaver',
    })

    await runR1Cron(db, { today: '2026-05-01' })

    // Leaver's May fair = 0 (not active in May). But pending -$5 must still
    // create a settlement row so the refund flows to settlement bucket.
    const mayLeaverRow = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) =>
        rows.find(
          (r) =>
            r.billingDate.startsWith('2026-05') &&
            r.userId === leaver
        )
      )
    expect(mayLeaverRow).toBeDefined()
    expect(mayLeaverRow!.amount).toBe(-500)
    expect(mayLeaverRow!.isPaid).toBe(false)
  })
})
