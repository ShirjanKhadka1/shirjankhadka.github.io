# Incident 2026-11-03 — signals-overlay-field-drift

Class id: `signals-overlay-field-drift` (new class; see Charter v4.1 §D).

## What failed

The 2026-11-02 19:10 signals rebuild regenerated all three signal systems with
`generated_at` 2026-11-02 but `asof` 2026-10-30 — one session behind the close.
The signal pages' client renderer prints `Signals as of <asof>`, so the
cross-dataset smoke gate (`SSR session dates match the manifest session date`,
`tests/smoke.spec.ts`) failed on `/nepse-signals/trend-relay/` in the
2026-11-03 midnight-rollover PR #332 (manifest session 2026-11-02 vs SSR
2026-10-30), and the same stale-asof signals would fail any combined tree
that carried them.

## Root cause

`tools/build-signals.js` (`getSymbolData`) overlays the newest bar from the
worktree's `nepse-chart/data/live.json` only when `live.session_date` is set:

```js
const session = live.session_date; // YYYY-MM-DD
```

The close tape no longer carries a `session_date` field at all — it carries
`asof` (`2026-11-02T15:00:00+05:45`) and `data_asof`
(`2026-11-02T14:58:38+05:45`) timestamps instead (schema drift since the
close-capture path moved to the data branch). `session` was therefore always
`undefined`, the overlay never fired, and bars ended at the third-party
scraper API's last date (2026-10-30). The builder's own honest-vintage rule
(`asof` = actual last bar date, never build date) then correctly stamped
2026-10-30 — the bug is the dead overlay, not the stamp.

Evidence:

- Main's `live.json` (Nov-2 close, 343 quotes, `close: true`) has no
  `session_date` key; `asof`/`data_asof` are Nov-2 timestamps.
- PR #329's rebuilt signals (generated 2026-11-02T13:25Z) carry
  `asof: 2026-10-30` for all three systems with alert counts identical to
  main's Oct-30 build (momentum 10, trend-relay 9, reversal 1) — a
  regeneration, not a new session.
- The trend-relay marker is JS-rendered, not baked: the page's raw HTML has
  no `session`/`as of` marker; its inline renderer writes
  `Signals as of <asof>` from the fetched signals JSON.

## Fix (same PR as this file)

`tools/build-signals.js`: fall back to the date part of `data_asof`, then
`asof`, when `session_date` is absent. Rebuilt signals then overlay the
Nov-2 close bar per symbol and stamp `asof: 2026-11-02`.

## Guard / regression test (same PR)

The cross-dataset smoke gate itself is the regression test: it compares the
rendered `Signals as of` marker against `manifest.session_date` on every PR
touching shared code. A future overlay regression re-fails that gate on
`/nepse-signals/trend-relay/` (and momentum/reversal when their fetches land
in time) instead of shipping a silently stale-asof board. No new unit
harness exists for `build-signals.js`; the gate is the recorded test id:
`tests/smoke.spec.ts` — `SSR session dates match the manifest session date`.

## Related

- Single-lane gate failures 2026-11-02/03: PR #325 (manifest without page
  SSR), PR #329 (page SSR without manifest), PR #332 (manifest without page
  SSR) — resolved by the combined tree carrying this fix, not by re-running
  CI hoping for a pass.
- Charter v4.1 §C: the Oct-30 signals were never re-stamped as Nov-2; the
  fix produces genuinely Nov-2 bars instead.
