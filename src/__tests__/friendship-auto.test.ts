import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
} from '@/lib/db-operations'

/**
 * T7 — friendship edge formed by "A adds B" action.
 *
 * Rule:
 *   addMember(sub, target, addedBy) inserts friendship(min, max) between
 *   addedBy and target if not exists.
 *   B and C both added by A do NOT become friends with each other.
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

function hasFriendship(userA: number, userB: number): boolean {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA]
  const row = sqlite
    .prepare(
      `SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?`
    )
    .get(lo, hi)
  return !!row
}

function friendshipCount(): number {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM friendships`)
    .get() as { n: number }
  return row.n
}

describe('T7 friendship auto-create on addMember', () => {
  it('A adds B → friendship(min(A,B), max(A,B)) exists', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })

    expect(hasFriendship(a, b)).toBe(true)
  })

  it('A adds B then A adds C → no friendship(B, C)', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    expect(hasFriendship(a, b)).toBe(true)
    expect(hasFriendship(a, c)).toBe(true)
    expect(hasFriendship(b, c)).toBe(false)
  })

  it('re-adding the same user does not create a duplicate friendship', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-16',
    })

    expect(friendshipCount()).toBe(1)
  })

  it('owner-self-insert on createSubscription does NOT create a self-friendship', () => {
    const a = createUser(sqlite)
    createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    expect(friendshipCount()).toBe(0)
  })

  it('works regardless of add order (A adds B, then B added again in another sub)', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })

    const sub1 = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })
    const sub2 = createSubscription(db, {
      name: 'Disney+',
      price: 8000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub1.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-01',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub2.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-10',
    })

    expect(friendshipCount()).toBe(1)
  })

  it('symmetric: B adds A creates same friendship row as A adds B', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Spotify',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: b, // B is owner this time
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: a,
      addedBy: b,
      addedAt: '2026-04-15',
    })

    expect(hasFriendship(a, b)).toBe(true)
    // Canonical ordering (smaller id first)
    const row = sqlite
      .prepare(
        `SELECT user_a_id, user_b_id FROM friendships`
      )
      .get() as { user_a_id: number; user_b_id: number }
    expect(row.user_a_id).toBeLessThan(row.user_b_id)
  })
})
