import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  transferPayer,
} from '@/lib/db-operations'
import { listNotifications } from '@/lib/notifications'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

async function setup3() {
  const a = await createUser(db, { name: 'Alice', email: 'a@t.com' })
  const b = await createUser(db, { name: 'Bob', email: 'b@t.com' })
  const c = await createUser(db, { name: 'Carol', email: 'c@t.com' })
  const sub = await createSubscription(db, {
    name: 'Netflix',
    price: 15000,
    currency: 'CNY',
    nextPayment: '2026-06-01',
    startDate: '2026-03-01',
    ownerId: a,
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: b,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  await addMemberToSubscription(db, {
    subscriptionId: sub.id,
    userId: c,
    addedBy: a,
    addedAt: '2026-03-10',
  })
  return { a, b, c, sub }
}

describe('T13 transferPayer', () => {
  it('updates subscriptions.payer_id', async () => {
    const { b, sub } = await setup3()
    await transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const row = await sqlite.prepare('SELECT payer_id FROM subscriptions WHERE id = ?')
      .get(sub.id) as { payer_id: number }
    expect(row.payer_id).toBe(b)
  })

  it('emits payer_changed to ALL active members (including old and new payer)', async () => {
    const { a, b, c, sub } = await setup3()
    await transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const payerNotifs = async (uid: number) => (await listNotifications(db, uid)).filter((n) => n.type === 'payer_changed')

    expect(await payerNotifs(a)).toHaveLength(1) // old payer gets told
    expect(await payerNotifs(b)).toHaveLength(1) // new payer gets told
    expect(await payerNotifs(c)).toHaveLength(1) // member gets told
  })

  it('notification payload has both old and new payer names', async () => {
    const { b, c, sub } = await setup3()
    await transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const n = (await listNotifications<{
      sub_name: string
      old_payer_name: string
      new_payer_name: string
    }>(db, c)).find((x) => x.type === 'payer_changed')!

    expect(n.payload.sub_name).toBe('Netflix')
    expect(n.payload.old_payer_name).toBeDefined()
    expect(n.payload.new_payer_name).toBeDefined()
    expect(n.payload.old_payer_name).not.toBe(n.payload.new_payer_name)
  })

  it('rejects when newPayerId is not an active member', async () => {
    const { sub } = await setup3()
    const stranger = await createUser(db, { email: 'stranger@t.com' })

    await expect(transferPayer(db, { subscriptionId: sub.id, newPayerId: stranger })
    ).rejects.toThrow(/member/i)
  })

  it('rejects when newPayerId equals current payer (no-op guard)', async () => {
    const { a, sub } = await setup3()
    await expect(transferPayer(db, { subscriptionId: sub.id, newPayerId: a })
    ).rejects.toThrow(/already/i)
  })

  it('after transfer, new payer is excluded from monthly bills', async () => {
    const { a, b, c, sub } = await setup3()
    await transferPayer(db, { subscriptionId: sub.id, newPayerId: b })

    const { generateMonthlyBills } = await import('@/lib/db-operations')
    await generateMonthlyBills(db, '2026-05')

    const ids = (
      await sqlite.prepare(
          `SELECT user_id AS "userId" FROM billing_records WHERE billing_date = '2026-05-01'`
        )
        .all() as { userId: number }[]
    ).map((r) => r.userId)

    expect(ids).toContain(a)
    expect(ids).toContain(c)
    expect(ids).not.toContain(b) // B is now payer
  })
})
