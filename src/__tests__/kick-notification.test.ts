import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  createSubscription,
} from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import { listNotifications } from '@/lib/notifications'

/**
 * T14 — when A removes B from a sub (kick, not self-leave), B gets a
 * removed_from_sub notification. Self-leave is silent.
 *
 * await leaveSubscription(..., actorId?) — when actorId !== userId, emit.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function setup2() {
  const a = await createUser(db, { name: 'Alice', email: 'a@t.com' })
  const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
  const sub = await createSubscription(db, {
    name: 'Netflix',
    price: 10000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: a,
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: b,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  return { a, b, sub }
}

describe('T14 removed_from_sub notification', () => {
  it('self-leave emits NO removed_from_sub notification', async () => {
    const { b, sub } = await setup2()

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
      actorId: b, // self
    })

    const kicks = (await listNotifications(db, b)).filter(
      (n) => n.type === 'removed_from_sub'
    )
    expect(kicks).toHaveLength(0)
  })

  it('owner kicks B → B receives removed_from_sub', async () => {
    const { a, b, sub } = await setup2()

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
      actorId: a, // kicker
    })

    const kicks = (await listNotifications<{
      sub_name: string
      actor_name: string
    }>(db, b)).filter((n) => n.type === 'removed_from_sub')
    expect(kicks).toHaveLength(1)
    expect(kicks[0].subscriptionId).toBe(sub.id)
    expect(kicks[0].payload.sub_name).toBe('Netflix')
    expect(kicks[0].payload.actor_name).toBe('Alice')
  })

  it('default actorId (when omitted) is treated as self-leave', async () => {
    const { b, sub } = await setup2()

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
    })

    const kicks = (await listNotifications(db, b)).filter(
      (n) => n.type === 'removed_from_sub'
    )
    expect(kicks).toHaveLength(0)
  })

  it('kick does not generate any billing_record (same as R3 self-leave)', async () => {
    const { a, b, sub } = await setup2()

    const before = (
      await sqlite.prepare('SELECT COUNT(*) AS n FROM billing_records')
        .get() as { n: number }
    ).n

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-04-20',
      actorId: a,
    })

    const after = (
      await sqlite.prepare('SELECT COUNT(*) AS n FROM billing_records')
        .get() as { n: number }
    ).n
    expect(after).toBe(before)
  })

  it('cannot kick the payer (same guard as self-leave)', async () => {
    const { a, b, sub } = await setup2()

    await expect(leaveSubscription(db, {
        subscriptionId: sub.id,
        userId: a, // payer
        leftAt: '2026-04-20',
        actorId: b,
      })
    ).rejects.toThrow(/payer/i)
  })
})
