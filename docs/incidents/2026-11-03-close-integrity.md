# Incident 2026-11-03 — close-integrity: ledger market blocks carried the next session's close

Class: `yesterday-data-unlabelled` + `single-lane-date-mismatch` (Charter v4.1 §D).
Status: fixed in this PR + data-branch staging (see below). Test: `tests/smoke.spec.ts`
"ledger market blocks match their sessions" + live-gate served-ledger check.

## What was wrong

1. **Reports-archive market blocks (4 of 7 entries).** The served ledger's
   market block for Oct-16 carried Oct-26's close (2629.83), Oct-27 carried
   Oct-28's (2664.06), Oct-29 carried Oct-30's (2690.15), Oct-30 carried
   Nov-2's (2657.51). Only Oct-26, Oct-28, Nov-2 were their own session's.
2. **Wrap Nov-2 entry provisional-as-final.** The wrap-archive Nov-2 entry
   (2679.11, market OPEN, 252 scrips, generated 2026-11-02T09:55Z = 15:40 NPT)
   was baked from an intraday tape while the final close tape was unpublished
   (the 15:25 close capture had failed), yet its body claimed "official
   session close".
3. **Regime NEPSE row stale-by-one.** The live regime board claimed asof
   Nov-2 while its NEPSE row was Oct-30 (2690.15): the builder ran when
   index-history ended Oct-30 but the OHLC archive already had Nov-2.
4. **Nov-2 close/turnover reconciliation.** Published close 2657.51 vs broker
   terminal (NAASA X) 2660.02; tape turnover Rs 6,859,673,979 vs floorsheet
   Rs 7,183,713,047.01.

## Root causes

- **Ledger:** `tools/build-reports-archive.py` `build_snapshot()` copies the
  market block from `wave1.json` at snapshot-build time and only PRINTS a
  note when `wave.asof != verdicts.asof`. A batch built late (after the next
  session's close) therefore ships the next session's tape as its market
  block. The builder gate is now HARD: a new snapshot refuses to build when
  wave asof != batch asof (fail loud, never silently copy a newer tape).
- **Wrap:** `tools/build-market-wrap-archive.js` `main()` skipped any session
  already in the archive (`have` set), so a provisional entry was never
  replaced by the final tape; and `entryFromLive()` claimed "official session
  close" unconditionally, even for `market: OPEN` tapes. Fixed: provisional
  entries carry a provisional disclaimer + headline suffix; a final tape
  replaces a provisional entry for the same session; backfill replaces a
  provisional entry with the index-history record once the final tape is gone.
- **Regime:** builder inputs were split across two vintages (index-history
  vs OHLC archive) with no agreement check. Fixed by rebuilding from current
  inputs (index-history through Nov-2 + served Nov-2 keystone overlay) and
  staging via the data-branch `market-regime` component.
- **Nov-2 figures (evidence, 2026-11-03 research):**
  - Close: final published tables unanimously print **2657.50** (-32.65,
    -1.21%); 2690.15 - 32.65 = 2657.50 exactly. Our tape's 2657.51 was a
    0.01 rounding artefact (same +0.01 pattern as the stale "close" field's
    2690.16 vs Oct-30's 2690.15). Restated 2657.51 -> 2657.50 everywhere.
    The terminal's 2660.02 is UNEXPLAINED (no published source, no
    documented mechanism, no timestamp) and is NOT adopted.
  - Turnover: final total **Rs 7,183,713,047.01** (floorsheet aggregate,
    matching final published tables to the paisa; 70,228 trades, 19,822,392
    shares, 343 scrips). The tape's 6,859,673,979 was a PRE-FINAL snapshot:
    the final tally added 2,695 trades / 1,130,347 shares / Rs 324,039,068
    after the snapshot. Restated in the Nov-2 ledger entry. Tape breadth
    (343 traded, 42/295/6) is retained: it is price-based from the final
    tape and sums to 343.
  - NOT yet officially verified: no live NEPSE official fetch succeeded
    during research (API text-fetch failed; no historical official endpoint
    surfaced). The figures above are the strongest available evidence
    (unanimous final-day tables + floorsheet-exact turnover), NOT a directly
    verified official print. A direct official re-fetch is still owed before
    this is called officially verified. Breadth variants in some wraps
    (21/252/6 = 279, irreconcilable with 343 scrips) are left open, not forced.

## Corrections shipped

- `data/index-history.json`: Nov-2 close 2657.51 -> 2657.50 (one row).
- `data/reports-archive.json` (main copy): Oct-16 -> 2634.16 block,
  Oct-27 -> 2630.76 block, each with a visible `restatement_note`.
- Data-branch ledger: Oct-16, Oct-27, Oct-29, Oct-30 blocks corrected to
  their own sessions + Nov-2 index/turnover restated (2657.50 /
  Rs 7,183,713,047) + visible notes on every corrected entry.
  Turnover for Oct-16/27/29 = sum of per-symbol history turnovers for the
  session, rounded (method validated exact on Oct-26 and Oct-30; Oct-28's
  3,318-rupee history-vs-tape difference is reconstruction tolerance, and
  Oct-28's tape figure stands).
- `nepse-chart/data/wrap-archive.json` Nov-2 entry -> final close
  (2657.50, -32.65, -1.21%, breadth 42/295 of 343, range 2651.15-2691.10,
  sectors from the final tape) + `restatement_note`; wrap pages rebaked.
- Regime board rebuilt from current inputs + staged via `market-regime`.
- Render support: `js/nepse-reports.js` (past entries), wrap `entryCard`,
  `js/nd-regime-board.js` (board note) all render `restatement_note` when
  present.

## Standing protocol (future closes — recorded, not re-litigated)

Poll after 15:00:30; build FINAL only on agreement (tape close flag + asof
== session + independent final-total agreement). A provisional snapshot must
never be published as a final close, and a provisional entry must be replaced
— never left standing — once the final tape lands.

## Regression tests

- `tests/smoke.spec.ts` "ledger market blocks match their sessions": every
  ledger entry's `market.index` must equal its session's index-history close
  AND its wrap-archive index value. Fails on any shifted block.
- Live gate: same check against the SERVED data-branch ledger (production).
- Builder gate: `build-reports-archive.py` refuses a new snapshot when wave
  asof != batch asof.
