import { describe, it, expect, beforeEach } from 'vitest'
import {
  setupTestDb,
  createUser,
  addSubMember,
  type SqliteShim,
  type TestDb,
} from './helpers'
import {
  createSubscription,
  addMemberToSubscription,
  leaveSubscription,
  generateMonthlyBills,
} from '@/lib/db-operations'
import { handleDeleteSubscription } from '@/lib/api-handlers'

/**
 * Phase 0 RED tests — mid-cycle leave / kick / delete bill rewrite.
 *
 * New rules:
 *   usage_days = leftAt_day - cycleStart              // leave day NOT counted
 *     cycleStart = 1                (R1 member)
 *     cycleStart = joinDate_day     (R2 member, same month as leftAt)
 *   if leftAt_day >= daysInMonth → usage_days = daysInMonth  (full month)
 *   if usage_days <= 0 → delete the bill
 *   new_amount = floor(share × usage_days / daysInMonth)
 *   new_localAmount = floor(localAmount × usage_days / daysInMonth)
 *
 * refund_policy (set at sub creation):
 *   'payer_absorbs' — payer takes the loss; other members unchanged.
 *   'redistribute'  — diff is split across OTHER unpaid non-payer members;
 *                     if no such member, degenerates to 'payer_absorbs'.
 */

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

type BillRow = {
  id: number
  subscriptionId: number
  userId: number
  amount: number
  localAmount: number
  currency: string
  localCurrency: string
  billingDate: string
  isPaid: boolean
}

async function allBills(subId?: number): Promise<BillRow[]> {
  const sql = subId
    ? `SELECT id, subscription_id as "subscriptionId", user_id as "userId",
              amount, local_amount as "localAmount", currency,
              local_currency as "localCurrency", billing_date as "billingDate",
              is_paid as "isPaid"
       FROM billing_records WHERE subscription_id = ?
       ORDER BY billing_date, user_id`
    : `SELECT id, subscription_id as "subscriptionId", user_id as "userId",
              amount, local_amount as "localAmount", currency,
              local_currency as "localCurrency", billing_date as "billingDate",
              is_paid as "isPaid"
       FROM billing_records ORDER BY billing_date, user_id`
  return (await sqlite.prepare(sql).all(...(subId ? [subId] : []))) as BillRow[]
}

async function billFor(
  subId: number,
  userId: number,
  billingDate: string
): Promise<BillRow | undefined> {
  const rows = await allBills(subId)
  return rows.find((b) => b.userId === userId && b.billingDate === billingDate)
}

async function markPaid(billId: number): Promise<void> {
  await sqlite
    .prepare(`UPDATE billing_records SET is_paid = TRUE WHERE id = ?`)
    .run(billId)
}

async function memberRow(
  subId: number,
  userId: number
): Promise<{ addedAt: string; leftAt: string | null } | undefined> {
  const rows = (await sqlite
    .prepare(
      `SELECT added_at as "addedAt", left_at as "leftAt"
       FROM subscription_members
       WHERE subscription_id = ? AND user_id = ?`
    )
    .all(subId, userId)) as Array<{ addedAt: string; leftAt: string | null }>
  return rows[0]
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Phase 0 RED                                                        */
/* ─────────────────────────────────────────────────────────────────── */

describe('leave mid-month prorates unpaid current-month bill', () => {
  it('T1: R1 member (payer_absorbs) — leftAt=5/16 in 31-day May → bill = floor(share × 15 / 31)', async () => {
    // 3-member Netflix ¥30/mo. A is payer. B, C split ¥10 each on 5/1.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 3000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-04-01',
      ownerId: A,
      refundPolicy: 'payer_absorbs',
    })
    // Add B and C directly (bypass R2) so only R1 cron bills them cleanly.
    await addSubMember(sqlite, sub.id, B, { addedAt: '2026-04-15', addedBy: A })
    await addSubMember(sqlite, sub.id, C, { addedAt: '2026-04-15', addedBy: A })
    // R1 cron runs on 5/1 → each non-payer owes ¥10 = 1000 cents.
    await generateMonthlyBills(db, '2026-05')

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    // share=1000; usage=15; floor(1000*15/31) = 483
    const bBill = await billFor(sub.id, B, '2026-05-01')
    expect(bBill?.amount).toBe(483)
    expect(bBill?.localAmount).toBe(483)
    // C's bill untouched (payer_absorbs)
    const cBill = await billFor(sub.id, C, '2026-05-01')
    expect(cBill?.amount).toBe(1000)
  })

  it('T2: kick (payer removes member) uses the same formula', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    // Payer (A) kicks B on 5/16
    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16', actorId: A,
    })

    const bBill = await billFor(sub.id, B, '2026-05-01')
    // share=1500 (price/2, B is the only non-payer); 1500*15/31 = 725
    expect(bBill?.amount).toBe(725)
  })

  it('T3: R2 joiner — joined 5/10, left 5/20 → bill = floor(share × 10 / 31)', async () => {
    // B joins mid-month (R2) — original bill covers 5/10..5/31 (22 days).
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-10',
    })
    // original R2 bill: share=1500, 1500 * (31-10+1)/31 = 1500*22/31 = 1064
    const before = await billFor(sub.id, B, '2026-05-10')
    expect(before?.amount).toBe(1064)

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-20',
    })

    // usage_days = 20 - 10 = 10; new amount = floor(1500 * 10 / 31) = 483
    const after = await billFor(sub.id, B, '2026-05-10')
    expect(after?.amount).toBe(483)
  })

  it('T4: already-paid bill stays locked — leaver owes the paid amount', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')
    const before = await billFor(sub.id, B, '2026-05-01')
    await markPaid(before!.id)

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    const after = await billFor(sub.id, B, '2026-05-01')
    expect(after?.amount).toBe(1500) // unchanged
    expect(after?.isPaid).toBe(true)
  })

  it('T5: leave on the 1st (after R1 cron) → bill deleted (usage_days = 0)', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')
    expect(await billFor(sub.id, B, '2026-05-01')).toBeDefined()

    // Payer kicks on 5/1 (same day). Self-leave would be idempotent w/ the cron.
    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-01', actorId: A,
    })

    expect(await billFor(sub.id, B, '2026-05-01')).toBeUndefined()
  })

  it('T6: leave on the last day of month → full-month bill (special case)', async () => {
    // leftAt=5/31 in a 31-day month. By the plain formula usage=30/31, but
    // user-specified rule: last-day leave counts as FULL month.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-31',
    })

    const bBill = await billFor(sub.id, B, '2026-05-01')
    expect(bBill?.amount).toBe(1500) // full share
  })
})

