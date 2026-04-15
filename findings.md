# Findings

## Code map (relevant to this task)

### Currency / FX
- `src/db/schema.ts:21` — `users.preferredCurrency` (text, default 'CNY')
- `src/db/schema.ts:149-156` — `billingRecords` has `amount` + `currency`
  (original) and `localAmount` + `localCurrency` + `exchangeRate` (×1e6) —
  conversion locked at bill creation
- `src/lib/api-handlers.ts:267-275` — `CURRENCY_WHITELIST` (CNY, USD, HKD,
  CAD, EUR, GBP, JPY)

### Settlement
- `src/lib/settlement.ts` — `getSettlementSummary`, `markPairSettled` (per
  currency), `bucketByPairCurrency` returns rows keyed by (counterparty,
  currency)
- `src/app/api/settlement/route.ts` — POST takes `{counterpartyUserId,
  currency}`, currency required
- `src/lib/api-client.ts:130-148` — settlement client; `markPairSettled`
  takes currency

### Settings
- `src/app/(app)/settings/page.tsx:152` — preferredCurrency rendered
  read-only as `<Field label="Currency" value={user.preferredCurrency} />`
- `src/app/api/auth/me/route.ts` — PUT handler currently accepts only
  `displayName` + `showEmail` (per validators)

### Notifications
- `src/lib/notifications.ts:syncSettlementDueNotifications` — currently
  syncs one notification per (counterparty, currency, direction). Needs
  rework to one per counterparty.

## FX conversion strategy

Two cases when converting bill `amount` to `displayCurrency`:

1. **Hot path**: `bill.localCurrency === displayCurrency` →
   use `bill.localAmount` directly (free, locked at bill creation).
2. **Cold path**: `bill.localCurrency !== displayCurrency` (user changed
   `preferredCurrency` since bill was created) → call live FX endpoint or
   the stored exchange rate machinery. Falls back per pair `(bill.currency,
   displayCurrency)`.

For v1, hot path covers the vast majority. Cold path can use the existing
`/api/exchange-rate` endpoint or the same fetcher used by
`generateMonthlyBills`.

## Tests at risk

- `src/__tests__/settlement.test.ts` — asserts row shape with currency
  field; will need new shape or kept as legacy
- `src/__tests__/api-handlers.test.ts` — markPairSettled call contract
- `src/__tests__/notifications.test.ts` (if exists) — settlement_due
  payload shape

## Existing behavior to preserve

- R10 (per-currency netting only between same currency) still applies for
  the *underlying bills*, but the **display** rolls everything up into one
  number. `markPairSettled` still operates atomically on every unpaid bill
  in the (pair) buckets — across currencies — when invoked as a "settle
  everything" action.
