import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import { insertNotification } from '@/lib/notifications'
import {
  handleListNotifications,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
} from '@/lib/api-handlers'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A6 notifications endpoints', () => {
  it('handleListNotifications returns latest-first with unread count', async () => {
    const u = createUser(sqlite)
    await insertNotification(db, { userId: u, type: 'a', payload: {} })
    await insertNotification(db, { userId: u, type: 'b', payload: {} })
    await insertNotification(db, { userId: u, type: 'c', payload: {} })

    const res = await handleListNotifications(db, u)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.unreadCount).toBe(3)
    expect(res.data!.items.map((n) => n.type)).toEqual(['c', 'b', 'a'])
  })

  it('handleMarkNotificationRead flips read_at', async () => {
    const u = createUser(sqlite)
    const id = await insertNotification(db, {
      userId: u,
      type: 'x',
      payload: {},
    })

    const res = await handleMarkNotificationRead(db, u, id)
    expect(res.success).toBe(true)

    const after = await handleListNotifications(db, u)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data!.unreadCount).toBe(0)
  })

  it('cannot mark someone else notification read', async () => {
    const u1 = await createUser(db, { email: 'a@t.com' })
    const u2 = await createUser(db, { email: 'b@t.com' })
    const id = await insertNotification(db, { userId: u2, type: 'x', payload: {} })

    const res = await handleMarkNotificationRead(db, u1, id)
    expect(res.success).toBe(false)
  })

  it('handleMarkAllNotificationsRead clears all my unread', async () => {
    const u = createUser(sqlite)
    await insertNotification(db, { userId: u, type: 'a', payload: {} })
    await insertNotification(db, { userId: u, type: 'b', payload: {} })

    const res = await handleMarkAllNotificationsRead(db, u)
    expect(res.success).toBe(true)

    const after = await handleListNotifications(db, u)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data!.unreadCount).toBe(0)
  })

  it('pagination: limit respected', async () => {
    const u = createUser(sqlite)
    for (let i = 0; i < 75; i++) {
      await insertNotification(db, { userId: u, type: 't', payload: { i } })
    }

    const res = await handleListNotifications(db, u, 20)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.items).toHaveLength(20)
  })
})
