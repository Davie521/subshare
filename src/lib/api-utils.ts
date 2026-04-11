import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getDb } from '@/db'

/** Get authenticated user ID or return 401 response */
export async function requireAuth(): Promise<
  { userId: number; db: ReturnType<typeof getDb> } | NextResponse
> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  return { userId: session.userId, db: getDb() }
}

/** Parse and validate a path parameter as a positive integer */
export function parseId(id: string): number | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}
