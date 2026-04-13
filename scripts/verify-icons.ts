/**
 * Verify every icon in public/icons/ is a real, non-default image.
 * Reports:
 *   - Files with invalid magic bytes
 *   - Files suspiciously small (< 300 bytes)
 *   - PNGs with known default/placeholder sizes
 *   - Services in manifest but missing files
 *   - Services where icon resolved to letter fallback (color 6B7280)
 */

import fs from 'fs'
import path from 'path'

const PUBLIC_ICONS = path.join(process.cwd(), 'public', 'icons')
const MANIFEST_PATH = path.join(PUBLIC_ICONS, 'manifest.json')

const KNOWN_DEFAULT_SIZES = new Set([917, 1478, 601, 323, 18])
const MIN_SIZE = 300

interface ManifestEntry {
  file: string
  color: string
  isSvg: boolean
  letter: string
}

function checkMagic(buf: Buffer, ext: string): string | null {
  if (ext === 'svg') {
    const head = buf.slice(0, 200).toString('utf-8').trimStart()
    if (!head.startsWith('<svg') && !head.startsWith('<?xml')) {
      return 'not a valid SVG (no <svg> root)'
    }
    return null
  }
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const isIco = buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
  if (!isPng && !isIco && !isJpeg && !isGif && !isWebp) {
    return `invalid image magic bytes: ${buf.slice(0, 4).toString('hex')}`
  }
  return null
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('manifest.json not found — run npm run fetch-icons first')
    process.exit(1)
  }
  const manifest: Record<string, ManifestEntry> = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, 'utf-8')
  )

  const issues: string[] = []
  const letterFallbacks: string[] = []
  let ok = 0
  let checked = 0

  for (const [name, entry] of Object.entries(manifest)) {
    checked++
    const filePath = path.join(PUBLIC_ICONS, entry.file)

    if (!fs.existsSync(filePath)) {
      issues.push(`MISSING: "${name}" → ${entry.file}`)
      continue
    }

    const buf = fs.readFileSync(filePath)
    const ext = path.extname(entry.file).slice(1)

    if (ext !== 'svg') {
      if (buf.length < MIN_SIZE) {
        issues.push(
          `TOO SMALL: "${name}" → ${entry.file} (${buf.length} bytes)`
        )
        continue
      }
      if (KNOWN_DEFAULT_SIZES.has(buf.length)) {
        issues.push(
          `DEFAULT/PLACEHOLDER SIZE: "${name}" → ${entry.file} (${buf.length} bytes)`
        )
        continue
      }
    }
    const magicErr = checkMagic(buf, ext)
    if (magicErr) {
      issues.push(`CORRUPT: "${name}" → ${entry.file} — ${magicErr}`)
      continue
    }

    // Letter fallback detection: SVG with gray color (6B7280) or FORCE_LETTER colors
    if (entry.isSvg && entry.color === '6B7280') {
      letterFallbacks.push(`"${name}" (generic gray letter)`)
    }

    ok++
  }

  // Also check for orphan files in icons/ that aren't in manifest
  const filesInDir = fs
    .readdirSync(PUBLIC_ICONS)
    .filter((f) => f !== 'manifest.json')
  const manifestFiles = new Set(Object.values(manifest).map((e) => e.file))
  const orphans = filesInDir.filter((f) => !manifestFiles.has(f))

  console.log(`\nIcon verification report`)
  console.log(`========================`)
  console.log(`Services in manifest: ${checked}`)
  console.log(`Valid real icons:     ${ok}`)
  console.log(`Letter fallbacks:     ${letterFallbacks.length}`)
  console.log(`Issues found:         ${issues.length}`)
  console.log(`Orphan files:         ${orphans.length}`)

  if (letterFallbacks.length > 0) {
    console.log(`\nLetter fallbacks (expected for obscure/unreachable services):`)
    letterFallbacks.forEach((s) => console.log(`  - ${s}`))
  }

  if (issues.length > 0) {
    console.log(`\n!! ISSUES:`)
    issues.forEach((s) => console.log(`  - ${s}`))
  }

  if (orphans.length > 0) {
    console.log(`\nOrphan files in public/icons/ not in manifest:`)
    orphans.forEach((f) => console.log(`  - ${f}`))
  }

  console.log()
  if (issues.length > 0) process.exit(1)
  console.log('All icons OK.')
}

main()
