import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleGetSettlement,
  handleMarkPairSettled,
} from '@/lib/api-handlers'
import { generateMonthlyBills } from '@/lib/db-operations'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function reciprocalScenario() {
  const a = await createUser(db, { name: 'Alice', email: 'a@t.com', currency: 'CNY' })
  const b = await createUser(db, { name: 'Bob', email: 'b@t.com', currency: 'CNY' })
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
  // Clear R2 bills accumulated during setup + normalize addedAt so the
  // monthly cron is the sole source of billing_records we assert on.
  await sqlite.prepare('DELETE FROM billing_records').run()
  await sqlite.prepare("UPDATE subscription_members SET added_at = '2026-05-01'")
    .run()
  await generateMonthlyBills(db, '2026-05')
  return { a, b }
}

describe('A8 handleGetSettlement', () => {
  it('returns netted summary with resolved counterparty names', async () => {
    const { a, b } = await reciprocalScenario()

    const res = await handleGetSettlement(db, b)
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

  it('empty when no unpaid bills exist', async () => {
    const a = await createUser(db)
    const res = await handleGetSettlement(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toEqual([])
  })
})

describe('A9 handleMarkPairSettled', () => {
  it('marks all unpaid bills between the pair in given currency', async () => {
    const { a, b } = await reciprocalScenario()

    const res = await handleMarkPairSettled(db, b, a, 'CNY')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.marked).toBeGreaterThan(0)

    const after = await handleGetSettlement(db, b)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data).toEqual([])
  })

  it('third-party call is a safe no-op (no bills between caller + target)', async () => {
    const { a } = await reciprocalScenario()
    const c = await createUser(db, { email: 'c@t.com' })
    // C calls settle with A; markPairSettled scopes to bills where
    // user_id/payer_id ∈ {C, A}. Since C has no bills, nothing is flipped.
    const res = await handleMarkPairSettled(db, c, a, 'CNY')
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.marked).toBe(0)
  })

  it('rejects when currency unknown', async () => {
    const { a, b } = await reciprocalScenario()
    const res = await handleMarkPairSettled(db, b, a, 'XYZ')
    expect(res.success).toBe(false)
  })
})
