import type { SubscriptionTag } from '@/db/schema'

const MAX_TAGS = 5

/**
 * Filter tags for a viewer. Privileged viewers (owner / payer — whoever
 * the caller has decided is allowed to edit tags) see the full list;
 * everyone else only sees tags marked 'public'.
 *
 * The caller decides privilege because the ownership model may evolve;
 * this function stays role-agnostic.
 *
 * Robust to null / undefined input — returns [] rather than throwing so
 * legacy rows (pre-tags column) don't blow up the UI.
 */
export function filterTagsForViewer(
  tags: SubscriptionTag[] | null | undefined,
  viewerIsPrivileged: boolean
): SubscriptionTag[] {
  if (!Array.isArray(tags)) return []
  if (viewerIsPrivileged) return tags
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
