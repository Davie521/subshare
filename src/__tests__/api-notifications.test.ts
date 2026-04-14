import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import { insertNotification } from '@/lib/notifications'
import {
  handleListNotifications,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
} from '@/lib/api-handlers'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A6 notifications endpoints', () => {
  it('handleListNotifications returns latest-first with unread count', () => {
    const u = createUser(sqlite)
    insertNotification(db, { userId: u, type: 'a', payload: {} })
    insertNotification(db, { userId: u, type: 'b', payload: {} })
    insertNotification(db, { userId: u, type: 'c', payload: {} })

    const res = handleListNotifications(db, u)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.unreadCount).toBe(3)
    expect(res.data!.items.map((n) => n.type)).toEqual(['c', 'b', 'a'])
  })

  it('handleMarkNotificationRead flips read_at', () => {
    const u = createUser(sqlite)
    const id = insertNotification(db, {
      userId: u,
      type: 'x',
      payload: {},
    })

    const res = handleMarkNotificationRead(db, u, id)
    expect(res.success).toBe(true)

    const after = handleListNotifications(db, u)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data!.unreadCount).toBe(0)
  })

  it('cannot mark someone else notification read', () => {
    const u1 = createUser(sqlite, { email: 'a@t.com' })
    const u2 = createUser(sqlite, { email: 'b@t.com' })
    const id = insertNotification(db, { userId: u2, type: 'x', payload: {} })

    const res = handleMarkNotificationRead(db, u1, id)
    expect(res.success).toBe(false)
  })

  it('handleMarkAllNotificationsRead clears all my unread', () => {
    const u = createUser(sqlite)
    insertNotification(db, { userId: u, type: 'a', payload: {} })
    insertNotification(db, { userId: u, type: 'b', payload: {} })

    const res = handleMarkAllNotificationsRead(db, u)
    expect(res.success).toBe(true)

    const after = handleListNotifications(db, u)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data!.unreadCount).toBe(0)
  })

  it('pagination: limit respected', () => {
    const u = createUser(sqlite)
    for (let i = 0; i < 75; i++) {
      insertNotification(db, { userId: u, type: 't', payload: { i } })
    }

    const res = handleListNotifications(db, u, 20)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.items).toHaveLength(20)
  })
})
