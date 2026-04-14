import { describe, it, expect } from 'vitest'
import {
  calculateShares,
  calculateProRate,
  generateBillingRecords,
  calculateMonthlySpending,
} from '@/lib/billing'

describe('calculateShares', () => {
  it('splits evenly among members', async () => {
    // ¥180/month, 4 people → each ¥45
    expect(calculateShares(18000, 4)).toBe(4500)
  })

  it('handles indivisible amounts — payer absorbs remainder', async () => {
    // ¥100/month, 3 people → each non-payer gets 3333
    // payer absorbs 10000 - 3333*2 = 3334
    expect(calculateShares(10000, 3)).toBe(3333)
  })

  it('handles 2 members', async () => {
    // ¥99/month, 2 people → each 4950
    expect(calculateShares(9900, 2)).toBe(4950)
  })

  it('handles single member (personal sub in group)', async () => {
    // only 1 person = payer, no non-payer share needed
    // share should be 0 since there are no non-payers to bill
    expect(calculateShares(18000, 1)).toBe(18000)
  })

  it('handles large amounts', async () => {
    // $299.99/month = 29999 cents, 5 people
    expect(calculateShares(29999, 5)).toBe(5999)
  })
})

describe('calculateProRate', () => {
  it('calculates full month when joining on billing date', async () => {
    // join May 1, next payment June 1 = 31 days remaining out of ~30
    // should be close to full share
    const result = calculateProRate(18000, 4, '2026-05-01', '2026-06-01')
    // 4500 × 31/31 = 4500 (full month)
    expect(result).toBe(4500)
  })

  it('calculates half month when joining mid-cycle', async () => {
    // join May 16, next payment June 1 = 16 days remaining
    // total days May 1→June 1 = 31
    const result = calculateProRate(18000, 4, '2026-05-16', '2026-06-01')
    // 4500 × 16/31 ≈ 2322
    expect(result).toBe(2322)
  })

  it('calculates 1 day remaining', async () => {
    // join May 31, next payment June 1 = 1 day
    const result = calculateProRate(18000, 4, '2026-05-31', '2026-06-01')
    // 4500 × 1/31 ≈ 145
    expect(result).toBe(145)
  })

  it('handles joining same day as next_payment (0 days = no charge)', async () => {
    const result = calculateProRate(18000, 4, '2026-06-01', '2026-06-01')
    expect(result).toBe(0)
  })

  it('handles indivisible pro-rate amounts', async () => {
    // ¥100, 3 people, join May 15, next June 1 = 17 days out of 31
    // share = 3333, pro-rate = 3333 × 17/31 ≈ 1827
    const result = calculateProRate(10000, 3, '2026-05-15', '2026-06-01')
    expect(result).toBe(1827)
  })
})

