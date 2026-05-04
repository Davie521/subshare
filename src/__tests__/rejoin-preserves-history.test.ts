import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser, type SqliteShim, type TestDb } from './helpers'
import { createSubscription } from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import { runR1Cron } from '@/lib/engine/cron'
import { recomputeMonth } from '@/lib/engine/recompute'
import { editMemberAddedAt } from '@/lib/engine/edit-added-at'
import { handleDeleteSubscription } from '@/lib/api-handlers'

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

  it('three stints: previous_intervals accumulates two archived stints', async () => {
    // C joins 4/1, leaves 4/8, rejoins 4/12, leaves 4/18, rejoins 4/24.
    // Active days for C: 1-8 (8) + 12-18 (7) + 24-30 (7) = 22 days
    const A = await createUser(db, { email: 'a@multi.test', currency: 'USD' })
    const B = await createUser(db, { email: 'b@multi.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@multi.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'Multi-rejoin', price: 4500, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-01' })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    // First leave + rejoin
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-12' })

    // Second leave + rejoin
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-18', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-24' })

    // Engine reconciliation
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `multi-rejoin:sub${sub.id}`, today: '2026-04-24', rates: { USD_USD: 1 },
    })

    const memberRow = (await sqlite
      .prepare(
        `SELECT added_at as "addedAt", left_at as "leftAt",
                previous_intervals as "previousIntervals"
         FROM subscription_members WHERE subscription_id = ? AND user_id = ?`
      )
      .all(sub.id, C)) as Array<{
      addedAt: string
      leftAt: string | null
      previousIntervals: Array<{ addedAt: string; leftAt: string }>
    }>

    expect(memberRow).toHaveLength(1)
    expect(memberRow[0].addedAt).toBe('2026-04-24')
    expect(memberRow[0].leftAt).toBeNull()
    // Two archived stints, in insertion order
    expect(memberRow[0].previousIntervals).toEqual([
      { addedAt: '2026-04-01', leftAt: '2026-04-08' },
      { addedAt: '2026-04-12', leftAt: '2026-04-18' },
    ])

    // Bill totals reflect 22 active days for C
    // dailyCost = 4500/30 = 150¢
    // C: 8×(150/3) + 7×(150/3) + 7×(150/3) = 22×50 = 1100¢
    // Days when C absent (9-11=3 days, 19-23=5 days): A,B only N=2
    //   A,B contribution = 8×(150/2) = 600¢ extra each
    // A,B: 22×(150/3) + 8×(150/2) = 1100 + 600 = 1700¢ each
    // sum = 1700 + 1700 + 1100 = 4500 ✓
    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)

    expect(sumFor(C)).toBeGreaterThanOrEqual(1098)
    expect(sumFor(C)).toBeLessThanOrEqual(1102)
    expect(sumFor(A)).toBeGreaterThanOrEqual(1698)
    expect(sumFor(A)).toBeLessThanOrEqual(1702)
    expect(sumFor(B)).toBeGreaterThanOrEqual(1698)
    expect(sumFor(B)).toBeLessThanOrEqual(1702)
    expect(sumFor(A) + sumFor(B) + sumFor(C)).toBe(4500)
  })

  it('cross-month rejoin: prior April stint does not affect May fair', async () => {
    // C joins 4/1, leaves 4/15, rejoins 5/10. April and May recompute
    // independently — each month sees only the intervals overlapping it.
    const A = await createUser(db, { email: 'a@cross.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@cross.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'CrossMonth', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })
    await runR1Cron(db, { today: '2026-05-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-15', actorId: A })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `cross-leave-apr:sub${sub.id}`, today: '2026-04-15', rates: { USD_USD: 1 },
    })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 5,
      eventId: `cross-leave-may:sub${sub.id}`, today: '2026-04-15', rates: { USD_USD: 1 },
    })

    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-05-10' })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 5,
      eventId: `cross-rejoin-may:sub${sub.id}`, today: '2026-05-10', rates: { USD_USD: 1 },
    })

    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount, billing_date as "billingDate"
                FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number; billingDate: string }>

    // April: C active 1-15 (15 days), N=2 throughout when both present;
    //   days 16-30 (15 days) only A active.
    //   dailyCost = 3000/30 = 100¢
    //   fair_C = 15×50 = 750¢
    //   fair_A = 15×50 + 15×100 = 2250¢
    const aprC = billRows.filter((r) => r.userId === C && r.billingDate.startsWith('2026-04')).reduce((s, r) => s + r.amount, 0)
    const aprA = billRows.filter((r) => r.userId === A && r.billingDate.startsWith('2026-04')).reduce((s, r) => s + r.amount, 0)
    expect(aprC).toBeGreaterThanOrEqual(748)
    expect(aprC).toBeLessThanOrEqual(752)
    expect(aprA).toBeGreaterThanOrEqual(2248)
    expect(aprA).toBeLessThanOrEqual(2252)

    // May: C active only from 5/10. 31 days total.
    //   dailyCost = 3000/31 ≈ 96.77¢
    //   Days 1-9 (9 days): A solo
    //   Days 10-31 (22 days): A,C
    //   fair_C = 22 × dailyCost / 2 = 11 × dailyCost ≈ 1064.5¢
    //   fair_A = 9 × dailyCost + 22 × dailyCost / 2 = 20 × dailyCost ≈ 1935.5¢
    const mayC = billRows.filter((r) => r.userId === C && r.billingDate.startsWith('2026-05')).reduce((s, r) => s + r.amount, 0)
    const mayA = billRows.filter((r) => r.userId === A && r.billingDate.startsWith('2026-05')).reduce((s, r) => s + r.amount, 0)
    expect(mayC).toBeGreaterThanOrEqual(1062)
    expect(mayC).toBeLessThanOrEqual(1067)
    expect(mayA).toBeGreaterThanOrEqual(1933)
    expect(mayA).toBeLessThanOrEqual(1938)

    // Both months independently sum to price
    const aprSum = billRows.filter((r) => r.billingDate.startsWith('2026-04')).reduce((s, r) => s + r.amount, 0)
    const maySum = billRows.filter((r) => r.billingDate.startsWith('2026-05')).reduce((s, r) => s + r.amount, 0)
    expect(aprSum).toBe(3000)
    expect(maySum).toBe(3000)
  })

  it('same-day rejoin (addedAt = prior leftAt) throws — closed-interval overlap', async () => {
    const A = await createUser(db, { email: 'a@sameday.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@sameday.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'SameDay', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })

    // Closed interval: 04-08 is C's last active day. Rejoin on 04-08
    // would mean C is "active" both intervals on day 8 — overlap.
    await expect(
      addMemberToSubscription(db,
        { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-08' })
    ).rejects.toThrow(/must be after prior leftAt/)
  })

  it('rejoin then leave again: engine sees both old interval and current closed range', async () => {
    // C joins 4/1, leaves 4/8, rejoins 4/15, leaves 4/22.
    // Active days: 1-8 (8) + 15-22 (8) = 16 days.
    const A = await createUser(db, { email: 'a@rejleave.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@rejleave.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'RejoinThenLeave', price: 6000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-15' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-22', actorId: A })

    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `rej-leave:sub${sub.id}`, today: '2026-04-22', rates: { USD_USD: 1 },
    })

    const memberRow = (await sqlite
      .prepare(
        `SELECT added_at as "addedAt", left_at as "leftAt",
                previous_intervals as "previousIntervals"
         FROM subscription_members WHERE subscription_id = ? AND user_id = ?`
      )
      .all(sub.id, C)) as Array<{
      addedAt: string
      leftAt: string | null
      previousIntervals: Array<{ addedAt: string; leftAt: string }>
    }>
    // Active row holds the most recent stint; previousIntervals holds the first.
    expect(memberRow[0].addedAt).toBe('2026-04-15')
    expect(memberRow[0].leftAt).toBe('2026-04-22')
    expect(memberRow[0].previousIntervals).toEqual([
      { addedAt: '2026-04-01', leftAt: '2026-04-08' },
    ])

    // April = 30 days, dailyCost = 6000/30 = 200¢
    // C: 16 × (200/2) = 1600¢
    // A: 16 × (200/2) + 14 × 200 = 1600 + 2800 = 4400¢
    // (days 9-14, 23-30 = 14 days A solo)
    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(sumFor(C)).toBeGreaterThanOrEqual(1598)
    expect(sumFor(C)).toBeLessThanOrEqual(1602)
    expect(sumFor(A)).toBeGreaterThanOrEqual(4398)
    expect(sumFor(A)).toBeLessThanOrEqual(4402)
    expect(sumFor(A) + sumFor(C)).toBe(6000)
  })

  it('editAddedAt back into a prior interval throws on overlap (engine guards)', async () => {
    // C had stint [04-01, 04-08], rejoined 04-20. Owner now edits the
    // active row's addedAt back to 04-05 — which falls inside the
    // archived stint's range. The engine's overlap check must catch this.
    const A = await createUser(db, { email: 'a@editrej.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@editrej.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'EditOverlap', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    // Editing back to 04-05 would overlap with archived [04-01, 04-08].
    await expect(
      editMemberAddedAt(db, {
        subscriptionId: sub.id,
        targetUserId: C,
        actorUserId: A,
        newAddedAt: '2026-04-05',
        today: '2026-05-04',
        rates: { USD_USD: 1 },
      })
    ).rejects.toThrow(/overlap/i)
  })

  it('editAddedAt forward (still after prior leftAt) succeeds and recomputes', async () => {
    // C: stint [04-01, 04-08], rejoined 04-20. Owner edits active row
    // to 04-15 (still > 04-08, no overlap). Should succeed and the engine
    // re-allocates accordingly.
    const A = await createUser(db, { email: 'a@editok.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@editok.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'EditOK', price: 4500, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    await editMemberAddedAt(db, {
      subscriptionId: sub.id,
      targetUserId: C,
      actorUserId: A,
      newAddedAt: '2026-04-15',
      today: '2026-05-04',
      rates: { USD_USD: 1 },
    })

    // C now active 1-8 (8 days) + 15-30 (16 days) = 24 days
    // Solo A days 9-14 (6 days) → A gets full dailyCost on those
    // dailyCost = 4500/30 = 150¢
    // fair_C = 24 × (150/2) = 1800¢
    // fair_A = 24 × (150/2) + 6 × 150 = 1800 + 900 = 2700¢
    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount, billing_date as "billingDate" FROM billing_records WHERE subscription_id = ? AND billing_date < '2026-05-01'`)
      .all(sub.id)) as Array<{ userId: number; amount: number; billingDate: string }>
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(sumFor(C)).toBeGreaterThanOrEqual(1798)
    expect(sumFor(C)).toBeLessThanOrEqual(1802)
    expect(sumFor(A)).toBeGreaterThanOrEqual(2698)
    expect(sumFor(A)).toBeLessThanOrEqual(2702)
    expect(sumFor(A) + sumFor(C)).toBe(4500)
  })

  it('payer cannot leave (R7) — even with rejoin history this stays enforced', async () => {
    const A = await createUser(db, { email: 'a@payerleave.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@payerleave.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'PayerLeaveGuard', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })

    // Just to make sure rejoin history doesn't open a back door
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    await expect(
      leaveSubscription(db,
        { subscriptionId: sub.id, userId: A, leftAt: '2026-04-25', actorId: A })
    ).rejects.toThrow(/payer/i)
  })

  it('rejoin when the first-stint bill is already paid: settled row untouched, adj used for delta', async () => {
    // C joins 4/1, R1 bill paid early, leaves 4/8, rejoins 4/20.
    // Pre-fix bug would have mutated the paid bill to a wrong amount.
    // Post-fix: paid bill stays locked at its paid value; engine reconciles
    // via adj rows or fresh inserts.
    const A = await createUser(db, { email: 'a@paid-rejoin.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@paid-rejoin.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'PaidRejoin', price: 6000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })

    // Mark C's R1 bill paid early
    await sqlite
      .prepare(`UPDATE billing_records SET is_paid=true, paid_at='2026-04-02T10:00:00Z'
                WHERE subscription_id=? AND user_id=?`)
      .run(sub.id, C)

    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `paid-leave:sub${sub.id}`, today: '2026-04-08', rates: { USD_USD: 1 },
    })

    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `paid-rejoin:sub${sub.id}`, today: '2026-04-20', rates: { USD_USD: 1 },
    })

    const billRows = (await sqlite
      .prepare(`SELECT id, user_id as "userId", amount, billing_date as "billingDate",
                       is_paid as "isPaid", adjustment_for_bill_id as "adjFor"
                FROM billing_records WHERE subscription_id = ? ORDER BY id`)
      .all(sub.id)) as Array<{
      id: number; userId: number; amount: number; billingDate: string
      isPaid: boolean; adjFor: number | null
    }>

    // The C 04-01 bill must remain at its paid amount (3000¢ = $30, the original R1
    // share before any leave-prorate, since it was paid at full R1 amount).
    const paidR1 = billRows.find(
      (r) => r.userId === C && r.billingDate === '2026-04-01' && r.adjFor === null && r.isPaid
    )
    expect(paidR1).toBeDefined()
    expect(paidR1!.amount).toBe(3000)

    // Engine should have a NEGATIVE adjustment against the paid R1 bill,
    // since C overpaid: actual fair for stint 1 = 8 × (200/2) = 800¢, paid 3000.
    // Plus a fresh bill for the new stint = 11 × (200/2) = 1100¢.
    // Net C target (across both stints) = 1900¢. Actual = paid 3000 + new bills.
    // So adj must bring C's TOTAL down to 1900 (or close ±1¢ rotation).
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(sumFor(C)).toBeGreaterThanOrEqual(1898)
    expect(sumFor(C)).toBeLessThanOrEqual(1902)

    // A's fair = 8×(200/2) + 11×200 + 11×(200/2) = 800+2200+1100 = 4100
    expect(sumFor(A)).toBeGreaterThanOrEqual(4098)
    expect(sumFor(A)).toBeLessThanOrEqual(4102)

    // Sum still = 6000
    expect(sumFor(A) + sumFor(C)).toBe(6000)
  })

  it('two members rejoin same month: engine handles both multi-interval users', async () => {
    // B joins 4/1, leaves 4/10, rejoins 4/22.
    // C joins 4/5, leaves 4/15, rejoins 4/25.
    // Active days:
    //   1-4 (4 days): A,B → N=2
    //   5-9 (5 days): A,B,C → N=3
    //   10 (1 day): A,C → N=2  (B leaves 04-10 — last active = 04-10... wait closed:
    //     B leftAt=04-10 means B active through 04-10, so day 10 includes B.
    //     Use B leaves 04-09 to make this clearer.) — switch to B leaves 04-09
    // Restart: B [4/1, 4/9], rejoin [4/22, null]; C [4/5, 4/15], rejoin [4/25, null]
    //   1-4 (4): A,B → N=2
    //   5-9 (5): A,B,C → N=3
    //   10-15 (6): A,C → N=2
    //   16-21 (6): A solo → N=1
    //   22-24 (3): A,B → N=2
    //   25-30 (6): A,B,C → N=3
    const A = await createUser(db, { email: 'a@multi-multi.test', currency: 'USD' })
    const B = await createUser(db, { email: 'b@multi-multi.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@multi-multi.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'MultiMulti', price: 9000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-01' })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-05' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: B, leftAt: '2026-04-09', actorId: A })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-15', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-04-22' })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-25' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `multi-multi:sub${sub.id}`, today: '2026-04-25', rates: { USD_USD: 1 },
    })

    // dailyCost = 9000/30 = 300¢
    // fair_A = 4×150 + 5×100 + 6×150 + 6×300 + 3×150 + 6×100
    //        = 600 + 500 + 900 + 1800 + 450 + 600 = 4850
    // fair_B = 4×150 + 5×100 + 0 + 0 + 3×150 + 6×100 = 600+500+450+600 = 2150
    // fair_C = 0 + 5×100 + 6×150 + 0 + 0 + 6×100 = 500+900+600 = 2000
    // sum = 4850 + 2150 + 2000 = 9000 ✓
    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(sumFor(A)).toBeGreaterThanOrEqual(4848)
    expect(sumFor(A)).toBeLessThanOrEqual(4852)
    expect(sumFor(B)).toBeGreaterThanOrEqual(2148)
    expect(sumFor(B)).toBeLessThanOrEqual(2152)
    expect(sumFor(C)).toBeGreaterThanOrEqual(1998)
    expect(sumFor(C)).toBeLessThanOrEqual(2002)
    expect(sumFor(A) + sumFor(B) + sumFor(C)).toBe(9000)

    // DB sanity: each multi-interval user has exactly one archived stint
    const bRow = (await sqlite
      .prepare(`SELECT previous_intervals as "previousIntervals" FROM subscription_members
                WHERE subscription_id = ? AND user_id = ?`)
      .all(sub.id, B)) as Array<{ previousIntervals: Array<{ addedAt: string; leftAt: string }> }>
    expect(bRow[0].previousIntervals).toEqual([{ addedAt: '2026-04-01', leftAt: '2026-04-09' }])

    const cRow = (await sqlite
      .prepare(`SELECT previous_intervals as "previousIntervals" FROM subscription_members
                WHERE subscription_id = ? AND user_id = ?`)
      .all(sub.id, C)) as Array<{ previousIntervals: Array<{ addedAt: string; leftAt: string }> }>
    expect(cRow[0].previousIntervals).toEqual([{ addedAt: '2026-04-05', leftAt: '2026-04-15' }])
  })

  it('leftAt = end of month: rejoin must be in next month (closed-interval gap)', async () => {
    // C joins 4/1, leaves 4/30 (last day). Closed interval: leftAt=04-30 means
    // 04-30 is C's last active day. Rejoin on 04-30 same day → throws.
    // Rejoin on 05-01 (next month) → ok.
    const A = await createUser(db, { email: 'a@eom.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@eom.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'EOM', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-30', actorId: A })

    // Same-day rejoin throws
    await expect(
      addMemberToSubscription(db,
        { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-30' })
    ).rejects.toThrow(/must be after prior leftAt/)

    // 05-01 rejoin succeeds
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-05-01' })

    // April: C active full month [4/1, 4/30] in archive
    // dailyCost_apr = 3000/30 = 100¢, fair_C_apr = 30×50 = 1500¢, fair_A_apr = 1500
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `eom-apr:sub${sub.id}`, today: '2026-05-01', rates: { USD_USD: 1 },
    })
    const aprBills = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const aprSum = (uid: number) =>
      aprBills.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(aprSum(A)).toBeGreaterThanOrEqual(1498)
    expect(aprSum(A)).toBeLessThanOrEqual(1502)
    expect(aprSum(C)).toBeGreaterThanOrEqual(1498)
    expect(aprSum(C)).toBeLessThanOrEqual(1502)
    expect(aprSum(A) + aprSum(C)).toBe(3000)
  })

  it('price change after rejoin: new price applied per-day across both intervals', async () => {
    // C joins 4/1, leaves 4/8, rejoins 4/20. Then sub price changes
    // 6000 → 9000. Engine recompute with new price should see both
    // intervals and produce fair across them.
    const A = await createUser(db, { email: 'a@price-rej.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@price-rej.test', currency: 'USD' })

    const sub = await createSubscription(db, {
      name: 'PriceRejoin', price: 6000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await runR1Cron(db, { today: '2026-04-01', rates: { USD_USD: 1 }, subscriptionId: sub.id })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    // Update price + recompute
    await sqlite.prepare(`UPDATE subscriptions SET price = 9000 WHERE id = ?`).run(sub.id)
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `price-change:sub${sub.id}`, today: '2026-04-22', rates: { USD_USD: 1 },
    })

    // April = 30 days, dailyCost = 9000/30 = 300¢ (new price)
    // C active: 8 + 11 = 19 days
    // Days 1-8 (8): A,C N=2 → A:8×150=1200, C:8×150=1200
    // Days 9-19 (11): A solo N=1 → A:11×300=3300
    // Days 20-30 (11): A,C N=2 → A:11×150=1650, C:11×150=1650
    // fair_A = 1200 + 3300 + 1650 = 6150
    // fair_C = 1200 + 1650 = 2850
    // sum = 9000 ✓
    const billRows = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ?`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const sumFor = (uid: number) =>
      billRows.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(sumFor(A)).toBeGreaterThanOrEqual(6148)
    expect(sumFor(A)).toBeLessThanOrEqual(6152)
    expect(sumFor(C)).toBeGreaterThanOrEqual(2848)
    expect(sumFor(C)).toBeLessThanOrEqual(2852)
    expect(sumFor(A) + sumFor(C)).toBe(9000)
  })

  it('delete subscription cascades and removes rows including previous_intervals JSON', async () => {
    const A = await createUser(db, { email: 'a@del.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@del.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'ToDelete', price: 3000, currency: 'USD',
      nextPayment: '2026-04-01', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    // Confirm previousIntervals populated before delete
    const before = (await sqlite
      .prepare(`SELECT previous_intervals as "pi" FROM subscription_members WHERE user_id = ?`)
      .all(C)) as Array<{ pi: Array<{ addedAt: string; leftAt: string }> }>
    expect(before).toHaveLength(1)
    expect(before[0].pi).toHaveLength(1)

    const result = await handleDeleteSubscription(db, A, sub.id)
    expect(result.success).toBe(true)

    const after = (await sqlite
      .prepare(`SELECT * FROM subscription_members WHERE subscription_id = ?`)
      .all(sub.id)) as unknown[]
    expect(after).toHaveLength(0)
    const subAfter = (await sqlite
      .prepare(`SELECT * FROM subscriptions WHERE id = ?`)
      .all(sub.id)) as unknown[]
    expect(subAfter).toHaveLength(0)
  })

  it('archived stint that crosses month boundary: each month sees only its overlap', async () => {
    // C joins 3/15, leaves 5/8 (ARCHIVED stint spans 3 months).
    // Then rejoins 6/2. April recompute should see [3/15, 5/8] contributing
    // ALL of April. May recompute should see [3/15, 5/8] contributing 5/1–5/8.
    const A = await createUser(db, { email: 'a@span.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@span.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Span', price: 3000, currency: 'USD',
      nextPayment: '2026-03-01', startDate: '2026-03-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-03-15' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-05-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-06-02' })

    // Now C's previousIntervals = [{3/15, 5/8}], active = [6/2, null].
    // Recompute April — C should be active full April (inside the archived range).
    await sqlite.prepare('DELETE FROM billing_records WHERE subscription_id = ?').run(sub.id)
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 4,
      eventId: `span-apr:sub${sub.id}`, today: '2026-06-02', rates: { USD_USD: 1 },
    })
    const aprBills = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ? AND billing_date LIKE '2026-04-%'`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const aprSum = (uid: number) =>
      aprBills.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    // April: A,C both 30 days, fair = 1500 each
    expect(aprSum(A)).toBeGreaterThanOrEqual(1498)
    expect(aprSum(A)).toBeLessThanOrEqual(1502)
    expect(aprSum(C)).toBeGreaterThanOrEqual(1498)
    expect(aprSum(C)).toBeLessThanOrEqual(1502)

    // Recompute May — C active 5/1–5/8 (8 days), then absent.
    // dailyCost = 3000/31 ≈ 96.77¢
    // Days 1-8 (8): A,C → C: 8×96.77/2 ≈ 387.10
    // Days 9-31 (23): A solo → C: 0
    // fair_C = 8×3000/31/2 = 12000/31 ≈ 387¢
    // fair_A = 8×3000/31/2 + 23×3000/31 = 12000/31 + 69000/31 = 81000/31 ≈ 2613¢
    await recomputeMonth(db, {
      subscriptionId: sub.id, year: 2026, month: 5,
      eventId: `span-may:sub${sub.id}`, today: '2026-06-02', rates: { USD_USD: 1 },
    })
    const mayBills = (await sqlite
      .prepare(`SELECT user_id as "userId", amount FROM billing_records WHERE subscription_id = ? AND billing_date LIKE '2026-05-%'`)
      .all(sub.id)) as Array<{ userId: number; amount: number }>
    const maySum = (uid: number) =>
      mayBills.filter((r) => r.userId === uid).reduce((s, r) => s + r.amount, 0)
    expect(maySum(C)).toBeGreaterThanOrEqual(385)
    expect(maySum(C)).toBeLessThanOrEqual(389)
    expect(maySum(A)).toBeGreaterThanOrEqual(2611)
    expect(maySum(A)).toBeLessThanOrEqual(2615)
    expect(maySum(A) + maySum(C)).toBe(3000)
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
