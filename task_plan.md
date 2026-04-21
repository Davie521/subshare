# Implementation Plan: Personal tags for every member

## Overview

Shared (non-owner/non-payer) members currently can't add tags at all.
Fix by introducing per-member personal tags stored on
`subscription_members.personal_tags`, visible and editable only to that
member. Existing `subscriptions.tags` (public/private-to-privileged)
stays unchanged.

## Requirements

- Every active member of a subscription can add/remove up to 5 personal
  tags on that sub.
- Personal tags are visible ONLY to the authoring member.
- Existing shared-tags card (owner/payer only) keeps its current
  behaviour — no regressions on `src/__tests__/tags.test.ts`.
- Deleting a sub wipes personal tags (cascade already covers this).
- Rejoining a sub starts with an empty personal-tags bucket.
- Personal tags do NOT appear on the subscription list page (scope
  discipline — see open question 2 in findings).

## Architecture changes

- `subscription_members.personal_tags JSONB NOT NULL DEFAULT '[]'::jsonb`
  — new column (`src/db/schema.ts`, `src/db/migrate.ts`).
- `PATCH /api/subscriptions/[id]` gains optional `personalTags` field;
  when present, writes the caller's `subscription_members.personal_tags`
  only. No owner/payer check on this field.
- `GET /api/subscriptions/[id]` returns `personalTags: SubscriptionTag[]`
  sourced from caller's row.
- `TagEditor` gains `mode: 'shared' | 'personal'` prop; personal mode
  hides visibility toggle and forces `visibility: 'private'` on emitted
  tags.
- `src/app/(app)/subscriptions/[id]/page.tsx` adds a "Your tags" card
  below the existing "Tags" card, visible to every active member.
- `addMemberToSubscription` rejoin path (`src/lib/db-operations.ts:111`)
  resets `personal_tags` to `[]` alongside clearing `leftAt`.

## Implementation phases (RED/GREEN per this repo's convention)

Each phase is two commits: `test(…): RED for X` (failing tests first),
then `fix(…): X` (implementation to green).

### Phase 1 — Schema + migration (T-PTAGS-1)

1. **Schema column** (File: `src/db/schema.ts`)
   - Action: add `personalTags: jsonb('personal_tags').$type<SubscriptionTag[]>().notNull().default(sql\`'[]'::jsonb\`)` to `subscriptionMembers` pgTable.
   - Why: one bucket per (sub, user) — PK already enforces that shape.
   - Risk: Low. Matches existing `subscriptions.tags` pattern exactly.

2. **Idempotent migration** (File: `src/db/migrate.ts`)
   - Action: append
     ```sql
     ALTER TABLE subscription_members
       ADD COLUMN IF NOT EXISTS personal_tags JSONB NOT NULL DEFAULT '[]'::jsonb
     ```
     to the `ddl` array.
   - Why: existing DBs (prod) get the column on next boot without a
     manual step. Pattern mirrors `subscriptions.tags` DDL already in
     the file.
   - Risk: Low.

3. **RED test** (File: `src/__tests__/personal-tags.test.ts` — new)
   - Action: write failing test that reads `subscription_members.personalTags` via Drizzle on a freshly-created member and asserts `[]`.
   - Depends on: setupTestDb helper already running `migrate()`.

4. **GREEN** — phase 1 commit above makes it pass.

### Phase 2 — Validator + API write path (T-PTAGS-2)

5. **Validator** (File: `src/lib/validators.ts`)
   - Action: add `personalTags: tagArraySchema.optional()` to
     `updateSubscriptionSchema`.
   - Why: same shape/cap/validation as shared tags. No new schema
     needed.
   - Risk: Low.

6. **Handler** (File: `src/lib/api-handlers.ts` —
   `handleUpdateSubscription`, line 729 block)
   - Action: treat `personalTags` as a third permission class alongside
     `tags` + `logo`:
     - If input contains ONLY `personalTags` (+ nothing else), allow any
       active `subscription_members` row for `(subId, userId)` with
       `leftAt IS NULL`. Return 403 if not a member.
     - If input mixes `personalTags` with owner-only or payer-only keys,
       keep existing ownership gate logic (owner passes everything;
       payer-not-owner only for tags/logo).
     - Write: `UPDATE subscription_members SET personal_tags = normalizeTags(input.personalTags) WHERE subscription_id = $1 AND user_id = $2 AND left_at IS NULL`.
   - Why: least-surface-area — reuse the one existing PATCH route.
   - Risk: Medium — auth branching in an already-dense block. Mitigation: comprehensive RED tests (see step 7) before implementation.

