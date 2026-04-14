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

<<<<<<< HEAD
function assertFailure<T>(r: Result<T>): asserts r is { success: false; error: string } {
  if (r.success) throw new Error('Expected failure, got success')
}

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']
||||||| edd84f2
function assertFailure<T>(r: Result<T>): asserts r is { success: false; error: string } {
  if (r.success) throw new Error('Expected failure, got success')
}

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database
=======
let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database
>>>>>>> origin/main

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

<<<<<<< HEAD
// --- Groups ---

describe('handleCreateGroup', () => {
  it('creates a group and adds creator as member', async () => {
    const userId = await createUser(db)
    const result = await handleCreateGroup(db, userId, { name: 'Roommates' })

    assertSuccess(result)
    expect(result.data!.name).toBe('Roommates')
    expect(result.data!.publicId).toBeDefined()
    expect(result.data!.publicId.length).toBeGreaterThan(5)

    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(
        eq(
          schema.groupMembers.groupId,
          result.data!.id
        )
      )
      
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(userId)
  })
})

describe('handleJoinGroup', () => {
  it('joins a group via publicId', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })

    const result = await handleJoinGroup(db, userB, group.publicId)
    expect(result.success).toBe(true)

    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, group.id))
      
    expect(members).toHaveLength(2)
  })

  it('rejects invalid publicId', async () => {
    const userId = await createUser(db)
    const result = await handleJoinGroup(db, userId, 'nonexistent')
    assertFailure(result)
    expect(result.error).toBeDefined()
  })

  it('rejects if already a member', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const group = await createGroup(db, { createdBy: userA })

    const result = await handleJoinGroup(db, userA, group.publicId)
    expect(result.success).toBe(false)
  })
})

describe('handleLeaveGroup', () => {
  it('lets member leave when no unpaid bills', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    const result = await handleLeaveGroup(db, userB, group.id)
    expect(result.success).toBe(true)
  })

  it('blocks creator from leaving', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const group = await createGroup(db, { createdBy: userA })

    const result = await handleLeaveGroup(db, userA, group.id)
    expect(result.success).toBe(false)
  })

  it('blocks leaving with unpaid bills', async () => {
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
    await generateAndSaveBillingRecords(db, 1)

    const result = await handleLeaveGroup(db, userB, group.id)
    expect(result.success).toBe(false)
  })
})

describe('handleDeleteGroup', () => {
  it('deletes group when all bills paid', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const group = await createGroup(db, { createdBy: userA })

    const result = await handleDeleteGroup(db, userA, group.id)
    expect(result.success).toBe(true)

    const [found] = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, group.id))
      
    expect(found).toBeUndefined()
  })

  it('rejects non-creator', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)

    const result = await handleDeleteGroup(db, userB, group.id)
    expect(result.success).toBe(false)
  })

  it('rejects deletion with unpaid bills', async () => {
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
    await generateAndSaveBillingRecords(db, 1)

    const result = await handleDeleteGroup(db, userA, group.id)
    expect(result.success).toBe(false)
  })
})

||||||| edd84f2
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

=======
>>>>>>> origin/main
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

<<<<<<< HEAD
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
||||||| edd84f2
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
=======
  it('creates shared subscription with members[]', async () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

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

<<<<<<< HEAD
  it('soft deletes (marks inactive) when unpaid bills exist', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('soft deletes (marks inactive) when unpaid bills exist', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('soft deletes (marks inactive) when unpaid bills exist', () => {
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
<<<<<<< HEAD
    await generateAndSaveBillingRecords(db, sub.id)
||||||| edd84f2
    generateAndSaveBillingRecords(db, sub.id)
=======
    addSubMember(sqlite, sub.id, userB)
    generateAndSaveBillingRecords(db, sub.id)
>>>>>>> origin/main

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
<<<<<<< HEAD
  it('marks a bill as paid', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('marks a bill as paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('marks a bill as paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
>>>>>>> origin/main

<<<<<<< HEAD
    await createSubscription(db, {
||||||| edd84f2
    createSubscription(db, {
=======
    const sub = createSubscription(db, {
>>>>>>> origin/main
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
<<<<<<< HEAD
    await generateAndSaveBillingRecords(db, 1)
||||||| edd84f2
    generateAndSaveBillingRecords(db, 1)
=======
    addSubMember(sqlite, sub.id, userB)
    generateAndSaveBillingRecords(db, sub.id)
>>>>>>> origin/main

    const bills = await db.select().from(schema.billingRecords)
    const result = await handleMarkPaid(db, userB, bills[0].id)
    expect(result.success).toBe(true)

    const [updated] = await db
      .select()
      .from(schema.billingRecords)
      .where(eq(schema.billingRecords.id, bills[0].id))
      
    expect(updated!.isPaid).toBe(true)
  })

<<<<<<< HEAD
  it('rejects marking someone else bill as paid', async () => {
    const userA = await createUser(db, { email: 'a@test.com' })
    const userB = await createUser(db, { email: 'b@test.com' })
    const userC = await createUser(db, { email: 'c@test.com' })
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
||||||| edd84f2
  it('rejects marking someone else bill as paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const userC = createUser(sqlite, { email: 'c@test.com' })
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
=======
  it('rejects marking someone else bill as paid', () => {
    const userA = createUser(sqlite, { email: 'a@test.com' })
    const userB = createUser(sqlite, { email: 'b@test.com' })
    const userC = createUser(sqlite, { email: 'c@test.com' })
>>>>>>> origin/main

<<<<<<< HEAD
    await createSubscription(db, {
||||||| edd84f2
    createSubscription(db, {
=======
    const sub = createSubscription(db, {
>>>>>>> origin/main
      name: 'Netflix',
      price: 18000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      ownerId: userA,
    })
<<<<<<< HEAD
    await generateAndSaveBillingRecords(db, 1)
||||||| edd84f2
    generateAndSaveBillingRecords(db, 1)
=======
    addSubMember(sqlite, sub.id, userB)
    generateAndSaveBillingRecords(db, sub.id)
>>>>>>> origin/main

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
<<<<<<< HEAD
    const group = await createGroup(db, { createdBy: userA })
    await addMember(db, group.id, userB)
    await createSubscription(db, {
||||||| edd84f2
    const group = createGroup(sqlite, { createdBy: userA })
    addMember(sqlite, group.id, userB)
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
<<<<<<< HEAD
    await generateAndSaveBillingRecords(db, 2)
||||||| edd84f2
    generateAndSaveBillingRecords(db, 2)
=======
    addSubMember(sqlite, netflix.id, userB)
    generateAndSaveBillingRecords(db, netflix.id)
>>>>>>> origin/main

    const result = await handleGetDashboard(db, userB)
    expect(result.monthlyTotal).toBe(10500) // 1500 + 18000/2
    expect(result.pendingBills).toHaveLength(1)
    expect(result.subscriptions).toHaveLength(2)
  })
})
