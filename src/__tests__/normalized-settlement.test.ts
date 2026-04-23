import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock FX cache before importing settlement so the module picks up the mock.
vi.mock('@/lib/fx-cache', () => ({
  getRate: vi.fn(),
}))

import { getRate } from '@/lib/fx-cache'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
} from '@/lib/db-operations'
import { addMemberToSubscription } from '@/lib/membership'
import { generateMonthlyBills } from '@/lib/cron-billing'
import { getNormalizedSettlement } from '@/lib/settlement'
import {
  syncSettlementDueNotifications,
  listNotifications,
} from '@/lib/notifications'

const mockedGetRate = vi.mocked(getRate)

let db: Awaited<ReturnType<typeof setupTestDb>>['db']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  mockedGetRate.mockReset()
})

describe('P1-4/5 getNormalizedSettlement fxIncomplete flag', () => {
  it('flags fxIncomplete=false when every bill has FX available', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
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
      addedAt: '2026-05-01',
    })
    await generateMonthlyBills(db, '2026-05')

    const rows = await getNormalizedSettlement(db, b, 'CNY')
    expect(rows).toHaveLength(1)
    expect(rows[0].fxIncomplete).toBe(false)
    expect(rows[0].bills.every((x) => x.fxIncomplete === false)).toBe(true)
  })

  it('flags fxIncomplete=true on the row and the specific bill when FX lookup returns null', async () => {
    // Display currency = USD. Bill in CNY with localCurrency=JPY (unrelated to
    // USD) forces a CNY→USD lookup. getRate mock returns null → fxIncomplete.
    mockedGetRate.mockResolvedValue(null)

    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    // Bill's localCurrency is intentionally set to JPY so it doesn't shortcut
    // the USD display path and forces a CNY→USD live-FX lookup.
    await db.insert(schema.subscriptionMembers).values({
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    await db.insert(schema.billingRecords).values({
      subscriptionId: sub.id,
      userId: b,
      amount: 5000,
      currency: 'CNY',
      localAmount: 80000, // arbitrary — not used when localCurrency != display
      localCurrency: 'JPY',
      exchangeRate: 16_000_000,
      billingDate: '2026-05-01',
    })

    const rows = await getNormalizedSettlement(db, b, 'USD')
    expect(rows).toHaveLength(1)
    expect(rows[0].fxIncomplete).toBe(true)
    expect(rows[0].bills[0].fxIncomplete).toBe(true)
  })

  it('P2-8 RED: syncSettlementDueNotifications still emits for fxIncomplete buckets with netAmount=0', async () => {
    mockedGetRate.mockResolvedValue(null)

    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await db.insert(schema.subscriptionMembers).values({
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    // Bill in CNY with localCurrency=JPY → converting to USD requires FX
    // lookup, which the mock fails → converted=0 → netAmount=0 but
    // fxIncomplete=true.
    await db.insert(schema.billingRecords).values({
      subscriptionId: sub.id,
      userId: b,
      amount: 5000,
      currency: 'CNY',
      localAmount: 80000,
      localCurrency: 'JPY',
      exchangeRate: 16_000_000,
      billingDate: '2026-05-01',
    })

    await syncSettlementDueNotifications(db, b)

    const notifs = (await listNotifications(db, b)).filter(
      (n) => n.type === 'settlement_due'
    )
    expect(notifs).toHaveLength(1)
    const payload = notifs[0].payload as { fxIncomplete?: boolean; direction: string }
    expect(payload.fxIncomplete).toBe(true)
    // Only outgoing bill in the bucket → direction = 'outgoing'.
    expect(payload.direction).toBe('outgoing')
  })

  it('mixed: row is fxIncomplete=true if ANY bill in the bucket misses FX', async () => {
    // Two bills between A and B: one in USD (display shortcut, fine), one in
    // CNY needing CNY→USD (mock returns null → missing).
    mockedGetRate.mockResolvedValue(null)

    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'USD' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01',
      ownerId: a,
    })
    await db.insert(schema.subscriptionMembers).values({
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-05-01',
    })
    // USD bill — shortcut fine.
    await db.insert(schema.billingRecords).values({
      subscriptionId: sub.id,
      userId: b,
      amount: 500,
      currency: 'USD',
      localAmount: 500,
      localCurrency: 'USD',
      exchangeRate: 1_000_000,
      billingDate: '2026-04-01',
    })
    // CNY bill with JPY local — forces FX.
    await db.insert(schema.billingRecords).values({
      subscriptionId: sub.id,
      userId: b,
      amount: 5000,
      currency: 'CNY',
      localAmount: 80000,
      localCurrency: 'JPY',
      exchangeRate: 16_000_000,
      billingDate: '2026-05-01',
    })

    const rows = await getNormalizedSettlement(db, b, 'USD')
    expect(rows).toHaveLength(1)
    expect(rows[0].fxIncomplete).toBe(true)
    // One bill OK, one bill missing.
    const okBills = rows[0].bills.filter((x) => !x.fxIncomplete)
    const badBills = rows[0].bills.filter((x) => x.fxIncomplete)
    expect(okBills).toHaveLength(1)
    expect(badBills).toHaveLength(1)
  })
})
