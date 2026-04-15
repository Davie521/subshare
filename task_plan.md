# Task Plan: Single-currency netted settlement + editable preferredCurrency

## Goal

Settlement displays **one row per person** (no per-currency split). All amounts
shown in the viewer's `preferredCurrency`. User can change `preferredCurrency`
in Settings.

## Confirmed by user

- ❌ Don't display original currency on bill rows (just show converted)
- ✅ Default = `users.preferredCurrency` (already exists)
- ✅ User can change `preferredCurrency` in Settings
- ⏳ Per-friend currency override: still wanted (from earlier message), but **deferred to Phase 3** unless user wants it sooner

## Open questions — RESOLVED

1. ✅ Stale FX: use today's live rate (per user)
2. ✅ Day-to-day drift: accepted
3. ✅ Per-friend override: in scope — UI lives on the **Friends page**
   (not Settlement page)

## Phases

### Phase 1 — Editable preferredCurrency in Settings (small)

- Replace read-only "Currency" field with a select of supported currencies
  (CNY, USD, HKD, CAD, EUR, GBP, JPY — same whitelist as elsewhere)
- Wire to existing `api.updateProfile` (extend handler to accept
  `preferredCurrency`)
- Validation reuse: `CURRENCY_WHITELIST` from api-handlers
- No data migration: existing bills' `localCurrency` stays as-is

### Phase 2 — Net settlement in single currency per person

**Server side (`src/lib/settlement.ts` + `api-handlers.ts`):**

- New aggregation `getSettlementSummaryNormalized(db, viewerId, displayCurrency)`:
  - Fetch all unpaid bills involving viewer (existing `fetchBills`)
  - Convert each bill amount → `displayCurrency`:
    - If `bill.localCurrency === displayCurrency` → use `bill.localAmount`
    - Else → live FX from `bill.currency` → `displayCurrency`
  - Net per counterparty: `incoming − outgoing` in display cents
  - Returns one row per counterparty (no currency dimension):
    `{ counterpartyUserId, counterpartyName, displayCurrency, netAmount, bills[] }`
- `bills[]` carries each bill's converted amount + direction + sub name +
  date; original currency dropped from response (per user)
- Settlement page consumed: existing endpoint returns this new shape
  - Tabs still split by sign (net > 0 → "Owed to you", net < 0 → "You owe")
  - One card per person, no per-currency sub-block
  - Per-bill list shows converted amount only

**Settle action:**

- Currently `markPairSettled(db, {userA, userB, currency})` operates per
  currency. Now we need a "settle ALL with this person" action.
- Option: change handler to accept optional `currency`; if omitted, settle
  every (pair) bill regardless of currency. Add a new helper or extend
  existing.

**Notifications (`syncSettlementDueNotifications`):**

- One notification per counterparty (not per pair × currency)
- Payload: counterparty, displayCurrency, netAmount, billCount,
  oldestBillingDate, direction (sign of net)

**Client (`src/app/(app)/settlement/page.tsx`):**

- Drop currency sub-grouping; one card per person
- Single "Mark settled" button per person card

**Notification rendering (`src/components/notifications-list.tsx`):**

- Update `settlement_due` rendering to use new payload shape

### Phase 3 — Per-friend currency override (Friends page)

- DB: add `agreed_currency text NULL` to `friendships` table
- API: get/set per-friend agreed currency
- UI: currency selector on each friend row in `/friends`
- Aggregation uses friend's `agreed_currency` if set, else viewer's
  `preferredCurrency`

## Implementation order

1. Phase 1 (Settings preferredCurrency editable) — 30 min
2. Phase 2a (server-side normalized aggregation + handler) — 60 min
3. Phase 2b (settle-all-currencies action) — 20 min
4. Phase 2c (notifications sync update) — 30 min
5. Phase 2d (client UI rebuild) — 60 min
6. Verify + screenshot

Total: ~3.5 h

## Risks / unknowns

- FX endpoint reliability: if live FX call fails, settlement display has to
  fall back somehow. Plan: skip the bill (with warning in payload) or use
  stored `localAmount` as best-effort.
- Tests: existing settlement tests assume per-currency rows. Will need
  updates after Phase 2.
- The current `markPairSettled` API has only one currency param; clients
  that depend on it (none external) would break if signature changes. Will
  add an "all currencies" variant rather than change signature.

## Out of scope

- Historical settled view (already removed)
- Cross-currency netting between different friends (each pair stays
  independent)
- FX rate caching layer (use live each time for v1)
