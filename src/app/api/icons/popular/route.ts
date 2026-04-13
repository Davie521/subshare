import { NextResponse } from 'next/server'
import { POPULAR_SERVICES } from '@/lib/popular-services'
import { findBrandIcon } from '@/lib/icons'

let cachedResult: unknown = null

export async function GET() {
  if (cachedResult) {
    return NextResponse.json(cachedResult)
  }

  const services = POPULAR_SERVICES.map((s) => {
    const icon = findBrandIcon(s.name, s.slug)
    return {
      name: s.name,
      category: s.category,
      defaultPrice: s.defaultPrice,
      defaultCurrency: s.defaultCurrency,
      icon: {
        url: icon.url,
        color: `#${icon.hex}`,
        isSvg: icon.isSvg,
        letter: icon.letter,
      },
    }
  })

  cachedResult = { services }
  return NextResponse.json(cachedResult)
}
