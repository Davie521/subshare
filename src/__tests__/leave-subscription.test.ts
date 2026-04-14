import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  getMembersOfSubscription,
  leaveSubscription,
} from '@/lib/db-operations'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T5 leaveSubscription', () => {
  function scenario() {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    return { a, b, sub }
  }

  it('sets left_at on the member row', async () => {
    const { b, sub } = scenario()

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })

    const rows = await getMembersOfSubscription(db, sub.id)
    const bRow = rows.find((r) => r.userId === b)!
    expect(bRow.leftAt).toBe('2026-04-20')
  })

  it('generates NO additional billing records on leave (R3, no refund)', async () => {
    const { b, sub } = scenario()

    const before = (
      await sqlite.prepare(`SELECT COUNT(*) AS n FROM billing_records`)
        .get() as { n: number }
    ).n

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })

    const after = (
      await sqlite.prepare(`SELECT COUNT(*) AS n FROM billing_records`)
        .get() as { n: number }
    ).n

    expect(after).toBe(before) // leave never creates a refund/final bill
  })

  it('rejects when the leaving user is the payer (R7)', async () => {
    const { a, sub } = scenario()
    // A is the payer by default.

    expect(() =>
      await leaveSubscription(db, {
        subscriptionId: sub.id,
        userId: a,
        leftAt: '2026-04-20',
      })
    ).toThrow(/payer/i)
  })

  it('is a no-op when the user already left (idempotent)', async () => {
    const { b, sub } = scenario()

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })
    // Second call with a later date must NOT overwrite the first.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-30',
    })

    const bRow = await getMembersOfSubscription(db, sub.id).find(
      (r) => r.userId === b
    )!
    expect(bRow.leftAt).toBe('2026-04-20')
  })

  it('throws when the user is not a member at all', async () => {
    const { sub } = scenario()
    const stranger = await createUser(db, { email: 'stranger@t.com' })

    expect(() =>
      await leaveSubscription(db, {
        subscriptionId: sub.id,
        userId: stranger,
        leftAt: '2026-04-20',
      })
    ).toThrow(/not a member/i)
  })
})
