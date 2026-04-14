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
 * T12 — R5: price change does not retroactively adjust existing bills.
 * changeSubscriptionPrice updates sub.price and emits price_changed
 * notifications to every active non-payer member.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
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
    expect(after.n).toBe(before.n)
    expect(after.total).toBe(before.total) // unchanged
  })

  it('emits price_changed notifications to all active non-payer members', async () => {
    const { a, b, c, sub } = await setup3()
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const priceNotifsFor = (uid: number) =>
      await listNotifications(db, uid).filter((n) => n.type === 'price_changed')

    // Only B and C receive — A is payer.
    expect(priceNotifsFor(a)).toHaveLength(0)
    expect(priceNotifsFor(b)).toHaveLength(1)
    expect(priceNotifsFor(c)).toHaveLength(1)

    for (const recipient of [b, c]) {
      const n = priceNotifsFor(recipient)[0] as {
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
      expect(n.payload.old_share).toBe(5000) // floor(15000/3)
      expect(n.payload.new_share).toBe(10000) // floor(30000/3)
      expect(n.payload.delta).toBe(5000)
      expect(n.payload.effective_from).toMatch(/\d{4}-\d{2}-01/)
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
    const priceNotifsFor = (uid: number) =>
      await listNotifications(db, uid).filter((n) => n.type === 'price_changed')
    expect(priceNotifsFor(a)).toHaveLength(0)
    expect(priceNotifsFor(b)).toHaveLength(0)
  })

  it('rejects negative or non-numeric price', async () => {
    const { sub } = await setup3()
    expect(() =>
      await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: -100 })
    ).toThrow()
    expect(() =>
      await changeSubscriptionPrice(db, {
        subscriptionId: sub.id,
        // @ts-expect-error intentionally bad input
        newPrice: 'abc',
      })
    ).toThrow()
  })
})
