import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  setupTestDb,
  createUser,
  addSubMember,
  type SqliteShim,
  type TestDb,
} from './helpers'
import {
  createSubscription,
} from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import { changeSubscriptionPrice } from '@/lib/billing-ops'
import { generateMonthlyBills } from '@/lib/cron-billing'
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
 *   new_localAmount = floor(new_amount × exchange_rate / 1_000_000)
 *     — recomputed from the new amount using the locked rate, NOT prorated
 *     independently; this keeps localAmount consistent with amount.
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

    // All bills gone. Subscription row gone (hard delete).
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

describe('DB-level refund_policy enum guard', () => {
  it('T15: CHECK constraint rejects out-of-band writes of invalid values', async () => {
    // Zod guards the API; this test proves the DB refuses to store
    // 'bogus' even when bypassing the app layer (admin shell, raw SQL).
    const A = await createUser(db, { email: 'a@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix', price: 3000, currency: 'CNY',
      nextPayment: '2026-06-01', startDate: '2026-05-01', ownerId: A,
    })
    await expect(
      sqlite
        .prepare(`UPDATE subscriptions SET refund_policy = 'bogus' WHERE id = ?`)
        .run(sub.id)
    ).rejects.toThrow()
    // Valid values still succeed.
    await sqlite
      .prepare(`UPDATE subscriptions SET refund_policy = 'redistribute' WHERE id = ?`)
      .run(sub.id)
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

  it('P1-1 RED: localAmount recomputed from newAmount × exchangeRate (not independently prorated)', async () => {
    // Pick numbers where the two formulas diverge:
    //   share = 200 CNY cents, rate = 7.123 → localAmount = floor(200*7.123) = 1424
    //   u/c = 10/31.
    //   OLD (independent): newLocalAmount = floor(1424*10/31) = 459
    //   NEW (recompute):   newAmount = floor(200*10/31) = 64;
    //                      newLocalAmount = floor(64 * 7.123) = 455
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 400,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
    })
    await addMemberToSubscription(
      db,
      { subscriptionId: sub.id, userId: B, addedBy: A, addedAt: '2026-05-01' },
      { CNY_USD: 7.123 }
    )
    await generateMonthlyBills(db, '2026-05', { CNY_USD: 7.123 })

    const before = await billFor(sub.id, B, '2026-05-01')
    expect(before?.amount).toBe(200)
    expect(before?.localAmount).toBe(1424)

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: B,
      leftAt: '2026-05-11',
    })

    const after = await billFor(sub.id, B, '2026-05-01')
    expect(after?.amount).toBe(64) // floor(200*10/31)
    // Key invariant: newLocalAmount == floor(newAmount × storedRate / 1e6).
    expect(after?.localAmount).toBe(455) // floor(64 × 7.123)
    // Sanity: the old formula would have landed on 459.
    expect(after?.localAmount).not.toBe(459)
  })
})

