import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
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

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T4 addMemberToSubscription', () => {
  it('owner is auto-inserted as a member on createSubscription', () => {
    const owner = createUser(sqlite)
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: owner,
    })

    const members = getMembersOfSubscription(db, sub.id)
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(owner)
    expect(members[0].addedBy).toBe(owner)
    expect(members[0].addedAt).toBeDefined()
    expect(members[0].leftAt).toBeNull()
  })

  it('adds a new member with addedBy and addedAt recorded', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 15000,
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

    const members = getMembersOfSubscription(db, sub.id)
    expect(members).toHaveLength(2)
    const bMember = members.find((m) => m.userId === b)!
    expect(bMember.addedBy).toBe(a)
    expect(bMember.addedAt).toBe('2026-04-15')
    expect(bMember.leftAt).toBeNull()
  })

  it('is idempotent — calling twice with same (subId, userId) is a no-op', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 15000,
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
    // Second call with a different date must NOT overwrite the first.
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const members = getMembersOfSubscription(db, sub.id)
    expect(members).toHaveLength(2)
    const bMember = members.find((m) => m.userId === b)!
    expect(bMember.addedAt).toBe('2026-04-15') // original preserved
  })

  it('getMembersOfSubscription returns every row including soft-left', () => {
    // Used later (T6) for historical/debug views. Active-only filtering
    // lives in getActiveMembersAt (T6).
    const a = createUser(sqlite, { email: 'a@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: a,
    })

    const rows = getMembersOfSubscription(db, sub.id)
    expect(rows.every((r) => r.leftAt === null)).toBe(true)
  })

  it('creating a subscription writes exactly ONE subscription_members row for the owner', () => {
    const owner = createUser(sqlite)
    const sub = createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: owner,
    })

    const count = sqlite
      .prepare(
        `SELECT COUNT(*) as n FROM subscription_members WHERE subscription_id = ?`
      )
      .get(sub.id) as { n: number }
    expect(count.n).toBe(1)
  })
})
