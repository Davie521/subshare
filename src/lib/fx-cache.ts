import { frankfurterResponseSchema } from './validators'

type Entry = { rate: number; fetchedAt: number }

const cache = new Map<string, Entry>()
const TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 3000

function cacheKey(from: string, to: string) {
  return `${from}_${to}`
}

export async function getRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1

  const key = cacheKey(from, to)
  const cached = cache.get(key)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.rate
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    )
    if (!res.ok) return cached?.rate ?? null
    const body = frankfurterResponseSchema.safeParse(await res.json())
    if (!body.success) return cached?.rate ?? null
    const rate = body.data.rates[to]
    if (!rate) return cached?.rate ?? null
    cache.set(key, { rate, fetchedAt: now })
    return rate
  } catch {
    return cached?.rate ?? null
  }
}
