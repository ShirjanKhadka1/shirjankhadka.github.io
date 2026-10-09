#!/usr/bin/env node
/* Warning Radar retrospective measurement (price-only, transparent).
 *
 * Runs the CURRENT verdict engine over truncated history for past sessions
 * and measures forward outcomes — the same definitions as the live ledger:
 *   HIT            min close-to-close return within 20 sessions <= -10%
 *   FALSE_POSITIVE 20 sessions elapsed, close >= +5%, never drew down 10%
 *   NEUTRAL        20 sessions elapsed, neither
 *
 * HONEST LIMITATIONS (stated, not hidden):
 *  - dossier=null: no sector multiplier, no float/promoter data, no analyst
 *    notes; age = available bar count. Sector-gated factors behave slightly
 *    differently than live.
 *  - fundamentals=null (never scored live either — Rule 13).
 *  - Regime recomputed from index history truncated at each eval date.
 *  - Non-equity symbols filtered by the present-day classification
 *    (time-invariant instrument type).
 *  - Measures the CURRENT engine on past data (right question for
 *    "is the current engine effective"), not the historical engine versions.
 *
 * Usage: node tools/measure-warning-radar.js [--dates 2026-01-05,2026-...]
 *        [--step 10] [--out /tmp/wr-retro.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const MIRROR = process.env.V2_MIRROR || '/home/hatch/workspace/v2-mirror';
const ENG = path.join(REPO, 'tools', 'verdict-engine-v2');
const { generateVerdict } = require(path.join(ENG, 'engine.js'));

const WARNINGS = new Set(['EXHAUSTION_RISK', 'DISTRIBUTION_WARNING', 'ELEVATED_RISK']);
const HORIZON = 20, HIT_DD = -0.10, FP_GAIN = 0.05;

function args() {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
  return o;
}

/* ---- index history -> regime at a date (mirrors computeRegime) ---- */
function loadIndex() {
  const src = fs.readFileSync(path.join(REPO, 'js', 'nepse-daily.js'), 'utf8');
  const m = src.match(/window\.NEPSE_DAILY=(\[[\s\S]*?\]);?\s*$/);
  if (!m) throw new Error('cannot parse js/nepse-daily.js');
  return JSON.parse(m[1]).map((r) => ({ ymd: r[0], close: r[4] })).filter((r) => r.close > 0);
}
function regimeAt(idxRows, ymd) {
  const closes = idxRows.filter((r) => r.ymd <= ymd).map((r) => r.close);
  const N = 200;
  if (closes.length < N + 20) return 'unknown';
  const i = closes.length - 1;
  const sma = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const s200 = sma(closes.slice(i - N + 1, i + 1));
  const prev = sma(closes.slice(i - N - 19, i - 19));
  const slope = s200 - prev, close = closes[i];
  if (close > s200 && slope > 0) return 'bull';
  if (close < s200 && slope < 0) return 'bear';
  return 'sideways';
}

/* ---- mirror ---- */
function loadMirror() {
  const out = {};
  for (const f of fs.readdirSync(MIRROR)) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(fs.readFileSync(path.join(MIRROR, f), 'utf8'));
    const bars = (d.bars || []).map((b) => ({
      ymd: b.ymd, open: b.open, high: b.high, low: b.low,
      close: b.close, qty: b.volume, volume: b.volume, turnover: b.turnover,
    })).filter((b) => b.close > 0).sort((a, b) => a.ymd - b.ymd);
    if (bars.length) out[d.symbol || f.replace(/\.json$/, '')] = bars;
  }
  return out;
}

/* ---- non-equity set from the live summary ---- */
function nonEquitySet() {
  const s = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'verdicts-v2-summary.json'), 'utf8'));
  const set = new Set();
  for (const [sym, v] of Object.entries(s.verdicts || {}))
    if (v.label === 'EXCLUDED_NON_EQUITY') set.add(sym);
  return set;
}

