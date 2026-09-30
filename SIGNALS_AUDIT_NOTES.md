# Signals Audit Notes — 2026-10-01

## 1. The 2.42% vs 5.61% conflict — RESOLVED

**Verdict: 2.42% was correct; 5.61% was never real.**

- The stored `trend-relay.json` said **2.42%**; the rendered page said **2.42%**;
  git history shows only one build ever (2.42%); re-running the engine with
  `--no-fetch` reproduces **2.42%** exactly (388 trades, 12.42% maxDD, 5 alerts).
- No artifact in the repo — JSON, page HTML, or git history — contains 5.61%
  for Trend Relay. The browser QA figure (~5.61%) cannot be reproduced from any
  source; the nearest real figure is Momentum's 5.66%, so the QA almost
  certainly misread the Momentum page/tab.
- Code, JSON, and rendered stats were therefore **consistent**; the conflict
  was a QA misread, not a code/JSON/render mismatch.

## 2. Real bugs found in the audit (all fixed)

### 2a. Corrupted corporate-action bars produced fantasy trades (CRITICAL)
The ±10% gap detector keyed on `open / prevClose`, but some feed bars print an
open that was never adjusted — e.g. **NBL 2013-05-09: open 532 vs a 143–145
traded range**. `532/532 = 1.0` → no adjustment triggered → the Reversal
system's position rode a −72.7% phantom drop. The old ledger's worst "trade"
was **NBL −72.49% in 3 days** — a data error, not a market loss.
- Fix: sanitise bars first (clamp `open`/`close` into `[low, high]`; 36,166
  repairs, mostly sub-2% feed noise, 138 bars >10%), then run the gap detector
  on the sanitised series (818 adjustments vs 721 before).
- After the fix the same NBL signal exits **+33.92% at the mean** — the honest
  outcome. Worst trades are now −19.45% / −19.45% / −17.63%, all consistent
  with the coded stops.

### 2b. The 5-session post-gap entry guard was dead code
After reverse-adjustment there are no residual overnight gaps, so the
`>12% → skip 5 sessions` guard could never fire. Removed; only the CA bar
itself (repaired OHLC) skips entries. The header comment also wrongly claimed
the series was "not split-adjusted" while the code adjusted it — corrected.

### 2c. Final value silently excluded open positions
`final_value`/`CAGR` used cash only; up to 10 open positions (≤ Rs 1 Cr
notional) were invisible. Now marked to market (minus exit costs).

### 2d. Drawdown was understated (monthly realised-only equity)
The old curve bucketed realised P&L monthly — intra-month and open-position
losses never appeared (Trend Relay showed 12.42%). Now: weekly
marked-to-market portfolio equity. Trend Relay 12.42% → **20.13%** (Jun 2021 →
Dec 2022 bear market); Reversal 29.28% → **35.64%**; Momentum 14.35% → **15.69%**.

### 2e. T1/T2 targets were displayed but never traded
The simulator exits only via stop/trail/mean rules; targets had zero effect on
the backtest while the page presented them as part of the system. Now
explicitly labelled reference-only (`targets_traded: false`, page copy +
methodology §6).

### 2f. Minor cleanups
Dead `exitS` array, dead `cumFactor`, unused `ema()` removed. Fixed (not
compounding) Rs 10L position sizing now disclosed on-page — it materially
drags CAGR as the portfolio grows. Stale-symbol guard (>90d) added; 0 excluded
this run. Sharpe/Sortino annualised from weekly (labelled; was monthly).

## 3. Reconciled figures (2026-10-01 rebuild, --no-fetch, deterministic)

| System | CAGR | Total | × | Win | Trades | MaxDD | PF | AvgW/L | Hold | Charges | Sharpe | Bench | Alpha |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Momentum | **6.98%** (was 5.66%) | 378.54% | 4.79 | 33.03% | 766 | 15.69% | 2.10 | 29.82/7.01% | 27d | Rs 58.59L | 0.80 | 11.56% | −4.58% |
| Trend Relay | **4.10%** (was 2.42%) | 154.20% | 2.54 | 31.87% | 386 | 20.13% | 1.97 | 26.73/6.35% | 30d | Rs 29.52L | 0.54 | 11.56% | −7.46% |
| Reversal | **−1.04%** (was −2.67%) | −21.58% | 0.78 | 46.22% | 251 | 35.64% | 0.84 | 6.72/7.03% | 9d | Rs 18.52L | −0.18 | 11.56% | −12.60% |

Window 2003-07-17 → 2026-09-29 (23.20y), 315 symbols, Rs 1 Cr, max 10 × Rs 10L
fixed, 0.5% round-trip. Best/worst: NLIC +325.88% / MLBBL −19.45% (Mom);
SICL +246.20% / HLBSL −19.45% (Relay); NBL +33.92% / HATHY −17.63% (Reversal).
Reversal keeps its honest framing: **loses money on NEPSE**.

## 4. Verification performed
- Re-ran old engine `--no-fetch`: reproduced 5.66/2.42/−2.67 exactly (deterministic).
- New engine: CAGR and maxDD independently recomputed from JSON (Python) — exact match.
- All ledger fields consumed by the page JS verified present; page scripts pass `node --check`.
- 36,166 repairs / 818 adjustments cross-checked against an independent scan.
- No look-ahead: signals use data ≤ signal bar; entries at signal close
  (disclosed); stops use bar low with gap-through at close.

## 5. Deliverables (branch `feature/signals-audit`, NOT deployed)
- `tools/build-signals.js` — fixed engine
- `nepse-chart/data/signals/{momentum,trend-relay,reversal}.json` — rebuilt
- `SIGNALS_METHODOLOGY.md` — every formula
- `nepse-signals/{momentum,trend-relay,reversal}/index.html` — new figures, ledger UI (filter/sort/paginate), methodology links
- `nepse-signals/methodology/index.html` — NEW public methodology page
- `SIGNALS_AUDIT_NOTES.md` — this file

## 6. Open limitations (disclosed on-page and in methodology)
Inferred (not official) CA factors; fixed sizing understates compounding;
cash dividends not received; entries assume the close is tradable; one
realised history.