describe('P0 gap tests — leave interactions', () => {
  it('P0 RED: sequential leaves with redistribute — pins current R11-targets-any-unpaid-bill behaviour', async () => {
    // A (payer), B, C, D; price 1000; refund_policy=redistribute.
    //   5/1 R1: B/C/D each share=250.
    //   5/11 B leaves (usage=10/31)
    //     newB = floor(250*10/31) = 80, diff = 170
    //     Others = {C, D} (still active). addPer = floor(170/2) = 85.
    //     → C = 335, D = 335.
    //   5/20 C leaves (C's bill now 335, usage=19/31)
    //     newC = floor(335*19/31) = 205, diff = 130
    //     "Others" currently = all UNPAID non-payer bills EXCLUDING C — which
    //     incidentally STILL INCLUDES B's row (B left but their prorated bill
    //     is unpaid). Semantic note: bumping an already-left member's bill is
    //     debatable; pinning current behaviour here so any future fix lands
    //     as an intentional change with a matching test update.
    //     addPer = floor(130/2) = 65 → B = 80+65 = 145, D = 335+65 = 400.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const D = await createUser(db, { email: 'd@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
      refundPolicy: 'redistribute',
    })
    for (const uid of [B, C, D]) {
      await addSubMember(sqlite, sub.id, uid, { addedAt: '2026-04-01', addedBy: A })
    }
    await generateMonthlyBills(db, '2026-05')

    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-11' })
    await leaveSubscription(db, { subscriptionId: sub.id, userId: C, leftAt: '2026-05-20' })

    expect((await billFor(sub.id, B, '2026-05-01'))?.amount).toBe(145)
    expect((await billFor(sub.id, C, '2026-05-01'))?.amount).toBe(205)
    expect((await billFor(sub.id, D, '2026-05-01'))?.amount).toBe(400)
  })

  it('P0 RED: redistribute remainder is round-robin (first bucket gets the leftover cent)', async () => {
    // price=770, 4 non-payer members, R1 share=192 each (770/4=192, remainder 2 → payer absorbs).
    // Actually 770/5=154 to be cleaner. Let me pick numbers that produce a non-zero remainder.
    // Use price=70, 5 members: share=14 each.
    // Wait — we want the LEAVER's diff % (others.length) != 0 to hit remainder branch.
    //
    // Cleaner: price=800, 5 members (A payer + B,C,D,E). Share=160.
    //   B leaves 5/12 (usage=11/31). newB=floor(160*11/31)=56, diff=104.
    //   Others = C, D, E (3 non-payer). addPer=floor(104/3)=34, remainder=104-34*3=2.
    //   C gets 34+1=35 (remainder-1=1), D gets 34+1=35 (remainder-1=0), E gets 34.
    //   → C=160+35=195, D=160+35=195, E=160+34=194.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const D = await createUser(db, { email: 'd@t.com' })
    const E = await createUser(db, { email: 'e@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 800,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
      refundPolicy: 'redistribute',
    })
    for (const uid of [B, C, D, E]) {
      await addSubMember(sqlite, sub.id, uid, { addedAt: '2026-04-01', addedBy: A })
    }
    await generateMonthlyBills(db, '2026-05')

    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-12' })

    expect((await billFor(sub.id, B, '2026-05-01'))?.amount).toBe(56)
    // Two recipients absorb the remainder (+1 each), the last one doesn't.
    const bumped = [
      (await billFor(sub.id, C, '2026-05-01'))!.amount,
      (await billFor(sub.id, D, '2026-05-01'))!.amount,
      (await billFor(sub.id, E, '2026-05-01'))!.amount,
    ]
    // Total must equal the original total (conservation of diff + remaining share).
    expect(bumped[0] + bumped[1] + bumped[2]).toBe(160 * 3 + 104)
    // Exactly 2 of the 3 get +35 (one more cent than the third).
    expect(bumped.filter((x) => x === 195)).toHaveLength(2)
    expect(bumped.filter((x) => x === 194)).toHaveLength(1)
  })

  it('P0 RED: redistribute emits bill_adjusted notification with correct payload', async () => {
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 900,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
      refundPolicy: 'redistribute',
    })
    for (const uid of [B, C]) {
      await addSubMember(sqlite, sub.id, uid, { addedAt: '2026-04-01', addedBy: A })
    }
    await generateMonthlyBills(db, '2026-05')

    // Before leave: clear any pre-existing notifications for C.
    await sqlite
      .prepare('DELETE FROM notifications WHERE user_id = ?')
      .run(C)

    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-11' })

    const notifs = (await sqlite
      .prepare(
        `SELECT type, payload FROM notifications WHERE user_id = ? AND type = 'bill_adjusted'`
      )
      .all(C)) as Array<{ type: string; payload: string }>

    expect(notifs).toHaveLength(1)
    const payload = JSON.parse(notifs[0].payload) as {
      sub_name: string
      delta_amount: number
      delta_local_amount: number
      local_currency: string
      reason: string
    }
    expect(payload.sub_name).toBe('Netflix')
    expect(payload.delta_amount).toBeGreaterThan(0)
    expect(payload.reason).toBe('member_left')
    expect(payload.local_currency).toBe('CNY')
  })

  it('P0 RED: cross-month leftAt only prorates bills in leftAt\'s month', async () => {
    // B joins 2026-03-01, doesn't pay March/April. May 1 cron fires.
    // Then leftAt = '2026-05-15'. Only the 2026-05-01 bill should be
    // prorated; 2026-03-01 and 2026-04-01 bills stay unchanged.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 620, // share = 310 for n=2
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: A,
    })
    await addSubMember(sqlite, sub.id, B, { addedAt: '2026-03-01', addedBy: A })
    await generateMonthlyBills(db, '2026-03')
    await generateMonthlyBills(db, '2026-04')
    await generateMonthlyBills(db, '2026-05')

    const march = await billFor(sub.id, B, '2026-03-01')
    const april = await billFor(sub.id, B, '2026-04-01')
    const may = await billFor(sub.id, B, '2026-05-01')
    expect(march?.amount).toBe(310)
    expect(april?.amount).toBe(310)
    expect(may?.amount).toBe(310)

    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-15' })

    // May is in-window: prorated.
    const mayAfter = await billFor(sub.id, B, '2026-05-01')
    // usage=14 (15 - 1), coverage=31 → floor(310 * 14/31) = 140
    expect(mayAfter?.amount).toBe(140)
    // March and April untouched (different months).
    expect((await billFor(sub.id, B, '2026-03-01'))?.amount).toBe(310)
    expect((await billFor(sub.id, B, '2026-04-01'))?.amount).toBe(310)
  })
})

