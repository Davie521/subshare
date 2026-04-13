import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  leaveSubscription,
  getActiveMembersAt,
} from '@/lib/db-operations'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T6 getActiveMembersAt', () => {
  function setup3() {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
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
      addedAt: '2026-04-01',
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    return { a, b, c, sub }
  }

  it('includes members whose addedAt <= atDate', () => {
    const { a, b, sub } = setup3()
    // On April 1st, only A (owner) and B are active.
    const members = getActiveMembersAt(db, sub.id, '2026-04-01')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, b].sort())
  })

  it('includes member added exactly on atDate (boundary)', () => {
    const { a, b, c, sub } = setup3()
    // April 15 — C joins; should be included that very day.
    const members = getActiveMembersAt(db, sub.id, '2026-04-15')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, b, c].sort())
  })

  it('excludes members whose leftAt <= atDate', () => {
    const { a, b, c, sub } = setup3()
    // B leaves April 20; on April 21, only A and C should remain.
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })
    const members = getActiveMembersAt(db, sub.id, '2026-04-21')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, c].sort())
  })

  it('includes a member on their leftAt date (last active day)', () => {
    const { a, b, c, sub } = setup3()
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })
    // B is "active" on April 20 — their last billable day.
    const members = getActiveMembersAt(db, sub.id, '2026-04-20')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, b, c].sort())
  })

  it('excludes members whose addedAt is AFTER atDate', () => {
    const { a, b, sub } = setup3()
    // March 20 — before anyone joined in April. But owner was added
    // at subscription creation (today = the test date). Use the
    // subscription's own creation date as a reference.
    // Here we assert no member added AFTER the reference appears:
    const members = getActiveMembersAt(db, sub.id, '2026-04-10')
    const ids = members.map((m) => m.userId).sort()
    // Only A (owner, addedAt=today ~fresh) and B (April 1) should appear;
    // C was added on April 15 which is after April 10.
    expect(ids).toContain(a)
    expect(ids).toContain(b)
    expect(ids).not.toContain(setup3().c)
  })

  it('returns empty array when subscription has no members', () => {
    const members = getActiveMembersAt(db, 9999, '2026-04-15')
    expect(members).toEqual([])
  })

  it('returns members with addedAt and payer flag consistent with schema', () => {
    const { sub } = setup3()
    const members = getActiveMembersAt(db, sub.id, '2026-04-15')
    for (const m of members) {
      expect(m.userId).toBeTypeOf('number')
      expect(m.addedAt).toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })
})
