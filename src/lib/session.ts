import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'

const SESSION_COOKIE = 'subshare_session'
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production-min-32-chars!'

function sign(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verify(token: string): { userId: number; ts: number } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [data, sig] = parts
  if (!data || !sig) return null

  const expected = createHmac('sha256', SECRET).update(data).digest('base64url')
  const expectedBuf = Buffer.from(expected)
  const sigBuf = Buffer.from(sig)
  if (expectedBuf.length !== sigBuf.length) return null
  if (!timingSafeEqual(expectedBuf, sigBuf)) return null

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString())
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

  const db = getDb()
  const user = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, data.userId))
    .get()

  if (!user) return null
  return { userId: user.id }
}

export async function clearSession() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
