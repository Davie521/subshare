import { describe, it, expect } from 'vitest'
import {
  resolveTheme,
  parseThemeMode,
  THEME_STORAGE_KEY,
  THEME_COOKIE_NAME,
  type ThemeMode,
} from '@/lib/theme'

describe('resolveTheme', () => {
  it('returns light when mode is light, ignoring system preference', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('returns dark when mode is dark, ignoring system preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows system preference when mode is auto', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('auto', false)).toBe('light')
  })
})

describe('parseThemeMode', () => {
  it('accepts the three valid modes', () => {
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
    expect(parseThemeMode('auto')).toBe('auto')
  })

  it('returns auto for unknown / null / undefined input', () => {
    expect(parseThemeMode(null)).toBe('auto')
    expect(parseThemeMode(undefined)).toBe('auto')
    expect(parseThemeMode('')).toBe('auto')
    expect(parseThemeMode('system')).toBe('auto')
    expect(parseThemeMode('LIGHT')).toBe('auto')
  })

  it('respects the type for round-tripping', () => {
    const modes: ThemeMode[] = ['light', 'dark', 'auto']
    for (const m of modes) expect(parseThemeMode(m)).toBe(m)
  })
})

describe('storage key constants', () => {
  it('exposes stable key names so the boot script and provider stay in sync', () => {
    expect(THEME_STORAGE_KEY).toBe('subshare.theme')
    expect(THEME_COOKIE_NAME).toBe('subshare_theme')
  })
})
