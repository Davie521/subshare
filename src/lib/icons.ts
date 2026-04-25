/**
 * Icon resolver — reads the manifest built by scripts/fetch-icons.ts.
 * The manifest is bundled at build time so resolution is synchronous and
 * works identically on server and client (no API round-trip).
 */

import manifest from '../../public/icons/manifest.json'

export type IconSource = 'simple-icons' | 'favicon' | 'letter'

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
  /**
   * Origin of the asset. Renderer uses this to decide whether to apply
   * `dark:invert` (Simple Icons SVGs ship as monochrome black paths and
   * disappear on a dark surface; favicon/letter sources must not be
   * inverted).
   */
  source: IconSource
}

interface ManifestEntry {
  file: string
  color: string
  isSvg: boolean
  letter: string
  source?: IconSource
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

/**
 * Slug-tolerant index — maps the alnum-flat lowercase form of each
 * manifest key back to that key, so a row whose `logo` was stored as a
 * slug ("netflix", "icloud", "audible") still resolves to its proper
 * Simple Icons / favicon entry.
 *
 * Built once on module load. Collisions (rare — only when two display
 * names slugify identically, e.g. theoretical "iCloud" vs "iCloud+")
 * keep whichever entry was iterated first; that's intentional, since
 * either is a better answer than falling through to a generic chip.
 */
const SLUG_INDEX: Map<string, string> = (() => {
  const idx = new Map<string, string>()
  for (const key of Object.keys(MANIFEST)) {
    const flat = key.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (!idx.has(flat)) idx.set(flat, key)
  }
  return idx
})()

/**
 * Older manifests (pre dark-mode-icon fix) don't carry the `source`
 * field. Derive it from the existing shape so the renderer behaves
 * correctly even before the next `fetch-icons` build:
 *   - non-SVG  -> favicon (PNG/ICO)
 *   - SVG with the generic gray placeholder colour -> letter chip
 *   - everything else SVG -> Simple Icons
 */
function deriveSource(entry: ManifestEntry): IconSource {
  if (entry.source) return entry.source
  if (!entry.isSvg) return 'favicon'
  if (entry.color.toLowerCase() === '6b7280') return 'letter'
  return 'simple-icons'
}

export function findBrandIcon(name: string): BrandIcon {
  const letter = name.charAt(0).toUpperCase()
  let entry = MANIFEST[name]

  // Slug fallback: turn "Netflix" / "netflix" / "NetFlix" / "iCloud+" /
  // "icloud" all into the same alnum-flat key for lookup.
  if (!entry) {
    const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const resolvedKey = SLUG_INDEX.get(flat)
    if (resolvedKey) entry = MANIFEST[resolvedKey]
  }

  if (entry) {
    return {
      title: name,
      url: `/icons/${entry.file}`,
      hex: entry.color,
      isSvg: entry.isSvg,
      letter: entry.letter,
      source: deriveSource(entry),
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
    source: 'letter',
  }
}
