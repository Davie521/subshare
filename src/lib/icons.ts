/**
 * Subscription icon lookup using Simple Icons + fallback letter icons.
 * Every service gets an icon — either the real brand SVG or a colored letter.
 */

// Brand colors for services missing from Simple Icons
const BRAND_COLORS: Record<string, string> = {
  'openai': '10A37F',
  'chatgpt': '10A37F',
  'chatgpt plus': '10A37F',
  'chatgpt pro': '10A37F',
  'disney+': '113CCF',
  'disney plus': '113CCF',
  'hulu': '1CE783',
  'amazon prime': 'FF9900',
  'amazon prime video': 'FF9900',
  'prime video': '00A8E1',
  'amazon music': '00A8E1',
  'peacock': '000000',
  'hbo max': '5822B4',
  'max (hbo)': '002BE7',
  'xbox': '107C10',
  'xbox game pass': '107C10',
  'playstation plus': '003791',
  'nintendo switch online': 'E60012',
  'ea play': '000000',
  'apple arcade': '000000',
  'microsoft 365': 'D83B01',
  'microsoft': '5E5E5E',
  'adobe creative cloud': 'FF0000',
  'adobe photoshop': '31A8FF',
  'adobe lightroom': '31A8FF',
  'adobe premiere pro': '9999FF',
  'slack': '4A154B',
  'canva': '00C4CC',
  'canva pro': '00C4CC',
  'onedrive': '0078D4',
  'iqiyi': '00BE06',
  'youku': '1EB2FF',
  'tencent video': 'FF6A13',
  'mango tv': 'FF7300',
  'qq music': 'FEC700',
  'ximalaya': 'F55B23',
  'midjourney': '000000',
  'capcut': '000000',
  'capcut pro': '000000',
  'calm': '4B88C0',
  'bumble': 'FFC629',
  'bumble premium': 'FFC629',
  'hinge': '000000',
  'jd plus': 'C91623',
  'masterclass': '000000',
  'brilliant': '000000',
  'geforce now': '76B900',
  'ubisoft+': '000000',
  'kindle unlimited': 'FF9900',
  'audible': 'F8991C',
  'apple news+': 'FA243C',
  'apple fitness+': 'A2D249',
  'apple tv+': '000000',
  'apple music': 'FA243C',
  'baidu netdisk': '2932E1',
  'zhihu salt': '0066FF',
  'weibo vip': 'E6162D',
  'taobao 88vip': 'FF5000',
  'ele.me': '009BF5',
  'meituan': 'FFD100',
  'wechat': '07C160',
  'alipay': '1677FF',
  'coupang': 'E31937',
  'doordash dashpass': 'FF3008',
  'uber eats pass': '06C167',
  'instacart+': '43B02A',
  'the economist': 'E3120B',
  'fastmail': '1B6ACB',
}

// Aliases for name → Simple Icons slug
const ALIASES: Record<string, string> = {
  'chatgpt': 'openai',
  'chatgpt plus': 'openai',
  'chatgpt pro': 'openai',
  'gpt': 'openai',
  'icloud': 'icloud',
  'icloud+': 'icloud',
  'youtube premium': 'youtube',
  'youtube music': 'youtubemusic',
  'apple music': 'applemusic',
  'apple tv': 'appletv',
  'apple tv+': 'appletv',
  'apple one': 'apple',
  'disney+': 'disneyplus',
  'disney plus': 'disneyplus',
  'hbo max': 'hbo',
  'max (hbo)': 'hbo',
  'prime video': 'amazonprimevideo',
  'amazon prime': 'amazonprime',
  'ms 365': 'microsoft365',
  'microsoft 365': 'microsoft365',
  'office 365': 'microsoft365',
  'google one': 'google',
  'google drive': 'googledrive',
  'google workspace': 'google',
  'github copilot': 'githubcopilot',
  'adobe cc': 'adobecreativecloud',
  'creative cloud': 'adobecreativecloud',
  'photoshop': 'adobephotoshop',
  'claude': 'claude',
  'claude pro': 'claude',
  'midjourney': 'midjourney',
  'x premium': 'x',
  'twitter blue': 'x',
  'discord nitro': 'discord',
  'telegram premium': 'telegram',
  'snapchat+': 'snapchat',
  'reddit premium': 'reddit',
  'linkedin premium': 'linkedin',
  'strava premium': 'strava',
  'spotify': 'spotify',
  'netflix': 'netflix',
}

export interface BrandIcon {
  title: string
  svg: string
  hex: string // without #
}

/**
 * Generate a letter-based SVG icon as fallback
 */
function generateLetterIcon(name: string, hex: string): BrandIcon {
  const letter = name.charAt(0).toUpperCase()
  const svg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#${hex}"/><text x="12" y="16.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="600" fill="white">${letter}</text></svg>`
  return { title: name, svg, hex }
}

/**
 * Look up a brand icon by name.
 * Returns real SVG from Simple Icons, or a colored letter fallback.
 */
export function findBrandIcon(name: string): BrandIcon {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const simpleIcons = require('simple-icons')
  const normalized = name.toLowerCase().trim()

  // Try alias first
  const aliasSlug = ALIASES[normalized]
  if (aliasSlug) {
    const key = `si${aliasSlug.charAt(0).toUpperCase()}${aliasSlug.slice(1)}`
    const icon = simpleIcons[key]
    if (icon) return { title: icon.title, svg: icon.svg, hex: icon.hex }
  }

  // Try direct slug match
  const slug = normalized.replace(/[\s\-_.+]/g, '')
  const directKey = `si${slug.charAt(0).toUpperCase()}${slug.slice(1)}`
  const directIcon = simpleIcons[directKey]
  if (directIcon) return { title: directIcon.title, svg: directIcon.svg, hex: directIcon.hex }

  // Try partial match in all icons
  for (const key of Object.keys(simpleIcons)) {
    if (!key.startsWith('si')) continue
    const icon = simpleIcons[key]
    if (icon.title && icon.title.toLowerCase() === normalized) {
      return { title: icon.title, svg: icon.svg, hex: icon.hex }
    }
  }

  // Fallback: letter icon with brand color (or gray)
  const brandHex = BRAND_COLORS[normalized] || '6B7280'
  return generateLetterIcon(name, brandHex)
}
