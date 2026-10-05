'use strict';
/* ============================================================================
 * lifecycle.js — Verdict Engine v2: causal phase tracker.
 *
 * Adapted from the lifecycle study's rule-based mapper
 * (hidden_files/universe/lifecycle-study.js, R3–R8), hardened for causal use:
 *
 *   trackPhases(bars) -> { phases, openPhase }
 *     phases: [{type, startIdx, endIdx, confirmedAt, ...details}]
 *     type ∈ {ignition, supply_zone, markup, top_distribution, drawdown,
 *             base_building, recovery}
 *
 * CAUSALITY CONTRACT:
 *   - A phase interval [startIdx, endIdx] is derived from bars ≤ endIdx only,
 *     plus at most the single "break" bar endIdx+1 that told the detector the
 *     phase had ended. That bar is recorded as `confirmedAt` (≤ endIdx+1).
 *   - No detector reads beyond confirmedAt. Nothing downstream of a phase
 *     (e.g. breakout search) starts before confirmedAt.
 *   - The study's honest note (new-listing-lifecycle §2b) is kept: rule-based
 *     detectors miss trending-with-pauses shapes (SYPNL was misclassified as
 *     counter-stalled). A trending-pause detector is included as an
 *     EXPERIMENTAL variant, explicitly flagged — refinement is open work.
 *
 *   phaseAt(phases, i) -> the phase covering index i (most specific match),
 *     or null. Historical description only — it does not re-detect.
 *
 * Bar shape: {ymd, open, high, low, close, volume, turnover} (chronological).
 * ========================================================================= */

const { limitFor } = require('./factors.js');

function isNum(x) { return typeof x === 'number' && isFinite(x); }

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2;
}

/* R3 (study): tick-aware limit-up — 0.995×limit tolerance (genuine NEPSE
 * circuits print 9.97–10.03%). Session 0 uses open as the reference. */
function isLimitUp(bars, j) {
  if (j < 0 || j >= bars.length) return false;
  const b = bars[j];
  const ref = j === 0 ? b.open : bars[j - 1].close;
  if (!(ref > 0) || !isNum(b.close)) return false;
  return (b.close / ref - 1) >= limitFor(b.ymd) * 0.995;
}

function isLimitDown(bars, j) {
  if (j < 0 || j >= bars.length) return false;
  const b = bars[j];
  const ref = j === 0 ? b.open : bars[j - 1].close;
  if (!(ref > 0) || !isNum(b.close)) return false;
  return (b.close / ref - 1) <= -limitFor(b.ymd) * 0.995;
}

/* R4 (study): ignition = first limit-up within sessions 0–4, consecutive run.
 * confirmedAt = endIdx+1 (the bar that broke the run; series end if open). */
function detectIgnition(bars) {
  for (let j = 0; j <= 4 && j < bars.length; j++) {
    if (isLimitUp(bars, j)) {
      let e = j;
      while (e + 1 < bars.length && isLimitUp(bars, e + 1)) e++;
      return {
        type: 'ignition',
        startIdx: j,
        endIdx: e,
        confirmedAt: Math.min(e + 1, bars.length - 1),
        days: e - j + 1,
        lastClose: bars[e].close,
        multiple: bars[0].open > 0 ? bars[e].close / bars[0].open : null,
      };
    }
  }
  return null;
}

/* R5 (study): supply-zone detector, causal.
 * A zone [s, e] confirmed at e: ≥5 sessions, range <25%, mean turnover ≥2×
 * the median turnover of the 20 sessions before s (≥3 baseline sessions).
 * Extension: keep extending while the next bar keeps range <25%.
 * Uses only bars ≤ confirmedAt (= e+1 after extension, or the break bar).
 *
 * maxIdx: never read beyond this bar (causality bound for incremental use).
 * Returns { zones, lastConfirmedAt }.
 */
function detectZones(bars, startFrom, maxIdx) {
  const n = Math.min(bars.length, maxIdx + 1);
  const zones = [];
  let s = Math.max(0, startFrom);
  while (s <= n - 5) {
    const b0 = Math.max(0, s - 20);
    const base = [];
    for (let k = b0; k < s; k++) base.push(bars[k].turnover);
    if (base.length < 3) { s++; continue; }
    const baseMed = median(base);
    if (!(baseMed > 0)) { s++; continue; }
    let mx = -Infinity, mn = Infinity, tv = 0, e = -1, mxE = 0, mnE = 0;
    let broke = -1;
    for (let cand = s; cand < n; cand++) {
      const b = bars[cand];
      if (b.high > mx) mx = b.high;
      if (b.low < mn) mn = b.low;
      tv += b.turnover;
      if (cand < s + 4) continue;                 // need ≥5 sessions
      const range = mn > 0 ? (mx - mn) / mn : Infinity;
      if (range >= 0.25) { broke = cand; break; } // range blown: break bar
      const meanT = tv / (cand - s + 1);
      if (e < 0 && meanT >= 2.0 * baseMed) { e = cand; mxE = mx; mnE = mn; }
    }
    if (e < 0) { s++; continue; }                  // never confirmed from s
    // extend while range stays <25% (volume gate only at detection)
    mx = mxE; mn = mnE;
    let ee = e;
    while (ee + 1 < n) {
      const nmx = Math.max(mx, bars[ee + 1].high);
      const nmn = Math.min(mn, bars[ee + 1].low);
      if (nmn <= 0 || (nmx - nmn) / nmn >= 0.25) { broke = ee + 1; break; }
      mx = nmx; mn = nmn; ee++;
    }
    const confirmedAt = broke >= 0 ? broke : ee;   // open zone: confirmed at last bar
    zones.push({
      type: 'supply_zone', startIdx: s, endIdx: ee, confirmedAt,
      high: mx, low: mn, sessions: ee - s + 1,
      open: broke < 0,                             // still open at series end
    });
    s = ee + 1;
  }
  return zones;
}

