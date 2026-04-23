import { describe, it, expect } from 'vitest'
import { todayInAppTz } from '@/lib/date-utils'

describe('todayInAppTz', () => {
  it('returns YYYY-MM-DD for a UTC instant in Asia/Shanghai', () => {
    // 2026-04-30 22:30 UTC is 2026-05-01 06:30 in Shanghai (+08).
    const d = new Date('2026-04-30T22:30:00Z')
    expect(todayInAppTz(d, 'Asia/Shanghai')).toBe('2026-05-01')
  })

  it('returns UTC-local date when tz=UTC', () => {
    const d = new Date('2026-04-30T22:30:00Z')
    expect(todayInAppTz(d, 'UTC')).toBe('2026-04-30')
  })

  it('handles DST boundary in America/New_York', () => {
    // 2026-03-08 07:00 UTC = 2026-03-08 02:00 or 03:00 EST/EDT — date
    // is still 2026-03-08 locally.
    const d = new Date('2026-03-08T07:00:00Z')
    expect(todayInAppTz(d, 'America/New_York')).toBe('2026-03-08')
  })

  it('P0-3/6: UTC midnight-edge maps to correct Shanghai date', () => {
    // This is the exact bug: a UTC server with a user in +08 would read
    // "yesterday" at 06:00 local, causing R1 cron to skip the month.
    const d = new Date('2026-05-01T00:00:00Z')
    // UTC says 2026-05-01; Shanghai says 2026-05-01 08:00.
    expect(todayInAppTz(d, 'Asia/Shanghai')).toBe('2026-05-01')

    // But five hours earlier on UTC: 2026-04-30 19:00 UTC.
    const d2 = new Date('2026-04-30T19:00:00Z')
    // UTC: 2026-04-30. Shanghai: 2026-05-01 03:00.
    expect(todayInAppTz(d2, 'UTC')).toBe('2026-04-30')
    expect(todayInAppTz(d2, 'Asia/Shanghai')).toBe('2026-05-01')
  })
})
