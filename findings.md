# Findings — Shared users cannot add tags (2026-04-20)

## User complaint (CN → EN)

> "目前被分享的用户没有办法加 tag。被分享的加加肯定是 personal，所以你稍微注意一下，把这个 bug 修复。"

Shared (non-owner, non-payer) members have no way to add tags on a
subscription's detail page. Any tag a shared member *could* add should be
**personal** (visible only to that member), not the existing
public/private-to-privileged-viewers variety.

## Why it's broken today

### UI gate

`src/app/(app)/subscriptions/[id]/page.tsx:587`

The entire Tags card is wrapped in `{selfIsOwnerOrPayer && (…)}`. A shared
member therefore sees no tag list, no chips, no Add button.

### API gate

`src/lib/api-handlers.ts:729-746` (`handleUpdateSubscription`)

```ts
const PAYER_ALLOWED_KEYS = new Set(['tags', 'logo'])
if (!isOwner) {
  const keys = Object.keys(input)
  const hasOwnerOnlyKey = keys.some((k) => !PAYER_ALLOWED_KEYS.has(k))
  if (hasOwnerOnlyKey) return FORBIDDEN
  if (!isPayer) return { error: 'Only the owner or payer can edit tags or logo', code: 'FORBIDDEN' }
}
```

A caller that is a member but neither owner nor payer is rejected.

### Model mismatch

Existing tag visibility is binary:
- `public` — all members see it
- `private` — only owner + payer see it (filter in `src/lib/tags.ts`
  `filterTagsForViewer`, called from both `GET /api/subscriptions/[id]` and
  `getSubscriptionsForUser`)

There is no concept of "personal to viewer". Adding a shared member as
another "privileged" author of `subscriptions.tags` would corrupt the
existing semantics (a shared member's tag would become visible to owner +
payer and vice versa) and would make private-tag ownership ambiguous.

## Recommended design — Option A (per-member personal tags)

Store personal tags per member row, not per subscription. Each user gets
their own private bucket that only they can read/write.

### Schema

Add a column to `subscription_members`:

```sql
ALTER TABLE subscription_members
  ADD COLUMN IF NOT EXISTS personal_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
```

PK is already `(subscription_id, user_id)` — one bucket per (sub, member)
pair. No visibility toggle needed; the column is always personal.

### Read path

- `GET /api/subscriptions/[id]` response gets a new `personalTags: SubscriptionTag[]`
  field sourced from the caller's own `subscription_members` row.
- `subscriptions.tags` keeps its existing filter (public everywhere,
  private only to owner+payer) — unchanged.
- `getSubscriptionsForUser` (list view) optionally joins and returns
  `personalTags` per sub for the caller. See open question 2.

### Write path

Two reasonable options, plan recommends the first for minimum surface area:

1. **Extend `PATCH /api/subscriptions/[id]`** — accept a new
   `personalTags?: SubscriptionTag[]` field. When present, the handler
   updates `subscription_members.personal_tags` for the caller only (no
   owner/payer check; any active member can set their own). Other fields
   retain their existing authorization rules.
2. **New endpoint** `PATCH /api/subscriptions/[id]/members/me/tags` — a
   dedicated route that only ever writes the caller's own row.

Option 1 is simpler (one validator, one handler, no new route file) and
matches the existing whitelist pattern. The caller's identity is already
established via `requireAuth()`, so scoping the write to `userId` is a
single SQL `WHERE` clause.

### Normalization + cap

Reuse `normalizeTags()` (trim, dedupe, cap at 5). Reuse `tagArraySchema`
zod validator. Personal tags conceptually carry no `visibility` axis, but
storing the same `{label, visibility}` shape lets us reuse all existing
helpers; the UI variant forces `visibility = 'private'` on every entry
and hides the toggle. This is a cheap-compromise choice — alternative is
a narrower `PersonalTag = { label: string }` type plus forked helpers,
which costs more code for little semantic gain.

### UI

In `subscriptions/[id]/page.tsx`:

- Keep the existing "Tags" card (gated `selfIsOwnerOrPayer`), unchanged.
- Add a new "Your tags" card visible to *every* active member including
  owner and payer (uniformity argument — see open question 1).