describe('refund_policy = redistribute', () => {
  it('T7: diff is spread across other unpaid non-payer members', async () => {
    // 4 members: A (payer), B, C, D. Price 3000 → share 750 each (floor).
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const D = await createUser(db, { email: 'd@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-04-01', ownerId: A,
      refundPolicy: 'redistribute',
    })
    for (const u of [B, C, D]) {
      await addSubMember(sqlite, sub.id, u, { addedAt: '2026-04-15', addedBy: A })
    }
    await generateMonthlyBills(db, '2026-05')
    // share = floor(3000/4) = 750; B/C/D each owe 750.

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    const bBill = await billFor(sub.id, B, '2026-05-01')
    // usage=15; new = floor(750*15/31) = 362
    expect(bBill?.amount).toBe(362)

    // diff = 750 - 362 = 388; split across C and D → +194 each
    const cBill = await billFor(sub.id, C, '2026-05-01')
    const dBill = await billFor(sub.id, D, '2026-05-01')
    expect(cBill!.amount + dBill!.amount).toBe(750 * 2 + 388)
    // Each individual bill increased
    expect(cBill!.amount).toBeGreaterThan(750)
    expect(dBill!.amount).toBeGreaterThan(750)
  })

  it('T8: all others already paid → redistribute degenerates to payer_absorbs', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
      refundPolicy: 'redistribute',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')
    // C has already paid → should NOT be affected by B's leave.
    const cBefore = await billFor(sub.id, C, '2026-05-01')
    await markPaid(cBefore!.id)

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    const cAfter = await billFor(sub.id, C, '2026-05-01')
    expect(cAfter?.amount).toBe(cBefore!.amount)
    expect(cAfter?.isPaid).toBe(true)
  })

  it('T9: B is the sole non-payer → no one to redistribute to; B still prorates', async () => {
    // Only A (payer) + B. B leaves, but there's no C to pick up the diff.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
      refundPolicy: 'redistribute',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    // share=1500; usage=15; new=floor(1500*15/31)=725
    const bBill = await billFor(sub.id, B, '2026-05-01')
    expect(bBill?.amount).toBe(725)
  })
})

describe('delete subscription', () => {
  it('T10: payer delete wipes all billing_records (paid AND unpaid) and the sub itself', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')
    const [bB] = await allBills(sub.id)
    await markPaid(bB.id) // one paid, one unpaid
    expect((await allBills(sub.id)).length).toBe(2)

    const res = await handleDeleteSubscription(db, A, sub.id)
    expect(res.success).toBe(true)

    // All bills gone. Subscription gone (hard delete, no `inactive` leftover).
    expect(await allBills(sub.id)).toHaveLength(0)
    const subRows = (await sqlite
      .prepare(`SELECT id FROM subscriptions WHERE id = ?`)
      .all(sub.id)) as Array<{ id: number }>
    expect(subRows).toHaveLength(0)
  })

  it('T11: recreating a sub with the same name after delete is a fresh entity', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const first = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: first.id, userId: B, addedBy: A, addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')
    await handleDeleteSubscription(db, A, first.id)

    const second = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    expect(second.id).not.toBe(first.id)
    expect(await allBills(second.id)).toHaveLength(0)
    // Only A is a member of the new sub; B didn't carry over.
    const members = (await sqlite
      .prepare(
        `SELECT user_id as "userId" FROM subscription_members WHERE subscription_id = ?`
      )
      .all(second.id)) as Array<{ userId: number }>
    expect(members.map((m) => m.userId)).toEqual([A])
  })
})

