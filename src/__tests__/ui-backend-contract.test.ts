import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser, type SqliteShim, type TestDb } from './helpers'
import { createSubscription } from '@/lib/db-operations'
import { addMemberToSubscription, leaveSubscription } from '@/lib/membership'
import {
  handleUpdateSubscription,
  handleGetSubscription,
} from '@/lib/api-handlers'

/**
 * Backend contract for the three UI changes flagged for the per-day
 * price-timeline + rejoin-history work:
 *
 *   1. handleUpdateSubscription accepts and forwards `effectiveFrom` to
 *      changeSubscriptionPrice so the UI's date picker reaches the engine.
 *   2. handleGetSubscription returns `priceHistory` so the UI can render
 *      the audit trail.
 *   3. handleGetSubscription returns `members[i].previousIntervals` so the
 *      UI can show a member's full lifecycle, not just the active stint.
 */

let db: TestDb
let sqlite: SqliteShim

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('UI backend contract (RED)', () => {
  it('handleUpdateSubscription forwards effectiveFrom into price_history', async () => {
    const A = await createUser(db, { email: 'a@uic1.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'UpdateSubFlow', price: 3000, currency: 'USD',
      nextPayment: '2026-04-15', startDate: '2026-04-01', ownerId: A,
    })

    const res = await handleUpdateSubscription(db, A, sub.id, {
      price: 6000,
      effectiveFrom: '2026-04-15',
    })
    expect(res.success).toBe(true)

    // The price_history JSON must contain the appended entry.
    const row = (await sqlite
      .prepare(`SELECT price_history as "priceHistory" FROM subscriptions WHERE id = ?`)
      .all(sub.id)) as Array<{
      priceHistory: Array<{ price: number; effectiveFrom: string }>
    }>
    expect(row[0].priceHistory).toContainEqual(
      expect.objectContaining({ price: 6000, effectiveFrom: '2026-04-15' })
    )
  })

  it('handleUpdateSubscription validates effectiveFrom (out-of-window rejected)', async () => {
    const A = await createUser(db, { email: 'a@uic2.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Validation', price: 3000, currency: 'USD',
      nextPayment: '2026-05-15', startDate: '2026-01-01', ownerId: A,
    })

    // 2027-01-01 is far past today + 31 days
    const res = await handleUpdateSubscription(db, A, sub.id, {
      price: 6000,
      effectiveFrom: '2027-01-01',
    })
    expect(res.success).toBe(false)
  })

  it('handleGetSubscription returns priceHistory with at least the seeded entry', async () => {
    const A = await createUser(db, { email: 'a@uic3.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'HistoryView', price: 3000, currency: 'USD',
      nextPayment: '2026-04-15', startDate: '2026-04-01', ownerId: A,
    })

    const res = await handleGetSubscription(db, A, sub.id)
    if (!res.success || !res.data) throw new Error('expected success')

    expect(res.data.priceHistory).toBeDefined()
    expect(Array.isArray(res.data.priceHistory)).toBe(true)
    expect(res.data.priceHistory).toContainEqual(
      expect.objectContaining({ price: 3000, effectiveFrom: '2026-04-01' })
    )
  })

  it('handleGetSubscription priceHistory grows after a price change', async () => {
    const A = await createUser(db, { email: 'a@uic4.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'GrowingHistory', price: 3000, currency: 'USD',
      nextPayment: '2026-04-15', startDate: '2026-04-01', ownerId: A,
    })

    await handleUpdateSubscription(db, A, sub.id, {
      price: 6000,
      effectiveFrom: '2026-04-15',
    })

    const res = await handleGetSubscription(db, A, sub.id)
    if (!res.success || !res.data) throw new Error('expected success')

    expect(res.data.priceHistory).toHaveLength(2)
    // Sorted ascending — start, then change
    expect(res.data.priceHistory[0]).toMatchObject({ price: 3000, effectiveFrom: '2026-04-01' })
    expect(res.data.priceHistory[1]).toMatchObject({ price: 6000, effectiveFrom: '2026-04-15' })
  })

  it('handleGetSubscription exposes previousIntervals on rejoiner member', async () => {
    const A = await createUser(db, { email: 'a@uic5.test', currency: 'USD' })
    const C = await createUser(db, { email: 'c@uic5.test', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'StintsView', price: 3000, currency: 'USD',
      nextPayment: '2026-04-15', startDate: '2026-04-01', ownerId: A,
    })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-01' })
    await leaveSubscription(db,
      { subscriptionId: sub.id, userId: C, leftAt: '2026-04-08', actorId: A })
    await addMemberToSubscription(db,
      { subscriptionId: sub.id, userId: C, addedBy: A, addedAt: '2026-04-20' })

    const res = await handleGetSubscription(db, A, sub.id)
    if (!res.success || !res.data) throw new Error('expected success')

    const carol = res.data.members.find((m) => m.userId === C)
    expect(carol).toBeDefined()
    expect(carol!.previousIntervals).toEqual([
      { addedAt: '2026-04-01', leftAt: '2026-04-08' },
    ])

    // Members with no rejoin history have empty array (or undefined — both ok)
    const alice = res.data.members.find((m) => m.userId === A)
    expect(alice!.previousIntervals ?? []).toEqual([])
  })
})
