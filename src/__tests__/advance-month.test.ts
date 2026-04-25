import { describe, it, expect } from 'vitest'
import { advanceMonth } from '@/lib/date-utils'

/**
 * advanceMonth: bump an ISO YYYY-MM-DD date by exactly one calendar
 * month, clamping the day to the target month's length. Used to roll
 * `nextPayment` forward each R1 cycle.
 *
 * Drift is tolerated: 1/31 → 2/28 → 3/28 → 4/28… The immutable
 * `startDate` column is the source of truth for "original day-of-month";
 * advanceMonth is only responsible for "+ 1 month with month-end
 * survival."
 */
describe('advanceMonth', () => {
  it('plain mid-month advance', () => {
    expect(advanceMonth('2026-04-28')).toBe('2026-05-28')
  })

  it('first of month → first of next', () => {
    expect(advanceMonth('2026-05-01')).toBe('2026-06-01')
  })

  it('clamps Jan 31 → Feb 28 in a non-leap year', () => {
    expect(advanceMonth('2026-01-31')).toBe('2026-02-28')
  })

  it('clamps Jan 31 → Feb 29 in a leap year', () => {
    expect(advanceMonth('2024-01-31')).toBe('2024-02-29')
  })

  it('March 31 → April 30 (April has 30 days)', () => {
    expect(advanceMonth('2026-03-31')).toBe('2026-04-30')
  })

  it('rolls year on December', () => {
    expect(advanceMonth('2026-12-31')).toBe('2027-01-31')
  })

  it('rolls year on December (mid-month)', () => {
    expect(advanceMonth('2026-12-15')).toBe('2027-01-15')
  })

  it('clamps Aug 31 → Sep 30', () => {
    expect(advanceMonth('2026-08-31')).toBe('2026-09-30')
  })
})
