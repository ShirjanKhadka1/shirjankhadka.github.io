# Signal Systems Methodology — Nepse Decode Alpha Lab

Every number published on the `/nepse-signals/` pages is produced by
`tools/build-signals.js` and nothing else. This document states every rule,
formula, and assumption exactly as coded, so any figure can be traced and
reproduced. Run `node tools/build-signals.js --no-fetch` to reproduce the
published JSONs byte-for-stat (only `generated_at` changes).

**Status:** educational research, not investment advice. Past performance does
not predict future results.

---

## 1. Data

- **Source:** daily OHLCV per NEPSE symbol from the open
  `samirwagle/Nepse-All-Scraper` dataset (MIT licence), cached under
  `tools/.cache/signals/`. No fabricated bars; `--no-fetch` rebuilds purely
  from the cache.
- **Universe:** every symbol in `nepse-chart/data/universe.json` with ≥ 250
  valid sessions. Symbols whose last bar is more than 90 days older than the
  newest bar in the dataset are excluded as stale/delisted (count published
  in `stats.data_quality.symbols_excluded_stale`).
- **Sample period:** 2003-07-17 → 2026-09-29 (≈ 23.2 years), set by the NEPSE
  index series in `js/nepse-daily.js`. Individual symbols start later; signals
  are evaluated from each symbol's 61st bar.
- **Cash dividends are not received** in the simulation (the price series does
  not adjust for them either way); this slightly understates returns of
  high-dividend stocks. Stated as a limitation, not modelled.

## 2. Data sanitisation (applied before anything else)

The feed contains bars with impossible OHLC — e.g. NBL on 2013-05-09 printed
`open 532` against a `143–145` traded range (an unadjusted corporate-action
open). Such bars corrupt ATR, stops, and the corporate-action detector.

1. Drop bars with non-positive OHLC, `high < low`, or a malformed date.
2. Sort by date; de-dupe keeping the last bar per date.
3. **Repair:** if `open` or `close` falls outside the bar's own `[low, high]`,
   clamp it into the range. The traded range is the more reliable record of
   where trading happened. Every repair is counted and published as
   `stats.data_quality.bars_repaired` (36,166 in the current build — mostly
   sub-2% feed noise, plus 138 bars deviating >10%).

## 3. Corporate-action adjustment

NEPSE enforces a ±10% daily circuit, so an overnight gap beyond ±10% cannot be
a real market move — it is a bonus/split/rights adjustment (or a bad tick).

- On the sanitised series, if `open / prevClose` is outside `[0.90, 1.10]`,
  **all prior bars are reverse-adjusted**: `O/H/L/C × ratio`,
  `volume ÷ ratio`, turnover (value) unchanged, where `ratio = open/prevClose`.
- The bar where the gap is detected is flagged (`caBar`); **no new entries**
  are taken on that bar (its OHLC was repaired).
- Adjustments are counted and published as
  `stats.data_quality.corporate_action_adjustments` (818 in the current build).
- **Honest limitation:** the factor is inferred from price continuity, not from
  the official corporate-action record. Multi-day adjustments, adjustments
  recorded without a clean overnight gap, and genuine >10% gaps from the
  pre-circuit era can be misread. This is the engine's largest known error
  source. Where the official record is available it should replace the
  heuristic (not yet implemented).

## 4. Indicators (all causal — bar `i` uses data up to `i` only)

- `SMA(n)`: simple moving average of closes.
- `RSI(14)`: Wilder's RSI, seeded with the simple average of the first 14
  changes, then `avgGain = (prevAvgGain×13 + gain)/14` (same for loss);
  `RSI = 100 − 100/(1 + RS)`; `RS = 0 → 100`.
- `ATR(14)`: Wilder's smoothing of the true range
  `max(h−l, |h−prevC|, |l−prevC|)`.
- Bollinger `(20, 2)`: `mid = SMA(20)`, `lower = mid − 2σ` (population σ).
- `turn20` = 20-day SMA of turnover (Rs); `vma20` = 20-day SMA of volume.

## 5. Entry rules

Entries are taken **at the signal day's close** (the signal is computable only
once the close prints — this is the standard assumption and is disclosed, not
hidden). One position per symbol; max 10 concurrent positions; a signal in a
symbol that already has an open position is skipped.

All systems require the liquidity filter: **20-day average turnover > Rs 10 lakh**.

### Momentum — `Donchian-50 breakout + trend filter`
- Setup: `close > SMA50` AND `SMA20 > SMA50`.
- Trigger: `close > max(close of prior 50 sessions, excluding today)`.
- Filter: `55 ≤ RSI(14) ≤ 80`.

### Trend Relay — `SMA20/SMA50 golden cross + volume`
- Setup: `close < SMA50` on ≥ 20 of the last 30 sessions.
- Trigger: `SMA20` crosses above `SMA50` (prev bar `SMA20 ≤ SMA50`, this bar
  `SMA20 > SMA50`) AND `volume > 1.5 × vma20`.

### Reversal — `RSI(14)<30 + below lower Bollinger Band + bullish rejection`
- Setup: `RSI(14) < 30` AND `close < lower Bollinger Band`.
- Trigger: bullish candle (`close > open`) closing in the top half of its range
  (`close > low + 0.5 × (high − low)`).

## 6. Exits, stops, targets

- **Stop-loss:** fixed at entry — `entry − 2×ATR(14)` (Momentum, Trend Relay),
  `entry − 1.5×ATR(14)` (Reversal). Evaluated on each subsequent bar: if the
  bar's **low** touches the stop, exit at `min(stop, close)` (gap-through
  exits at the close, not the stop — no fantasy fills).
