import { describe, it, expect, beforeEach } from 'vitest'
import { eq, and } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { setupTestDb, createUser, addSubMember, type TestDb, type SqliteShim } from './helpers'
import { editMemberAddedAt } from '@/lib/engine/edit-added-at'

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const env = await setupTestDb()
  db = env.db
  sqlite = env.sqlite
})

async function makeSub(opts: {
  payerId: number
  ownerId?: number
  price: number
  startDate: string
}): Promise<number> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      name: 'Test Sub',
      price: opts.price,
      currency: 'USD',
      nextPayment: opts.startDate,
      startDate: opts.startDate,
      ownerId: opts.ownerId ?? opts.payerId,
      payerId: opts.payerId,
    })
    .returning({ id: schema.subscriptions.id })
  return row.id
}

// ────────────────────────────────────────────────────────────────────
// A. Permission
// ────────────────────────────────────────────────────────────────────

describe('editMemberAddedAt — permission', () => {
  it('owner can edit any member', async () => {
    const owner = await createUser(db, { email: 'owner@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-03' })

    const out = await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2026-04-15',
      today: '2026-05-15',
    })
    expect(out.affectedMonths.length).toBeGreaterThan(0)
  })

  it('non-owner non-payer member cannot edit (403-style throw)', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const m3 = await createUser(db, { email: 'm3@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m3, { addedAt: '2026-04-01' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: m3,
        actorUserId: m2,
        newAddedAt: '2026-04-15',
        today: '2026-05-15',
      })
    ).rejects.toThrow(/owner|forbidden|permission/i)
  })

  it('payer who is NOT owner cannot edit (owner-only by design)', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const payerOnly = await createUser(db, { email: 'p@test.com' })
    const m3 = await createUser(db, { email: 'm3@test.com' })
    const subId = await makeSub({
      payerId: payerOnly,
      ownerId: owner,
      price: 20000,
      startDate: '2026-04-01',
    })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, payerOnly, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m3, { addedAt: '2026-04-01' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: m3,
        actorUserId: payerOnly,
        newAddedAt: '2026-04-15',
        today: '2026-05-15',
      })
    ).rejects.toThrow(/owner|forbidden|permission/i)
  })

  it('member trying to edit themselves cannot (still owner-only)', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: m2,
        actorUserId: m2,
        newAddedAt: '2026-04-15',
        today: '2026-05-15',
      })
    ).rejects.toThrow(/owner|forbidden|permission/i)
  })

  it('owner editing themselves is allowed', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-01' })

    const out = await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: owner,
      actorUserId: owner,
      newAddedAt: '2026-04-10',
      today: '2026-05-15',
    })
    expect(out.affectedMonths.length).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────────────
// B. Date range validation
// ────────────────────────────────────────────────────────────────────

describe('editMemberAddedAt — date range', () => {
  it('newAddedAt < sub.startDate → throws', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-15' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: m2,
        actorUserId: owner,
        newAddedAt: '2026-03-15', // before startDate 2026-04-01
        today: '2026-05-15',
      })
    ).rejects.toThrow(/startDate|start date|earliest/i)
  })

  it('newAddedAt > today → throws', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-15' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: m2,
        actorUserId: owner,
        newAddedAt: '2026-06-01', // future
        today: '2026-05-15',
      })
    ).rejects.toThrow(/today|future|after/i)
  })

  it('newAddedAt = startDate is allowed (boundary inclusive)', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-15' })

    const out = await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2026-04-01',
      today: '2026-05-15',
    })
    expect(out.affectedMonths.length).toBeGreaterThan(0)
  })

  it('newAddedAt = today is allowed (boundary inclusive)', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-04-15' })

    const out = await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2026-05-15',
      today: '2026-05-15',
    })
    expect(out.affectedMonths.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────────────
// C. 6-month horizon window
// ────────────────────────────────────────────────────────────────────

describe('editMemberAddedAt — 6-month horizon', () => {
  it('newAddedAt within 6-month window is allowed', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    // Sub created long ago, member added 5 months back, want to edit.
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2025-01-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2025-01-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-01-15' })

    // today = 2026-05-15. 6-month window: earliest = 2025-11-01 (or thereabouts).
    // newAddedAt = 2025-12-01 is within window → allowed.
    const out = await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2025-12-01',
      today: '2026-05-15',
    })
    expect(out.affectedMonths.length).toBeGreaterThan(0)
  })

  it('newAddedAt before 6-month window → throws', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2025-01-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2025-01-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2025-06-15' })

    // today = 2026-05-15. 7 months ago = 2025-10-15. Outside window.
    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: m2,
        actorUserId: owner,
        newAddedAt: '2025-08-01',
        today: '2026-05-15',
      })
    ).rejects.toThrow(/horizon|window|6.*month|too far/i)
  })
})

// ────────────────────────────────────────────────────────────────────
// D. Side effects
// ────────────────────────────────────────────────────────────────────

describe('editMemberAddedAt — side effects', () => {
  it('updates subscription_members.added_at', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-03' })

    await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2026-04-15',
      today: '2026-05-15',
    })

    const [row] = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, subId),
          eq(schema.subscriptionMembers.userId, m2)
        )
      )
    expect(row.addedAt).toBe('2026-04-15')
  })

  it('returns affected month range (min(old,new) to today)', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-03-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-03-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-03' })

    // Backdating from 5/3 to 3/15 → affects March, April, May.
    const out = await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2026-03-15',
      today: '2026-05-15',
    })
    expect(out.affectedMonths).toContain('2026-03')
    expect(out.affectedMonths).toContain('2026-04')
    expect(out.affectedMonths).toContain('2026-05')
  })

  it('triggers recompute that produces bills/adjustments for affected months', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const m2 = await createUser(db, { email: 'm2@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })
    await addSubMember(sqlite, subId, m2, { addedAt: '2026-05-03' })

    await editMemberAddedAt(db, {
      subscriptionId: subId,
      targetUserId: m2,
      actorUserId: owner,
      newAddedAt: '2026-04-15',
      today: '2026-05-15',
    })

    const aprilBills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, subId))
      .then((rows) => rows.filter((r) => r.billingDate.startsWith('2026-04')))
    // After backdate, m2 should have an April bill (didn't before).
    expect(aprilBills.find((b) => b.userId === m2)).toBeDefined()
  })

  it('subscription not found → throws', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    await expect(
      editMemberAddedAt(db, {
        subscriptionId: 9999,
        targetUserId: owner,
        actorUserId: owner,
        newAddedAt: '2026-05-01',
        today: '2026-05-15',
      })
    ).rejects.toThrow(/subscription|not found/i)
  })

  it('target user is not a member → throws', async () => {
    const owner = await createUser(db, { email: 'o@test.com' })
    const stranger = await createUser(db, { email: 's@test.com' })
    const subId = await makeSub({ payerId: owner, price: 20000, startDate: '2026-04-01' })
    await addSubMember(sqlite, subId, owner, { addedAt: '2026-04-01' })

    await expect(
      editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId: stranger,
        actorUserId: owner,
        newAddedAt: '2026-04-15',
        today: '2026-05-15',
      })
    ).rejects.toThrow(/member|not found/i)
  })
})
