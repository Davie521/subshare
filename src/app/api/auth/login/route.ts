import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { loginUser } from '@/lib/auth'
import { setSession } from '@/lib/session'
import { loginSchema } from '@/lib/validators'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!checkRateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Extra per-email throttle so IP rotation can't bypass the ceiling on a
  // single account.
  const emailKey = `login-email:${parsed.data.email.toLowerCase()}`
  if (!checkRateLimit(emailKey, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const db = await getDb()
  const result = await loginUser(db, parsed.data)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }

  await setSession(result.id)
  // Don't leak the full user row — the client already has email/name.
  return NextResponse.json({ id: result.id, name: result.name })
}
