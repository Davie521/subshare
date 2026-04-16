import type { NextRequest } from 'next/server'

function firstCsv(h: string | null): string | null {
  if (!h) return null
  return h.split(',')[0]?.trim() || null
}

function isBadHost(host: string): boolean {
  return /^0\.0\.0\.0(:|$)/.test(host)
}

// Strict whitelist: letters/digits/dots/hyphens, optional :port.
// Rejects "@", "/", whitespace, quotes and other characters that could
// smuggle a different origin through the URL constructor.
function isValidHost(host: string): boolean {
  return /^[a-zA-Z0-9.\-]+(:\d+)?$/.test(host)
}

function isValidProto(proto: string): boolean {
  return proto === 'http' || proto === 'https'
}

/**
 * Build an absolute URL for a same-origin redirect.
 *
 * Next.js standalone binds to HOSTNAME=0.0.0.0 on Railway, so NextRequest.url
 * carries the container's bind address, not the public URL. Reading the
 * X-Forwarded-* headers that the edge proxy sets lets us reconstruct the real
 * origin the browser is talking to.
 *
 * `path` must be a same-origin path starting with "/", otherwise callers
 * could accidentally build a cross-origin redirect.
 */
export function resolveRequestUrl(req: NextRequest, path: string): URL {
  if (!path.startsWith('/')) {
    throw new Error(`resolveRequestUrl: path must start with "/", got "${path}"`)
  }

  const proto = firstCsv(req.headers.get('x-forwarded-proto'))
  const fwdHost = firstCsv(req.headers.get('x-forwarded-host'))
  const host = fwdHost ?? req.headers.get('host')

  if (
    proto &&
    host &&
    isValidProto(proto) &&
    isValidHost(host) &&
    !isBadHost(host)
  ) {
    try {
      return new URL(path, `${proto}://${host}`)
    } catch {
      // malformed, fall through
    }
  }

  try {
    const fromReq = new URL(path, req.url)
    if (!isBadHost(fromReq.host)) return fromReq
  } catch {
    // malformed req.url, fall through
  }

  const redirect = process.env.OAUTH_REDIRECT_URI
  if (redirect) {
    try {
      return new URL(path, new URL(redirect).origin)
    } catch {
      // malformed env, fall through
    }
  }

  // Last-resort: synthesise a localhost URL so the caller never receives
  // something that throws when stringified. Only reachable if every other
  // source is malformed, which in practice means a misconfigured test.
  return new URL(path, 'http://localhost')
}
