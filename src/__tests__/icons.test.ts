import { describe, it, expect } from 'vitest'
import { findBrandIcon } from '@/lib/icons'

/**
 * findBrandIcon must be tolerant of how the `logo` column is stored.
 * The icon-picker writes the canonical display name ("Netflix"), but
 * legacy seed data and external imports can land in lowercase / slug
 * form ("netflix", "disneyplus"). All of those must resolve to the same
 * manifest entry — anything else falls through to a gray letter chip,
 * which is the "broken icons in dark mode" symptom.
 */
describe('findBrandIcon — slug-tolerant lookup', () => {
  it('resolves the canonical display-name key', () => {
    const icon = findBrandIcon('Netflix')
    expect(icon.url).toBe('/icons/netflix.svg')
    expect(icon.hex.toLowerCase()).toBe('e50914')
  })

  it('resolves a lowercase slug form ("netflix") to the same entry', () => {
    const icon = findBrandIcon('netflix')
    expect(icon.url).toBe('/icons/netflix.svg')
    expect(icon.hex.toLowerCase()).toBe('e50914')
  })

  it('resolves a slug whose alnum-flat form matches a manifest key ("audible" → "Audible")', () => {
    const icon = findBrandIcon('audible')
    expect(icon.url).toBe('/icons/audible.svg')
  })

  it('resolves "icloud" → "iCloud+" (alnum-flat collision strips the +)', () => {
    const icon = findBrandIcon('icloud')
    expect(icon.url).toMatch(/\/icons\/icloud/)
  })

  it('still produces a letter fallback for an unknown service', () => {
    const icon = findBrandIcon('My Custom Service Foo')
    expect(icon.url).toMatch(/^data:image\/svg\+xml/)
    expect(icon.letter).toBe('M')
  })
})

/**
 * Each manifest-resolved icon must declare its `source` so the renderer
 * can theme it correctly. Simple Icons SVGs ship as black monochrome
 * paths and need a dark-mode invert; favicon PNGs and letter SVGs are
 * already self-coloured and must be left alone.
 */
describe('findBrandIcon — source field', () => {
  it('marks Simple Icons SVG entries as source=simple-icons', () => {
    const icon = findBrandIcon('Netflix')
    expect(icon.source).toBe('simple-icons')
  })

  it('marks favicon PNG entries as source=favicon', () => {
    // Disney+ resolves to a favicon PNG (no Simple Icons entry).
    const icon = findBrandIcon('Disney+')
    expect(icon.source).toBe('favicon')
  })

  it('marks unknown-service inline letter SVG as source=letter', () => {
    const icon = findBrandIcon('My Custom Service Foo')
    expect(icon.source).toBe('letter')
  })
})
