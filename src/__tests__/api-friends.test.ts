import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  handleCreateSubscription,
  handleListFriends,
} from '@/lib/api-handlers'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A7 handleListFriends', () => {
  it('returns empty when no friendships', async () => {
    const a = await createUser(db)
    const res = await handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toEqual([])
  })

  it('lists friends created via addMember', async () => {
    const a = await createUser(db, { name: 'Alice', email: 'a@t.com' })
    const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
    const c = await createUser(db, { name: 'Carol', email: 'c@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b, c],
    })

    const res = await handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    const names = res.data!.map((f) => f.displayName).sort()
    expect(names).toEqual(['Bob', 'Carol'])
  })

  it('omits email by default (show_email=false)', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const res = await handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data![0].email).toBeUndefined()
  })

  it('includes email when target user has show_email=true', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
    await sqlite.prepare('UPDATE users SET show_email = 1 WHERE id = ?').run(b)

    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const res = await handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data![0].email).toBe('b@t.com')
  })

  it('symmetric: A and B both see each other as friends', async () => {
    const a = await createUser(db, { name: 'Alice', email: 'a@t.com' })
    const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const aFriends = await handleListFriends(db, a)
    const bFriends = await handleListFriends(db, b)
    if (!aFriends.success || !bFriends.success) return
    expect(aFriends.data!.map((f) => f.userId)).toEqual([b])
    expect(bFriends.data!.map((f) => f.userId)).toEqual([a])
  })
})
