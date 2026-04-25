export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'subshare.theme'
export const THEME_COOKIE_NAME = 'subshare_theme'
export const DEFAULT_THEME_MODE: ThemeMode = 'auto'

export function parseThemeMode(value: unknown): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'auto') return value
  return DEFAULT_THEME_MODE
}

export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemPrefersDark ? 'dark' : 'light'
}
