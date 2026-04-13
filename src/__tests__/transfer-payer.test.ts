import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  transferPayer,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

function setup3() {
  const a = createUser(sqlite, { email: 'a@t.com' })
  const b = createUser(sqlite, { email: 'b@t.com' })
  const c = createUser(sqlite, { email: 'c@t.com' })
  const sub = createSubscription(db, {
    name: 'Netflix',
    price: 15000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: a,
  })
  addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: b,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: c,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  return { a, b, c, sub }
}

describe('T13 transferPayer', () => {
  it('updates subscriptions.payer_id', () => {
    const { b, sub } = setup3()
    transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const row = sqlite
      .prepare('SELECT payer_id FROM subscriptions WHERE id = ?')
      .get(sub.id) as { payer_id: number }
    expect(row.payer_id).toBe(b)
  })

  it('emits payer_changed to ALL active members (including old and new payer)', () => {
    const { a, b, c, sub } = setup3()
    transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const payerNotifs = (uid: number) =>
      listNotifications(db, uid).filter((n) => n.type === 'payer_changed')

    expect(payerNotifs(a)).toHaveLength(1) // old payer gets told
    expect(payerNotifs(b)).toHaveLength(1) // new payer gets told
    expect(payerNotifs(c)).toHaveLength(1) // member gets told
  })

  it('notification payload has both old and new payer names', () => {
    const { b, c, sub } = setup3()
    transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const n = listNotifications<{
      sub_name: string
      old_payer_name: string
      new_payer_name: string
    }>(db, c).find((x) => x.type === 'payer_changed')!

    expect(n.payload.sub_name).toBe('Netflix')
    expect(n.payload.old_payer_name).toBeDefined()
    expect(n.payload.new_payer_name).toBeDefined()
    expect(n.payload.old_payer_name).not.toBe(n.payload.new_payer_name)
  })

  it('rejects when newPayerId is not an active member', () => {
    const { sub } = setup3()
    const stranger = createUser(sqlite, { email: 'stranger@t.com' })

    expect(() =>
      transferPayer(db, { subscriptionId: sub.id, newPayerId: stranger })
    ).toThrow(/member/i)
  })

  it('rejects when newPayerId equals current payer (no-op guard)', () => {
    const { a, sub } = setup3()
    expect(() =>
      transferPayer(db, { subscriptionId: sub.id, newPayerId: a })
    ).toThrow(/already/i)
  })

  it('after transfer, new payer is excluded from monthly bills', async () => {
    const { a, b, c, sub } = setup3()
    transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const { generateMonthlyBills } = await import('@/lib/db-operations')
    generateMonthlyBills(db, '2026-05')

    const ids = (
      sqlite
        .prepare(
          "SELECT user_id AS userId FROM billing_records WHERE billing_date = '2026-05-01'"
        )
        .all() as { userId: number }[]
    ).map((r) => r.userId)

    expect(ids).toContain(a)
    expect(ids).toContain(c)
    expect(ids).not.toContain(b) // B is now payer
  })
})
