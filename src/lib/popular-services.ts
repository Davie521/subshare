/** Curated list of 200+ popular subscription services */
export interface ServiceTemplate {
  name: string
  slug: string // Simple Icons slug or name for icon lookup
  category: string
  defaultPrice?: number // cents, common monthly price
  defaultCurrency?: string
}

export const POPULAR_SERVICES: ServiceTemplate[] = [
  // --- Streaming ---
  { name: 'Netflix', slug: 'netflix', category: 'Streaming', defaultPrice: 1599, defaultCurrency: 'USD' },
  { name: 'Disney+', slug: 'disneyplus', category: 'Streaming', defaultPrice: 1399, defaultCurrency: 'USD' },
  { name: 'YouTube Premium', slug: 'youtube', category: 'Streaming', defaultPrice: 1399, defaultCurrency: 'USD' },
  { name: 'Max (HBO)', slug: 'hbo', category: 'Streaming', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'Prime Video', slug: 'amazonprimevideo', category: 'Streaming', defaultPrice: 899, defaultCurrency: 'USD' },
  { name: 'Apple TV+', slug: 'appletv', category: 'Streaming', defaultPrice: 1299, defaultCurrency: 'USD' },
  { name: 'Hulu', slug: 'hulu', category: 'Streaming', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Peacock', slug: 'peacock', category: 'Streaming', defaultPrice: 799, defaultCurrency: 'USD' },
  { name: 'Paramount+', slug: 'paramountplus', category: 'Streaming', defaultPrice: 799, defaultCurrency: 'USD' },
  { name: 'Crunchyroll', slug: 'crunchyroll', category: 'Streaming', defaultPrice: 799, defaultCurrency: 'USD' },
  { name: 'Vimeo', slug: 'vimeo', category: 'Streaming', defaultPrice: 1200, defaultCurrency: 'USD' },
  { name: 'MUBI', slug: 'mubi', category: 'Streaming', defaultPrice: 1499, defaultCurrency: 'USD' },
  { name: 'Bilibili', slug: 'bilibili', category: 'Streaming', defaultPrice: 2500, defaultCurrency: 'CNY' },
  { name: 'iQIYI', slug: 'iqiyi', category: 'Streaming', defaultPrice: 2500, defaultCurrency: 'CNY' },
  { name: 'Tencent Video', slug: 'tencentqq', category: 'Streaming', defaultPrice: 2500, defaultCurrency: 'CNY' },
  { name: 'Youku', slug: 'youku', category: 'Streaming', defaultPrice: 2500, defaultCurrency: 'CNY' },
  { name: 'Mango TV', slug: 'mangotv', category: 'Streaming', defaultPrice: 1900, defaultCurrency: 'CNY' },

  // --- Music ---
  { name: 'Spotify', slug: 'spotify', category: 'Music', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'Apple Music', slug: 'applemusic', category: 'Music', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'YouTube Music', slug: 'youtubemusic', category: 'Music', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'Tidal', slug: 'tidal', category: 'Music', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'Amazon Music', slug: 'amazonmusic', category: 'Music', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Deezer', slug: 'deezer', category: 'Music', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'SoundCloud Go+', slug: 'soundcloud', category: 'Music', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Pandora', slug: 'pandora', category: 'Music', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'QQ Music', slug: 'tencentqq', category: 'Music', defaultPrice: 1500, defaultCurrency: 'CNY' },
  { name: 'NetEase Cloud Music', slug: 'neteasecloudmusic', category: 'Music', defaultPrice: 1500, defaultCurrency: 'CNY' },
  { name: 'Ximalaya', slug: 'ximalaya', category: 'Music', defaultPrice: 2500, defaultCurrency: 'CNY' },
  { name: 'LINE Music', slug: 'line', category: 'Music', defaultPrice: 980, defaultCurrency: 'JPY' },

  // --- AI Tools ---
  { name: 'ChatGPT Plus', slug: 'openai', category: 'AI', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'ChatGPT Pro', slug: 'openai', category: 'AI', defaultPrice: 20000, defaultCurrency: 'USD' },
  { name: 'Claude Pro', slug: 'anthropic', category: 'AI', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'Gemini Advanced', slug: 'googlegemini', category: 'AI', defaultPrice: 1999, defaultCurrency: 'USD' },
  { name: 'Perplexity Pro', slug: 'perplexity', category: 'AI', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'Midjourney', slug: 'midjourney', category: 'AI', defaultPrice: 1000, defaultCurrency: 'USD' },
  { name: 'GitHub Copilot', slug: 'githubcopilot', category: 'AI', defaultPrice: 1000, defaultCurrency: 'USD' },
  { name: 'Cursor Pro', slug: 'cursor', category: 'AI', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'Grammarly Pro', slug: 'grammarly', category: 'AI', defaultPrice: 1200, defaultCurrency: 'USD' },
  { name: 'DeepL Pro', slug: 'deepl', category: 'AI', defaultPrice: 1049, defaultCurrency: 'USD' },
  { name: 'Notion AI', slug: 'notion', category: 'AI', defaultPrice: 1000, defaultCurrency: 'USD' },
  { name: 'Jasper', slug: 'jasper', category: 'AI', defaultPrice: 3900, defaultCurrency: 'USD' },
  { name: 'Runway', slug: 'runway', category: 'AI', defaultPrice: 1200, defaultCurrency: 'USD' },

  // --- Cloud Storage ---
  { name: 'iCloud+', slug: 'icloud', category: 'Cloud', defaultPrice: 99, defaultCurrency: 'USD' },
  { name: 'Google One', slug: 'google', category: 'Cloud', defaultPrice: 199, defaultCurrency: 'USD' },
  { name: 'Dropbox Plus', slug: 'dropbox', category: 'Cloud', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'OneDrive', slug: 'onedrive', category: 'Cloud', defaultPrice: 199, defaultCurrency: 'USD' },
  { name: 'Google Drive', slug: 'googledrive', category: 'Cloud', defaultPrice: 199, defaultCurrency: 'USD' },
  { name: 'pCloud', slug: 'pcloud', category: 'Cloud', defaultPrice: 499, defaultCurrency: 'USD' },
  { name: 'MEGA', slug: 'mega', category: 'Cloud', defaultPrice: 535, defaultCurrency: 'USD' },
  { name: 'Proton Drive', slug: 'proton', category: 'Cloud', defaultPrice: 399, defaultCurrency: 'USD' },
  { name: 'Baidu Netdisk', slug: 'baidu', category: 'Cloud', defaultPrice: 2500, defaultCurrency: 'CNY' },

  // --- Productivity ---
  { name: 'Microsoft 365', slug: 'microsoft', category: 'Productivity', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Notion', slug: 'notion', category: 'Productivity', defaultPrice: 1000, defaultCurrency: 'USD' },
  { name: 'Todoist Pro', slug: 'todoist', category: 'Productivity', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'Evernote', slug: 'evernote', category: 'Productivity', defaultPrice: 1499, defaultCurrency: 'USD' },
  { name: 'Obsidian Sync', slug: 'obsidian', category: 'Productivity', defaultPrice: 400, defaultCurrency: 'USD' },
  { name: 'Linear', slug: 'linear', category: 'Productivity', defaultPrice: 800, defaultCurrency: 'USD' },
  { name: 'Asana', slug: 'asana', category: 'Productivity', defaultPrice: 1099, defaultCurrency: 'USD' },
  { name: 'Trello', slug: 'trello', category: 'Productivity', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'ClickUp', slug: 'clickup', category: 'Productivity', defaultPrice: 700, defaultCurrency: 'USD' },
  { name: 'Airtable', slug: 'airtable', category: 'Productivity', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'Miro', slug: 'miro', category: 'Productivity', defaultPrice: 800, defaultCurrency: 'USD' },
  { name: 'Loom', slug: 'loom', category: 'Productivity', defaultPrice: 1250, defaultCurrency: 'USD' },
  { name: 'Canva Pro', slug: 'canva', category: 'Productivity', defaultPrice: 1299, defaultCurrency: 'USD' },

  // --- Gaming ---
  { name: 'Xbox Game Pass', slug: 'xbox', category: 'Gaming', defaultPrice: 1699, defaultCurrency: 'USD' },
  { name: 'PlayStation Plus', slug: 'playstation', category: 'Gaming', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Nintendo Switch Online', slug: 'nintendoswitch', category: 'Gaming', defaultPrice: 399, defaultCurrency: 'USD' },
  { name: 'EA Play', slug: 'ea', category: 'Gaming', defaultPrice: 599, defaultCurrency: 'USD' },
  { name: 'Apple Arcade', slug: 'apple', category: 'Gaming', defaultPrice: 699, defaultCurrency: 'USD' },
  { name: 'GeForce NOW', slug: 'nvidia', category: 'Gaming', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Ubisoft+', slug: 'ubisoft', category: 'Gaming', defaultPrice: 1499, defaultCurrency: 'USD' },
  { name: 'Steam', slug: 'steam', category: 'Gaming' },

  // --- Developer ---
  { name: 'GitHub Pro', slug: 'github', category: 'Developer', defaultPrice: 400, defaultCurrency: 'USD' },
  { name: 'GitLab Premium', slug: 'gitlab', category: 'Developer', defaultPrice: 2900, defaultCurrency: 'USD' },
  { name: 'JetBrains All Products', slug: 'jetbrains', category: 'Developer', defaultPrice: 2490, defaultCurrency: 'USD' },
  { name: 'Vercel Pro', slug: 'vercel', category: 'Developer', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'Netlify Pro', slug: 'netlify', category: 'Developer', defaultPrice: 1900, defaultCurrency: 'USD' },
  { name: 'DigitalOcean', slug: 'digitalocean', category: 'Developer', defaultPrice: 400, defaultCurrency: 'USD' },
  { name: 'Docker Pro', slug: 'docker', category: 'Developer', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'Tailscale', slug: 'tailscale', category: 'Developer', defaultPrice: 600, defaultCurrency: 'USD' },
  { name: 'Cloudflare', slug: 'cloudflare', category: 'Developer', defaultPrice: 2000, defaultCurrency: 'USD' },
  { name: 'Render', slug: 'render', category: 'Developer', defaultPrice: 700, defaultCurrency: 'USD' },
  { name: 'Railway', slug: 'railway', category: 'Developer', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'Supabase Pro', slug: 'supabase', category: 'Developer', defaultPrice: 2500, defaultCurrency: 'USD' },

  // --- VPN & Security ---
  { name: 'NordVPN', slug: 'nordvpn', category: 'VPN', defaultPrice: 1299, defaultCurrency: 'USD' },
  { name: 'ExpressVPN', slug: 'expressvpn', category: 'VPN', defaultPrice: 1295, defaultCurrency: 'USD' },
  { name: 'Surfshark', slug: 'surfshark', category: 'VPN', defaultPrice: 1299, defaultCurrency: 'USD' },
  { name: 'ProtonVPN', slug: 'protonvpn', category: 'VPN', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Mullvad VPN', slug: 'mullvad', category: 'VPN', defaultPrice: 546, defaultCurrency: 'USD' },
  { name: '1Password', slug: '1password', category: 'Security', defaultPrice: 299, defaultCurrency: 'USD' },
  { name: 'Bitwarden Premium', slug: 'bitwarden', category: 'Security', defaultPrice: 83, defaultCurrency: 'USD' },
  { name: 'Dashlane', slug: 'dashlane', category: 'Security', defaultPrice: 499, defaultCurrency: 'USD' },
  { name: 'LastPass', slug: 'lastpass', category: 'Security', defaultPrice: 300, defaultCurrency: 'USD' },
  { name: 'Proton Unlimited', slug: 'proton', category: 'Security', defaultPrice: 999, defaultCurrency: 'USD' },

  // --- Communication ---
  { name: 'Slack Pro', slug: 'slack', category: 'Communication', defaultPrice: 875, defaultCurrency: 'USD' },
  { name: 'Zoom', slug: 'zoom', category: 'Communication', defaultPrice: 1333, defaultCurrency: 'USD' },
  { name: 'Discord Nitro', slug: 'discord', category: 'Communication', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Telegram Premium', slug: 'telegram', category: 'Communication', defaultPrice: 499, defaultCurrency: 'USD' },

  // --- Social ---
  { name: 'X Premium', slug: 'x', category: 'Social', defaultPrice: 800, defaultCurrency: 'USD' },
  { name: 'LinkedIn Premium', slug: 'linkedin', category: 'Social', defaultPrice: 2999, defaultCurrency: 'USD' },
  { name: 'Snapchat+', slug: 'snapchat', category: 'Social', defaultPrice: 399, defaultCurrency: 'USD' },
  { name: 'Reddit Premium', slug: 'reddit', category: 'Social', defaultPrice: 599, defaultCurrency: 'USD' },
  { name: 'Patreon', slug: 'patreon', category: 'Social' },
  { name: 'Substack', slug: 'substack', category: 'Social' },

  // --- Education ---
  { name: 'Duolingo Super', slug: 'duolingo', category: 'Education', defaultPrice: 699, defaultCurrency: 'USD' },
  { name: 'Coursera Plus', slug: 'coursera', category: 'Education', defaultPrice: 5900, defaultCurrency: 'USD' },
  { name: 'Skillshare', slug: 'skillshare', category: 'Education', defaultPrice: 1400, defaultCurrency: 'USD' },
  { name: 'MasterClass', slug: 'masterclass', category: 'Education', defaultPrice: 1000, defaultCurrency: 'USD' },
  { name: 'Udemy', slug: 'udemy', category: 'Education' },
  { name: 'Brilliant', slug: 'brilliant', category: 'Education', defaultPrice: 1249, defaultCurrency: 'USD' },

  // --- News & Reading ---
  { name: 'Medium', slug: 'medium', category: 'Reading', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'The New York Times', slug: 'newyorktimes', category: 'Reading', defaultPrice: 1700, defaultCurrency: 'USD' },
  { name: 'Kindle Unlimited', slug: 'amazon', category: 'Reading', defaultPrice: 1199, defaultCurrency: 'USD' },
  { name: 'Audible', slug: 'audible', category: 'Reading', defaultPrice: 1495, defaultCurrency: 'USD' },
  { name: 'Apple News+', slug: 'apple', category: 'Reading', defaultPrice: 1299, defaultCurrency: 'USD' },
  { name: 'The Economist', slug: 'economist', category: 'Reading', defaultPrice: 1400, defaultCurrency: 'USD' },
  { name: 'Feedly Pro', slug: 'feedly', category: 'Reading', defaultPrice: 600, defaultCurrency: 'USD' },

  // --- Fitness ---
  { name: 'Strava Premium', slug: 'strava', category: 'Fitness', defaultPrice: 1199, defaultCurrency: 'USD' },
  { name: 'Peloton', slug: 'peloton', category: 'Fitness', defaultPrice: 1299, defaultCurrency: 'USD' },
  { name: 'Headspace', slug: 'headspace', category: 'Fitness', defaultPrice: 1299, defaultCurrency: 'USD' },
  { name: 'Calm', slug: 'calm', category: 'Fitness', defaultPrice: 1499, defaultCurrency: 'USD' },
  { name: 'Apple Fitness+', slug: 'apple', category: 'Fitness', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Fitbit Premium', slug: 'fitbit', category: 'Fitness', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Nike Training', slug: 'nike', category: 'Fitness' },

  // --- Shopping & Delivery ---
  { name: 'Amazon Prime', slug: 'amazon', category: 'Shopping', defaultPrice: 1499, defaultCurrency: 'USD' },
  { name: 'DoorDash DashPass', slug: 'doordash', category: 'Shopping', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Uber Eats Pass', slug: 'ubereats', category: 'Shopping', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Instacart+', slug: 'instacart', category: 'Shopping', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Shopify', slug: 'shopify', category: 'Shopping', defaultPrice: 2900, defaultCurrency: 'USD' },

  // --- Finance ---
  { name: 'TradingView', slug: 'tradingview', category: 'Finance', defaultPrice: 1495, defaultCurrency: 'USD' },
  { name: 'Robinhood Gold', slug: 'robinhood', category: 'Finance', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'Coinbase One', slug: 'coinbase', category: 'Finance', defaultPrice: 2999, defaultCurrency: 'USD' },
  { name: 'Revolut Premium', slug: 'revolut', category: 'Finance', defaultPrice: 999, defaultCurrency: 'USD' },

  // --- Design & Creative ---
  { name: 'Adobe Creative Cloud', slug: 'adobe', category: 'Design', defaultPrice: 5999, defaultCurrency: 'USD' },
  { name: 'Adobe Photoshop', slug: 'adobephotoshop', category: 'Design', defaultPrice: 2299, defaultCurrency: 'USD' },
  { name: 'Adobe Lightroom', slug: 'adobelightroom', category: 'Design', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Adobe Premiere Pro', slug: 'adobepremierepro', category: 'Design', defaultPrice: 2299, defaultCurrency: 'USD' },
  { name: 'Figma', slug: 'figma', category: 'Design', defaultPrice: 1500, defaultCurrency: 'USD' },
  { name: 'Sketch', slug: 'sketch', category: 'Design', defaultPrice: 1000, defaultCurrency: 'USD' },
  { name: 'Framer', slug: 'framer', category: 'Design', defaultPrice: 500, defaultCurrency: 'USD' },
  { name: 'CapCut Pro', slug: 'capcut', category: 'Design', defaultPrice: 999, defaultCurrency: 'USD' },

  // --- Email & Privacy ---
  { name: 'Proton Mail', slug: 'protonmail', category: 'Email', defaultPrice: 399, defaultCurrency: 'USD' },
  { name: 'Google Workspace', slug: 'google', category: 'Email', defaultPrice: 600, defaultCurrency: 'USD' },
  { name: 'Fastmail', slug: 'fastmail', category: 'Email', defaultPrice: 300, defaultCurrency: 'USD' },

  // --- Dating ---
  { name: 'Tinder', slug: 'tinder', category: 'Dating', defaultPrice: 999, defaultCurrency: 'USD' },
  { name: 'Bumble Premium', slug: 'bumble', category: 'Dating', defaultPrice: 1699, defaultCurrency: 'USD' },
  { name: 'Hinge', slug: 'hinge', category: 'Dating', defaultPrice: 2999, defaultCurrency: 'USD' },

  // --- China Specific ---
  { name: 'Zhihu Salt', slug: 'zhihu', category: 'China', defaultPrice: 2500, defaultCurrency: 'CNY' },
  { name: 'Xiaohongshu', slug: 'xiaohongshu', category: 'China' },
  { name: 'Weibo VIP', slug: 'sinaweibo', category: 'China', defaultPrice: 1200, defaultCurrency: 'CNY' },
  { name: 'Meituan', slug: 'meituan', category: 'China' },
  { name: 'Taobao 88VIP', slug: 'taobao', category: 'China', defaultPrice: 7400, defaultCurrency: 'CNY' },
  { name: 'JD PLUS', slug: 'jd', category: 'China', defaultPrice: 1242, defaultCurrency: 'CNY' },
  { name: 'Ele.me', slug: 'eleme', category: 'China', defaultPrice: 1500, defaultCurrency: 'CNY' },
  { name: 'WeChat', slug: 'wechat', category: 'China' },
  { name: 'Alipay', slug: 'alipay', category: 'China' },

  // --- Asia Specific ---
  { name: 'LINE', slug: 'line', category: 'Asia' },
  { name: 'KakaoTalk', slug: 'kakaotalk', category: 'Asia' },
  { name: 'Grab', slug: 'grab', category: 'Asia' },
  { name: 'Gojek', slug: 'gojek', category: 'Asia' },
  { name: 'Shopee', slug: 'shopee', category: 'Asia' },
  { name: 'Coupang', slug: 'coupang', category: 'Asia', defaultPrice: 499, defaultCurrency: 'USD' },
]

export const CATEGORIES = [...new Set(POPULAR_SERVICES.map((s) => s.category))]
