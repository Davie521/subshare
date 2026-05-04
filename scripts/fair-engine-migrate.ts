/**
 * Fair-engine migration.
 *
 * Strategy: reset every member's `addedAt` to `sub.startDate`, then
 * recompute every month from sub.startDate's month through today.
 * Late-joiners are treated as full-month members from sub creation.
 *
 * Default mode is DRY-RUN (no writes). Pass --apply to commit.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/fair-engine-migrate.ts            # dry-run all
 *   DATABASE_URL=... npx tsx scripts/fair-engine-migrate.ts --sub 24   # dry-run one sub
 *   DATABASE_URL=... npx tsx scripts/fair-engine-migrate.ts --apply    # WRITES
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, gte, lte } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import { fairAllocation, type MemberInterval } from '../src/lib/fair-allocation'
import { recomputeMonth } from '../src/lib/engine/recompute'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function nextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  let nm = m + 1
  let ny = y
  if (nm > 12) {
    nm = 1
    ny++
  }
  return `${ny}-${pad2(nm)}`
}

async function main() {
  const dbUrl =
    process.env.DATABASE_URL ?? 'postgres://subshare:subshare@localhost:5432/subshare'
  const apply = process.argv.includes('--apply')
  const subFilter = process.argv.includes('--sub')
    ? Number(process.argv[process.argv.indexOf('--sub') + 1])
    : null

  const sql = postgres(dbUrl)
  const db = drizzle(sql, { schema })

  const today = new Date().toISOString().slice(0, 10)
  const todayMonth = today.slice(0, 7)

  console.log(
    `# Fair-engine migration ${apply ? '(APPLY MODE — WRITES)' : '(DRY-RUN — no writes)'}`
  )
  console.log(`# strategy: reset all members.added_at = sub.start_date`)
  console.log(`# today = ${today}`)
  console.log()

  const subs = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.inactive, false))
  const filtered = subFilter ? subs.filter((s) => s.id === subFilter) : subs

  let totalDeltaRows = 0
  let totalSubsTouched = 0
  let totalMonthsTouched = 0
  let totalAddedAtUpdates = 0
  let totalBillsInserted = 0
  let totalBillsUpdated = 0
  let totalAdjustmentsInserted = 0

  for (const sub of filtered) {
    const members = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(eq(schema.subscriptionMembers.subscriptionId, sub.id))
    if (members.length === 0) continue

    const subStartMonth = sub.startDate.slice(0, 7)
    if (subStartMonth > todayMonth) continue // future sub

    const originalAddedAt = new Map<number, string>(
      members.map((m) => [m.userId, m.addedAt])
    )

    if (apply) {
      for (const m of members) {
        if (m.addedAt !== sub.startDate) {
          await db
            .update(schema.subscriptionMembers)
            .set({ addedAt: sub.startDate })
            .where(
              and(
                eq(schema.subscriptionMembers.subscriptionId, sub.id),
                eq(schema.subscriptionMembers.userId, m.userId)
              )
            )
          totalAddedAtUpdates++
        }
      }
    }

    const intervals: MemberInterval[] = members.map((m) => ({
      userId: m.userId,
      addedAt: sub.startDate,
      leftAt: m.leftAt,
    }))

    let cursor = subStartMonth
    let subTouched = false
    while (cursor <= todayMonth) {
      const [yy, mm] = cursor.split('-').map(Number)

      if (apply) {
        const result = await recomputeMonth(db, {
          subscriptionId: sub.id,
          year: yy,
          month: mm,
          eventId: `migration:sub${sub.id}:${cursor}`,
          today,
        })
        if (
          result.insertedBillIds.length > 0 ||
          result.updatedBillIds.length > 0 ||
          result.insertedAdjustmentIds.length > 0 ||
          result.updatedAdjustmentIds.length > 0
        ) {
          totalMonthsTouched++
          subTouched = true
        }
        totalBillsInserted += result.insertedBillIds.length
        totalBillsUpdated += result.updatedBillIds.length
        totalAdjustmentsInserted += result.insertedAdjustmentIds.length
      } else {
        const fair = fairAllocation({
          price: sub.price,
          year: yy,
          month: mm,
          intervals,
          roundingSeed: sub.id + yy * 12 + mm,
        })
        const monthDays = new Date(yy, mm, 0).getDate()
        const monthStart = `${yy}-${pad2(mm)}-01`
        const monthEnd = `${yy}-${pad2(mm)}-${pad2(monthDays)}`
        const existing = await db
          .select()
          .from(schema.billingRecords)
          .where(
            and(
              eq(schema.billingRecords.subscriptionId, sub.id),
              gte(schema.billingRecords.billingDate, monthStart),
              lte(schema.billingRecords.billingDate, monthEnd)
            )
          )
        const actualByUser = new Map<number, number>()
        for (const b of existing) {
          actualByUser.set(
            b.userId,
            (actualByUser.get(b.userId) ?? 0) + b.amount
          )
        }
        const allUserIds = new Set<number>([
          ...fair.keys(),
          ...actualByUser.keys(),
        ])
        for (const uid of allUserIds) {
          const target = fair.get(uid) ?? 0
          const actual = actualByUser.get(uid) ?? 0
          const delta = target - actual
          if (delta === 0) continue
          totalDeltaRows++
          subTouched = true
          const isPayer = uid === sub.payerId
          const tag = isPayer ? '[payer]' : '       '
          const orig = originalAddedAt.get(uid) ?? '?'
          const moved =
            orig !== sub.startDate ? ` (was addedAt=${orig})` : ''
          console.log(
            `${tag} sub=${sub.id} ${cursor} user=${uid} fair=${(target / 100).toFixed(2)} actual=${(actual / 100).toFixed(2)} delta=${(delta / 100).toFixed(2)} ${sub.currency}${moved}`
          )
        }
      }

      cursor = nextMonth(cursor)
    }
    if (subTouched) totalSubsTouched++
  }

  console.log()
  if (apply) {
    console.log(
      `# Applied: ${totalAddedAtUpdates} addedAt resets, ${totalBillsInserted} bills inserted, ${totalBillsUpdated} bills updated, ${totalAdjustmentsInserted} adjustments inserted across ${totalMonthsTouched} months in ${totalSubsTouched} subs`
    )
  } else {
    console.log(
      `# Dry-run summary: ${totalDeltaRows} non-zero deltas across ${totalSubsTouched} subs. Run with --apply to commit.`
    )
  }

  await sql.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
