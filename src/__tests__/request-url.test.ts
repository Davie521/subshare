import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resolveRequestUrl } from '@/lib/request-url'

function makeReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers })
}

describe('resolveRequestUrl', () => {
  const originalRedirect = process.env.OAUTH_REDIRECT_URI

  afterEach(() => {
    if (originalRedirect === undefined) {
      delete process.env.OAUTH_REDIRECT_URI
    } else {
      process.env.OAUTH_REDIRECT_URI = originalRedirect
    }
  })

  it('local dev: no forwarded headers, trusts req.url', () => {
    const req = makeReq('http://localhost:3000/api/auth/google/callback?code=x')
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.toString()).toBe('http://localhost:3000/dashboard')
  })

  it('Railway normal: x-forwarded-* override bad req.url origin', () => {
    const req = makeReq('http://0.0.0.0:8080/api/auth/google/callback?code=x', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'subshare-production.up.railway.app',
    })
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.toString()).toBe(
      'https://subshare-production.up.railway.app/dashboard'
    )
  })

  it('Railway with missing forwarded headers: falls back to OAUTH_REDIRECT_URI origin', () => {
    process.env.OAUTH_REDIRECT_URI =
      'https://subshare-production.up.railway.app/api/auth/google/callback'
    const req = makeReq('http://0.0.0.0:8080/api/auth/google/callback?code=x')
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.toString()).toBe(
      'https://subshare-production.up.railway.app/dashboard'
    )
  })

  it('CSV header from multi-hop proxy: takes first value', () => {
    const req = makeReq('http://0.0.0.0:8080/x', {
      'x-forwarded-proto': 'https,http',
      'x-forwarded-host': 'public.example.com, internal.lb',
    })
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.toString()).toBe('https://public.example.com/dashboard')
  })

  it('preserves query string in path argument', () => {
    const req = makeReq('http://localhost:3000/api/auth/google/callback', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'example.com',
    })
    const url = resolveRequestUrl(req, '/login?error=oauth_denied')
    expect(url.toString()).toBe('https://example.com/login?error=oauth_denied')
  })

  it('no forwarded headers, bad req.url host, no OAUTH_REDIRECT_URI: synthesises localhost as last resort (never leaks 0.0.0.0)', () => {
    delete process.env.OAUTH_REDIRECT_URI
    const req = makeReq('http://0.0.0.0:8080/x')
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.host).not.toMatch(/^0\.0\.0\.0/)
    expect(url.pathname).toBe('/dashboard')
  })

  it('uses host header when x-forwarded-host absent but proto present', () => {
    const req = makeReq('http://0.0.0.0:8080/x', {
      'x-forwarded-proto': 'https',
      host: 'example.com',
    })
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.toString()).toBe('https://example.com/dashboard')
  })

  it('malformed forwarded host: does not throw, falls back to OAUTH_REDIRECT_URI', () => {
    process.env.OAUTH_REDIRECT_URI =
      'https://subshare-production.up.railway.app/api/auth/google/callback'
    const req = makeReq('http://0.0.0.0:8080/x', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'bad host with spaces',
    })
    expect(() => resolveRequestUrl(req, '/dashboard')).not.toThrow()
    expect(resolveRequestUrl(req, '/dashboard').toString()).toBe(
      'https://subshare-production.up.railway.app/dashboard'
    )
  })

  it('host with embedded @ is rejected (open-redirect guard)', () => {
    process.env.OAUTH_REDIRECT_URI =
      'https://subshare-production.up.railway.app/api/auth/google/callback'
    const req = makeReq('http://0.0.0.0:8080/x', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'evil.com@subshare-production.up.railway.app',
    })
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.host).toBe('subshare-production.up.railway.app')
  })

  it('non-http(s) proto is rejected', () => {
    process.env.OAUTH_REDIRECT_URI =
      'https://subshare-production.up.railway.app/api/auth/google/callback'
    const req = makeReq('http://0.0.0.0:8080/x', {
      'x-forwarded-proto': 'javascript',
      'x-forwarded-host': 'example.com',
    })
    const url = resolveRequestUrl(req, '/dashboard')
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe('subshare-production.up.railway.app')
  })

  it('throws when path does not start with "/"', () => {
    const req = makeReq('http://localhost:3000/x')
    expect(() => resolveRequestUrl(req, 'dashboard')).toThrow(
      /must start with "\/"/
    )
    expect(() => resolveRequestUrl(req, 'https://evil.com/x')).toThrow(
      /must start with "\/"/
    )
  })
})
