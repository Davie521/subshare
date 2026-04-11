/**
 * Subscription icon lookup using Simple Icons (6000+ brands).
 * Returns SVG path + brand color for a given service name.
 */

// Common subscription name → Simple Icons slug mapping
const ALIASES: Record<string, string> = {
  'chatgpt': 'openai',
  'chatgpt plus': 'openai',
  'gpt': 'openai',
  'icloud': 'icloud',
  'icloud+': 'icloud',
  'youtube premium': 'youtube',
  'youtube music': 'youtubemusic',
  'apple music': 'applemusic',
  'apple tv': 'appletv',
  'apple one': 'apple',
  'disney+': 'disneyplus',
  'disney plus': 'disneyplus',
  'hbo max': 'hbo',
  'hbo': 'hbo',
  'prime video': 'amazonprimevideo',
  'amazon prime': 'amazonprime',
  'ms 365': 'microsoft365',
  'microsoft 365': 'microsoft365',
  'office 365': 'microsoft365',
  'google one': 'google',
  'google drive': 'googledrive',
  'github copilot': 'githubcopilot',
  'adobe cc': 'adobecreativecloud',
  'creative cloud': 'adobecreativecloud',
  'photoshop': 'adobephotoshop',
  'figma': 'figma',
  'notion': 'notion',
  'slack': 'slack',
  'zoom': 'zoom',
  '1password': '1password',
  'nordvpn': 'nordvpn',
  'expressvpn': 'expressvpn',
  'claude': 'anthropic',
  'claude pro': 'anthropic',
  'midjourney': 'midjourney',
  'x premium': 'x',
  'twitter blue': 'x',
}

export interface BrandIcon {
  title: string
  svg: string // full SVG string
  hex: string // brand color hex (without #)
}

/**
 * Look up a brand icon by subscription name.
 * Tries exact match, then alias, then fuzzy search.
 */
export function findBrandIcon(name: string): BrandIcon | null {
  try {
    // Dynamic import to avoid bundling all 6000+ icons
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const simpleIcons = require('simple-icons')

    const normalized = name.toLowerCase().trim()

    // Try alias first
    const aliasSlug = ALIASES[normalized]
    if (aliasSlug) {
      const key = `si${aliasSlug.charAt(0).toUpperCase()}${aliasSlug.slice(1)}`
      const icon = simpleIcons[key]
      if (icon) {
        return { title: icon.title, svg: icon.svg, hex: icon.hex }
      }
    }

    // Try direct slug match (remove spaces, lowercase)
    const slug = normalized.replace(/[\s\-_.+]/g, '')
    const directKey = `si${slug.charAt(0).toUpperCase()}${slug.slice(1)}`
    const directIcon = simpleIcons[directKey]
    if (directIcon) {
      return { title: directIcon.title, svg: directIcon.svg, hex: directIcon.hex }
    }

    // Try searching through all icons
    for (const key of Object.keys(simpleIcons)) {
      if (!key.startsWith('si')) continue
      const icon = simpleIcons[key]
      if (icon.title && icon.title.toLowerCase().includes(normalized)) {
        return { title: icon.title, svg: icon.svg, hex: icon.hex }
      }
    }

    return null
  } catch {
    return null
  }
}
