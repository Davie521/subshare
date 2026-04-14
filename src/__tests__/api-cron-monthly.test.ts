import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import { handleCreateSubscription, runBillingCron } from '@/lib/api-handlers'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

function billsForDate(date: string): number {
  return (
    sqlite
      .prepare(
        'SELECT COUNT(*) AS n FROM billing_records WHERE billing_date = ?'
      )
      .get(date) as { n: number }
  ).n
}

describe('A10 runBillingCron', () => {
  it('on the 1st, runs generateMonthlyBills for that month', async () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)

    // Force membership addedAt into the past so B qualifies for May-1 billing.
    sqlite
      .prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    sqlite.prepare('DELETE FROM billing_records').run()

    // Simulate running the cron on May 1, 2026.
    const result = await runBillingCron(db, { today: '2026-05-01' })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data!.monthlyBillsGenerated).toBeGreaterThan(0)
    expect(billsForDate('2026-05-01')).toBeGreaterThan(0)
  })

  it('on non-1st days, does NOT run the monthly generator', async () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    sqlite
      .prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    sqlite.prepare('DELETE FROM billing_records').run()

    const result = await runBillingCron(db, { today: '2026-05-15' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data!.monthlyBillsGenerated).toBe(0)
    expect(billsForDate('2026-05-01')).toBe(0)
  })

  it('is idempotent on 1st — second run adds zero new bills', async () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    sqlite
      .prepare("UPDATE subscription_members SET added_at = '2026-04-01'")
      .run()
    sqlite.prepare('DELETE FROM billing_records').run()

    const first = await runBillingCron(db, { today: '2026-05-01' })
    const second = await runBillingCron(db, { today: '2026-05-01' })

    if (!first.success || !second.success) return
    expect(first.data!.monthlyBillsGenerated).toBeGreaterThan(0)
    expect(second.data!.monthlyBillsGenerated).toBe(0)
  })
})
