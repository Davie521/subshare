import { NextResponse } from 'next/server'
import { POPULAR_SERVICES } from '@/lib/popular-services'
import { findBrandIcon } from '@/lib/icons'

let cachedResult: unknown = null

export async function GET() {
  // Cache the result since icons don't change
  if (cachedResult) {
    return NextResponse.json(cachedResult)
  }

  const services = POPULAR_SERVICES.map((s) => {
    const icon = findBrandIcon(s.slug)
    return {
      name: s.name,
      category: s.category,
      defaultPrice: s.defaultPrice,
      defaultCurrency: s.defaultCurrency,
      icon: icon
        ? { svg: icon.svg, color: `#${icon.hex}` }
        : null,
    }
  })

  cachedResult = { services }
  return NextResponse.json(cachedResult)
}
