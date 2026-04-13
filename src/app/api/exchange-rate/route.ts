import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { exchangeRateSchema } from '@/lib/validators'
import { checkRateLimit } from '@/lib/rate-limit'
import { getRate } from '@/lib/fx-cache'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  if (!checkRateLimit(`fx:${auth.userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  const parsed = exchangeRateSchema.safeParse({ from, to })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid currency code' }, { status: 400 })
  }

  const rate = await getRate(parsed.data.from, parsed.data.to)
  if (rate === null) {
    return NextResponse.json({ error: 'Failed to fetch exchange rate' }, { status: 502 })
  }

  return NextResponse.json({ from: parsed.data.from, to: parsed.data.to, rate })
}
