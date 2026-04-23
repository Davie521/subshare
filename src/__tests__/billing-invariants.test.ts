/**
 * Correctness probes for the billing algorithm — invariants that should hold
 * across the full set of operations (R1 cron, R2 join, R3 leave, R4 recompute,
 * R5 price change). These complement the existing scenario tests by asserting
 * end-to-end properties, not just single-step behavior.
 *
 * Each probe documents what the spec says and either asserts the invariant
 * OR pins the current (possibly spec-divergent) behavior with a comment so
 * future regressions are visible.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  createSubscription,
  markBillPaid,
} from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import { changeSubscriptionPrice } from '@/lib/billing-ops'
import { generateMonthlyBills } from '@/lib/cron-billing'
import { calculateShares } from '@/lib/billing'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

interface BillRow {
  id: number
  userId: number
  amount: number
  currency: string
  billingDate: string
  isPaid: boolean
  exchangeRate: number
  localAmount: number
}

async function billsForSub(subId: number): Promise<BillRow[]> {
  return (await sqlite
    .prepare(
      `SELECT id, user_id as "userId", amount, currency,
              billing_date as "billingDate", is_paid as "isPaid",
              exchange_rate as "exchangeRate", local_amount as "localAmount"
       FROM billing_records WHERE subscription_id = ?
       ORDER BY billing_date, user_id`
    )
    .all(subId)) as BillRow[]
}

describe('Billing invariants', () => {
  /**
   * Conservation: on any R1 cycle with n members and price P, the bills
   * generated for non-payers sum to exactly (n-1) * floor(P/n). The payer
   * implicitly covers P - (n-1)*floor(P/n) — the floor remainder.
   */
  it('R1 conservation — Σ(non-payer amounts) = (n-1) × floor(price/n)', async () => {
    const price = 10000 // ¥100, indivisible by 3
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Indivisible',
      price,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-01',
    })

    await generateMonthlyBills(db, '2026-05')

    const r1 = (await billsForSub(sub.id)).filter(
      (x) => x.billingDate === '2026-05-01'
    )
    const n = 3
    const share = calculateShares(price, n)
    const sum = r1.reduce((acc, row) => acc + row.amount, 0)

    expect(r1).toHaveLength(n - 1)
    expect(sum).toBe((n - 1) * share)
    // Payer absorbs the remainder (P - (n-1)*share), here 10000 - 2*3333 = 3334.
    expect(price - sum).toBe(3334)
  })

  /**
   * Year-boundary cron: Dec → Jan must generate correct bills. Off-by-one
   * in month arithmetic would silently produce wrong day-counts.
   */
  it('R1 year-boundary — Dec cron then Jan cron produce correct share', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Yearly',
      price: 6000,
      currency: 'CNY',
      nextPayment: '2027-02-01',
      startDate: '2026-11-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-11-01',
    })

    await generateMonthlyBills(db, '2026-12')
    await generateMonthlyBills(db, '2027-01')

    const rows = await billsForSub(sub.id)
    const dates = rows.map((x) => x.billingDate).sort()
    expect(dates).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
    for (const row of rows) {
      expect(row.userId).toBe(b)
      expect(row.amount).toBe(3000) // floor(6000/2)
    }
  })

  /**
   * Paid-bill immutability: once is_paid=true, no subsequent operation
   * (R5 price change, R4 add/leave, R3 leave) may alter amount, localAmount,
   * or exchangeRate. Integrity anchor for settlement.
   */
  it('paid bills are immutable under every follow-up operation', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
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
      addedAt: '2026-03-01',
    })

    await generateMonthlyBills(db, '2026-03')
    const [bBill] = await billsForSub(sub.id)
    await markBillPaid(db, bBill.id)
    const frozen = { ...bBill }

    // R5 price change — paid bill must not move.
    await changeSubscriptionPrice(db, {
      subscriptionId: sub.id,
      newPrice: 30000,
    })
    // R4 add — new member join.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-20',
    })
    // R3 leave — C leaves.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: '2026-04-30',
      actorId: a,
    })

    const after = (await sqlite
      .prepare('SELECT * FROM billing_records WHERE id = ?')
      .get(bBill.id)) as {
      amount: number
      local_amount: number
      exchange_rate: number
      is_paid: boolean
    }
    expect(after.amount).toBe(frozen.amount)
    expect(after.local_amount).toBe(frozen.localAmount)
    expect(after.exchange_rate).toBe(frozen.exchangeRate)
    expect(after.is_paid).toBe(true)
  })

  /**
   * R5 × R4 interaction probe (audit #3).
   * When a member leaves mid-month and then the payer changes the price,
   * changeSubscriptionPrice uses today's member count (post-leave) to
   * recompute the existing R1 bill — pins this behavior.
   */
  it('R5 × R4 — price change after a mid-month leave uses today.n, not bill-time.n', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Spotify',
      price: 15000, // ¥150; share(3) = 5000
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-01',
    })

    const today = new Date().toISOString().slice(0, 10)
    const yearMonth = today.slice(0, 7)
    await generateMonthlyBills(db, yearMonth)

    // Precondition: B and C each owe 5000 (n=3 at billing time).
    const before = (await billsForSub(sub.id)).filter(
      (x) => x.billingDate === `${yearMonth}-01`
    )
    expect(before).toHaveLength(2)
    for (const row of before) expect(row.amount).toBe(5000)

    // C leaves today (kick). Their R1 bill is prorated by leave math.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: today,
      actorId: a,
    })

    // Compute what C's bill SHOULD be after the leave-prorate:
    // coverage = daysInMonth, usage = todayDay - 1.
    const [ty, tm, tdRaw] = today.split('-').map(Number)
    const todayDay = tdRaw
    const daysInMonth = new Date(ty, tm, 0).getDate()
    const usageDays = todayDay - 1
    const proratedC =
      todayDay >= daysInMonth
        ? 5000 // last-day leave → full month
        : usageDays <= 0
        ? 0
        : Math.floor((5000 * usageDays) / daysInMonth)

    // Price raised to 18000. Pins that B's bill is re-priced to 9000
    // (today.n=2) rather than 6000 (bill-time n=3). C already left, so
    // changeSubscriptionPrice must NOT touch C's (already-prorated) bill.
    await changeSubscriptionPrice(db, {
      subscriptionId: sub.id,
      newPrice: 18000,
    })

    const after = (await billsForSub(sub.id)).filter(
      (x) => x.billingDate === `${yearMonth}-01`
    )
    const bAfter = after.find((x) => x.userId === b)!
    expect(bAfter.amount).toBe(9000)

    if (proratedC === 0) {
      // C's bill was deleted on leave; changeSubscriptionPrice can't
      // resurrect it.
      expect(after.find((x) => x.userId === c)).toBeUndefined()
    } else {
      const cAfter = after.find((x) => x.userId === c)
      expect(cAfter?.amount).toBe(proratedC)
    }
  })

  /**
   * Pro-rata upper bound: for any join day d in month M, the pro-rata bill
   * must be ≤ share(n). Equality only when d = 1. Catches sign errors or
   * off-by-one in days-covered math.
   */
  it('R2 pro-rata bounds hold on critical join days across 28/29/30/31-day months', { timeout: 120000 }, async () => {
    const cases: Array<{ month: string; D: number; day: number }> = [
      { month: '2023-02', D: 28, day: 1 },
      { month: '2023-02', D: 28, day: 14 },
      { month: '2023-02', D: 28, day: 28 },
      { month: '2024-02', D: 29, day: 1 },
      { month: '2024-02', D: 29, day: 15 },
      { month: '2024-02', D: 29, day: 29 },
      { month: '2026-04', D: 30, day: 1 },
      { month: '2026-04', D: 30, day: 15 },
      { month: '2026-04', D: 30, day: 30 },
      { month: '2026-05', D: 31, day: 1 },
      { month: '2026-05', D: 31, day: 16 },
      { month: '2026-05', D: 31, day: 31 },
    ]
    for (const { month, D, day } of cases) {
      const { db: freshDb, sqlite: freshSqlite } = await setupTestDb()
      const payer = await createUser(freshDb, {
        email: `p${month}-${day}@t.com`,
      })
      const joiner = await createUser(freshDb, {
        email: `j${month}-${day}@t.com`,
      })
      const sub = await createSubscription(freshDb, {
        name: `Sub-${month}-${day}`,
        price: 10000,
        currency: 'CNY',
        nextPayment: '2099-01-01',
        startDate: `${month}-01`,
        ownerId: payer,
      })
      await addMemberToSubscription(freshDb, {
        subscriptionId: sub.id,
        userId: joiner,
        addedBy: payer,
        addedAt: `${month}-${String(day).padStart(2, '0')}`,
      })
      const [bill] = (await freshSqlite
        .prepare(
          'SELECT amount, billing_date as "billingDate" FROM billing_records WHERE subscription_id = ?'
        )
        .all(sub.id)) as Array<{ amount: number; billingDate: string }>
      const share = calculateShares(10000, 2)
      const expected = Math.floor((share * (D - day + 1)) / D)
      expect(bill.billingDate).toBe(
        `${month}-${String(day).padStart(2, '0')}`
      )
      expect(bill.amount).toBe(expected)
      expect(bill.amount).toBeGreaterThanOrEqual(0)
      expect(bill.amount).toBeLessThanOrEqual(share)
      if (day === 1) expect(bill.amount).toBe(share)
    }
  })
})