describe('P0 gap tests — price-change ordering', () => {
  // R5 only rewrites CURRENT-MONTH unpaid bills — needs "today" to be in May.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('P0 RED: R5 then R3 — leaver prorates the already-rewritten bill', async () => {
    // A(payer), B, C, D. Starts at price 1000 → share=250.
    // Day X: payer bumps price to 1600 → share=400. Each bill rewrites to 400.
    // Day Y > X: B leaves (redistribute).
    //   B's bill is now 400; prorate by usage; redistribute diff to C,D.
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const D = await createUser(db, { email: 'd@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
      refundPolicy: 'redistribute',
    })
    for (const uid of [B, C, D]) {
      await addSubMember(sqlite, sub.id, uid, { addedAt: '2026-04-01', addedBy: A })
    }
    await generateMonthlyBills(db, '2026-05')

    // R5 first: price 1000 → 1600. All three bills become 400.
    await changeSubscriptionPrice(db, { subscriptionId: sub.id, newPrice: 1600 })
    expect((await billFor(sub.id, B, '2026-05-01'))?.amount).toBe(400)
    expect((await billFor(sub.id, C, '2026-05-01'))?.amount).toBe(400)
    expect((await billFor(sub.id, D, '2026-05-01'))?.amount).toBe(400)

    // Then R3: B leaves on 5/11 (usage=10, coverage=31).
    //   newB = floor(400*10/31) = 129, diff = 271
    //   Redistribute to C, D: addPer = floor(271/2) = 135, remainder = 1
    //   C = 400 + 136 = 536; D = 400 + 135 = 535.
    await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-11' })

    expect((await billFor(sub.id, B, '2026-05-01'))?.amount).toBe(129)
    expect((await billFor(sub.id, C, '2026-05-01'))?.amount).toBe(536)
    expect((await billFor(sub.id, D, '2026-05-01'))?.amount).toBe(535)
  })
})

describe('P0 gap tests — no retroactive billing on add (R4)', () => {
  it('P0 RED: adding a new member does NOT rewrite existing R1 bills', async () => {
    // A (payer), B in a 2-member sub. R1 generates B's bill = share(n=2).
    // C joins mid-month → B's existing bill should be UNCHANGED (R4).
    const A = await createUser(db, { email: 'a@t.com' })
    const B = await createUser(db, { email: 'b@t.com' })
    const C = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-05-01',
      ownerId: A,
    })
    await addSubMember(sqlite, sub.id, B, { addedAt: '2026-04-01', addedBy: A })
    await generateMonthlyBills(db, '2026-05')

    const bBefore = await billFor(sub.id, B, '2026-05-01')
    expect(bBefore?.amount).toBe(500) // 1000/2

    // C joins mid-month.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: C,
      addedBy: A,
      addedAt: '2026-05-10',
    })

    // B's 5/1 bill unchanged — R4: "adding recomputes share for FUTURE cycles only".
    const bAfter = await billFor(sub.id, B, '2026-05-01')
    expect(bAfter?.amount).toBe(500)
  })
})
