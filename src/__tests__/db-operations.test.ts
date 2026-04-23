import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  getSubscriptionsForUser,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
} from '@/lib/db-operations'
import { addMemberToSubscription } from '@/lib/membership'
import { generateMonthlyBills } from '@/lib/cron-billing'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
})

describe('createSubscription', () => {
  it('creates a personal subscription', async () => {
    const userId = await createUser(db)
    const sub = await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    expect(sub.id).toBeDefined()
    expect(sub.name).toBe('Spotify')
  })

  it('auto-adds owner as a subscription member', async () => {
    const userId = await createUser(db)
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const members = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.subscriptionId, sub.id))
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(userId)
  })
})

describe('getSubscriptionsForUser', () => {
  it('returns personal subscriptions', async () => {
    const userId = await createUser(db)
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const subs = await getSubscriptionsForUser(db, userId)
    expect(subs).toHaveLength(1)
    expect(subs[0].name).toBe('Spotify')
    expect(subs[0].memberCount).toBe(1)
  })

  it('returns shared subscriptions the user is a member of', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const netflix = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: netflix.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    const subsA = await getSubscriptionsForUser(db, userA)
    const subsB = await getSubscriptionsForUser(db, userB)

    expect(subsA).toHaveLength(1)
    expect(subsA[0].memberCount).toBe(2)

    expect(subsB).toHaveLength(1)
    expect(subsB[0].memberCount).toBe(2)
  })

  it('does not return other users personal subscriptions', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })

    const subsB = await getSubscriptionsForUser(db, userB)
    expect(subsB).toHaveLength(0)
  })
})

describe('generateMonthlyBills (per-sub scenarios)', () => {
  it('generates billing records for non-payer members', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const userC = await createUser(db, { email: 'c@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userC,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    const count = await generateMonthlyBills(db, '2026-06')
    expect(count).toBeGreaterThanOrEqual(2) // at least B and C for this sub

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(
        and(eq(schema.billingRecords.subscriptionId, sub.id),
            eq(schema.billingRecords.billingDate, '2026-06-01'))
      )

    expect(bills).toHaveLength(2)
    expect(bills.every((b) => b.amount === 6000)).toBe(true) // 18000/3
    expect(bills.find((b) => b.userId === userA)).toBeUndefined()
  })

  it('does not generate duplicate records for same billing date', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    await generateMonthlyBills(db, '2026-06')
    await generateMonthlyBills(db, '2026-06') // second call

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(
        and(eq(schema.billingRecords.subscriptionId, sub.id),
            eq(schema.billingRecords.billingDate, '2026-06-01'))
      )

    expect(bills).toHaveLength(1) // no duplicates at 2026-06-01
  })

  it('P0-2 RED: billingDate is normalized to month-start regardless of nextPayment day', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    // Sub whose nextPayment is mid-month (simulates a sub whose anniversary
    // is not the 1st — e.g. created on the 15th). R1 mandates
    // billing_date = YYYY-MM-01 regardless of the anniversary day.
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-15',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    // Clear R2 bills that addMemberToSubscription may have generated so we
    // assert cleanly on what generateAndSaveBillingRecords produces.
    await db.delete(schema.billingRecords)

    await generateMonthlyBills(db, '2026-06')

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))

    expect(bills).toHaveLength(1)
    // The key R1 invariant: billing_date is always the 1st of the month,
    // not sub.nextPayment.
    expect(bills[0].billingDate).toBe('2026-06-01')
  })

  it('P0-2 RED: does not double-bill when a monthly-pass already wrote YYYY-MM-01 for the month', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-15',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })
    await db.delete(schema.billingRecords)

    // Simulate the monthly cron having already inserted the June R1 bill
    // at 2026-06-01. A later per-sub generateAndSaveBillingRecords must not
    // insert a second bill at a different billing_date.
    await db.insert(schema.billingRecords).values({
      subscriptionId: sub.id,
      userId: userB,
      amount: 9000,
      currency: 'CNY',
      localAmount: 9000,
      localCurrency: 'CNY',
      exchangeRate: 1_000_000,
      billingDate: '2026-06-01',
    })

    await generateMonthlyBills(db, '2026-06')

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))

    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-06-01')
  })
})

describe('getPendingBills', () => {
  it('returns unpaid bills for a user', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    await generateMonthlyBills(db, '2026-06')

    const bills = await getPendingBills(db, userB)
    // userB gets: R2 join bill (2026-05-01, full month) + R1 next-payment bill (2026-06-01).
    // Both are 9000 (18000/2).
    expect(bills.length).toBeGreaterThanOrEqual(1)
    expect(bills.every((b) => b.subscriptionName === 'Netflix')).toBe(true)
    expect(bills.every((b) => b.amount === 9000)).toBe(true)
    expect(bills.every((b) => b.isPaid === false)).toBe(true)
  })

  it('does not return paid bills', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    await generateMonthlyBills(db, '2026-06')

    const allBills = await db.select().from(schema.billingRecords)
    for (const bill of allBills) {
      await markBillPaid(db, bill.id)
    }

    const pending = await getPendingBills(db, userB)
    expect(pending).toHaveLength(0)
  })
})

describe('markBillPaid', () => {
  it('marks a bill as paid with timestamp', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    await generateMonthlyBills(db, '2026-06')

    const bills = await db.select().from(schema.billingRecords)
    await markBillPaid(db, bills[0].id)

    const [updated] = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))

    expect(updated!.isPaid).toBe(true)
    expect(updated!.paidAt).toBeDefined()
  })
})

describe('getMonthlySpendingData', () => {
  it('returns personal and shared subscription data', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    // Personal sub
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })

    // Shared sub
    const netflix = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: netflix.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-05-01',
    })

    const data = await getMonthlySpendingData(db, userA)
    expect(data).toHaveLength(2)

    const spotify = data.find((d) => d.name === 'Spotify')!
    expect(spotify.price).toBe(1500)
    expect(spotify.memberCount).toBe(1)

    const nf = data.find((d) => d.name === 'Netflix')!
    expect(nf.price).toBe(18000)
    expect(nf.memberCount).toBe(2)
  })
})