7. **RED tests** (File: `src/__tests__/personal-tags.test.ts`)
   - Case: shared member (not owner, not payer) can set personalTags.
   - Case: owner can set their own personalTags.
   - Case: payer can set their own personalTags.
   - Case: non-member gets 403 (matches existing outsider test shape).
   - Case: `{ personalTags, name }` mixed payload from a shared member
     returns `FORBIDDEN` (because `name` is owner-only).
   - Case: personalTags normalized — dedup, trim, cap at 5.
   - Case: user A's personalTags write does not affect user B's row.

8. **GREEN** — handler change passes the tests.

### Phase 3 — API read path (T-PTAGS-3)

9. **GET response** (File: `src/app/api/subscriptions/[id]/route.ts`)
   - Action: after the `memberRows` query, look up the caller's
     `subscription_members.personal_tags` (already fetched if we widen
     the select, otherwise one more tiny query). Return `personalTags`
     on the response alongside `tags`, `members`. For outsiders (not
     allowed) no change — they 404 before reaching this point.
   - Why: client needs read access to render "Your tags" chips.
   - Risk: Low.

10. **API client types** (File: `src/lib/api-client.ts`)
    - Action: add `personalTags: SubscriptionTag[]` to
      `getSubscription` return type and
      `updateSubscription` is already `Record<string, unknown>` — no
      change needed there. (Consider typed helper but out of scope.)
    - Risk: Low.

11. **RED test** for GET (File:
    `src/__tests__/personal-tags.test.ts`)
    - Case: user A sees own personalTags in response.
    - Case: user B viewing the same sub sees B's personalTags, not A's.
    - Case: absent personal tags → `personalTags: []`.

12. **GREEN** — GET route change.

### Phase 4 — TagEditor no-lock mode (T-PTAGS-4)

13. **TagEditor prop** (File: `src/components/tag-editor.tsx`)
    - Action: add `showVisibilityToggle?: boolean` prop (default `true`).
      When false:
      - Don't render the lock/globe toggle on existing chips.
      - Don't render the toggle button in the add-row.
      - Force `draftVisibility = 'private'` internally.
      - Adapt helper text (no "Private tags are only visible to…"
        line).
    - Why: reuses all existing logic (cap, dedupe, commitPending,
      buildNextTags). A single flag covers both the new "Your tags"
      card (always personal) and the main Tags card on 1-member subs
      (no-one-else-exists).
    - Risk: Low.

