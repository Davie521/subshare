/**
 * Core billing logic for SubShare
 */

/**
 * Calculate each member's share (floor division).
 * Payer absorbs rounding remainder naturally since
 * payer's share = price - sum(all member shares).
 */
export function calculateShares(
  price: number,
  memberCount: number
): number {
  if (!Number.isInteger(memberCount) || memberCount <= 0) {
    throw new Error('memberCount must be a positive integer')
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('price must be a non-negative finite number')
  }
  return Math.floor(price / memberCount)
}

/**
 * Pre-paid mid-cycle join pro-rata (R2).
 *
 * Computes the amount a member owes when they join on `dayOfMonth` of a
 * month with `daysInMonth` days. Covers the join day through month end:
 *   floor(share × (daysInMonth − dayOfMonth + 1) / daysInMonth)
 *
 * @throws if inputs are out of range
 */
export function calculateJoinProRata(
  share: number,
  dayOfMonth: number,
  daysInMonth: number
): number {
  if (share < 0) throw new Error('share must be non-negative')
  if (daysInMonth < 28 || daysInMonth > 31) {
    throw new Error('daysInMonth must be 28–31')
  }
  if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
    throw new Error('dayOfMonth out of range')
  }
  const daysCovered = daysInMonth - dayOfMonth + 1
  return Math.floor((share * daysCovered) / daysInMonth)
}

/**
 * Pre-paid mid-cycle leave pro-rata (R3).
 *
 * `amount` is the bill amount being prorated — for R1 bills this is the
 * full-month share; for R2 bills it is the already-prorated join amount.
 * `coverageDays` is how many days the bill covers:
 *   - R1: coverageDays = daysInMonth (bill covers the whole month)
 *   - R2: coverageDays = daysInMonth − joinDay + 1
 *
 * `usageDays` is inclusive of the cycle-start day but EXCLUSIVE of the
 * leave day (a member who leaves on the cycle-start day used 0 days).
 * Caller computes `usageDays = leftAt_day − cycleStart_day`.
 *
 * Rules:
 *   - usageDays ≤ 0  → 0 (caller should delete the bill row)
 *   - usageDays ≥ coverageDays → full amount (last-day leave override)
 *   - otherwise floor(amount × usageDays / coverageDays)
 */
export function calculateLeaveProRata(
  amount: number,
  usageDays: number,
  coverageDays: number
): number {
  if (amount < 0) throw new Error('amount must be non-negative')
  if (!Number.isInteger(coverageDays) || coverageDays < 1 || coverageDays > 31) {
    throw new Error('coverageDays must be an integer 1–31')
  }
  if (usageDays <= 0) return 0
  if (usageDays >= coverageDays) return amount
  return Math.floor((amount * usageDays) / coverageDays)
}

/**
 * Recompute a bill's localAmount from its stored exchange rate. Used
 * anywhere `amount` gets rewritten (R3 prorate, R5 price change) to keep
 * `localAmount` consistent with `amount` without calling the live FX API.
 *
 * Rates are stored as integer × 1_000_000 for precision; result is cents.
 */
export function recomputeLocalAmount(
  amount: number,
  exchangeRate: number
): number {
  return Math.floor((amount * exchangeRate) / 1_000_000)
}

/**
 * Distribute an integer `total` across `parts` recipients using
 * round-robin remainder — the first (total mod parts) recipients each
 * get one extra cent, the rest get `floor(total / parts)`. Guarantees
 * Σ(result) === total and |max − min| ≤ 1.
 *
 * Used by R11 redistribute (splits the leaver's refunded diff across
 * remaining non-payer bills).
 */
export function distributeDiff(total: number, parts: number): number[] {
  if (parts <= 0) return []
  if (total < 0) throw new Error('total must be non-negative')
  const base = Math.floor(total / parts)
  let remainder = total - base * parts
  const out: number[] = []
  for (let i = 0; i < parts; i++) {
    out.push(base + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder--
  }
  return out
}

/**
 * R5 new-amount calculator — computes what `amount` should become after
 * a price change, preserving any R11 redistribute delta that's already
 * been baked into the current amount.
 *
 * The current amount equals `baseline(oldShare) + r11Delta` where
 * baseline is what the bill would be at the billing time under the old
 * price. We recover `r11Delta` and carry it forward onto the new
 * baseline.
 *
 * `daysCovered === daysInMonth` → R1 bill (whole month).
 * `daysCovered < daysInMonth`   → R2 bill (joined mid-month).
 */
export function calculateR5NewAmount(input: {
  currentAmount: number
  oldShare: number
  newShare: number
  daysCovered: number
  daysInMonth: number
}): number {
  const { currentAmount, oldShare, newShare, daysCovered, daysInMonth } = input
  const oldBaseline = Math.floor((oldShare * daysCovered) / daysInMonth)
  const r11Delta = currentAmount - oldBaseline
  const newBaseline = Math.floor((newShare * daysCovered) / daysInMonth)
  return newBaseline + r11Delta
}

/**
 * Calculate a user's total monthly spending across all subscriptions.
 */
export function calculateMonthlySpending(
  subscriptions: Array<{
    price: number
    currency: string
    memberCount: number
  }>,
  preferredCurrency: string,
  rates: Record<string, number>
): number {
  let total = 0

  for (const sub of subscriptions) {
    if (sub.memberCount <= 0) continue
    const myShare = calculateShares(sub.price, sub.memberCount)

    if (sub.currency === preferredCurrency) {
      total += myShare
      continue
    }

    const rateKey = `${sub.currency}_${preferredCurrency}`
    const rate = rates[rateKey]
    // Skip the contribution when the FX rate is missing — a silent 1:1
    // fallback would quote the foreign-currency number as if it were in
    // the user's preferred currency, which is wildly wrong on the
    // dashboard (e.g. 1300 JPY reported as 1300 USD).
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) continue
    total += Math.floor(myShare * rate)
  }

  return total
}
