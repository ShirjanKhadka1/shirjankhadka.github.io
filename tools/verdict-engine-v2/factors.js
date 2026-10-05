'use strict';
/* Durable factor library for the Verdict-Engine Supremacy program.
 *
 * Six surviving factors from P5 (p5-factor-prototypes.md). Trailing-only:
 * every value at index i depends on bars <= i ONLY. No look-ahead anywhere.
 *
 * Bar shape (as produced by backtest/data.js loadSymbol):
 *   { ymd, date, open, high, low, close, volume, turnover }
 * where ymd is a YYYYMMDD number. computeAll also accepts raw mirror rows
 * [ymd, open, high, low, close, qty, turnover].
 *
 * Circuit regime: ±10% before 2026-04-20, ±15% from 2026-04-20 (NEPSE moved
 * the price limit on 2026-04-20). The limit in force on day j is determined
 * by bar j's own ymd.
 *
 * API:
 *   computeAll(bars) -> [{ ymd, f_circuit_n60, f_markup_asym, f_vol_surge,
 *                          f_turnover_spike, f_slowbleed_v2, f_mom20 }, ...]
 *   with null where history is insufficient (see per-factor notes below).
 *   Bars are sorted ascending by ymd internally (input is NOT mutated);
 *   output order follows the sorted order.
 *
 * Each standalone factor function takes (bars, i) and returns a scalar or
 * null. Standalone functions do NOT sort; they assume bars are already
 * chronological session order.
 */

/* Circuit-limit regime cutover: ymd < 20260420 -> 0.10, else 0.15. */
const CIRCUIT_CUTOVER = 20260420;

/** Circuit limit in force on the day with this ymd. */
function limitFor(ymd) {
  return ymd < CIRCUIT_CUTOVER ? 0.10 : 0.15;
}

function isNum(x) { return typeof x === 'number' && isFinite(x); }

/**
 * FACTOR 1 — circuitCount60(bars, i)
 * ---------------------------------------------------------------------------
 * Number of limit-up days in the trailing 60 sessions ending at i (P5:
 * "Circuit clustering", the strongest factor in the kit).
 *
 * Formula:
 *   window W = [max(1, i-59), i]                       // 60 sessions ending at i
 *   circuitCount60 = |{ j in W : (close_j - close_{j-1}) / close_{j-1}
 *                        >= limitFor(ymd_j) * 0.999 }|
 *
 * Choices documented:
 *   - prevClose = the previous SESSION's close (bars[j-1].close), not the
 *     previous day's open/high; this matches "compared to the prior close"
 *     as NEPSE publishes the % change against the prior close.
 *   - The 0.999 factor guards against floating-point rounding on prices that
 *     print exactly at the limit (e.g. a 9.999% rounding vs the 10% limit);
 *     a day must be at/above the limit to count, matching P5 §5.
 *   - The applicable limit is read from bar j's OWN ymd (regime in force on
 *     day j), since the limit changed on 2026-04-20 mid-history.
 *   - Warm-up (i < 59): count over the AVAILABLE sessions [1, i]. This is a
 *     partial-window count and is NOT cross-sectionally comparable to full
 *     windows; downstream agents should gate cross-sectional work on i >= 59
 *     (i.e. require a full 60-session window) for comparability with P5's
 *     full-sample ICs. Returned as-is so thin mirrors still produce values.
 *   - Null only when i < 1: with no previous session there is nothing to
 *     compare a close against, so a limit-up day cannot be detected.
 *   - prevClose <= 0 or non-finite -> that j is skipped (data-quality guard).
 *
 * Economic prior: BEARISH — repeated limit-ups mark exhaustion/distribution,
 * not strength (P5: IC -0.06..-0.08, fired before 15-16 of 16 pump peaks).
 */
