import { eq, and } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { calculateShares } from './billing'
import { getActiveMembersAt, lockSubscription } from './db-operations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

/**
 * R1 monthly cron. On the 1st of month `yearMonth`, insert one billing_record
 * per active non-payer member per shared subscription.
 *
 * Active members = getActiveMembersAt(sub.id, '<YYYY-MM>-01').
 * Share = floor(price / activeMemberCount).
 * Skips personal subs (no co-members).
 * Idempotent via UNIQUE(subscription_id, user_id, billing_date).
 *
 * Each sub runs in its own transaction so a single FX-rate miss rolls
 * back just that sub and leaves the rest of the month's R1 pass intact.
 *
 * @param yearMonth like '2026-05'
 * @param rates optional FX map, keys like 'USD_CNY' → numeric rate
 * @returns number of bills inserted
 */
export async function generateMonthlyBills(
  db: DB,
  yearMonth: string,
  rates: Record<string, number> = {}
): Promise<number> {
  const billingDate = `${yearMonth}-01`

  const subs = await db.select().from(schema.subscriptions)

  let inserted = 0

  for (const sub of subs) {
    try {
      inserted += await db.transaction(async (tx) => {
        // Lock + re-read members inside the tx so concurrent add/leave
        // calls can't race with this sub's R1 pass.
        await lockSubscription(tx, sub.id)

        const members = await getActiveMembersAt(tx, sub.id, billingDate)
        if (members.length < 2) return 0 // personal or empty

        const nonPayers = members.filter((m) => m.userId !== sub.payerId)
        if (nonPayers.length === 0) return 0

        const share = calculateShares(sub.price, members.length)

        let count = 0
        for (const member of nonPayers) {
          const [user] = await tx
            .select({ preferredCurrency: schema.users.preferredCurrency })
            .from(schema.users)
            .where(eq(schema.users.id, member.userId))
          if (!user) continue

          const rate =
            sub.currency === user.preferredCurrency
              ? 1
              : rates[`${sub.currency}_${user.preferredCurrency}`]
          if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
            throw new Error(
              `Missing exchange rate for ${sub.currency}_${user.preferredCurrency}`
            )
          }

          const localAmount = Math.floor(share * rate)

          const [existing] = await tx
            .select({ id: schema.billingRecords.id })
            .from(schema.billingRecords)
            .where(
              and(
                eq(schema.billingRecords.subscriptionId, sub.id),
                eq(schema.billingRecords.userId, member.userId),
                eq(schema.billingRecords.billingDate, billingDate)
              )
            )
          if (existing) continue

          await tx.insert(schema.billingRecords).values({
            subscriptionId: sub.id,
            userId: member.userId,
            amount: share,
            currency: sub.currency,
            localAmount,
            localCurrency: user.preferredCurrency,
            exchangeRate: Math.round(rate * 1_000_000),
            billingDate,
          })
          count++
        }
        return count
      })
    } catch (err) {
      // Per-sub best-effort. Log loud enough that operators can notice a
      // stuck billing run (e.g. missing FX rate); the transaction above
      // already rolled back, so other subs are unaffected.
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[billing] generateMonthlyBills sub=${sub.id} name="${sub.name}" failed: ${message}`
      )
    }
  }

  return inserted
}
