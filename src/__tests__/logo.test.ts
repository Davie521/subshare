import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
} from '@/lib/validators'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleUpdateSubscription,
} from '@/lib/api-handlers'
import { getSubscriptionsForUser } from '@/lib/db-operations'

describe('logo validator (loosened)', () => {
  const valid = {
    name: 'Test',
    price: 1000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
  } as const

  it('accepts bare service key (manifest lookup)', () => {
    const r = createSubscriptionSchema.safeParse({ ...valid, logo: 'Netflix' })
    expect(r.success).toBe(true)
  })

  it('accepts /icons/ path (legacy)', () => {
    const r = createSubscriptionSchema.safeParse({
      ...valid,
      logo: '/icons/netflix.svg',
    })
    expect(r.success).toBe(true)
  })

  it('accepts https URL (legacy)', () => {
    const r = createSubscriptionSchema.safeParse({
      ...valid,
      logo: 'https://example.com/logo.png',
    })
    expect(r.success).toBe(true)
  })

  it('accepts null (reset path)', () => {
    const r = updateSubscriptionSchema.safeParse({ logo: null })
    expect(r.success).toBe(true)
  })

  it('rejects string over 100 chars', () => {
    const r = createSubscriptionSchema.safeParse({
      ...valid,
      logo: 'x'.repeat(101),
    })
    expect(r.success).toBe(false)
  })
})

describe('handleUpdateSubscription logo permissions', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  async function setupPayerNotOwner() {
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

  it('owner can update logo', async () => {
    const { ownerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, ownerId, subId, {
      logo: 'Spotify',
    })
    expect(res.success).toBe(true)
  })

  it('payer (not owner) can update logo-only payload', async () => {
    const { payerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, payerId, subId, {
      logo: 'Spotify',
    })
    expect(res.success).toBe(true)
  })

  it('payer cannot update logo alongside owner-only fields', async () => {
    const { payerId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, payerId, subId, {
      logo: 'Spotify',
      name: 'New Name',
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('outsider cannot update logo', async () => {
    const { outsiderId, subId } = await setupPayerNotOwner()
    const res = await handleUpdateSubscription(db, outsiderId, subId, {
      logo: 'Spotify',
    })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.code).toBe('FORBIDDEN')
  })

  it('logo can be reset to null', async () => {
    const { ownerId, subId } = await setupPayerNotOwner()
    await handleUpdateSubscription(db, ownerId, subId, { logo: 'Spotify' })
    const res = await handleUpdateSubscription(db, ownerId, subId, {
      logo: null,
    })
    expect(res.success).toBe(true)
    const subs = await getSubscriptionsForUser(db, ownerId)
    const s = subs.find((x) => x.id === subId)
    expect(s?.logo).toBeNull()
  })
})

describe('logo round-trip (create → read)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>['db']

  beforeEach(async () => {
    const setup = await setupTestDb()
    db = setup.db
  })

  it('create with logo=Netflix, rename name → logo unchanged on read', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'Netflix',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      logo: 'Netflix',
    })
    if (!created.success) throw new Error(created.error)
    // Rename
    await handleUpdateSubscription(db, a, created.data!.id, {
      name: '家用 Netflix',
    })
    const subs = await getSubscriptionsForUser(db, a)
    const s = subs.find((x) => x.id === created.data!.id)
    expect(s?.name).toBe('家用 Netflix')
    // Icon reference preserved — rename does not touch logo
    expect(s?.logo).toBe('Netflix')
  })

  it('create without logo (custom path) leaves logo null', async () => {
    const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
    const created = await handleCreateSubscription(db, a, {
      name: 'My Custom Service',
      price: 10000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
    })
    if (!created.success) throw new Error(created.error)
    const subs = await getSubscriptionsForUser(db, a)
    const s = subs.find((x) => x.id === created.data!.id)
    expect(s?.logo).toBeNull()
  })
})
