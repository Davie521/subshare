import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  handleCreateSubscription,
  handleUpdateSubscription,
} from '@/lib/api-handlers'
import { listNotifications } from '@/lib/notifications'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('A5 handleUpdateSubscription emits price_changed', () => {
  it('price change emits price_changed to each active non-payer member', async () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const c = createUser(sqlite, { email: 'c@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b, c],
    })
    if (!created.success) throw new Error(created.error)

    const res = handleUpdateSubscription(db, a, created.data!.id, {
      price: 30000,
    })
    expect(res.success).toBe(true)

    const priceNotifs = (uid: number) =>
      listNotifications(db, uid).filter((n) => n.type === 'price_changed')
    expect(priceNotifs(a)).toHaveLength(0)
    expect(priceNotifs(b)).toHaveLength(1)
    expect(priceNotifs(c)).toHaveLength(1)

    const row = sqlite
      .prepare('SELECT price FROM subscriptions WHERE id = ?')
      .get(created.data!.id) as { price: number }
    expect(row.price).toBe(30000)
  })

  it('other field updates (name, nextPayment) do not emit price_changed', async () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)

    handleUpdateSubscription(db, a, created.data!.id, { name: 'Netflix Plus' })

    const priceNotifs = listNotifications(db, b).filter(
      (n) => n.type === 'price_changed'
    )
    expect(priceNotifs).toHaveLength(0)
  })

  it('non-owner cannot update', async () => {
    const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
    const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)

    const res = handleUpdateSubscription(db, b, created.data!.id, {
      price: 99999,
    })
    expect(res.success).toBe(false)
  })
})
