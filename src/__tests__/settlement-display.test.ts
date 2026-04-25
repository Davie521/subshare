import { describe, it, expect } from 'vitest'
import {
  lastDayOfMonthISO,
  formatBillingRange,
  isPending,
  daysBetweenISO,
  groupBillsBySubscription,
  splitBillsByPending,
  type SettlementBillInput,
} from '@/lib/settlement-display'

/**
 * Phase 1 of the settlement-page refactor: pure helpers that will drive
 * the merged per-subscription rows (Phase 2) and the upcoming toggle
 * (Phase 3). Kept pure so they can be unit-tested without pulling the
 * whole React tree + DB stack.
 *
 * TZ safety: all "today / billingDate" comparisons here are string-based
 * on ISO YYYY-MM-DD values — this side-steps the latent bug in the old
 * page.tsx where `new Date()` pulled browser-local TZ and drifted from
 * the server's Asia/Shanghai billingDate.
 */

describe('lastDayOfMonthISO', () => {
  it('returns April 30', () => {
    expect(lastDayOfMonthISO('2026-04-15')).toBe('2026-04-30')
  })

  it('returns May 31', () => {
    expect(lastDayOfMonthISO('2026-05-01')).toBe('2026-05-31')
  })

  it('returns Feb 28 in a non-leap year', () => {
    expect(lastDayOfMonthISO('2026-02-10')).toBe('2026-02-28')
  })

  it('returns Feb 29 in a leap year', () => {
    expect(lastDayOfMonthISO('2024-02-10')).toBe('2024-02-29')
  })

  it('returns Dec 31 without rolling to next year', () => {
    expect(lastDayOfMonthISO('2026-12-05')).toBe('2026-12-31')
  })

  it('works when input is already the last day', () => {
    expect(lastDayOfMonthISO('2026-07-31')).toBe('2026-07-31')
  })
})

describe('formatBillingRange', () => {
  // Explicit locale so test output is deterministic across Node versions / CI locales.
  const locale = 'en-US'

  it('renders a cross-month range with an en-dash separator', () => {
    const out = formatBillingRange('2026-04-25', '2026-05-31', locale)
    expect(out).toBe('Apr 25 – May 31')
  })

  it('renders a same-month range', () => {
    expect(formatBillingRange('2026-05-01', '2026-05-31', locale)).toBe(
      'May 1 – May 31'
    )
  })

  it('collapses to a single date when start == end', () => {
    const out = formatBillingRange('2026-04-25', '2026-04-25', locale)
    expect(out).toBe('Apr 25')
    expect(out).not.toContain('–')
  })
})

describe('isPending', () => {
  it('is true when billingDate is strictly in the future', () => {
    expect(isPending('2026-04-25', '2026-04-24')).toBe(true)
  })

  it('is false when billingDate equals today (today counts as active)', () => {
    expect(isPending('2026-04-24', '2026-04-24')).toBe(false)
  })

  it('is false when billingDate is in the past', () => {
    expect(isPending('2026-04-20', '2026-04-24')).toBe(false)
  })

  it('handles year boundary correctly', () => {
    expect(isPending('2027-01-01', '2026-12-31')).toBe(true)
    expect(isPending('2026-12-31', '2027-01-01')).toBe(false)
  })
})

describe('daysBetweenISO', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetweenISO('2026-04-25', '2026-04-25')).toBe(0)
  })

  it('returns positive when later is after earlier', () => {
    expect(daysBetweenISO('2026-04-25', '2026-04-26')).toBe(1)
    expect(daysBetweenISO('2026-04-25', '2026-05-02')).toBe(7)
  })

  it('returns negative when later is before earlier', () => {
    expect(daysBetweenISO('2026-04-26', '2026-04-25')).toBe(-1)
  })

  it('spans a DST boundary without drift (uses UTC arithmetic)', () => {
    // 2026-03-08 02:00 is a US DST spring-forward; UTC-based math is immune.
    expect(daysBetweenISO('2026-03-07', '2026-03-10')).toBe(3)
  })

  it('spans a year boundary correctly', () => {
    expect(daysBetweenISO('2026-12-30', '2027-01-02')).toBe(3)
  })

  it('handles leap-year Feb correctly', () => {
    // 2024 is a leap year; Feb has 29 days.
    expect(daysBetweenISO('2024-02-28', '2024-03-01')).toBe(2) // 28 → 29 → Mar 1
  })
})

