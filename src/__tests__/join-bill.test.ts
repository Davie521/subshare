import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
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

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

function allBills(): Array<{
  subscriptionId: number
  userId: number
  amount: number
  currency: string
  billingDate: string
  localAmount: number
  localCurrency: string
}> {
  return sqlite
    .prepare(
      `SELECT subscription_id as subscriptionId, user_id as userId,
              amount, currency, billing_date as billingDate,
              local_amount as localAmount, local_currency as localCurrency
       FROM billing_records ORDER BY user_id`
    )
    .all() as never
}

describe('T9 generateJoinBill on addMember (R2)', () => {
  it('mid-month join → pro-rated bill (share × remaining / D)', () => {
    // April has 30 days. Add B on day 20 → 11 days covered.
    // price=10800 cents; with A+B: share=5400; 5400*11/30 = 1980
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const bills = allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].userId).toBe(b)
    expect(bills[0].amount).toBe(1980)
    expect(bills[0].currency).toBe('CNY')
    // The billing_date for a mid-cycle join is the join day itself.
    expect(bills[0].billingDate).toBe('2026-04-20')
  })

  it('day 1 join → full share (no pre-existing monthly bill in same cycle)', () => {
    // B joins on April 1 — R2 covers the whole month.
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-01',
    })

    const bills = allBills()
    expect(bills).toHaveLength(1)
    expect(bills[0].amount).toBe(5400) // floor(10800/2)
  })

  it('last day of month → 1/D of share', () => {
    // B joins on April 30 (day 30 of 30). 1/30 share.
    // price=10800, share=5400, 5400/30 = 180
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-30',
    })

    expect(allBills()[0].amount).toBe(180)
  })

  it('share uses member count AFTER insertion', () => {
    // Start with A+B (owner+member). Add C on April 20 → share becomes
    // floor(price/3). share*11/30.
    // price=9000, A already owns, B added 2026-04-01 (gets 5000 * 1/1 = 5000? no:
    // with A+B alone: share=4500; floor(4500*30/30)=4500).
    // Then C added April 20: now n=3, share=floor(9000/3)=3000.
    // C's pro-rata = floor(3000*11/30) = 1100.
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 9000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-01',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const bills = allBills()
    // Two bills: one for B (full share on April 1), one for C (pro-rata).
    expect(bills).toHaveLength(2)
    const cBill = bills.find((x) => x.userId === c)!
    expect(cBill.amount).toBe(1100)
  })

  it('no bill generated when the joiner is the payer (owner insert)', () => {
    // createSubscription auto-inserts the owner as the payer-member.
    // That self-insert must NOT create a billing_record.
    const a = createUser(sqlite)
    createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    expect(allBills()).toHaveLength(0)
  })

  it('bill is payable to the payer (currency = sub.currency)', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })

    const bills = allBills()
    expect(bills[0].currency).toBe('CNY')
    // subscription.payer_id determines who receives the money — via the
    // payer_id column on subscriptions (checked elsewhere). Here we assert
    // the bill references the correct sub.
    expect(bills[0].subscriptionId).toBe(sub.id)
  })

  it('audit #6 — inactive sub does not generate a pro-rata join bill', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Old Plex',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2099-06-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    sqlite
      .prepare('UPDATE subscriptions SET inactive = 1 WHERE id = ?')
      .run(sub.id)

    const today = new Date().toISOString().slice(0, 10)
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: today,
    })

    expect(allBills()).toHaveLength(0)
  })

  it('audit #7 — malformed addedAt is rejected', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2099-06-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    expect(() =>
      addMemberToSubscription(db, {
        subscriptionId: sub.id,
        userId: b,
        addedBy: a,
        addedAt: '04/01/2026',
      })
    ).toThrow(/YYYY-MM-DD/)
  })

  it('is idempotent — re-adding the same user does not create a second bill', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    expect(allBills()).toHaveLength(1)
  })
})
