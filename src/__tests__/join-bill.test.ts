import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
} from '@/lib/db-operations'

/**
 * T9 — addMemberToSubscription auto-generates a pro-rated join bill (R2).
 *
 * Formula: amount = floor(share × (daysInMonth − dayOfMonth + 1) / daysInMonth)
 * where share = floor(price / activeMemberCountIncludingNewJoiner)
 *
 * Payable to the payer (already paid the service in full for the month).
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function allBills(): Promise<Array<{
  subscriptionId: number
  userId: number
  amount: number
  currency: string
  billingDate: string
  localAmount: number
  localCurrency: string
}>> {
  return (await sqlite.prepare(
    `SELECT subscription_id as "subscriptionId", user_id as "userId",
            amount, currency, billing_date as "billingDate",
            local_amount as "localAmount", local_currency as "localCurrency"
     FROM billing_records ORDER BY user_id`
  ).all()) as never
}

describe('T9 generateJoinBill on addMember (R2)', () => {
  it('mid-month join → pro-rated bill (share × remaining / D)', async () => {
    // April has 30 days. Add B on day 20 → 11 days covered.
    // price=10800 cents; with A+B: share=5400; 5400*11/30 = 1980
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
    expect(bills[0].userId).toBe(b)
    expect(bills[0].amount).toBe(1980)
    expect(bills[0].currency).toBe('CNY')
    // The billing_date for a mid-cycle join is the join day itself.
    expect(bills[0].billingDate).toBe('2026-04-20')
  })

  it('day 1 join → full share (no pre-existing monthly bill in same cycle)', async () => {
    // B joins on April 1 — R2 covers the whole month.
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
      addedAt: '2026-04-01',
    })

    const bills = await allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].amount).toBe(5400) // floor(10800/2)
  })

  it('last day of month → 1/D of share', async () => {
    // B joins on April 30 (day 30 of 30). 1/30 share.
    // price=10800, share=5400, 5400/30 = 180
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
      addedAt: '2026-04-30',
    })

    expect((await allBills())[0].amount).toBe(180)
  })

  it('share uses member count AFTER insertion', async () => {
    // Start with A+B (owner+member). Add C on April 20 → share becomes
    // floor(price/3). share*11/30.
    // price=9000, A already owns, B added 2026-04-01 (gets 5000 * 1/1 = 5000? no:
    // with A+B alone: share=4500; floor(4500*30/30)=4500).
    // Then C added April 20: now n=3, share=floor(9000/3)=3000.
    // C's pro-rata = floor(3000*11/30) = 1100.
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 9000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const bills = await allBills()
    // Two bills: one for B (full share on April 1), one for C (pro-rata).
    expect(bills).toHaveLength(2)
    const cBill = bills.find((x) => x.userId === c)!
    expect(cBill.amount).toBe(1100)
  })

  it('no bill generated when the joiner is the payer (owner insert)', async () => {
    // createSubscription auto-inserts the owner as the payer-member.
    // That self-insert must NOT create a billing_record.
    const a = await createUser(db)
    await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    expect(await allBills()).toHaveLength(0)
  })

  it('bill is payable to the payer (currency = sub.currency)', async () => {
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
      addedAt: '2026-04-15',
    })

    const bills = await allBills()
    expect(bills[0].currency).toBe('CNY')
    // subscription.payer_id determines who receives the money — via the
    // payer_id column on subscriptions (checked elsewhere). Here we assert
    // the bill references the correct sub.
    expect(bills[0].subscriptionId).toBe(sub.id)
  })

  it('is idempotent — re-adding the same user does not create a second bill', async () => {
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
      addedAt: '2026-04-15',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    expect(await allBills()).toHaveLength(1)
  })
})
