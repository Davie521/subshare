import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { eq, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser, createGroup, addMember } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  getSubscriptionsForUser,
  getGroupWithMembers,
  generateAndSaveBillingRecords,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
  canLeaveGroup,
  removeGroupMember,
} from '@/lib/db-operations'

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('createSubscription', () => {
  it('creates a personal subscription', () => {
    const userId = createUser(sqlite)
    const sub = createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    expect(sub.id).toBeDefined()
    expect(sub.name).toBe('Spotify')
    expect(sub.groupId).toBeNull()
  })

  it('creates a shared subscription in a group', () => {
    const userId = createUser(sqlite)
    const group = createGroup(sqlite, { createdBy: userId })

    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
      groupId: group.id,
    })

    expect(sub.groupId).toBe(group.id)
  })
})

describe('getSubscriptionsForUser', () => {
  it('returns personal subscriptions', () => {
    const userId = createUser(sqlite)
    createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const subs = getSubscriptionsForUser(db, userId)
    expect(subs).toHaveLength(1)
    expect(subs[0].name).toBe('Spotify')
    expect(subs[0].memberCount).toBe(1)
  })

  it('returns shared subscriptions the user is a member of', () => {
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

    const subsA = getSubscriptionsForUser(db, userA)
    const subsB = getSubscriptionsForUser(db, userB)

    expect(subsA).toHaveLength(1)
    expect(subsA[0].memberCount).toBe(2)

    expect(subsB).toHaveLength(1)
    expect(subsB[0].memberCount).toBe(2)
  })

  it('does not return other users personal subscriptions', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })

    createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })

    const subsB = getSubscriptionsForUser(db, userB)
    expect(subsB).toHaveLength(0)
  })
})

describe('getGroupWithMembers', () => {
  it('returns group info with member list', () => {
    const userA = createUser(sqlite, { name: 'Alice', email: 'a@test.com' })
    const userB = createUser(sqlite, { name: 'Bob', email: 'b@test.com' })
    const group = createGroup(sqlite, { name: 'Roommates', createdBy: userA })
    addMember(sqlite, group.id, userB)

    const result = getGroupWithMembers(db, group.id)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Roommates')
    expect(result!.members).toHaveLength(2)
    expect(result!.members.map((m) => m.name)).toContain('Alice')
    expect(result!.members.map((m) => m.name)).toContain('Bob')
  })

  it('returns null for non-existent group', () => {
    const result = getGroupWithMembers(db, 999)
    expect(result).toBeNull()
  })
})

describe('generateAndSaveBillingRecords', () => {
  it('generates billing records for non-payer members', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const userC = createUser(sqlite, { email: 'c@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
    addMember(sqlite, group.id, userC)

    const sub = createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })

    const count = generateAndSaveBillingRecords(db, sub.id)
    expect(count).toBe(2) // B and C

    const bills = db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))
      .all()

    expect(bills).toHaveLength(2)
    expect(bills.every((b) => b.amount === 6000)).toBe(true) // 18000/3
    expect(bills.find((b) => b.userId === userA)).toBeUndefined()
  })

  it('does not generate duplicate records for same billing date', () => {
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
    generateAndSaveBillingRecords(db, sub.id) // second call

    const bills = db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))
      .all()

    expect(bills).toHaveLength(1) // no duplicates
  })

  it('skips inactive subscriptions', () => {
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

    // Mark as inactive
    db.update(schema.subscriptions)
      .set({ inactive: 1 })
      .where(eq(schema.subscriptions.id, sub.id))
      .run()

    const count = generateAndSaveBillingRecords(db, sub.id)
    expect(count).toBe(0)
  })
})

describe('getPendingBills', () => {
  it('returns unpaid bills for a user', () => {
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

    const bills = getPendingBills(db, userB)
    expect(bills).toHaveLength(1)
    expect(bills[0].subscriptionName).toBe('Netflix')
    expect(bills[0].amount).toBe(9000) // 18000/2
    expect(bills[0].isPaid).toBe(0)
  })

  it('does not return paid bills', () => {
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

    // Mark as paid
    const allBills = db
      .select()
      .from(schema.billingRecords)
      .all()
    markBillPaid(db, allBills[0].id)

    const pending = getPendingBills(db, userB)
    expect(pending).toHaveLength(0)
  })
})

describe('markBillPaid', () => {
  it('marks a bill as paid with timestamp', () => {
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

    const bills = db.select().from(schema.billingRecords).all()
    markBillPaid(db, bills[0].id)

    const updated = db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))
      .get()

    expect(updated!.isPaid).toBe(1)
    expect(updated!.paidAt).toBeDefined()
  })
})

describe('canLeaveGroup and removeGroupMember', () => {
  it('allows member to leave when no unpaid bills', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    expect(canLeaveGroup(db, group.id, userB)).toBe(true)
  })

  it('prevents member from leaving with unpaid bills', () => {
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

    expect(canLeaveGroup(db, group.id, userB)).toBe(false)
  })

  it('prevents creator from leaving', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })

    expect(canLeaveGroup(db, group.id, userA)).toBe(false)
  })

  it('removes member from group', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)

    removeGroupMember(db, group.id, userB)

    const members = db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, group.id))
      .all()

    expect(members).toHaveLength(1) // only creator left
  })
})

describe('getMonthlySpendingData', () => {
  it('returns personal and shared subscription data', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })

    // Personal sub
    createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
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

    const data = getMonthlySpendingData(db, userA)
    expect(data).toHaveLength(2)

    const spotify = data.find((d) => d.name === 'Spotify')!
    expect(spotify.price).toBe(1500)
    expect(spotify.memberCount).toBe(1)

    const netflix = data.find((d) => d.name === 'Netflix')!
    expect(netflix.price).toBe(18000)
    expect(netflix.memberCount).toBe(2)
  })
})
