import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import { createSubscription } from '@/lib/db-operations'
import {
  insertNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnreadNotifications,
} from '@/lib/notifications'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
})

describe('T10 notifications CRUD', () => {
  it('insertNotification persists row with created_at and null read_at', async () => {
    const u = await createUser(db)
    const id = await insertNotification(db, {
      userId: u,
      type: 'added_to_sub',
      payload: { sub_name: 'Netflix', amount: 540 },
    })
    expect(id).toBeGreaterThan(0)

    const rows = await listNotifications(db, u)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('added_to_sub')
    expect(rows[0].readAt).toBeNull()
    expect(rows[0].createdAt).toMatch(/\d{4}-\d{2}-\d{2}/)
    // payload round-trips through JSON
    expect((rows[0].payload as { sub_name: string }).sub_name).toBe('Netflix')
  })

  it('listNotifications returns latest first', async () => {
    const u = await createUser(db)
    await insertNotification(db, { userId: u, type: 'a', payload: { n: 1 } })
    await insertNotification(db, { userId: u, type: 'b', payload: { n: 2 } })
    await insertNotification(db, { userId: u, type: 'c', payload: { n: 3 } })

    const rows = await listNotifications(db, u)
    expect(rows.map((r) => r.type)).toEqual(['c', 'b', 'a'])
  })

  it('listNotifications scoped to user', async () => {
    const u1 = await createUser(db, { email: 'x@t.com' })
    const u2 = await createUser(db, { email: 'y@t.com' })
    await insertNotification(db, { userId: u1, type: 'x', payload: {} })
    await insertNotification(db, { userId: u2, type: 'y', payload: {} })

    expect((await listNotifications(db, u1)).map((r) => r.type)).toEqual(['x'])
    expect((await listNotifications(db, u2)).map((r) => r.type)).toEqual(['y'])
  })

  it('markNotificationRead flips read_at', async () => {
    const u = await createUser(db)
    const id = await insertNotification(db, {
      userId: u,
      type: 'x',
      payload: {},
    })

    await markNotificationRead(db, id)

    const rows = await listNotifications(db, u)
    expect(rows[0].readAt).not.toBeNull()
  })

  it('markAllNotificationsRead flips all unread for a user', async () => {
    const u = await createUser(db)
    await insertNotification(db, { userId: u, type: 'a', payload: {} })
    await insertNotification(db, { userId: u, type: 'b', payload: {} })
    await insertNotification(db, { userId: u, type: 'c', payload: {} })

    await markAllNotificationsRead(db, u)

    const unread = (await listNotifications(db, u)).filter((r) => r.readAt === null)
    expect(unread).toHaveLength(0)
  })

  it('countUnreadNotifications returns only unread', async () => {
    const u = await createUser(db)
    const one = await insertNotification(db, {
      userId: u,
      type: 'a',
      payload: {},
    })
    await insertNotification(db, { userId: u, type: 'b', payload: {} })
    await insertNotification(db, { userId: u, type: 'c', payload: {} })

    expect(await countUnreadNotifications(db, u)).toBe(3)
    await markNotificationRead(db, one)
    expect(await countUnreadNotifications(db, u)).toBe(2)
  })

  it('supports subscriptionId link for drill-through', async () => {
    const u = await createUser(db)
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      ownerId: u,
    })
    await insertNotification(db, {
      userId: u,
      type: 'added_to_sub',
      subscriptionId: sub.id,
      payload: {},
    })

    const rows = await listNotifications(db, u)
    expect(rows[0].subscriptionId).toBe(sub.id)
  })
})
