import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { registerUser } from '@/lib/auth'
import { setSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, password, preferredCurrency } = body

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = getDb()
  const result = registerUser(db, { name, email, password, preferredCurrency })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 })
  }

  await setSession(result.id)
  return NextResponse.json(result, { status: 201 })
}
