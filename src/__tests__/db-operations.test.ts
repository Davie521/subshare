import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
<<<<<<< HEAD
import { setupTestDb, createUser, createGroup, addMember } from './helpers'
||||||| edd84f2
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser, createGroup, addMember } from './helpers'
=======
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser, addSubMember } from './helpers'
>>>>>>> origin/main
import * as schema from '@/db/schema'
import {
  createSubscription,
  getSubscriptionsForUser,
  generateAndSaveBillingRecords,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
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
<<<<<<< HEAD
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
||||||| edd84f2
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
=======
>>>>>>> origin/main
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

<<<<<<< HEAD
  it('returns shared subscriptions the user is a member of', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('returns shared subscriptions the user is a member of', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('returns shared subscriptions the user is a member of', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

<<<<<<< HEAD
    await createSubscription(db, {
||||||| edd84f2
    createSubscription(db, {
=======
    const netflix = createSubscription(db, {
>>>>>>> origin/main
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, netflix.id, userB)

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

<<<<<<< HEAD
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

||||||| edd84f2
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

=======
>>>>>>> origin/main
describe('generateAndSaveBillingRecords', () => {
<<<<<<< HEAD
  it('generates billing records for non-payer members', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const userC = await createUser(db, { email: 'c@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
    await addMember(db, group.id, userC)
||||||| edd84f2
  it('generates billing records for non-payer members', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const userC = createUser(sqlite, { email: 'c@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
    addMember(sqlite, group.id, userC)
=======
  it('generates billing records for non-payer members', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const userC = createUser(sqlite, { email: 'c@test.com' })
>>>>>>> origin/main

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)
    addSubMember(sqlite, sub.id, userC)

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

<<<<<<< HEAD
  it('does not generate duplicate records for same billing date', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('does not generate duplicate records for same billing date', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('does not generate duplicate records for same billing date', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)

    await generateAndSaveBillingRecords(db, sub.id)
    await generateAndSaveBillingRecords(db, sub.id) // second call

    const bills = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.subscriptionId, sub.id))
      

    expect(bills).toHaveLength(1) // no duplicates
  })

<<<<<<< HEAD
  it('skips inactive subscriptions', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('skips inactive subscriptions', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('skips inactive subscriptions', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)

    // Mark as inactive
    await db.update(schema.subscriptions)
      .set({ inactive: true })
      .where(eq(schema.subscriptions.id, sub.id))

    const count = await generateAndSaveBillingRecords(db, sub.id)
    expect(count).toBe(0)
  })
})

describe('getPendingBills', () => {
<<<<<<< HEAD
  it('returns unpaid bills for a user', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('returns unpaid bills for a user', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('returns unpaid bills for a user', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)

    await generateAndSaveBillingRecords(db, sub.id)

    const bills = await getPendingBills(db, userB)
    expect(bills).toHaveLength(1)
    expect(bills[0].subscriptionName).toBe('Netflix')
    expect(bills[0].amount).toBe(9000) // 18000/2
    expect(bills[0].isPaid).toBe(false)
  })

<<<<<<< HEAD
  it('does not return paid bills', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('does not return paid bills', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('does not return paid bills', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)

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
<<<<<<< HEAD
  it('marks a bill as paid with timestamp', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('marks a bill as paid with timestamp', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('marks a bill as paid with timestamp', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, sub.id, userB)

    await generateAndSaveBillingRecords(db, sub.id)

    const bills = await db.select().from(schema.billingRecords)
    await markBillPaid(db, bills[0].id)

    const [updated] = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))
      

    expect(updated!.isPaid).toBe(true)
    expect(updated!.paidAt).toBeDefined()
  })
})

<<<<<<< HEAD
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

||||||| edd84f2
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

=======
>>>>>>> origin/main
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
<<<<<<< HEAD
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
    await createSubscription(db, {
||||||| edd84f2
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
    createSubscription(db, {
=======
    const netflixSub = createSubscription(db, {
>>>>>>> origin/main
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
    addSubMember(sqlite, netflixSub.id, userB)

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
