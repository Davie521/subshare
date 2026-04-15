import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getDb } from '@/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { statusForResultCode, type Result } from '@/lib/api-handlers'

type ResolvedDb = Awaited<ReturnType<typeof getDb>>

/** Get authenticated user ID or return 401 response */
export async function requireAuth(): Promise<
  { userId: number; db: ResolvedDb } | NextResponse
> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const db = await getDb()
  return { userId: session.userId, db }
}

/** Parse and validate a path parameter as a positive integer */
export function parseId(id: string): number | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Parse a JSON body and return either the parsed value or a 400 response.
 * Callers check `instanceof NextResponse` to short-circuit.
 */
export async function readJson(req: Request): Promise<unknown | NextResponse> {
  try {
    return await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
}

/** Convert a Result to a NextResponse using the error code mapping. */
export function resultResponse<T>(
  result: Result<T>,
  okStatus = 200
): NextResponse {
  if (result.success) {
    return NextResponse.json(result.data ?? { ok: true }, { status: okStatus })
  }
  return NextResponse.json(
    { error: result.error },
    { status: statusForResultCode(result.code) }
  )
}

/**
 * Per-user rate limit for state-changing endpoints. Returns a 429 response
 * when exceeded, otherwise null.
 */
export function rateLimitUser(
  userId: number,
  bucket: string,
  max = 60,
  windowMs = 60_000
): NextResponse | null {
  if (!checkRateLimit(`${bucket}:${userId}`, max, windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  return null
}

/**
 * Wrap a handler body so uncaught errors return a structured 500 instead of
 * leaking a stack trace to the client. Logs the original error server-side.
 */
export async function guard<T extends NextResponse>(
  label: string,
  fn: () => Promise<T>
): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[api:${label}]`, message, err instanceof Error ? err.stack : '')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