function circuitCount60(bars, i) {
  if (!Array.isArray(bars) || i < 1 || i >= bars.length) return null;
  let count = 0;
  const from = Math.max(1, i - 59);
  for (let j = from; j <= i; j++) {
    const c = bars[j].close, p = bars[j - 1].close;
    if (!isNum(c) || !isNum(p) || p <= 0) continue;
    const lim = limitFor(bars[j].ymd) * 0.999;
    if ((c - p) / p >= lim) count++;
  }
  return count;
}

/**
 * FACTOR 2 — markupAsym60(bars, i)
 * ---------------------------------------------------------------------------
 * 60-day max run-up divided by 60-day max drawdown (P5: "Markup asymmetry",
 * the parabolic-shape detector).
 *
 * Formula (window W = [i-59, i], 60 bars, indices k <= j within W):
 *   maxRunup = max(high_j / low_k)    for k <= j in W     // ratio, e.g. 1.5 = +50%
 *   maxDD    = max(high_k / low_j)    for k <= j in W     // ratio >= 1, e.g. 1.2 = -20% drawdown
 *   markupAsym60 = maxRunup / maxDD
 *
 * Choices documented:
 *   - Intraday high/low (not close) are used, matching P5's "max run-up /
 *     max drawdown" definition: the largest peak-to-trough move anywhere
 *     inside the window. Using close-only would understate both legs.
 *   - Pairs with low <= 0 or non-finite are skipped (data-quality guard).
 *   - Null when i < 59 (fewer than 60 bars of history): the window is
 *     fixed at 60 sessions so values are comparable across symbols/dates.
 *   - Complexity O(60^2) per call — trivial at 750 bars/symbol.
 *
 * Economic prior: BEARISH — high ratio = straight-up, pullback-free advance
 * (the operator footprint); untested moves fail (P5: fired before 14/16 pumps).
 */
function markupAsym60(bars, i) {
  if (!Array.isArray(bars) || i < 59 || i >= bars.length) return null;
  let maxRunup = 1, maxDD = 1;
  for (let j = i - 59; j <= i; j++) {
    const hj = bars[j].high;
    if (!isNum(hj) || hj <= 0) continue;
    for (let k = i - 59; k <= j; k++) {
      const hk = bars[k].high, lk = bars[k].low, lj = bars[j].low;
      if (isNum(lk) && lk > 0) {
        const r = hj / lk;
        if (r > maxRunup) maxRunup = r;
      }
      if (isNum(hk) && hk > 0 && isNum(lj) && lj > 0) {
        const r = hk / lj;
        if (r > maxDD) maxDD = r;
      }
    }
  }
  return maxRunup / maxDD;
}

/**
 * FACTOR 3 — volSurge(bars, i)
 * ---------------------------------------------------------------------------
 * Abnormal turnover: log ratio of 20-day turnover to the prior 120-day
 * baseline (P5: "Volume surge", the distribution tell).
 *
 * Formula:
 *   S20  = sum(turnover[i-19 .. i])          // 20 sessions incl. i
 *   S120 = sum(turnover[i-139 .. i-20])      // 120 sessions BEFORE that block
 *   volSurge = log( S20 / (S120 / 6) )
 *
 * Choices documented:
 *   - S120/6 = 20 x mean(120d), S20 = 20 x mean(20d), so the ratio is exactly
 *     mean(20d) / mean(120d); log() makes it symmetric in log space.
 *   - Null when i < 139 (needs 140 sessions total), when the baseline sum
 *     is <= 0/non-finite, or when the ratio is <= 0/non-finite (log domain
 *     guard). Index bars carry turnover 0 -> null for index series; use the
 *     per-symbol mirror for this factor.
 *
 * Economic prior: BEARISH — abnormal volume leans distribution, not
 * accumulation, on NEPSE (P5: IC ~-0.02..-0.03, weak alone, combine only).
 */
