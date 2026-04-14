import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser, addSubMember } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  leaveSubscription,
} from '@/lib/db-operations'
import { eq, and } from 'drizzle-orm'

/**
 * T31 — R2 minimum-cycle commitment.
 *
 * A member who joins a subscription must stay through at least one FULL
 * calendar-month cycle before they can leave on demand. The partial
 * cycle they joined mid-month doesn't count.
 *
 * - Added on day 1 → their join month IS a full cycle; they may leave
 *   starting the next month. minimum_cycle_end = end of join month.
 * - Added on day >1 → first (partial) cycle doesn't count; must complete
 *   the next full month. minimum_cycle_end = end of (join month + 1).
 *
 * When a member tries to leave before minimum_cycle_end, leaveSubscription
 * clamps `left_at` to minimum_cycle_end instead of allowing the earlier
 * date. Payer-initiated kicks bypass the check.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function getLeftAt(
  subId: number,
  userId: number
): Promise<string | null> {
  const [row] = await db
    .select({ leftAt: schema.subscriptionMembers.leftAt })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subId),
        eq(schema.subscriptionMembers.userId, userId)
      )
    )
  return row?.leftAt ?? null
}

describe('T31 minimum-cycle commitment on leave', () => {
  it('member joined on day 1 may leave any time that month — left_at = end of join month', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-04-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addSubMember(sqlite, sub.id, b, { addedAt: '2026-03-01' })

    // B tries to leave on 3/15 — but their first full cycle ends 3/31.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-03-15',
    })

    expect(await getLeftAt(sub.id, b)).toBe('2026-03-31')
  })

  it('member joined mid-month — left_at clamped to end of NEXT month', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-04-15',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addSubMember(sqlite, sub.id, b, { addedAt: '2026-03-15' })

    // B tries to leave 3/20 — partial Mar doesn't count, first full cycle
    // ends 4/30.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-03-20',
    })

    expect(await getLeftAt(sub.id, b)).toBe('2026-04-30')
  })

  it('member past minimum → left_at passes through unchanged', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-07-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addSubMember(sqlite, sub.id, b, { addedAt: '2026-03-15' })

    // Minimum = 4/30. Leaving 5/10 is past that → passes through.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-05-10',
    })

    expect(await getLeftAt(sub.id, b)).toBe('2026-05-10')
  })

  it('payer-initiated kick bypasses minimum-cycle guard', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-04-15',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await addSubMember(sqlite, sub.id, b, { addedAt: '2026-03-15' })

    // Payer kicks B on 3/20 — kick is not bound by the member's own
    // minimum commitment.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-03-20',
      actorId: a,
    })

    expect(await getLeftAt(sub.id, b)).toBe('2026-03-20')
  })

  it('handles year-end rollover (joined Dec 15 → minimum_cycle_end = Jan 31)', async () => {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2027-01-15',
      startDate: '2026-12-01',
      ownerId: a,
    })
    await addSubMember(sqlite, sub.id, b, { addedAt: '2026-12-15' })

    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-12-20',
    })

    expect(await getLeftAt(sub.id, b)).toBe('2027-01-31')
  })
})
