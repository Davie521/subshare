import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  handleCreateSubscription,
  handleUpdateSubscription,
} from '@/lib/api-handlers'
import { listNotifications } from '@/lib/notifications'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A5 handleUpdateSubscription emits price_changed', () => {
  it('price change emits price_changed to each active non-payer member', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b, c],
    })
    if (!created.success) throw new Error(created.error)

    const res = await handleUpdateSubscription(db, a, created.data!.id, {
      price: 30000,
    })
    expect(res.success).toBe(true)

    const priceNotifs = (uid: number) =>
      await listNotifications(db, uid).filter((n) => n.type === 'price_changed')
    expect(priceNotifs(a)).toHaveLength(0)
    expect(priceNotifs(b)).toHaveLength(1)
    expect(priceNotifs(c)).toHaveLength(1)

    const row = await sqlite.prepare('SELECT price FROM subscriptions WHERE id = ?')
      .get(created.data!.id) as { price: number }
    expect(row.price).toBe(30000)
  })

  it('other field updates (name, nextPayment) do not emit price_changed', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)

    await handleUpdateSubscription(db, a, created.data!.id, { name: 'Netflix Plus' })

    const priceNotifs = await listNotifications(db, b).filter(
      (n) => n.type === 'price_changed'
    )
    expect(priceNotifs).toHaveLength(0)
  })

  it('non-owner cannot update', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)

    const res = await handleUpdateSubscription(db, b, created.data!.id, {
      price: 99999,
    })
    expect(res.success).toBe(false)
  })
})