14. **Unit test** (File: `src/__tests__/tag-editor.test.tsx` if it
    exists, else skip — this repo's test surface is API-level, not DOM)
    - Check if a component-level test file exists. If not, skip DOM
      testing for this component; rely on manual verification.

### Phase 5 — Detail-page UI (T-PTAGS-5)

15. **Main "Tags" card — adapt for 1-member subs** (File:
    `src/app/(app)/subscriptions/[id]/page.tsx`)
    - Action: when `sub.members.length === 1`, render `<TagEditor
      showVisibilityToggle={false} …>` and swap the description copy
      ("Private tags are only visible to the owner and payer." → just
      "Short labels for this subscription." or similar).
    - The save path still PATCHes `tags` (unchanged); normalizeTags
      preserves whatever visibility the stored tags had, but new
      additions come through with `visibility: 'private'` from the
      editor.
    - Risk: Low — single boolean toggles the UI.

16. **"Your tags" card** (File:
    `src/app/(app)/subscriptions/[id]/page.tsx`)
    - Action: render a new Card below the existing Tags card ONLY when
      `sub.members.length > 1`. Visible to every active member.
    - Uses `<TagEditor showVisibilityToggle={false} …>` + `<TagChipList>`
      in view mode.
    - Save handler: `api.updateSubscription(subId, { personalTags: draft })`.
    - Mirrors the existing Tags card's busy / error / editingTags state
      pattern for consistency.
    - Risk: Medium — the existing Tags card handler is non-trivial
      (tagEditorRef.commitPending, busy state). Copy-adapt carefully or
      extract a shared `<TagEditCard>` sub-component if the duplication
      grows. Recommend inline copy first; extract only if a third
      variant is added later.

17. **State plumbing**
    - Add `personalTagsDraft`, `editingPersonalTags`,
      `personalTagsError`, `personalTagEditorRef`.
    - Extend `Sub` type to include `personalTags: SubscriptionTag[]`.
    - Extend `load()` setter to populate from API response.

18. **List-page merge render** (File:
    `src/app/(app)/subscriptions/page.tsx` + `src/lib/db-operations.ts`
    `getSubscriptionsForUser`)
    - Action: extend `getSubscriptionsForUser` to also fetch the
      caller's `subscription_members.personal_tags` for each sub. Add
      `personalTags: SubscriptionTag[]` to the result row.
    - In the list card, render `[...sub.tags, ...sub.personalTags].slice(0, 5)`
      through `<TagChipList>` — shared-first, cap at 5 total.
    - Risk: Low. One extra join; result shape additive.

### Phase 6 — Rejoin behaviour (T-PTAGS-6)

19. **Reset on rejoin** (File: `src/lib/db-operations.ts` —
    `addMemberToSubscription`, line 111-128 isRejoin block)
    - Action: add `personalTags: []` to the SET clause.
    - Why: fresh stint semantics — matches how addedAt / addedBy / leftAt
      are reset.
    - Risk: Low.

20. **RED test** (File: `src/__tests__/personal-tags.test.ts`)
    - Case: user joins, sets personalTags, leaves, rejoins — personalTags
      is empty after rejoin.

21. **GREEN** — SET clause change passes.

## Testing strategy

- Unit tests: `normalizeTags` + `tagArraySchema` already covered; no
  new unit tests required for those.
- Integration tests: `src/__tests__/personal-tags.test.ts` — new file,
  covers phases 1-3 and 6 via API handler calls against `setupTestDb`.
- No e2e — repo has none.
- Coverage: 80% thresholds enforced; new handler branches need explicit
  tests (see Phase 2 step 7 — covers every branch).

## Risks & mitigations

- **Risk**: Auth branching in `handleUpdateSubscription` gets harder to
  read.
  - Mitigation: comprehensive RED tests first (Phase 2 step 7).
  - Mitigation: a comment above the block listing the three allowed
    paths (owner-anything, payer-tags/logo, member-personalTags-own).
- **Risk**: TagEditor `mode='personal'` still emits
  `visibility: 'private'` — if a caller accidentally sends it to the
  shared-tags PATCH, it becomes a private shared tag instead of a
  personal tag.
  - Mitigation: detail page keeps two distinct save handlers (one PATCH
    with `tags`, one PATCH with `personalTags`). Field name is the
    source of truth, not the `visibility` flag.
- **Risk**: Rejoin wipe surprises users who re-invite a member and
  expected their old personal labels.
  - Mitigation: document in commit message; easy to flip the policy
    later since `personal_tags` simply isn't touched on rejoin in that
    case.
- **Risk**: migrate.ts ALTER fails on prod because existing rows need a
  default.
  - Mitigation: `DEFAULT '[]'::jsonb NOT NULL` handles existing rows —
    idempotent pattern already proven on `subscriptions.tags` (PR #13).

## Explicitly NOT doing

- Cross-user personal-tag sharing (contradiction in terms).
- Personal tags on the list page (open question 2 — default: skip).
- Changing shared-tag semantics (`filterTagsForViewer`).
- Transferring personal tags between subs.
- Importing/exporting tags.

## Decisions (user-confirmed 2026-04-20)

1. **Owner + payer also get personal tags** — only in multi-member subs.
   In 1-member subs there's no shared/personal distinction (see decision 5).
2. **List page merges shared + personal**, shared-first, cap at 5 total.
3. **Rejoin resets personal tags** to `[]` on `addMemberToSubscription`
   rejoin path.
4. **Max 5 personal tags** (matches shared cap).
5. **Public/private distinction only exists in shared subs.** In a
   1-member (non-shared) sub:
   - The existing "Tags" card renders without the lock/globe toggle.
   - New tags default to `visibility: 'private'` on write.
   - The new "Your tags" card is hidden (no one else to be personal from).
   - Storage unchanged — still `subscriptions.tags`. When the sub later
     gains members, existing tags stay as they were (private-to-privileged
     by default); the toggle reappears and the owner/payer can promote
     them to public.

## Success criteria

- [ ] Shared member can add and see their own personal tags on the
      subscription detail page.
- [ ] Owner and payer can still see and edit the shared Tags card
      unchanged.
- [ ] User A's personal tags invisible to user B on the same sub.
- [ ] Rejoining a sub clears personal tags.
- [ ] Existing `src/__tests__/tags.test.ts` passes unchanged.
- [ ] `npm run lint` clean.
- [ ] `npm test` passes with coverage ≥ 80%.

## Estimate

~60-90 min of focused work spread across 6 small commits (RED/GREEN
pairs for phases 1, 2-3, 5-6; Phase 4 is tooling). Matches the PR-13
tag-feature scope.
