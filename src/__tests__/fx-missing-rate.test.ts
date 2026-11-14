import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as schema from '@/db/schema'

// A missing cross-currency FX rate used to make the fair engine fall back to
// 1:1 (resolveRate in engine/recompute.ts), so a CNY share was recorded as
// the same number of USD/JPY. These tests pin the replacement behaviour:
// the engine refuses to bill that subscription, the monthly cron skips only
// that subscription, and user-facing actions fetch rates for every member
// so the payer's own row is not billed at 1:1 either.
const fx = vi.hoisted(() => ({ table: {} as Record<string, number> }))
vi.mock('@/lib/fx-cache', () => ({
  getRate: vi.fn(async (from: string, to: string) => {
    if (from === to) return 1
    return fx.table[`${from}_${to}`] ?? null
  }),
}))

import { setupTestDb, createUser, addSubMember, pinToday, type TestDb, type SqliteShim } from './helpers'
import { recomputeMonth } from '@/lib/engine/recompute'
import { runR1Cron } from '@/lib/engine/cron'
import { editMemberAddedAt } from '@/lib/engine/edit-added-at'
import { handleCreateSubscription, handleRemoveMember } from '@/lib/api-handlers'

pinToday('2026-05-10')

let db: TestDb
let sqlite: SqliteShim
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  const env = await setupTestDb()
  db = env.db
  sqlite = env.sqlite
  fx.table = {}
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

async function makeSub(payerId: number, currency: string): Promise<number> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      name: 'Test Sub',
      price: 10000,
      currency,
      nextPayment: '2026-04-01',
      startDate: '2026-04-01',
      ownerId: payerId,
      payerId,
    })
    .returning({ id: schema.subscriptions.id })
  return row.id
}

type BillRow = { user_id: number; exchange_rate: number; local_currency: string }

async function billsFor(subId: number): Promise<BillRow[]> {
  return (await sqlite
    .prepare('SELECT user_id, exchange_rate, local_currency FROM billing_records WHERE subscription_id = ?')
    .all(subId)) as BillRow[]
}

function loggedErrors(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n')
}

describe('missing FX rate never bills at 1:1', () => {
  it('recomputeMonth throws for a cross-currency member without a rate and writes nothing', async () => {
    const payer = await createUser(db, { email: 'p@t.com', currency: 'CNY' })
    const jpy = await createUser(db, { email: 'j@t.com', currency: 'JPY' })
    const subId = await makeSub(payer, 'CNY')
    await addSubMember(sqlite, subId, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, jpy, { addedAt: '2026-04-01' })

    await expect(
      recomputeMonth(db, { subscriptionId: subId, year: 2026, month: 5, eventId: 'e1', today: '2026-05-01' })
    ).rejects.toThrow(new RegExp(`Missing exchange rate CNY→JPY for subscription ${subId}`))

    expect(await billsFor(subId)).toHaveLength(0)
  })

  it('runR1Cron skips only the subscription with the missing rate and logs it', async () => {
    const payer = await createUser(db, { email: 'p@t.com', currency: 'CNY' })
    const jpy = await createUser(db, { email: 'j@t.com', currency: 'JPY' })
    const cny = await createUser(db, { email: 'c@t.com', currency: 'CNY' })

    const needsFx = await makeSub(payer, 'CNY')
    await addSubMember(sqlite, needsFx, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, needsFx, jpy, { addedAt: '2026-04-01' })

    const sameCurrency = await makeSub(payer, 'CNY')
    await addSubMember(sqlite, sameCurrency, payer, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, sameCurrency, cny, { addedAt: '2026-04-01' })

    const out = await runR1Cron(db, { today: '2026-05-01', rates: {} })

    expect(await billsFor(needsFx)).toHaveLength(0)
    expect(await billsFor(sameCurrency)).toHaveLength(2)
    expect(out.subscriptionsProcessed).toBe(1)
    expect(out.subscriptionsSkipped).toBe(1)
    expect(loggedErrors()).toMatch(new RegExp(`subscription ${needsFx}.*CNY→JPY`))
  })

  it('removing a member bills the payer at the real rate, not 1:1', async () => {
    fx.table = { CNY_USD: 0.14 }
    const owner = await createUser(db, { email: 'o@t.com', currency: 'USD' })
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, owner, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [a, b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    const res = await handleRemoveMember(db, owner, subId, b)
    expect(res.success).toBe(true)

    const ownerRows = (await billsFor(subId)).filter((r) => r.user_id === owner)
    expect(ownerRows.length).toBeGreaterThan(0)
    for (const r of ownerRows) {
      expect(r.local_currency).toBe('USD')
      expect(r.exchange_rate).toBe(140_000)
    }
  })

  it('removing a member still succeeds when the rate is unavailable, without a 1:1 bill', async () => {
    const owner = await createUser(db, { email: 'o@t.com', currency: 'USD' })
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, owner, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [a, b],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    const res = await handleRemoveMember(db, owner, subId, b)
    expect(res.success).toBe(true)

    const left = (await sqlite
      .prepare('SELECT left_at FROM subscription_members WHERE subscription_id = ? AND user_id = ?')
      .get(subId, b)) as { left_at: string | null }
    expect(left.left_at).toBe('2026-05-10')

    const ownerRows = (await billsFor(subId)).filter((r) => r.user_id === owner)
    expect(ownerRows).toHaveLength(0)
    expect(loggedErrors()).toMatch(/Missing exchange rate CNY→USD/)
  })

  it('editMemberAddedAt without a needed rate rolls back instead of billing 1:1', async () => {
    const owner = await createUser(db, { email: 'o@t.com', currency: 'USD' })
    const cny = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const subId = await makeSub(owner, 'CNY')
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, cny, { addedAt: '2026-05-05' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: cny,
        actorUserId: owner,
        newAddedAt: '2026-05-01',
        today: '2026-05-10',
      })
    ).rejects.toThrow(/Missing exchange rate CNY→USD/)

    const member = (await sqlite
      .prepare('SELECT added_at FROM subscription_members WHERE subscription_id = ? AND user_id = ?')
      .get(subId, cny)) as { added_at: string }
    expect(member.added_at).toBe('2026-05-05')
    expect(await billsFor(subId)).toHaveLength(0)
  })
})
