import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { loginUser } from '@/lib/auth'
import { setSession } from '@/lib/session'
import { loginSchema } from '@/lib/validators'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  if (!checkRateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const parsed = loginSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const db = getDb()
  const result = await loginUser(db, parsed.data)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }

  await setSession(result.id)
  return NextResponse.json(result)
}
