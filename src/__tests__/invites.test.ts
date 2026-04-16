import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestDb, createUser } from './helpers'
import { createSubscription } from '@/lib/db-operations'
import {
  createInvite,
  getInviteMetadata,
  acceptInvite,
} from '@/lib/invites'
import * as schema from '@/db/schema'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
})

async function createShareableSub(opts: { ownerId: number; currency?: string }) {
  return createSubscription(db, {
    name: 'Netflix',
    price: 10000,
    currency: opts.currency ?? 'CNY',
    nextPayment: '2026-05-01',
    startDate: '2026-04-01',
    ownerId: opts.ownerId,
  })
}

describe('createInvite', () => {
  it('creates a single-use, 7-day-TTL invite for an active member', async () => {
    const owner = await createUser(db)
    const sub = await createShareableSub({ ownerId: owner })

    const res = await createInvite(db, owner, sub.id)
    expect(res.success).toBe(true)
    if (!res.success || !res.data) throw new Error('unreachable')
    expect(res.data.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/)

    const expiresAt = new Date(res.data.expiresAt).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(expiresAt - Date.now()).toBeGreaterThan(sevenDays - 60_000)
    expect(expiresAt - Date.now()).toBeLessThan(sevenDays + 60_000)

    const [row] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, res.data.token))
    expect(row.maxUses).toBe(1)
    expect(row.usedCount).toBe(0)
    expect(row.revokedAt).toBeNull()
  })

  it('rejects non-members with FORBIDDEN', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const outsider = await createUser(db, { email: 'x@t.com' })
    const sub = await createShareableSub({ ownerId: owner })

    const res = await createInvite(db, outsider, sub.id)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('rejects former members (leftAt set) — H3 regression', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const leaver = await createUser(db, { email: 'l@t.com' })
    const sub = await createShareableSub({ ownerId: owner })

    await db.insert(schema.subscriptionMembers).values({
      subscriptionId: sub.id,
      userId: leaver,
      addedBy: owner,
      addedAt: '2026-04-01',
      leftAt: '2026-04-10',
    })

    const res = await createInvite(db, leaver, sub.id)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('returns NOT_FOUND for unknown subscription', async () => {
    const owner = await createUser(db)
    const res = await createInvite(db, owner, 999999)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('NOT_FOUND')
  })
})

describe('getInviteMetadata', () => {
  it('returns sub + inviter on valid token', async () => {
    const owner = await createUser(db, { name: 'Alice' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    const res = await getInviteMetadata(db, created.data.token)
    expect(res.success).toBe(true)
    if (!res.success || !res.data) throw new Error('unreachable')
    expect(res.data.subscriptionId).toBe(sub.id)
    expect(res.data.subscriptionName).toBe('Netflix')
    expect(res.data.inviterName).toBe('Alice')
    expect(res.data.expired).toBe(false)
    expect(res.data.exhausted).toBe(false)
    expect(res.data.revoked).toBe(false)
  })

  it('flags expired tokens', async () => {
    const owner = await createUser(db)
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    await db
      .update(schema.invites)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(schema.invites.token, created.data.token))

    const res = await getInviteMetadata(db, created.data.token)
    if (!res.success || !res.data) throw new Error('unreachable')
    expect(res.data.expired).toBe(true)
  })

  it('flags exhausted tokens', async () => {
    const owner = await createUser(db)
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    await db
      .update(schema.invites)
      .set({ usedCount: 1 })
      .where(eq(schema.invites.token, created.data.token))

    const res = await getInviteMetadata(db, created.data.token)
    if (!res.success || !res.data) throw new Error('unreachable')
    expect(res.data.exhausted).toBe(true)
  })

  it('flags revoked tokens', async () => {
    const owner = await createUser(db)
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    await db
      .update(schema.invites)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.invites.token, created.data.token))

    const res = await getInviteMetadata(db, created.data.token)
    if (!res.success || !res.data) throw new Error('unreachable')
    expect(res.data.revoked).toBe(true)
  })

  it('returns NOT_FOUND for unknown token', async () => {
    const res = await getInviteMetadata(db, 'nonexistent_token_0000')
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('NOT_FOUND')
  })
})