function main() {
  const o = args();
  const step = parseInt(o.step || '10', 10);
  const mirror = loadMirror();
  const idxRows = loadIndex();
  const nonEq = nonEquitySet();
  console.log(`mirror symbols: ${Object.keys(mirror).length}, non-equity excluded: ${nonEq.size}`);

  // eval dates: every `step` trading sessions from a liquid symbol's calendar
  const ref = mirror.NABIL || Object.values(mirror)[0];
  const sessions = ref.map((b) => b.ymd).filter((y) => y >= 20260105 && y <= 20260920);
  let dates = sessions.filter((_, i) => i % step === 0);
  if (o.dates) dates = o.dates.split(',').map((d) => parseInt(d.replace(/-/g, ''), 10));
  console.log(`eval dates: ${dates.length} (${dates[0]}..${dates[dates.length - 1]})`);

  const warnings = [];
  for (const ymd of dates) {
    const regime = regimeAt(idxRows, ymd);
    for (const [sym, bars] of Object.entries(mirror)) {
      if (nonEq.has(sym)) continue;
      const past = bars.filter((b) => b.ymd <= ymd);
      if (past.length < 30) continue;
      const win = past.length > 750 ? past.slice(past.length - 750) : past;
      let v;
      try {
        v = generateVerdict({ symbol: sym, bars: win, dossier: null, regime, asofYmd: ymd, fundamentals: null });
      } catch (e) { continue; }
      if (!WARNINGS.has(v.verdict)) continue;
      const flags = ((v.evidence || {}).flags || [])
        .filter((f) => f.active && f.status === 'scored').map((f) => f.name);
      warnings.push({
        symbol: sym, ymd, verdict: v.verdict, flags,
        confidence: v.confidence, close: win[win.length - 1].close,
      });
    }
    if (dates.indexOf(ymd) % 5 === 0) console.log(`  date ${ymd}: ${warnings.length} warnings so far`);
  }
  console.log(`total warnings: ${warnings.length}`);

  // forward outcomes
  let hit = 0, fp = 0, neu = 0, open = 0;
  const byVerdict = {}, byFactor = {};
  for (const w of warnings) {
    const bars = mirror[w.symbol];
    const i = bars.findIndex((b) => b.ymd === w.ymd);
    const fwd = i >= 0 ? bars.slice(i + 1, i + 1 + HORIZON) : [];
    let status = 'open';
    if (fwd.length >= 5) {
      const rets = fwd.map((b) => b.close / w.close - 1);
      const mdd = Math.min(...rets);
      if (mdd <= HIT_DD) status = 'hit';
      else if (fwd.length >= HORIZON) status = rets[rets.length - 1] >= FP_GAIN ? 'false_positive' : 'neutral';
    }
    w.status = status; w.sessions_elapsed = fwd.length;
    w.max_drawdown_20 = fwd.length ? Math.min(...fwd.map((b) => b.close / w.close - 1)) : null;
    if (status === 'hit') hit++;
    else if (status === 'false_positive') fp++;
    else if (status === 'neutral') neu++;
    else open++;
    const vb = byVerdict[w.verdict] || (byVerdict[w.verdict] = { n: 0, hit: 0, fp: 0 });
    vb.n++; if (status === 'hit') vb.hit++; if (status === 'false_positive') vb.fp++;
    for (const fl of w.flags) {
      const fb = byFactor[fl] || (byFactor[fl] = { n: 0, hit: 0, fp: 0 });
      fb.n++; if (status === 'hit') fb.hit++; if (status === 'false_positive') fb.fp++;
    }
  }
  const resolved = hit + fp + neu;
  const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
  const result = {
    generated_at: new Date().toISOString(),
    eval_dates: dates.length, date_range: [dates[0], dates[dates.length - 1]],
    limitations: 'price-only retrospective; dossier=null (no sector multiplier/float/analyst data, age=bar count); fundamentals=null (never scored); regime from truncated index history; non-equity filtered by present-day classification; measures CURRENT engine on past data',
    warnings_issued: warnings.length,
    resolved, open,
    hits: hit, false_positives: fp, neutrals: neu,
    precision_pct: pct(hit, resolved),
    false_positive_rate_pct: pct(fp, resolved),
    by_verdict: Object.fromEntries(Object.entries(byVerdict).map(([k, v]) => [k, {
      warnings: v.n, precision_pct: pct(v.hit, v.hit + v.fp + (v.n - v.hit - v.fp)),
      hit_rate_pct: pct(v.hit, v.n),
    }])),
    by_factor: Object.fromEntries(Object.entries(byFactor).map(([k, v]) => [k, {
      warnings: v.n, hits: v.hit, false_positives: v.fp,
      hit_rate_pct: pct(v.hit, v.n),
    }])),
  };
  const out = o.out || '/tmp/wr-retro.json';
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({
    warnings: warnings.length, resolved, open,
    precision_pct: result.precision_pct, fp_rate_pct: result.false_positive_rate_pct,
    by_factor: result.by_factor,
  }, null, 1));
  console.log('wrote', out);
}
main();
