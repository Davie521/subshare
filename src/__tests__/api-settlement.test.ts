import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  handleCreateSubscription,
  handleGetSettlement,
  handleMarkPairSettled,
} from '@/lib/api-handlers'
import { generateMonthlyBills } from '@/lib/db-operations'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function reciprocalScenario() {
  const a = createUser(sqlite, { name: 'Alice', email: 'a@t.com', currency: 'CNY' })
  const b = createUser(sqlite, { name: 'Bob', email: 'b@t.com', currency: 'CNY' })
  // A hosts Netflix with B (B owes A)
  await handleCreateSubscription(db, a, {
    name: 'Netflix',
    price: 12000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    members: [b],
  })
  // B hosts Spotify with A (A owes B)
  await handleCreateSubscription(db, b, {
    name: 'Spotify',
    price: 4000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    members: [a],
  })
  // Force membership dates to a safe window + monthly cron.
  sqlite
    .prepare("UPDATE subscription_members SET added_at = '2026-05-01'")
    .run()
  generateMonthlyBills(db, '2026-05')
  return { a, b }
}

describe('A8 handleGetSettlement', () => {
  it('returns netted summary with resolved counterparty names', async () => {
    const { a, b } = await reciprocalScenario()

    const res = handleGetSettlement(db, b)
    expect(res.success).toBe(true)
    if (!res.success) return

    expect(res.data).toHaveLength(1)
    const row = res.data![0]
    expect(row.counterpartyUserId).toBe(a)
    expect(row.counterpartyName).toBe('Alice')
    expect(row.currency).toBe('CNY')
    expect(row.owedByMe).toBe(6000)
    expect(row.owedToMe).toBe(2000)
    expect(row.net).toBe(-4000)
  })

  it('empty when no unpaid bills exist', () => {
    const a = createUser(sqlite)
    const res = handleGetSettlement(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toEqual([])
  })
})

describe('A9 handleMarkPairSettled', () => {
  it('marks all unpaid bills between the pair in given currency', async () => {
    const { a, b } = await reciprocalScenario()

    const res = handleMarkPairSettled(db, b, a, 'CNY')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.marked).toBeGreaterThan(0)

    const after = handleGetSettlement(db, b)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data).toEqual([])
  })

  it('cannot be triggered by a third party (counterparty is not me)', async () => {
    const { a, b } = await reciprocalScenario()
    const c = createUser(sqlite, { email: 'c@t.com' })
    // C tries to settle between A and B — not allowed.
    const res = handleMarkPairSettled(db, c, a, 'CNY')
    expect(res.success).toBe(false)
  })

  it('rejects when currency unknown', async () => {
    const { a, b } = await reciprocalScenario()
    const res = handleMarkPairSettled(db, b, a, 'XYZ')
    expect(res.success).toBe(false)
  })
})