/* R6 (study): first close above zone high after the zone ends.
 * Search starts at zone.confirmedAt — causal. */
function firstBreakout(bars, zone) {
  for (let i = zone.confirmedAt; i < bars.length; i++) {
    if (isNum(bars[i].close) && bars[i].close > zone.high) return i;
  }
  return null;
}

/* EXPERIMENTAL trending-pause detector (study §2b open work): inside a
 * markup run, a rolling 10-session range <25% while the 20d return is >+15%
 * is a pause inside an uptrend, not a failed zone. Flagged experimental and
 * untested — the study recorded this refinement as open, not proven. */
function detectTrendingPauses(bars, fromIdx, toIdx) {
  const cands = [];
  for (let s = fromIdx; s + 9 <= toIdx; s++) {
    let mx = -Infinity, mn = Infinity;
    for (let k = s; k <= s + 9; k++) {
      if (bars[k].high > mx) mx = bars[k].high;
      if (bars[k].low < mn) mn = bars[k].low;
    }
    if (!(mn > 0)) continue;
    const range = (mx - mn) / mn;
    const p20 = s >= 20 && bars[s - 20].close > 0
      ? bars[s].close / bars[s - 20].close - 1 : null;
    if (range < 0.25 && p20 !== null && p20 > 0.15) {
      cands.push({ s, e: s + 9, mx, mn, p20 });
    }
  }
  // merge overlapping/adjacent pause windows into single phases
  const pauses = [];
  for (const c of cands) {
    const lastP = pauses[pauses.length - 1];
    if (lastP && c.s <= lastP.endIdx + 1) {
      lastP.endIdx = Math.max(lastP.endIdx, c.e);
      lastP.confirmedAt = lastP.endIdx;
      lastP.high = Math.max(lastP.high, c.mx);
      lastP.low = Math.min(lastP.low, c.mn);
      lastP.sessions = lastP.endIdx - lastP.startIdx + 1;
    } else {
      pauses.push({
        type: 'supply_zone', variant: 'trending_pause', experimental: true,
        startIdx: c.s, endIdx: c.e, confirmedAt: c.e,
        high: c.mx, low: c.mn, sessions: 10, pause_20d_return: c.p20,
      });
    }
  }
  return pauses;
}

/**
 * trackPhases(bars) — causal phase map.
 * Phases are emitted once confirmed; each uses only bars ≤ confirmedAt.
 * Returns { phases, openPhase } where openPhase is the phase covering the
 * last bar (or the last confirmed phase, or null).
 */
