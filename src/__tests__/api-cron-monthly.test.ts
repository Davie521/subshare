import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import { handleCreateSubscription, runBillingCron } from '@/lib/api-handlers'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function billsForDate(date: string): Promise<number> {
  return (
    await sqlite.prepare(
        'SELECT COUNT(*) AS n FROM billing_records WHERE billing_date = ?'
      )
      .get(date) as { n: number }
  ).n
}

describe('A10 runBillingCron', () => {
  it('on the 1st, runs generateMonthlyBills for that month', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)

    // Force membership addedAt into the past so B qualifies for May-1 billing.
    await sqlite.prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    await sqlite.prepare('DELETE FROM billing_records').run()

    // Simulate running the cron on May 1, 2026.
    const result = await runBillingCron(db, { today: '2026-05-01' })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data!.monthlyBillsGenerated).toBeGreaterThan(0)
    expect(await billsForDate('2026-05-01')).toBeGreaterThan(0)
  })

  it('P0-5: on non-1st days, backfills the month if not yet generated', async () => {
    // Previously this test asserted "day != 1 returns 0". That behaviour
    // was a latent bug: if day-1 cron failed, the month's R1 bills were
    // never created. New contract: runBillingCron is idempotent (UNIQUE
    // constraint handles dups) and can safely run on any day; if the
    // 1st was missed, a later run still creates the missing bills.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    await sqlite.prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    await sqlite.prepare('DELETE FROM billing_records').run()

    const result = await runBillingCron(db, { today: '2026-05-15' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data!.monthlyBillsGenerated).toBeGreaterThan(0)
    expect(await billsForDate('2026-05-01')).toBeGreaterThan(0)
  })

  it('P0-5: running on non-1st with month already billed is a no-op', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    await sqlite.prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    await sqlite.prepare('DELETE FROM billing_records').run()

    // Day-1 succeeded.
    const first = await runBillingCron(db, { today: '2026-05-01' })
    expect(first.success).toBe(true)
    if (!first.success) return
    expect(first.data!.monthlyBillsGenerated).toBeGreaterThan(0)

    // A day-15 tick later in the same month must not generate more —
    // UNIQUE on (sub, user, billing_date) keeps it idempotent.
    const second = await runBillingCron(db, { today: '2026-05-15' })
    expect(second.success).toBe(true)
    if (!second.success) return
    expect(second.data!.monthlyBillsGenerated).toBe(0)
  })

  it('is idempotent on 1st — second run adds zero new bills', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    await sqlite.prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    await sqlite.prepare('DELETE FROM billing_records').run()

    const first = await runBillingCron(db, { today: '2026-05-01' })
    const second = await runBillingCron(db, { today: '2026-05-01' })

    if (!first.success || !second.success) return
    expect(first.data!.monthlyBillsGenerated).toBeGreaterThan(0)
    expect(second.data!.monthlyBillsGenerated).toBe(0)
  })
})
