import { eq, and, gte, ne, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { calculateLeaveProRata, recomputeLocalAmount, distributeDiff } from './billing'
import { insertNotification } from './notifications'
import { getActiveMembersAt, lockSubscription } from './db-operations'
import { createR2JoinBill } from './billing-ops'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

/* ──────────────────────────────────────────────────────────────────────
 * Member insert helpers
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Membership-insert status. `noop` means the user was already an active
 * member (re-invite is a no-op); `added` is a brand-new insert; `rejoin`
 * reuses the row after a prior leave (leftAt cleared, addedAt refreshed).
 */
export type MemberInsertStatus = 'added' | 'rejoin' | 'noop'

/**
 * Insert/update the subscription_members row for a single user and create
 * the friendship edge if needed. NO bill, NO notification — those belong
 * in the batch-aware `createR2JoinBill` so one call-site can compute
 * share against the FINAL member count rather than an intermediate one.
 */
async function insertSubscriptionMember(
  tx: DB,
  input: {
    subscriptionId: number
    userId: number
    addedBy: number
    addedAt: string
  }
): Promise<{ status: MemberInsertStatus; canonicalAddedAt: string | null }> {
  const [existingMember] = await tx
    .select({
      userId: schema.subscriptionMembers.userId,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )

  let status: MemberInsertStatus
  if (!existingMember) {
    status = 'added'
    await tx.insert(schema.subscriptionMembers).values({
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      addedBy: input.addedBy,
      addedAt: input.addedAt,
    })
  } else if (existingMember.leftAt !== null) {
    status = 'rejoin'
    await tx
      .update(schema.subscriptionMembers)
      .set({
        addedAt: input.addedAt,
        addedBy: input.addedBy,
        leftAt: null,
        // Fresh stint — clear the previous stint's personal tags.
        personalTags: [],
      })
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
          eq(schema.subscriptionMembers.userId, input.userId)
        )
      )
  } else {
    status = 'noop'
  }

  // Auto-create friendship between inviter and invitee (T7). Self-adds
  // (owner-insert) produce no friendship.
  if (input.addedBy !== input.userId) {
    const [lo, hi] =
      input.addedBy < input.userId
        ? [input.addedBy, input.userId]
        : [input.userId, input.addedBy]
    await tx
      .insert(schema.friendships)
      .values({ userAId: lo, userBId: hi })
      .onConflictDoNothing()
  }

  // Canonical addedAt lives in the DB: either the just-inserted row
  // (first-time) or the row we just UPDATEd (rejoin). For active-noop
  // members it's the existing row — downstream skips billing anyway,
  // so the value isn't used.
  const [memberRow] = await tx
    .select({ addedAt: schema.subscriptionMembers.addedAt })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
        eq(schema.subscriptionMembers.userId, input.userId)
      )
    )
  return { status, canonicalAddedAt: memberRow?.addedAt ?? null }
}

/* ──────────────────────────────────────────────────────────────────────
 * Batch add
 * ────────────────────────────────────────────────────────────────────── */

export interface AddMembersResult {
  perInvitee: Array<{
    userId: number
    status: MemberInsertStatus
  }>
}

/**
 * Batch-add multiple users to a subscription as a single atomic
 * operation. This is the RIGHT API for anything that onboards N > 1
 * invitees at once (handleAddMembers, handleCreateSubscription): because
 * all R2 bills are generated AFTER every member is inserted, every
 * invitee's share is computed against the SAME final memberCount and
 * their R2 amounts match.
 *
 * Single-invitee call sites (invite-token acceptance, etc.) can keep
 * using the `addMemberToSubscription` wrapper below.
 */
