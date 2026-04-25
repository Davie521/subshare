import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleAddMembers,
} from '@/lib/api-handlers'

/**
 * Creation-time backfill: when a subscription is created with a startDate
 * in a past calendar month, every initial non-payer member receives one
 * bill per month from startDate's month through "today":
 *
 *   - First month (the one containing startDate): prorate from startDate
 *     to end-of-month. billing_date = startDate.
 *   - Subsequent months up to and including today's month: full-share
 *     bill. billing_date = first-of-month.
 *
 * Members added AFTER creation (via handleAddMembers) do NOT trigger
 * backfill — they only owe from when they joined forward.
 *
 * Creation also advances nextPayment past today so the detail-page
 * "next" label is correct immediately after sub creation, not on the
 * next cron pass.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

interface Bill {
  userId: number
  amount: number
  billingDate: string
}

async function billsForUser(userId: number): Promise<Bill[]> {
  return (await sqlite
    .prepare(
      `SELECT user_id AS "userId", amount, billing_date AS "billingDate"
       FROM billing_records WHERE user_id = ? ORDER BY billing_date`
    )
    .all(userId)) as Bill[]
}

async function getNextPayment(subId: number): Promise<string> {
  const row = (await sqlite
    .prepare(
      `SELECT next_payment AS "nextPayment" FROM subscriptions WHERE id = ?`
    )
    .get(subId)) as { nextPayment: string }
  return row.nextPayment
}

describe('creation-time backfill', () => {
  it('startDate in past month → bill per month from startDate to today', async () => {
    // ¥10000 sub, owner A + invitee B. share = floor(10000/2) = 5000.
    // startDate = 2026-02-10. today = 2026-04-25.
    // Expected bills for B:
    //   Feb: billing_date=2026-02-10, prorate Feb 10..28 = 19/28 days
    //        amount = floor(5000 * 19 / 28) = 3392
    //   Mar: billing_date=2026-03-01, full share = 5000
    //   Apr: billing_date=2026-04-01, full share = 5000
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Migrated Sub',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-02-10',
      startDate: '2026-02-10',
      members: [b],
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    const bills = await billsForUser(b)
    expect(bills).toHaveLength(3)
    expect(bills[0]).toMatchObject({
      billingDate: '2026-02-10',
      amount: 3392,
    })
    expect(bills[1]).toMatchObject({
      billingDate: '2026-03-01',
      amount: 5000,
    })
    expect(bills[2]).toMatchObject({
      billingDate: '2026-04-01',
      amount: 5000,
    })
  })

  it('startDate in current month (past day) → single prorate bill', async () => {
    // startDate = 2026-04-10, today = 2026-04-25, both in April. Single
    // bill at 4/10 covering 4/10..4/30 = 21/30 days.
    // amount = floor(5000 * 21 / 30) = 3500
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Same-Month',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-10',
      startDate: '2026-04-10',
      members: [b],
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    const bills = await billsForUser(b)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({
      billingDate: '2026-04-10',
      amount: 3500,
    })
  })

  it('startDate = today → standard R2 single prorate', async () => {
    // No backfill — startDate is today. 4/25..4/30 = 6 days.
    // amount = floor(5000 * 6 / 30) = 1000
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Today',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-25',
      startDate: '2026-04-25',
      members: [b],
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    const bills = await billsForUser(b)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({
      billingDate: '2026-04-25',
      amount: 1000,
    })
  })

  it('startDate in future → single upcoming bill, no backfill', async () => {
    // startDate=4/28 future, today=4/25. R2 clamps to startDate.
    // Coverage 4/28..4/30 = 3 days. amount = floor(5000 * 3 / 30) = 500.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Future Start',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-04-28',
      startDate: '2026-04-28',
      members: [b],
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    const bills = await billsForUser(b)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({
      billingDate: '2026-04-28',
      amount: 500,
    })
  })

  it('add-member AFTER creation does NOT backfill', async () => {
    // Sub created today (4/25) with startDate=2/10 and ZERO invitees.
    // No bills yet (only owner = payer = no bills). Then add B today.
    // B should get only the current-month bill (today's prorate),
    // NOT historical Feb/Mar bills — they joined today, not on 2/10.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Solo-then-add',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-02-10',
      startDate: '2026-02-10',
      members: [], // solo at creation
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    const result = await handleAddMembers(db, a, created.data!.id, [b], {
      today: '2026-04-25',
    })
    if (!result.success) throw new Error(result.error)

    const bills = await billsForUser(b)
    expect(bills).toHaveLength(1)
    expect(bills[0].billingDate).toBe('2026-04-25')
  })

  it('nextPayment advanced past today after creation', async () => {
    // startDate = 2026-02-10. After creation on 2026-04-25, nextPayment
    // should be 2026-05-10 (next future occurrence of day-10).
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Migrated Sub',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-02-10',
      startDate: '2026-02-10',
      members: [b],
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    expect(await getNextPayment(created.data!.id)).toBe('2026-05-10')
  })

  it('idempotent: re-running creation flow does not duplicate', async () => {
    // Drive addMembersToSubscription a second time with the same inputs;
    // the (sub, user, billing_date) idempotency key on each backfilled
    // bill must prevent duplicates.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const created = await handleCreateSubscription(db, a, {
      name: 'Migrated Sub',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-02-10',
      startDate: '2026-02-10',
      members: [b],
      today: '2026-04-25',
    })
    if (!created.success) throw new Error(created.error)

    // Calling addMembers with same args (e.g., retry on a 500) — this is
    // a noop on the membership row but should NOT create more bills.
    const retry = await handleAddMembers(db, a, created.data!.id, [b], {
      today: '2026-04-25',
    })
    if (!retry.success) throw new Error(retry.error)

    const bills = await billsForUser(b)
    expect(bills).toHaveLength(3)
  })
})
