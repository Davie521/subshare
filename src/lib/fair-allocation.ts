/**
 * Fair Allocation engine — pure functions.
 *
 * Replaces the legacy R1+R2+R3+R5 stack with one per-day algorithm:
 *
 *   activeDays = number of days in this month with at least 1 active member
 *   dailyCost = price / activeDays
 *   per-day-per-member = dailyCost / N(d)
 *   fair_m = Σ over m's active days of (dailyCost / N(d))
 *
 * The denominator is `activeDays` (not calendar daysInMonth) so that sum
 * of all members' fair shares always equals `price` — no cost is forfeit
 * on member-less days. In production every day from sub.startDate forward
 * has at least the payer active, so activeDays == daysInMonth typically.
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
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

export function fairAllocation(input: FairAllocationInput): Map<number, number> {
  const { price, year, month, intervals, roundingSeed = 0 } = input

  // ── validation ──
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    throw new Error('price must be a non-negative finite number')
  }
  if (!Number.isInteger(price)) {
    throw new Error('price must be an integer (cents)')
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`month out of range: ${month}`)
  }
  if (!Number.isInteger(year) || year < 1) {
    throw new Error(`year out of range: ${year}`)
  }
  for (const iv of intervals) {
    if (!ISO_DATE_RE.test(iv.addedAt)) {
      throw new Error(`Invalid ISO date format (YYYY-MM-DD): ${iv.addedAt}`)
    }
    if (iv.leftAt !== null && !ISO_DATE_RE.test(iv.leftAt)) {
      throw new Error(`Invalid ISO date format (YYYY-MM-DD): ${iv.leftAt}`)
    }
    if (iv.leftAt !== null && iv.addedAt > iv.leftAt) {
      throw new Error(
        `addedAt after leftAt for user ${iv.userId}: ${iv.addedAt} > ${iv.leftAt}`
      )
    }
  }
  // Per-user no-overlap. Sorted intervals must satisfy cur.leftAt < next.addedAt.
  const byUser = new Map<number, MemberInterval[]>()
  for (const iv of intervals) {
    if (!byUser.has(iv.userId)) byUser.set(iv.userId, [])
    byUser.get(iv.userId)!.push(iv)
  }
  for (const [userId, list] of byUser) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt))
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]
      const next = sorted[i + 1]
      if (cur.leftAt === null || cur.leftAt >= next.addedAt) {
        throw new Error(
          `overlapping intervals for user ${userId}: [${cur.addedAt}, ${cur.leftAt ?? 'null'}] and [${next.addedAt}, ${next.leftAt ?? 'null'}]`
        )
      }
    }
  }

  // ── compute days-in-month ──
  // new Date(year, month, 0) returns last day of `month-1` (0-indexed) which
  // equals the day count of `month-1` 1-indexed. Since we receive 1-indexed
  // month, this gives the day count of THAT month directly.
  const daysInMonth = new Date(year, month, 0).getDate()

  // ── for each day, determine active users ──
  const dayActiveUsers: Set<number>[] = []
  for (let d = 0; d < daysInMonth; d++) dayActiveUsers.push(new Set())

  for (const iv of intervals) {
    const range = intervalActiveRange(iv, year, month, daysInMonth)
    if (!range) continue
    for (let d = range.first; d <= range.last; d++) {
      dayActiveUsers[d - 1].add(iv.userId)
    }
  }

  // Set of users that ever appear active in this month.
  const allUsers = new Set<number>()
  let activeDays = 0
  for (const set of dayActiveUsers) {
    if (set.size > 0) activeDays++
    for (const u of set) allUsers.add(u)
  }
  if (allUsers.size === 0 || activeDays === 0) return new Map()

  // ── exact integer arithmetic via BigInt + LCM ──
  // dailyCost = price / activeDays. Per-day per-user = dailyCost / N(d).
  // To stay integer: scale by lcm = LCM(1..maxN). Then perUserScaled per day
  // = price × (lcm / N(d)), an integer. Sum, then divide by (lcm × activeDays).
  let maxN = 0
  for (const set of dayActiveUsers) if (set.size > maxN) maxN = set.size
  const lcm = lcmRange(maxN)

  const scaledFair = new Map<number, bigint>()
  for (const u of allUsers) scaledFair.set(u, BigInt(0))

  const priceBI = BigInt(price)
  for (let d = 0; d < daysInMonth; d++) {
    const set = dayActiveUsers[d]
    const n = set.size
    if (n === 0) continue
    const perUserContribution = (priceBI * lcm) / BigInt(n)
    for (const u of set) {
      scaledFair.set(u, scaledFair.get(u)! + perUserContribution)
    }
  }

  const denom = lcm * BigInt(activeDays)
  const fairFloors = new Map<number, number>()
  for (const [u, scaled] of scaledFair) {
    fairFloors.set(u, Number(scaled / denom))
  }

  // ── distribute residue via rotation ──
  const sumFloors = [...fairFloors.values()].reduce((a, b) => a + b, 0)
  const residue = price - sumFloors
  if (residue > 0) {
    const sortedUserIds = [...fairFloors.keys()].sort((a, b) => a - b)
    const extras = distributeWithRotation({
      residue,
      userIds: sortedUserIds,
      seed: roundingSeed,
    })
    for (const [u, extra] of extras) {
      fairFloors.set(u, fairFloors.get(u)! + extra)
    }
  }

  return fairFloors
}

/**
 * Return the 1-indexed [first, last] day range during which `interval` is
 * active within (year, month), or null if the interval doesn't intersect
 * this calendar month.
 *
 * Closed-interval semantics: addedAt and leftAt are both inclusive.
 */
