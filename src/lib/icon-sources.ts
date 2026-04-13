/** Shared constants for icon source resolution (used by build script + runtime) */

// Explicit domain map for services where the domain isn't obvious
export const DOMAIN_MAP: Record<string, string> = {
  // Streaming
  netflix: 'netflix.com',
  'disney+': 'disneyplus.com',
  hulu: 'hulu.com',
  'prime video': 'amazon.com',
  'amazon prime video': 'amazon.com',
  'apple tv+': 'tv.apple.com',
  'youtube premium': 'youtube.com',
  'max (hbo)': 'max.com',
  'hbo max': 'max.com',
  peacock: 'peacocktv.com',
  'paramount+': 'paramountplus.com',
  crunchyroll: 'crunchyroll.com',
  'espn+': 'espn.com',
  starz: 'starz.com',
  'youtube tv': 'tv.youtube.com',
  'sling tv': 'sling.com',
  fubotv: 'fubo.tv',
  mubi: 'mubi.com',
  vimeo: 'vimeo.com',
  sky: 'sky.com',
  now: 'nowtv.com',
  'canal+': 'canalplus.com',
  viaplay: 'viaplay.com',
  skyshowtime: 'skyshowtime.com',
  stan: 'stan.com.au',
  viu: 'viu.com',
  'twitch turbo': 'twitch.tv',

  // Music
  spotify: 'spotify.com',
  'apple music': 'music.apple.com',
  'youtube music': 'music.youtube.com',
  tidal: 'tidal.com',
  'amazon music': 'music.amazon.com',
  deezer: 'deezer.com',
  'soundcloud go+': 'soundcloud.com',
  pandora: 'pandora.com',
  qobuz: 'qobuz.com',
  siriusxm: 'siriusxm.com',
  anghami: 'anghami.com',
  boomplay: 'boomplay.com',

  // Podcasts
  audible: 'audible.com',
  'scribd/everand': 'scribd.com',
  'apple podcasts': 'podcasts.apple.com',
  'spotify podcasts': 'spotify.com',

  // Sports
  dazn: 'dazn.com',
  'the athletic': 'theathletic.com',
  fanduel: 'fanduel.com',
  draftkings: 'draftkings.com',

  // AI
  'chatgpt plus': 'openai.com',
  'chatgpt pro': 'openai.com',
  'claude pro': 'claude.ai',
  'gemini advanced': 'gemini.google.com',
  'microsoft copilot pro': 'copilot.microsoft.com',
  'perplexity pro': 'perplexity.ai',
  midjourney: 'midjourney.com',
  'runway ml': 'runwayml.com',
  elevenlabs: 'elevenlabs.io',
  'suno ai': 'suno.com',
  'grammarly premium': 'grammarly.com',
  'deepl pro': 'deepl.com',
  descript: 'descript.com',
  'jasper ai': 'jasper.ai',
  synthesia: 'synthesia.io',

  // Developer
  'github pro': 'github.com',
  'github copilot': 'github.com',
  'gitlab premium': 'gitlab.com',
  'jetbrains all products': 'jetbrains.com',
  'cursor pro': 'cursor.com',
  replit: 'replit.com',
  postman: 'postman.com',
  'docker pro': 'docker.com',
  'vercel pro': 'vercel.com',
  'netlify pro': 'netlify.com',
  railway: 'railway.com',
  render: 'render.com',
  digitalocean: 'digitalocean.com',
  supabase: 'supabase.com',
  cloudflare: 'cloudflare.com',
  sentry: 'sentry.io',
  datadog: 'datadoghq.com',
  tailscale: 'tailscale.com',
  leetcode: 'leetcode.com',
  hackerrank: 'hackerrank.com',

  // Productivity
  'microsoft 365': 'microsoft365.com',
  'google workspace': 'workspace.google.com',
  notion: 'notion.so',
  'obsidian sync': 'obsidian.md',
  evernote: 'evernote.com',
  airtable: 'airtable.com',
  trello: 'trello.com',
  asana: 'asana.com',
  'monday.com': 'monday.com',
  jira: 'atlassian.com',
  linear: 'linear.app',
  clickup: 'clickup.com',
  'todoist pro': 'todoist.com',
  'raycast pro': 'raycast.com',
  superhuman: 'superhuman.com',
  calendly: 'calendly.com',
  zapier: 'zapier.com',
  make: 'make.com',
  miro: 'miro.com',
  loom: 'loom.com',

  // Design
  'adobe creative cloud': 'adobe.com',
  'adobe photoshop': 'adobe.com',
  'adobe lightroom': 'adobe.com',
  'adobe premiere pro': 'adobe.com',
  figma: 'figma.com',
  'canva pro': 'canva.com',
  sketch: 'sketch.com',
  framer: 'framer.com',
  'capcut pro': 'capcut.com',
  'davinci resolve studio': 'blackmagicdesign.com',
  shutterstock: 'shutterstock.com',
  'envato elements': 'elements.envato.com',

  // Cloud
  'icloud+': 'icloud.com',
  'google one': 'one.google.com',
  'dropbox plus': 'dropbox.com',
  onedrive: 'onedrive.live.com',
  mega: 'mega.nz',
  backblaze: 'backblaze.com',

  // VPN
  nordvpn: 'nordvpn.com',
  expressvpn: 'expressvpn.com',
  surfshark: 'surfshark.com',
  protonvpn: 'protonvpn.com',
  'mullvad vpn': 'mullvad.net',

  // Security
  '1password': '1password.com',
  'bitwarden premium': 'bitwarden.com',
  dashlane: 'dashlane.com',
  'lastpass premium': 'lastpass.com',
  'proton unlimited': 'proton.me',

  // Communication
  'slack pro': 'slack.com',
  zoom: 'zoom.us',
  'microsoft teams': 'teams.microsoft.com',
  'discord nitro': 'discord.com',
  'telegram premium': 'telegram.org',
  whatsapp: 'whatsapp.com',

  // Email
  'proton mail plus': 'proton.me',
  hey: 'hey.com',
  fastmail: 'fastmail.com',
  tuta: 'tuta.com',

  // Social
  'x premium': 'x.com',
  'linkedin premium': 'linkedin.com',
  'reddit premium': 'reddit.com',
  'snapchat+': 'snapchat.com',
  'meta verified': 'meta.com',
  'quora+': 'quora.com',

  // Dating
  'tinder plus/gold/platinum': 'tinder.com',
  'bumble premium': 'bumble.com',
  'hinge preferred': 'hinge.co',
  'match.com': 'match.com',
  grindr: 'grindr.com',

  // Gaming
  'xbox game pass ultimate': 'xbox.com',
  'xbox game pass pc': 'xbox.com',
  'playstation plus essential': 'playstation.com',
  'playstation plus extra': 'playstation.com',
  'playstation plus premium': 'playstation.com',
  'nintendo switch online': 'nintendo.com',
  'ea play': 'ea.com',
  'ubisoft+': 'ubisoft.com',
  'geforce now': 'nvidia.com',
  'apple arcade': 'apple.com',
  'google play pass': 'play.google.com',
  'world of warcraft': 'worldofwarcraft.com',
  'final fantasy xiv': 'finalfantasyxiv.com',
  'fortnite crew': 'fortnite.com',
  'roblox premium': 'roblox.com',

  // Education
  'coursera plus': 'coursera.org',
  udemy: 'udemy.com',
  edx: 'edx.org',
  'linkedin learning': 'linkedin.com',
  skillshare: 'skillshare.com',
  masterclass: 'masterclass.com',
  pluralsight: 'pluralsight.com',
  datacamp: 'datacamp.com',
  'codecademy pro': 'codecademy.com',
  "o'reilly": 'oreilly.com',
  brilliant: 'brilliant.org',
  'duolingo super': 'duolingo.com',
  'duolingo max': 'duolingo.com',
  babbel: 'babbel.com',
  'rosetta stone': 'rosettastone.com',
  'khan academy': 'khanacademy.org',
  overleaf: 'overleaf.com',
  'frontend masters': 'frontendmasters.com',

  // Reading
  medium: 'medium.com',
  substack: 'substack.com',
  'the new york times': 'nytimes.com',
  'wall street journal': 'wsj.com',
  'washington post': 'washingtonpost.com',
  'financial times': 'ft.com',
  bloomberg: 'bloomberg.com',
  'the economist': 'economist.com',
  'the atlantic': 'theatlantic.com',
  'the new yorker': 'newyorker.com',
  wired: 'wired.com',
  'the information': 'theinformation.com',
  'the guardian': 'theguardian.com',
  'kindle unlimited': 'amazon.com',
  'apple news+': 'apple.com',
  readwise: 'readwise.io',
  'pocket premium': 'getpocket.com',
  'feedly pro': 'feedly.com',

  // Fitness
  'peloton app': 'onepeloton.com',
  'apple fitness+': 'apple.com',
  'strava premium': 'strava.com',
  'fitbit premium': 'fitbit.com',
  whoop: 'whoop.com',
  'oura ring': 'oura.com',
  classpass: 'classpass.com',
  'nike training club': 'nike.com',
  'myfitnesspal premium': 'myfitnesspal.com',
  'alltrails pro': 'alltrails.com',

  // Health
  calm: 'calm.com',
  headspace: 'headspace.com',
  betterhelp: 'betterhelp.com',
  talkspace: 'talkspace.com',
  noom: 'noom.com',
  'ww (weightwatchers)': 'weightwatchers.com',
  'flo premium': 'flo.health',
  hims: 'forhims.com',
  hers: 'hers.com',
  teladoc: 'teladoc.com',

  // Shopping
  'amazon prime': 'amazon.com',
  'walmart+': 'walmart.com',
  'target circle 360': 'target.com',
  costco: 'costco.com',
  "sam's club": 'samsclub.com',
  'doordash dashpass': 'doordash.com',
  'uber one': 'uber.com',
  'grubhub+': 'grubhub.com',
  'deliveroo plus': 'deliveroo.co.uk',
  'instacart+': 'instacart.com',
  hellofresh: 'hellofresh.com',
  'blue apron': 'blueapron.com',
  'home chef': 'homechef.com',
  'dollar shave club': 'dollarshaveclub.com',
  "harry's": 'harrys.com',
  'rent the runway': 'renttherunway.com',
  'stitch fix': 'stitchfix.com',
  barkbox: 'barkbox.com',

  // Finance
  tradingview: 'tradingview.com',
  'morningstar premium': 'morningstar.com',
  'seeking alpha': 'seekingalpha.com',
  'motley fool': 'fool.com',
  ynab: 'ynab.com',
  'monarch money': 'monarchmoney.com',
  'robinhood gold': 'robinhood.com',
  'coinbase one': 'coinbase.com',
  'revolut premium': 'revolut.com',
  'wise premium': 'wise.com',
  n26: 'n26.com',
  'monzo plus': 'monzo.com',

  // Creator
  patreon: 'patreon.com',
  'ko-fi': 'ko-fi.com',
  'buy me a coffee': 'buymeacoffee.com',
  onlyfans: 'onlyfans.com',
  gumroad: 'gumroad.com',
  'ghost pro': 'ghost.org',
  squarespace: 'squarespace.com',
  wix: 'wix.com',
  webflow: 'webflow.com',
  shopify: 'shopify.com',

  // Weather
  'windy premium': 'windy.com',
  'accuweather premium': 'accuweather.com',
  'carrot weather': 'meetcarrot.com',

  // China
  '爱奇艺 iqiyi': 'iqiyi.com',
  '优酷 youku': 'youku.com',
  '腾讯视频': 'v.qq.com',
  '芒果tv': 'mgtv.com',
  'bilibili 大会员': 'bilibili.com',
  'qq音乐': 'y.qq.com',
  '网易云音乐': 'music.163.com',
  '微信读书': 'weread.qq.com',
  '知乎盐选': 'zhihu.com',
  '得到': 'dedao.cn',
  '喜马拉雅': 'ximalaya.com',
  '淘宝 88vip': 'taobao.com',
  '京东 plus': 'jd.com',
  '拼多多省钱月卡': 'pinduoduo.com',
  '美团神会员': 'meituan.com',
  '饿了么超级会员': 'ele.me',
  '滴滴橙长会员': 'didiglobal.com',
  '携程超级会员': 'ctrip.com',
  '百度网盘超级会员': 'pan.baidu.com',
  '阿里云盘': 'alipan.com',
  'wps 会员': 'wps.cn',
  '石墨文档': 'shimo.im',
  '语雀': 'yuque.com',
  '飞书 (lark)': 'feishu.cn',
  '钉钉 (dingtalk)': 'dingtalk.com',
  '微博 vip/svip': 'weibo.com',
  'qq超级会员': 'qq.com',
  '小红书': 'xiaohongshu.com',
  '抖音': 'douyin.com',
  '快手': 'kuaishou.com',
  '原神': 'ys.mihoyo.com',
  '王者荣耀战令': 'pvp.qq.com',
  '和平精英精英手册': 'gamehelper.gm825.com',
  '文心一言': 'yiyan.baidu.com',
  '通义千问': 'tongyi.aliyun.com',
  '豆包': 'doubao.com',
  kimi: 'kimi.moonshot.cn',
  '雪球': 'xueqiu.com',
  '东方财富': 'eastmoney.com',
  'keep 会员': 'gotokeep.com',
  '极客时间': 'time.geekbang.org',
  '掘金小册': 'juejin.cn',

  // Japan
  'amazon prime japan': 'amazon.co.jp',
  'line music': 'music.line.me',
  abema: 'abema.tv',
  'u-next': 'unext.jp',
  niconico: 'nicovideo.jp',

  // Korea
  melon: 'melon.com',
  'coupang rocket wow': 'coupang.com',
  toss: 'toss.im',
  'kakao pay': 'kakaopay.com',
  wavve: 'wavve.com',

  // India
  'disney+ hotstar': 'hotstar.com',
  jiocinema: 'jiocinema.com',
  'swiggy one': 'swiggy.com',
  'zomato gold': 'zomato.com',
  'flipkart plus': 'flipkart.com',

  // SEA
  grab: 'grab.com',
  gojek: 'gojek.com',
  shopee: 'shopee.com',
  lazada: 'lazada.com',
  gcash: 'gcash.com',
  line: 'line.me',

  // LatAm
  globoplay: 'globoplay.globo.com',
  'mercado libre': 'mercadolibre.com',
  nubank: 'nubank.com.br',
  ifood: 'ifood.com.br',

  // Middle East
  'shahid vip': 'shahid.mbc.net',
  careem: 'careem.com',

  // Africa
  showmax: 'showmax.com',
  'm-pesa': 'safaricom.co.ke',

  // Russia
  'yandex music': 'music.yandex.ru',
  wildberries: 'wildberries.ru',
  'ozon premium': 'ozon.ru',
}

