import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { setupTestDb, createUser } from './helpers'
import { handleCreateSubscription } from '@/lib/api-handlers'

describe('subscription_members.personalTags column', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  it('defaults to [] for a freshly-created member row', async () => {
    const ownerId = await createUser(db, { email: 'o@t.com' })
    const memberId = await createUser(db, { email: 'm@t.com' })
    const created = await handleCreateSubscription(db, ownerId, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [memberId],
    })
    if (!created.success) throw new Error(created.error)

    // Owner row (auto-added at create time).
    const [ownerRow] = await db
      .select({ personalTags: schema.subscriptionMembers.personalTags })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, created.data!.id),
          eq(schema.subscriptionMembers.userId, ownerId)
        )
      )
    expect(ownerRow?.personalTags).toEqual([])

    // Invited member row.
    const [memberRow] = await db
      .select({ personalTags: schema.subscriptionMembers.personalTags })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, created.data!.id),
          eq(schema.subscriptionMembers.userId, memberId)
        )
      )
    expect(memberRow?.personalTags).toEqual([])
  })
})
