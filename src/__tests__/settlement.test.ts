import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  generateMonthlyBills,
} from '@/lib/db-operations'
import {
  getSettlementSummary,
  markPairSettled,
} from '@/lib/settlement'

/**
 * T16 — debt netting per (userA, userB, currency) bucket.
 *
 * getSettlementSummary(userId) returns one row per counterparty per currency,
 * with owedByMe / owedToMe / net / billIds.
 *
 * markPairSettled(userA, userB, currency) flips is_paid on every unpaid
 * bill between the pair in that currency. Idempotent.
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T16 getSettlementSummary', () => {
  it('returns empty when no unpaid bills exist', () => {
    const a = createUser(sqlite)
    expect(getSettlementSummary(db, a)).toEqual([])
  })

  it('reports net when only I owe (one direction)', () => {
    // A hosts Netflix, B owes A.
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    generateMonthlyBills(db, '2026-05')

    const summaryB = getSettlementSummary(db, b)
    expect(summaryB).toHaveLength(1)
    expect(summaryB[0].counterpartyUserId).toBe(a)
    expect(summaryB[0].currency).toBe('CNY')
    expect(summaryB[0].owedByMe).toBe(5000)
    expect(summaryB[0].owedToMe).toBe(0)
    expect(summaryB[0].net).toBe(-5000) // negative = I owe
  })

  it('reports nets to zero when both sides equal', () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    // A hosts Netflix → B owes A 5000
    const sub1 = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    // B hosts Spotify → A owes B 5000
    const sub2 = createSubscription(db, {
      name: 'Spotify',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-03-10',
    })
    generateMonthlyBills(db, '2026-05')

    const aSum = getSettlementSummary(db, a)
    expect(aSum).toHaveLength(1)
    expect(aSum[0].net).toBe(0)
  })

  it('nets reciprocal debts in the same currency', () => {
    // B owes A 6000 for Netflix, A owes B 2000 for Spotify → net A owes B -4000 (i.e. B owes A 4000)
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub1 = createSubscription(db, {
      name: 'Netflix',
      price: 12000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    const sub2 = createSubscription(db, {
      name: 'Spotify',
      price: 4000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-03-10',
    })
    generateMonthlyBills(db, '2026-05')

    // B's perspective: owes 6000 (Netflix), is owed 2000 (Spotify) → net -4000
    const bSum = getSettlementSummary(db, b)
    expect(bSum).toHaveLength(1)
    expect(bSum[0].counterpartyUserId).toBe(a)
    expect(bSum[0].owedByMe).toBe(6000)
    expect(bSum[0].owedToMe).toBe(2000)
    expect(bSum[0].net).toBe(-4000)
  })

  it('emits two rows when the pair has debts in different currencies', () => {
    // A hosts Netflix in CNY (B owes CNY); B hosts Spotify in USD (A owes USD)
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'USD' })
    const sub1 = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    const sub2 = createSubscription(db, {
      name: 'Spotify',
      price: 2000,
      currency: 'USD',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-03-10',
    })
    generateMonthlyBills(db, '2026-05', { CNY_USD: 0.14, USD_CNY: 7.2 })

    const bSum = getSettlementSummary(db, b)
    // Two rows: CNY (B owes A) and USD (B collects from A)
    const currencies = bSum.map((r) => r.currency).sort()
    expect(currencies).toEqual(['CNY', 'USD'])
  })
})

describe('T16 markPairSettled', () => {
  function pair() {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub1 = createSubscription(db, {
      name: 'Netflix',
      price: 12000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    const sub2 = createSubscription(db, {
      name: 'Spotify',
      price: 4000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-03-10',
    })
    generateMonthlyBills(db, '2026-05')
    return { a, b }
  }

  it('flips is_paid=1 on all unpaid bills between the pair in the given currency', () => {
    const { a, b } = pair()
    const n = markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })
    expect(n).toBeGreaterThanOrEqual(2)

    const unpaid = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM billing_records WHERE is_paid = 0`)
      .get() as { n: number }
    expect(unpaid.n).toBe(0)
  })

  it('is idempotent — second call marks 0 more rows', () => {
    const { a, b } = pair()
    markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })
    const second = markPairSettled(db, {
      userA: a,
      userB: b,
      currency: 'CNY',
    })
    expect(second).toBe(0)
  })

  it('direction-agnostic: userA/userB order does not matter', () => {
    const { a, b } = pair()
    const n = markPairSettled(db, { userA: b, userB: a, currency: 'CNY' })
    expect(n).toBeGreaterThan(0)
  })

  it('currency scoping — leaves other-currency bills untouched', () => {
    const { a, b } = pair()
    // Add a USD bill between A and B manually.
    sqlite
      .prepare(
        `INSERT INTO billing_records
         (subscription_id, user_id, amount, currency, local_amount, local_currency, exchange_rate, billing_date)
         SELECT id, ?, 500, 'USD', 500, 'USD', 1000000, '2026-05-01'
         FROM subscriptions LIMIT 1`
      )
      .run(b)

    markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })

    const unpaidUsd = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM billing_records WHERE is_paid = 0 AND currency = 'USD'`
      )
      .get() as { n: number }
    expect(unpaidUsd.n).toBe(1) // USD bill remains unpaid
  })

  it('does not touch bills involving a third party', () => {
    const { a, b } = pair()
    const c = createUser(sqlite, { email: 'c@t.com', currency: 'CNY' })
    const sub3 = createSubscription(db, {
      name: 'YT',
      price: 6000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub3.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    generateMonthlyBills(db, '2026-05')

    markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })

    // C's bill to A should remain unpaid.
    const cUnpaid = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM billing_records WHERE is_paid = 0 AND user_id = ?`
      )
      .get(c) as { n: number }
    expect(cUnpaid.n).toBe(1)
  })
})
