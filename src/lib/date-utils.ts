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
