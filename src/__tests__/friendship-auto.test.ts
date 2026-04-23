import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  createSubscription,
} from '@/lib/db-operations'
import { addMemberToSubscription } from '@/lib/membership'

/**
 * T7 — friendship edge formed by "A adds B" action.
 *
 * Rule:
 *   addMember(sub, target, addedBy) inserts friendship(min, max) between
 *   addedBy and target if not exists.
 *   B and C both added by A do NOT become friends with each other.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function hasFriendship(userA: number, userB: number): Promise<boolean> {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA]
  const row = await sqlite.prepare(
      `SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?`
    )
    .get(lo, hi)
  return !!row
}

async function friendshipCount(): Promise<number> {
  const row = await sqlite.prepare(`SELECT COUNT(*) AS n FROM friendships`)
    .get() as { n: number }
  return row.n
}

describe('T7 friendship auto-create on addMember', () => {
  it('A adds B → friendship(min(A,B), max(A,B)) exists', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
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

    expect(await hasFriendship(a, b)).toBe(true)
  })

  it('A adds B then A adds C → no friendship(B, C)', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
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
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    expect(await hasFriendship(a, b)).toBe(true)
    expect(await hasFriendship(a, c)).toBe(true)
    expect(await hasFriendship(b, c)).toBe(false)
  })

  it('re-adding the same user does not create a duplicate friendship', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
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
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-16',
    })

    expect(await friendshipCount()).toBe(1)
  })

  it('owner-self-insert on createSubscription does NOT create a self-friendship', async () => {
    const a = await createUser(db)
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    expect(await friendshipCount()).toBe(0)
  })

  it('works regardless of add order (A adds B, then B added again in another sub)', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })

    const sub1 = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })
    const sub2 = await createSubscription(db, {
      name: 'Disney+',
      price: 8000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-10',
    })

    expect(await friendshipCount()).toBe(1)
  })

  it('symmetric: B adds A creates same friendship row as A adds B', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Spotify',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: b, // B is owner this time
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-04-15',
    })

    expect(await hasFriendship(a, b)).toBe(true)
    // Canonical ordering (smaller id first)
    const row = await sqlite.prepare(
        `SELECT user_a_id, user_b_id FROM friendships`
      )
      .get() as { user_a_id: number; user_b_id: number }
    expect(row.user_a_id).toBeLessThan(row.user_b_id)
  })
})
