'use strict';
/* ============================================================================
 * engine.js — Verdict Engine v2: per-symbol verdict generator.
 *
 * generateVerdict({symbol, bars, dossier, regime, asofYmd, opts, fundamentals}) -> verdict
 *
 *   symbol   — e.g. 'RSML'
 *   bars     — price series, chronological. Accepts {ymd,open,high,low,close,
 *              volume,turnover} objects OR raw mirror rows
 *              [ymd,open,high,low,close,qty,turnover]. ymd = YYYYMMDD number.
 *   dossier  — dossiers/{SYM}.json or null (identity/sector/episode history;
 *              trailing signals are derived from bars, never from the dossier)
 *   regime   — 'bull'|'bear'|'sideways'|null (market-wide, from index SMA200)
 *   asofYmd  — YYYYMMDD number the verdict is stamped at (defaults to last bar)
 *   opts.auditNoLookahead — run the causality assertion pass (see below)
 *   fundamentals — optional map symbol -> record from
 *              fundamentals/parsed/fundamentals-merged.json (point-in-time
 *              company-quality context; shown as evidence, never scored)
 *
 * The verdict is a WARNING INSTRUMENT: risk/opportunity flags with evidence.
 * NEVER a buy/sell call, NEVER a "market-beating system" claim.
 *
 * CAUSALITY: every value at index i derives from bars <= i. factors.js is
 * trailing-only; lifecycle.js detectors never read beyond confirmedAt. The
 * auditNoLookahead option recomputes with truncated bars and compares
 * historical factor values + lifecycle intervals — any mismatch is a bug.
 * ========================================================================= */

const F = require('./factors.js');
const R = require('./rules.js');

/* Float/ownership archive (manual/float-archive.json): manually transcribed
 * promoter/public ownership + paid-up shares, verified 2026-10-06 against
 * NEPSE official, Capital Max and Chukul. Primary float source; the
 * lock-in table below is the fallback. */
let FLOAT_ARCHIVE = null;
try {
  FLOAT_ARCHIVE = require('./manual/float-archive.json').stocks || null;
} catch (e) { FLOAT_ARCHIVE = null; }
const L = require('./lifecycle.js');
const B = require('./bsdate.js');

