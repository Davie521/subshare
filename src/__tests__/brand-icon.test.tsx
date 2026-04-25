// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BrandIcon } from '@/components/brand-icon'

/**
 * Simple Icons SVGs are monochrome black-on-transparent, so on a dark
 * surface they render invisible. We tag the <img> with `dark:invert`
 * only for that source — favicon PNGs are full-colour and letter SVGs
 * have their own coloured chip background, both of which would look
 * wrong if inverted.
 */
describe('BrandIcon — dark-mode invert (Simple Icons only)', () => {
  it('Simple Icons source: <img> has dark:invert class', () => {
    const { container } = render(<BrandIcon name="Netflix" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.className).toMatch(/\bdark:invert\b/)
  })

  it('favicon source: <img> does NOT have dark:invert class', () => {
    const { container } = render(<BrandIcon name="Disney+" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.className).not.toMatch(/\bdark:invert\b/)
  })

  it('letter (unknown service) source: <img> does NOT have dark:invert class', () => {
    const { container } = render(<BrandIcon name="My Custom Service Foo" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.className).not.toMatch(/\bdark:invert\b/)
  })
})