describe('P1 gap tests — invariants', () => {
  it('P1 RED: R3 redistribute conservation — Σ(all May bills) equals Σ(share) − leaver\'s refund', async () => {
    // 4-member sub, redistribute policy. After B leaves mid-month:
    //   Σ(non-payer bills) = (n-1) × share (unchanged) − (B's full share − B's prorated amount) + diff_distributed
    // Which simplifies to:
    //   Σ = original_total − (B's new amount deficit) + (diff absorbed by others)
    //   When refund_policy=redistribute and others absorb all diff, the total
    //   paid BY non-payers is:
    //     (n-1) × share  −  (B's original share − B's prorated)
    //     + diff_paid_by_others  (= same value, sum adds to unchanged total)
    // i.e. non-payers' total stays = (n-1) × share INCLUDING any remainder
    // split to others.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const D = await createUser(db, { email: 'd@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1200,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
      refundPolicy: 'redistribute',
    })
    const addSubMember = async (uid: number) => {
      await sqlite
        .prepare(
          `INSERT INTO subscription_members (subscription_id, user_id, added_at, added_by)
           VALUES (?, ?, '2026-04-01', ?)`
        )
        .run(sub.id, uid, A)
    }
    await addSubMember(B)
    await addSubMember(C)
    await addSubMember(D)
    await generateMonthlyBills(db, '2026-05')

    const n = 4
    const share = calculateShares(1200, n) // 300
    const originalTotal = share * (n - 1) // 900 across B/C/D

    const totalBefore = (await sqlite
      .prepare('SELECT SUM(amount) AS s FROM billing_records WHERE subscription_id = ?')
      .get(sub.id)) as { s: number }
    expect(totalBefore.s).toBe(originalTotal)

    // B leaves — prorated + redistribute.
    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-11' })

    const totalAfter = (await sqlite
      .prepare('SELECT SUM(amount) AS s FROM billing_records WHERE subscription_id = ?')
      .get(sub.id)) as { s: number }
    // Invariant: under redistribute, Σ stays == originalTotal (diff moves around
    // but doesn't leave the pool; payer's implicit contribution unchanged).
    expect(totalAfter.s).toBe(originalTotal)
  })

  it('P1 RED: R3 redistribute under payer_absorbs — Σ shrinks by diff; payer absorbs the reduction', async () => {
    // Same setup but refund_policy=payer_absorbs. B's prorate reduces B's bill;
    // nothing compensates C/D, so non-payer total shrinks by (share − B's new amount).
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const D = await createUser(db, { email: 'd@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1200,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
      refundPolicy: 'payer_absorbs',
    })
    for (const uid of [B, C, D]) {
      await sqlite
        .prepare(
          `INSERT INTO subscription_members (subscription_id, user_id, added_at, added_by)
           VALUES (?, ?, '2026-04-01', ?)`
        )
        .run(sub.id, uid, A)
    }
    await generateMonthlyBills(db, '2026-05')

    const share = calculateShares(1200, 4) // 300
    const originalTotal = share * 3 // 900

    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-11' })

    // B's new amount = floor(300 * 10/31) = 96; diff = 204 absorbed by payer.
    const bAfter = (await sqlite
      .prepare('SELECT amount FROM billing_records WHERE user_id = ?')
      .get(B)) as { amount: number }
    expect(bAfter.amount).toBe(96)

    const totalAfter = (await sqlite
      .prepare('SELECT SUM(amount) AS s FROM billing_records WHERE subscription_id = ?')
      .get(sub.id)) as { s: number }
    // Payer absorbs → non-payer total shrinks.
    expect(totalAfter.s).toBe(originalTotal - (share - 96))
    // C and D untouched.
    const cd = (await sqlite
      .prepare('SELECT SUM(amount) AS s FROM billing_records WHERE user_id IN (?, ?)')
      .get(C, D)) as { s: number }
    expect(cd.s).toBe(share * 2)
  })

  it('P2 RED: concurrent addMember calls on same sub serialize via lockSubscription', async () => {
    // PGlite is single-threaded so this is a smoke test — with FOR UPDATE
    // on the sub row, two overlapping adds complete without data corruption
    // and final memberCount = 3.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 9900,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
    })

    // Fire both adds "concurrently" — Promise.all awaits both.
    await Promise.all([
      addMemberToSubscription(db, {
        subscriptionId: sub.id,
        userId: B,
        addedBy: A,
        addedAt: '2026-05-10',
      }),
      addMemberToSubscription(db, {
        subscriptionId: sub.id,
        userId: C,
        addedBy: A,
        addedAt: '2026-05-10',
      }),
    ])

    const members = (await sqlite
      .prepare('SELECT COUNT(*) AS n FROM subscription_members WHERE subscription_id = ? AND left_at IS NULL')
      .get(sub.id)) as { n: number }
    expect(members.n).toBe(3)
  })

  it('P1 RED: rejoin invariant — two stints\' totals ≤ full-month share', async () => {
    // B joins 5/5, leaves 5/12, rejoins 5/20. Two separate R2 bills result.
    // Total billed to B for May ≤ share (what B would pay for a full month).
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 620,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
    })

    // Stint 1: join 5/5 → leave 5/12.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: B,
      addedBy: A,
      addedAt: '2026-05-05',
    })
    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-12' })

    // Stint 2: rejoin 5/20. Creates a fresh R2 bill on 2026-05-20.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: B,
      addedBy: A,
      addedAt: '2026-05-20',
    })

    const bills = (await sqlite
      .prepare('SELECT amount, billing_date FROM billing_records WHERE user_id = ?')
      .all(B)) as Array<{ amount: number; billing_date: string }>

    const totalPaid = bills.reduce((s, b) => s + b.amount, 0)
    const fullMonthShare = calculateShares(620, 2)
    // Invariant: two prorated stints must not exceed a full-month bill —
    // users shouldn't be punished for a leave+rejoin cycle.
    expect(totalPaid).toBeLessThanOrEqual(fullMonthShare)
  })
})
