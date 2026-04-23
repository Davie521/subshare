import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { setupTestDb, createUser, addSubMember } from './helpers'
import type { SqliteShim } from './helpers'
import {
  handleCreateSubscription,
  handleAddMembers,
} from '@/lib/api-handlers'
import {
  getMembersOfSubscription,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'
import * as schema from '@/db/schema'

/**
 * A2 — handleAddMembers lets the current payer/owner add new people
 * to an existing shared subscription.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: SqliteShim

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function bootstrap() {
  const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
  const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
  const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
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

    const members = await getMembersOfSubscription(db, subId)
    expect(members.map((m) => m.userId)).toContain(c)
  })

  it('emits added_to_sub to the new member', async () => {
    const { a, c, subId } = await bootstrap()
    await handleAddMembers(db, a, subId, [c])

    const notifs = (await listNotifications(db, c)).filter(
      (n) => n.type === 'added_to_sub'
    )
    expect(notifs).toHaveLength(1)
    expect(notifs[0].subscriptionId).toBe(subId)
  })

  it('rejects non-owner/non-payer caller', async () => {
    const { b, c, subId } = await bootstrap()
    // B is a member but neither owner nor payer. Adding another member
    // should be denied.
    const d = await createUser(db, { email: 'd@t.com', currency: 'CNY' })

    const res = await handleAddMembers(db, b, subId, [c, d])
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/owner|payer|permission/i)
  })

  it('no-op when adding an existing member (idempotent)', async () => {
    const { a, b, subId } = await bootstrap()
    const before = (await getMembersOfSubscription(db, subId)).length

    const res = await handleAddMembers(db, a, subId, [b])
    expect(res.success).toBe(true)

    expect(await getMembersOfSubscription(db, subId)).toHaveLength(before)
  })

  it('rejects when subscription does not exist', async () => {
    const a = await createUser(db)
    const b = await createUser(db, { email: 'b@t.com' })
    const res = await handleAddMembers(db, a, 9999, [b])
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/not found/i)
  })

  it('P0-4 RED: reactivating a previously-left member generates an R2 pro-rata bill', async () => {
    const { a, c, subId } = await bootstrap()

    // Seed C as a previously-left member via direct DB insert (bypasses the
    // normal add path so no stray R2 bill on today's date conflicts with
    // the rejoin bill we're asserting on).
    await addSubMember(sqlite, subId, c, {
      addedAt: '2026-01-01',
      addedBy: a,
      leftAt: '2026-02-01',
    })

    const res = await handleAddMembers(db, a, subId, [c])
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.reactivated).toBe(1)

    // Expect: a NEW R2 pro-rata bill for C landed on today (the rejoin date).
    const today = new Date().toISOString().slice(0, 10)
    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, subId),
          eq(schema.billingRecords.userId, c),
          eq(schema.billingRecords.billingDate, today)
        )
      )
    expect(bills.length).toBe(1)
  })

  it('P0-4 RED: reactivating a previously-left member emits added_to_sub', async () => {
    const { a, c, subId } = await bootstrap()

    await addSubMember(sqlite, subId, c, {
      addedAt: '2026-01-01',
      addedBy: a,
      leftAt: '2026-02-01',
    })

    await handleAddMembers(db, a, subId, [c])

    const notifs = (await listNotifications(db, c)).filter(
      (n) => n.type === 'added_to_sub'
    )
    expect(notifs).toHaveLength(1)
    expect(notifs[0].subscriptionId).toBe(subId)
  })

  it('P0-7 RED: batch invite — all invitees get the SAME R2 amount (based on final n)', async () => {
    // A is owner/payer of a ¥99 Netflix sub (no other members yet).
    // A invites Albert and Magic in one call.
    // Before fix: Albert's share = 99/2 (seen n=2), Magic's = 99/3 (seen n=3)
    //             → different R2 amounts, "first-one-pays-more" unfairness.
    // After fix:  both use final n=3 → same R2 amount.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const albert = await createUser(db, { email: 'albert@t.com', currency: 'CNY' })
    const magic = await createUser(db, { email: 'magic@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 9900,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    await handleAddMembers(db, a, subId, [albert, magic])

    const today = new Date().toISOString().slice(0, 10)
    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, subId),
          eq(schema.billingRecords.billingDate, today)
        )
      )
    const albertBill = bills.find((b) => b.userId === albert)
    const magicBill = bills.find((b) => b.userId === magic)

    expect(albertBill).toBeDefined()
    expect(magicBill).toBeDefined()
    expect(albertBill!.amount).toBe(magicBill!.amount)
  })

  it('P0-7 RED: handleCreateSubscription with multiple invitees gives all the same R2', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const albert = await createUser(db, { email: 'albert@t.com', currency: 'CNY' })
    const magic = await createUser(db, { email: 'magic@t.com', currency: 'CNY' })

    // Create sub AND invite both in one call → same batch semantics.
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 9900,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      members: [albert, magic],
    })
    if (!created.success) throw new Error(created.error)
    const subId = created.data!.id

    const today = new Date().toISOString().slice(0, 10)
    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(
        and(
          eq(schema.billingRecords.subscriptionId, subId),
          eq(schema.billingRecords.billingDate, today)
        )
      )

    const albertBill = bills.find((b) => b.userId === albert)
    const magicBill = bills.find((b) => b.userId === magic)
    expect(albertBill?.amount).toBe(magicBill?.amount)
  })

  it('P2 RED: payer self-adding is filtered out (noop, not an error)', async () => {
    // handleAddMembers.invitees.filter(id => id !== actorId) should drop
    // the payer from the list. Returns 0/0/0 counts, no error.
    const { a, subId } = await bootstrap()
    const res = await handleAddMembers(db, a, subId, [a])
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data!.added).toBe(0)
    expect(res.data!.reactivated).toBe(0)
    expect(res.data!.errors).toHaveLength(0)
  })

  it('P0-4 RED: reactivating preserves friendship (no-op on unique)', async () => {
    const { a, c, subId } = await bootstrap()

    await addSubMember(sqlite, subId, c, {
      addedAt: '2026-01-01',
      addedBy: a,
      leftAt: '2026-02-01',
    })

    // No friendship row exists from direct addSubMember — reactivate should
    // create one (same behaviour as fresh add).
    await handleAddMembers(db, a, subId, [c])

    const friendships = await db.select().from(schema.friendships)
    const [lo, hi] = a < c ? [a, c] : [c, a]
    const pair = friendships.find(
      (f) => f.userAId === lo && f.userBId === hi
    )
    expect(pair).toBeDefined()
  })
})
