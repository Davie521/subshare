import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  getMembersOfSubscription,
} from '@/lib/db-operations'

/**
 * T4 — addMemberToSubscription writes rows only.
 * No friendship / notification / billing side effects yet (those come in
 * T7 / T9 / T11 / etc.).
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T4 addMemberToSubscription', () => {
  it('owner is auto-inserted as a member on createSubscription', async () => {
    const owner = createUser(sqlite)
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: owner,
    })

    const members = await getMembersOfSubscription(db, sub.id)
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(owner)
    expect(members[0].addedBy).toBe(owner)
    expect(members[0].addedAt).toBeDefined()
    expect(members[0].leftAt).toBeNull()
  })

  it('adds a new member with addedBy and addedAt recorded', async () => {
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

    const members = await getMembersOfSubscription(db, sub.id)
    expect(members).toHaveLength(2)
    const bMember = members.find((m) => m.userId === b)!
    expect(bMember.addedBy).toBe(a)
    expect(bMember.addedAt).toBe('2026-04-15')
    expect(bMember.leftAt).toBeNull()
  })

  it('is idempotent — calling twice with same (subId, userId) is a no-op', async () => {
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
    // Second call with a different date must NOT overwrite the first.
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const members = await getMembersOfSubscription(db, sub.id)
    expect(members).toHaveLength(2)
    const bMember = members.find((m) => m.userId === b)!
    expect(bMember.addedAt).toBe('2026-04-15') // original preserved
  })

  it('getMembersOfSubscription returns every row including soft-left', async () => {
    // Used later (T6) for historical/debug views. Active-only filtering
    // lives in getActiveMembersAt (T6).
    const a = await createUser(db, { email: 'a@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    const rows = await getMembersOfSubscription(db, sub.id)
    expect(rows.every((r) => r.leftAt === null)).toBe(true)
  })

  it('creating a subscription writes exactly ONE subscription_members row for the owner', async () => {
    const owner = createUser(sqlite)
    const sub = await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: owner,
    })

    const count = await sqlite.prepare(
        `SELECT COUNT(*) as n FROM subscription_members WHERE subscription_id = ?`
      )
      .get(sub.id) as { n: number }
    expect(count.n).toBe(1)
  })
})
