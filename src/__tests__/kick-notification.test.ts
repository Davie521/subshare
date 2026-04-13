import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  leaveSubscription,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

/**
 * T14 — when A removes B from a sub (kick, not self-leave), B gets a
 * removed_from_sub notification. Self-leave is silent.
 *
 * leaveSubscription(..., actorId?) — when actorId !== userId, emit.
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

function setup2() {
  const a = createUser(sqlite, { name: 'Alice', email: 'a@t.com' })
  const b = createUser(sqlite, { name: 'Bob', email: 'b@t.com' })
  const sub = createSubscription(db, {
    name: 'Netflix',
    price: 10000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: a,
  })
  addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: b,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  return { a, b, sub }
}

describe('T14 removed_from_sub notification', () => {
  it('self-leave emits NO removed_from_sub notification', () => {
    const { b, sub } = setup2()

    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
      actorId: b, // self
    })

    const kicks = listNotifications(db, b).filter(
      (n) => n.type === 'removed_from_sub'
    )
    expect(kicks).toHaveLength(0)
  })

  it('owner kicks B → B receives removed_from_sub', () => {
    const { a, b, sub } = setup2()

    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
      actorId: a, // kicker
    })

    const kicks = listNotifications<{
      sub_name: string
      actor_name: string
    }>(db, b).filter((n) => n.type === 'removed_from_sub')
    expect(kicks).toHaveLength(1)
    expect(kicks[0].subscriptionId).toBe(sub.id)
    expect(kicks[0].payload.sub_name).toBe('Netflix')
    expect(kicks[0].payload.actor_name).toBe('Alice')
  })

  it('default actorId (when omitted) is treated as self-leave', () => {
    const { b, sub } = setup2()

    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })

    const kicks = listNotifications(db, b).filter(
      (n) => n.type === 'removed_from_sub'
    )
    expect(kicks).toHaveLength(0)
  })

  it('kick does not generate any billing_record (same as R3 self-leave)', () => {
    const { a, b, sub } = setup2()

    const before = (
      sqlite
        .prepare('SELECT COUNT(*) AS n FROM billing_records')
        .get() as { n: number }
    ).n

    leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
      actorId: a,
    })

    const after = (
      sqlite
        .prepare('SELECT COUNT(*) AS n FROM billing_records')
        .get() as { n: number }
    ).n
    expect(after).toBe(before)
  })

  it('cannot kick the payer (same guard as self-leave)', () => {
    const { a, b, sub } = setup2()

    expect(() =>
      leaveSubscription(db, {
        subscriptionId: sub.id,
        userId: a, // payer
        leftAt: '2026-04-20',
        actorId: b,
      })
    ).toThrow(/payer/i)
  })
})
