import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  leaveSubscription,
  getActiveMembersAt,
} from '@/lib/db-operations'

let db: Awaited<ReturnType<typeof setupTestDb>>['db']
let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']

beforeEach(async () => {
  const setup = await setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T6 getActiveMembersAt', () => {
  async function setup3() {
    const a = await createUser(db, { email: 'a@t.com' })
    const b = await createUser(db, { email: 'b@t.com' })
    const c = await createUser(db, { email: 'c@t.com' })
    const sub = await createSubscription(db, {
      name: 'Netflix',
      price: 15000,
      currency: 'CNY',
      nextPayment: '2026-06-01',
      startDate: '2026-03-01', // A has been on this sub since March
      ownerId: a,
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      addedBy: a,
      addedAt: '2026-04-01',
    })
    await addMemberToSubscription(db, {
      subscriptionId: sub.id,
      userId: c,
      addedBy: a,
      addedAt: '2026-04-15',
    })
    return { a, b, c, sub }
  }

  it('includes members whose addedAt <= atDate', async () => {
    const { a, b, sub } = await setup3()
    // On April 1st, only A (owner) and B are active.
    const members = await getActiveMembersAt(db, sub.id, '2026-04-01')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, b].sort())
  })

  it('includes member added exactly on atDate (boundary)', async () => {
    const { a, b, c, sub } = await setup3()
    // April 15 — C joins; should be included that very day.
    const members = await getActiveMembersAt(db, sub.id, '2026-04-15')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, b, c].sort())
  })

  it('excludes members whose leftAt <= atDate', async () => {
    const { a, b, c, sub } = await setup3()
    // B joined 4/1 so R2 minimum = 4/30. Leave 5/10 is past minimum
    // (passes through unchanged). On 5/11, only A and C remain.
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-05-10',
    })
    const members = await getActiveMembersAt(db, sub.id, '2026-05-11')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, c].sort())
  })

  it('excludes a member on their leftAt date (half-open interval)', async () => {
    const { a, b, c, sub } = await setup3()
    await leaveSubscription(db, {
      subscriptionId: sub.id,
      userId: b,
      leftAt: '2026-05-10',
    })
    // Half-open [addedAt, leftAt): B is gone at May 10 per spec R1
    // (left_at > atDate required to be active). Matches cron-on-the-1st
    // semantics where a kick on M_start must not produce an R1 bill.
    const members = await getActiveMembersAt(db, sub.id, '2026-05-10')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toEqual([a, c].sort())
  })

  it('excludes members whose addedAt is AFTER atDate', async () => {
    const { a, b, c, sub } = await setup3()
    // April 10 — A (joined Mar 1) and B (joined Apr 1) are in;
    // C (joined Apr 15) is NOT in yet.
    const members = await getActiveMembersAt(db, sub.id, '2026-04-10')
    const ids = members.map((m) => m.userId).sort()
    expect(ids).toContain(a)
    expect(ids).toContain(b)
    expect(ids).not.toContain(c)
  })

  it('returns empty array when subscription has no members', async () => {
    const members = await getActiveMembersAt(db, 9999, '2026-04-15')
    expect(members).toEqual([])
  })

  it('returns members with addedAt and payer flag consistent with schema', async () => {
    const { sub } = await setup3()
    const members = await getActiveMembersAt(db, sub.id, '2026-04-15')
    for (const m of members) {
      expect(m.userId).toBeTypeOf('number')
      expect(m.addedAt).toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })
})
