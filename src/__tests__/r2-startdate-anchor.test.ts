import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import { createSubscription } from '@/lib/db-operations'
import { addMemberToSubscription } from '@/lib/membership'

/**
 * R2 anchor: when a member is added BEFORE the subscription's startDate
 * (i.e., the sub hasn't actually started billing yet), their R2 bill must
 * be anchored to startDate, not to addedAt — otherwise the joiner is
 * billed for days the payer's card hasn't been charged for.
 *
 * Effective billing_date = max(addedAt, startDate).
 * Coverage = effective_date → end_of_that_month.
 *
 * When addedAt >= startDate, behavior is unchanged (regression-locked
 * by the existing join-bill.test.ts cases).
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function allBills(): Promise<
  Array<{
    subscriptionId: number
    userId: number
    amount: number
    currency: string
    billingDate: string
  }>
> {
  return (await sqlite
    .prepare(
      `SELECT subscription_id as "subscriptionId", user_id as "userId",
              amount, currency, billing_date as "billingDate"
       FROM billing_records ORDER BY user_id`
    )
    .all()) as never
}

describe('R2 startDate anchor', () => {
  it('addedAt < startDate (same month) → bill anchored to startDate', async () => {
    // April has 30 days. startDate=4/28, addedAt=4/25.
    // Effective billing_date = 4/28. Coverage = 4/28..4/30 = 3 days.
    // price=10000 cents, n=2 → share=5000 → amount=floor(5000*3/30)=500
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Claude Max',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-28',
      startDate: '2026-04-28',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-25',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].userId).toBe(b)
    expect(bills[0].billingDate).toBe('2026-04-28')
    expect(bills[0].amount).toBe(500)
  })

  it('addedAt = startDate → bill at that date (no clamp)', async () => {
    // startDate = addedAt = 4/28. Coverage = 3 days. Same expected result
    // as the previous case — pin both branches of the max() decision.
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Claude Max',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-28',
      startDate: '2026-04-28',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-28',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-04-28')
    expect(bills[0].amount).toBe(500)
  })

  it('addedAt > startDate → existing behavior (anchored to addedAt)', async () => {
    // startDate=4/28, addedAt=4/29 (sub already running).
    // Coverage = 4/29..4/30 = 2 days. amount=floor(5000*2/30)=333.
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Claude Max',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-28',
      startDate: '2026-04-28',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-29',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-04-29')
    expect(bills[0].amount).toBe(333)
  })

  it('cross-month: addedAt in March, startDate in April → bill in April', async () => {
    // startDate=4/2, addedAt=3/30. Effective = 4/2.
    // April: 30 days, day=2, coverage=30-2+1=29.
    // price=9000, n=2 → share=4500 → amount=floor(4500*29/30)=4350.
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Future Sub',
      price: 9000,
      currency: 'CNY',
      nextPayment: '2026-04-02',
      startDate: '2026-04-02',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-30',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-04-02')
    expect(bills[0].amount).toBe(4350)
  })

  it('idempotency keys off effective date, not addedAt', async () => {
    // Adding twice with the same effective date (both clamp to startDate)
    // must still create only one bill, even when raw addedAt differs.
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Claude Max',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-28',
      startDate: '2026-04-28',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-25',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-26',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-04-28')
  })

  it('startDate in the past does not retro-clamp', async () => {
    // startDate=2026-04-01 (already passed), addedAt=2026-04-20.
    // Effective = max = 4/20. Behavior identical to the existing
    // join-bill.test.ts day-20 case — locks in the regression boundary.
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-04-20')
    expect(bills[0].amount).toBe(1980)
  })
})
