const DEFAULT_APP_TZ = 'Asia/Shanghai'

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Resolve once on module load. An invalid APP_TIMEZONE (typo like
// "Asia/Shanhgai") would otherwise make every call to todayInAppTz throw
// a RangeError and crash the cron route + anything else that reads today's
// calendar date. We fall back to the default and log loudly so ops notices.
const RESOLVED_APP_TZ: string = (() => {
  const raw = process.env.APP_TIMEZONE
  if (!raw) return DEFAULT_APP_TZ
  if (isValidTimezone(raw)) return raw
  console.warn(
    `[date-utils] APP_TIMEZONE="${raw}" is not a valid IANA timezone; ` +
      `falling back to "${DEFAULT_APP_TZ}". Fix the env var to silence this.`
  )
  return DEFAULT_APP_TZ
})()

/**
 * The application's reference timezone for date-only fields like
 * billing_date, addedAt, leftAt, nextPayment. Set APP_TIMEZONE env to
 * override (e.g. 'UTC', 'America/New_York'). Defaulting to Asia/Shanghai
 * matches the product's primary user base; UTC servers would otherwise
 * roll over to the next day 8 hours before users do, skipping the
 * month-1st R1 cron window.
 *
 * This is only for CALENDAR-date semantics. Absolute timestamps
 * (createdAt, paidAt, readAt) stay in UTC — they represent moments in
 * time, not user-visible dates.
 *
 * Invalid APP_TIMEZONE values fall back to the default at module-load
 * time (see RESOLVED_APP_TZ), so this always returns a safe IANA name.
 */
export function getAppTimezone(): string {
  return RESOLVED_APP_TZ
}

/**
 * Returns YYYY-MM-DD for the given instant in the application's timezone.
 * Defaults to "now" and the configured APP_TIMEZONE; both are overridable
 * for tests. An explicit `tz` arg that isn't a valid IANA name falls back
 * to the resolved app timezone rather than throwing.
 */
export function todayInAppTz(date: Date = new Date(), tz?: string): string {
  const zone = tz && isValidTimezone(tz) ? tz : RESOLVED_APP_TZ
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((p) => p.type === 'year')!.value
  const month = parts.find((p) => p.type === 'month')!.value
  const day = parts.find((p) => p.type === 'day')!.value
  return `${year}-${month}-${day}`
}

/**
 * Bump an ISO YYYY-MM-DD date by exactly one calendar month, clamping
 * the day to the target month's length. Used by R1 cron to advance
 * `nextPayment` each cycle.
 *
 * Drift is tolerated: 1/31 → 2/28 → 3/28 → 4/28… The immutable
 * `startDate` column is the source of truth for "original day-of-month";
 * advanceMonth's job is just "+1 month with month-end survival."
 */
export function advanceMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`advanceMonth: not ISO YYYY-MM-DD: "${iso}"`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])

  const nextMo = mo === 12 ? 1 : mo + 1
  const nextY = mo === 12 ? y + 1 : y
  // new Date(year, monthIndex+1, 0) gives last day of month at monthIndex.
  // Here `nextMo` is 1-based, so passing it directly yields the day count
  // of the target month (0-based monthIndex+1).
  const daysInNext = new Date(nextY, nextMo, 0).getDate()
  const clampedD = Math.min(d, daysInNext)
  return `${nextY}-${String(nextMo).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}`
}
