/**
 * Price timeline helpers — pure functions, DB-agnostic.
 *
 * A price timeline is a list of `{ price, effectiveFrom }` entries
 * sorted ascending by `effectiveFrom` (we sort defensively here too).
 * The price valid on day D is the entry with the largest
 * `effectiveFrom` ≤ D. If no entry qualifies (D is before the earliest
 * effectiveFrom), `priceAt` returns the OLDEST entry's price — this
 * happens when a sub's history is incomplete (legacy data) or the
 * caller asks about a day before the sub's start.
 *
 * Cents are stored as integer monthly rates. Per-day cost is computed
 * by the caller as `price / daysInMonth`.
 */

export type PriceTimelineEntry = {
  /** Monthly cents. */
  price: number
  /** Inclusive ISO YYYY-MM-DD — this entry takes effect from this day forward. */
  effectiveFrom: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Return the price effective on `isoDate` (YYYY-MM-DD).
 *
 * `history` may be unsorted; this function sorts a copy by `effectiveFrom` asc.
 * Throws on empty history — callers should backfill a single entry with the
 * sub's startDate + price before calling.
 */
export function priceAt(
  history: PriceTimelineEntry[],
  isoDate: string
): number {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(`isoDate must be YYYY-MM-DD: ${isoDate}`)
  }
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('priceAt requires a non-empty history')
  }
  for (const entry of history) {
    if (
      typeof entry.price !== 'number' ||
      !Number.isInteger(entry.price) ||
      entry.price < 0
    ) {
      throw new Error(`history entry has invalid price: ${JSON.stringify(entry)}`)
    }
    if (!ISO_DATE_RE.test(entry.effectiveFrom)) {
      throw new Error(
        `history entry has invalid effectiveFrom: ${JSON.stringify(entry)}`
      )
    }
  }

  const sorted = [...history].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom)
  )
  let chosen = sorted[0]
  for (const entry of sorted) {
    if (entry.effectiveFrom <= isoDate) chosen = entry
    else break
  }
  return chosen.price
}

/**
 * Append a new price change to a history. Validates:
 *   - effectiveFrom is a well-formed ISO date
 *   - effectiveFrom is strictly later than every existing entry
 *
 * Returns a new sorted array; does not mutate input.
 */
export function appendPriceChange(
  history: PriceTimelineEntry[],
  newEntry: PriceTimelineEntry
): PriceTimelineEntry[] {
  if (!ISO_DATE_RE.test(newEntry.effectiveFrom)) {
    throw new Error(
      `effectiveFrom must be YYYY-MM-DD: ${newEntry.effectiveFrom}`
    )
  }
  if (
    typeof newEntry.price !== 'number' ||
    !Number.isInteger(newEntry.price) ||
    newEntry.price < 0
  ) {
    throw new Error(`price must be a non-negative integer: ${newEntry.price}`)
  }
  for (const e of history) {
    if (e.effectiveFrom >= newEntry.effectiveFrom) {
      throw new Error(
        `cannot append: existing entry effectiveFrom ${e.effectiveFrom} ` +
          `is not earlier than new ${newEntry.effectiveFrom}`
      )
    }
  }
  return [...history, newEntry].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom)
  )
}
