import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import { handleCreateSubscription, runBillingCron } from '@/lib/api-handlers'

/**
 * R1 cron must advance subscriptions.nextPayment past the billing month
 * each time it runs. Without this, the "next payment" displayed on
 * subscription detail / list pages stays frozen at whatever the user
 * last typed and lies forever.
 *
 * Contract:
 * - If nextPayment falls in the cron's yearMonth (or earlier), advance
 *   by 1 calendar month at a time until nextPayment > end-of-yearMonth.
 *   Idempotent — running cron twice in the same month doesn't
 *   double-advance.
 * - Day-of-month is preserved across advances when possible (mid-month
 *   sub stays mid-month). Month-end clamp: 1/31 → 2/28 → 3/28.
 * - Solo subs (only the payer, no co-members) ALSO advance — the user's
 *   card is charged whether or not they share. Bills don't get inserted
 *   for solo subs but nextPayment still moves.
 * - Subs whose nextPayment is already in the future are untouched.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function getNextPayment(subId: number): Promise<string> {
  const row = (await sqlite
    .prepare(
      `SELECT next_payment AS "nextPayment" FROM subscriptions WHERE id = ?`
    )
    .get(subId)) as { nextPayment: string }
  return row.nextPayment
}

describe('R1 cron advances nextPayment', () => {
  it('nextPayment in current month → advances to next month', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-15',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await runBillingCron(db, { today: '2026-05-01' })

    expect(await getNextPayment(subId)).toBe('2026-06-15')
  })

  it('nextPayment months in the past → advances forward one month per cron run', async () => {
    // Cron only knows about the current yearMonth. If nextPayment is
    // multiple months in the past (sub created earlier and never billed)
    // the same cron pass advances it past *this* yearMonth — i.e. loops
    // until > end of yearMonth, not all the way to today.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Old Sub',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-02-15',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await runBillingCron(db, { today: '2026-05-01' })

    // 2026-02-15 → 03-15 → 04-15 → 05-15 (now > end of cron's 2026-05? no,
    // 05-15 ≤ 05-31, keep going) → 06-15. End: > end of 05.
    expect(await getNextPayment(subId)).toBe('2026-06-15')
  })

  it('nextPayment in the future → unchanged', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Future Sub',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-08-15',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await runBillingCron(db, { today: '2026-05-01' })

    expect(await getNextPayment(subId)).toBe('2026-08-15')
  })

  it('end-of-month clamp: 2026-01-31 → 2026-02-28 in a single advance', async () => {
    // Cron runs in January (yearMonth = 2026-01). nextPayment = 1/31 is
    // in this month, so it advances exactly once → 2/28 (Feb has 28 days
    // in 2026). Then 2/28 > end-of-2026-01 = 1/31, loop exits.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'EOM Sub',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-01-31',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await runBillingCron(db, { today: '2026-01-15' })

    expect(await getNextPayment(subId)).toBe('2026-02-28')
  })

  it('solo sub (only payer, no co-members) → nextPayment still advances', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Solo',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-10',
      members: [], // no co-members
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await runBillingCron(db, { today: '2026-05-01' })

    expect(await getNextPayment(subId)).toBe('2026-06-10')
  })

  it('idempotent: running cron twice in the same month does not double-advance', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-15',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await runBillingCron(db, { today: '2026-05-01' })
    await runBillingCron(db, { today: '2026-05-15' })

    expect(await getNextPayment(subId)).toBe('2026-06-15')
  })
})
