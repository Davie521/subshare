import { NextResponse } from 'next/server'
import { POPULAR_SERVICES } from '@/lib/popular-services'
import { findBrandIcon } from '@/lib/icons'

interface ServiceEntry {
  name: string
  category: string
  defaultPrice: number | undefined
  defaultCurrency: string | undefined
  icon: { url: string; color: string; isSvg: boolean; letter: string }
}

let cachedResult: { services: ServiceEntry[] } | null = null

export async function GET() {
  if (cachedResult) {
    return NextResponse.json(cachedResult)
  }

  const services: ServiceEntry[] = POPULAR_SERVICES.map((s) => {
    const icon = findBrandIcon(s.name)
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