function isNum(x) { return typeof x === 'number' && isFinite(x); }
function ymdStr(ymd) {
  const s = String(Math.round(ymd));
  return s.length === 8 ? s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : null;
}
function median(xs) {
  const s = xs.filter(isNum).sort((a, b) => a - b);
  if (!s.length) return null;
  const n = s.length;
  return n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2;
}
function tsum(bars, i0, i1) {
  let s = 0;
  for (let i = i0; i <= i1; i++) {
    const t = bars[i].turnover;
    if (!isNum(t) || t < 0) return null;
    s += t;
  }
  return s;
}
function addYears(dateStr, years) {
  const p = dateStr.split('-').map(Number);
  return (p[0] + years) + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[2]).padStart(2, '0');
}
function dayDiff(a, b) { // calendar days b - a, 'YYYY-MM-DD'
  const u = (s) => { const p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
  return Math.round((u(b) - u(a)) / 86400000);
}

/* --- bar normalization (objects or raw mirror rows), chronological --- */
function normalizeBars(bars) {
  const out = [];
  for (const b of bars || []) {
    let o;
    if (Array.isArray(b)) {
      o = { ymd: +b[0] || 0, open: +b[1] || 0, high: +b[2] || 0, low: +b[3] || 0,
            close: +b[4] || 0, volume: +b[5] || 0, turnover: +b[6] || 0 };
    } else {
      o = { ymd: +b.ymd || 0, open: +b.open || 0, high: +b.high || 0, low: +b.low || 0,
            close: +b.close || 0, volume: +b.volume || 0, turnover: +b.turnover || 0 };
    }
    if (o.ymd > 0 && o.close > 0) out.push(o);
  }
  out.sort((a, b) => a.ymd - b.ymd);
  return out;
}

/* --- tick-aware circuit detection (rules 5 & 10) ---
 * Tick-aware limit-up: close/prevClose-1 >= limit(ymd)*0.995.
 * Counts toward circuit statistics only if volume >= 500 shares, EXCEPT at
 * listing age <= 10 (withheld-float ignition exemption). */
function limitUpDays(bars, ageSessions) {
  const days = [];
  const exempt = ageSessions <= R.VOLUME_FLOORS.CIRCUIT_MIN_SHARES_EXEMPT_AGE;
  for (let j = 1; j < bars.length; j++) {
    const p = bars[j - 1].close, c = bars[j].close;
    if (!(p > 0) || !isNum(c)) continue;
    if ((c / p - 1) >= F.limitFor(bars[j].ymd) * R.LIMIT_TOLERANCE_IGNITION) {
      days.push({ idx: j, ymd: bars[j].ymd, close: c, volume: bars[j].volume,
                  counted: exempt || bars[j].volume >= R.VOLUME_FLOORS.CIRCUIT_MIN_SHARES,
                  exempt });
    }
  }
  return days;
}
function limitDownDays(bars) {
  const days = [];
  for (let j = 1; j < bars.length; j++) {
    const p = bars[j - 1].close, c = bars[j].close;
    if (!(p > 0) || !isNum(c)) continue;
    if ((c / p - 1) <= -F.limitFor(bars[j].ymd) * R.LIMIT_TOLERANCE_IGNITION) {
      days.push({ idx: j, ymd: bars[j].ymd, close: c, volume: bars[j].volume });
    }
  }
  return days;
}

/* --- experimental short-horizon volume lenses (rule 12, age<60 only) --- */
function volSurge20(bars, i) {
  if (i < 79) return null;
  const s20 = tsum(bars, i - 19, i);
  const s60 = tsum(bars, i - 79, i - 20);
  if (s20 === null || s60 === null || s60 <= 0) return null;
  const r = s20 / (s60 / 3);
  return (r > 0 && isFinite(r)) ? Math.log(r) : null;
}
function turnoverSpike10(bars, i) {
  if (i < 10) return null;
  const t0 = bars[i].turnover;
  if (!isNum(t0) || t0 <= 0) return null;
  const base = [];
  for (let j = i - 10; j <= i - 1; j++) {
    const t = bars[j].turnover;
    if (!isNum(t) || t < 0) return null;
    base.push(t);
  }
  const med = median(base);
  if (!(med > 0)) return null;
  return Math.log(t0 / med);
}

/* --- lock-in block: three source tiers (the hard rule) ---
 * 'user-verified'      — VERIFIED_LISTINGS (Shirjan corrections). Precise
 *                        expiry computed and published.
 * 'lockin-table'       — lockin-table.json (Capital Max IPO Lock-in Period
 *                        seed). Allotment/lock-in dates from the source,
 *                        BS→AD via bsdate.js.
 * 'series_start_proxy' — dossier listing_date = price-series start. expiry
 *                        MUST be null; status estimated-only with
 *                        unverified_estimate:true. A precise date is NEVER
 *                        emitted from proxy data (HATHY hard rule). */
function buildLockin(symbol, bars, dossier, asofDate) {
  const v = R.VERIFIED_LISTINGS[symbol];
  if (v) {
    const expiry = addYears(v.listing_date, R.LOCKIN_YEARS);
    const elapsed = bars.filter((b) => b.ymd >= B.adStrToYmd(v.listing_date)).length;
    const expired = asofDate >= expiry;
    const year = Math.min(3, Math.floor(elapsed / 250) + 1);
    return {
      listing_date: v.listing_date,
      listing_date_source: 'user-verified',
      expiry,
      position: Math.min(1, elapsed / R.LOCKIN_SESSIONS),
      status: expired ? 'expired' : 'in_lockin_year_' + year,
      unverified_estimate: false,
      provenance: 'user-verified',
      note: v.note + (expired
        ? ' Promoters free to sell — live supply overhang, not a pending one ' +
          '(analyst-synthesis §2: bottom capitulation WITH promoters free to sell).'
        : ''),
    };
  }
  const row = R.LOCKIN_TABLE.find((r) => r.symbol === symbol);
  // SITE PATCH 2026-10-05: rows without dates (55 detail-less Open rows in
  // the transcription) fall through to the proxy tier — a NaN precise date
  // would violate the HATHY hard rule worse than no date at all.
  if (row && row.allotment_bs && row.lockin_end_bs) {
    const allotment = B.fmtAd(B.bsStrToAd(row.allotment_bs));
    const lockinEnd = B.fmtAd(B.bsStrToAd(row.lockin_end_bs));
    const expired = asofDate >= lockinEnd;
    const daysLeft = dayDiff(asofDate, lockinEnd);
    const total = dayDiff(allotment, lockinEnd);
    const pos = total > 0 ? Math.min(1, Math.max(0, 1 - daysLeft / total)) : null;
    return {
      listing_date: allotment,
      listing_date_source: 'lockin-table',
      listing_date_note: 'allotment date from Capital Max IPO Lock-in Period table (seed)',
      expiry: lockinEnd,
      expiry_bs: row.lockin_end_bs,
      position: pos,
      days_remaining: expired ? 0 : daysLeft,
      status: expired ? 'expired' : 'in_lockin',
      unverified_estimate: false,
      provenance: 'capitalmax-lockin-table (user screenshot transcription 2026-10-05)',
      note: expired
        ? 'Lock-in EXPIRED per the source table — promoters free to sell (live supply overhang).'
        : daysLeft + ' calendar days to lock-in end per the source table (status: ' + row.status + ').',
    };
  }
  // proxy tier: no precise date, ever
  const age = dossier && dossier.identity ? dossier.identity.age_sessions : bars.length;
  return {
    listing_date: dossier && dossier.identity ? dossier.identity.listing_date : null,
    listing_date_source: 'series_start_proxy',
    expiry: null,
    position: null,
    status: age < R.LOCKIN_SESSIONS ? 'estimated_in_lockin_window' : 'estimated_window_uncertain',
    unverified_estimate: true,
    provenance: R.LOCKIN_PROXY_NOTE,
    note: 'true listing date pending — expiry not published. A precise lock-in ' +
          'expiry is never emitted from series-start proxy data (HATHY hard rule, ' +
          'analyst-synthesis §2).',
  };
}

/* --- float: measured where the archive or lock-in table covers, proxy otherwise --- */
function buildFloat(symbol, dossier) {
  // Tier 1: manually verified ownership archive (primary).
  const arch = FLOAT_ARCHIVE && FLOAT_ARCHIVE[symbol];
  if (arch && arch.float_shares != null) {
    return {
      float_status: 'measured',
      float_shares: arch.float_shares,
      promoter_pct: arch.promoter_pct != null ? arch.promoter_pct / 100 : null,
      float_note: 'public float from Nepse Decode ownership archive (manual transcription, verified 2026-10-06)' +
        (arch.ownership_asof ? '; ownership as of ' + arch.ownership_asof : '') + '.',
      traded_public_pct: null,
    };
  }
  // Tier 2: IPO lock-in table transcription.
  const row = R.LOCKIN_TABLE.find((r) => r.symbol === symbol);
  // SITE PATCH 2026-10-05: a row without share counts is not "measured" —
  // fall through to the proxy tier with its honest label.
  if (row && row.public_shares != null) {
    const total = (row.promoter_shares || 0) + (row.public_shares || 0);
    return {
      float_status: 'measured',
      float_shares: row.public_shares,
      promoter_pct: row.promoter_shares != null && total > 0 ? row.promoter_shares / total : null,
      float_note: 'public shares from Capital Max IPO Lock-in Period table (2026-10-05 full transcription); ' +
                  (row.promoter_shares != null ? 'promoter % = promoter/(promoter+public).'
                   : 'promoter share count not in transcription — promoter % unknown.'),
      traded_public_pct: row.traded_public_pct,
    };
  }
  const paidup = dossier && dossier.identity ? dossier.identity.paidup_b : null;
  return {
    float_status: 'proxy',
    float_shares: null,
    promoter_pct: null,
    float_note: paidup !== null && paidup !== undefined
      ? 'paid-up capital proxy only (' + paidup + 'b); promoter % pending capture'
      : 'no float data — promoter % pending capture',
    traded_public_pct: null,
  };
}

/* ================= trailing measurements (all from bars <= last) ========== */
function measure(bars, panel, dossier, age) {
  const n = bars.length;
  const last = n - 1;
  const f = panel[last];
  const ups = limitUpDays(bars, age);
  const downs = limitDownDays(bars);
  const upsCounted = ups.filter((d) => d.counted);

  const circuit_n60 = upsCounted.filter((d) => d.idx > last - 60).length;
  const recentUp = upsCounted.length ? upsCounted[upsCounted.length - 1] : null;
  const sessionsSinceUp = recentUp ? last - recentUp.idx : null;
  const recencyStale = sessionsSinceUp !== null &&
    sessionsSinceUp > R.RECENCY_DECAY.STALE_AFTER_SESSIONS;

  // ignition: longest tick-aware consecutive limit-up run starting sessions 0–4
  const upIdx = new Set(ups.map((d) => d.idx));
  let ignitionDays = 0;
  for (let j = 0; j <= 4 && j < n; j++) {
    if (upIdx.has(j)) {
      let e = j;
      while (upIdx.has(e + 1)) e++;
      ignitionDays = Math.max(ignitionDays, e - j + 1);
    }
  }

  const ret20 = (last >= 20 && bars[last - 20].close > 0)
    ? bars[last].close / bars[last - 20].close - 1 : null;
  const volMed60 = median(bars.slice(Math.max(0, last - 59), last + 1).map((b) => b.volume));
  const volMed120 = n >= 140
    ? median(bars.slice(last - 139, last - 19).map((b) => b.volume)) : null;

  // drawdown state: trailing peak → trough → current
  let peakIdx = 0;
  for (let i = 1; i < n; i++) if (bars[i].close > bars[peakIdx].close) peakIdx = i;
  const peak = bars[peakIdx];
  let troughIdx = peakIdx, trough = peak.close;
  for (let i = peakIdx; i < n; i++) {
    if (bars[i].close < trough) { trough = bars[i].close; troughIdx = i; }
  }
  const cur = bars[last].close;
  const fromPeak = peak.close > 0 ? cur / peak.close - 1 : null;
  const ddDepth = peak.close > 0 ? trough / peak.close - 1 : null;
  const reclaim50 = (peak.close > trough && trough > 0)
    ? (cur - trough) / (peak.close - trough) >= 0.5 : null;
  const troughVolBase = troughIdx >= 20
    ? median(bars.slice(troughIdx - 20, troughIdx).map((b) => b.volume)) : null;

  const topVol = bars.map((b, i) => ({ i, ymd: b.ymd, qty: b.volume, turnover: b.turnover }))
    .sort((a, b) => b.turnover - a.turnover).slice(0, 3)
    .map((d) => ({ date: ymdStr(d.ymd), qty: d.qty, turnover: d.turnover,
                   context: d.i === peakIdx ? 'peak session' :
                            d.i === troughIdx ? 'trough session' : 'high-turnover day' }));

  const upLast5 = upsCounted.some((d) => d.idx > last - 5);
  const lastDown = downs.length ? downs[downs.length - 1] : null;
  const downLast5 = lastDown && lastDown.idx > last - 5 ? lastDown : null;

  const first10MedVol = median(bars.slice(0, Math.min(10, n)).map((b) => b.volume));
  const paidup = dossier && dossier.identity ? dossier.identity.paidup_b : null;

  // bounce setup (R8): ≥30% drawdown + first close back above 5-session high + 1.5× volume
  const bounce = { eligible: false, active: false, evidence: null };
  if (ddDepth !== null && ddDepth <= -R.BOUNCE_SETUP.DRAWDOWN_MIN && peakIdx < last) {
    bounce.eligible = true;
    const hi5 = Math.max(...bars.slice(Math.max(0, last - 4), last).map((b) => b.high));
    const hi5prev = last >= 2
      ? Math.max(...bars.slice(Math.max(0, last - 5), last - 1).map((b) => b.high)) : null;
    const base20 = last >= 20 ? median(bars.slice(last - 20, last).map((b) => b.volume)) : null;
    const closeAbove = isNum(hi5) && cur > hi5;
    const firstBack = hi5prev === null || !(bars[last - 1].close > hi5prev);
    const volOk = base20 !== null && base20 > 0 &&
      bars[last].volume >= R.BOUNCE_SETUP.VOLUME_MULT * base20;
    bounce.active = closeAbove && firstBack && volOk;
    bounce.evidence = {
      drawdown_depth: ddDepth, trough_date: ymdStr(bars[troughIdx].ymd),
      close_above_5d_high: closeAbove, first_close_back: firstBack,
      volume_vs_20d_baseline: base20 ? bars[last].volume / base20 : null,
      depth_penalty_applies: ddDepth < -R.BOUNCE_SETUP.DEPTH_PENALTY_BEYOND,
    };
  }

  return {
    n, last, f, ups, upsCounted, circuit_n60, recentUp, sessionsSinceUp,
    recencyStale, ignitionDays, ret20, volMed60, volMed120,
    peakIdx, peak, troughIdx, trough, fromPeak, ddDepth, reclaim50,
    troughVolBase, topVol, upLast5, downLast5, first10MedVol, paidup, bounce,
    vol_surge_20: age < R.SHORT_HORIZON.MAX_AGE ? volSurge20(bars, last) : null,
    turnover_spike_10: age < R.SHORT_HORIZON.MAX_AGE ? turnoverSpike10(bars, last) : null,
  };
}

/* --- fundamentals evidence block (rule 13) ---
 * Point-in-time company-quality context from the Capital Max export
 * (2026-10-05, research use). NOT scored — shown as evidence.
 * The key research finding (pump-fundamentals-report.md): pumped new
 * listings don't have weak fundamentals, they have ABSENT fundamentals
 * (75% no EPS vs 10% market). Missing earnings on a young listing is a
 * first-class risk input ("no anchor"), never neutral, never hidden. */
const FUND_CORE_FIELDS = R.FUNDAMENTALS.CORE_FIELDS;
function buildFundamentals(symbol, fundamentals) {
  const rec = fundamentals && fundamentals[symbol] ? fundamentals[symbol] : null;
  if (!rec) {
    return { status: 'absent',
      note: 'no fundamentals record in the 2026-10-05 export (symbol not covered or non-reporting)',
      provenance: R.FUNDAMENTALS.EXPORT_PROVENANCE };
  }
  const missing = FUND_CORE_FIELDS.filter((f) => rec[f] === null || rec[f] === undefined);
  const out = {
    status: rec.fiscal_year ? 'reported' : 'no_financials',
    fiscal_year: rec.fiscal_year || null,
    quarter: rec.quarter || null,
    eps_ttm: rec.eps_ttm ?? null,
    pe_ttm: rec.pe_ttm ?? null,
    bvps: rec.bvps ?? null,
    pb: rec.pb ?? null,
    roe_ttm: rec.roe_ttm ?? null,
    roa_ttm: rec.roa_ttm ?? null,
    npm: rec.npm ?? null,
    netprofit_k: rec.netprofit_k ?? null,
    div_cash_pct: rec.div_cash_pct ?? null,
    div_bonus_pct: rec.div_bonus_pct ?? null,
    missing_fields: missing,
    missing_count: missing.length,
    provenance: R.FUNDAMENTALS.EXPORT_PROVENANCE,
    export_note: R.FUNDAMENTALS.EXPORT_NOTE,
  };
  if (isNum(rec.pe_ttm) && rec.pe_ttm > R.FUNDAMENTALS.EXTREME_PE_TTM) {
    out.extreme_multiple = true;
    out.extreme_multiple_note = 'P/E TTM ' + rec.pe_ttm + ' — price disconnected from reported earnings (RSML precedent: P/E 128 at pump)';
  }
  return out;
}

/* ================= flag evaluation =========================================
 * Each flag: {name, direction, active, status, weight, evidence, backtest}
 * status ∈ 'scored' | 'gated_off' (regime/sector/event/floor gate) |
 *          'shown_not_scored' (experimental or info-level).
 * A flag with a null factor value is 'gated_off' with reason 'insufficient data'.
 */
function evaluateFlags(ctx) {
  const { symbol, m, regime, age, sector, sectorMult, floatInfo, fundInfo } = ctx;
  const flags = [];
  const notes = [];
  const bullGated = (fam) => regime === 'bull';           // rule 2
  const eventHit = R.EVENT_SUPPRESSIONS.find((e) => e.ymd === ctx.asofYmd);
  const volSuppressed = eventHit && eventHit.suppress.includes('vol_surge');

  const gateNote = (name, reason) =>
    ({ name, direction: 'bearish', active: false, status: 'gated_off',
       weight: R.PUMP_WEIGHTS[name] || 0, evidence: { reason }, backtest: R.BACKTEST_STATS[name] || null });

  // --- EXHAUSTION (bearish, circuit family: bull-only, age>=15) ---
  if (age < R.AGE_GATE.EXHAUSTION_MIN) {
    flags.push({ ...gateNote('EXHAUSTION', 'age ' + age + ' < 15: exhaustion read suppressed (rule 1 transition/ignition window)'),
                 name: 'EXHAUSTION', direction: 'bearish' });
  } else if (!bullGated()) {
    flags.push({ ...gateNote('EXHAUSTION', 'regime ' + regime + ': circuit family scores in bull only (rule 2)'),
                 name: 'EXHAUSTION', direction: 'bearish' });
  } else if (m.f.f_circuit_n60 === null) {
    flags.push({ ...gateNote('EXHAUSTION', 'f_circuit_n60 null — insufficient history'),
                 name: 'EXHAUSTION', direction: 'bearish' });
  } else {
    const active = m.circuit_n60 >= 2;
    const w = R.PUMP_WEIGHTS.EXHAUSTION * (m.recencyStale ? R.RECENCY_DECAY.STALE_WEIGHT_MULT : 1);
    flags.push({ name: 'EXHAUSTION', direction: 'bearish', active, status: 'scored', weight: w,
      evidence: { circuit_n60_floored: m.circuit_n60, circuit_n60_canonical: m.f.f_circuit_n60,
                  last_limit_up_sessions_ago: m.sessionsSinceUp,
                  recency_stale: m.recencyStale,
                  note: m.recencyStale
                    ? 'most recent limit-up >30 sessions ago — exhaustion weight ×0.5 (stale-window guard, rule 6)'
                    : 'volume floors applied (≥500 shares; rule 5)' },
      backtest: R.BACKTEST_STATS.EXHAUSTION });
  }

  // --- PARABOLIC / markup_asym (bearish, bull-only) ---
  if (!bullGated()) {
    flags.push({ ...gateNote('PARABOLIC', 'regime ' + regime + ': markup scores in bull only (rule 2)'),
                 name: 'PARABOLIC', direction: 'bearish' });
  } else if (m.f.f_markup_asym === null) {
    flags.push({ ...gateNote('PARABOLIC', 'f_markup_asym null — needs 60 sessions'),
                 name: 'PARABOLIC', direction: 'bearish' });
  } else {
    flags.push({ name: 'PARABOLIC', direction: 'bearish',
      active: m.f.f_markup_asym >= R.CALIBRATED.MARKUP_ASYM_ELEVATED,
      status: 'scored', weight: R.PUMP_WEIGHTS.PARABOLIC,
      evidence: { value: m.f.f_markup_asym, threshold: R.CALIBRATED.MARKUP_ASYM_ELEVATED,
                  threshold_note: 'pooled top-quintile over 274 equity symbols (ENGINE.md calibration)' },
      backtest: R.BACKTEST_STATS.PARABOLIC });
  }

  // --- DIST_VOLUME / vol_surge (bearish, bull-only, volume floor, event gate) ---
  if (volSuppressed) {
    flags.push({ ...gateNote('DIST_VOLUME', 'suppressed: ' + eventHit.label + ' (' + eventHit.ymd + ', rule 9)'),
                 name: 'DIST_VOLUME', direction: 'bearish' });
  } else if (!bullGated()) {
    flags.push({ ...gateNote('DIST_VOLUME', 'regime ' + regime + ': vol_surge scores in bull only (rule 2)'),
                 name: 'DIST_VOLUME', direction: 'bearish' });
  } else if (m.f.f_vol_surge === null) {
    flags.push({ ...gateNote('DIST_VOLUME', 'f_vol_surge null — needs 140 sessions (warm-up blindness, rule 7)'),
                 name: 'DIST_VOLUME', direction: 'bearish' });
  } else if (!(m.volMed120 >= R.VOLUME_FLOORS.VOL_SURGE_BASELINE_MEDIAN_MIN)) {
    flags.push({ ...gateNote('DIST_VOLUME', '120d median volume ' + m.volMed120 + ' < 1000 shares — odd-lot guard (rule 5)'),
                 name: 'DIST_VOLUME', direction: 'bearish' });
  } else {
    flags.push({ name: 'DIST_VOLUME', direction: 'bearish',
      active: m.f.f_vol_surge >= R.CALIBRATED.VOL_SURGE_ELEVATED,
      status: 'scored', weight: R.PUMP_WEIGHTS.DIST_VOLUME,
      evidence: { value: m.f.f_vol_surge, threshold: R.CALIBRATED.VOL_SURGE_ELEVATED,
                  baseline_120d_median_shares: m.volMed120,
                  upweighted_note: 'per-symbol IC −0.086 — upweighted (universe-report §6 rule 4)' },
      backtest: R.BACKTEST_STATS.DIST_VOLUME });
  }

  // --- CLIMAX / turnover_spike (bearish, regime-independent, floors, event gate) ---
  if (volSuppressed) {
    flags.push({ ...gateNote('CLIMAX', 'suppressed: ' + eventHit.label + ' (' + eventHit.ymd + ', rule 9)'),
                 name: 'CLIMAX', direction: 'bearish' });
  } else if (m.f.f_turnover_spike === null) {
    flags.push({ ...gateNote('CLIMAX', 'f_turnover_spike null — needs 60 sessions'),
                 name: 'CLIMAX', direction: 'bearish' });
  } else {
    const dayVol = ctx.bars[m.last].volume;
    const floorOk = dayVol >= R.VOLUME_FLOORS.TURNOVER_SPIKE_DAY_MIN;
    flags.push({ name: 'CLIMAX', direction: 'bearish',
      active: floorOk && m.f.f_turnover_spike >= R.CALIBRATED.TURNOVER_SPIKE_ELEVATED,
      status: floorOk ? 'scored' : 'gated_off', weight: R.PUMP_WEIGHTS.CLIMAX,
      evidence: { value: m.f.f_turnover_spike, threshold: R.CALIBRATED.TURNOVER_SPIKE_ELEVATED,
                  day_volume: dayVol,
                  volume_floor_ok: floorOk,
                  note: floorOk ? null : 'signal day <2000 shares — odd-lot artifact guard (rule 5)' },
      backtest: R.BACKTEST_STATS.CLIMAX });
  }

  // --- WINNER_FADE / mom20 (bearish on winners, regime-independent, no age gate R6) ---
  if (m.f.f_mom20 === null) {
    flags.push({ ...gateNote('WINNER_FADE', 'f_mom20 null — needs 20 sessions'),
                 name: 'WINNER_FADE', direction: 'bearish' });
  } else {
    flags.push({ name: 'WINNER_FADE', direction: 'bearish',
      active: m.f.f_mom20 >= R.CALIBRATED.MOM20_STRONG_POSITIVE,
      status: 'scored', weight: R.PUMP_WEIGHTS.WINNER_FADE,
      evidence: { mom20_raw: m.f.f_mom20, threshold: R.CALIBRATED.MOM20_STRONG_POSITIVE,
                  threshold_note: 'pooled top-quintile 20d return (raw, winners); factor is INVERTED in the engine — winners fade (P5)',
                  no_age_gate: 'R6 — no sign flip at any age' },
      backtest: R.BACKTEST_STATS.WINNER_FADE });
  }

  // --- LATE_CIRCUIT_FADE (bearish; circuit family → bull-only) ---
  if (!bullGated()) {
    flags.push({ ...gateNote('LATE_CIRCUIT_FADE', 'regime ' + regime + ': circuit family scores in bull only (rule 2)'),
                 name: 'LATE_CIRCUIT_FADE', direction: 'bearish' });
  } else if (m.ret20 === null) {
    flags.push({ ...gateNote('LATE_CIRCUIT_FADE', 'insufficient history for 20d return'),
                 name: 'LATE_CIRCUIT_FADE', direction: 'bearish' });
  } else {
    flags.push({ name: 'LATE_CIRCUIT_FADE', direction: 'bearish',
      active: m.upLast5 && m.ret20 < R.LATE_CIRCUIT_FADE.RETURN_20D_LT,
      status: 'scored', weight: R.PUMP_WEIGHTS.LATE_CIRCUIT_FADE,
      evidence: { limit_up_in_last_5d: m.upLast5, return_20d: m.ret20,
                  note: 'limit-up within 5 sessions AND 20d return < −15% = distribution into weakness (rule 7)' },
      backtest: R.BACKTEST_STATS.LATE_CIRCUIT_FADE });
  }

  // --- IGNITION (bullish, age<=10, circuit family → bull-only) ---
  if (age > R.AGE_GATE.IGNITION_MAX) {
    flags.push({ name: 'IGNITION', direction: 'bullish', active: false, status: 'gated_off',
      weight: R.OPPORTUNITY_WEIGHTS.IGNITION,
      evidence: { reason: 'age ' + age + ' > 10: outside the ignition window (rule 1)' },
      backtest: R.BACKTEST_STATS.IGNITION });
  } else if (!bullGated()) {
    flags.push({ name: 'IGNITION', direction: 'bullish', active: false, status: 'gated_off',
      weight: R.OPPORTUNITY_WEIGHTS.IGNITION,
      evidence: { reason: 'regime ' + regime + ': circuit family scores in bull only (rule 2)' },
      backtest: R.BACKTEST_STATS.IGNITION });
  } else {
    const active = m.ignitionDays >= 3;
    flags.push({ name: 'IGNITION', direction: 'bullish', active, status: 'scored',
      weight: R.OPPORTUNITY_WEIGHTS.IGNITION,
      evidence: { consecutive_tick_aware_limit_ups: m.ignitionDays, threshold_days: 3,
                  volume_exemption: 'age ≤10 — sub-500-share circuits count (rule 5 withheld-float exemption)',
                  note: 'R4: ignition LENGTH is not a quality signal — never score "more limit-ups = stronger"' },
      backtest: R.BACKTEST_STATS.IGNITION });
  }

  // --- BOUNCE_SETUP (bullish, R8 experimental but scored per brief) ---
  if (!m.bounce.eligible) {
    flags.push({ name: 'BOUNCE_SETUP', direction: 'bullish', active: false, status: 'gated_off',
      weight: R.OPPORTUNITY_WEIGHTS.BOUNCE_SETUP,
      evidence: { reason: 'no ≥30% drawdown episode in the trailing series' },
      backtest: R.BACKTEST_STATS.BOUNCE_SETUP });
  } else {
    flags.push({ name: 'BOUNCE_SETUP', direction: 'bullish', active: m.bounce.active,
      status: 'scored', weight: R.OPPORTUNITY_WEIGHTS.BOUNCE_SETUP,
      evidence: { ...m.bounce.evidence, experimental: 'R8 — needs walk-forward; not yet proven' },
      backtest: R.BACKTEST_STATS.BOUNCE_SETUP });
  }

  // --- SLOW_BLEED (bearish, EXPERIMENTAL, bear-only, NEVER scored) ---
  if (regime === 'bear' && m.f.f_slowbleed_v2 === 1) {
    flags.push({ name: 'SLOW_BLEED', direction: 'bearish', active: true,
      status: 'shown_not_scored', weight: 0,
      evidence: { value: 1, note: 'experimental — shown, NOT in composite score (rule 3)' },
      backtest: R.BACKTEST_STATS.SLOW_BLEED });
  } else {
    flags.push({ name: 'SLOW_BLEED', direction: 'bearish', active: false,
      status: 'shown_not_scored', weight: 0,
      evidence: { value: m.f.f_slowbleed_v2,
                  reason: regime !== 'bear' ? 'bear-regime only (rule 3); current regime ' + regime
                                            : 'signature not present' },
      backtest: R.BACKTEST_STATS.SLOW_BLEED });
  }

  // --- CORNERED_FLOAT (EXPERIMENTAL, evidence only, never scored) ---
  const tpp = floatInfo.traded_public_pct;
  const ignFlag = flags.find((fl) => fl.name === 'IGNITION');
  if (tpp !== null && tpp !== undefined && age <= R.CORNERED_FLOAT.MAX_AGE) {
    const patternActive = m.ignitionDays >= 3;
    const active = tpp < R.CORNERED_FLOAT.TRADED_PUBLIC_PCT_LT && patternActive;
    const ignScored = ignFlag && ignFlag.status === 'scored' && ignFlag.active;
    flags.push({ name: 'CORNERED_FLOAT', direction: 'bullish', active,
      status: 'shown_not_scored', weight: 0,
      evidence: { traded_public_pct: tpp, threshold_pct: R.CORNERED_FLOAT.TRADED_PUBLIC_PCT_LT,
                  ignition_days: m.ignitionDays,
                  ignition_scored_flag: ignScored ? 'active' : 'gated_off (age window)',
                  reading: active
                    ? 'float is cornered (' + tpp + '% of public float traded) with ignition pattern ' +
                      'present (' + m.ignitionDays + ' consecutive limit-ups) — measured withheld-float ' +
                      'precondition' + (ignScored ? '; strengthens the IGNITION read'
                                                 : '; the IGNITION scored flag itself is age-gated off ' +
                                                   '(age ' + age + '), so this is supporting evidence only')
                    : 'traded_public_pct ' + tpp + '% — criterion is <' +
                      R.CORNERED_FLOAT.TRADED_PUBLIC_PCT_LT + '% with ignition pattern (≥3 consecutive limit-ups)',
                  honesty: 'single snapshot 2026-10-05, unbacktested — evidence only, NOT in core score' },
      backtest: R.BACKTEST_STATS.CORNERED_FLOAT });
    if (active && ignFlag && ignScored) {
      ignFlag.evidence.cornered_float = tpp + '% of float traded — measured withheld-float precondition (experimental)';
    }
  }

  // --- WITHHELD_FLOAT (info note) ---
  if (age <= R.WITHHELD_FLOAT.MAX_AGE && m.first10MedVol !== null &&
      m.first10MedVol < R.WITHHELD_FLOAT.SUB_SHARES &&
      m.paidup !== null && m.paidup >= R.WITHHELD_FLOAT.PAIDUP_LARGE_MIN) {
    notes.push({ type: 'WITHHELD_FLOAT', severity: 'info',
      text: 'Opened on sub-1,000-share days (first-10d median ' + m.first10MedVol +
            ') against Rs ' + m.paidup + 'b paid-up — withheld-float ignition precondition ' +
            '(analyst-synthesis §4).',
      backtest: R.BACKTEST_STATS.WITHHELD_FLOAT });
  }

  // --- HYDRO_CLIFF (info note) ---
  if (m.downLast5 && m.volMed60) {
    const ratio = m.downLast5.volume / m.volMed60;
    if (ratio < R.HYDRO_CLIFF.MEDIAN_VOLUME_MULT) {
      notes.push({ type: 'HYDRO_CLIFF', severity: 'info',
        text: 'Limit-down on ' + ymdStr(m.downLast5.ymd) + ' printed ' + m.downLast5.volume +
              ' shares (' + ratio.toFixed(2) + '× 60d median) — absent-bids cliff: tops break ' +
              'from missing bids, not selling pressure (rule 8). Bearish acceleration note.',
        backtest: R.BACKTEST_STATS.HYDRO_CLIFF });
    }
  }

  // --- NO_EARNINGS_ANCHOR (risk note, rule 13) ---
  // Pumped new listings don't have weak fundamentals — they have ABSENT ones
  // (75% no EPS vs 10% market, pump-fundamentals-report.md). Missing earnings
  // on a young listing with ignition/pump activity is a first-class risk
  // input: no anchor means valuation is pure narrative.
  if (fundInfo && age <= R.FUNDAMENTALS.NO_ANCHOR_MAX_AGE && fundInfo.eps_ttm === null &&
      fundInfo.status !== 'absent') {
    const ignActive = flags.some((fl) => fl.name === 'IGNITION' && fl.active);
    const pumpActive = flags.some((fl) => fl.direction === 'bearish' && fl.active);
    if (ignActive || pumpActive) {
      notes.push({ type: 'NO_EARNINGS_ANCHOR', severity: 'warning',
        text: 'No published EPS' + (fundInfo.missing_count > 1
          ? ' (' + fundInfo.missing_count + ' of ' + FUND_CORE_FIELDS.length + ' core fields missing: ' +
            fundInfo.missing_fields.join(', ') + ')' : '') +
          ' on a ' + age + '-session-old listing' +
          (ignActive ? ' in ignition' : ' with pump activity') +
          ' — no earnings anchor; valuation is pure narrative (research: 75% of 2026 pumps had no EPS vs 10% market).',
        backtest: 'pump-fundamentals-report.md §Result 1 (n=8, needs confirmation)' });
    }
  }

  // --- CONTRADICTORY_SECTOR ---
  if (sectorMult === 0 && sector) {
    notes.push({ type: 'CONTRADICTORY_SECTOR', severity: 'info',
      text: R.CONTRADICTORY_SECTOR_NOTE + ' Sector: ' + sector + '.' });
  }

  return { flags, notes };
}

/* ================= scoring ================================================= */
function score(flags, sectorMult) {
  const bearish = flags.filter((fl) => fl.direction === 'bearish' && fl.status === 'scored');
  const eligibleW = bearish.reduce((s, fl) => s + fl.weight, 0);
  const activeW = bearish.filter((fl) => fl.active)
    .reduce((s, fl) => {
      let w = fl.weight * sectorMult;
      if (fl.name === 'EXHAUSTION' && fl.evidence && fl.evidence.recency_stale) w *= 1; // already decayed in weight
      return s + w;
    }, 0);
  const pump_score = eligibleW > 0 ? activeW / eligibleW : null;

  const opp = flags.filter((fl) => fl.direction === 'bullish' && fl.status === 'scored');
  const oppEligW = opp.reduce((s, fl) => s + fl.weight, 0);
  const oppActiveW = opp.filter((fl) => fl.active).reduce((s, fl) => s + fl.weight, 0);
  const opportunity_score = oppEligW > 0 ? oppActiveW / oppEligW : null;

  const nBearishActive = bearish.filter((fl) => fl.active).length;
  return { pump_score, opportunity_score, nBearishActive, nBearishEligible: bearish.length };
}

/* ================= verdict label =========================================== */
function labelVerdict(flags, scores) {
  const byName = {};
  for (const fl of flags) byName[fl.name] = fl;
  const LBL = R.VERDICT_LABELS, C = R.SCORE_CUTOFFS;
  let label, reason;
  if (byName.EXHAUSTION && byName.EXHAUSTION.active && byName.EXHAUSTION.status === 'scored') {
    label = LBL.EXHAUSTION_RISK; reason = 'circuit exhaustion flag active (age≥15, ≥2 floored limit-ups/60d)';
  } else if ((scores.pump_score !== null && scores.pump_score >= C.DISTRIBUTION_WARNING) ||
             scores.nBearishActive >= C.MIN_BEARISH_FLAGS_FOR_DISTRIBUTION) {
    label = LBL.DISTRIBUTION_WARNING; reason = 'pump_score ' + (scores.pump_score !== null ? scores.pump_score.toFixed(2) : 'n/a') +
      ' ≥ ' + C.DISTRIBUTION_WARNING + ' or ≥' + C.MIN_BEARISH_FLAGS_FOR_DISTRIBUTION + ' bearish flags';
  } else if (scores.pump_score !== null && scores.pump_score >= C.ELEVATED_RISK) {
    label = LBL.ELEVATED_RISK; reason = 'pump_score ' + scores.pump_score.toFixed(2) + ' ≥ ' + C.ELEVATED_RISK;
  } else if (byName.IGNITION && byName.IGNITION.active && byName.IGNITION.status === 'scored') {
    label = LBL.IGNITION; reason = 'young listing (age≤10) with ≥3 consecutive tick-aware limit-ups';
  } else if (byName.BOUNCE_SETUP && byName.BOUNCE_SETUP.active && byName.BOUNCE_SETUP.status === 'scored') {
    label = LBL.BOUNCE_SETUP; reason = 'R8 bounce criteria met — shown WITH 45% bleed-out base rate';
  } else {
    label = LBL.NEUTRAL; reason = 'no scored flag active — clean read (not a bullish call)';
  }
  return { label, reason };
}

function confidenceFor(label, flags) {
  const dir = (label === 'IGNITION' || label === 'BOUNCE_SETUP') ? 'bullish'
    : label === 'NEUTRAL' ? 'neutral' : 'bearish';
  let agreeing;
  if (dir === 'neutral') {
    agreeing = flags.filter((fl) => fl.status === 'scored' && !fl.active).length;
  } else {
    agreeing = flags.filter((fl) => fl.status === 'scored' && fl.active && fl.direction === dir).length;
  }
  return Math.min(R.CONFIDENCE.CAP, R.CONFIDENCE.BASE + R.CONFIDENCE.PER_FLAG * agreeing);
}

/* ================= main ==================================================== */
function generateVerdict({ symbol, bars, dossier, regime, asofYmd, opts, fundamentals }) {
  opts = opts || {};
  const nBars = normalizeBars(bars);
  const n = nBars.length;
  const asof = asofYmd || (n ? nBars[n - 1].ymd : null);
  const asofDate = ymdStr(asof);
  const sessionDate = n ? ymdStr(nBars[n - 1].ymd) : null;
  const ident = (dossier && dossier.identity) || {};
  const sector = ident.sector || null;
  const age = ident.age_sessions || n;

  const base = {
    symbol, asof: asofDate, session_date: sessionDate,
    horizon_sessions: 20,
    regime: regime === undefined ? null : regime,
    evidence: {},
    methodology_links: R.METHODOLOGY_LINKS,
    disclaimer: R.DISCLAIMER,
  };

  // --- gate 1: instrument type (rule 4) ---
  if (sector && R.EXCLUDED_SECTORS.includes(sector)) {
    return { ...base, verdict: R.VERDICT_LABELS.EXCLUDED_NON_EQUITY, confidence: 0,
      reason: 'sector "' + sector + '" — equity factors do not apply',
      evidence: { identity: { sector, listing_date: ident.listing_date || null,
                              age_sessions: age, paidup_b: ident.paidup_b ?? null },
                  exclusion: { reason: R.EXCLUDED_NON_EQUITY_REASON } } };
  }

  // --- gate 2: data quality (rule 11) ---
  let poison = null;
  for (let j = 1; j < n; j++) {
    const p = nBars[j - 1].close, c = nBars[j].close;
    if (p > 0 && isNum(c)) {
      const r = Math.abs(c / p - 1);
      if (r > R.DATA_QUALITY.MAX_ABS_DAILY_RETURN) {
        poison = { date: ymdStr(nBars[j].ymd), daily_return: c / p - 1 }; break;
      }
    }
  }
  if (poison) {
    return { ...base, verdict: R.VERDICT_LABELS.UNRELIABLE, confidence: 0,
      reason: 'data-quality poison: |daily return| > 25% — impossible under any circuit regime',
      evidence: { identity: { sector, listing_date: ident.listing_date || null,
                              age_sessions: age, paidup_b: ident.paidup_b ?? null },
                  data_quality: { ...poison, precedent: 'JBLBP +430%/+616% phantom limit-ups (analyst-synthesis §5)',
                                  note: 'factors not scored' } } };
  }

  // --- gate 3: insufficient data ---
  if (n < 30 && !dossier) {
    return { ...base, verdict: R.VERDICT_LABELS.INSUFFICIENT_DATA, confidence: 0,
      reason: n + ' sessions and no dossier — verdict withheld, not guessed',
      evidence: { identity: { sector: null, age_sessions: n } } };
  }

  const panel = F.computeAll(nBars);
  const m = measure(nBars, panel, dossier, age);
  const sectorMult = sector && R.SECTOR_BEARISH_MULTIPLIER[sector] !== undefined
    ? R.SECTOR_BEARISH_MULTIPLIER[sector] : 1.0;
  const floatInfo = buildFloat(symbol, dossier);
  const fundInfo = buildFundamentals(symbol, fundamentals);
  const { flags, notes } = evaluateFlags({
    symbol, bars: nBars, m, regime: regime === undefined ? null : regime,
    age, sector, sectorMult, floatInfo, fundInfo, asofYmd: asof,
  });

  // sector multiplier: Finance/DevBank ×0 already emitted as note; apply here
  const scores = score(flags, sectorMult);
  const { label, reason } = labelVerdict(flags, scores);
  const confidence = confidenceFor(label, flags);

  // lifecycle (causal)
  const lc = L.trackPhases(nBars);

  // circuit age-gate label
  const ageGate = age <= R.AGE_GATE.IGNITION_MAX ? 'ignition_read_active'
    : age <= R.AGE_GATE.TRANSITION_MAX ? 'suppressed_transition'
    : 'exhaustion_read_active';

  // episode history from dossier (labeled + scanner, source-tagged)
  const episodes = [];
  if (dossier && dossier.pump_flags) {
    for (const e of dossier.pump_flags.labeled_episodes || []) episodes.push({ ...e, source: 'labeled' });
    for (const e of dossier.pump_flags.scanner_episodes || []) episodes.push({ ...e, source: 'scanner' });
  }
  const analystNote = dossier && dossier.analyst_review && dossier.analyst_review.narrative
    ? String(dossier.analyst_review.narrative).slice(0, 500) : null;

  const verdict = {
    ...base,
    verdict: label,
    reason,
    confidence,
    scores: { pump_score: scores.pump_score, opportunity_score: scores.opportunity_score,
              sector_bearish_multiplier: sectorMult },
    evidence: {
      identity: {
        sector, listing_date: ident.listing_date || null, age_sessions: age,
        paidup_b: ident.paidup_b ?? null,
        float_status: floatInfo.float_status,
        float_shares: floatInfo.float_shares,
        promoter_pct: floatInfo.promoter_pct,
        traded_public_pct: floatInfo.traded_public_pct,
        float_note: floatInfo.float_note,
      },
      lockin: buildLockin(symbol, nBars, dossier, asofDate),
      fundamentals: fundInfo,
      circuit_record: {
        limit_ups_60d: m.circuit_n60,
        limit_ups_alltime: m.upsCounted.length,
        limit_ups_uncounted_odd_lot: m.ups.length - m.upsCounted.length,
        last_circuit: m.recentUp ? ymdStr(m.recentUp.ymd) : null,
        sessions_since_last_circuit: m.sessionsSinceUp,
        age_gate: ageGate,
        note: age <= R.AGE_GATE.IGNITION_MAX
          ? 'age ≤10: limit-ups read as ignition continuation (ρ +0.287); sub-500-share days count (rule 5 exemption)'
          : age <= R.AGE_GATE.TRANSITION_MAX
          ? 'age 11–14: transition — circuit factor carries NO signal (rule 1)'
          : 'age ≥15: limit-ups read as exhaustion/distribution (rule 1)',
      },
      volume_anatomy: {
        trough_vol_vs_baseline: m.troughVolBase ? bars_trough_vol_ratio(nBars, m) : null,
        top_volume_days: m.topVol,
        withheld_float_flag: notes.some((x) => x.type === 'WITHHELD_FLOAT'),
        volume_floors_applied: R.VOLUME_FLOORS,
      },
      drawdown_state: {
        from_peak_pct: m.fromPeak,
        peak_date: ymdStr(m.peak.ymd),
        trough_date: ymdStr(nBars[m.troughIdx].ymd),
        drawdown_depth_pct: m.ddDepth,
        sessions_underwater: m.last - m.peakIdx,
        reclaim50: m.reclaim50,
      },
      factors: [
        { name: 'circuit_cluster_60d', value: m.circuit_n60, direction: 'bearish_when_high',
          reading: ageGate, backtest: R.BACKTEST_STATS.EXHAUSTION },
        { name: 'markup_asymmetry', value: m.f.f_markup_asym, direction: 'bearish_when_high',
          reading: m.f.f_markup_asym === null ? 'insufficient_data'
            : m.f.f_markup_asym >= R.CALIBRATED.MARKUP_ASYM_ELEVATED ? 'elevated' : 'normal',
          backtest: R.BACKTEST_STATS.PARABOLIC },
        { name: 'mom20_reversal', value: m.f.f_mom20, direction: 'fade_winners',
          reading: m.f.f_mom20 === null ? 'insufficient_data'
            : m.f.f_mom20 >= R.CALIBRATED.MOM20_STRONG_POSITIVE ? 'winner_fade_zone'
            : m.f.f_mom20 < -0.15 ? 'mild_bounce_zone' : 'neutral',
          backtest: R.BACKTEST_STATS.WINNER_FADE },
        { name: 'vol_surge', value: m.f.f_vol_surge, direction: 'bearish_when_high',
          reading: m.f.f_vol_surge === null ? 'insufficient_data'
            : m.f.f_vol_surge >= R.CALIBRATED.VOL_SURGE_ELEVATED ? 'elevated' : 'normal',
          backtest: R.BACKTEST_STATS.DIST_VOLUME },
        { name: 'turnover_spike', value: m.f.f_turnover_spike, direction: 'bearish_when_high',
          reading: m.f.f_turnover_spike === null ? 'insufficient_data'
            : m.f.f_turnover_spike >= R.CALIBRATED.TURNOVER_SPIKE_ELEVATED ? 'climax' : 'normal',
          backtest: R.BACKTEST_STATS.CLIMAX },
        { name: 'slowbleed_v2', value: m.f.f_slowbleed_v2, direction: 'bearish_when_high',
          reading: 'experimental_only', backtest: R.BACKTEST_STATS.SLOW_BLEED },
        { name: 'vol_surge_20', value: m.vol_surge_20, direction: 'bearish_when_high',
          reading: 'experimental_only', backtest: 'rule 12 — warm-up-blindness lens, unbacktested' },
        { name: 'turnover_spike_10', value: m.turnover_spike_10, direction: 'bearish_when_high',
          reading: 'experimental_only', backtest: 'rule 12 — warm-up-blindness lens, unbacktested' },
      ],
      flags,
      notes,
      episode_history: episodes,
      analyst_narrative: analystNote,
      lifecycle: { phases: lc.phases, open_phase: lc.openPhase ? lc.openPhase.type : null },
      promoter: { status: 'pending',
                  note: 'promoter identity not yet captured — see promoter-track-record-gap.md' },
      base_rates_shown: {
        new_listing_bounce_gt10: '55% (45% bleed out)',
        reclaim50: '9%',
        circuit_exhaustion_hit: '16/16 episodes, 5.4x lift',
      },
    },
  };

  if (opts.auditNoLookahead) {
    verdict.audit = auditNoLookahead(nBars, dossier, regime === undefined ? null : regime);
  }
  return verdict;
}

/* --- trough volume vs baseline (helper, kept outside measure for clarity) --- */
function bars_trough_vol_ratio(nBars, m) {
  if (m.troughVolBase === null || m.troughVolBase <= 0) return null;
  return nBars[m.troughIdx].volume / m.troughVolBase;
}

/* ================= auditNoLookahead ========================================
 * Causality assertion: recompute with truncated bars and compare.
 *  - factor panel: for cut points c in {50%, 75%}, recompute computeAll on
 *    bars[0..c) and require panel[i] == full panel[i] for all i < c.
 *  - lifecycle: trackPhases on bars[0..c) must reproduce every full-series
 *    interval with endIdx < c-1 (the -1 allows the one-bar break-lag).
 * Any mismatch is a look-ahead bug. Returns {passed, checks[], mismatches[]}.
 */
function auditNoLookahead(nBars, dossier, regime) {
  const fullPanel = F.computeAll(nBars);
  const fullLC = L.trackPhases(nBars);
  const mismatches = [];
  const checks = [];
  const cuts = [Math.floor(nBars.length / 2), Math.floor((3 * nBars.length) / 4)]
    .filter((c) => c > 60);
  for (const c of cuts) {
    const trunc = nBars.slice(0, c);
    const tp = F.computeAll(trunc);
    let factorMismatch = 0;
    for (let i = 0; i < c; i++) {
      for (const k of ['f_circuit_n60', 'f_markup_asym', 'f_vol_surge',
                       'f_turnover_spike', 'f_slowbleed_v2', 'f_mom20']) {
        const a = tp[i][k], b = fullPanel[i][k];
        if (a === null && b === null) continue;
        if (a === null || b === null || Math.abs(a - b) > 1e-12) factorMismatch++;
      }
    }
    checks.push({ cut: c, factor_mismatches: factorMismatch });
    if (factorMismatch) mismatches.push('factors differ at cut ' + c + ': ' + factorMismatch + ' cells');

    const tlc = L.trackPhases(trunc);
    const fullKept = fullLC.phases.filter((p) => p.endIdx < c - 1);
    for (const p of fullKept) {
      const match = tlc.phases.find((q) => q.type === p.type && q.startIdx === p.startIdx);
      if (!match || match.endIdx !== p.endIdx) {
        mismatches.push('lifecycle interval diverged at cut ' + c + ': ' +
          p.type + ' [' + p.startIdx + ',' + p.endIdx + ']');
      }
    }
    checks.push({ cut: c, lifecycle_intervals_checked: fullKept.length });
  }
  return { passed: mismatches.length === 0, checks, mismatches };
}

module.exports = {
  generateVerdict,
  normalizeBars,
  measure,
  evaluateFlags,
  score,
  auditNoLookahead,
  buildLockin,
  buildFloat,
  buildFundamentals,
};
