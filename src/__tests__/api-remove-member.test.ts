import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import {
  handleCreateSubscription,
  handleRemoveMember,
} from '@/lib/api-handlers'
import {
  getMembersOfSubscription,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
})

async function bootstrap() {
  const a = await createUser(db, { email: 'a@t.com', currency: 'CNY' })
  const b = await createUser(db, { email: 'b@t.com', currency: 'CNY' })
  const c = await createUser(db, { email: 'c@t.com', currency: 'CNY' })
  const res = await handleCreateSubscription(db, a, {
    name: 'Netflix',
    price: 10000,
    currency: 'CNY',
    nextPayment: '2026-05-01',
    members: [b, c],
  })
  if (!res.success) throw new Error(res.error)
  return { a, b, c, subId: res.data!.id }
}

describe('A3 handleRemoveMember', () => {
  it('self-leave: caller === targetUserId → silent leave', async () => {
    const { b, subId } = await bootstrap()

    const res = await handleRemoveMember(db, b, subId, b)
    expect(res.success).toBe(true)

    const active = (await getMembersOfSubscription(db, subId)).filter(
      (m) => m.leftAt === null
    )
    expect(active.map((m) => m.userId)).not.toContain(b)

    const kickNotifs = (await listNotifications(db, b)).filter(
      (n) => n.type === 'removed_from_sub'
    )
    expect(kickNotifs).toHaveLength(0) // self-leave silent
  })

  it('kick: owner removes another member → emits removed_from_sub', async () => {
    const { a, b, subId } = await bootstrap()

    const res = await handleRemoveMember(db, a, subId, b)
    expect(res.success).toBe(true)

    const kickNotifs = (await listNotifications(db, b)).filter(
      (n) => n.type === 'removed_from_sub'
    )
    expect(kickNotifs).toHaveLength(1)
  })

  it('kick denied: non-owner tries to kick another member → 403', async () => {
    const { b, c, subId } = await bootstrap()

    const res = await handleRemoveMember(db, b, subId, c)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/owner|permission/i)
  })

  it('payer cannot self-leave (R7)', async () => {
    const { a, subId } = await bootstrap()
    // A is both owner and payer.
    const res = await handleRemoveMember(db, a, subId, a)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/payer/i)
  })

  it('returns 404 when sub does not exist', async () => {
    const { a, b } = await bootstrap()
    const res = await handleRemoveMember(db, a, 9999, b)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/not found/i)
  })

  it('returns error when target is not a member', async () => {
    const { a, subId } = await bootstrap()
    const stranger = await createUser(db, { email: 'stranger@t.com' })
    const res = await handleRemoveMember(db, a, subId, stranger)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/member/i)
  })
})
