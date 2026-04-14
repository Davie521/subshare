import { describe, it, expect } from 'vitest'
import { calculateJoinProRata } from '@/lib/billing'

/**
 * R2 — pre-paid mid-cycle join pro-rata.
 *
 * Formula: floor(share × (daysInMonth - dayOfMonth + 1) / daysInMonth)
 *
 * "Days covered" counts the join day AND every day through month end
 * because the payer prepaid the whole month upfront.
 */
describe('calculateJoinProRata (R2)', () => {
  it('day 1 of 30-day month pays the full share', async () => {
    expect(calculateJoinProRata(108, 1, 30)).toBe(108)
  })

  it('day 30 of 30-day month pays 1/30 of the share', async () => {
    // 30 days remaining covered = day 30 only → 1/30
    expect(calculateJoinProRata(108, 30, 30)).toBe(Math.floor((108 * 1) / 30))
  })

  it('day 20 of 30-day month pays 11/30 of the share (floored)', async () => {
    // Days covered: 20, 21, ..., 30 = 11 days
    // 108 * 11 / 30 = 39.6 → floor = 39
    expect(calculateJoinProRata(108, 20, 30)).toBe(39)
  })

  it('share=100, day 20 in 30-day month → 36', async () => {
    // 100 * 11 / 30 = 36.666... → floor = 36
    expect(calculateJoinProRata(100, 20, 30)).toBe(36)
  })

  it('day 28 in February (28 days) pays 1/28 of the share', async () => {
    expect(calculateJoinProRata(1400, 28, 28)).toBe(50)
  })

  it('day 15 in 31-day month', async () => {
    // Days covered: 15..31 = 17 days
    // 1000 * 17 / 31 = 548.38 → floor = 548
    expect(calculateJoinProRata(1000, 15, 31)).toBe(548)
  })

  it('handles 29-day leap February', async () => {
    // Day 29 of 29-day month → 1/29 share
    expect(calculateJoinProRata(2900, 29, 29)).toBe(100)
  })

  it('share of 0 returns 0', async () => {
    expect(calculateJoinProRata(0, 15, 30)).toBe(0)
  })

  it('rejects dayOfMonth < 1', async () => {
    expect(() => calculateJoinProRata(100, 0, 30)).toThrow()
    expect(() => calculateJoinProRata(100, -5, 30)).toThrow()
  })

  it('rejects dayOfMonth > daysInMonth', async () => {
    expect(() => calculateJoinProRata(100, 31, 30)).toThrow()
    expect(() => calculateJoinProRata(100, 32, 31)).toThrow()
  })

  it('rejects invalid daysInMonth', async () => {
    expect(() => calculateJoinProRata(100, 1, 27)).toThrow() // Feb non-leap is 28, not 27
    expect(() => calculateJoinProRata(100, 1, 32)).toThrow()
  })

  it('rejects negative share', async () => {
    expect(() => calculateJoinProRata(-1, 15, 30)).toThrow()
  })
})