describe('leave-rejoin same subscription', () => {
  it('T12: rejoin reuses the existing (sub, user) row; old prorated bill + new R2 bill coexist', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-05',
    })
    // Leave on 5/15
    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-15',
    })
    // Rejoin on 5/25
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-25',
    })

    const row = await memberRow(sub.id, B)
    // Single row, reused: leftAt cleared, addedAt updated to rejoin day.
    expect(row).toBeDefined()
    expect(row!.leftAt).toBeNull()
    expect(row!.addedAt).toBe('2026-05-25')

    // Two independent bills: old stint (prorated) + new stint (R2).
    const bills = (await allBills(sub.id)).filter((b) => b.userId === B)
    expect(bills).toHaveLength(2)
    const oldStint = bills.find((b) => b.billingDate === '2026-05-05')
    const newStint = bills.find((b) => b.billingDate === '2026-05-25')
    expect(oldStint).toBeDefined()
    expect(newStint).toBeDefined()
  })

  it('T12b: leaving again after rejoin must NOT re-prorate the previous stint bill', async () => {
    // Scenario: B joins 5/5, leaves 5/15 (first stint bill locked at 10 days),
    // rejoins 5/25, leaves 5/28. The old 5/05 bill must stay at its locked
    // value; only the new 5/25 bill should be prorated.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-05',
    })

    // First stint: share=1500, coverageDays=27, amount=floor(1500*27/31)=1306.
    const bill1Before = await billFor(sub.id, B, '2026-05-05')
    expect(bill1Before?.amount).toBe(1306)

    // First leave: usageDays=15-5=10, newAmount=floor(1306*10/27)=483.
    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-15',
    })
    const bill1AfterLeave = await billFor(sub.id, B, '2026-05-05')
    expect(bill1AfterLeave?.amount).toBe(483)

    // Rejoin on 5/25: new R2 bill.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-25',
    })
    // Second stint: share=1500, coverageDays=31-25+1=7, amount=floor(1500*7/31)=338.
    const bill2Before = await billFor(sub.id, B, '2026-05-25')
    expect(bill2Before?.amount).toBe(338)

    // Second leave.
    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-28',
    })

    // OLD STINT BILL MUST BE UNCHANGED — it's already locked at 483.
    const bill1Final = await billFor(sub.id, B, '2026-05-05')
    expect(bill1Final?.amount).toBe(483)

    // New stint bill: usageDays=28-25=3, coverageDays=7,
    // newAmount=floor(338*3/7)=144.
    const bill2Final = await billFor(sub.id, B, '2026-05-25')
    expect(bill2Final?.amount).toBe(144)
  })
})

describe('min-commitment rule has been removed', () => {
  it('T13: 5/15 join + 5/16 leave prorates to 1 day (no 6/30 snap)', async () => {
    // Previous rule would push leftAt to 6/30. After the change: leftAt is
    // respected verbatim; bill prorates to usage_days=1.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-15',
    })

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    const row = await memberRow(sub.id, B)
    expect(row!.leftAt).toBe('2026-05-16') // NOT '2026-06-30'

    // R2 bill for join on 5/15: share=1500, 1500*(31-15+1)/31 = 1500*17/31 = 822
    // After leave on 5/16 (usage_days = 16-15 = 1): 1500*1/31 = 48
    const bBill = await billFor(sub.id, B, '2026-05-15')
    expect(bBill?.amount).toBe(48)
  })
})

describe('FX scaling on prorated rewrite', () => {
  it('T14: localAmount shrinks by the same ratio as amount', async () => {
    // B's preferred currency = USD. Netflix in CNY. FX rate != 1 so
    // localAmount differs from amount.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await addMemberToSubscription(
      db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01' },
      { CNY_USD: 0.14 }
    )
    await generateMonthlyBills(db, '2026-05', { CNY_USD: 0.14 })

    const before = await billFor(sub.id, B, '2026-05-01')
    // amount = share = 1500 CNY cents; localAmount = floor(1500 * 0.14) = 210 US cents
    expect(before?.amount).toBe(1500)
    expect(before?.localAmount).toBe(210)

    await leaveSubscription(db, {
      subscriptionId: sub.id, userId: B, leftAt: '2026-05-16',
    })

    const after = await billFor(sub.id, B, '2026-05-01')
    // usage_days=15; amount = floor(1500*15/31) = 725
    // localAmount scales by same ratio: floor(210*15/31) = 101
    expect(after?.amount).toBe(725)
    expect(after?.localAmount).toBe(101)
  })
})
