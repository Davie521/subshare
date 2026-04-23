import { eq, and, isNull, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { addMemberToSubscription } from './membership'
import { fetchRatesForUsers, type Result } from './api-handlers'
import { todayInAppTz } from './date-utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

const INVITE_TTL_DAYS = 7
const INVITE_DEFAULT_MAX_USES = 1

function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type InviteMetadata = {
  token: string
  subscriptionId: number
  subscriptionName: string
  subscriptionLogo: string | null
  inviterName: string
  expiresAt: string
  expired: boolean
  exhausted: boolean
  revoked: boolean
}

export async function createInvite(
  db: DB,
  actorId: number,
  subId: number
): Promise<Result<{ token: string; expiresAt: string }>> {
  const [sub] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  if (!sub) {
    return { success: false, error: 'Subscription not found', code: 'NOT_FOUND' }
  }

  const [member] = await db
    .select({ userId: schema.subscriptionMembers.userId })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subId),
        eq(schema.subscriptionMembers.userId, actorId),
        isNull(schema.subscriptionMembers.leftAt)
      )
    )
  if (!member) {
    return { success: false, error: 'Not a member', code: 'FORBIDDEN' }
  }

  const token = generateToken()
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  await db.insert(schema.invites).values({
    token,
    subscriptionId: subId,
    inviterId: actorId,
    expiresAt,
    maxUses: INVITE_DEFAULT_MAX_USES,
  })

  return { success: true, data: { token, expiresAt } }
}

export async function getInviteMetadata(
  db: DB,
  token: string
): Promise<Result<InviteMetadata>> {
  const [row] = await db
    .select({
      token: schema.invites.token,
      subscriptionId: schema.invites.subscriptionId,
      expiresAt: schema.invites.expiresAt,
      maxUses: schema.invites.maxUses,
      usedCount: schema.invites.usedCount,
      revokedAt: schema.invites.revokedAt,
      subName: schema.subscriptions.name,
      subLogo: schema.subscriptions.logo,
      inviterName: schema.users.name,
      inviterDisplayName: schema.users.displayName,
    })
    .from(schema.invites)
    .innerJoin(
      schema.subscriptions,
      eq(schema.subscriptions.id, schema.invites.subscriptionId)
    )
    .innerJoin(schema.users, eq(schema.users.id, schema.invites.inviterId))
    .where(eq(schema.invites.token, token))

  if (!row) {
    return { success: false, error: 'Invite not found', code: 'NOT_FOUND' }
  }

  const now = new Date()
  const expired = new Date(row.expiresAt).getTime() < now.getTime()
  const exhausted = row.usedCount >= row.maxUses
  const revoked = row.revokedAt !== null

  return {
    success: true,
    data: {
      token: row.token,
      subscriptionId: row.subscriptionId,
      subscriptionName: row.subName,
      subscriptionLogo: row.subLogo,
      inviterName: row.inviterDisplayName || row.inviterName,
      expiresAt: row.expiresAt,
      expired,
      exhausted,
      revoked,
    },
  }
}

export async function acceptInvite(
  db: DB,
  userId: number,
  token: string
): Promise<Result<{ subscriptionId: number }>> {
  const meta = await getInviteMetadata(db, token)
  if (!meta.success) return meta
  if (!meta.data) {
    return { success: false, error: 'Invite not found', code: 'NOT_FOUND' }
  }

  const m = meta.data

  // Idempotent fast path: if the caller is already an active member, succeed
  // without consuming a slot. Run this *before* the validity checks so that
  // existing members hitting a stale link (expired / exhausted / revoked)
  // still get a coherent success instead of a confusing FORBIDDEN.
  const [existing] = await db
    .select({ leftAt: schema.subscriptionMembers.leftAt })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, m.subscriptionId),
        eq(schema.subscriptionMembers.userId, userId)
      )
    )
  if (existing && existing.leftAt === null) {
    return { success: true, data: { subscriptionId: m.subscriptionId } }
  }

  if (m.revoked) {
    return { success: false, error: 'Invite revoked', code: 'FORBIDDEN' }
  }
  if (m.expired) {
    return { success: false, error: 'Invite expired', code: 'FORBIDDEN' }
  }
  if (m.exhausted) {
    return { success: false, error: 'Invite already used', code: 'FORBIDDEN' }
  }

  const [inviteRow] = await db
    .select({
      inviterId: schema.invites.inviterId,
      subCurrency: schema.subscriptions.currency,
    })
    .from(schema.invites)
    .innerJoin(
      schema.subscriptions,
      eq(schema.subscriptions.id, schema.invites.subscriptionId)
    )
    .where(eq(schema.invites.token, token))
  if (!inviteRow) {
    return { success: false, error: 'Invite not found', code: 'NOT_FOUND' }
  }

  const rates = await fetchRatesForUsers(db, [userId], inviteRow.subCurrency)
  const today = todayInAppTz()

  try {
    await db.transaction(async (tx) => {
      // Re-check membership inside the transaction. If a concurrent request
      // or an out-of-band addMember made this user active between the outer
      // check and here, skip consuming the slot and return success — the
      // user is already a member so the invite would have been a no-op.
      const [live] = await tx
        .select({ leftAt: schema.subscriptionMembers.leftAt })
        .from(schema.subscriptionMembers)
        .where(
          and(
            eq(schema.subscriptionMembers.subscriptionId, m.subscriptionId),
            eq(schema.subscriptionMembers.userId, userId)
          )
        )
      if (live && live.leftAt === null) return

      const consumed = await tx.execute(sql`
        UPDATE invites
        SET used_count = used_count + 1
        WHERE token = ${token}
          AND used_count < max_uses
          AND revoked_at IS NULL
          AND expires_at > ${new Date().toISOString()}
        RETURNING token
      `)
      const rows = Array.isArray(consumed)
        ? consumed
        : ((consumed as { rows?: unknown[] }).rows ?? [])
      if (rows.length === 0) {
        throw new Error('INVITE_RACE')
      }

      await addMemberToSubscription(
        tx,
        {
          subscriptionId: m.subscriptionId,
          userId,
          addedBy: inviteRow.inviterId,
          addedAt: today,
        },
        rates
      )
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'INVITE_RACE') {
      return { success: false, error: 'Invite already used', code: 'CONFLICT' }
    }
    throw err
  }

  return { success: true, data: { subscriptionId: m.subscriptionId } }
}