describe('generateBillingRecords', () => {
  const mockFetchRate = async (from: string, to: string): Promise<number> => {
    if (from === to) return 1
    if (from === 'USD' && to === 'HKD') return 7.8
    if (from === 'USD' && to === 'CNY') return 7.25
    if (from === 'USD' && to === 'CAD') return 1.38
    return 1
  }

  it('generates records for non-payer members only', async () => {
    const records = await generateBillingRecords(
      {
        subscriptionId: 1,
        price: 2000, // $20
        currency: 'USD',
        nextPayment: '2026-06-01',
        payerId: 1,
        members: [
          { userId: 1, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
          { userId: 2, preferredCurrency: 'HKD', joinedAt: '2026-04-01' },
          { userId: 3, preferredCurrency: 'CAD', joinedAt: '2026-04-01' },
        ],
      },
      mockFetchRate
    )

    // payer (userId=1) should NOT have a record
    expect(records).toHaveLength(2)
    expect(records.find((r) => r.userId === 1)).toBeUndefined()
  })

  it('calculates correct share amounts', async () => {
    const records = await generateBillingRecords(
      {
        subscriptionId: 1,
        price: 2000, // $20
        currency: 'USD',
        nextPayment: '2026-06-01',
        payerId: 1,
        members: [
          { userId: 1, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
          { userId: 2, preferredCurrency: 'HKD', joinedAt: '2026-04-01' },
          { userId: 3, preferredCurrency: 'CAD', joinedAt: '2026-04-01' },
        ],
      },
      mockFetchRate
    )

    // $20 / 3 = 666 cents each (payer absorbs 668)
    for (const record of records) {
      expect(record.amount).toBe(666)
      expect(record.currency).toBe('USD')
    }
  })

  it('converts to local currency correctly', async () => {
    const records = await generateBillingRecords(
      {
        subscriptionId: 1,
        price: 2000,
        currency: 'USD',
        nextPayment: '2026-06-01',
        payerId: 1,
        members: [
          { userId: 1, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
          { userId: 2, preferredCurrency: 'HKD', joinedAt: '2026-04-01' },
          { userId: 3, preferredCurrency: 'CAD', joinedAt: '2026-04-01' },
        ],
      },
      mockFetchRate
    )

    const hkdRecord = records.find((r) => r.userId === 2)!
    expect(hkdRecord.localCurrency).toBe('HKD')
    // 666 cents USD × 7.8 = 5194.8 → 5194
    expect(hkdRecord.localAmount).toBe(5194)
    expect(hkdRecord.exchangeRate).toBe(7800000) // 7.8 × 1000000

    const cadRecord = records.find((r) => r.userId === 3)!
    expect(cadRecord.localCurrency).toBe('CAD')
    // 666 × 1.38 = 919.08 → 919
    expect(cadRecord.localAmount).toBe(919)
  })

  it('sets billing date to nextPayment', async () => {
    const records = await generateBillingRecords(
      {
        subscriptionId: 1,
        price: 18000,
        currency: 'CNY',
        nextPayment: '2026-06-01',
        payerId: 1,
        members: [
          { userId: 1, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
          { userId: 2, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
        ],
      },
      mockFetchRate
    )

    expect(records[0].billingDate).toBe('2026-06-01')
  })

  it('generates empty array when only payer in group', async () => {
    const records = await generateBillingRecords(
      {
        subscriptionId: 1,
        price: 18000,
        currency: 'CNY',
        nextPayment: '2026-06-01',
        payerId: 1,
        members: [
          { userId: 1, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
        ],
      },
      mockFetchRate
    )

    expect(records).toHaveLength(0)
  })

  it('pro-rates for members who joined mid-cycle', async () => {
    const records = await generateBillingRecords(
      {
        subscriptionId: 1,
        price: 18000, // ¥180
        currency: 'CNY',
        nextPayment: '2026-06-01',
        payerId: 1,
        members: [
          { userId: 1, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
          { userId: 2, preferredCurrency: 'CNY', joinedAt: '2026-04-01' },
          // D joined mid-cycle: May 16
          { userId: 3, preferredCurrency: 'CNY', joinedAt: '2026-05-16' },
        ],
      },
      mockFetchRate
    )

    const regularMember = records.find((r) => r.userId === 2)!
    const newMember = records.find((r) => r.userId === 3)!

    // Regular: 18000/3 = 6000
    expect(regularMember.amount).toBe(6000)

    // New: 6000 × 16/31 = 3096 (May 16 to June 1 = 16 days, May has 31 days cycle)
    expect(newMember.amount).toBe(3096)
  })
})

describe('calculateMonthlySpending', () => {
  it('sums personal subscriptions', async () => {
    const result = calculateMonthlySpending(
      [
        { price: 1500, currency: 'CNY', memberCount: 1 },
        { price: 600, currency: 'CNY', memberCount: 1 },
      ],
      'CNY',
      {}
    )
    expect(result).toBe(2100) // ¥15 + ¥6 = ¥21
  })

  it('divides shared subscriptions by member count', async () => {
    const result = calculateMonthlySpending(
      [
        { price: 18000, currency: 'CNY', memberCount: 4 },
      ],
      'CNY',
      {}
    )
    expect(result).toBe(4500) // ¥180 / 4 = ¥45
  })

  it('converts currencies using provided rates', async () => {
    const result = calculateMonthlySpending(
      [
        { price: 2000, currency: 'USD', memberCount: 1 },
      ],
      'CNY',
      { USD_CNY: 7.25 }
    )
    // $20 × 7.25 = ¥145 = 14500 cents
    expect(result).toBe(14500)
  })

  it('handles mixed personal and shared with different currencies', async () => {
    const result = calculateMonthlySpending(
      [
        { price: 1500, currency: 'CNY', memberCount: 1 }, // ¥15 personal
        { price: 2000, currency: 'USD', memberCount: 4 }, // $20/4=$5 shared
      ],
      'CNY',
      { USD_CNY: 7.25 }
    )
    // ¥15 (1500) + $5 × 7.25 (3625) = 5125
    expect(result).toBe(5125)
  })

  it('returns 0 for empty subscriptions', async () => {
    const result = calculateMonthlySpending([], 'CNY', {})
    expect(result).toBe(0)
  })

  it('same currency needs no conversion', async () => {
    const result = calculateMonthlySpending(
      [{ price: 5000, currency: 'CNY', memberCount: 2 }],
      'CNY',
      {}
    )
    expect(result).toBe(2500)
  })
})