export async function addMembersToSubscription(
  db: DB,
  input: {
    subscriptionId: number
    invitees: number[]
    addedBy: number
    addedAt: string // ISO YYYY-MM-DD
  },
  rates: Record<string, number> = {}
): Promise<AddMembersResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.addedAt)) {
    throw new Error(
      `addedAt must be ISO date YYYY-MM-DD, got "${input.addedAt}"`
    )
  }

  const dedup = Array.from(new Set(input.invitees))
  if (dedup.length === 0) return { perInvitee: [] }

  return db.transaction(async (tx) => {
    // Single lock for the whole batch — everyone in this call sees the
    // same membership snapshot.
    await lockSubscription(tx, input.subscriptionId)

    type Pending = {
      userId: number
      status: MemberInsertStatus
      canonicalAddedAt: string | null
    }
    const pending: Pending[] = []
    for (const uid of dedup) {
      const res = await insertSubscriptionMember(tx, {
        subscriptionId: input.subscriptionId,
        userId: uid,
        addedBy: input.addedBy,
        addedAt: input.addedAt,
      })
      pending.push({ userId: uid, ...res })
    }

    // All members inserted. Fetch the sub + final member count ONCE so
    // every R2 bill uses the same share.
    const [sub] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, input.subscriptionId))

    if (sub) {
      // canonicalAddedAt is the same value for every freshly-inserted
      // invitee in this batch (they share `input.addedAt`), so any non-
      // noop pending entry works for the member-count snapshot date.
      const snapshotDate =
        pending.find((p) => p.status !== 'noop')?.canonicalAddedAt ??
        input.addedAt
      const activeMembers = await getActiveMembersAt(
        tx,
        input.subscriptionId,
        snapshotDate
      )
      const memberCount = activeMembers.length

      for (const p of pending) {
        if (p.status === 'noop') continue
        if (!p.canonicalAddedAt) continue
        await createR2JoinBill(tx, {
          sub,
          userId: p.userId,
          addedBy: input.addedBy,
          canonicalAddedAt: p.canonicalAddedAt,
          memberCount,
          rates,
          status: p.status,
        })
      }
    }

    return {
      perInvitee: pending.map((p) => ({ userId: p.userId, status: p.status })),
    }
  })
}

/**
 * Single-user convenience wrapper over `addMembersToSubscription`.
 * Kept for call sites that naturally only add one person at a time
 * (invite-token acceptance, seed scripts).
 */
export async function addMemberToSubscription(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    addedBy: number
    addedAt: string
  },
  rates: Record<string, number> = {}
): Promise<void> {
  await addMembersToSubscription(
    db,
    {
      subscriptionId: input.subscriptionId,
      invitees: [input.userId],
      addedBy: input.addedBy,
      addedAt: input.addedAt,
    },
    rates
  )
}

/* ──────────────────────────────────────────────────────────────────────
 * Leave / kick
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Remove a member from a subscription. Sets left_at on the membership row.
 * Generates NO billing records (R3 — pre-paid, no refund).
 * Rejects when the leaving user is the payer (R7) — transfer first.
 * Idempotent: re-calling on an already-left member is a no-op (keeps
 * the original leftAt so accounting history is stable).
 */