- `TagEditor` gains a `mode?: 'shared' | 'personal'` prop (default
  `'shared'`). In `personal` mode:
  - Visibility toggle is hidden.
  - Header helper text reads "Only you can see these."
  - All writes emit `visibility: 'private'` on the wire.

`TagChipList` needs no change — it renders whatever shape it receives.

## Why not Option B (flip the existing permission)?

"Just let shared members edit `subscriptions.tags`" fails:
- A shared member's private tag would be visible to owner + payer
  (current `filterTagsForViewer` logic).
- Shared members could remove other members' tags (shared bucket).
- Private-tag ownership becomes ambiguous across multi-member subs.

User's phrasing ("肯定是 personal") explicitly rules this out.

## Edge cases & risk register

### Leave / rejoin

- `leaveSubscription` sets `leftAt` but does NOT delete the row
  (`src/lib/db-operations.ts:331`). Personal tags therefore **survive** a
  leave event on the same row.
- `addMemberToSubscription` rejoin path (`db-operations.ts:111-128`)
  UPDATEs `addedAt`, `addedBy`, clears `leftAt` — it does NOT touch
  `personal_tags`. So a rejoining member's old personal tags would
  silently resurrect. **Risk.** Decision needed — recommended: clear
  `personal_tags` to `[]` on rejoin (mirrors "fresh stint" semantics used
  for bills). Add one SET clause to the rejoin UPDATE.

### Subscription deletion

CASCADE on `subscription_id` already wipes `subscription_members`. No
orphaned personal_tags rows possible.

### Kick (owner/payer removes a member)

Goes through `leaveSubscription` (leftAt set, row preserved). If the
kicked user rejoins later via invite, see "rejoin" above.

### List view (`/api/subscriptions`)

Current list rendering in
`src/app/(app)/subscriptions/page.tsx:11-24` reads `sub.tags` and
displays via `TagChipList`. Whether personal tags should also appear
there is open question 2.

### Migration

Idempotent DDL via `src/db/migrate.ts` — same pattern as
`subscriptions.tags` addition (PR #13). Existing rows default to `[]`.
Zero-downtime backward-compatible (read path tolerates missing field via
`normalizeTags` null-guard).

### Tests

Existing `src/__tests__/tags.test.ts` covers shared-bucket filtering
exhaustively — none of those assertions change. New file
`src/__tests__/personal-tags.test.ts` per RED/GREEN convention.

## Open questions for user

1. **Owner/payer also get personal tags?** Recommended YES for uniform
   model — "Your tags" card for everyone. Cost: the owner/payer now see
   two tag cards ("Tags" + "Your tags"). Alternative: gate personal-tags
   card to non-owner/non-payer only (smaller UI, inconsistent model).
2. **List view shows personal tags?** `src/app/(app)/subscriptions/page.tsx`
   currently only renders shared tags. Options:
   - (a) Skip — personal tags only visible on detail page.
   - (b) Append personal after shared in the same chip row (risk: visual
     clutter, 5+5 chips).
   - (c) Merge into one list capped at 5 total (risk: arbitrary).
   Recommend (a) for scope discipline.
3. **Rejoin wipes personal tags?** Recommended YES — matches fresh-stint
   semantics. Alternative: preserve (useful if the same user keeps same
   payment-method labels across stints). Low-stakes either way.
4. **Max 5 personal tags the right cap?** Matches shared-tag cap. Fine
   unless user wants 10.

## Files touched (estimated)

- `src/db/schema.ts` — add `personalTags` column to `subscriptionMembers`
- `src/db/migrate.ts` — add idempotent `ALTER TABLE`
- `src/lib/validators.ts` — add `personalTags` field to
  `updateSubscriptionSchema`
- `src/lib/api-handlers.ts` — handle `personalTags` write (scoped to
  caller)
- `src/app/api/subscriptions/[id]/route.ts` — GET returns `personalTags`
  for caller
- `src/lib/db-operations.ts` — `addMemberToSubscription` rejoin path
  resets `personalTags`; optionally extend `getSubscriptionsForUser` for
  open question 2
- `src/lib/api-client.ts` — add `personalTags` to types
- `src/components/tag-editor.tsx` — `mode` prop, hide visibility toggle
  in personal mode
- `src/app/(app)/subscriptions/[id]/page.tsx` — new "Your tags" card
- `src/__tests__/personal-tags.test.ts` — new RED/GREEN test file
