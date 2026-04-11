import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'

const SESSION_COOKIE = 'subshare_session'

/** Simple session: store user ID in a signed cookie.
 *  For production, use proper JWT or NextAuth. */
export async function setSession(userId: number) {
  const token = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64')
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
}

export async function getSession(): Promise<{ userId: number } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  try {
    const data = JSON.parse(Buffer.from(token, 'base64').toString())
    if (!data.userId) return null

    const db = getDb()
    const user = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, data.userId))
      .get()

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