describe('acceptInvite', () => {
  it('adds the user to the sub, forms friendship, and consumes the token', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const joiner = await createUser(db, { email: 'j@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    const res = await acceptInvite(db, joiner, created.data.token)
    expect(res.success).toBe(true)
    if (!res.success || !res.data) throw new Error('unreachable')
    expect(res.data.subscriptionId).toBe(sub.id)

    const members = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.subscriptionId, sub.id))
    const joinerRow = members.find((m) => m.userId === joiner)
    expect(joinerRow).toBeDefined()
    expect(joinerRow!.addedBy).toBe(owner)
    expect(joinerRow!.leftAt).toBeNull()

    const friendships = await db.select().from(schema.friendships)
    expect(friendships).toHaveLength(1)
    const lo = Math.min(owner, joiner)
    const hi = Math.max(owner, joiner)
    expect(friendships[0].userAId).toBe(lo)
    expect(friendships[0].userBId).toBe(hi)

    const [inviteRow] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, created.data.token))
    expect(inviteRow.usedCount).toBe(1)
  })

  it('rejects expired tokens without consuming them', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const joiner = await createUser(db, { email: 'j@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    await db
      .update(schema.invites)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(schema.invites.token, created.data.token))

    const res = await acceptInvite(db, joiner, created.data.token)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('rejects exhausted tokens', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const joiner = await createUser(db, { email: 'j@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    await db
      .update(schema.invites)
      .set({ usedCount: 1 })
      .where(eq(schema.invites.token, created.data.token))

    const res = await acceptInvite(db, joiner, created.data.token)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('rejects revoked tokens', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const joiner = await createUser(db, { email: 'j@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    await db
      .update(schema.invites)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.invites.token, created.data.token))

    const res = await acceptInvite(db, joiner, created.data.token)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('is idempotent when already an active member — does not consume the token', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    const res = await acceptInvite(db, owner, created.data.token)
    expect(res.success).toBe(true)

    const [inviteRow] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, created.data.token))
    expect(inviteRow.usedCount).toBe(0)
  })

  it('lets a previously-left member rejoin and consumes the token', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const leaver = await createUser(db, { email: 'l@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    await db.insert(schema.subscriptionMembers).values({
      subscriptionId: sub.id,
      userId: leaver,
      addedBy: owner,
      addedAt: '2026-04-01',
      leftAt: '2026-04-05',
    })

    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    const res = await acceptInvite(db, leaver, created.data.token)
    expect(res.success).toBe(true)

    const [row] = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.userId, leaver))
    expect(row.leftAt).toBeNull()

    const [inviteRow] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, created.data.token))
    expect(inviteRow.usedCount).toBe(1)
  })

  it('returns NOT_FOUND for unknown tokens', async () => {
    const joiner = await createUser(db)
    const res = await acceptInvite(db, joiner, 'nonexistent_token_0000')
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.code).toBe('NOT_FOUND')
  })

  it('second acceptance attempt on a maxUses=1 invite fails', async () => {
    const owner = await createUser(db, { email: 'o@t.com' })
    const first = await createUser(db, { email: 'f@t.com' })
    const second = await createUser(db, { email: 's@t.com' })
    const sub = await createShareableSub({ ownerId: owner })
    const created = await createInvite(db, owner, sub.id)
    if (!created.success || !created.data) throw new Error('unreachable')

    const ok = await acceptInvite(db, first, created.data.token)
    expect(ok.success).toBe(true)

    const blocked = await acceptInvite(db, second, created.data.token)
    expect(blocked.success).toBe(false)
    if (blocked.success) throw new Error('unreachable')
    expect(blocked.code).toBe('FORBIDDEN')

    const [inviteRow] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, created.data.token))
    expect(inviteRow.usedCount).toBe(1)
  })
})