function trackPhases(bars) {
  if (!Array.isArray(bars) || bars.length < 5) {
    return { phases: [], openPhase: null, note: 'fewer than 5 sessions — no phases detected' };
  }
  const n = bars.length;
  const phases = [];

  // 1. Ignition
  const ignition = detectIgnition(bars);
  if (ignition) phases.push(ignition);

  // 2. Supply zones (first cycle; start after ignition or at session 5)
  const zoneStart = ignition ? ignition.endIdx + 1 : 5;
  const zones = detectZones(bars, zoneStart, n - 1);
  for (const z of zones) phases.push(z);

  // 3. Breakout → markup → top/distribution (first closed zone only, for now)
  let markup = null, top = null;
  const zone = zones.find((z) => !z.open) || null;
  if (zone) {
    const bi = firstBreakout(bars, zone);
    if (bi !== null) {
      // running peak after breakout; top confirms on −30% (study R8)
      let peakIdx = bi, peakClose = bars[bi].close;
      let confirmIdx = -1;
      for (let i = bi + 1; i < n; i++) {
        const c = bars[i].close;
        if (isNum(c) && c > peakClose) { peakClose = c; peakIdx = i; }
        if (isNum(c) && peakClose > 0 && c / peakClose - 1 <= -0.30) {
          confirmIdx = i; break;
        }
      }
      if (confirmIdx > 0) {
        markup = {
          type: 'markup', startIdx: bi, endIdx: peakIdx, confirmedAt: confirmIdx,
          peakClose, breakoutIdx: bi, peakIdx,
          multiple: bars[0].open > 0 ? peakClose / bars[0].open : null,
        };
        phases.push(markup);
        top = {
          type: 'top_distribution', startIdx: peakIdx, endIdx: confirmIdx,
          confirmedAt: confirmIdx, peakClose, decline: bars[confirmIdx].close / peakClose - 1,
        };
        phases.push(top);
        // experimental trending pauses inside the confirmed markup window
        for (const p of detectTrendingPauses(bars, bi, peakIdx)) phases.push(p);
      } else {
        // markup still open (no −30% yet): peak is provisional, phase unconfirmed
        markup = {
          type: 'markup', startIdx: bi, endIdx: n - 1, confirmedAt: n - 1,
          peakClose, breakoutIdx: bi, peakIdx, open: true,
          multiple: bars[0].open > 0 ? peakClose / bars[0].open : null,
          note: 'no −30% decline yet — peak provisional, phase unconfirmed',
        };
        phases.push(markup);
      }
    }
  }

  // 4. Drawdown: from the confirmed top, until close recovers ≥10% off the
  // running low (recovery signal) or the series ends.
  if (top) {
    let lowIdx = top.endIdx, low = bars[top.endIdx].close;
    let recIdx = -1;
    for (let i = top.endIdx + 1; i < n; i++) {
      const c = bars[i].close;
      if (isNum(c) && c < low) { low = c; lowIdx = i; }
      if (isNum(c) && low > 0 && c / low - 1 >= 0.10) { recIdx = i; break; }
    }
    const ddEnd = recIdx > 0 ? recIdx - 1 : n - 1;
    const drawdown = {
      type: 'drawdown', startIdx: top.endIdx, endIdx: ddEnd,
      confirmedAt: recIdx > 0 ? recIdx : n - 1,
      troughIdx: lowIdx, troughClose: low,
      depth_pct: top.peakClose > 0 ? low / top.peakClose - 1 : null,
      open: recIdx < 0,
    };
    phases.push(drawdown);

    // 5. Base building: ≥20 sessions after the trough with range <30%.
    // Confirmed when the 20th range-holding session completes.
    if (recIdx < 0) {
      let mx = -Infinity, mn = Infinity, baseStart = lowIdx + 1, base = null;
      for (let i = lowIdx + 1; i < n; i++) {
        if (bars[i].high > mx) mx = bars[i].high;
        if (bars[i].low < mn) mn = bars[i].low;
        if (!(mn > 0)) continue;
        if ((mx - mn) / mn >= 0.30) { mx = bars[i].high; mn = bars[i].low; baseStart = i; continue; }
        if (i - baseStart + 1 >= 20) {
          base = {
            type: 'base_building', startIdx: baseStart, endIdx: i,
            confirmedAt: i, high: mx, low: mn, sessions: i - baseStart + 1,
          };
          phases.push(base);
          break;
        }
      }
    }

    // 6. Recovery: close ≥10% off the trough close (R8 bounce criterion).
    // Open-ended; ends only if a new high ≥ the old peak prints (cycle reset).
    if (recIdx > 0) {
      let resetIdx = -1;
      for (let i = recIdx; i < n; i++) {
        const c = bars[i].close;
        if (isNum(c) && top.peakClose > 0 && c >= top.peakClose) { resetIdx = i; break; }
      }
      phases.push({
        type: 'recovery', startIdx: recIdx, endIdx: resetIdx > 0 ? resetIdx : n - 1,
        confirmedAt: recIdx, troughIdx: lowIdx, troughClose: low,
        bounce_pct: bars[recIdx].close / low - 1,
        open: resetIdx < 0,
        cycle_reset: resetIdx > 0,
      });
    }
  }

  // sort by startIdx for readability (detection order preserved in practice)
  phases.sort((a, b) => a.startIdx - b.startIdx);

  // openPhase: phase covering the last bar, most specific wins
  const last = n - 1;
  const covering = phases.filter((p) => p.startIdx <= last && p.endIdx >= last);
  const openPhase = covering.length
    ? covering.reduce((a, b) => (b.startIdx >= a.startIdx ? b : a))
    : (phases.length ? phases[phases.length - 1] : null);

  return { phases, openPhase };
}

/**
 * phaseAt(phases, i) — phase covering index i. On overlap (e.g. an
 * experimental trending-pause inside markup), the most specific (latest
 * startIdx) wins. Returns null if no phase covers i.
 */
function phaseAt(phases, i) {
  if (!Array.isArray(phases)) return null;
  const hits = phases.filter((p) => p.startIdx <= i && i <= p.endIdx);
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.startIdx >= a.startIdx ? b : a));
}

module.exports = { trackPhases, phaseAt, isLimitUp, isLimitDown, detectZones };
