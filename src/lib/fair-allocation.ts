/**
 * Fair Allocation engine — pure functions.
 *
 * Replaces the legacy R1+R2+R3+R5 stack with one per-day algorithm:
 *
 *   dailyCost = price / daysInMonth
 *   per-day-per-member = dailyCost / N(d)
 *   fair_m = Σ over m's active days of (dailyCost / N(d))
 *
 * Sum of all fair_m === price (the residue from integer-flooring is
 * distributed via `distributeWithRotation` so cumulative cents-luck is
 * fair across months).
 *
 * Date semantics — CLOSED INTERVAL [addedAt, leftAt]:
 *   - addedAt is INCLUSIVE (first day of use).
 *   - leftAt is INCLUSIVE (last day of use); leftAt = null means still active.
 *   - A day d is "in" iff addedAt ≤ d AND (leftAt == null OR d ≤ leftAt).
 *
 * Implications:
 *   - addedAt == leftAt → user is active that 1 day.
 *   - Same-day swap (A leftAt=X, B addedAt=X) → both active on day X (overlap).
 *     UI should prevent this if it's not intended; engine treats it as fact.
 *   - Rejoin: second interval's addedAt must be > previous interval's leftAt
 *     (no shared day).
 *
 * Members may have multiple intervals (rejoin support).
 *
 * NOT YET IMPLEMENTED — tests are RED.
 */

export type MemberInterval = {
  userId: number
  addedAt: string // ISO YYYY-MM-DD
  leftAt: string | null // ISO YYYY-MM-DD, or null when still active
}

export type FairAllocationInput = {
  price: number // total cents
  year: number
  month: number // 1-12
  intervals: MemberInterval[]
  /** Seed for residue rotation. Default 0. Pass `hash(sub.id, year*12+month)` for fairness over months. */
  roundingSeed?: number
}

export function fairAllocation(_input: FairAllocationInput): Map<number, number> {
  throw new Error('fairAllocation: not implemented')
}

export type DistributeWithRotationInput = {
  /** Integer cents to spread, 0 ≤ residue < userIds.length */
  residue: number
  /** All recipients eligible for +1¢. Order matters for rotation. */
  userIds: number[]
  /** Rotation start = seed mod userIds.length */
  seed: number
}

/**
 * Distribute `residue` extra cents across `userIds`. Returns a Map of
 * userId → 0 or 1 (extra cents). Rotation start = seed mod N, recipients
 * are positions [start, start+1, ..., start+residue-1] (mod N).
 */
export function distributeWithRotation(
  _input: DistributeWithRotationInput
): Map<number, number> {
  throw new Error('distributeWithRotation: not implemented')
}
