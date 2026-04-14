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
 * T18 / M5 — R2 join bills must convert to the invitee's preferred
 * currency when sub.currency differs, using the same rates pathway as
 * the monthly cron.
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

function billFor(userId: number) {
  return sqlite
    .prepare(
      `SELECT amount, currency, local_amount AS localAmount,
              local_currency AS localCurrency, exchange_rate AS exchangeRate
       FROM billing_records WHERE user_id = ?`
    )
    .get(userId) as {
    amount: number
    currency: string
    localAmount: number
    localCurrency: string
    exchangeRate: number
  }
}

describe('T18 R2 join bill FX conversion', () => {
  it('same-currency: localAmount === amount, exchangeRate === 1_000_000', () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
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

    const row = billFor(b)
    expect(row.amount).toBe(5000)
    expect(row.localAmount).toBe(5000)
    expect(row.exchangeRate).toBe(1_000_000)
    expect(row.localCurrency).toBe('CNY')
  })

  it('cross-currency with rates: localAmount = floor(amount * rate)', () => {
    // sub USD, invitee preferred CNY, rate 7.2.
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'USD' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 1500, // $15 USD (cents)
      currency: 'USD',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    addMemberToSubscription(
      db,
      {
        subscriptionId: sub.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-04-01',
      },
      { USD_CNY: 7.2 }
    )

    const row = billFor(b)
    // day 1 of 30 → full share; share = 750; 750 * 7.2 = 5400.
    expect(row.amount).toBe(750)
    expect(row.currency).toBe('USD')
    expect(row.localAmount).toBe(5400)
    expect(row.localCurrency).toBe('CNY')
    expect(row.exchangeRate).toBe(7_200_000)
  })

  it('cross-currency without rates throws', () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'USD' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 1500,
      currency: 'USD',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    expect(() =>
      addMemberToSubscription(db, {
        subscriptionId: sub.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-04-01',
      })
    ).toThrow(/rate|USD_CNY/i)
  })

  it('rejects invalid rate (non-positive, NaN)', () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'USD' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 1500,
      currency: 'USD',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    expect(() =>
      addMemberToSubscription(
        db,
        {
          subscriptionId: sub.id,
          userId: b,
          addedBy: a,
          addedAt: '2026-04-01',
        },
        { USD_CNY: 0 }
      )
    ).toThrow()
    expect(() =>
      addMemberToSubscription(
        db,
        {
          subscriptionId: sub.id,
          userId: b,
          addedBy: a,
          addedAt: '2026-04-01',
        },
        { USD_CNY: NaN }
      )
    ).toThrow()
  })
})
