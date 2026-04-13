import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { registerUser } from '@/lib/auth'
import { setSession } from '@/lib/session'
import { registerSchema } from '@/lib/validators'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  if (!checkRateLimit(`register:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const parsed = registerSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { name, email, password, preferredCurrency } = parsed.data
  const db = getDb()
  const result = registerUser(db, { name, email, password, preferredCurrency })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 })
  }

  await setSession(result.id)
  return NextResponse.json(result, { status: 201 })
}
