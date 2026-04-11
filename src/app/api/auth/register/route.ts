import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { registerUser } from '@/lib/auth'
import { setSession } from '@/lib/session'
import { registerSchema } from '@/lib/validators'

export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
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
