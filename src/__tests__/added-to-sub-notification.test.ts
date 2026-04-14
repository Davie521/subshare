import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

/**
 * T11 — addMember emits `added_to_sub` to the invitee.
 * Payload must include enough info for the invitee to know exactly:
 *   - which sub
 *   - their share amount
 *   - the pro-rated amount for the current cycle
 *   - who the payer is (and their name for display)
 *   - next settlement date (YYYY-MM-01 of next month)
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T11 added_to_sub notification', () => {
  it('inserts one notification for the invitee with enriched payload', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10800,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    const notifs = listNotifications<{
      sub_name: string
      actor_name: string
      share: number
      share_currency: string
      this_cycle_prorated: number
      payer_name: string
      next_billing_date: string
    }>(db, b)

    expect(notifs).toHaveLength(1)
    const n = notifs[0]
    expect(n.type).toBe('added_to_sub')
    expect(n.subscriptionId).toBe(sub.id)
    expect(n.payload.sub_name).toBe('Netflix')
    expect(n.payload.actor_name).toBeDefined()
    expect(n.payload.payer_name).toBeDefined()
    expect(n.payload.share).toBe(5400) // floor(10800/2)
    expect(n.payload.share_currency).toBe('CNY')
    // April 20 in 30-day month → 11/30 of 5400 = 1980
    expect(n.payload.this_cycle_prorated).toBe(1980)
    expect(n.payload.next_billing_date).toBe('2026-05-01')
  })

  it('no notification sent when owner is self-inserted on createSubscription', async () => {
    const a = await createUser(db)
    await createSubscription(db, {
      name: 'Spotify',
      price: 1000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    expect(await listNotifications(db, a)).toHaveLength(0)
  })

  it('notification goes to the invitee only, not to the inviter or other members', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-16',
    })

    expect(await listNotifications(db, a)).toHaveLength(0)
    expect(await listNotifications(db, b)).toHaveLength(1)
    expect(await listNotifications(db, c)).toHaveLength(1)
  })

  it('idempotent re-add does not create a duplicate notification', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })

    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-20',
    })

    expect(await listNotifications(db, b)).toHaveLength(1)
  })

  it('actor_name reflects the inviter displayName (or falls back to name)', async () => {
    const a = await createUser(db, { name: 'Alice', email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-04-01',
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-15',
    })

    const notifs = listNotifications<{ actor_name: string; payer_name: string }>(
      db,
      b
    )
    expect(notifs[0].payload.actor_name).toBe('Alice')
    expect(notifs[0].payload.payer_name).toBe('Alice') // payer = owner
  })
})
