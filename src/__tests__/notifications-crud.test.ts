import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import { createSubscription } from '@/lib/db-operations'
import {
  insertNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnreadNotifications,
} from '@/lib/notifications'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T10 notifications CRUD', () => {
  it('insertNotification persists row with created_at and null read_at', () => {
    const u = createUser(sqlite)
    const id = insertNotification(db, {
      userId: u,
      type: 'added_to_sub',
      payload: { sub_name: 'Netflix', amount: 540 },
    })
    expect(id).toBeGreaterThan(0)

    const rows = listNotifications(db, u)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('added_to_sub')
    expect(rows[0].readAt).toBeNull()
    expect(rows[0].createdAt).toMatch(/\d{4}-\d{2}-\d{2}/)
    // payload round-trips through JSON
    expect((rows[0].payload as { sub_name: string }).sub_name).toBe('Netflix')
  })

  it('listNotifications returns latest first', () => {
    const u = createUser(sqlite)
    insertNotification(db, { userId: u, type: 'a', payload: { n: 1 } })
    insertNotification(db, { userId: u, type: 'b', payload: { n: 2 } })
    insertNotification(db, { userId: u, type: 'c', payload: { n: 3 } })

    const rows = listNotifications(db, u)
    expect(rows.map((r) => r.type)).toEqual(['c', 'b', 'a'])
  })

  it('listNotifications scoped to user', () => {
    const u1 = createUser(sqlite, { email: 'x@t.com' })
    const u2 = createUser(sqlite, { email: 'y@t.com' })
    insertNotification(db, { userId: u1, type: 'x', payload: {} })
    insertNotification(db, { userId: u2, type: 'y', payload: {} })

    expect(listNotifications(db, u1).map((r) => r.type)).toEqual(['x'])
    expect(listNotifications(db, u2).map((r) => r.type)).toEqual(['y'])
  })

  it('markNotificationRead flips read_at', () => {
    const u = createUser(sqlite)
    const id = insertNotification(db, {
      userId: u,
      type: 'x',
      payload: {},
    })

    markNotificationRead(db, id)

    const rows = listNotifications(db, u)
    expect(rows[0].readAt).not.toBeNull()
  })

  it('markAllNotificationsRead flips all unread for a user', () => {
    const u = createUser(sqlite)
    insertNotification(db, { userId: u, type: 'a', payload: {} })
    insertNotification(db, { userId: u, type: 'b', payload: {} })
    insertNotification(db, { userId: u, type: 'c', payload: {} })

    markAllNotificationsRead(db, u)

    const unread = listNotifications(db, u).filter((r) => r.readAt === null)
    expect(unread).toHaveLength(0)
  })

  it('countUnreadNotifications returns only unread', () => {
    const u = createUser(sqlite)
    const one = insertNotification(db, {
      userId: u,
      type: 'a',
      payload: {},
    })
    insertNotification(db, { userId: u, type: 'b', payload: {} })
    insertNotification(db, { userId: u, type: 'c', payload: {} })

    expect(countUnreadNotifications(db, u)).toBe(3)
    markNotificationRead(db, one)
    expect(countUnreadNotifications(db, u)).toBe(2)
  })

  it('supports subscriptionId link for drill-through', () => {
    const u = createUser(sqlite)
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      ownerId: u,
    })
    insertNotification(db, {
      userId: u,
      type: 'added_to_sub',
      subscriptionId: sub.id,
      payload: {},
    })

    const rows = listNotifications(db, u)
    expect(rows[0].subscriptionId).toBe(sub.id)
  })
})
