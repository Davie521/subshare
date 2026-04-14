import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'

const SESSION_COOKIE = 'subshare_session'

/** Lazy-evaluated secret — only resolved at request time, not module load */
let _secret: string | null = null
function getSecret(): string {
  if (_secret) return _secret
  if (process.env.SESSION_SECRET) {
    _secret = process.env.SESSION_SECRET
    return _secret
  }
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('SESSION_SECRET env var is required outside development')
  }
  console.warn('[session] SESSION_SECRET missing — using insecure dev fallback. Do not expose this process to the network.')
  _secret = 'dev-only-secret-not-for-production-use'
  return _secret
}

function sign(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verify(token: string): { userId: number; ts: number } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [data, sig] = parts
  if (!data || !sig) return null

  const expected = createHmac('sha256', getSecret()).update(data).digest('base64url')
  const expectedBuf = Buffer.from(expected)
  const sigBuf = Buffer.from(sig)
  if (expectedBuf.length !== sigBuf.length) return null
  if (!timingSafeEqual(expectedBuf, sigBuf)) return null

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString())
    // Enforce server-side token expiry (30 days)
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
    if (!parsed.ts || Date.now() - parsed.ts > MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export async function setSession(userId: number) {
  const token = sign({ userId, ts: Date.now() })
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
}

export async function getSession(): Promise<{ userId: number } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const data = verify(token)
  if (!data || !data.userId) return null

  try {
    const db = getDb()
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, data.userId))

    if (!user) return null
    return { userId: user.id }
  } catch {
    return null
  }
}

export async function clearSession() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
