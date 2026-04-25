// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { THEME_STORAGE_KEY } from '@/lib/theme'

type Captured = ReturnType<typeof useTheme>

const handleRef: { current: Captured | null } = { current: null }

function Probe() {
  const ctx = useTheme()
  // Capture the live context value for the surrounding test to assert on.
  // eslint-disable-next-line react-hooks/immutability
  handleRef.current = ctx
  return null
}

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
  })
  return { root, container }
}

beforeEach(() => {
  handleRef.current = null
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
  localStorage.clear()
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
})

describe('ThemeProvider', () => {
  it('hydrates with auto + system-light by default', () => {
    render()
    expect(handleRef.current?.mode).toBe('auto')
    expect(handleRef.current?.resolved).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('hydrates from localStorage when present', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render()
    expect(handleRef.current?.mode).toBe('dark')
    expect(handleRef.current?.resolved).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setMode updates DOM, localStorage, and cookie', () => {
    render()
    act(() => {
      handleRef.current?.setMode('dark')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.cookie).toContain('subshare_theme=dark')

    act(() => {
      handleRef.current?.setMode('light')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('auto mode resolves to dark when system prefers dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    render()
    expect(handleRef.current?.mode).toBe('auto')
    expect(handleRef.current?.resolved).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('cross-tab storage event syncs the mode', () => {
    render()
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: THEME_STORAGE_KEY,
          newValue: 'dark',
        }),
      )
    })
    expect(handleRef.current?.mode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
