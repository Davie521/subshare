import { describe, it, expect, beforeEach, vi } from 'vitest'

// The engine stores and expects FX rates as rate × 1_000_000 (see
// billing_records.exchange_rate and resolveRate in engine/recompute.ts).
// getRate() returns the plain rate (e.g. 0.14), so every caller that hands
// rates to the engine has to scale them. These tests pin that for both
// entry points: the monthly cron and creating/adding members.
vi.mock('@/lib/fx-cache', () => ({
  getRate: vi.fn(async (from: string, to: string) => {
    if (from === to) return 1
    if (from === 'CNY' && to === 'USD') return 0.14
    return null
  }),
}))

import { setupTestDb, createUser } from './helpers'
import { handleCreateSubscription, handleAddMembers, runBillingCron } from '@/lib/api-handlers'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

type Row = { amount: number; local_amount: number; local_currency: string; exchange_rate: number }

async function billFor(userId: number, date?: string): Promise<Row | undefined> {
  const sql = date
    ? 'SELECT amount, local_amount, local_currency, exchange_rate FROM billing_records WHERE user_id = ? AND billing_date = ? ORDER BY id DESC LIMIT 1'
    : 'SELECT amount, local_amount, local_currency, exchange_rate FROM billing_records WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  const args = date ? [userId, date] : [userId]
  return (await sqlite.prepare(sql).get(...args)) as Row | undefined
}

describe('FX rates reach the engine as rate × 1_000_000', () => {
  it('monthly cron bills a USD member at the scaled CNY→USD rate', async () => {
    const owner = await createUser(db, { email: 'owner@t.com', currency: 'CNY' })
    const usd = await createUser(db, { email: 'usd@t.com', currency: 'USD' })
    const created = await handleCreateSubscription(db, owner, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [usd],
    })
    if (!created.success) throw new Error(created.error)

    await sqlite.prepare("UPDATE subscription_members SET added_at = '2026-04-01'").run()
    await sqlite.prepare('DELETE FROM billing_records').run()

    const result = await runBillingCron(db, { today: '2026-05-01' })
    expect(result.success).toBe(true)

    const bill = await billFor(usd, '2026-05-01')
    expect(bill).toBeDefined()
    expect(bill!.local_currency).toBe('USD')
    expect(bill!.exchange_rate).toBe(140_000)
    expect(bill!.local_amount).toBe(Math.floor((bill!.amount * 140_000) / 1_000_000))
    expect(bill!.local_amount).toBeGreaterThan(0)
  })

  it('adding a USD member mid-month reconciles at the scaled rate', async () => {
    const owner = await createUser(db, { email: 'owner2@t.com', currency: 'CNY' })
    const cny = await createUser(db, { email: 'cny2@t.com', currency: 'CNY' })
    const usd = await createUser(db, { email: 'usd2@t.com', currency: 'USD' })
    const created = await handleCreateSubscription(db, owner, {
      name: 'Spotify',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [cny],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    const res = await handleAddMembers(db, owner, subId, [usd], { today: '2026-05-10' })
    expect(res.success).toBe(true)

    const rows = (await sqlite
      .prepare('SELECT exchange_rate, amount, local_amount FROM billing_records WHERE user_id = ?')
      .all(usd)) as Array<{ exchange_rate: number; amount: number; local_amount: number }>
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.exchange_rate).toBe(140_000)
      expect(r.local_amount).toBe(Math.trunc((r.amount * 140_000) / 1_000_000))
    }
  })
})
