import { describe, it, expect } from 'vitest'
import {
  fairAllocation,
  distributeWithRotation,
  type MemberInterval,
} from '@/lib/fair-allocation'

/**
 * Helpers for crafting MemberInterval inputs concisely.
 */
const m = (
  userId: number,
  addedAt: string,
  leftAt: string | null = null
): MemberInterval => ({ userId, addedAt, leftAt })

/** Sum the values of a Map<number, number>. */
const sumMap = (mp: Map<number, number>): number =>
  [...mp.values()].reduce((a, b) => a + b, 0)

// ────────────────────────────────────────────────────────────────────
// 1. Basic allocation — full-month members, no time variation
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — basic full-month allocation', () => {
  it('single member full month gets entire price', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(20000)
    expect(sumMap(r)).toBe(20000)
  })

  it('two members full month, divisible price → exact split', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(10000)
    expect(r.get(2)).toBe(10000)
    expect(sumMap(r)).toBe(20000)
  })

  it('three members full month, indivisible price → residue rotated', () => {
    // $200 = 20000¢ / 3 = 6666.67 each → floor 6666 × 3 = 19998, residue 2
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01'), m(3, '2026-05-01')],
      roundingSeed: 0,
    })
    // Sorted users: [1, 2, 3]. Rotation start = 0 mod 3 = 0. Residue 2 → users 1, 2 get +1.
    expect(r.get(1)).toBe(6667)
    expect(r.get(2)).toBe(6667)
    expect(r.get(3)).toBe(6666)
    expect(sumMap(r)).toBe(20000)
  })

  it('three members full month, seed=1 rotates +1 to users 2, 3', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01'), m(3, '2026-05-01')],
      roundingSeed: 1,
    })
    expect(r.get(1)).toBe(6666)
    expect(r.get(2)).toBe(6667)
    expect(r.get(3)).toBe(6667)
    expect(sumMap(r)).toBe(20000)
  })

  it('three members full month, seed=2 rotates +1 to users 3, 1', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01'), m(3, '2026-05-01')],
      roundingSeed: 2,
    })
    expect(r.get(1)).toBe(6667)
    expect(r.get(2)).toBe(6666)
    expect(r.get(3)).toBe(6667)
    expect(sumMap(r)).toBe(20000)
  })

  it('four members full month, divisible → exact $50 each', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-01'),
        m(3, '2026-05-01'),
        m(4, '2026-05-01'),
      ],
      roundingSeed: 0,
    })
    expect([...r.values()]).toEqual([5000, 5000, 5000, 5000])
    expect(sumMap(r)).toBe(20000)
  })
})