describe('groupBillsBySubscription', () => {
  const makeBill = (
    overrides: Partial<SettlementBillInput> = {}
  ): SettlementBillInput => ({
    id: 1,
    subscriptionId: 1,
    subscriptionName: 'Claude Pro',
    subscriptionLogo: null,
    billingDate: '2026-04-25',
    convertedAmount: 9224,
    direction: 'incoming',
    ...overrides,
  })

  it('returns empty array for empty input', () => {
    expect(groupBillsBySubscription([])).toEqual([])
  })

  it('groups a single R2 bill into one group ending at month-end', () => {
    const bill = makeBill({ billingDate: '2026-04-25', convertedAmount: 9224 })
    const groups = groupBillsBySubscription([bill])
    expect(groups).toHaveLength(1)
    expect(groups[0].subscriptionId).toBe(1)
    expect(groups[0].subscriptionName).toBe('Claude Pro')
    expect(groups[0].rangeStart).toBe('2026-04-25')
    expect(groups[0].rangeEnd).toBe('2026-04-30')
    expect(groups[0].totalAmount).toBe(9224)
    expect(groups[0].bills).toHaveLength(1)
  })

  it('merges R2 (Apr) + R1 (May) for the same sub into one cross-month range', () => {
    const r2 = makeBill({
      id: 1,
      billingDate: '2026-04-25',
      convertedAmount: 9224,
    })
    const r1May = makeBill({
      id: 2,
      billingDate: '2026-05-01',
      convertedAmount: 46120,
    })
    const groups = groupBillsBySubscription([r2, r1May])
    expect(groups).toHaveLength(1)
    expect(groups[0].rangeStart).toBe('2026-04-25')
    expect(groups[0].rangeEnd).toBe('2026-05-31')
    expect(groups[0].totalAmount).toBe(55344)
    expect(groups[0].bills).toHaveLength(2)
  })

  it('keeps different subscriptions as separate groups', () => {
    const claude = makeBill({
      id: 1,
      subscriptionId: 1,
      subscriptionName: 'Claude Pro',
    })
    const netflix = makeBill({
      id: 2,
      subscriptionId: 2,
      subscriptionName: 'Netflix',
    })
    const groups = groupBillsBySubscription([claude, netflix])
    expect(groups).toHaveLength(2)
    const subIds = groups.map((g) => g.subscriptionId).sort()
    expect(subIds).toEqual([1, 2])
  })

  it('sorts groups by earliest billingDate ascending', () => {
    const mayOnly = makeBill({
      id: 1,
      subscriptionId: 1,
      subscriptionName: 'A',
      billingDate: '2026-05-01',
    })
    const aprOnly = makeBill({
      id: 2,
      subscriptionId: 2,
      subscriptionName: 'B',
      billingDate: '2026-04-25',
    })
    const groups = groupBillsBySubscription([mayOnly, aprOnly])
    expect(groups[0].subscriptionId).toBe(2)
    expect(groups[1].subscriptionId).toBe(1)
  })

  it('flags fxIncomplete on the whole group when any bill in it is fx-incomplete', () => {
    const a = makeBill({ id: 1, billingDate: '2026-04-25' })
    const b = makeBill({
      id: 2,
      billingDate: '2026-05-01',
      fxIncomplete: true,
    })
    const groups = groupBillsBySubscription([a, b])
    expect(groups[0].fxIncomplete).toBe(true)
  })

  it('omits fxIncomplete entirely when no bill has it', () => {
    const a = makeBill({ id: 1, billingDate: '2026-04-25' })
    const groups = groupBillsBySubscription([a])
    expect(groups[0].fxIncomplete).toBeUndefined()
  })

  it('preserves direction from the earliest bill (payer is fixed per sub)', () => {
    // In practice a single sub's bills all share a direction because the
    // payer is fixed, but we still pin the invariant here.
    const earlier = makeBill({
      id: 1,
      billingDate: '2026-04-25',
      direction: 'incoming',
    })
    const later = makeBill({
      id: 2,
      billingDate: '2026-05-01',
      direction: 'incoming',
    })
    const groups = groupBillsBySubscription([earlier, later])
    expect(groups[0].direction).toBe('incoming')
  })

  it('returns bills inside a group sorted by billingDate asc', () => {
    const later = makeBill({
      id: 1,
      billingDate: '2026-05-01',
      convertedAmount: 46120,
    })
    const earlier = makeBill({
      id: 2,
      billingDate: '2026-04-25',
      convertedAmount: 9224,
    })
    const groups = groupBillsBySubscription([later, earlier])
    expect(groups[0].bills.map((b) => b.billingDate)).toEqual([
      '2026-04-25',
      '2026-05-01',
    ])
  })
})

describe('splitBillsByPending', () => {
  const today = '2026-04-25'

  it('returns both arrays empty for empty input', () => {
    const out = splitBillsByPending([], today)
    expect(out.active).toEqual([])
    expect(out.pending).toEqual([])
  })

  it('classifies past + today as active and strictly-future as pending', () => {
    const bills = [
      { id: 1, billingDate: '2026-04-20' }, // past
      { id: 2, billingDate: '2026-04-25' }, // today — active
      { id: 3, billingDate: '2026-04-26' }, // pending
      { id: 4, billingDate: '2026-05-01' }, // pending
    ]
    const out = splitBillsByPending(bills, today)
    expect(out.active.map((b) => b.id)).toEqual([1, 2])
    expect(out.pending.map((b) => b.id)).toEqual([3, 4])
  })

  it('preserves the original objects (no copy of fields)', () => {
    const bill = { id: 1, billingDate: '2026-04-20', extra: 'kept' }
    const out = splitBillsByPending([bill], today)
    expect(out.active[0]).toBe(bill)
  })

  it('preserves input order within each bucket', () => {
    const bills = [
      { id: 9, billingDate: '2026-05-01' },
      { id: 7, billingDate: '2026-04-20' },
      { id: 8, billingDate: '2026-04-26' },
      { id: 6, billingDate: '2026-04-15' },
    ]
    const out = splitBillsByPending(bills, today)
    expect(out.active.map((b) => b.id)).toEqual([7, 6])
    expect(out.pending.map((b) => b.id)).toEqual([9, 8])
  })
})
