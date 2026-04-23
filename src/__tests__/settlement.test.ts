import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  createSubscription,
} from '@/lib/db-operations'
import { addMemberToSubscription } from '@/lib/membership'
import { generateMonthlyBills } from '@/lib/cron-billing'
import {
  getSettlementSummary,
  markPairSettled,
} from '@/lib/settlement'

/**
 * T16 — debt netting per (userA, userB, currency) bucket.
 *
 * await getSettlementSummary(userId) returns one row per counterparty per currency,
 * with owedByMe / owedToMe / net / billIds.
 *
 * await markPairSettled(userA, userB, currency) flips is_paid on every unpaid
 * bill between the pair in that currency. Idempotent.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T16 getSettlementSummary', () => {
  it('returns empty when no unpaid bills exist', async () => {
    const a = await createUser(db)
    expect(await getSettlementSummary(db, a)).toEqual([])
  })

  it('reports net when only I owe (one direction)', async () => {
    // A hosts Netflix, B owes A.
    // B joins May 1 (day 1, 31 days) → R2 generates a full-month bill
    // (5000). The May 1 monthly cron sees it exists and is a no-op.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    const summaryB = await getSettlementSummary(db, b)
    expect(summaryB).toHaveLength(1)
    expect(summaryB[0].counterpartyUserId).toBe(a)
    expect(summaryB[0].currency).toBe('CNY')
    expect(summaryB[0].owedByMe).toBe(5000)
    expect(summaryB[0].owedToMe).toBe(0)
    expect(summaryB[0].net).toBe(-5000) // negative = I owe
  })

  it('reports nets to zero when both sides equal', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    // A hosts Netflix → B owes A 5000
    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    // B hosts Spotify → A owes B 5000
    const sub2 = await createSubscription(db, {
      name: 'Spotify',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    const aSum = await getSettlementSummary(db, a)
    expect(aSum).toHaveLength(1)
    expect(aSum[0].net).toBe(0)
  })

  it('nets reciprocal debts in the same currency', async () => {
    // B owes A 6000 for Netflix, A owes B 2000 for Spotify → net A owes B -4000 (i.e. B owes A 4000)
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 12000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    const sub2 = await createSubscription(db, {
      name: 'Spotify',
      price: 4000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    // B's perspective: owes 6000 (Netflix), is owed 2000 (Spotify) → net -4000
    const bSum = await getSettlementSummary(db, b)
    expect(bSum).toHaveLength(1)
    expect(bSum[0].counterpartyUserId).toBe(a)
    expect(bSum[0].owedByMe).toBe(6000)
    expect(bSum[0].owedToMe).toBe(2000)
    expect(bSum[0].net).toBe(-4000)
  })

  it('emits two rows when the pair has debts in different currencies', async () => {
    // A hosts Netflix in CNY (B owes CNY); B hosts Spotify in USD (A owes USD)
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'USD' })
    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: sub1.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-05-01',
      },
      { CNY_USD: 0.14 }
    )
    const sub2 = await createSubscription(db, {
      name: 'Spotify',
      price: 2000,
      currency: 'USD',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: sub2.id,
        userId: a,
        addedBy: b,
        addedAt: '2026-05-01',
      },
      { USD_CNY: 7.2 }
    )
    await generateMonthlyBills(db, '2026-05', { CNY_USD: 0.14, USD_CNY: 7.2 })

    const bSum = await getSettlementSummary(db, b)
    // Two rows: CNY (B owes A) and USD (B collects from A)
    const currencies = bSum.map((r) => r.currency).sort()
    expect(currencies).toEqual(['CNY', 'USD'])
  })
})

describe('T16 markPairSettled', () => {
  async function pair() {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 12000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    const sub2 = await createSubscription(db, {
      name: 'Spotify',
      price: 4000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')
    return { a, b }
  }

  it('flips is_paid=1 on all unpaid bills between the pair in the given currency', async () => {
    const { a, b } = await pair()
    const n = await markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })
    expect(n).toBeGreaterThanOrEqual(2)

    const unpaid = await sqlite.prepare(`SELECT COUNT(*) AS n FROM billing_records WHERE is_paid = false`)
      .get() as { n: number }
    expect(unpaid.n).toBe(0)
  })

  it('is idempotent — second call marks 0 more rows', async () => {
    const { a, b } = await pair()
    await markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })
    const second = await markPairSettled(db, {
      userA: a,
      userB: b,
      currency: 'CNY',
    })
    expect(second).toBe(0)
  })

  it('direction-agnostic: userA/userB order does not matter', async () => {
    const { a, b } = await pair()
    const n = await markPairSettled(db, { userA: b, userB: a, currency: 'CNY' })
    expect(n).toBeGreaterThan(0)
  })

  it('currency scoping — leaves other-currency bills untouched', async () => {
    const { a, b } = await pair()
    // Add a USD bill between A and B manually on a different billing_date.
    await sqlite.prepare(
        `INSERT INTO billing_records
         (subscription_id, user_id, amount, currency, local_amount, local_currency, exchange_rate, billing_date)
         SELECT id, ?, 500, 'USD', 500, 'USD', 1000000, '2026-06-01'
         FROM subscriptions LIMIT 1`
      )
      .run(b)

    await markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })

    const unpaidUsd = await sqlite.prepare(
        `SELECT COUNT(*) AS n FROM billing_records WHERE is_paid = false AND currency = 'USD'`
      )
      .get() as { n: number }
    expect(unpaidUsd.n).toBe(1) // USD bill remains unpaid
  })

  it('does not touch bills involving a third party', async () => {
    const { a, b } = await pair()
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const sub3 = await createSubscription(db, {
      name: 'YT',
      price: 6000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub3.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-05-01', // day 1 of May → one full-month R2 bill, no R1 dup
    })

    await markPairSettled(db, { userA: a, userB: b, currency: 'CNY' })

    // C's one unpaid bill to A should remain unpaid.
    const cUnpaid = await sqlite.prepare(
        `SELECT COUNT(*) AS n FROM billing_records WHERE is_paid = false AND user_id = ?`
      )
      .get(c) as { n: number }
    expect(cUnpaid.n).toBe(1)
  })
})

async function pairSetup() {
  const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
  const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
  const sub1 = await createSubscription(db, {
    name: 'Netflix',
    price: 12000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: a,
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub1.id,
    userId: b,
    addedBy: a,
    addedAt: '2026-05-01',
  })
  const sub2 = await createSubscription(db, {
    name: 'Spotify',
    price: 4000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: b,
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub2.id,
    userId: a,
    addedBy: b,
    addedAt: '2026-05-01',
  })
  await generateMonthlyBills(db, '2026-05')
  return { a, b }
}

describe('T16 settlement edge cases — multi-sub / three-way / history', () => {
  it('nets the same pair across multiple subs (A owns two subs, B joins both)', async () => {
    // A hosts Netflix AND YouTube; B is in both. Expected: one row,
    // owedByMe = share(Netflix) + share(YouTube).
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const netflix = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: netflix.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })

    const yt = await createSubscription(db, {
      name: 'YouTube',
      price: 4000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: yt.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })

    await generateMonthlyBills(db, '2026-05')

    const bSum = await getSettlementSummary(db, b)
    expect(bSum).toHaveLength(1)
    expect(bSum[0].counterpartyUserId).toBe(a)
    expect(bSum[0].owedByMe).toBe(5000 + 2000) // 7000
    expect(bSum[0].owedToMe).toBe(0)
    expect(bSum[0].net).toBe(-7000)
    // Two bills aggregated into one row.
    expect(bSum[0].billIds).toHaveLength(2)
  })

  it('three-way: viewer only sees direct counterparties, never indirect', async () => {
    // A pays sub1 (B, C members). B pays sub2 (A, C members).
    // From A's view: sees B (bidirectional) and C (A collects only).
    // C's debts to B should NOT appear in A's summary.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })

    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 9000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-05-01',
    })

    const sub2 = await createSubscription(db, {
      name: 'Spotify',
      price: 6000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-05-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: c,
      addedBy: b,
      addedAt: '2026-05-01',
    })

    await generateMonthlyBills(db, '2026-05')

    const aSum = await getSettlementSummary(db, a)
    const byParty = new Map(aSum.map((r) => [r.counterpartyUserId, r]))

    // R4: share is fixed at the time each member joined, not retroactively
    // rebalanced when someone else joins later.
    //   sub1 (9000, A payer): B joined first (members=2 → share 4500),
    //                         C joined second (members=3 → share 3000).
    //   sub2 (6000, B payer): A joined first (share 3000),
    //                         C joined second (share 2000).
    //
    // A's settlement view:
    //   A ↔ B: owedToMe = 4500 (B's sub1 bill), owedByMe = 3000 (A's sub2 bill) → net +1500
    //   A ↔ C: owedToMe = 3000 (C's sub1 bill), owedByMe = 0                    → net +3000
    //   C-owes-B (on sub2) must NOT appear in A's summary.
    expect(byParty.get(b)?.owedToMe).toBe(4500)
    expect(byParty.get(b)?.owedByMe).toBe(3000)
    expect(byParty.get(b)?.net).toBe(1500)

    expect(byParty.get(c)?.owedToMe).toBe(3000)
    expect(byParty.get(c)?.owedByMe).toBe(0)
    expect(byParty.get(c)?.net).toBe(3000)

    // A's summary must not contain B-C-only debts; exactly 2 rows total.
    expect(aSum).toHaveLength(2)
  })

  it('markPairSettled preserves already-paid history (does not re-touch paidAt)', async () => {
    const { a, b } = await pairSetup()

    // First pass: mark a's outgoing bill paid with a specific paidAt.
    await sqlite.prepare(
      `UPDATE billing_records SET is_paid = true, paid_at = '2026-05-10T00:00:00Z'
       WHERE user_id = ?`
    ).run(a)

    const before = await sqlite.prepare(
      `SELECT paid_at FROM billing_records WHERE user_id = ?`
    ).get(a) as { paid_at: string }
    expect(before.paid_at).toBe('2026-05-10T00:00:00Z')

    // Settle the pair — only the remaining unpaid direction should flip.
    const flipped = await markPairSettled(db, {
      userA: a,
      userB: b,
      currency: 'CNY',
    })
    expect(flipped).toBe(1) // only B's outgoing bill remained unpaid

    // A's old paid_at must be preserved (not overwritten).
    const after = await sqlite.prepare(
      `SELECT paid_at FROM billing_records WHERE user_id = ?`
    ).get(a) as { paid_at: string }
    expect(after.paid_at).toBe('2026-05-10T00:00:00Z')
  })

  it('settlement summary excludes already-paid bills (only unpaid counts)', async () => {
    const { a, b } = await pairSetup()

    // Mark half of the unpaid bills as paid.
    await sqlite.prepare(
      `UPDATE billing_records SET is_paid = true, paid_at = '2026-05-10T00:00:00Z'
       WHERE user_id = ?`
    ).run(a)

    // Summary should now reflect only the remaining unpaid direction.
    const bSum = await getSettlementSummary(db, b)
    expect(bSum).toHaveLength(1)
    expect(bSum[0].owedByMe).toBe(6000)  // B still owes A on sub1
    expect(bSum[0].owedToMe).toBe(0)      // A's 2000 already paid off — not counted
    expect(bSum[0].net).toBe(-6000)
  })

  it('mutual subs in different currencies do NOT net across currencies (R10)', async () => {
    // A hosts CNY sub (B owes 5000 CNY). B hosts USD sub (A owes 1000 USD).
    // Summary must be two rows; no implicit FX conversion.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'USD' })

    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: sub1.id,
        userId: b,
        addedBy: a,
        addedAt: '2026-05-01',
      },
      { CNY_USD: 0.14 }
    )

    const sub2 = await createSubscription(db, {
      name: 'Spotify',
      price: 2000,
      currency: 'USD',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: b,
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: sub2.id,
        userId: a,
        addedBy: b,
        addedAt: '2026-05-01',
      },
      { USD_CNY: 7.2 }
    )

    await generateMonthlyBills(db, '2026-05', {
      CNY_USD: 0.14,
      USD_CNY: 7.2,
    })

    const aSum = await getSettlementSummary(db, a)
    expect(aSum).toHaveLength(2)
    const byCurrency = new Map(aSum.map((r) => [r.currency, r]))

    // CNY row: A collects 5000 from B (B's share of sub1).
    expect(byCurrency.get('CNY')?.owedToMe).toBe(5000)
    expect(byCurrency.get('CNY')?.owedByMe).toBe(0)
    expect(byCurrency.get('CNY')?.net).toBe(5000)

    // USD row: A owes 1000 to B (A's share of sub2).
    expect(byCurrency.get('USD')?.owedToMe).toBe(0)
    expect(byCurrency.get('USD')?.owedByMe).toBe(1000)
    expect(byCurrency.get('USD')?.net).toBe(-1000)
  })
})
