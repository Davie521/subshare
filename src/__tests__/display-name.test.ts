import { describe, it, expect } from 'vitest'
import { resolveDisplayName, aliasFor } from '@/lib/display-name'

describe('aliasFor', () => {
  it('returns "用户 #NNN" where NNN = id % 1000, zero-padded', async () => {
    expect(aliasFor(392)).toBe('用户 #392')
    expect(aliasFor(7)).toBe('用户 #007')
    expect(aliasFor(42)).toBe('用户 #042')
  })

  it('wraps large ids modulo 1000', async () => {
    expect(aliasFor(1392)).toBe('用户 #392')
    expect(aliasFor(50000)).toBe('用户 #000')
  })

  it('is deterministic for the same id', async () => {
    expect(aliasFor(5)).toBe(aliasFor(5))
  })
})

describe('resolveDisplayName', () => {
  const target = {
    id: 42,
    displayName: 'Alice',
    email: 'alice@example.com',
    showEmail: false,
  }

  it('returns real displayName when viewer === target', async () => {
    expect(resolveDisplayName(42, target, false)).toBe('Alice')
  })

  it('returns real displayName when isFriend=true', async () => {
    expect(resolveDisplayName(7, target, true)).toBe('Alice')
  })

  it('returns alias when isFriend=false and not self', async () => {
    expect(resolveDisplayName(7, target, false)).toBe('用户 #042')
  })

  it('friend + showEmail=true appends email', async () => {
    const targetWithEmail = { ...target, showEmail: true }
    expect(resolveDisplayName(7, targetWithEmail, true)).toBe(
      'Alice (alice@example.com)'
    )
  })

  it('showEmail=true but non-friend still gets alias only', async () => {
    const targetWithEmail = { ...target, showEmail: true }
    expect(resolveDisplayName(7, targetWithEmail, false)).toBe('用户 #042')
  })

  it('self view never shows email suffix', async () => {
    const me = { ...target, showEmail: true }
    expect(resolveDisplayName(42, me, true)).toBe('Alice')
  })

  it('falls back gracefully if displayName is empty', async () => {
    const unnamed = { ...target, displayName: '' }
    expect(resolveDisplayName(7, unnamed, true)).toBe('用户 #042')
  })
})
