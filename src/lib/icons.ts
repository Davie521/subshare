/**
 * Icon resolver — reads the manifest built by scripts/fetch-icons.ts.
 * The manifest is bundled at build time so resolution is synchronous and
 * works identically on server and client (no API round-trip).
 */

import manifest from '../../public/icons/manifest.json'

export interface BrandIcon {
  title: string
  /** URL to load the icon (always same-origin /icons/…) */
  url: string
  /** Hex color (without #), for tinting SVG icons */
  hex: string
  /** True if SVG (can be tinted) */
  isSvg: boolean
  /** Letter for last-resort fallback if <img> fails to load */
  letter: string
}

interface ManifestEntry {
  file: string
  color: string
  isSvg: boolean
  letter: string
}

const MANIFEST = manifest as Record<string, ManifestEntry>

const XML_ESCAPE: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
}
function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => XML_ESCAPE[c] ?? c)
}

export function findBrandIcon(name: string): BrandIcon {
  const letter = name.charAt(0).toUpperCase()
  const entry = MANIFEST[name]

  if (entry) {
    return {
      title: name,
      url: `/icons/${entry.file}`,
      hex: entry.color,
      isSvg: entry.isSvg,
      letter: entry.letter,
    }
  }

  // Custom user entry not in manifest — generate letter SVG as data URL
  const safeLetter = escapeXml(letter)
  return {
    title: name,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#6B7280"/><text x="12" y="16.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="600" fill="white">${safeLetter}</text></svg>`
    )}`,
    hex: '6B7280',
    isSvg: true,
    letter,
  }
}
