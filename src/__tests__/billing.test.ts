import { describe, it, expect } from 'vitest'
import {
  calculateShares,
  calculateMonthlySpending,
  calculateLeaveProRata,
  calculateJoinProRata,
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

  it('falls back to rate=1 when the requested pair is missing', async () => {
    // No rate for USD→CNY → treat as 1:1 (best-effort fallback).
    const result = calculateMonthlySpending(
      [{ price: 2000, currency: 'USD', memberCount: 1 }],
      'CNY',
      {}
    )
    expect(result).toBe(2000)
  })
})

describe('calculateLeaveProRata', () => {
  it('returns floor(share × usage / daysInMonth) on the happy path', () => {
    expect(calculateLeaveProRata(1000, 15, 31)).toBe(483)
    expect(calculateLeaveProRata(1500, 10, 30)).toBe(500)
  })

  it('returns 0 when usage_days is 0 or negative', () => {
    expect(calculateLeaveProRata(1000, 0, 31)).toBe(0)
    expect(calculateLeaveProRata(1000, -3, 31)).toBe(0)
  })

  it('returns full share when usage_days ≥ daysInMonth (last-day override)', () => {
    expect(calculateLeaveProRata(1000, 31, 31)).toBe(1000)
    expect(calculateLeaveProRata(1000, 40, 31)).toBe(1000)
  })

  it('rejects negative share', () => {
    expect(() => calculateLeaveProRata(-1, 10, 31)).toThrow(/non-negative/)
  })

  it('rejects out-of-range daysInMonth', () => {
    expect(() => calculateLeaveProRata(1000, 10, 27)).toThrow(/28–31/)
    expect(() => calculateLeaveProRata(1000, 10, 32)).toThrow(/28–31/)
  })
})

describe('calculateJoinProRata error branches', () => {
  it('rejects negative share', () => {
    expect(() => calculateJoinProRata(-1, 15, 31)).toThrow(/non-negative/)
  })

  it('rejects out-of-range daysInMonth', () => {
    expect(() => calculateJoinProRata(1000, 15, 27)).toThrow(/28–31/)
  })

  it('rejects out-of-range dayOfMonth', () => {
    expect(() => calculateJoinProRata(1000, 0, 31)).toThrow(/out of range/)
    expect(() => calculateJoinProRata(1000, 32, 31)).toThrow(/out of range/)
  })
})
