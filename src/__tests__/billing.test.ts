import { describe, it, expect } from 'vitest'
import {
  calculateShares,
  calculateMonthlySpending,
  calculateLeaveProRata,
  calculateJoinProRata,
  recomputeLocalAmount,
  distributeDiff,
  calculateR5NewAmount,
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

  it('skips subs whose FX rate is missing rather than 1:1 fallback', async () => {
    // No rate for USD→CNY → skip (was silently misreporting via 1:1 fallback).
    const result = calculateMonthlySpending(
      [{ price: 2000, currency: 'USD', memberCount: 1 }],
      'CNY',
      {}
    )
    expect(result).toBe(0)
  })
})

describe('calculateLeaveProRata', () => {
  it('returns floor(amount × usage / coverage) on the happy path', () => {
    // R1 bill: coverage = daysInMonth.
    expect(calculateLeaveProRata(1000, 15, 31)).toBe(483)
    expect(calculateLeaveProRata(1500, 10, 30)).toBe(500)
  })

  it('handles R2 bill coverage (joined mid-month)', () => {
    // Bill of 500 covers 17 days (e.g. May 15–31); leaver used 10 days.
    expect(calculateLeaveProRata(500, 10, 17)).toBe(294) // floor(500*10/17)
  })

  it('returns 0 when usage_days is 0 or negative', () => {
    expect(calculateLeaveProRata(1000, 0, 31)).toBe(0)
    expect(calculateLeaveProRata(1000, -3, 31)).toBe(0)
  })

  it('returns full amount when usage_days ≥ coverageDays (last-day override)', () => {
    expect(calculateLeaveProRata(1000, 31, 31)).toBe(1000)
    expect(calculateLeaveProRata(1000, 40, 31)).toBe(1000)
    // R2 case: usage equals coverage.
    expect(calculateLeaveProRata(500, 17, 17)).toBe(500)
  })

  it('rejects negative amount', () => {
    expect(() => calculateLeaveProRata(-1, 10, 31)).toThrow(/non-negative/)
  })

  it('rejects out-of-range coverageDays', () => {
    expect(() => calculateLeaveProRata(1000, 10, 0)).toThrow(/1–31/)
    expect(() => calculateLeaveProRata(1000, 10, 32)).toThrow(/1–31/)
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

describe('recomputeLocalAmount', () => {
  it('computes floor(amount × rate / 1_000_000)', () => {
    // rate = 7.123 stored as 7_123_000
    expect(recomputeLocalAmount(64, 7_123_000)).toBe(455) // floor(64*7.123) = 455
    expect(recomputeLocalAmount(200, 7_123_000)).toBe(1424)
    expect(recomputeLocalAmount(100, 1_000_000)).toBe(100) // rate=1
  })

  it('returns 0 for amount=0', () => {
    expect(recomputeLocalAmount(0, 7_123_000)).toBe(0)
  })
})

describe('distributeDiff', () => {
  it('splits evenly when total divides parts', () => {
    expect(distributeDiff(60, 3)).toEqual([20, 20, 20])
  })

  it('gives the first recipients the remainder cent (round-robin)', () => {
    // 104 / 3 = 34 base, remainder = 2 → first two get +1
    expect(distributeDiff(104, 3)).toEqual([35, 35, 34])
  })

  it('handles remainder = parts - 1', () => {
    // 7 / 3 = 2 base, remainder = 1 → first one gets +1
    expect(distributeDiff(7, 3)).toEqual([3, 2, 2])
  })

  it('returns [] when parts = 0', () => {
    expect(distributeDiff(100, 0)).toEqual([])
  })

  it('returns [total] when parts = 1', () => {
    expect(distributeDiff(42, 1)).toEqual([42])
  })

  it('rejects negative total', () => {
    expect(() => distributeDiff(-1, 3)).toThrow(/non-negative/)
  })

  it('conservation invariant: Σ(result) === total', () => {
    const cases: Array<[number, number]> = [
      [0, 5],
      [1, 3],
      [100, 7],
      [999, 4],
      [12345, 9],
    ]
    for (const [total, parts] of cases) {
      expect(distributeDiff(total, parts).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })
})

describe('calculateR5NewAmount', () => {
  it('R1 bill with no R11 delta: just swaps old share for new share', () => {
    // R1: daysCovered === daysInMonth. Bill is currently oldShare.
    expect(
      calculateR5NewAmount({
        currentAmount: 250,
        oldShare: 250,
        newShare: 400,
        daysCovered: 31,
        daysInMonth: 31,
      })
    ).toBe(400)
  })

  it('R1 bill with R11 delta: carries delta forward', () => {
    // Currently 335 = 250 (oldShare) + 85 (R11 bump). After price change to
    // newShare=400, the bill should become 400 + 85 = 485.
    expect(
      calculateR5NewAmount({
        currentAmount: 335,
        oldShare: 250,
        newShare: 400,
        daysCovered: 31,
        daysInMonth: 31,
      })
    ).toBe(485)
  })

  it('R2 bill with no R11 delta: rescales pro-rata to new share', () => {
    // oldShare=300, daysCovered=17/31 → oldBaseline=floor(300*17/31)=164
    // newShare=400, newBaseline=floor(400*17/31)=219
    // currentAmount==oldBaseline → delta=0 → new=219
    expect(
      calculateR5NewAmount({
        currentAmount: 164,
        oldShare: 300,
        newShare: 400,
        daysCovered: 17,
        daysInMonth: 31,
      })
    ).toBe(219)
  })

  it('R2 bill with R11 delta: adds delta on top of rescaled pro-rata', () => {
    // Same R2 setup as above, but currentAmount includes a +50 R11 bump (214).
    // oldBaseline=164 → delta=50. newBaseline=219 → new=219+50=269.
    expect(
      calculateR5NewAmount({
        currentAmount: 214,
        oldShare: 300,
        newShare: 400,
        daysCovered: 17,
        daysInMonth: 31,
      })
    ).toBe(269)
  })
})
