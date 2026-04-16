import type { NextRequest } from 'next/server'

function firstCsv(h: string | null): string | null {
  if (!h) return null
  return h.split(',')[0]?.trim() || null
}

function isBadHost(host: string): boolean {
  return /^0\.0\.0\.0(:|$)/.test(host)
}

/**
 * Build an absolute URL for a same-origin redirect.
 *
 * Next.js standalone binds to HOSTNAME=0.0.0.0 on Railway, so NextRequest.url
 * carries the container's bind address, not the public URL. Reading the
 * X-Forwarded-* headers that the edge proxy sets lets us reconstruct the real
 * origin the browser is talking to.
 */
export function resolveRequestUrl(req: NextRequest, path: string): URL {
  const proto = firstCsv(req.headers.get('x-forwarded-proto'))
  const fwdHost = firstCsv(req.headers.get('x-forwarded-host'))
  const host = fwdHost ?? req.headers.get('host')

  if (proto && host && !isBadHost(host)) {
    return new URL(path, `${proto}://${host}`)
  }

  const fromReq = new URL(path, req.url)
  if (!isBadHost(fromReq.host)) return fromReq

  const redirect = process.env.OAUTH_REDIRECT_URI
  if (redirect) {
    try {
      return new URL(path, new URL(redirect).origin)
    } catch {
      // malformed env, fall through
    }
  }

  return fromReq
}