// ────────────────────────────────────────────────────────────────────
// 2. Date semantics — addedAt inclusive, leftAt exclusive
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — date boundary semantics', () => {
  it('addedAt = first day of month → full month coverage', () => {
    // 2 members, both joined exactly on first day → exact 50/50
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3100)
    expect(r.get(2)).toBe(3100)
  })

  it('addedAt = last day of month → only 1 day of coverage', () => {
    // May 31 = day 31. Member active days 31..31 = 1 day
    // Other member full month = 31 days. Total person-days = 32.
    // dailyCost = 6200/31 = 200/day. perPersonDay days 1-30 (only m1 active) = 200.
    // day 31: both active → each 100.
    // m1 fair = 30×200 + 100 = 6100. m2 fair = 100. Sum = 6200 ✓
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-31')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(6100)
    expect(r.get(2)).toBe(100)
    expect(sumMap(r)).toBe(6200)
  })

  it('addedAt = leftAt = same day → user active for that 1 day', () => {
    // Closed interval: [5/1, 5/1] = 1 day (5/1 included on both ends)
    // m1 active full month, m2 active 5/1 only.
    // dailyCost = 6200/31 = 200. day 1: N=2, each 100. days 2..31: N=1, m1=200.
    // m1 = 100 + 30×200 = 6100. m2 = 100. Sum = 6200 ✓
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01', '2026-05-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(6100)
    expect(r.get(2)).toBe(100)
  })

  it('leftAt = last day of month → full month coverage (closed interval)', () => {
    // m2 leftAt=5/31 means last day of use = 5/31. Active 5/1..5/31 (full).
    // m1 active full month too. Even split.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01', '2026-05-31')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3100)
    expect(r.get(2)).toBe(3100)
  })

  it('leftAt past month end → full month coverage in this month', () => {
    // m2 leftAt=6/1 (in June). For May calc, m2 active 5/1..5/31.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01', '2026-06-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3100)
    expect(r.get(2)).toBe(3100)
  })

  it('two-day interval [5/1, 5/2] includes both days', () => {
    // Sanity: [addedAt, leftAt] is closed → 2-day interval has 2 active days.
    // m1 full month. m2 active 5/1, 5/2 only.
    // dailyCost = 6200/31 = 200. days 1,2: N=2, each 100. days 3..31: N=1, m1=200.
    // m2 = 2 × 100 = 200. m1 = 2×100 + 29×200 = 200 + 5800 = 6000. Sum=6200.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01', '2026-05-02')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(6000)
    expect(r.get(2)).toBe(200)
  })

  it('addedAt before month start → clamps to month start', () => {
    // Both joined 4/15, sub started 4/1; for May they're active full month
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-04-15'), m(2, '2026-04-15')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3100)
    expect(r.get(2)).toBe(3100)
  })

  it('addedAt after month end → not active in this month, fair = 0', () => {
    // m1 active full month, m2 doesn't join until June
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-06-15')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(6200)
    expect(r.get(2) ?? 0).toBe(0)
  })

  it('leftAt before month start → not active in this month, fair = 0', () => {
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-04-01', '2026-04-30')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(6200)
    expect(r.get(2) ?? 0).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────
// 3. Mid-cycle joins / leaves — replaces R2 / R3
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — mid-cycle joins and leaves', () => {
  it('one member joins on day 27 of 30-day month (R2 prorate analog)', () => {
    // April has 30 days. m2 active days 27..30 = 4 days. m1 active all 30.
    // dailyCost = 6000/30 = 200. days 1..26: N=1, m1=200/day. days 27..30: N=2, each 100.
    // m1 = 26×200 + 4×100 = 5600. m2 = 4×100 = 400. Sum 6000 ✓
    const r = fairAllocation({
      price: 6000,
      year: 2026,
      month: 4,
      intervals: [m(1, '2026-04-01'), m(2, '2026-04-27')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(5600)
    expect(r.get(2)).toBe(400)
    expect(sumMap(r)).toBe(6000)
  })

  it('one member leaves on day 16 of 31-day month (last day of use = 5/16)', () => {
    // CLOSED: m2 leftAt=5/16 → active 5/1..5/16 (16 days). m1 full month.
    // dailyCost = 6200/31 = 200. days 1..16: N=2, each 100. days 17..31: N=1, m1=200.
    // m1 = 16×100 + 15×200 = 1600 + 3000 = 4600. m2 = 16×100 = 1600. Sum 6200 ✓
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01', '2026-05-16')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(4600)
    expect(r.get(2)).toBe(1600)
    expect(sumMap(r)).toBe(6200)
  })

  it('member joins and leaves within same month (closed [5/10, 5/20] = 11 days)', () => {
    // CLOSED: m2 active 5/10..5/20 (11 days). m1 full month.
    // dailyCost = 200. days 1..9: N=1, m1=9×200=1800.
    // days 10..20 (11 days): N=2, each 100. m1+=1100, m2=1100.
    // days 21..31 (11 days): N=1, m1+=2200. Total m1 = 5100, m2 = 1100. Sum 6200.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-10', '2026-05-20')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(5100)
    expect(r.get(2)).toBe(1100)
    expect(sumMap(r)).toBe(6200)
  })

  it('4 members: m4 leftAt=5/16 (last day 5/16), m5 addedAt=5/20', () => {
    // CLOSED:
    // days 1..16 (16 days): N=4 (m1,m2,m3,m4). each 50. 4 members each += 800.
    // days 17..19 (3 days): N=3 (m1,m2,m3). each 200/3 ≈ 66.67. 3 days × 66.67 = 200 each.
    // days 20..31 (12 days): N=4 (m1,m2,m3,m5). each 50. 4 members each += 600.
    //
    // m1/m2/m3 each = 800 + 200 + 600 = 1600. m4 = 800. m5 = 600. Sum = 6200 (exact).
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-01'),
        m(3, '2026-05-01'),
        m(4, '2026-05-01', '2026-05-16'),
        m(5, '2026-05-20'),
      ],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(1600)
    expect(r.get(2)).toBe(1600)
    expect(r.get(3)).toBe(1600)
    expect(r.get(4)).toBe(800)
    expect(r.get(5)).toBe(600)
    expect(sumMap(r)).toBe(6200)
  })

  it('member joins and leaves same day → user pays for that 1 day (closed)', () => {
    // CLOSED: addedAt=5/15, leftAt=5/15 → active 5/15 only (1 day).
    // dailyCost = 200. days 1..14: N=1, m1=2800. day 15: N=2, each 100, m1+=100, m2=100.
    // days 16..31: N=1, m1+=3200. m1 = 6100. m2 = 100. Sum 6200.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-15', '2026-05-15')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(6100)
    expect(r.get(2)).toBe(100)
    expect(sumMap(r)).toBe(6200)
  })

  it('same-day swap creates overlap day under closed interval', () => {
    // CLOSED: m2 leftAt=5/15 (last day 5/15), m3 addedAt=5/15 (first day 5/15).
    // Both active on 5/15 → N spike. UI should prevent this if unintended.
    //
    // days 1..14 (14 days): N=2 (m1, m2). each 100.
    // day 15 (1 day): N=3 (m1, m2, m3). each 200/3 ≈ 66.67.
    // days 16..31 (16 days): N=2 (m1, m3). each 100.
    //
    // m1 fair = 14×100 + 200/3 + 16×100 = 1400 + 66.67 + 1600 = 3066.67
    // m2 fair = 14×100 + 200/3 = 1466.67
    // m3 fair = 200/3 + 16×100 = 1666.67
    // Sum (exact rationals) = 9200/3 + 4400/3 + 5000/3 = 18600/3 = 6200 ✓
    // Floors: 3066, 1466, 1666 = 6198. Residue 2.
    // Sorted [1,2,3], seed 0 → users 1, 2 get +1.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-01', '2026-05-15'),
        m(3, '2026-05-15'),
      ],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3067)
    expect(r.get(2)).toBe(1467)
    expect(r.get(3)).toBe(1666)
    expect(sumMap(r)).toBe(6200)
  })
})

