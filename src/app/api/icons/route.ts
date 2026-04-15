import { NextRequest, NextResponse } from 'next/server'
import { findBrandIcon } from '@/lib/icons'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`icons:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const name = req.nextUrl.searchParams.get('name')
  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const icon = findBrandIcon(name)

  return NextResponse.json({
    icon: {
      title: icon.title,
      url: icon.url,
      color: `#${icon.hex}`,
      isSvg: icon.isSvg,
      letter: icon.letter,
    },
  })
}
