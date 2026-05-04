import { describe, it, expect, beforeEach } from 'vitest'
import {
  setupTestDb,
  createUser,
  type SqliteShim,
  type TestDb,
} from './helpers'
import { createSubscription } from '@/lib/db-operations'
import { addMemberToSubscription } from '@/lib/membership'
import { runR1Cron } from '@/lib/engine/cron'
import { recomputeMonth } from '@/lib/engine/recompute'
import { changeSubscriptionPrice } from '@/lib/billing-ops'

/**
 * Per-day price timeline tests.
 *
 * Real-world story:
 *   Alice pays Anthropic $30/month. Her real billing cycle starts on the
 *   15th of each month (sub.nextPayment = 4/15). Anthropic raises price
 *   to $60 effective 4/15. The April calendar bill should reflect the
 *   blended cost: 14 days at old price ($30/30 × 14 = $14) + 16 days at
 *   new price ($60/30 × 16 = $32) = $46 total. Split with Bob → $23 each.
 *
 * The current single-price R5 produces $60/2 = $30 each (overcharge),
 * and "next month only" produces $30/2 = $15 each (undercharge). Only
 * the per-day timeline matches what was actually charged.
 */

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('price-change with per-day timeline (RED)', () => {
  it('mid-month price change yields blended monthly fair: $30 → $60 eff 4/15 → $23 each', async () => {
    const A = await createUser(db, { email: 'a@timeline.test', currency: 'USD' })
    const B = await createUser(db, { email: 'b@timeline.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'Anthropic',
      price: 3000, // $30 — old price
      currency: 'USD',
      nextPayment: '2026-04-15',
      startDate: '2026-04-01',
      ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-01' })

    // Wipe legacy R2 bills, run R1 fresh at old price.
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    // Anthropic raises to $60 effective 4/15 (Alice's real next payment).
    await changeSubscriptionPrice(db, {
      subscriptionId: sub.id,
      newPrice: 6000,
      effectiveFrom: '2026-04-15',
    })

    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `timeline-mid-month:sub${sub.id}`,
      today: '2026-04-15', rates: { USD_USD: 1 },
    })

    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)

    // April = 30 days
    // dailyCost(d) = $30/30 = 100¢ for d ≤ 14; $60/30 = 200¢ for d ≥ 15
    // per_user_per_day = dailyCost / 2 (both A and B active full month)
    // fair_each = 14 × 50 + 16 × 100 = 700 + 1600 = 2300¢ = $23
    expect(sumFor(A)).toBeGreaterThanOrEqual(2298)
    expect(sumFor(A)).toBeLessThanOrEqual(2302)
    expect(sumFor(B)).toBeGreaterThanOrEqual(2298)
    expect(sumFor(B)).toBeLessThanOrEqual(2302)
    // Total = $46
    expect(sumFor(A) + sumFor(B)).toBe(4600)
  })

  it('price change effective_from in future month: current month untouched, future month uses new', async () => {
    // Today = 4/4. User changes price effective 5/15 (future, mid-may).
    // April: should remain at old price entirely ($30, fair = $15 each).
    // May: 14 days at old, 17 days at new ($30×14/31 + $60×17/31 = $46.45),
    //      split = $23.23 each
    const A = await createUser(db, { email: 'a@future.test', currency: 'USD' })
    const B = await createUser(db, { email: 'b@future.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'AnthropicFuture',
      price: 3000,
      currency: 'USD',
      nextPayment: '2026-04-15',
      startDate: '2026-04-01',
      ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    // Today is 4/4; user schedules a 5/15 price change.
    await changeSubscriptionPrice(db, {
      subscriptionId: sub.id,
      newPrice: 6000,
      effectiveFrom: '2026-05-15',
    })

    // Recompute April with timeline. May 5/15 change has no effect on April.
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `timeline-future:sub${sub.id}`,
      today: '2026-04-04', rates: { USD_USD: 1 },
    })

    const aprBills = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ? AND billing_date LIKE '2026-04-%'`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const aprSum = (uid: number) =>
      aprBills.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(aprSum(A)).toBeGreaterThanOrEqual(1498)
    expect(aprSum(A)).toBeLessThanOrEqual(1502)
    expect(aprSum(B)).toBeGreaterThanOrEqual(1498)
    expect(aprSum(B)).toBeLessThanOrEqual(1502)
    expect(aprSum(A) + aprSum(B)).toBe(3000)

    // Now run the May R1 cron — it should use the new price for days 15+.
    await runR1Cron(db, { today: '2026-05-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })
    // dailyCost: $30/31 for d≤14 (1-14 = 14 days), $60/31 for d≥15 (15-31 = 17 days)
    // fair_each = 14×($30/31/2) + 17×($60/31/2)
    //          = (14×3000 + 17×6000) / (31×2)
    //          = (42000 + 102000) / 62
    //          = 144000 / 62
    //          ≈ 2322.58¢ ≈ $23.23
    const mayBills = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ? AND billing_date LIKE '2026-05-%'`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const maySum = (uid: number) =>
      mayBills.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(maySum(A)).toBeGreaterThanOrEqual(2320)
    expect(maySum(A)).toBeLessThanOrEqual(2325)
    expect(maySum(B)).toBeGreaterThanOrEqual(2320)
    expect(maySum(B)).toBeLessThanOrEqual(2325)
    expect(maySum(A) + maySum(B)).toBe(4645) // 144000/62 floors to 4645
  })

  it('retroactive price change across paid month: settled rows untouched, adj added', async () => {
    // Today = 5/4. User realizes Anthropic raised on 4/15 last month —
    // April was already paid at old price. Engine adds adj rows.
    const A = await createUser(db, { email: 'a@retro.test', currency: 'USD' })
    const B = await createUser(db, { email: 'b@retro.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'AnthropicRetro', price: 3000, currency: 'USD',
      nextPayment: '2026-04-15', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    // Settle April at old price.
    await sqlite
      .prepare(`UPDATE billing_records SET is_paid=true, paid_at='2026-04-20T10:00:00Z'
                WHERE subscription_id = ?`)
      .run(sub.id)

    // Now (today=5/4) record retroactive price change.
    await changeSubscriptionPrice(db, {
      subscriptionId: sub.id,
      newPrice: 6000,
      effectiveFrom: '2026-04-15',
    })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `timeline-retro:sub${sub.id}`,
      today: '2026-05-04', rates: { USD_USD: 1 },
    })

    const aprBills = (await sqlite
      .prepare(`SELECT user_id as "userId", amount, is_paid as "isPaid",
                       adjustment_for_bill_id as "adjFor"
                FROM billing_records
                WHERE subscription_id = ? AND billing_date LIKE '2026-04-%'`)
      .all(sub.id)) as Array<{
      userId: number; amount: number; isPaid: boolean; adjFor: number | null
    }>

    // Original paid rows untouched at $15 each
    const paidA = aprBills.find((r) => r.userId === A && r.adjFor === null)
    const paidB = aprBills.find((r) => r.userId === B && r.adjFor === null)
    expect(paidA?.isPaid).toBe(true)
    expect(paidB?.isPaid).toBe(true)
    expect(paidA?.amount).toBe(1500)
    expect(paidB?.amount).toBe(1500)

    // Adj rows bring totals to $23 each
    const sumFor = (uid: number) =>
      aprBills.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(sumFor(A)).toBeGreaterThanOrEqual(2298)
    expect(sumFor(A)).toBeLessThanOrEqual(2302)
    expect(sumFor(B)).toBeGreaterThanOrEqual(2298)
    expect(sumFor(B)).toBeLessThanOrEqual(2302)
    expect(sumFor(A) + sumFor(B)).toBe(4600)
  })

  it('out-of-window effective_from rejected (>1 month forward or backward)', async () => {
    const A = await createUser(db, { email: 'a@oow.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'OOW', price: 3000, currency: 'USD',
      nextPayment: '2026-05-15', startDate: '2026-01-01', ownerId: A,
    })

    // +60 days from today=2026-05-04 → 2026-07-03 — out of range
    await expect(
      changeSubscriptionPrice(db, {
        subscriptionId: sub.id,
        newPrice: 6000,
        effectiveFrom: '2026-07-03',
        today: '2026-05-04',
      })
    ).rejects.toThrow(/out of.*window|range/i)

    // -60 days → 2026-03-05 — out of range
    await expect(
      changeSubscriptionPrice(db, {
        subscriptionId: sub.id,
        newPrice: 6000,
        effectiveFrom: '2026-03-05',
        today: '2026-05-04',
      })
    ).rejects.toThrow(/out of.*window|range/i)
  })
})