function volSurge(bars, i) {
  if (!Array.isArray(bars) || i < 139 || i >= bars.length) return null;
  let s20 = 0, s120 = 0;
  for (let j = i - 19; j <= i; j++) {
    const t = bars[j].turnover;
    if (!isNum(t) || t < 0) return null;   // dirty data -> abstain, not 0
    s20 += t;
  }
  for (let j = i - 139; j <= i - 20; j++) {
    const t = bars[j].turnover;
    if (!isNum(t) || t < 0) return null;
    s120 += t;
  }
  if (s120 <= 0) return null;
  const ratio = s20 / (s120 / 6);
  if (ratio <= 0 || !isFinite(ratio)) return null;
  return Math.log(ratio);
}

/**
 * FACTOR 4 — turnoverSpike(bars, i)
 * ---------------------------------------------------------------------------
 * Climax-volume flag: log of today's turnover vs the median of the prior
 * 60 sessions (P5: "Turnover spike", short-term reversal flag).
 *
 * Formula:
 *   turnoverSpike = log( turnover_i / median(turnover[i-60 .. i-1]) )
 *
 * Choices documented:
 *   - Median (not mean) baseline: robust to the prior 60d containing its own
 *     earlier spikes, so only a genuinely new climax day fires.
 *   - Null when i < 60 (needs 60 prior sessions), when the median is <= 0,
 *     or when turnover_i is <= 0/non-finite.
 *
 * Economic prior: BEARISH — climax volume predicts 5-10 session weakness
 * (P5: IC ~-0.037; the T+2-lag variant was REJECTED, keep generic reversal).
 */
function turnoverSpike(bars, i) {
  if (!Array.isArray(bars) || i < 60 || i >= bars.length) return null;
  const t0 = bars[i].turnover;
  if (!isNum(t0) || t0 <= 0) return null;
  const base = [];
  for (let j = i - 60; j <= i - 1; j++) {
    const t = bars[j].turnover;
    if (!isNum(t) || t < 0) return null;   // dirty data -> abstain
    base.push(t);
  }
  base.sort((a, b) => a - b);
  const med = (base[29] + base[30]) / 2;
  if (med <= 0) return null;
  return Math.log(t0 / med);
}

/**
 * FACTOR 5 — slowBleedV2(bars, i)
 * ---------------------------------------------------------------------------
 * Quiet-distribution signature (P5: "Slow-bleed v2", EXPERIMENTAL — needs
 * fresh labels before engine use).
 *
 * Formula (window W = [i-59, i]):
 *   rangeCond = (maxHigh_W - minLow_W) / minLow_W < 0.30
 *   volCond   = mean(turnover_W) / mean(turnover[i-179 .. i-60]) >= 1.5
 *   quietCond = circuitCount60(bars, i) == 0
 *   slowBleedV2 = 1 if (rangeCond AND volCond AND quietCond) else 0
 *
 * Thresholds (from the P5 v1 autopsy, measured on the 5 slow-bleed labels):
 *   - range < 30% : real pre-cliff 60d ranges ran 9.8%-23.4%; the v1 20%
 *     cutoff excluded CITY (21.0%) and OHL (23.4%). 30% keeps all 5 in.
 *   - volume ratio >= 1.5x : episodes ran 1.5-3.6x baseline volume.
 *   - zero limit-up days : pumped stocks scream (circuits); distributed
 *     stocks go quiet. This is the key refinement vs v1.
 *   - baseline volume window = the 120 sessions immediately before W
 *     ([i-179, i-60]); arithmetic means, not sums, so no scale assumption.
 * Null when i < 179 (needs 180 sessions), when baseline volume mean <= 0,
 * or when minLow <= 0.
 *
 * Economic prior: BEARISH — flat price + heavy volume + no limit-ups =
 * somebody selling into apathy (P5: IC -0.035..-0.057, fired before 4/5
 * cliffs 10 sessions out, but only 5 labels: promising, not proven).
 */
