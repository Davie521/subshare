import type { SubscriptionTag } from '@/db/schema'

const MAX_TAGS = 5

/**
 * Filter tags for a viewer. The payer authored the tags and always sees
 * the complete list; everyone else only sees tags marked 'public'.
 *
 * Robust to null / undefined input — returns [] rather than throwing so
 * legacy rows (pre-tags column) don't blow up the UI.
 */
export function filterTagsForViewer(
  tags: SubscriptionTag[] | null | undefined,
  viewerId: number,
  payerId: number
): SubscriptionTag[] {
  if (!Array.isArray(tags)) return []
  if (viewerId === payerId) return tags
  return tags.filter((t) => t.visibility === 'public')
}

/**
 * Trim, drop empty labels, de-dupe by case-insensitive label, cap at
 * `MAX_TAGS`. Keeps the first occurrence on conflicts. Returns [] for
 * null / undefined.
 */
export function normalizeTags(
  tags: SubscriptionTag[] | null | undefined
): SubscriptionTag[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: SubscriptionTag[] = []
  for (const raw of tags) {
    const label = (raw?.label ?? '').trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ label, visibility: raw.visibility })
    if (out.length >= MAX_TAGS) break
  }
  return out
}