function intervalActiveRange(
  iv: MemberInterval,
  year: number,
  month: number,
  daysInMonth: number
): { first: number; last: number } | null {
  const aymCmp = compareYearMonth(iv.addedAt, year, month)
  let first: number
  if (aymCmp < 0) first = 1
  else if (aymCmp === 0) first = parseInt(iv.addedAt.slice(8, 10), 10)
  else return null // addedAt is in a future month

  let last: number
  if (iv.leftAt === null) {
    last = daysInMonth
  } else {
    const lymCmp = compareYearMonth(iv.leftAt, year, month)
    if (lymCmp < 0) return null // leftAt is in a past month
    else if (lymCmp === 0) last = parseInt(iv.leftAt.slice(8, 10), 10)
    else last = daysInMonth // leftAt is in a future month
  }

  if (first > last) return null
  return { first, last }
}

function compareYearMonth(iso: string, year: number, month: number): -1 | 0 | 1 {
  const y = parseInt(iso.slice(0, 4), 10)
  const m = parseInt(iso.slice(5, 7), 10)
  if (y < year) return -1
  if (y > year) return 1
  if (m < month) return -1
  if (m > month) return 1
  return 0
}

function gcdBI(a: bigint, b: bigint): bigint {
  if (a < BigInt(0)) a = -a
  if (b < BigInt(0)) b = -b
  while (b !== BigInt(0)) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

function lcmRange(n: number): bigint {
  if (n <= 1) return BigInt(1)
  let result = BigInt(1)
  for (let i = 2; i <= n; i++) {
    const bi = BigInt(i)
    result = (result * bi) / gcdBI(result, bi)
  }
  return result
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
  input: DistributeWithRotationInput
): Map<number, number> {
  const { residue, userIds, seed } = input
  if (!Number.isFinite(residue)) {
    throw new Error('residue must be a finite number')
  }
  if (residue < 0) {
    throw new Error('residue must be non-negative')
  }

  const result = new Map<number, number>()
  if (userIds.length === 0) {
    if (residue === 0) return result
    throw new Error('Cannot distribute residue across empty userIds')
  }
  if (residue >= userIds.length) {
    throw new Error(
      `residue (${residue}) must be less than userIds.length (${userIds.length})`
    )
  }

  for (const u of userIds) result.set(u, 0)
  if (residue === 0) return result

  const n = userIds.length
  const start = ((seed % n) + n) % n
  for (let i = 0; i < residue; i++) {
    const idx = (start + i) % n
    result.set(userIds[idx], 1)
  }
  return result
}
