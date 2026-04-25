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

  it('letter (unknown service) source: renders a themed chip <div>, not an <img>', () => {
    // Letter sources are a generic gray data-URL we can't theme inline,
    // so the renderer paints the chip directly with theme-aware Tailwind
    // classes. No <img> is mounted at all in this branch.
    const { container } = render(<BrandIcon name="My Custom Service Foo" />)
    expect(container.querySelector('img')).toBeNull()
    const chip = container.firstElementChild as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip!.tagName.toLowerCase()).toBe('div')
    // Theme-aware background — readable on both warm-paper and near-black.
    expect(chip!.className).toMatch(/\bbg-zinc-500\b/)
    expect(chip!.className).toMatch(/\bdark:bg-zinc-400\b/)
    // Text colour flips so the glyph stays readable on the lighter
    // dark-mode chip (white on light gray would be unreadable).
    expect(chip!.className).toMatch(/\btext-white\b/)
    expect(chip!.className).toMatch(/\bdark:text-zinc-900\b/)
    expect(chip!.textContent).toBe('M')
  })

  it('letter chip exposes an accessible name (role=img + aria-label)', () => {
    // The <img alt={name}> branch announces the service to screen readers;
    // the chip branch must expose the same affordance via role/aria-label,
    // otherwise SR users hear only the letter "M".
    const { container } = render(<BrandIcon name="My Custom Service Foo" />)
    const chip = container.firstElementChild as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip!.getAttribute('role')).toBe('img')
    expect(chip!.getAttribute('aria-label')).toBe('My Custom Service Foo')
  })
})
