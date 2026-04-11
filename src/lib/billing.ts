/**
 * Core billing logic for SubShare
 */

export interface BillingInput {
  subscriptionId: number
  price: number // BigInt cents
  currency: string
  nextPayment: string // ISO date
  payerId: number // group creator
  members: Array<{
    userId: number
    preferredCurrency: string
    joinedAt: string // ISO date
  }>
}

export interface BillingRecord {
  subscriptionId: number
  userId: number
  amount: number // cents in subscription currency
  currency: string
  localAmount: number // cents in user's preferred currency
  localCurrency: string
  exchangeRate: number // rate × 1000000
  billingDate: string // ISO date
}

export type ExchangeRateFetcher = (
  from: string,
  to: string
) => Promise<number>

/**
 * Calculate each member's share (floor division).
 * Payer absorbs rounding remainder naturally since
 * payer's share = price - sum(all member shares).
 */
export function calculateShares(
  price: number,
  memberCount: number
): number {
  return Math.floor(price / memberCount)
}

/** Parse ISO date string to UTC ms, avoiding timezone issues */
function toUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Get the same day one month earlier as ISO string */
function oneMonthBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const prevMonth = m - 1 < 1 ? 12 : m - 1
  const prevYear = m - 1 < 1 ? y - 1 : y
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / (1000 * 60 * 60 * 24))
}

/**
 * Calculate pro-rated amount for a member who joined mid-cycle.
 */
export function calculateProRate(
  price: number,
  memberCount: number,
  joinDate: string,
  nextPayment: string
): number {
  const daysRemaining = daysBetween(joinDate, nextPayment)
  if (daysRemaining <= 0) return 0

  const prevBilling = oneMonthBefore(nextPayment)
  const totalDays = daysBetween(prevBilling, nextPayment)

  const share = calculateShares(price, memberCount)
  return Math.floor((share * daysRemaining) / totalDays)
}

/**
 * Generate billing records for a subscription's billing period.
 * Only generates for non-payer members.
 */
export async function generateBillingRecords(
  input: BillingInput,
  fetchRate: ExchangeRateFetcher
): Promise<BillingRecord[]> {
  const { subscriptionId, price, currency, nextPayment, payerId, members } =
    input

  const nonPayerMembers = members.filter((m) => m.userId !== payerId)
  if (nonPayerMembers.length === 0) return []

  const memberCount = members.length
  const records: BillingRecord[] = []

  const periodStart = oneMonthBefore(nextPayment)

  for (const member of nonPayerMembers) {
    const joinedMidCycle = member.joinedAt > periodStart

    const amount = joinedMidCycle
      ? calculateProRate(price, memberCount, member.joinedAt, nextPayment)
      : calculateShares(price, memberCount)

    const rate = await fetchRate(currency, member.preferredCurrency)
    const localAmount = Math.floor(amount * rate)
    const exchangeRate = Math.round(rate * 1000000)

    records.push({
      subscriptionId,
      userId: member.userId,
      amount,
      currency,
      localAmount,
      localCurrency: member.preferredCurrency,
      exchangeRate,
      billingDate: nextPayment,
    })
  }

  return records
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
    const myShare = calculateShares(sub.price, sub.memberCount)

    if (sub.currency === preferredCurrency) {
      total += myShare
    } else {
      const rateKey = `${sub.currency}_${preferredCurrency}`
      const rate = rates[rateKey] ?? 1
      total += Math.floor(myShare * rate)
    }
  }

  return total
}
