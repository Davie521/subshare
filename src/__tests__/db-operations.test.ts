import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
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

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('createSubscription', () => {
  it('creates a personal subscription', async () => {
    const userId = await createUser(db)
    const sub = await createSubscription(db, {
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

  it('creates a shared subscription in a group', async () => {
    const userId = await createUser(db)
    const group = await createGroup(db, { createdBy: userId })

    const sub = await createSubscription(db, {
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
  it('returns personal subscriptions', async () => {
    const userId = await createUser(db)
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userId,
    })

    const subs = await getSubscriptionsForUser(db, userId)
    expect(subs).toHaveLength(1)
    expect(subs[0].name).toBe('Spotify')
    expect(subs[0].memberCount).toBe(1)
  })

  it('returns shared subscriptions the user is a member of', async () => {
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
      groupId: group.id,
    })

    const subsA = await getSubscriptionsForUser(db, userA)
    const subsB = await getSubscriptionsForUser(db, userB)

    expect(subsA).toHaveLength(1)
    expect(subsA[0].memberCount).toBe(2)

    expect(subsB).toHaveLength(1)
    expect(subsB[0].memberCount).toBe(2)
  })

  it('does not return other users personal subscriptions', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })

    const subsB = await getSubscriptionsForUser(db, userB)
    expect(subsB).toHaveLength(0)
  })
})

describe('getGroupWithMembers', () => {
  it('returns group info with member list', async () => {
    const userA = await createUser(db, { name: 'Alice', email: 'a@test.com' })
    const userB = await createUser(db, { name: 'Bob', email: 'b@test.com' })
    const group = await createGroup(db, { name: 'Roommates', createdBy: userA })
    await addMember(db, group.id, userB)

    const result = await getGroupWithMembers(db, group.id)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Roommates')
    expect(result!.members).toHaveLength(2)
    expect(result!.members.map((m) => m.name)).toContain('Alice')
    expect(result!.members.map((m) => m.name)).toContain('Bob')
  })

  it('returns null for non-existent group', async () => {
    const result = await getGroupWithMembers(db, 999)
    expect(result).toBeNull()
  })
})

describe('generateAndSaveBillingRecords', () => {
  it('generates billing records for non-payer members', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const userC = await createUser(db, { email: 'c@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
    await addMember(db, group.id, userC)

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
      groupId: group.id,
    })

    const count = await generateAndSaveBillingRecords(db, sub.id)
    expect(count).toBe(2) // B and C

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))
      

    expect(bills).toHaveLength(2)
    expect(bills.every((b) => b.amount === 6000)).toBe(true) // 18000/3
    expect(bills.find((b) => b.userId === userA)).toBeUndefined()
  })

  it('does not generate duplicate records for same billing date', async () => {
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
      groupId: group.id,
    })

    await generateAndSaveBillingRecords(db, sub.id)
    await generateAndSaveBillingRecords(db, sub.id) // second call

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))
      

    expect(bills).toHaveLength(1) // no duplicates
  })

  it('skips inactive subscriptions', async () => {
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
      groupId: group.id,
    })

    // Mark as inactive
    db.update(schema.subscriptions)
      .set({ inactive: true })
      .where(eq(schema.subscriptions.id, sub.id))
      .run()

    const count = await generateAndSaveBillingRecords(db, sub.id)
    expect(count).toBe(0)
  })
})

describe('getPendingBills', () => {
  it('returns unpaid bills for a user', async () => {
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
      groupId: group.id,
    })

    await generateAndSaveBillingRecords(db, sub.id)

    const bills = await getPendingBills(db, userB)
    expect(bills).toHaveLength(1)
    expect(bills[0].subscriptionName).toBe('Netflix')
    expect(bills[0].amount).toBe(9000) // 18000/2
    expect(bills[0].isPaid).toBe(0)
  })

  it('does not return paid bills', async () => {
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
      groupId: group.id,
    })

    await generateAndSaveBillingRecords(db, sub.id)

    // Mark as paid
    const allBills = await db
      .select()
      .from(schema.billingRecords)
      
    await markBillPaid(db, allBills[0].id)

    const pending = await getPendingBills(db, userB)
    expect(pending).toHaveLength(0)
  })
})

describe('markBillPaid', () => {
  it('marks a bill as paid with timestamp', async () => {
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
      groupId: group.id,
    })

    await generateAndSaveBillingRecords(db, sub.id)

    const bills = db.select().from(schema.billingRecords).all()
    await markBillPaid(db, bills[0].id)

    const [updated] = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))
      

    expect(updated!.isPaid).toBe(1)
    expect(updated!.paidAt).toBeDefined()
  })
})

describe('canLeaveGroup and removeGroupMember', () => {
  it('allows member to leave when no unpaid bills', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    expect(await canLeaveGroup(db, group.id, userB)).toBe(true)
  })

  it('prevents member from leaving with unpaid bills', async () => {
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
      groupId: group.id,
    })

    await generateAndSaveBillingRecords(db, sub.id)

    expect(await canLeaveGroup(db, group.id, userB)).toBe(false)
  })

  it('prevents creator from leaving', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const group = await createGroup(db, { createdBy: userA })

    expect(await canLeaveGroup(db, group.id, userA)).toBe(false)
  })

  it('removes member from group', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    await removeGroupMember(db, group.id, userB)

    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, group.id))
      

    expect(members).toHaveLength(1) // only creator left
  })
})

describe('getMonthlySpendingData', () => {
  it('returns personal and shared subscription data', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })

    // Personal sub
    await createSubscription(db, {
      name: 'Spotify',
      price: 1500,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
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
      groupId: group.id,
    })

    const data = await getMonthlySpendingData(db, userA)
    expect(data).toHaveLength(2)

    const spotify = data.find((d) => d.name === 'Spotify')!
    expect(spotify.price).toBe(1500)
    expect(spotify.memberCount).toBe(1)

    const netflix = data.find((d) => d.name === 'Netflix')!
    expect(netflix.price).toBe(18000)
    expect(netflix.memberCount).toBe(2)
  })
})