// ────────────────────────────────────────────────────────────────────
// 4. Rejoin / multi-interval per user
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — multi-interval (rejoin) support', () => {
  it('user with two disjoint intervals in same month → both counted', () => {
    // CLOSED: m2 has [5/5, 5/10] (6 days) + [5/20, 5/25] (6 days) = 12 active days.
    // m1 active full 31 days. days when both: 12 at N=2. days only m1: 19 at N=1.
    // m1 = 19×200 + 12×100 = 3800 + 1200 = 5000. m2 = 12×100 = 1200. Sum 6200.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-05', '2026-05-10'),
        m(2, '2026-05-20', '2026-05-25'),
      ],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(5000)
    expect(r.get(2)).toBe(1200)
    expect(sumMap(r)).toBe(6200)
  })

  it('user with overlapping intervals in same month → throws', () => {
    expect(() =>
      fairAllocation({
        price: 6200,
        year: 2026,
        month: 5,
        intervals: [
          m(1, '2026-05-01'),
          m(2, '2026-05-05', '2026-05-15'),
          m(2, '2026-05-10', '2026-05-20'),
        ],
        roundingSeed: 0,
      })
    ).toThrow(/overlap/i)
  })

  it('rejoin where second addedAt = previous leftAt → throws (closed: same day shared)', () => {
    // CLOSED: [5/5, 5/15] + [5/15, 5/20] both include day 15 → overlap → throws.
    expect(() =>
      fairAllocation({
        price: 6200,
        year: 2026,
        month: 5,
        intervals: [
          m(1, '2026-05-01'),
          m(2, '2026-05-05', '2026-05-15'),
          m(2, '2026-05-15', '2026-05-20'),
        ],
        roundingSeed: 0,
      })
    ).toThrow(/overlap/i)
  })

  it('rejoin with gap: second addedAt = previous leftAt + 1 is allowed', () => {
    // CLOSED: [5/5, 5/14] (10 days) + [5/15, 5/20] (6 days) = 16 active days. No shared day.
    // m1 full 31 days. days both: 16 at N=2. days only m1: 15 at N=1.
    // m1 = 15×200 + 16×100 = 3000 + 1600 = 4600. m2 = 16×100 = 1600. Sum 6200.
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-05', '2026-05-14'),
        m(2, '2026-05-15', '2026-05-20'),
      ],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(4600)
    expect(r.get(2)).toBe(1600)
  })
})

