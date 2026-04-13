import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

/**
 * T11 — addMember emits `added_to_sub` to the invitee.
 * Payload must include enough info for the invitee to know exactly:
 *   - which sub
 *   - their share amount
 *   - the pro-rated amount for the current cycle
 *   - who the payer is (and their name for display)
 *   - next settlement date (YYYY-MM-01 of next month)
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T11 added_to_sub notification', () => {
  it('inserts one notification for the invitee with enriched payload', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const notifs = listNotifications<{
      sub_name: string
      actor_name: string
      share: number
      share_currency: string
      this_cycle_prorated: number
      payer_name: string
      next_billing_date: string
    }>(db, b)

    expect(notifs).toHaveLength(1)
    const n = notifs[0]
    expect(n.type).toBe('added_to_sub')
    expect(n.subscriptionId).toBe(sub.id)
    expect(n.payload.sub_name).toBe('Netflix')
    expect(n.payload.actor_name).toBeDefined()
    expect(n.payload.payer_name).toBeDefined()
    expect(n.payload.share).toBe(5400) // floor(10800/2)
    expect(n.payload.share_currency).toBe('CNY')
    // April 20 in 30-day month → 11/30 of 5400 = 1980
    expect(n.payload.this_cycle_prorated).toBe(1980)
    expect(n.payload.next_billing_date).toBe('2026-05-01')
  })

  it('no notification sent when owner is self-inserted on createSubscription', () => {
    const a = createUser(sqlite)
    createSubscription(db, {
      name: 'Spotify',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    expect(listNotifications(db, a)).toHaveLength(0)
  })

  it('notification goes to the invitee only, not to the inviter or other members', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
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
      addedAt: '2026-04-16',
    })

    expect(listNotifications(db, a)).toHaveLength(0)
    expect(listNotifications(db, b)).toHaveLength(1)
    expect(listNotifications(db, c)).toHaveLength(1)
  })

  it('idempotent re-add does not create a duplicate notification', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
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
      addedAt: '2026-04-20',
    })

    expect(listNotifications(db, b)).toHaveLength(1)
  })

  it('actor_name reflects the inviter displayName (or falls back to name)', () => {
    const a = createUser(sqlite, { name: 'Alice', email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })

    const notifs = listNotifications<{ actor_name: string; payer_name: string }>(
      db,
      b
    )
    expect(notifs[0].payload.actor_name).toBe('Alice')
    expect(notifs[0].payload.payer_name).toBe('Alice') // payer = owner
  })
})
