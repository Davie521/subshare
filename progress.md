# Progress log

## 2026-04-14

- 20:55 — User redirected from per-bucket netting (across direction within
  the same pair × currency) to single-currency netting (across all
  currencies) per person.
- 21:00 — Drafted plan + findings. Awaiting user confirmation on:
  1. Stale FX handling (live FX call when bill.localCurrency mismatches new
     preferredCurrency)
  2. Day-to-day net amount drift
  3. Whether per-friend currency override is in this round (Phase 3) or
     deferred

## Status

- [x] Phase 1: editable preferredCurrency in Settings
- [x] Phase 2a: server-side normalized aggregation (live FX, today's rate)
- [x] Phase 2b: settle-all-currencies action
- [x] Phase 2c: notification sync rewrite (one notif per counterparty)
- [x] Phase 2d: client UI rebuild (one card per person)
- [x] Phase 3: per-friend agreed_currency on Friends page

## Verified end-to-end (21:30)

- Settings → preferredCurrency editable, persists
- Settlement → one card per person, all in viewer's preferred currency
- Notifications → one settlement_due per counterparty in same currency
- Friends → per-friend "Settle in" selector overrides; verified Jack
  switched from default CNY (¥363.23) to USD ($50.11) with re-converted
  bill amounts. Notifications also re-synced.
- markPairSettled now settle-all-currencies (currency optional)
- 212/212 tests · 0 lint errors · 0 TS errors

## Confirmed

- 21:05 — User: today's FX is fine; per-friend override goes on Friends
  page (not deferred).
