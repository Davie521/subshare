import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleGetSubscription,
  handleUpdateSubscription,
} from '@/lib/api-handlers'
import { leaveSubscription } from '@/lib/db-operations'

describe('subscription_members.personalTags column', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  it('defaults to [] for a freshly-created member row', async () => {
    const ownerId = await createUser(db, { email: 'o@t.com' })
    const memberId = await createUser(db, { email: 'm@t.com' })
    const created = await handleCreateSubscription(db, ownerId, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [memberId],
    })
    if (!created.success) throw new Error(created.error)

    // Owner row (auto-added at create time).
    const [ownerRow] = await db
      .select({ personalTags: schema.subscriptionMembers.personalTags })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, created.data!.id),
          eq(schema.subscriptionMembers.userId, ownerId)
        )
      )
    expect(ownerRow?.personalTags).toEqual([])

    // Invited member row.
    const [memberRow] = await db
      .select({ personalTags: schema.subscriptionMembers.personalTags })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, created.data!.id),
          eq(schema.subscriptionMembers.userId, memberId)
        )
      )
    expect(memberRow?.personalTags).toEqual([])
  })
})

describe('handleUpdateSubscription personalTags write path', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  /**
   * Three distinct users, three distinct roles:
   *   owner   — created the sub, is the owner
   *   payer   — is the payer (not the owner)
   *   shared  — plain member (not owner, not payer)
   *   outsider — not a member at all
   */
  async function setupTrio() {
    const owner = await createUser(db, { email: 'o@t.com' })
    const payer = await createUser(db, { email: 'p@t.com' })
    const shared = await createUser(db, { email: 's@t.com' })
    const outsider = await createUser(db, { email: 'x@t.com' })
    const created = await handleCreateSubscription(db, owner, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [payer, shared],
      payerId: payer,
    })
    if (!created.success) throw new Error(created.error)
    return { owner, payer, shared, outsider, subId: created.data!.id }
  }

  async function readPersonalTags(subId: number, userId: number) {
    const [row] = await db
      .select({ personalTags: schema.subscriptionMembers.personalTags })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, subId),
          eq(schema.subscriptionMembers.userId, userId)
        )
      )
    return row?.personalTags
  }

  it('shared member (not owner, not payer) can set their own personalTags', async () => {
    const { shared, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, shared, subId, {
      personalTags: [{ label: 'Visa 1234', visibility: 'private' }],
    })
    expect(res.success).toBe(true)
    expect(await readPersonalTags(subId, shared)).toEqual([
      { label: 'Visa 1234', visibility: 'private' },
    ])
  })

  it('owner can set their own personalTags', async () => {
    const { owner, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, owner, subId, {
      personalTags: [{ label: 'Amex 5678', visibility: 'private' }],
    })
    expect(res.success).toBe(true)
    expect(await readPersonalTags(subId, owner)).toEqual([
      { label: 'Amex 5678', visibility: 'private' },
    ])
  })

  it('payer (not owner) can set their own personalTags', async () => {
    const { payer, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, payer, subId, {
      personalTags: [{ label: 'Card X', visibility: 'private' }],
    })
    expect(res.success).toBe(true)
    expect(await readPersonalTags(subId, payer)).toEqual([
      { label: 'Card X', visibility: 'private' },
    ])
  })

  it('outsider cannot set personalTags', async () => {
    const { outsider, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, outsider, subId, {
      personalTags: [{ label: 'intruder', visibility: 'private' }],
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('former member (leftAt set) cannot set personalTags', async () => {
    const { shared, subId } = await setupTrio()
    // Shared leaves — leftAt set, row preserved.
    await leaveSubscription(db, {
      subscriptionId: subId,
      userId: shared,
      leftAt: new Date().toISOString().slice(0, 10),
    })
    const res = await handleUpdateSubscription(db, shared, subId, {
      personalTags: [{ label: 'ghost', visibility: 'private' }],
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('shared member sending { personalTags, name } is rejected (name is owner-only)', async () => {
    const { shared, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, shared, subId, {
      personalTags: [{ label: 'ok', visibility: 'private' }],
      name: 'HIJACKED',
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
    // Ensure the personalTags side-effect didn't land either.
    expect(await readPersonalTags(subId, shared)).toEqual([])
  })

  it('shared member sending { personalTags, tags } is rejected (tags is payer-only)', async () => {
    const { shared, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, shared, subId, {
      personalTags: [{ label: 'ok', visibility: 'private' }],
      tags: [{ label: 'sneaky', visibility: 'public' }],
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('personalTags are normalized — trim, dedupe, cap at 5', async () => {
    const { shared, subId } = await setupTrio()
    const res = await handleUpdateSubscription(db, shared, subId, {
      personalTags: [
        { label: '  Spacey  ', visibility: 'private' },
        { label: 'spacey', visibility: 'private' }, // dup (case-insensitive)
        { label: 't1', visibility: 'private' },
        { label: 't2', visibility: 'private' },
        { label: 't3', visibility: 'private' },
        { label: 't4', visibility: 'private' },
        { label: 't5', visibility: 'private' }, // overflow — capped
      ],
    })
    expect(res.success).toBe(true)
    const stored = await readPersonalTags(subId, shared)
    expect(stored).toEqual([
      { label: 'Spacey', visibility: 'private' },
      { label: 't1', visibility: 'private' },
      { label: 't2', visibility: 'private' },
      { label: 't3', visibility: 'private' },
      { label: 't4', visibility: 'private' },
    ])
  })

  it("user A's personalTags write does not affect user B's row", async () => {
    const { shared, payer, subId } = await setupTrio()
    // B (shared) writes first.
    await handleUpdateSubscription(db, shared, subId, {
      personalTags: [{ label: 'B-tag', visibility: 'private' }],
    })
    // A (payer) writes their own.
    await handleUpdateSubscription(db, payer, subId, {
      personalTags: [{ label: 'A-tag', visibility: 'private' }],
    })
    // Both rows independent.
    expect(await readPersonalTags(subId, shared)).toEqual([
      { label: 'B-tag', visibility: 'private' },
    ])
    expect(await readPersonalTags(subId, payer)).toEqual([
      { label: 'A-tag', visibility: 'private' },
    ])
  })

  it('empty personalTags array clears the bucket', async () => {
    const { shared, subId } = await setupTrio()
    await handleUpdateSubscription(db, shared, subId, {
      personalTags: [{ label: 'temp', visibility: 'private' }],
    })
    const afterSet = await readPersonalTags(subId, shared)
    expect(afterSet).toEqual([{ label: 'temp', visibility: 'private' }])

    await handleUpdateSubscription(db, shared, subId, {
      personalTags: [],
    })
    expect(await readPersonalTags(subId, shared)).toEqual([])
  })
})

describe('handleGetSubscription personalTags read path', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  async function setupTwo() {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
    })
    if (!created.success) throw new Error(created.error)
    return { a, b, subId: created.data!.id }
  }

  it('returns empty personalTags when nothing set', async () => {
    const { a, subId } = await setupTwo()
    const res = await handleGetSubscription(db, a, subId)
    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data!.personalTags).toEqual([])
  })

  it("returns the caller's own personalTags", async () => {
    const { a, subId } = await setupTwo()
    await handleUpdateSubscription(db, a, subId, {
      personalTags: [{ label: 'mine', visibility: 'private' }],
    })
    const res = await handleGetSubscription(db, a, subId)
    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data!.personalTags).toEqual([
      { label: 'mine', visibility: 'private' },
    ])
  })

  it("different users see only their own personalTags, not each other's", async () => {
    const { a, b, subId } = await setupTwo()
    await handleUpdateSubscription(db, a, subId, {
      personalTags: [{ label: 'A-card', visibility: 'private' }],
    })
    await handleUpdateSubscription(db, b, subId, {
      personalTags: [{ label: 'B-card', visibility: 'private' }],
    })

    const resA = await handleGetSubscription(db, a, subId)
    const resB = await handleGetSubscription(db, b, subId)
    if (!resA.success || !resB.success) throw new Error('expected success')
    expect(resA.data!.personalTags).toEqual([
      { label: 'A-card', visibility: 'private' },
    ])
    expect(resB.data!.personalTags).toEqual([
      { label: 'B-card', visibility: 'private' },
    ])
  })

  it('outsider cannot GET the subscription (404)', async () => {
    const { subId } = await setupTwo()
    const outsider = await createUser(db, { email: 'x@t.com' })
    const res = await handleGetSubscription(db, outsider, subId)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('NOT_FOUND')
  })

  it('former member (leftAt set) no longer sees personalTags via GET', async () => {
    const { b, subId } = await setupTwo()
    // B sets personal tags while still a member.
    await handleUpdateSubscription(db, b, subId, {
      personalTags: [{ label: 'B-card', visibility: 'private' }],
    })
    // B leaves.
    await leaveSubscription(db, {
      subscriptionId: subId,
      userId: b,
      leftAt: new Date().toISOString().slice(0, 10),
    })
    // B's GET now 404s — former members don't see the sub at all.
    const res = await handleGetSubscription(db, b, subId)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('NOT_FOUND')
  })
})
