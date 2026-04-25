/**
 * Build-time icon fetcher
 *
 * For each subscription service:
 *   1. Try Simple Icons (SVG, best)
 *   2. Try DuckDuckGo favicon (PNG)
 *   3. Try Google favicon (PNG)
 *   4. Generate a letter SVG with brand color (fallback)
 *
 * Saves icons to public/icons/<slug>.{svg,png}
 * Writes manifest to public/icons/manifest.json
 */

import fs from 'fs/promises'
import path from 'path'
import { POPULAR_SERVICES } from '../src/lib/popular-services'
import {
  ALIASES,
  DOMAIN_MAP,
  FORCE_LETTER,
  nameToSlug,
} from '../src/lib/icon-sources'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const simpleIcons = require('simple-icons')

const PUBLIC_ICONS = path.join(process.cwd(), 'public', 'icons')
const MANIFEST_PATH = path.join(PUBLIC_ICONS, 'manifest.json')

interface IconEntry {
  file: string // e.g. "netflix.svg" (relative to /icons/)
  color: string // hex without #
  isSvg: boolean // true if svg (can be tinted)
  letter: string // for hypothetical letter fallback on client
  /**
   * Origin of the asset, used by the renderer to decide theming. Simple
   * Icons SVGs ship as monochrome black paths and need `dark:invert`;
   * favicon PNGs and letter chips already carry their own colour.
   */
  source: 'simple-icons' | 'favicon' | 'letter'
}

type Manifest = Record<string, IconEntry>

// Known default/placeholder response sizes (globe icons, error responses)
const KNOWN_DEFAULT_SIZES = new Set([917, 1478, 601, 323, 18])
// Minimum size to accept — must be a real image (not error text/default placeholder)
const MIN_FAVICON_SIZE = 300

async function fetchBytes(
  url: string,
  timeoutMs = 5000
): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf
  } catch {
    return null
  }
}

function isLikelyDefault(buf: Buffer): boolean {
  if (buf.length < MIN_FAVICON_SIZE) return true
  if (KNOWN_DEFAULT_SIZES.has(buf.length)) return true
  // Check PNG/ICO magic bytes — reject anything that isn't a valid image
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const isIco = buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
  if (!isPng && !isIco && !isJpeg && !isGif && !isWebp) return true
  return false
}

/** Try all favicon sources in parallel, pick the largest non-default response */
async function fetchBestFavicon(domain: string): Promise<Buffer | null> {
  const urls = [
    `https://icon.horse/icon/${domain}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ]
  const results = await Promise.all(urls.map((u) => fetchBytes(u)))
  const candidates = results.filter((b): b is Buffer => b !== null && !isLikelyDefault(b))
  if (candidates.length === 0) return null
  // Pick the largest (usually highest quality)
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b))
}

function findSimpleIcon(name: string, slug: string) {
  const normalized = name.toLowerCase().trim()
  const aliasSlug = ALIASES[normalized]
  if (aliasSlug) {
    const key = `si${aliasSlug.charAt(0).toUpperCase()}${aliasSlug.slice(1)}`
    if (simpleIcons[key]) return simpleIcons[key]
  }
  const effectiveSlug = (slug || name).toLowerCase().replace(/[\s\-_.+]/g, '')
  const key = `si${effectiveSlug.charAt(0).toUpperCase()}${effectiveSlug.slice(1)}`
  if (simpleIcons[key]) return simpleIcons[key]
  return null
}

function deriveDomain(name: string, slug: string): string | null {
  const lower = name.toLowerCase().trim()
  if (DOMAIN_MAP[lower]) return DOMAIN_MAP[lower]
  if (/^[a-z][a-z0-9]+$/.test(slug)) return `${slug}.com`
  return null
}

function letterSvg(letter: string, hex: string): string {
  return `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#${hex}"/><text x="12" y="16.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="600" fill="white">${letter}</text></svg>`
}

async function resolveIcon(
  name: string,
  slug: string,
  fileSlug: string
): Promise<{ entry: IconEntry; bytes: Buffer; ext: string }> {
  const normalized = name.toLowerCase().trim()
  const letter = name.charAt(0).toUpperCase()

  // 1. Simple Icons (SVG, best)
  const si = findSimpleIcon(name, slug)
  if (si) {
    return {
      entry: { file: `${fileSlug}.svg`, color: si.hex, isSvg: true, letter, source: 'simple-icons' },
      bytes: Buffer.from(si.svg, 'utf-8'),
      ext: 'svg',
    }
  }

  // 2. Force letter for known-bad services
  if (FORCE_LETTER[normalized]) {
    const hex = FORCE_LETTER[normalized]
    return {
      entry: { file: `${fileSlug}.svg`, color: hex, isSvg: true, letter, source: 'letter' },
      bytes: Buffer.from(letterSvg(letter, hex), 'utf-8'),
      ext: 'svg',
    }
  }

  // 3. Try all favicon sources in parallel, pick best
  const domain = deriveDomain(name, slug)
  if (domain) {
    const best = await fetchBestFavicon(domain)
    if (best) {
      return {
        entry: { file: `${fileSlug}.png`, color: '6B7280', isSvg: false, letter, source: 'favicon' },
        bytes: best,
        ext: 'png',
      }
    }
  }

  // 4. Letter SVG fallback (generic gray)
  return {
    entry: { file: `${fileSlug}.svg`, color: '6B7280', isSvg: true, letter, source: 'letter' },
    bytes: Buffer.from(letterSvg(letter, '6B7280'), 'utf-8'),
    ext: 'svg',
  }
}

async function main() {
  await fs.mkdir(PUBLIC_ICONS, { recursive: true })

  const manifest: Manifest = {}
  const stats = { svg: 0, favicon: 0, letter: 0, total: POPULAR_SERVICES.length }

  console.log(`Fetching icons for ${POPULAR_SERVICES.length} services...`)

  // Deduplicate by slug to avoid duplicate downloads
  const slugSeen = new Map<string, IconEntry>()

  // Process in parallel batches of 20 to avoid rate limits
  const BATCH = 20
  for (let i = 0; i < POPULAR_SERVICES.length; i += BATCH) {
    const batch = POPULAR_SERVICES.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (s) => {
        const fileSlug = nameToSlug(s.name)
        // If we've already fetched for this slug, reuse
        if (slugSeen.has(fileSlug)) {
          return { name: s.name, entry: slugSeen.get(fileSlug)!, skip: true }
        }
        const { entry, bytes } = await resolveIcon(s.name, s.slug, fileSlug)
        await fs.writeFile(path.join(PUBLIC_ICONS, entry.file), bytes)
        slugSeen.set(fileSlug, entry)
        return { name: s.name, entry, skip: false }
      })
    )
    for (const r of results) {
      manifest[r.name] = r.entry
      if (!r.skip) {
        if (r.entry.file.endsWith('.svg')) {
          if (r.entry.color === '6B7280' || FORCE_LETTER[r.name.toLowerCase().trim()])
            stats.letter++
          else stats.svg++
        } else {
          stats.favicon++
        }
      }
    }
    process.stdout.write(
      `\r  ${Math.min(i + BATCH, POPULAR_SERVICES.length)}/${POPULAR_SERVICES.length}`
    )
  }
  console.log()

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  console.log('\nDone:')
  console.log(`  Simple Icons SVG:  ${stats.svg}`)
  console.log(`  Real favicon:      ${stats.favicon}`)
  console.log(`  Letter fallback:   ${stats.letter}`)
  console.log(`  Total:             ${stats.total}`)
  console.log(`  Manifest:          ${MANIFEST_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
