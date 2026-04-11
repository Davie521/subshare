import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { loginUser } from '@/lib/auth'
import { setSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = getDb()
  const result = loginUser(db, { email, password })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }

  await setSession(result.id)
  return NextResponse.json(result)
}
