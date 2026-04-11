import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { exchangeRateSchema } from '@/lib/validators'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  const parsed = exchangeRateSchema.safeParse({ from, to })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid currency code' }, { status: 400 })
  }

  if (parsed.data.from === parsed.data.to) {
    return NextResponse.json({ rate: 1 })
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${parsed.data.from}&symbols=${parsed.data.to}`,
      { signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    const rate = data.rates?.[parsed.data.to]

    if (!rate) {
      return NextResponse.json({ error: 'Rate not available' }, { status: 404 })
    }

    return NextResponse.json({ from: parsed.data.from, to: parsed.data.to, rate })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch exchange rate' }, { status: 502 })
  }
}