// ────────────────────────────────────────────────────────────────────
// 5. Calendar edge cases
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — calendar edge cases', () => {
  it('non-leap February (28 days)', () => {
    // 2026 is non-leap. 2 members full Feb.
    const r = fairAllocation({
      price: 5600,
      year: 2026,
      month: 2,
      intervals: [m(1, '2026-02-01'), m(2, '2026-02-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(2800)
    expect(r.get(2)).toBe(2800)
  })

  it('leap February (29 days)', () => {
    // 2024 is leap. 2 members full Feb.
    const r = fairAllocation({
      price: 5800,
      year: 2024,
      month: 2,
      intervals: [m(1, '2024-02-01'), m(2, '2024-02-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(2900)
    expect(r.get(2)).toBe(2900)
  })

  it('30-day month (April)', () => {
    const r = fairAllocation({
      price: 6000,
      year: 2026,
      month: 4,
      intervals: [m(1, '2026-04-01'), m(2, '2026-04-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3000)
    expect(r.get(2)).toBe(3000)
  })

  it('31-day month (December across year boundary)', () => {
    // m2 leaves 1/1 next year → still active all of December
    const r = fairAllocation({
      price: 6200,
      year: 2026,
      month: 12,
      intervals: [m(1, '2026-12-01'), m(2, '2026-12-01', '2027-01-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(3100)
    expect(r.get(2)).toBe(3100)
  })
})

// ────────────────────────────────────────────────────────────────────
// 6. Empty / degenerate inputs
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — empty / degenerate', () => {
  it('empty intervals → empty Map (sum 0)', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [],
      roundingSeed: 0,
    })
    expect(r.size).toBe(0)
    expect(sumMap(r)).toBe(0)
  })

  it('all intervals out-of-month → empty Map (sum 0)', () => {
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-04-01', '2026-04-30'),
        m(2, '2026-06-01'),
      ],
      roundingSeed: 0,
    })
    expect(r.get(1) ?? 0).toBe(0)
    expect(r.get(2) ?? 0).toBe(0)
    expect(sumMap(r)).toBe(0)
  })

  it('price = 0 → all fairs = 0', () => {
    const r = fairAllocation({
      price: 0,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(0)
    expect(r.get(2)).toBe(0)
    expect(sumMap(r)).toBe(0)
  })

  it('price = 1¢, 3 full-month members, seed=0 → user 1 gets the cent', () => {
    const r = fairAllocation({
      price: 1,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01'), m(3, '2026-05-01')],
      roundingSeed: 0,
    })
    expect(r.get(1)).toBe(1)
    expect(r.get(2)).toBe(0)
    expect(r.get(3)).toBe(0)
    expect(sumMap(r)).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────
// 7. Validation errors
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — input validation', () => {
  it('addedAt > leftAt → throws', () => {
    expect(() =>
      fairAllocation({
        price: 20000,
        year: 2026,
        month: 5,
        intervals: [m(1, '2026-05-15', '2026-05-10')],
        roundingSeed: 0,
      })
    ).toThrow(/added.*after.*left|invalid.*interval/i)
  })

  it('non-ISO date string → throws', () => {
    expect(() =>
      fairAllocation({
        price: 20000,
        year: 2026,
        month: 5,
        intervals: [m(1, '5/1/2026')],
        roundingSeed: 0,
      })
    ).toThrow(/iso|format|YYYY-MM-DD/i)
  })

  it('month out of range (0) → throws', () => {
    expect(() =>
      fairAllocation({
        price: 20000,
        year: 2026,
        month: 0,
        intervals: [m(1, '2026-05-01')],
        roundingSeed: 0,
      })
    ).toThrow(/month/i)
  })

  it('month out of range (13) → throws', () => {
    expect(() =>
      fairAllocation({
        price: 20000,
        year: 2026,
        month: 13,
        intervals: [m(1, '2026-05-01')],
        roundingSeed: 0,
      })
    ).toThrow(/month/i)
  })

  it('negative price → throws', () => {
    expect(() =>
      fairAllocation({
        price: -100,
        year: 2026,
        month: 5,
        intervals: [m(1, '2026-05-01')],
        roundingSeed: 0,
      })
    ).toThrow(/price.*non-negative|negative/i)
  })

  it('non-integer price → throws', () => {
    expect(() =>
      fairAllocation({
        price: 100.5,
        year: 2026,
        month: 5,
        intervals: [m(1, '2026-05-01')],
        roundingSeed: 0,
      })
    ).toThrow(/integer|price/i)
  })
})

// ────────────────────────────────────────────────────────────────────
// 8. Invariants / property tests
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — invariants', () => {
  it('sum always equals price (≥1 active member)', () => {
    // Random-ish set of intervals — verify sum invariant for each.
    const cases = [
      { price: 17, members: 2 },
      { price: 100, members: 3 },
      { price: 2999, members: 7 },
      { price: 20000, members: 5 },
      { price: 12345, members: 11 },
    ]
    for (const c of cases) {
      const intervals = Array.from({ length: c.members }, (_, i) =>
        m(i + 1, '2026-05-01')
      )
      const r = fairAllocation({
        price: c.price,
        year: 2026,
        month: 5,
        intervals,
        roundingSeed: 0,
      })
      expect(sumMap(r)).toBe(c.price)
    }
  })

  it('sum equals price under arbitrary timeline', () => {
    const r = fairAllocation({
      price: 31337,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-03'),
        m(3, '2026-05-07', '2026-05-22'),
        m(4, '2026-05-14'),
        m(5, '2026-05-25', '2026-05-28'),
      ],
      roundingSeed: 0,
    })
    expect(sumMap(r)).toBe(31337)
  })

  it('idempotent — same input produces same output', () => {
    const input = {
      price: 7777,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-08'), m(3, '2026-05-22')],
      roundingSeed: 42,
    }
    const r1 = fairAllocation(input)
    const r2 = fairAllocation(input)
    expect([...r1.entries()].sort()).toEqual([...r2.entries()].sort())
  })

  it('|max - min| of fairs ≤ 1¢ when all members have identical timelines', () => {
    // Three members all full month → fairs differ by ≤ 1
    const r = fairAllocation({
      price: 1000003,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01'), m(3, '2026-05-01')],
      roundingSeed: 0,
    })
    const vals = [...r.values()]
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1)
  })

  it('member with 0 active days does not affect others', () => {
    const baseline = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [m(1, '2026-05-01'), m(2, '2026-05-01')],
      roundingSeed: 0,
    })
    const withGhost = fairAllocation({
      price: 6200,
      year: 2026,
      month: 5,
      intervals: [
        m(1, '2026-05-01'),
        m(2, '2026-05-01'),
        m(3, '2026-06-01'), // joins next month, 0 active days here
      ],
      roundingSeed: 0,
    })
    expect(withGhost.get(1)).toBe(baseline.get(1))
    expect(withGhost.get(2)).toBe(baseline.get(2))
    expect(withGhost.get(3) ?? 0).toBe(0)
  })

  it('different rounding seeds produce different distributions but same sum', () => {
    const seeds = [0, 1, 2, 3, 7, 42, 100]
    const sums = seeds.map((s) =>
      sumMap(
        fairAllocation({
          price: 20000,
          year: 2026,
          month: 5,
          intervals: [
            m(1, '2026-05-01'),
            m(2, '2026-05-01'),
            m(3, '2026-05-01'),
          ],
          roundingSeed: s,
        })
      )
    )
    // All sums equal price
    expect(sums.every((s) => s === 20000)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────
// 9. Sub 24 production canary (per-day model)
// ────────────────────────────────────────────────────────────────────

describe('fairAllocation — Sub 24 production canary', () => {
  it('Claude Max $200, May 2026, after Daviefan addedAt backdated to 4/27', () => {
    // Production sub 24 timeline (after fix):
    //   Magic-Alpha (10): payer, addedAt 4/27, never left
    //   Daviefan (5): addedAt backdated to 4/27 (was 5/3), never left
    //   Albert (9): addedAt 5/3
    //
    // For May (31 days): both 10 and 5 active full month; 9 active days 3..31 (29 days).
    //   dailyCost = 20000/31 ≈ 645.16
    //   days 1..2 (2 days): N=2 (10, 5). per-person = 322.58/day
    //   days 3..31 (29 days): N=3. per-person = 215.05/day
    //
    // user 5 fair = 2×322.58 + 29×215.05 = 645.16 + 6236.45 = 6881.61
    // user 10 fair = same = 6881.61
    // user 9 fair = 29×215.05 = 6236.45
    // Sum (exact rationals) = 20000 ✓
    //
    // Floors: 5→6881, 9→6236, 10→6881. Sum = 19998. Residue = 2.
    // Sorted userIds [5, 9, 10], seed = 0 → start at index 0.
    // Positions 0, 1 get +1: users 5 and 9.
    // Final: {5: 6882, 9: 6237, 10: 6881}
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 5,
      intervals: [
        m(10, '2026-04-27'),
        m(5, '2026-04-27'),
        m(9, '2026-05-03'),
      ],
      roundingSeed: 0,
    })
    expect(r.get(5)).toBe(6882)
    expect(r.get(9)).toBe(6237)
    expect(r.get(10)).toBe(6881)
    expect(sumMap(r)).toBe(20000)
  })

  it('Claude Max $200, April 2026 partial month — both members joined 4/27 (4 active days)', () => {
    // Real Sub 24: sub.start_date = 2026-04-27, both Magic-Alpha (10) and
    // Daviefan (5) addedAt = 2026-04-27. Albert (9) joined 5/3 (not in April).
    //
    // April: days 1-26 the sub didn't exist (N=0). Days 27-30 both active (N=2).
    // activeDays = 4. dailyCost = 20000/4 = 5000.
    // Days 27-30: per-person = 5000/2 = 2500/day. Each member = 4 × 2500 = 10000.
    // Sum = 20000 ✓ (no forfeit; engine uses activeDays as denominator).
    const r = fairAllocation({
      price: 20000,
      year: 2026,
      month: 4,
      intervals: [
        m(10, '2026-04-27'),
        m(5, '2026-04-27'),
        m(9, '2026-05-03'), // not active in April
      ],
      roundingSeed: 0,
    })
    expect(r.get(10)).toBe(10000)
    expect(r.get(5)).toBe(10000)
    expect(r.get(9) ?? 0).toBe(0)
    expect(sumMap(r)).toBe(20000)
  })
})

// ────────────────────────────────────────────────────────────────────
// 10. distributeWithRotation — pure function
// ────────────────────────────────────────────────────────────────────

describe('distributeWithRotation', () => {
  it('residue = 0 → all recipients get 0', () => {
    const r = distributeWithRotation({
      residue: 0,
      userIds: [1, 2, 3],
      seed: 0,
    })
    expect(r.get(1)).toBe(0)
    expect(r.get(2)).toBe(0)
    expect(r.get(3)).toBe(0)
  })

  it('residue = 1, seed = 0 → first user gets +1', () => {
    const r = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 0,
    })
    expect(r.get(10)).toBe(1)
    expect(r.get(20)).toBe(0)
    expect(r.get(30)).toBe(0)
  })

  it('residue = 1, seed = 1 → second user gets +1', () => {
    const r = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 1,
    })
    expect(r.get(10)).toBe(0)
    expect(r.get(20)).toBe(1)
    expect(r.get(30)).toBe(0)
  })

  it('residue = 1, seed = 2 → third user gets +1', () => {
    const r = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 2,
    })
    expect(r.get(10)).toBe(0)
    expect(r.get(20)).toBe(0)
    expect(r.get(30)).toBe(1)
  })

  it('residue = 1, seed = 3 → wraps back to first user', () => {
    const r = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 3,
    })
    expect(r.get(10)).toBe(1)
  })

  it('residue = 2, seed = 0, N = 3 → first two get +1', () => {
    const r = distributeWithRotation({
      residue: 2,
      userIds: [10, 20, 30],
      seed: 0,
    })
    expect(r.get(10)).toBe(1)
    expect(r.get(20)).toBe(1)
    expect(r.get(30)).toBe(0)
  })

  it('residue = 2, seed = 2, N = 3 → wraps: third + first get +1', () => {
    const r = distributeWithRotation({
      residue: 2,
      userIds: [10, 20, 30],
      seed: 2,
    })
    expect(r.get(10)).toBe(1)
    expect(r.get(20)).toBe(0)
    expect(r.get(30)).toBe(1)
  })

  it('residue = N-1 → all but rotation-end-position get +1', () => {
    const r = distributeWithRotation({
      residue: 2,
      userIds: [10, 20, 30],
      seed: 0,
    })
    expect([...r.values()].reduce((a, b) => a + b)).toBe(2)
  })

  it('residue = N → throws (residue must be < N)', () => {
    expect(() =>
      distributeWithRotation({
        residue: 3,
        userIds: [10, 20, 30],
        seed: 0,
      })
    ).toThrow(/residue/i)
  })

  it('residue > N → throws', () => {
    expect(() =>
      distributeWithRotation({
        residue: 5,
        userIds: [10, 20, 30],
        seed: 0,
      })
    ).toThrow(/residue/i)
  })

  it('negative residue → throws', () => {
    expect(() =>
      distributeWithRotation({
        residue: -1,
        userIds: [10, 20, 30],
        seed: 0,
      })
    ).toThrow(/residue.*non-negative|negative/i)
  })

  it('empty userIds → empty Map', () => {
    const r = distributeWithRotation({
      residue: 0,
      userIds: [],
      seed: 0,
    })
    expect(r.size).toBe(0)
  })

  it('large seed mod N gives same as seed mod N', () => {
    const r1 = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 100,
    })
    const r2 = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 100 % 3,
    })
    expect([...r1.entries()]).toEqual([...r2.entries()])
  })

  it('single user, residue = 0 → that user gets 0', () => {
    const r = distributeWithRotation({
      residue: 0,
      userIds: [42],
      seed: 0,
    })
    expect(r.get(42)).toBe(0)
  })

  it('order of userIds determines rotation position', () => {
    // [10, 20, 30] vs [30, 20, 10]: same set, different order
    const r1 = distributeWithRotation({
      residue: 1,
      userIds: [10, 20, 30],
      seed: 0,
    })
    const r2 = distributeWithRotation({
      residue: 1,
      userIds: [30, 20, 10],
      seed: 0,
    })
    // Both have +1 at position 0, but position 0 = different user
    expect(r1.get(10)).toBe(1)
    expect(r2.get(30)).toBe(1)
  })
})
