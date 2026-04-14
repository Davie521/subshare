import { describe, it, expect, beforeEach } from 'vitest'
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

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function billFor(userId: number) {
  return await sqlite.prepare(
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
  it('same-currency: localAmount === amount, exchangeRate === 1_000_000', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
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

    const row = await billFor(b)
    expect(row.amount).toBe(5000)
    expect(row.localAmount).toBe(5000)
    expect(row.exchangeRate).toBe(1_000_000)
    expect(row.localCurrency).toBe('CNY')
  })

  it('cross-currency with rates: localAmount = floor(amount * rate)', async () => {
    // sub USD, invitee preferred CNY, rate 7.2.
    const a = await createUser(db, { email: 'a@t.com', currency: 'USD' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1500, // $15 USD (cents)
      currency: 'USD',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: sub.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-04-01',
      },
      { USD_CNY: 7.2 }
    )

    const row = await billFor(b)
    // day 1 of 30 → full share; share = 750; 750 * 7.2 = 5400.
    expect(row.amount).toBe(750)
    expect(row.currency).toBe('USD')
    expect(row.localAmount).toBe(5400)
    expect(row.localCurrency).toBe('CNY')
    expect(row.exchangeRate).toBe(7_200_000)
  })

  it('cross-currency without rates throws', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'USD' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1500,
      currency: 'USD',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    await expect(addMemberToSubscription(db, {
        subscriptionId: sub.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-04-01',
      })
    ).rejects.toThrow(/rate|USD_CNY/i)
  })

  it('rejects invalid rate (non-positive, NaN)', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'USD' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1500,
      currency: 'USD',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    await expect(addMemberToSubscription(
        db,
        {
          subscriptionId: sub.id,
          userId: b,
          addedBy: a,
          addedAt: '2026-04-01',
        },
        { USD_CNY: 0 }
      )
    ).rejects.toThrow()
    await expect(addMemberToSubscription(
        db,
        {
          subscriptionId: sub.id,
          userId: b,
          addedBy: a,
          addedAt: '2026-04-01',
        },
        { USD_CNY: NaN }
      )
    ).rejects.toThrow()
  })
})