- **Momentum trail:** exit at the close when `close < min(close of prior 20
  sessions, excluding today)`.
- **Trend Relay trail:** exit at the close on a `SMA20` cross back below
  `SMA50`, or after 3 consecutive closes below `SMA50`.
- **Reversal exit:** exit at the close when `close ≥ SMA20` (the mean), or when
  `RSI(14)` crosses above 55 — whichever comes first. No trailing stop.
- **Targets T1/T2 are reference levels only and are NOT traded.** The backtest
  exits solely via the stop/trail/mean rules above. Formulas: Momentum/Trend
  Relay `T1 = entry + 1.5×risk`, `T2 = entry + 3×risk` with `risk = 2×ATR`;
  Reversal `T1 = SMA20`, `T2 = entry + 2×1.5×ATR`. They are shown on the page
  for position management, and the JSON carries
  `stats.data_quality.targets_traded: false`.

## 7. Position sizing and costs

- Start: **Rs 1,00,00,000** (Rs 1 Cr). Each position: **fixed Rs 10,00,000
  notional** (`qty = floor(10,00,000 / entryPrice)`), or 95% of cash if less;
  no entry if notional < Rs 1,00,000. **Position size does not compound** —
  as the portfolio grows past Rs 1 Cr it becomes progressively less invested,
  which drags CAGR down versus a compounding sizer. Deliberate, conservative,
  disclosed.
- **Costs: 0.5% round-trip** (broker + SEBON + DP, simplified): half charged
  at entry, half at exit, on traded value.

## 8. Statistic definitions (all from the trade ledger)

Let `V0 = 1,00,00,000`, `Vf` = final portfolio value =
**cash + open positions marked at their last close − estimated exit costs**.
`T` = sample years (23.20).

| Figure | Formula |
|---|---|
| Total return % | `(Vf − V0) / V0 × 100` |
| CAGR % | `(Vf / V0)^(1/T) − 1`, ×100 |
| Capital multiple | `Vf / V0` |
| Win rate % | winning closed trades / all closed trades × 100 (win = `pnl_rs > 0`, net of costs) |
| Profit factor | Σ winning `pnl_rs` / \|Σ losing `pnl_rs`\| |
| Avg win % / Avg loss % | mean `pnl_rs` of winners (losers) ÷ mean entry notional of winners (losers) × 100 |
| Avg holding days | mean(`hold_days`); entry day = 0, +1 per session held |
| Max drawdown % | deepest peak-to-trough fall of the **weekly marked-to-market equity** curve (cash + open positions, minus exit costs), chronological |
| Sharpe / Sortino | mean / downside-deviation of **weekly** simple portfolio returns × √52 |
| Charges paid | Σ all entry and exit costs (Rs) |
| Benchmark CAGR | NEPSE index buy & hold over the same window: `(last/first)^(1/T) − 1` |
| Alpha %/yr | system CAGR − benchmark CAGR |

- **Equity curve:** one point per ISO week (last trading day): cash + open
  positions at last close − estimated exit costs. Earlier builds used monthly
  realised-P&L-only points, which understated drawdown; the weekly
  marked-to-market curve supersedes it.
- **Best/worst trade:** by `pnl_pct` = `pnl_rs / entry notional × 100`.

## 9. Open alerts vs closed trades

- **Alerts** = positions still open at the dataset's last date, marked to the
  last close (`unrealized_pct` net of entry cost, before exit cost). A system
  with no open positions is flat — "No open positions right now".
- **Ledger** = every closed trade with symbol, rule, entry date/price/qty,
  stop, targets, exit date/price/reason, Rs and % P&L, holding days. The JSON
  carries the most recent 500 (`trade_counts` states the totals).

## 10. What changed in the 2026-10-01 rebuild (vs the 2026-09-30 build)

1. **OHLC sanitisation added** (was missing): 36,166 impossible-OHLC ticks
   repaired. Previously the worst "trade" in the dataset was Reversal short
   NBL −72.49% in 3 days (2013-05-06 → 2013-05-09) — a corrupted
   corporate-action bar (open 532 vs 143–145 range), not a market loss. After
   repair + adjustment the same signal exits +33.92% at the mean.
2. **CA detector now works on sanitised bars**, catching corporate-action
   bars whose raw open was never adjusted (818 adjustments vs 721 before).
   The old 5-session post-gap entry block was dead code after adjustment and
   is removed; only the CA bar itself is skipped.
3. **Final value and CAGR are marked-to-market** (open positions included);
   previously open positions were silently excluded from `final_value`.
4. **Drawdown/Sharpe/Sortino moved to the weekly marked-to-market equity
   curve** (previously monthly realised-P&L only, which understated risk —
   e.g. Trend Relay maxDD 12.42% → 20.13%).
5. **Stale-symbol guard** (data ending >90 days before the newest bar).
6. **Targets explicitly documented as reference-only** (`targets_traded:
   false`); page copy updated to say so.
7. Ledger enriched: every trade now carries qty, notional, stop, targets,
   exit reason, Rs and % P&L, holding days, and the rule that fired.

## 11. Known limitations (read before trusting any figure)

1. Corporate-action factors are inferred, not official (see §3).
2. Fixed Rs 10L notional understates what compounding would show.
3. Cash dividends are not received.
4. Only 315 symbols with ≥250 sessions; delisted-history coverage depends on
   the scraper.
5. Entries at the signal day's close assume the close is tradable — real
   slippage (especially at NEPSE's upper circuit) is not modelled beyond the
   0.5% cost.
6. The backtest is one realised history. Regimes change; nothing here predicts
   the future.
