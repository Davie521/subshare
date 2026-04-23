import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
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
    await sqlite.prepare('UPDATE users SET show_email = true WHERE id = ?').run(b)

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

  it('P2-3: myShare for payer absorbs the floor remainder; non-payer pays perHead', async () => {
    // 2-member sub, price 1001 → perHead = floor(1001/2) = 500.
    // Payer (A) covers the whole ¥1001 and collects 500 from B, so A is
    // out-of-pocket 1001 − 500 = 501. B owes 500.
    const a = await createUser(db, { name: 'Alice', email: 'a@t.com' })
    const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
    await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 1001,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [b],
    })

    const aView = await handleListFriends(db, a)
    if (!aView.success) return
    const bFromA = aView.data!.find((f) => f.userId === b)
    expect(bFromA?.sharedSubs[0].myShare).toBe(501) // payer's OOP

    const bView = await handleListFriends(db, b)
    if (!bView.success) return
    const aFromB = bView.data!.find((f) => f.userId === a)
    expect(aFromB?.sharedSubs[0].myShare).toBe(500) // non-payer's share
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
