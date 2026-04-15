import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleTransferPayer,
} from '@/lib/api-handlers'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function setupScenario() {
  const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
  const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
  const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
  const res = await handleCreateSubscription(db, a, {
    name: 'Netflix',
    price: 10000,
    currency: 'CNY',
    nextPayment: '2026-05-01',
    members: [b, c],
  })
  if (!res.success) throw new Error(res.error)
  return { a, b, c, subId: res.data!.id }
}

describe('A4 handleTransferPayer', () => {
  it('owner can transfer payer to another active member', async () => {
    const { a, b, subId } = await setupScenario()
    const res = await handleTransferPayer(db, a, subId, b)
    expect(res.success).toBe(true)

    const row = await sqlite.prepare('SELECT payer_id FROM subscriptions WHERE id = ?')
      .get(subId) as { payer_id: number }
    expect(row.payer_id).toBe(b)
  })

  it('current payer can transfer to someone else', async () => {
    const { a, c, subId } = await setupScenario()
    // A is current payer.
    const res = await handleTransferPayer(db, a, subId, c)
    expect(res.success).toBe(true)
  })

  it('non-owner/non-payer member cannot transfer', async () => {
    const { b, c, subId } = await setupScenario()
    // B is member, not owner/payer.
    const res = await handleTransferPayer(db, b, subId, c)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/owner|payer|permission/i)
  })

  it('rejects transfer to non-member', async () => {
    const { a, subId } = await setupScenario()
    const stranger = await createUser(db, { email: 'stranger@t.com' })
    const res = await handleTransferPayer(db, a, subId, stranger)
    expect(res.success).toBe(false)
  })

  it('rejects transfer to self (already payer)', async () => {
    const { a, subId } = await setupScenario()
    const res = await handleTransferPayer(db, a, subId, a)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/already/i)
  })

  it('returns 404 when sub missing', async () => {
    const { a, b } = await setupScenario()
    const res = await handleTransferPayer(db, a, 9999, b)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/not found/i)
  })
})
