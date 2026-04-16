import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestDb, createUser, addSubMember } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  generateAndSaveBillingRecords,
} from '@/lib/db-operations'
import {
  handleCreateSubscription,
  handleUpdateSubscription,
  handleDeleteSubscription,
  handleMarkPaid,
  handleGetDashboard,
} from '@/lib/api-handlers'

type Result<T> = { success: true; data?: T } | { success: false; error: string }

function assertSuccess<T>(r: Result<T>): asserts r is { success: true; data?: T } {
  if (!r.success) throw new Error(`Expected success, got error: ${r.error}`)
}

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

// --- Subscriptions ---

describe('handleCreateSubscription', () => {
  it('creates personal subscription', async () => {
    const userId = await createUser(db)
    const result = await handleCreateSubscription(db, userId, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
    })
    assertSuccess(result)
    expect(result.data!.name).toBe('Spotify')
  })

  it('creates shared subscription with invitees', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const result = await handleCreateSubscription(db, userA, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [userB],
    })
    assertSuccess(result)

    const members = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.subscriptionId, result.data!.id))

    expect(members).toHaveLength(2) // owner + invitee
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([userA, userB].sort())
  })
})

describe('handleUpdateSubscription', () => {
  it('updates subscription price', async () => {
    const userId = await createUser(db)
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const result = await handleUpdateSubscription(db, userId, sub.id, { price: 20000 })
    expect(result.success).toBe(true)

    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
      
    expect(updated!.price).toBe(20000)
  })

  it('rejects update by non-owner', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })

    const result = await handleUpdateSubscription(db, userB, sub.id, { price: 20000 })
    expect(result.success).toBe(false)
  })

  it('updates refundPolicy', async () => {
    const userId = await createUser(db)
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    // Default is 'payer_absorbs'.
    const [before] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
    expect(before!.refundPolicy).toBe('payer_absorbs')

    const result = await handleUpdateSubscription(db, userId, sub.id, {
      refundPolicy: 'redistribute',
    })
    expect(result.success).toBe(true)

    const [after] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
    expect(after!.refundPolicy).toBe('redistribute')
  })
})

describe('handleDeleteSubscription', () => {
  it('hard deletes when no unpaid bills', async () => {
    const userId = await createUser(db)
    const sub = await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const result = await handleDeleteSubscription(db, userId, sub.id)
    expect(result.success).toBe(true)

    const [found] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
      
    expect(found).toBeUndefined()
  })

  it('hard deletes and wipes all bills even when unpaid bills exist', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addSubMember(sqlite, sub.id, userB)
    await generateAndSaveBillingRecords(db, sub.id)

    const result = await handleDeleteSubscription(db, userA, sub.id)
    expect(result.success).toBe(true)

    const [found] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))

    expect(found).toBeUndefined()

    // All billing records for this sub are cascade-deleted.
    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))
    expect(bills).toHaveLength(0)
  })
})

// --- Billing ---

describe('handleMarkPaid', () => {
  it('marks a bill as paid', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addSubMember(sqlite, sub.id, userB)
    await generateAndSaveBillingRecords(db, sub.id)

    const bills = await db.select().from(schema.billingRecords)
    const result = await handleMarkPaid(db, userB, bills[0].id)
    expect(result.success).toBe(true)

    const [updated] = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))
      
    expect(updated!.isPaid).toBe(true)
  })

  it('rejects marking someone else bill as paid', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const userC = await createUser(db, { email: 'c@test.com' })

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addSubMember(sqlite, sub.id, userB)
    await generateAndSaveBillingRecords(db, sub.id)

    const bills = await db.select().from(schema.billingRecords)
    const result = await handleMarkPaid(db, userC, bills[0].id)
    expect(result.success).toBe(false)
  })
})

// --- Dashboard ---

describe('handleGetDashboard', () => {
  it('returns spending summary and pending bills', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    // Personal sub owned by B
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userB,
    })

    // Shared sub: A owner/payer, B is billed half
    const shared = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await addMemberToSubscription(db, {
      subscriptionId: shared.id,
      userId: userB,
      addedBy: userA,
      addedAt: '2026-06-01',
    })
    await generateAndSaveBillingRecords(db, shared.id)

    const result = await handleGetDashboard(db, userB)
    expect(result.monthlyTotal).toBe(10500) // 1500 + 18000/2
    expect(result.pendingBills).toHaveLength(1)
    expect(result.subscriptions).toHaveLength(2)
  })
})
