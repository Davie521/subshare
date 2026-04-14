import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser, addSubMember } from './helpers'
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
    expect(result.data!.name).toBe('Spotify')
  })

  it('creates shared subscription with members[]', async () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })

    const result = await handleCreateSubscription(db, userA, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [userB],
    })
    assertSuccess(result)

    const members = db
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.subscriptionId, result.data!.id))
      .all()
    expect(members).toHaveLength(2) // owner + invitee
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

    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)
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

    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)
    generateAndSaveBillingRecords(db, sub.id)

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

    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)
    generateAndSaveBillingRecords(db, sub.id)

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
    const netflix = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, netflix.id, userB)
    generateAndSaveBillingRecords(db, netflix.id)

    const result = await handleGetDashboard(db, userB)
    expect(result.monthlyTotal).toBe(10500) // 1500 + 18000/2
    expect(result.pendingBills).toHaveLength(1)
    expect(result.subscriptions).toHaveLength(2)
  })
})