export async function leaveSubscription(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    leftAt: string // ISO date YYYY-MM-DD
    actorId?: number // defaults to userId (self-leave)
  }
): Promise<void> {
  const actorId = input.actorId ?? input.userId
  const isKick = actorId !== input.userId

  const [sub] = await db
    .select({
      name: schema.subscriptions.name,
      payerId: schema.subscriptions.payerId,
      price: schema.subscriptions.price,
      refundPolicy: schema.subscriptions.refundPolicy,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, input.subscriptionId))

  if (!sub) throw new Error('Subscription not found')

  if (sub.payerId === input.userId) {
    throw new Error(
      'Payer cannot leave — transfer payer to another member first'
    )
  }

  // No minimum-cycle commitment — members can leave at any time and only
  // pay for the days they actually used (calculateLeaveProRata below).
  const leftAt = input.leftAt

  // Atomic: leftAt + bill prorate + redistribute + notification must all
  // succeed or all roll back, otherwise a mid-flight crash can leave the
  // leaver off the sub but their unpaid bill not prorated.
  //
  // The membership row lookup + idempotence check live INSIDE the tx,
  // AFTER lockSubscription, so two concurrent leave/kick calls can't both
  // observe leftAt=NULL and race to overwrite each other's leftAt /
  // re-run proration. Losers see the updated row and early-return.
  await db.transaction(async (tx) => {
    await lockSubscription(tx, input.subscriptionId)

    const [row] = await tx
      .select({
        leftAt: schema.subscriptionMembers.leftAt,
        addedAt: schema.subscriptionMembers.addedAt,
      })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
          eq(schema.subscriptionMembers.userId, input.userId)
        )
      )

    if (!row) throw new Error('User is not a member of this subscription')
    if (row.leftAt !== null) return // idempotent — first leftAt wins

    await tx
      .update(schema.subscriptionMembers)
      .set({ leftAt })
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, input.subscriptionId),
          eq(schema.subscriptionMembers.userId, input.userId)
        )
      )

    // Rewrite the leaver's unpaid bill for the current month to reflect
    // only the days they actually used.  Paid bills stay locked.
    // `stintStart` is this stint's addedAt — bills from earlier stints (in
    // a rejoin scenario) have billingDate < stintStart and must not be
    // touched, since they were already prorated when the earlier stint ended.
    await prorateLeaverBill(tx, {
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      payerId: sub.payerId,
      leftAt,
      stintStart: row.addedAt,
      refundPolicy: sub.refundPolicy as 'payer_absorbs' | 'redistribute',
      subPrice: sub.price,
      subName: sub.name,
    })

    if (isKick) {
      const [actor] = await tx
        .select({
          name: schema.users.name,
          displayName: schema.users.displayName,
        })
        .from(schema.users)
        .where(eq(schema.users.id, actorId))

      await insertNotification(tx, {
        userId: input.userId,
        type: 'removed_from_sub',
        subscriptionId: input.subscriptionId,
        payload: {
          sub_name: sub.name,
          actor_name: actor?.displayName || actor?.name || 'Someone',
        },
      })
    }
  })
}

/**
 * Rewrite the leaver's current-month unpaid bill(s) to charge only for
 * the days they actually used. If the resulting amount is zero, delete
 * the bill outright. If the subscription's `refund_policy` is
 * 'redistribute', the diff is split across the remaining unpaid
 * non-payer members' bills in the same month (falls back silently to
 * 'payer_absorbs' if no such member exists).
 */
