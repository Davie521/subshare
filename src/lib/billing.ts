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
) => Promise<number> // returns rate, e.g. 7.8 for USD→HKD

/**
 * Calculate each non-payer member's share for a billing period.
 * Payer absorbs rounding remainder.
 */
export function calculateShares(
  price: number,
  memberCount: number
): number {
  // TODO: implement
  throw new Error('Not implemented')
}

/**
 * Calculate pro-rated amount for a member who joined mid-cycle.
 * @param price - full monthly price in cents
 * @param memberCount - total members including new member
 * @param joinDate - ISO date when member joined
 * @param nextPayment - ISO date of next billing
 * @returns pro-rated amount in cents
 */
export function calculateProRate(
  price: number,
  memberCount: number,
  joinDate: string,
  nextPayment: string
): number {
  // TODO: implement
  throw new Error('Not implemented')
}

/**
 * Generate billing records for a subscription's billing period.
 * Only generates for non-payer members.
 */
export async function generateBillingRecords(
  input: BillingInput,
  fetchRate: ExchangeRateFetcher
): Promise<BillingRecord[]> {
  // TODO: implement
  throw new Error('Not implemented')
}

/**
 * Calculate a user's total monthly spending across all subscriptions.
 */
export function calculateMonthlySpending(
  subscriptions: Array<{
    price: number
    currency: string
    memberCount: number // 1 for personal
  }>,
  preferredCurrency: string,
  rates: Record<string, number> // e.g. { 'USD_CNY': 7.25 }
): number {
  // TODO: implement
  throw new Error('Not implemented')
}
