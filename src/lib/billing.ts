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
