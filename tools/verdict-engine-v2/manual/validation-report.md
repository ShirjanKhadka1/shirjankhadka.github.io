# Verdict Engine v2 — Validation Error Report
Built: 2026-10-06 | Stocks: 270 | Total errors: **0**

## Verification round (2026-10-06, manual — no scraping)

All three flagged anomalies were verified read-only against NEPSE official
(nepalstock.com.np), Capital Max (signed-in session), and Chukul:

- **FOWAD** — NEPSE official "Total Listed Shares": 11,959,538 (was 32,800,000
  in archive). Corrected. Market cap 10,524,393,440 = 880 × 11,959,538 exactly.
  Float shares recomputed from corrected base.
- **MKCL** — NEPSE official 52w low: 775.30 (was 807.20); high 1,616.80
  confirmed. Corrected. (NEPSE showed MKCL trading 766.20, genuinely below its
  52w low at the time — the anomaly was real, level was wrong.)
- **NMIC** — NEPSE official confirmed 7,500,000 shares (archive correct).
  Morning Capital Max snapshot (LTP 480, 52w 441/564.9) was a stale/bad page
  load; fresh Capital Max page + NEPSE official + broker terminal all agree:
  LTP 793.00, 52w 765.30/1,525.00, mcap 5,947,500,000, BVPS 106.36, P/B 8.37,
  EPS 5.68, P/E 139.61, PEG 0.06, sector Non Life Insurance. Full record
  replaced with verified values.

## Systematic ratio fix (2026-10-06)

Capital Max's displayed P/B and % below 52w high were computed from a stale
data vintage (did not equal LTP÷BVPS / (high−LTP)÷high from the same page).
Verified via 12-stock Chukul cross-check: Chukul's book values match our BVPS
almost exactly, and our LTP÷BVPS reproduces Chukul's P/B to the paisa.

- **pb_ratio**: recomputed as ltp/bvps for 267 records, flagged `derived`.
  JFL: BVPS −0.89 → P/B −309.10 (negative by construction, flagged).
- **pct_below_52w_high**: recomputed as (high−ltp)/high×100 for 236 records,
  flagged `derived`.
- Original displayed values retained in `manual/derived-fields-qa-log.json`
  (internal QA only, not for deployment).

## Open review flags (3 — conflicting values, not silently resolved)

- **NRIC** — BVPS conflict: ours 72.53 vs Chukul Net Worth 109.02. P/B derived
  from our BVPS (11.03) and flagged; needs manual review.
- **CORBL** — 52w high discrepancy: ours 3,183.00 vs Chukul 2,768.00.
- **SFCL** — 52w high discrepancy: ours 565.00 vs Chukul 440.00.
- (CHCL 52w range was already flagged as derived, not page-displayed.)

## Standing notes

- 0 promoter/public-sum conflicts. 85 stale ownership `asof` records retained
  with warnings (not errors).
- 1 duplicate resolved transparently: JBLB batch-5 vs batch-10 (batch-10 won,
  diffs in `dedup_overrides`).
- 3 derived 52w ranges remain flagged: CHCL, CKHL, CLI.
- CIZL: no valid NEPSE equity listing. DEBL: no NEPSE listing.
