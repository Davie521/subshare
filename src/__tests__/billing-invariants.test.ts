/**
 * Correctness probes for the billing algorithm — invariants that should hold
 * across the full set of operations (R1 cron, R2 join, R3 leave, R4 recompute,
 * R5 price change, transfer payer). These complement the existing scenario
 * tests by asserting end-to-end properties, not just single-step behavior.
 *
 * Each probe documents what the spec says and either asserts the invariant
 * OR pins the current (possibly spec-divergent) behavior with a comment so
 * future regressions are visible.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  leaveSubscription,
  transferPayer,
  changeSubscriptionPrice,
  generateMonthlyBills,
  markBillPaid,
} from '@/lib/db-operations'
import { calculateShares } from '@/lib/billing'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

interface BillRow {
  id: number
  userId: number
  amount: number
  currency: string
  billingDate: string
  isPaid: number
  exchangeRate: number
  localAmount: number
}

function billsForSub(subId: number): BillRow[] {
  return sqlite
    .prepare(
      `SELECT id, user_id as userId, amount, currency,
              billing_date as billingDate, is_paid as isPaid,
              exchange_rate as exchangeRate, local_amount as localAmount
       FROM billing_records WHERE subscription_id = ?
       ORDER BY billing_date, user_id`
    )
    .all(subId) as BillRow[]
}

describe('Billing invariants', () => {
  /**
   * Conservation: on any R1 cycle with n members and price P, the bills
   * generated for non-payers sum to exactly (n-1) * floor(P/n). The payer
   * implicitly covers P - (n-1)*floor(P/n) — the floor remainder.
   *
   * This catches any drift where share calculation, member-count logic, or
   * bill insertion diverges from the authoritative formula.
   */
  it('R1 conservation — Σ(non-payer amounts) = (n-1) × floor(price/n)', () => {
    // Indivisible price forces non-zero remainder absorbed by payer.
    const price = 10000 // ¥100
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Indivisible',
      price,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-01',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-01',
    })

    generateMonthlyBills(db, '2026-05')

    const r1 = billsForSub(sub.id).filter((x) => x.billingDate === '2026-05-01')
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
   * in month arithmetic (e.g. month=12 passed to `new Date(y, 12, 0)`) would
   * silently produce wrong day-counts.
   */
  it('R1 year-boundary — Dec cron then Jan cron produce correct share', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Yearly',
      price: 6000,
      currency: 'CNY',
      nextPayment: '2027-02-01',
      startDate: '2026-11-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-11-01',
    })

    generateMonthlyBills(db, '2026-12')
    generateMonthlyBills(db, '2027-01')

    // R2 generates a full-share bill on the join day (day 1 of 30-day Nov
    // → share × 30/30 = share). Then Dec and Jan crons each add one.
    const dates = billsForSub(sub.id)
      .map((x) => x.billingDate)
      .sort()
    expect(dates).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
    for (const row of billsForSub(sub.id)) {
      expect(row.userId).toBe(b)
      expect(row.amount).toBe(3000) // floor(6000/2)
    }
  })

  /**
   * Paid-bill immutability: once is_paid=1, no subsequent operation
   * (R5 price change, R4 add/leave, R3 leave, transfer payer) may alter
   * amount, localAmount, or exchangeRate. This is the integrity anchor
   * for settlement history.
   */
  it('paid bills are immutable under every follow-up operation', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-01',
    })

    // Freeze today at a mid-month date so R5's "current month" is consistent.
    // (changeSubscriptionPrice reads `new Date()`; we choose prices + dates so
    // the assertion holds regardless of the runner's actual date.)
    generateMonthlyBills(db, '2026-03')
    const [bBill] = billsForSub(sub.id)
    markBillPaid(db, bBill.id)
    const frozen = { ...bBill }

    // R5 price change — paid bill must not move.
    changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 30000 })
    // R4 add — new member join.
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-20',
    })
    // R3 leave — C leaves.
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: '2026-04-30',
      actorId: a,
    })
    // Transfer payer — move payer to B.
    transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const after = sqlite
      .prepare('SELECT * FROM billing_records WHERE id = ?')
      .get(bBill.id) as {
      amount: number
      local_amount: number
      exchange_rate: number
      is_paid: number
    }
    expect(after.amount).toBe(frozen.amount)
    expect(after.local_amount).toBe(frozen.localAmount)
    expect(after.exchange_rate).toBe(frozen.exchangeRate)
    expect(after.is_paid).toBe(1)
  })

  /**
   * R5 x R4 interaction probe (audit #3).
   * When a member leaves mid-month and then the payer changes the price,
   * `changeSubscriptionPrice` uses *today's* member count (post-leave) to
   * recompute the existing R1 bill. This may diverge from the spec's stated
   * R4 rule ("share(n) changes for future billings only").
   *
   * This test PINS the current behavior so any future change to the rule
   * shows up in the diff. It is NOT an endorsement of the behavior.
   */
  it('R5 × R4 — price change after a mid-month leave uses today.n, not bill-time.n', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Spotify',
      price: 15000, // ¥150; share(3) = 5000
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-03-01',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-01',
    })

    // Use the current calendar month as the R1 month so changeSubscriptionPrice
    // (which reads today()) selects these bills as "current month".
    const today = new Date().toISOString().slice(0, 10)
    const yearMonth = today.slice(0, 7)
    generateMonthlyBills(db, yearMonth)

    // Precondition: B and C each owe 5000 (n=3 at billing time).
    const before = billsForSub(sub.id).filter(
      (x) => x.billingDate === `${yearMonth}-01`
    )
    expect(before).toHaveLength(2)
    for (const row of before) expect(row.amount).toBe(5000)

    // C leaves today (kick bypasses min-cycle). Now today.n = 2.
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      leftAt: today,
      actorId: a,
    })

    // Price raised to 18000. Spec R4 says shares only change for future
    // cycles, but R5's code path computes newShare = floor(18000 / today.n=2)
    // = 9000 and rewrites B's unpaid R1 bill to 9000. This PINS that.
    changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 18000 })

    const after = billsForSub(sub.id).filter(
      (x) => x.billingDate === `${yearMonth}-01`
    )
    const bAfter = after.find((x) => x.userId === b)!
    // Spec-ambiguous (audit #3): if policy becomes "preserve bill-time n"
    // the expected amount would be floor(18000/3) = 6000.
    expect(bAfter.amount).toBe(9000)

    // Audit #12 fix: C already left today, so their unpaid bill is NOT
    // re-priced. Bill stays at the original floor(15000/3) = 5000.
    const cAfter = after.find((x) => x.userId === c)
    expect(cAfter?.amount).toBe(5000)
  })

  /**
   * Transfer-payer mid-month: existing unpaid R1 bill's counterparty
   * (subscriptions.payer_id used by settlement.ts) flips from old to new
   * payer, so the old payer no longer collects on those bills via the
   * settlement view. This is the R9/R10 netting consequence of transferPayer
   * not rewriting historical bills. Pins the behavior explicitly.
   */
  it('transferPayer redirects old unpaid bills to the new payer via settlement join', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Hulu',
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
      addedAt: '2026-03-01',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-03-01',
    })

    generateMonthlyBills(db, '2026-04')

    // Settlement from C's view BEFORE transfer: C owes A.
    const beforeCounterparty = sqlite
      .prepare(
        `SELECT s.payer_id as payerId FROM billing_records br
         JOIN subscriptions s ON s.id = br.subscription_id
         WHERE br.user_id = ? AND br.subscription_id = ? AND is_paid = 0`
      )
      .all(c, sub.id) as Array<{ payerId: number }>
    expect(beforeCounterparty.every((r) => r.payerId === a)).toBe(true)

    // Transfer payer A → B.
    transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    // After transfer, the very same billing rows now report B as payer.
    // Note: this means C's historical April debt is now owed to B in the
    // settlement view — the money that actually flowed was A→service for
    // April. This is an R9/R10 consequence worth flagging to product.
    const afterCounterparty = sqlite
      .prepare(
        `SELECT s.payer_id as payerId FROM billing_records br
         JOIN subscriptions s ON s.id = br.subscription_id
         WHERE br.user_id = ? AND br.subscription_id = ? AND is_paid = 0`
      )
      .all(c, sub.id) as Array<{ payerId: number }>
    expect(afterCounterparty.every((r) => r.payerId === b)).toBe(true)
  })

  /**
   * Pro-rata upper bound: for any join day d in month M, the pro-rata bill
   * must be ≤ share(n). Equality only when d = 1. This catches sign errors
   * or off-by-one in days-covered math.
   */
  it('R2 pro-rata bounds hold on critical join days across 28/29/30/31-day months', () => {
    // Sample boundary days (1, mid, last) for each month length, rather than
    // every day — keeps the probe fast while still catching off-by-one in
    // `calculateJoinProRata`'s `(D − day + 1)` math.
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
      const { db: freshDb, sqlite: freshSqlite } = setupTestDb()
      const payer = createUser(freshSqlite, { email: `p${month}-${day}@t.com` })
      const joiner = createUser(freshSqlite, {
        email: `j${month}-${day}@t.com`,
      })
      const sub = createSubscription(freshDb, {
        name: `Sub-${month}-${day}`,
        price: 10000,
        currency: 'CNY',
        nextPayment: '2099-01-01',
        startDate: `${month}-01`,
        ownerId: payer,
      })
      addMemberToSubscription(freshDb, {
        subscriptionId: sub.id,
        userId: joiner,
        addedBy: payer,
        addedAt: `${month}-${String(day).padStart(2, '0')}`,
      })
      const [bill] = freshSqlite
        .prepare(
          'SELECT amount, billing_date as billingDate FROM billing_records WHERE subscription_id = ?'
        )
        .all(sub.id) as Array<{ amount: number; billingDate: string }>
      const share = calculateShares(10000, 2)
      const expected = Math.floor((share * (D - day + 1)) / D)
      expect(bill.billingDate).toBe(`${month}-${String(day).padStart(2, '0')}`)
      expect(bill.amount).toBe(expected)
      expect(bill.amount).toBeGreaterThanOrEqual(0)
      expect(bill.amount).toBeLessThanOrEqual(share)
      if (day === 1) expect(bill.amount).toBe(share)
    }
  })
})
