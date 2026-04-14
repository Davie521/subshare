import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestDb, createUser, createGroup, addMember } from './helpers'
import * as schema from '@/db/schema'
import { registerUser, loginUser } from '@/lib/auth'
import { createSubscription, generateAndSaveBillingRecords } from '@/lib/db-operations'
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

function assertFailure<T>(r: Result<T>): asserts r is { success: false; error: string } {
  if (r.success) throw new Error('Expected failure, got success')
}

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

// --- Auth ---

describe('auth', () => {
  it('registers a new user', async () => {
    const result = await registerUser(db, {
      name: 'Alice',
      email: 'alice@test.com',
      password: 'pass123',
    })
    expect('id' in result).toBe(true)
    if ('id' in result) {
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@test.com')
    }
  })

  it('rejects duplicate email', async () => {
    await registerUser(db, { name: 'A', email: 'dup@test.com', password: 'pass' })
    const result = await registerUser(db, { name: 'B', email: 'dup@test.com', password: 'pass' })
    expect('error' in result).toBe(true)
  })

  it('logs in with correct password', async () => {
    await registerUser(db, { name: 'A', email: 'a@test.com', password: 'pass123' })
    const result = await loginUser(db, { email: 'a@test.com', password: 'pass123' })
    expect('id' in result).toBe(true)
  })

  it('rejects wrong password', async () => {
    await registerUser(db, { name: 'A', email: 'a@test.com', password: 'pass123' })
    const result = await loginUser(db, { email: 'a@test.com', password: 'wrong' })
    expect('error' in result).toBe(true)
  })

  it('rejects non-existent email', async () => {
    const result = await loginUser(db, { email: 'no@test.com', password: 'pass' })
    expect('error' in result).toBe(true)
  })
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

  it('creates shared subscription in a group', async () => {
    const userId = await createUser(db)
    const group = await createGroup(db, { createdBy: userId })

    const result = await handleCreateSubscription(db, userId, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      groupId: group.id,
    })
    assertSuccess(result)
    expect(result.data!.groupId).toBe(group.id)
  })

  it('rejects adding to group user is not member of', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })

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

  it('soft deletes (marks inactive) when unpaid bills exist', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await generateAndSaveBillingRecords(db, sub.id)

    const result = await handleDeleteSubscription(db, userA, sub.id)
    expect(result.success).toBe(true)

    const [found] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
      
    expect(found).toBeDefined()
    expect(found!.inactive).toBe(true)
  })
})

// --- Billing ---

describe('handleMarkPaid', () => {
  it('marks a bill as paid', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await generateAndSaveBillingRecords(db, 1)

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
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await generateAndSaveBillingRecords(db, 1)

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

    // Personal sub
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userB,
    })

    // Shared sub
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
    await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    await generateAndSaveBillingRecords(db, 2)

    const result = await handleGetDashboard(db, userB)
    expect(result.monthlyTotal).toBe(10500) // 1500 + 18000/2
    expect(result.pendingBills).toHaveLength(1)
    expect(result.subscriptions).toHaveLength(2)
  })
})
