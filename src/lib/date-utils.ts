const DEFAULT_APP_TZ = 'Asia/Shanghai'

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
 */
export function getAppTimezone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_APP_TZ
}

/**
 * Returns YYYY-MM-DD for the given instant in the application's timezone.
 * Defaults to "now" and the configured APP_TIMEZONE; both are overridable
 * for tests.
 */
export function todayInAppTz(date: Date = new Date(), tz?: string): string {
  const zone = tz ?? getAppTimezone()
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
