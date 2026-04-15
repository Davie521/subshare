/**
 * Extract client IP for rate-limiting. `x-forwarded-for` is a comma-separated
 * chain; when behind a single known proxy (Railway), the rightmost entry is
 * the one our proxy added and therefore the only one we can trust.
 *
 * Falls back to `x-real-ip` then `'unknown'` when no proxy header is present.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
