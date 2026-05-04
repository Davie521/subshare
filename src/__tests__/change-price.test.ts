import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  createSubscription,
} from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import { changeSubscriptionPrice } from '@/lib/billing-ops'
import { generateMonthlyBills } from '@/lib/cron-billing'
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

  it('R5 rewrites unpaid current-month bills to the new share', async () => {
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
      // effective_from = the date the new price kicks in. With the per-day
      // timeline engine the default is `today` (when no effectiveFrom is
      // passed). Tests fix today to 2026-05-15.
      expect(n.payload.effective_from).toBe('2026-05-15')
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

  it('P0-1 RED: preserves R11 redistribute delta on R1 bills when price changes', async () => {
    // A (payer), B, C, D. Price 1000 → R1 share = 250 each.
    // C leaves mid-month with refund_policy=redistribute → B/D each absorb
    // part of C's released amount. Later the payer changes the price. The
    // R11 delta must survive the rewrite; otherwise the payer silently
    // re-absorbs the cost that R11 had intentionally pushed onto others.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const d = await createUser(db, { email: 'd@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
      refundPolicy: 'redistribute',
    })
    for (const uid of [b, c, d]) {
      await addMemberToSubscription(db, {
        subscriptionId: sub.id,
        userId: uid,
        addedBy: a,
        addedAt: '2026-03-10',
      })
    }
    await generateMonthlyBills(db, '2026-05')

    // Sanity: R1 bills at 250 each for B/C/D.
    const r1Before = await sqlite
      .prepare(
        "SELECT user_id, amount FROM billing_records WHERE billing_date = '2026-05-01' ORDER BY user_id"
      )
      .all() as Array<{ user_id: number; amount: number }>
    expect(r1Before).toHaveLength(3)
    expect(r1Before.every((r) => r.amount === 250)).toBe(true)

    // C leaves on 5/11 (usage=10, coverage=31 → 80 kept; diff=170 redistributed
    // to B,D → addPer=85, remainder=0 → B=335, D=335, C=80).
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: '2026-05-11',
    })

    const bBillPreR5 = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(b) as { amount: number }
    const dBillPreR5 = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(d) as { amount: number }
    const cBillPreR5 = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(c) as { amount: number }
    expect(bBillPreR5.amount).toBe(335) // 250 + 85
    expect(dBillPreR5.amount).toBe(335) // 250 + 85
    expect(cBillPreR5.amount).toBe(80)

    // Payer bumps price to 1600. n_today = 3 (A, B, D) → newShare = 533.
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 1600 })

    const bAfter = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(b) as { amount: number }
    const dAfter = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(d) as { amount: number }
    const cAfter = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(c) as { amount: number }

    // Expected (method A): new bill = newShare + r11_delta. B/D each had
    // an R11 delta of 85 locked in when C left; that 85 is independent of
    // the later price change and must persist.
    expect(bAfter.amount).toBe(618) // 533 + 85
    expect(dAfter.amount).toBe(618) // 533 + 85
    // C is no longer active and must not be touched by R5.
    expect(cAfter.amount).toBe(80)
  })

  it('P1-6 RED: leaver with unpaid current-month bill also receives price_changed', async () => {
    // A=payer, B, C. C leaves mid-month, C's R3-adjusted bill is unpaid.
    // Payer changes price. C's bill is NOT modified (R5 skips non-active
    // users), but C should still be notified so they understand the sub's
    // state they're still on the hook to settle.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 3000,
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
    await generateMonthlyBills(db, '2026-05')

    // C leaves on 5/11 — their bill gets prorated but stays unpaid.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: '2026-05-11',
    })

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 6000 })

    const priceNotifsFor = async (uid: number) =>
      (await listNotifications(db, uid)).filter((n) => n.type === 'price_changed')
    expect(await priceNotifsFor(b)).toHaveLength(1) // active member
    expect(await priceNotifsFor(c)).toHaveLength(1) // leaver with unpaid bill
    expect(await priceNotifsFor(a)).toHaveLength(0) // payer
  })

  it('P1-6 RED: leaver with ZERO unpaid bills gets no price_changed notice', async () => {
    // If C left and has no remaining unpaid bills (e.g. leftAt = month-start
    // day so R3 deleted the bill), notifying them is just noise.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 3000,
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
    await generateMonthlyBills(db, '2026-05')

    // Leaving on 5/1 means usage=0 → bill is deleted by R3.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: '2026-05-01',
    })

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 6000 })

    const priceNotifsFor = async (uid: number) =>
      (await listNotifications(db, uid)).filter((n) => n.type === 'price_changed')
    expect(await priceNotifsFor(c)).toHaveLength(0)
  })

  it('P0-1 RED: no R11 delta → R5 behaves as before (newShare exactly)', async () => {
    const { sub, b, c } = await setup3()
    await generateMonthlyBills(db, '2026-05') // 2 bills of 5000 each (15000/3)

    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })

    const bBill = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(b) as { amount: number }
    const cBill = await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ? AND billing_date = \'2026-05-01\'')
      .get(c) as { amount: number }
    // No redistribute happened, so delta = 0 → new bill = exact newShare.
    expect(bBill.amount).toBe(10000) // floor(30000/3)
    expect(cBill.amount).toBe(10000)
  })
})
