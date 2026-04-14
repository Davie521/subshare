import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  generateMonthlyBills,
  changeSubscriptionPrice,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

/**
 * T19 — R5 (NEW): price change rewrites current-month is_paid=0 bills with the
 * new price. Preserves pro-rata ratio for R2 joiners. Keeps exchange_rate
 * locked (no FX re-fetch). Already-paid bills are untouched. Bills outside the
 * current calendar month are untouched.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
  // Fix "today" to a known value inside May 2026 so current-month = 2026-05.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-15T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

async function setup3() {
  const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
  const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
  const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
  const sub = await createSubscription(db, {
    name: 'Netflix',
    price: 15000, // ¥150
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: a,
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: b,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: c,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  return { a, b, c, sub }
}

describe('T12 changeSubscriptionPrice (R5)', () => {
  it('updates subscriptions.price', async () => {
    const { sub } = await setup3()
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 25000 })

    const row = await sqlite.prepare('SELECT price FROM subscriptions WHERE id = ?')
      .get(sub.id) as { price: number }
    expect(row.price).toBe(25000)
  })

  it('does NOT modify bills already generated for the current month', async () => {
    const { sub } = await setup3()
    await generateMonthlyBills(db, '2026-05') // 2 bills at share 5000 (15000/3)

    const before = await sqlite.prepare(
        "SELECT COUNT(*) AS n, SUM(amount) AS total FROM billing_records WHERE billing_date = '2026-05-01'"
      )
      .get() as { n: number; total: number }
    expect(before.n).toBe(2)
    expect(before.total).toBe(10000)

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const after = await sqlite.prepare(
        "SELECT COUNT(*) AS n, SUM(amount) AS total FROM billing_records WHERE billing_date = '2026-05-01'"
      )
      .get() as { n: number; total: number }
    expect(after.n).toBe(2)
    expect(after.total).toBe(20000)
  })

  it('does NOT touch is_paid=1 bills in current month', async () => {
    const { sub } = await setup3()
    await generateMonthlyBills(db, '2026-05')

    // Pay one of the bills.
    await sqlite.prepare(
        "UPDATE billing_records SET is_paid = true, paid_at = '2026-05-05' WHERE id = (SELECT id FROM billing_records WHERE billing_date = '2026-05-01' ORDER BY id LIMIT 1)"
      )
      .run()

    const paidBefore = await sqlite.prepare(
        "SELECT amount FROM billing_records WHERE billing_date = '2026-05-01' AND is_paid = true"
      )
      .get() as { amount: number }
    expect(paidBefore.amount).toBe(5000)

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const paidAfter = await sqlite.prepare(
        "SELECT amount FROM billing_records WHERE billing_date = '2026-05-01' AND is_paid = true"
      )
      .get() as { amount: number }
    const unpaidAfter = await sqlite.prepare(
        "SELECT amount FROM billing_records WHERE billing_date = '2026-05-01' AND is_paid = false"
      )
      .get() as { amount: number }

    expect(paidAfter.amount).toBe(5000) // locked
    expect(unpaidAfter.amount).toBe(10000) // rewritten
  })

  it('does NOT touch bills outside the current calendar month', async () => {
    const { sub } = await setup3()
    // April bills (prior month)
    await generateMonthlyBills(db, '2026-04')
    // May bills (current month)
    await generateMonthlyBills(db, '2026-05')

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const april = await sqlite.prepare(
        "SELECT SUM(amount) AS total FROM billing_records WHERE billing_date = '2026-04-01'"
      )
      .get() as { total: number }
    const may = await sqlite.prepare(
        "SELECT SUM(amount) AS total FROM billing_records WHERE billing_date = '2026-05-01'"
      )
      .get() as { total: number }

    expect(april.total).toBe(10000) // unchanged (previous month)
    expect(may.total).toBe(20000) // rewritten (current month)
  })

  it('preserves pro-rata ratio for R2 mid-month joiner bills', async () => {
    // A (payer) + B. D joins May 15, gets pro-rata bill.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const d = await createUser(db, { email: 'd@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-10',
    })
    await generateMonthlyBills(db, '2026-05') // R1 bill for B

    // Add D on May 15 → R2 pro-rata (17/31 of share) at old price.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: d,
      addedBy: a,
      addedAt: '2026-05-15',
    })

    const dBillBefore = await sqlite.prepare(
        "SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = '2026-05-15'"
      )
      .get(d) as { amount: number }
    // oldShare(n=3) = 5000; days_covered = 31-15+1 = 17; floor(5000*17/31) = 2741
    expect(dBillBefore.amount).toBe(2741)

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const dBillAfter = await sqlite.prepare(
        "SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = '2026-05-15'"
      )
      .get(d) as { amount: number }
    // newShare(n=3) = 10000; days_covered = 17/31 preserved → floor(10000*17/31) = 5483
    expect(dBillAfter.amount).toBe(5483)
  })

  it('does NOT re-fetch FX — exchange_rate stays locked, localAmount recomputed with stored rate', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'USD' }) // foreign
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000, // ¥150
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: sub.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-03-10',
      },
      { CNY_USD: 0.14 }
    )
    // Generate with a known rate: 1 CNY = 0.14 USD
    await generateMonthlyBills(db, '2026-05', { CNY_USD: 0.14 })

    const before = await sqlite.prepare(
        "SELECT amount, local_amount, exchange_rate FROM billing_records WHERE user_id = ? AND billing_date = '2026-05-01'"
      )
      .get(b) as { amount: number; local_amount: number; exchange_rate: number }
    expect(before.amount).toBe(7500) // share = floor(15000/2) = 7500
    expect(before.exchange_rate).toBe(140000) // 0.14 × 1e6
    expect(before.local_amount).toBe(1050) // floor(7500 × 0.14)

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const after = await sqlite.prepare(
        "SELECT amount, local_amount, exchange_rate FROM billing_records WHERE user_id = ? AND billing_date = '2026-05-01'"
      )
      .get(b) as { amount: number; local_amount: number; exchange_rate: number }
    expect(after.amount).toBe(15000) // floor(30000/2)
    expect(after.exchange_rate).toBe(140000) // unchanged (locked)
    expect(after.local_amount).toBe(2100) // floor(15000 × 0.14) — uses stored rate
  })

  it('emits price_changed notifications to all active non-payer members', async () => {
    const { a, b, c, sub } = await setup3()
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const priceNotifsFor = async (uid: number) =>
      (await listNotifications(db, uid)).filter((n) => n.type === 'price_changed')

    // Only B and C receive — A is payer.
    expect(await priceNotifsFor(a)).toHaveLength(0)
    expect(await priceNotifsFor(b)).toHaveLength(1)
    expect(await priceNotifsFor(c)).toHaveLength(1)

    for (const recipient of [b, c]) {
      const n = (await priceNotifsFor(recipient))[0] as {
        type: string
        subscriptionId: number | null
        payload: {
          sub_name: string
          old_price: number
          new_price: number
          old_share: number
          new_share: number
          delta: number
          effective_from: string
        }
      }
      expect(n.type).toBe('price_changed')
      expect(n.subscriptionId).toBe(sub.id)
      expect(n.payload.sub_name).toBe('Netflix')
      expect(n.payload.old_price).toBe(15000)
      expect(n.payload.new_price).toBe(30000)
      expect(n.payload.old_share).toBe(5000)
      expect(n.payload.new_share).toBe(10000)
      expect(n.payload.delta).toBe(5000)
      // Under new R5, effective_from = current month's 1st (rewrite applies now).
      expect(n.payload.effective_from).toBe('2026-05-01')
    }
  })

  it('next monthly cron uses new price', async () => {
    const { sub } = await setup3()
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    await generateMonthlyBills(db, '2026-06')

    const bills = await sqlite.prepare(
        "SELECT amount FROM billing_records WHERE billing_date = '2026-06-01'"
      )
      .all() as { amount: number }[]
    expect(bills).toHaveLength(2)
    for (const b of bills) expect(b.amount).toBe(10000)
  })

  it('does not emit notification when new price equals old', async () => {
    const { a, b, sub } = await setup3()
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 15000 })
    const priceNotifsFor = async (uid: number) =>
      (await listNotifications(db, uid)).filter((n) => n.type === 'price_changed')
    expect(await priceNotifsFor(a)).toHaveLength(0)
    expect(await priceNotifsFor(b)).toHaveLength(0)
  })

  it('rejects negative or non-numeric price', async () => {
    const { sub } = await setup3()
    await expect(
      changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: -100 })
    ).rejects.toThrow()
    await expect(
      changeSubscriptionPrice(db, {
        subscriptionId: sub.id,
        // @ts-expect-error intentionally bad input
        newPrice: 'abc',
      })
    ).rejects.toThrow()
  })
})
