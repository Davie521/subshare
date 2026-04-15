/** Simple in-memory rate limiter using a Map with TTL cleanup. */
const attempts = new Map<string, { count: number; resetAt: number }>()

// Single-instance only: this lives in-process. Deploys scale horizontally
// will need a shared backend (Redis) for accurate limits.

const MAX_ENTRIES = 10_000
let lastCleanup = 0
const CLEANUP_INTERVAL_MS = 10_000

function cleanup(now: number): void {
  for (const [k, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(k)
  }
  lastCleanup = now
}

export function checkRateLimit(
  key: string,
  maxAttempts = 10,
  windowMs = 60_000
): boolean {
  const now = Date.now()

  // Periodic cleanup prevents slow memory growth from IPs that only ever
  // make a handful of requests.
  if (now - lastCleanup > CLEANUP_INTERVAL_MS || attempts.size > MAX_ENTRIES) {
    cleanup(now)
  }

  const entry = attempts.get(key)

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= maxAttempts) {
    return false
  }

  entry.count++
  return true
}
