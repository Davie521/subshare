import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser, type SqliteShim, type TestDb } from './helpers'
import { createSubscription } from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import { runR1Cron } from '@/lib/engine/cron'
import { recomputeMonth } from '@/lib/engine/recompute'

/**
 * RED: rejoin must preserve the prior interval so the fair-engine sees
 * both stints when computing per-day fair shares.
 *
 * Bug: insertSubscriptionMember currently UPDATEs the existing row on
 * rejoin, overwriting addedAt and clearing leftAt. The engine then sees
 * only the latest interval and the rejoiner is undercharged for the
 * earlier stint, with the over-charge silently shifted onto other
 * non-leaving members.
 *
 * Scenario (April = 30 days, sub price = 4500 = $45):
 *   A (payer), B from 04-01 (full month).
 *   C from 04-01, leaves 04-08, rejoins 04-20.
 *   Active days:
 *     1-8 (8 days):    A,B,C → N=3
 *     9-19 (11 days):  A,B   → N=2
 *     20-30 (11 days): A,B,C → N=3
 *   dailyCost = 4500/30 = 150¢
 *   fair_A = 8×(150/3) + 11×(150/2) + 11×(150/3) = 400+825+550 = 1775¢
 *   fair_B = same = 1775¢
 *   fair_C = 8×(150/3) + 11×(150/3) = 400+550 = 950¢
 *   sum = 4500 ✓
 *
 * If rejoin loses C's first interval, engine instead sees C as
 * [04-20, null] only:
 *   fair_A = 19×(150/2) + 11×(150/3) = 1425+550 = 1975¢ (over by $2)
 *   fair_C = 11×(150/3) = 550¢ (under by $4 — the 8 days she actually used
 *                              get silently absorbed by A and B)
 */

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('rejoin preserves history (RED)', () => {
  it('engine sees both stints after rejoin: C fair = 950¢ (8 + 11 days), not 550¢', async () => {
    const A = await createUser(db, { email: 'a@rejoin.test', currency: 'USD' })
    const B = await createUser(db, { email: 'b@rejoin.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@rejoin.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'Rejoin-Sub',
      price: 4500,
      currency: 'USD',
      nextPayment: '2026-04-01',
      startDate: '2026-04-01',
      ownerId: A,
    })

    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-01' })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })

    // Wipe legacy R2 bills, run R1 fresh
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    // Carol leaves 04-08, rejoins 04-20
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `test-rejoin-leave:sub${sub.id}`,
      today: '2026-04-08', rates: { USD_USD: 1 },
    })

    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `test-rejoin-rejoin:sub${sub.id}`,
      today: '2026-04-20', rates: { USD_USD: 1 },
    })

    // Total bills for each user (sum of regular + adjustment rows)
    const billRows = (await sqlite
      .prepare(
        `SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`
      )
      .all(sub.id)) as Array<{ userId: number; amount: number }>

    const totalForA = billRows
      .filter((r) => r.userId === A)
      .reduce((s, r) => s + r.amount, 0)
    const totalForB = billRows
      .filter((r) => r.userId === B)
      .reduce((s, r) => s + r.amount, 0)
    const totalForC = billRows
      .filter((r) => r.userId === C)
      .reduce((s, r) => s + r.amount, 0)

    // ── Invariant: per-day-fair across both stints
    // C: 8 + 11 = 19 active days → 19 × (150/3) = 950¢
    // A,B: 8 × (150/3) + 11 × (150/2) + 11 × (150/3) = 1775¢ (each)
    // (residue rotation may shift ±1¢)
    expect(totalForC).toBeGreaterThanOrEqual(948)
    expect(totalForC).toBeLessThanOrEqual(952)
    expect(totalForA).toBeGreaterThanOrEqual(1773)
    expect(totalForA).toBeLessThanOrEqual(1777)
    expect(totalForB).toBeGreaterThanOrEqual(1773)
    expect(totalForB).toBeLessThanOrEqual(1777)

    // Sum of all bills (all users) must equal price
    const sum = totalForA + totalForB + totalForC
    expect(sum).toBe(4500)
  })

  it('membership row exposes the prior interval to the engine', async () => {
    // The engine reads subscription_members and builds MemberInterval[].
    // After leave+rejoin, there must be a way for the engine to see BOTH
    // the prior [addedAt, leftAt] interval AND the new [addedAt, null]
    // interval — either via two rows OR via a previous_intervals JSON
    // column on the row. Either is acceptable; this test is a structural
    // probe that fails in the current (history-erasing) implementation.
    const A = await createUser(db, { email: 'a@struct.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@struct.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'StructProbe', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })

    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    // Read full row (including any previous_intervals JSON column).
    const rows = (await sqlite
      .prepare(
        `SELECT added_at as "addedAt", left_at as "leftAt",
                previous_intervals as "previousIntervals"
         FROM subscription_members
         WHERE subscription_id = ? AND user_id = ?`
      )
      .all(sub.id, C)) as Array<{
      addedAt: string
      leftAt: string | null
      previousIntervals: string | null
    }>

    // We accept two valid shapes:
    //   (a) Two rows: one [04-01, 04-08], one [04-20, null]
    //   (b) One row [04-20, null] with previousIntervals = [{04-01, 04-08}]
    const shapeA = rows.length === 2
    const shapeB =
      rows.length === 1 &&
      rows[0].previousIntervals !== null &&
      JSON.stringify(rows[0].previousIntervals).includes('2026-04-01') &&
      JSON.stringify(rows[0].previousIntervals).includes('2026-04-08')

    expect(shapeA || shapeB).toBe(true)
  })
})
