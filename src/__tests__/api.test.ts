import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser, createGroup, addMember } from './helpers'
import * as schema from '@/db/schema'
import { registerUser, loginUser } from '@/lib/auth'
import { createSubscription, generateAndSaveBillingRecords } from '@/lib/db-operations'
import {
  handleCreateGroup,
  handleJoinGroup,
  handleLeaveGroup,
  handleDeleteGroup,
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

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

// --- Auth ---

describe('auth', () => {
  it('registers a new user', () => {
    const result = registerUser(db, {
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

  it('rejects duplicate email', () => {
    registerUser(db, { name: 'A', email: 'dup@test.com', password: 'pass' })
    const result = registerUser(db, { name: 'B', email: 'dup@test.com', password: 'pass' })
    expect('error' in result).toBe(true)
  })

  it('logs in with correct password', () => {
    registerUser(db, { name: 'A', email: 'a@test.com', password: 'pass123' })
    const result = loginUser(db, { email: 'a@test.com', password: 'pass123' })
    expect('id' in result).toBe(true)
  })

  it('rejects wrong password', () => {
    registerUser(db, { name: 'A', email: 'a@test.com', password: 'pass123' })
    const result = loginUser(db, { email: 'a@test.com', password: 'wrong' })
    expect('error' in result).toBe(true)
  })

  it('rejects non-existent email', () => {
    const result = loginUser(db, { email: 'no@test.com', password: 'pass' })
    expect('error' in result).toBe(true)
  })
})

// --- Groups ---

describe('handleCreateGroup', () => {
  it('creates a group and adds creator as member', () => {
    const userId = createUser(sqlite)
    const result = handleCreateGroup(db, userId, { name: 'Roommates' })

    assertSuccess(result)
    expect(result.data!.name).toBe('Roommates')
    expect(result.data!.publicId).toBeDefined()
    expect(result.data!.publicId.length).toBeGreaterThan(5)

    const members = db
      .select()
      .from(schema.groupMembers)
      .where(
        eq(
          schema.groupMembers.groupId,
          result.data!.id
        )
      )
      .all()
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(userId)
  })
})

describe('handleJoinGroup', () => {
  it('joins a group via publicId', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })

    const result = handleJoinGroup(db, userB, group.publicId)
    expect(result.success).toBe(true)

    const members = db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, group.id))
      .all()
    expect(members).toHaveLength(2)
  })

  it('rejects invalid publicId', () => {
    const userId = createUser(sqlite)
    const result = handleJoinGroup(db, userId, 'nonexistent')
    assertFailure(result)
    expect(result.error).toBeDefined()
  })

  it('rejects if already a member', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })

    const result = handleJoinGroup(db, userA, group.publicId)
    expect(result.success).toBe(false)
  })
})

describe('handleLeaveGroup', () => {
  it('lets member leave when no unpaid bills', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    const result = handleLeaveGroup(db, userB, group.id)
    expect(result.success).toBe(true)
  })

  it('blocks creator from leaving', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })

    const result = handleLeaveGroup(db, userA, group.id)
    expect(result.success).toBe(false)
  })

  it('blocks leaving with unpaid bills', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })
    generateAndSaveBillingRecords(db, 1)

    const result = handleLeaveGroup(db, userB, group.id)
    expect(result.success).toBe(false)
  })
})

describe('handleDeleteGroup', () => {
  it('deletes group when all bills paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })

    const result = handleDeleteGroup(db, userA, group.id)
    expect(result.success).toBe(true)

    const found = db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, group.id))
      .get()
    expect(found).toBeUndefined()
  })

  it('rejects non-creator', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    const result = handleDeleteGroup(db, userB, group.id)
    expect(result.success).toBe(false)
  })

  it('rejects deletion with unpaid bills', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })
    generateAndSaveBillingRecords(db, 1)

    const result = handleDeleteGroup(db, userA, group.id)
    expect(result.success).toBe(false)
  })
})

// --- Subscriptions ---

describe('handleCreateSubscription', () => {
  it('creates personal subscription', async () => {
    const userId = createUser(sqlite)
    const result = await handleCreateSubscription(db, userId, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
    })
    assertSuccess(result)
    expect(result.data!.groupId).toBeNull()
  })

  it('creates shared subscription in a group', async () => {
    const userId = createUser(sqlite)
    const group = createGroup(sqlite, { createdBy: userId })

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
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })

    const result = await handleCreateSubscription(db, userB, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      groupId: group.id,
    })
    expect(result.success).toBe(false)
  })
})

describe('handleUpdateSubscription', () => {
  it('updates subscription price', () => {
    const userId = createUser(sqlite)
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const result = handleUpdateSubscription(db, userId, sub.id, { price: 20000 })
    expect(result.success).toBe(true)

    const updated = db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
      .get()
    expect(updated!.price).toBe(20000)
  })

  it('rejects update by non-owner', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })

    const result = handleUpdateSubscription(db, userB, sub.id, { price: 20000 })
    expect(result.success).toBe(false)
  })
})

describe('handleDeleteSubscription', () => {
  it('hard deletes when no unpaid bills', () => {
    const userId = createUser(sqlite)
    const sub = createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const result = handleDeleteSubscription(db, userId, sub.id)
    expect(result.success).toBe(true)

    const found = db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
      .get()
    expect(found).toBeUndefined()
  })

  it('soft deletes (marks inactive) when unpaid bills exist', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })
    generateAndSaveBillingRecords(db, sub.id)

    const result = handleDeleteSubscription(db, userA, sub.id)
    expect(result.success).toBe(true)

    const found = db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, sub.id))
      .get()
    expect(found).toBeDefined()
    expect(found!.inactive).toBe(1)
  })
})

// --- Billing ---

describe('handleMarkPaid', () => {
  it('marks a bill as paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })
    generateAndSaveBillingRecords(db, 1)

    const bills = db.select().from(schema.billingRecords).all()
    const result = handleMarkPaid(db, userB, bills[0].id)
    expect(result.success).toBe(true)

    const updated = db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))
      .get()
    expect(updated!.isPaid).toBe(1)
  })

  it('rejects marking someone else bill as paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const userC = createUser(sqlite, { email: 'c@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })
    generateAndSaveBillingRecords(db, 1)

    const bills = db.select().from(schema.billingRecords).all()
    const result = handleMarkPaid(db, userC, bills[0].id)
    expect(result.success).toBe(false)
  })
})

// --- Dashboard ---

describe('handleGetDashboard', () => {
  it('returns spending summary and pending bills', async () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })

    // Personal sub
    createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userB,
    })

    // Shared sub
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
    createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })
    generateAndSaveBillingRecords(db, 2)

    const result = await handleGetDashboard(db, userB)
    expect(result.monthlyTotal).toBe(10500) // 1500 + 18000/2
    expect(result.pendingBills).toHaveLength(1)
    expect(result.subscriptions).toHaveLength(2)
  })
})
