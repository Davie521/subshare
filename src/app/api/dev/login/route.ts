import { NextRequest, NextResponse } from 'next/server'
import { setSession } from '@/lib/session'

/**
 * Dev-only bypass for OAuth during local smoke tests. Hit
 * `/api/dev/login?uid=1` to mint a session cookie for the seed user
 * with id=1. Returns 404 in production so this never ships as a
 * back door.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const uid = Number(url.searchParams.get('uid'))
  if (!Number.isInteger(uid) || uid <= 0) {
    return NextResponse.json(
      { error: 'uid query param required (positive int)' },
      { status: 400 }
    )
  }

  await setSession(uid)
  return NextResponse.json({ ok: true, userId: uid })
}
