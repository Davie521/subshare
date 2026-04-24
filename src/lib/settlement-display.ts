/**
 * Pure display-layer helpers for the Settlement page.
 *
 * Kept free of React, DB, and side-effects so the logic can be
 * unit-tested in isolation. Everything here operates on ISO
 * `YYYY-MM-DD` strings — string comparison on this format is a valid
 * chronological compare, which side-steps the latent TZ bug in the old
 * page.tsx where `new Date()` pulled the browser's local zone instead
 * of the APP_TIMEZONE that the server writes `billing_date` in.
 */

export type SettlementBillInput = {
  id: number
  subscriptionId: number
  subscriptionName: string
  subscriptionLogo: string | null
  billingDate: string
  convertedAmount: number
  direction: 'outgoing' | 'incoming'
  fxIncomplete?: boolean
}

export type SubGroup = {
  subscriptionId: number
  subscriptionName: string
  subscriptionLogo: string | null
  direction: 'outgoing' | 'incoming'
  rangeStart: string
  rangeEnd: string
  totalAmount: number
  bills: SettlementBillInput[]
  fxIncomplete?: boolean
}

/**
 * Last day of the month that `iso` falls in, as YYYY-MM-DD.
 * Using `new Date(y, m, 0)` where day=0 gives the last day of the
 * *previous* month, so passing the 1-based month directly yields the
 * last day of the month we want.
 */
export function lastDayOfMonthISO(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/**
 * Human-readable billing range like "Apr 25 – May 31" (en-dash, U+2013).
 * Collapses to a single date when `startIso === endIso`.
 *
 * `locale` is exposed so tests can pin 'en-US' for deterministic output;
 * callers in the app should omit it and inherit the user's locale.
 */
export function formatBillingRange(
  startIso: string,
  endIso: string,
  locale?: string | string[]
): string {
  const start = formatSingleDate(startIso, locale)
  if (startIso === endIso) return start
  const end = formatSingleDate(endIso, locale)
  return `${start} – ${end}`
}

function formatSingleDate(iso: string, locale?: string | string[]): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * A bill is "pending" when its billing_date is strictly in the future.
 * Today counts as active (the member owes it today), so we use `>`, not
 * `>=`. Both arguments must be ISO YYYY-MM-DD in the same calendar tz
 * (the caller must pass `todayInAppTz()` to match how server writes
 * billing_date).
 */
export function isPending(billingDate: string, today: string): boolean {
  return billingDate > today
}

/**
 * Signed day-count between two ISO calendar dates. Positive when `later`
 * comes after `earlier`. Uses `Date.UTC` so DST transitions can't shift
 * the difference — both inputs are calendar dates, not instants.
 */
export function daysBetweenISO(earlier: string, later: string): number {
  const [y1, m1, d1] = earlier.split('-').map(Number)
  const [y2, m2, d2] = later.split('-').map(Number)
  const t1 = Date.UTC(y1, m1 - 1, d1)
  const t2 = Date.UTC(y2, m2 - 1, d2)
  return Math.round((t2 - t1) / 86_400_000)
}

/**
 * Collapse a flat `SettlementBillInput[]` into one `SubGroup` per
 * subscription. Each group exposes:
 *   - `rangeStart` = earliest billing_date in the group
 *   - `rangeEnd`   = last day of the month of the latest billing_date
 *   - `totalAmount` = sum of convertedAmount
 *   - `fxIncomplete` = true iff any bill in the group is fx-incomplete
 *     (omitted otherwise so the JSON shape stays minimal)
 *
 * Groups are returned sorted by `rangeStart` ascending, and bills inside
 * each group are sorted by billing_date ascending.
 *
 * Direction is taken from the earliest bill — payer is fixed per sub so
 * every bill in the group should share the same direction; if the
 * upstream ever violates that invariant, the earliest-wins rule is the
 * predictable fallback.
 */
export function groupBillsBySubscription(
  bills: SettlementBillInput[]
): SubGroup[] {
  if (bills.length === 0) return []

  const byId = new Map<number, SettlementBillInput[]>()
  for (const b of bills) {
    const arr = byId.get(b.subscriptionId) ?? []
    arr.push(b)
    byId.set(b.subscriptionId, arr)
  }

  const groups: SubGroup[] = []
  for (const [subId, arr] of byId) {
    const sorted = arr
      .slice()
      .sort((x, y) => x.billingDate.localeCompare(y.billingDate))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const total = sorted.reduce((sum, b) => sum + b.convertedAmount, 0)
    const fxIncomplete = sorted.some((b) => b.fxIncomplete)

    groups.push({
      subscriptionId: subId,
      subscriptionName: first.subscriptionName,
      subscriptionLogo: first.subscriptionLogo,
      direction: first.direction,
      rangeStart: first.billingDate,
      rangeEnd: lastDayOfMonthISO(last.billingDate),
      totalAmount: total,
      bills: sorted,
      ...(fxIncomplete ? { fxIncomplete: true } : {}),
    })
  }

  groups.sort((a, b) => a.rangeStart.localeCompare(b.rangeStart))
  return groups
}
