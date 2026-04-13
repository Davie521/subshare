import { NextRequest, NextResponse } from 'next/server'
import { findBrandIcon } from '@/lib/icons'

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  const slug = req.nextUrl.searchParams.get('slug') ?? undefined
  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const icon = findBrandIcon(name, slug)

  return NextResponse.json({
    icon: {
      title: icon.title,
      svg: icon.svg,
      color: `#${icon.hex}`,
      faviconUrl: icon.faviconUrl,
      letter: icon.letter,
    },
  })
}
