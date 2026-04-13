/**
 * Runtime icon resolver — reads manifest built by scripts/fetch-icons.ts
 * All icons are served from /icons/ as static assets (same origin).
 */

import fs from 'fs'
import path from 'path'

export interface BrandIcon {
  title: string
  /** URL to load the icon (always same-origin /icons/...) */
  url: string
  /** Hex color (without #), for tinting SVG icons */
  hex: string
  /** True if SVG (client can tint with color) */
  isSvg: boolean
  /** Letter for last-resort fallback (used if <img> fails) */
  letter: string
}

interface ManifestEntry {
  file: string
  color: string
  isSvg: boolean
  letter: string
}

let manifestCache: Record<string, ManifestEntry> | null = null

function loadManifest(): Record<string, ManifestEntry> {
  if (manifestCache) return manifestCache
  try {
    const p = path.join(process.cwd(), 'public', 'icons', 'manifest.json')
    if (fs.existsSync(p)) {
      manifestCache = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return manifestCache!
    }
  } catch {
    // ignore
  }
  manifestCache = {}
  return manifestCache
}

export function findBrandIcon(name: string): BrandIcon {
  const letter = name.charAt(0).toUpperCase()
  const manifest = loadManifest()
  const entry = manifest[name]

  if (entry) {
    return {
      title: name,
      url: `/icons/${entry.file}`,
      hex: entry.color,
      isSvg: entry.isSvg,
      letter: entry.letter,
    }
  }

  // Service not in manifest (custom user entry) — generate letter SVG as data URL
  return {
    title: name,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#6B7280"/><text x="12" y="16.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="600" fill="white">${letter}</text></svg>`
    )}`,
    hex: '6B7280',
    isSvg: true,
    letter,
  }
}
