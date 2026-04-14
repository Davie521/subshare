import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  getMembersOfSubscription,
  leaveSubscription,
} from '@/lib/db-operations'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T5 leaveSubscription', () => {
  function scenario() {
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
    return { a, b, sub }
  }

  it('sets left_at on the member row', () => {
    const { b, sub } = scenario()

    // B joined 4/15 → R2 minimum-cycle end = 5/31. Leaving 4/20 clamps.
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })

    const rows = getMembersOfSubscription(db, sub.id)
    const bRow = rows.find((r) => r.userId === b)!
    expect(bRow.leftAt).toBe('2026-05-31')
  })

  it('generates NO additional billing records on leave (R3, no refund)', () => {
    const { b, sub } = scenario()

    const before = (
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM billing_records`)
        .get() as { n: number }
    ).n

    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })

    const after = (
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM billing_records`)
        .get() as { n: number }
    ).n

    expect(after).toBe(before) // leave never creates a refund/final bill
  })

  it('rejects when the leaving user is the payer (R7)', () => {
    const { a, sub } = scenario()
    // A is the payer by default.

    expect(() =>
      leaveSubscription(db, {
        subscriptionId: sub.id,
        userId: a,
        leftAt: '2026-04-20',
      })
    ).toThrow(/payer/i)
  })

  it('is a no-op when the user already left (idempotent)', () => {
    const { b, sub } = scenario()

    // First call: 4/20 clamps to 5/31 (R2 minimum).
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })
    // Second call must NOT overwrite the first.
    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-06-15',
    })

    const bRow = getMembersOfSubscription(db, sub.id).find(
      (r) => r.userId === b
    )!
    expect(bRow.leftAt).toBe('2026-05-31')
  })

  it('throws when the user is not a member at all', () => {
    const { sub } = scenario()
    const stranger = createUser(sqlite, { email: 'stranger@t.com' })

    expect(() =>
      leaveSubscription(db, {
        subscriptionId: sub.id,
        userId: stranger,
        leftAt: '2026-04-20',
      })
    ).toThrow(/not a member/i)
  })
})
