import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  handleCreateSubscription,
  handleAddMembers,
} from '@/lib/api-handlers'
import { getMembersOfSubscription } from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

/**
 * A2 — handleAddMembers lets the current payer/owner add new people
 * to an existing shared subscription.
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function bootstrap() {
  const a = createUser(sqlite, { email: 'a@t.com', currency: 'CNY' })
  const b = createUser(sqlite, { email: 'b@t.com', currency: 'CNY' })
  const c = createUser(sqlite, { email: 'c@t.com', currency: 'CNY' })
  const res = await handleCreateSubscription(db, a, {
    name: 'Netflix',
    price: 10000,
    currency: 'CNY',
    nextPayment: '2026-05-01',
    members: [b],
  })
  if (!res.success) throw new Error(res.error)
  return { a, b, c, subId: res.data!.id }
}

describe('A2 handleAddMembers', () => {
  it('adds new members to an existing subscription', async () => {
    const { a, c, subId } = await bootstrap()

    const res = await handleAddMembers(db, a, subId, [c])
    expect(res.success).toBe(true)

    const members = getMembersOfSubscription(db, subId)
    expect(members.map((m) => m.userId)).toContain(c)
  })

  it('emits added_to_sub to the new member', async () => {
    const { a, c, subId } = await bootstrap()
    await handleAddMembers(db, a, subId, [c])

    const notifs = listNotifications(db, c).filter(
      (n) => n.type === 'added_to_sub'
    )
    expect(notifs).toHaveLength(1)
    expect(notifs[0].subscriptionId).toBe(subId)
  })

  it('rejects non-owner/non-payer caller', async () => {
    const { b, c, subId } = await bootstrap()
    // B is a member but neither owner nor payer. Adding another member
    // should be denied.
    const d = createUser(sqlite, { email: 'd@t.com', currency: 'CNY' })

    const res = await handleAddMembers(db, b, subId, [c, d])
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/owner|payer|permission/i)
  })

  it('no-op when adding an existing member (idempotent)', async () => {
    const { a, b, subId } = await bootstrap()
    const before = getMembersOfSubscription(db, subId).length

    const res = await handleAddMembers(db, a, subId, [b])
    expect(res.success).toBe(true)

    expect(getMembersOfSubscription(db, subId)).toHaveLength(before)
  })

  it('rejects when subscription does not exist', async () => {
    const a = createUser(sqlite)
    const b = createUser(sqlite, { email: 'b@t.com' })
    const res = await handleAddMembers(db, a, 9999, [b])
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/not found/i)
  })
})
