import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import { handleCreateSubscription } from '@/lib/api-handlers'
import {
  getMembersOfSubscription,
} from '@/lib/db-operations'

/**
 * A1 — handleCreateSubscription accepts members + payerId, seeding the
 * subscription_members table for shared subs and (optionally) overriding
 * the payer.
 *
 * Behaviour:
 *  - members array is passed → each user_id added via addMemberToSubscription
 *    (triggers R2 join bill + friendship + added_to_sub notification).
 *  - payerId optional: defaults to creator (= ownerId). When set, must be
 *    the creator or one of the members.
 *  - Self-add in members is ignored (owner already inserted).
 *  - Missing cross-currency rates → descriptive error.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A1 handleCreateSubscription with members', () => {
  it('creates a shared sub with the specified members', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })

    const res = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b, c],
    })

    expect(res.success).toBe(true)
    if (!res.success) return
    const members = await getMembersOfSubscription(db, res.data!.id)
    expect(members.map((m) => m.userId).sort()).toEqual([a, b, c].sort())
  })

  it('defaults payer to the owner', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const res = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })
    expect(res.success).toBe(true)
    if (!res.success) return

    const row = await sqlite.prepare('SELECT payer_id FROM subscriptions WHERE id = ?')
      .get(res.data!.id) as { payer_id: number }
    expect(row.payer_id).toBe(a)
  })

  it('accepts explicit payerId (e.g. roommate pays, you set up)', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const res = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
      payerId: b,
    })
    expect(res.success).toBe(true)
    if (!res.success) return

    const row = await sqlite.prepare('SELECT payer_id FROM subscriptions WHERE id = ?')
      .get(res.data!.id) as { payer_id: number }
    expect(row.payer_id).toBe(b)
  })

  it('rejects payerId that is not the owner or one of the members', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })

    const res = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
      payerId: c, // C is not the owner nor in members
    })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/payer/i)
  })

  it('ignores self-add in members array (owner already inserted)', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })

    const res = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [a, b], // duplicate self
    })
    expect(res.success).toBe(true)
    if (!res.success) return

    const members = await getMembersOfSubscription(db, res.data!.id)
    expect(members).toHaveLength(2)
  })

  it('personal sub when members omitted or empty', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })

    const res = await handleCreateSubscription(db, a, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-05-01',
    })
    expect(res.success).toBe(true)
    if (!res.success) return

    const members = await getMembersOfSubscription(db, res.data!.id)
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(a)
  })
})