async function prorateLeaverBill(
  db: DB,
  input: {
    subscriptionId: number
    userId: number
    payerId: number
    leftAt: string
    stintStart: string
    refundPolicy: 'payer_absorbs' | 'redistribute'
    subPrice: number
    subName: string
  }
): Promise<void> {
  const [y, m, d] = input.leftAt.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const monthEndExclusive = (() => {
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    return `${ny}-${String(nm).padStart(2, '0')}-01`
  })()
  // Earlier-stint bills have billingDate < stintStart — already locked from
  // when that stint ended, must not be re-prorated here.
  const floor = input.stintStart > monthStart ? input.stintStart : monthStart

  const bills = await db
    .select({
      id: schema.billingRecords.id,
      amount: schema.billingRecords.amount,
      localAmount: schema.billingRecords.localAmount,
      exchangeRate: schema.billingRecords.exchangeRate,
      billingDate: schema.billingRecords.billingDate,
    })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, input.subscriptionId),
        eq(schema.billingRecords.userId, input.userId),
        eq(schema.billingRecords.isPaid, false),
        gte(schema.billingRecords.billingDate, floor),
        sql`${schema.billingRecords.billingDate} < ${monthEndExclusive}`
      )
    )

  for (const bill of bills) {
    const cycleStartDay = Number(bill.billingDate.slice(8, 10))
    // R1 bills cover the whole month; R2 bills cover join..month-end.
    // bill.amount already reflects this coverage; we prorate against it
    // directly rather than reconstructing the original share.
    const coverageDays = daysInMonth - cycleStartDay + 1

    let usageDays = d - cycleStartDay
    // Last-day leave = full coverage (user-specified override).
    if (d >= daysInMonth) usageDays = coverageDays

    const newAmount = calculateLeaveProRata(bill.amount, usageDays, coverageDays)

    if (newAmount === 0) {
      await db
        .delete(schema.billingRecords)
        .where(eq(schema.billingRecords.id, bill.id))
      continue
    }
    if (newAmount === bill.amount) continue // usage ≥ coverage — nothing to adjust

    const newLocalAmount = recomputeLocalAmount(newAmount, bill.exchangeRate)
    const diffAmount = bill.amount - newAmount
    const diffLocalAmount = bill.localAmount - newLocalAmount

    await db
      .update(schema.billingRecords)
      .set({ amount: newAmount, localAmount: newLocalAmount })
      .where(eq(schema.billingRecords.id, bill.id))

    if (input.refundPolicy !== 'redistribute' || diffAmount <= 0) continue

    await redistributeRefund(db, {
      subscriptionId: input.subscriptionId,
      leaverId: input.userId,
      payerId: input.payerId,
      subName: input.subName,
      monthStart,
      monthEndExclusive,
      diffAmount,
      diffLocalAmount,
    })
  }
}

/**
 * Spread a leaver's refunded diff (R3 output) across every other unpaid
 * non-payer bill in the same calendar month (R11 redistribute). The
 * diff and its localAmount counterpart are split via round-robin so the
 * total is exactly conserved. Each bumped bill triggers a
 * `bill_adjusted` notification.
 *
 * Caller guarantees `diffAmount > 0` and that the transaction already
 * holds a row lock on the subscription.
 */
async function redistributeRefund(
  db: DB,
  input: {
    subscriptionId: number
    leaverId: number
    payerId: number
    subName: string
    monthStart: string
    monthEndExclusive: string
    diffAmount: number
    diffLocalAmount: number
  }
): Promise<void> {
  const others = await db
    .select({
      id: schema.billingRecords.id,
      amount: schema.billingRecords.amount,
      localAmount: schema.billingRecords.localAmount,
      localCurrency: schema.billingRecords.localCurrency,
      userId: schema.billingRecords.userId,
    })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, input.subscriptionId),
        eq(schema.billingRecords.isPaid, false),
        gte(schema.billingRecords.billingDate, input.monthStart),
        sql`${schema.billingRecords.billingDate} < ${input.monthEndExclusive}`,
        ne(schema.billingRecords.userId, input.leaverId),
        // Defensive: payer should never have billing_records per R8, but
        // exclude explicitly so a stray row can't be inadvertently topped up.
        ne(schema.billingRecords.userId, input.payerId)
      )
    )

  if (others.length === 0) return

  const extras = distributeDiff(input.diffAmount, others.length)
  const extrasLocal = distributeDiff(input.diffLocalAmount, others.length)

  for (let i = 0; i < others.length; i++) {
    const o = others[i]
    const extra = extras[i]
    const extraLocal = extrasLocal[i]

    await db
      .update(schema.billingRecords)
      .set({
        amount: o.amount + extra,
        localAmount: o.localAmount + extraLocal,
      })
      .where(eq(schema.billingRecords.id, o.id))

    if (extra > 0) {
      await insertNotification(db, {
        userId: o.userId,
        type: 'bill_adjusted',
        subscriptionId: input.subscriptionId,
        payload: {
          sub_name: input.subName,
          delta_amount: extra,
          delta_local_amount: extraLocal,
          local_currency: o.localCurrency,
          reason: 'member_left',
        },
      })
    }
  }
}
