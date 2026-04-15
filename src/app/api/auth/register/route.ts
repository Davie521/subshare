import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { registerUser } from '@/lib/auth'
import { setSession } from '@/lib/session'
import { registerSchema } from '@/lib/validators'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!checkRateLimit(`register:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { name, email, password, preferredCurrency } = parsed.data
  const db = await getDb()
  const result = await registerUser(db, { name, email, password, preferredCurrency })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 })
  }

  await setSession(result.id)
  return NextResponse.json({ id: result.id, name: result.name }, { status: 201 })
}