// Aliases for Simple Icons lookup
export const ALIASES: Record<string, string> = {
  'chatgpt plus': 'openai',
  'chatgpt pro': 'openai',
  'claude pro': 'claude',
  'youtube premium': 'youtube',
  'youtube music': 'youtubemusic',
  'apple music': 'applemusic',
  'apple tv+': 'appletv',
  'microsoft 365': 'microsoftoffice',
  'github copilot': 'githubcopilot',
  'x premium': 'x',
  'discord nitro': 'discord',
  'telegram premium': 'telegram',
  'snapchat+': 'snapchat',
  'reddit premium': 'reddit',
  'linkedin premium': 'linkedin',
  'strava premium': 'strava',
  'spotify podcasts': 'spotify',
  'apple podcasts': 'applepodcasts',
  'disney+ hotstar': 'hotstar',
}

// Services with no good favicon — force letter with brand color
export const FORCE_LETTER: Record<string, string> = {}

// Services where DuckDuckGo has better favicon than Google
export const PREFER_DDG: Set<string> = new Set([
  'hulu', 'disney+', 'prime video', 'amazon prime video',
  'tunein premium', 'bookbeat', 'udio', 'neon', 'craft',
  'adobe stock', 'onedrive', 'hinge preferred', 'feeld',
  'nintendo switch online', 'eve online omega', 'minecraft realms',
  'the economist', 'wired', 'the information',
  'readly', 'les mills+', 'alo moves', 'waking up', 'hims', 'daily harvest',
  'barkbox', 'onx maps', '酷狗音乐', '唯品会超级vip',
  '讯飞星火', '丁香医生', '17live', 'melon', 'genie music',
  '요기요 yogiyo', 'simplilearn', 'osn+', 'dstv',
  'espn+', 'amazon music', 'scribd/everand', 'descript', 'synthesia', 'tuta',
  'linkedin learning', 'masterclass', 'readwise', 'myfitnesspal premium',
  'noom', 'rent the runway', 'motley fool', 'abema', 'wavve',
])

/** Generate a URL-safe slug from a service name */
export function nameToSlug(name: string): string {
  // For Chinese/non-ASCII names, use a hash-like safe slug
  const normalized = name.toLowerCase().trim()
  if (/[^\x00-\x7f]/.test(normalized)) {
    // Has non-ASCII — generate deterministic ASCII slug via char codes
    let hash = 0
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0
    }
    return `s${Math.abs(hash).toString(36)}`
  }
  return normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
