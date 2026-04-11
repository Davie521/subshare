import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to params' }, { status: 400 })
  }

  if (from === to) {
    return NextResponse.json({ rate: 1 })
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`
    )
    const data = await res.json()
    const rate = data.rates?.[to]

    if (!rate) {
      return NextResponse.json({ error: 'Rate not available' }, { status: 404 })
    }

    return NextResponse.json({ from, to, rate })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch exchange rate' }, { status: 502 })
  }
}
