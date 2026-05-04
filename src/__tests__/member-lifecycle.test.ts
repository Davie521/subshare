import { describe, it, expect, beforeEach } from 'vitest'
import * as schema from '@/db/schema'
import { setupTestDb, createUser, addSubMember, type TestDb, type SqliteShim } from './helpers'
import { getMembersForDisplay } from '@/lib/engine/lifecycle'

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
}): Promise<number> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      name: 'Test Sub',
      price: opts.price,
      currency: 'USD',
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
  billingDate: string
  isPaid?: boolean
  paidAt?: string | null
  adjustmentForBillId?: number | null
}): Promise<number> {
  const [row] = await db
    .insert(schema.billingRecords)
    .values({
      subscriptionId: opts.subscriptionId,
      userId: opts.userId,
      amount: opts.amount,
      currency: 'USD',
      localAmount: opts.amount,
      localCurrency: 'USD',
      exchangeRate: 1_000_000,
      billingDate: opts.billingDate,
      isPaid: opts.isPaid ?? false,
      paidAt: opts.paidAt ?? null,
      adjustmentForBillId: opts.adjustmentForBillId ?? null,
    })
    .returning({ id: schema.billingRecords.id })
  return row.id
}

describe('getMembersForDisplay — active members', () => {
  it('active member (leftAt = null) shows as active', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const m2Display = list.find((x) => x.userId === m2)!
    expect(m2Display.status).toBe('active')
    expect(m2Display.outstandingAmount).toBeUndefined()
  })

  it('member with leftAt in the future shows as active (still in)', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, {
      addedAt: '2026-05-01',
      leftAt: '2026-06-30', // future
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const m2Display = list.find((x) => x.userId === m2)!
    expect(m2Display.status).toBe('active')
  })
})

describe('getMembersForDisplay — past leavers', () => {
  it('past leaver with no outstanding bills is FILTERED OUT', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const leaver = await createUser(db, { email: 'l@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-04-01',
      leftAt: '2026-04-15',
    })
    // Their bill was fully paid before leaving.
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 5000,
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-10',
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    expect(list.find((x) => x.userId === leaver)).toBeUndefined()
  })

  it('past leaver with unpaid bill shown with left_unsettled and outstanding > 0', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const leaver = await createUser(db, { email: 'l@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-04-01',
      leftAt: '2026-04-15',
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 4000,
      billingDate: '2026-04-01',
      isPaid: false,
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const leaverDisplay = list.find((x) => x.userId === leaver)!
    expect(leaverDisplay.status).toBe('left_unsettled')
    expect(leaverDisplay.outstandingAmount).toBe(4000)
  })

  it('past leaver with unpaid -adjustment (refund owed) shown with negative outstanding', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const leaver = await createUser(db, { email: 'l@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-04-01',
      leftAt: '2026-04-15',
    })
    const paidBill = await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 5000,
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-10',
    })
    // Refund adjustment they're owed.
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: -800,
      billingDate: '2026-04-20',
      isPaid: false,
      adjustmentForBillId: paidBill,
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const leaverDisplay = list.find((x) => x.userId === leaver)!
    expect(leaverDisplay.status).toBe('left_unsettled')
    expect(leaverDisplay.outstandingAmount).toBe(-800)
  })

  it('past leaver with paid bill but unpaid +adjustment shown as left_unsettled', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const leaver = await createUser(db, { email: 'l@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-04-01',
      leftAt: '2026-04-15',
    })
    const paidBill = await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 5000,
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-10',
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 1500,
      billingDate: '2026-04-20',
      isPaid: false,
      adjustmentForBillId: paidBill,
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const leaverDisplay = list.find((x) => x.userId === leaver)!
    expect(leaverDisplay.status).toBe('left_unsettled')
    expect(leaverDisplay.outstandingAmount).toBe(1500)
  })

  it('past leaver whose bills+adjustments net to 0 is filtered out', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const leaver = await createUser(db, { email: 'l@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-04-01',
      leftAt: '2026-04-15',
    })
    // Bill paid, plus open +adj and open -adj that cancel out.
    const paid = await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 5000,
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-10',
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 1000,
      billingDate: '2026-04-20',
      isPaid: false,
      adjustmentForBillId: paid,
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: -1000,
      billingDate: '2026-04-25',
      isPaid: false,
      adjustmentForBillId: paid,
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    expect(list.find((x) => x.userId === leaver)).toBeUndefined()
  })
})

describe('getMembersForDisplay — payer always shown', () => {
  it('payer with no bills (sub just created) still shown as active', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const p = list.find((x) => x.userId === payer)
    expect(p).toBeDefined()
    expect(p!.status).toBe('active')
  })

  it('payer is included even though their auto-paid bills wouldnt count as outstanding', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-05-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-05-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-01' })
    // Payer's auto-paid bill.
    await insertBill({
      subscriptionId: subId,
      userId: payer,
      amount: 10000,
      billingDate: '2026-05-01',
      isPaid: true,
      paidAt: '2026-05-01',
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    expect(list.find((x) => x.userId === payer)).toBeDefined()
  })
})

describe('getMembersForDisplay — ordering and shape', () => {
  it('returns members sorted by addedAt then userId', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const a = await createUser(db, { email: 'a@test.com' })
    const b = await createUser(db, { email: 'b@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, b, { addedAt: '2026-05-10' })
    await addSubMember(sqlite, subId, a, { addedAt: '2026-04-15' })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    expect(list.map((x) => x.userId)).toEqual([payer, a, b])
  })

  it('only counts UNPAID bills in outstandingAmount (paid ones excluded)', async () => {
    const payer = await createUser(db, { email: 'p@test.com' })
    const leaver = await createUser(db, { email: 'l@test.com' })
    const subId = await makeSub({ payerId: payer, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, leaver, {
      addedAt: '2026-04-01',
      leftAt: '2026-04-15',
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 3000,
      billingDate: '2026-04-01',
      isPaid: true,
      paidAt: '2026-04-10',
    })
    await insertBill({
      subscriptionId: subId,
      userId: leaver,
      amount: 2000,
      billingDate: '2026-04-15',
      isPaid: false,
    })

    const list = await getMembersForDisplay(db, { subscriptionId: subId, today: '2026-05-15' })
    const leaverDisplay = list.find((x) => x.userId === leaver)!
    // Only the unpaid 2000 counts; the 3000 paid bill is excluded.
    expect(leaverDisplay.outstandingAmount).toBe(2000)
  })
})
