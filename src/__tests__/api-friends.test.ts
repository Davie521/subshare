import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  handleCreateSubscription,
  handleListFriends,
} from '@/lib/api-handlers'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A7 handleListFriends', () => {
  it('returns empty when no friendships', () => {
    const a = createUser(sqlite)
    const res = handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toEqual([])
  })

  it('lists friends created via addMember', async () => {
    const a = createUser(sqlite, { name: 'Alice', email: 'a@t.com' })
    const b = createUser(sqlite, { name: 'Bob', email: 'b@t.com' })
    const c = createUser(sqlite, { name: 'Carol', email: 'c@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b, c],
    })

    const res = handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    const names = res.data!.map((f) => f.displayName).sort()
    expect(names).toEqual(['Bob', 'Carol'])
  })

  it('omits email by default (show_email=false)', async () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { name: 'Bob', email: 'b@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const res = handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data![0].email).toBeUndefined()
  })

  it('includes email when target user has show_email=true', async () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { name: 'Bob', email: 'b@t.com' })
    sqlite.prepare('UPDATE users SET show_email = 1 WHERE id = ?').run(b)

    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const res = handleListFriends(db, a)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data![0].email).toBe('b@t.com')
  })

  it('symmetric: A and B both see each other as friends', async () => {
    const a = createUser(sqlite, { name: 'Alice', email: 'a@t.com' })
    const b = createUser(sqlite, { name: 'Bob', email: 'b@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const aFriends = handleListFriends(db, a)
    const bFriends = handleListFriends(db, b)
    if (!aFriends.success || !bFriends.success) return
    expect(aFriends.data!.map((f) => f.userId)).toEqual([b])
    expect(bFriends.data!.map((f) => f.userId)).toEqual([a])
  })
})
