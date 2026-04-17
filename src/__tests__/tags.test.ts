import { describe, it, expect, beforeEach } from 'vitest'
import {
  tagSchema,
  tagArraySchema,
} from '@/lib/validators'
import { filterTagsForViewer, normalizeTags } from '@/lib/tags'
import type { SubscriptionTag } from '@/types/tags'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleUpdateSubscription,
} from '@/lib/api-handlers'
import { getSubscriptionsForUser } from '@/lib/db-operations'

describe('tagSchema', () => {
  it('accepts a valid public tag', () => {
    expect(tagSchema.safeParse({ label: 'Visa 1234', visibility: 'public' }).success).toBe(true)
  })

  it('accepts a valid private tag', () => {
    expect(tagSchema.safeParse({ label: '家庭', visibility: 'private' }).success).toBe(true)
  })

  it('rejects empty label', () => {
    expect(tagSchema.safeParse({ label: '', visibility: 'public' }).success).toBe(false)
  })

  it('rejects label over 10 chars', () => {
    expect(tagSchema.safeParse({ label: '12345678901', visibility: 'public' }).success).toBe(false)
  })

  it('rejects invalid visibility', () => {
    expect(
      tagSchema.safeParse({ label: 'ok', visibility: 'secret' as unknown as 'public' }).success
    ).toBe(false)
  })
})

describe('tagArraySchema', () => {
  it('accepts empty array', () => {
    expect(tagArraySchema.safeParse([]).success).toBe(true)
  })

  it('accepts 5 tags', () => {
    const tags = Array.from({ length: 5 }, (_, i) => ({
      label: `tag${i}`,
      visibility: 'public' as const,
    }))
    expect(tagArraySchema.safeParse(tags).success).toBe(true)
  })

  it('rejects 6 tags', () => {
    const tags = Array.from({ length: 6 }, (_, i) => ({
      label: `tag${i}`,
      visibility: 'public' as const,
    }))
    expect(tagArraySchema.safeParse(tags).success).toBe(false)
  })
})

describe('filterTagsForViewer', () => {
  const tags: SubscriptionTag[] = [
    { label: 'Family', visibility: 'public' },
    { label: 'Visa 1234', visibility: 'private' },
    { label: 'Work', visibility: 'public' },
  ]

  it('privileged viewer sees all tags', () => {
    expect(filterTagsForViewer(tags, true)).toEqual(tags)
  })

  it('non-privileged viewer sees only public tags', () => {
    expect(filterTagsForViewer(tags, false)).toEqual([
      { label: 'Family', visibility: 'public' },
      { label: 'Work', visibility: 'public' },
    ])
  })

  it('handles null/undefined tags gracefully', () => {
    expect(filterTagsForViewer(null as unknown as SubscriptionTag[], false)).toEqual([])
    expect(filterTagsForViewer(undefined as unknown as SubscriptionTag[], false)).toEqual([])
  })

  it('returns empty array when no tags exist', () => {
    expect(filterTagsForViewer([], true)).toEqual([])
  })
})

describe('handleUpdateSubscription tag permissions', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  async function setupPayerNotOwner() {
    // A creates the sub (becomes owner); B is a member and payer.
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
    const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
      payerId: b,
    })
    if (!created.success) throw new Error(created.error)
    return { ownerId: a, payerId: b, outsiderId: c, subId: created.data!.id }
  }

  it('payer (not owner) can update tags-only payload', async () => {
    const { payerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, payerId, subId, {
      tags: [{ label: 'Visa 1234', visibility: 'private' }],
    })
    expect(res.success).toBe(true)
  })

  it('payer (not owner) cannot update non-tag fields alongside tags', async () => {
    const { payerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, payerId, subId, {
      tags: [{ label: 'Visa 1234', visibility: 'private' }],
      name: 'Netflix Plus',
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('payer (not owner) cannot update non-tag fields alone', async () => {
    const { payerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, payerId, subId, {
      name: 'Netflix Plus',
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('non-member/non-owner/non-payer cannot update tags', async () => {
    const { outsiderId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, outsiderId, subId, {
      tags: [{ label: 'evil', visibility: 'public' }],
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('owner (who is not payer) can update tags', async () => {
    const { ownerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, ownerId, subId, {
      tags: [{ label: 'Family', visibility: 'public' }],
    })
    expect(res.success).toBe(true)
  })

  it('owner-not-payer sees private tags in list response (prevents overwrite bug)', async () => {
    const { ownerId, payerId, subId } = await setupPayerNotOwner()
    // Payer writes a private tag.
    await handleUpdateSubscription(db, payerId, subId, {
      tags: [
        { label: 'Family', visibility: 'public' },
        { label: 'Visa 1234', visibility: 'private' },
      ],
    })
    // Owner (different user) reads the list — must also see private tag,
    // otherwise editing would silently wipe the payer's private tag.
    const ownerSubs = await getSubscriptionsForUser(db, ownerId)
    const s = ownerSubs.find((x) => x.id === subId)
    expect(s?.tags).toEqual([
      { label: 'Family', visibility: 'public' },
      { label: 'Visa 1234', visibility: 'private' },
    ])
  })

  it('regular member does not see private tags in list response', async () => {
    const a = await createUser(db, { email: 'a2@t.com', currency: 'CNY' })
    const b = await createUser(db, { email: 'b2@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      members: [b],
      tags: [
        { label: 'Family', visibility: 'public' },
        { label: 'Visa 1234', visibility: 'private' },
      ],
    })
    if (!created.success) throw new Error(created.error)
    const bSubs = await getSubscriptionsForUser(db, b)
    const s = bSubs.find((x) => x.id === created.data!.id)
    expect(s?.tags).toEqual([{ label: 'Family', visibility: 'public' }])
  })
})

describe('tagSchema whitespace handling', () => {
  it('rejects whitespace-only label (not silent drop)', () => {
    expect(tagSchema.safeParse({ label: '   ', visibility: 'public' }).success).toBe(false)
  })

  it('trims leading/trailing whitespace', () => {
    const parsed = tagSchema.parse({ label: '  Family  ', visibility: 'public' })
    expect(parsed.label).toBe('Family')
  })
})

describe('normalizeTags', () => {
  it('trims whitespace and drops empty labels', () => {
    const input = [
      { label: '  Family  ', visibility: 'public' as const },
      { label: '   ', visibility: 'private' as const },
    ]
    expect(normalizeTags(input)).toEqual([
      { label: 'Family', visibility: 'public' },
    ])
  })

  it('de-duplicates by label (case-insensitive) keeping first', () => {
    const input = [
      { label: 'Family', visibility: 'public' as const },
      { label: 'family', visibility: 'private' as const },
    ]
    expect(normalizeTags(input)).toEqual([
      { label: 'Family', visibility: 'public' },
    ])
  })

  it('caps at 5 tags', () => {
    const input = Array.from({ length: 7 }, (_, i) => ({
      label: `t${i}`,
      visibility: 'public' as const,
    }))
    expect(normalizeTags(input)).toHaveLength(5)
  })

  it('returns [] for null/undefined input', () => {
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags(undefined)).toEqual([])
  })
})