function slowBleedV2(bars, i) {
  if (!Array.isArray(bars) || i < 179 || i >= bars.length) return null;
  let maxHigh = -Infinity, minLow = Infinity;
  let volSum = 0, baseSum = 0;
  for (let j = i - 59; j <= i; j++) {
    const h = bars[j].high, l = bars[j].low, t = bars[j].turnover;
    if (!isNum(h) || !isNum(l) || !isNum(t) || t < 0) return null;
    if (h > maxHigh) maxHigh = h;
    if (l < minLow) minLow = l;
    volSum += t;
  }
  if (!(minLow > 0)) return null;
  for (let j = i - 179; j <= i - 60; j++) {
    const t = bars[j].turnover;
    if (!isNum(t) || t < 0) return null;
    baseSum += t;
  }
  const baseMean = baseSum / 120;
  if (baseMean <= 0) return null;
  const rangeCond = (maxHigh - minLow) / minLow < 0.30;
  const volCond = (volSum / 60) / baseMean >= 1.5;
  const quietCond = circuitCount60(bars, i) === 0;
  return (rangeCond && volCond && quietCond) ? 1 : 0;
}

/**
 * FACTOR 6 — mom20(bars, i)
 * ---------------------------------------------------------------------------
 * 20-session return (P5: "Momentum baseline" — surprise finding: it is
 * NEGATIVE cross-sectionally on NEPSE).
 *
 * Formula: mom20 = close_i / close_{i-20} - 1
 * Null when i < 20 or close_{i-20} <= 0 / non-finite.
 *
 * Engine note: this factor is INVERTED in the engine — P5 found negative IC
 * (-0.05..-0.07), i.e. cross-sectional winners UNDERPERFORM over 5-20
 * sessions (reversal, not trend). This function returns the RAW return;
 * downstream handles the sign (fade 20d winners). Do not pre-invert here:
 * keep the library factor-definition pure.
 */
function mom20(bars, i) {
  if (!Array.isArray(bars) || i < 20 || i >= bars.length) return null;
  const c = bars[i].close, p = bars[i - 20].close;
  if (!isNum(c) || !isNum(p) || p <= 0) return null;
  return c / p - 1;
}

/* --- bar normalization: accept {ymd,...,turnover} objects or raw mirror
 * rows [ymd, open, high, low, close, qty, turnover]. --- */
function normalizeBar(b) {
  if (Array.isArray(b) && b.length >= 7) {
    return {
      ymd: +b[0] || 0, open: +b[1] || 0, high: +b[2] || 0, low: +b[3] || 0,
      close: +b[4] || 0, volume: +b[5] || 0, turnover: +b[6] || 0,
    };
  }
  return {
    ymd: +b.ymd || 0, open: +b.open || 0, high: +b.high || 0, low: +b.low || 0,
    close: +b.close || 0, volume: +b.volume || 0, turnover: +b.turnover || 0,
  };
}

/**
 * computeAll(bars) — factor panel for one symbol.
 * Sorts a normalized copy of bars ascending by ymd (input untouched).
 * Output: [{ ymd, f_circuit_n60, f_markup_asym, f_vol_surge,
 *            f_turnover_spike, f_slowbleed_v2, f_mom20 }, ...]
 * Every value at index i uses only bars <= i. Nulls appear only in the
 * warm-up region (deepest factor, slowBleedV2, needs 180 sessions).
 */
function computeAll(bars) {
  const n = bars.map(normalizeBar)
    .filter((b) => b.ymd > 0 && b.close > 0)
    .sort((a, b) => a.ymd - b.ymd);
  const out = new Array(n.length);
  for (let i = 0; i < n.length; i++) {
    out[i] = {
      ymd: n[i].ymd,
      f_circuit_n60: circuitCount60(n, i),
      f_markup_asym: markupAsym60(n, i),
      f_vol_surge: volSurge(n, i),
      f_turnover_spike: turnoverSpike(n, i),
      f_slowbleed_v2: slowBleedV2(n, i),
      f_mom20: mom20(n, i),
    };
  }
  return out;
}

module.exports = {
  CIRCUIT_CUTOVER,
  limitFor,
  circuitCount60,
  markupAsym60,
  volSurge,
  turnoverSpike,
  slowBleedV2,
  mom20,
  computeAll,
};
