import { describe, it, expect } from 'vitest'
import { calculateShares, calculateMonthlySpending } from '@/lib/billing'

describe('calculateShares', () => {
  it('splits evenly among members', () => {
    // ¥180/month, 4 people → each ¥45
    expect(calculateShares(18000, 4)).toBe(4500)
  })

  it('handles indivisible amounts — payer absorbs remainder', () => {
    // ¥100/month, 3 people → each non-payer gets 3333
    // payer absorbs 10000 - 3333*2 = 3334
    expect(calculateShares(10000, 3)).toBe(3333)
  })

  it('handles 2 members', () => {
    // ¥99/month, 2 people → each 4950
    expect(calculateShares(9900, 2)).toBe(4950)
  })

  it('handles single member (personal sub in group)', () => {
    // only 1 person = payer, no non-payer share needed
    // share should be 0 since there are no non-payers to bill
    expect(calculateShares(18000, 1)).toBe(18000)
  })

  it('handles large amounts', () => {
    // $299.99/month = 29999 cents, 5 people
    expect(calculateShares(29999, 5)).toBe(5999)
  })
})

describe('calculateMonthlySpending', () => {
  it('sums personal subscriptions', () => {
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

  it('divides shared subscriptions by member count', () => {
    const result = calculateMonthlySpending(
      [
        { price: 18000, currency: 'CNY', memberCount: 4 },
      ],
      'CNY',
      {}
    )
    expect(result).toBe(4500) // ¥180 / 4 = ¥45
  })

  it('converts currencies using provided rates', () => {
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

  it('handles mixed personal and shared with different currencies', () => {
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

  it('returns 0 for empty subscriptions', () => {
    const result = calculateMonthlySpending([], 'CNY', {})
    expect(result).toBe(0)
  })

  it('same currency needs no conversion', () => {
    const result = calculateMonthlySpending(
      [{ price: 5000, currency: 'CNY', memberCount: 2 }],
      'CNY',
      {}
    )
    expect(result).toBe(2500)
  })
})
