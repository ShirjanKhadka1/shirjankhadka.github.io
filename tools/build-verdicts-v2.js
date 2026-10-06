#!/usr/bin/env node
/* Nepse Decode — Verdict Engine v2 daily builder.
 *
 * Runs the v2 warning-instrument engine (tools/verdict-engine-v2/) per
 * symbol and writes:
 *   data/verdicts-v2.json         — full verdicts with evidence bundles
 *   data/verdicts-v2-summary.json — compact table feed for the index page
 *
 * Price history is fetched at build time per symbol (same transient pattern
 * as tools/build-nepse-universe.js) and never republished; only the derived
 * verdicts are written. Session dating: the authoritative trading day comes
 * from nepse-chart/data/live.json `session_date` (or --session), never from
 * fetch timestamps — NEPSE trades Mon–Fri; a weekend pipeline refresh must
 * never stamp a weekend date.
 *
 * Usage:
 *   node tools/build-verdicts-v2.js [--session YYYY-MM-DD] [--mirror DIR]
 *     [--limit N] [--out DIR]
 *   --mirror DIR : read price history from local mirror files instead of
 *                  fetching (mirror files: {SYM}.json with .rows of
 *                  [ymd,open,high,low,close,qty,turnover]).
 *   --limit N   : process only the first N symbols (smoke runs).
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENG = path.join(__dirname, 'verdict-engine-v2');
const { generateVerdict } = require(path.join(ENG, 'engine.js'));

const PRICE_URL = (s) =>
  'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' +
  s.replace(/\//g, '-') + '.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (NepseDecode verdict-v2 builder)' };
const CONCURRENCY = 12;

function log(...a) { console.log('[verdicts-v2]', ...a); }
function readJSON(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; }
}
function atomicWrite(p, s) {
  const t = p + '.tmp';
  fs.writeFileSync(t, s);
  fs.renameSync(t, p);
}
function ymdNum(iso) { return Number(String(iso).replace(/-/g, '')); }

async function getJSON(url, tries) {
  tries = tries == null ? 2 : tries;
  const attempt = (left) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    return fetch(url, { headers: UA, signal: ctl.signal }).then((res) => {
      clearTimeout(timer);
      if (res.status === 404) return { __404: true };
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return res.json();
    }).catch((e) => {
      clearTimeout(timer);
      if (left > 0) return new Promise((r) => setTimeout(r, 700)).then(() => attempt(left - 1));
      throw e;
    });
  };
  return attempt(tries);
}

/* Regime from the site's own index daily history (js/nepse-daily.js):
 * bull if close > SMA200 and SMA200 rising; bear if close < SMA200 and
 * SMA200 falling; else sideways. Mirrors the research harness regimeAt. */
function computeRegime() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'nepse-daily.js'), 'utf8');
  const m = src.match(/window\.NEPSE_DAILY=(\[[\s\S]*?\]);?\s*$/);
  if (!m) throw new Error('could not parse js/nepse-daily.js');
  const rows = JSON.parse(m[1]);
  const closes = rows.map((r) => r[4]).filter((c) => c > 0);
  const N = 200;
  if (closes.length < N + 20) {
    return { regime: 'unknown', note: 'index history too short (' + closes.length + ' bars)' };
  }
  const i = closes.length - 1;
  const sma = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sma200 = sma(closes.slice(i - N + 1, i + 1));
  const prev = sma(closes.slice(i - N - 19, i - 19));
  const slope = sma200 - prev;
  const close = closes[i];
  let regime = 'sideways';
  if (close > sma200 && slope > 0) regime = 'bull';
  else if (close < sma200 && slope < 0) regime = 'bear';
  return {
    regime,
    note: 'index ' + close.toFixed(2) + ' vs SMA200 ' + sma200.toFixed(2) +
      ' (slope ' + (slope >= 0 ? '+' : '') + slope.toFixed(2) + ')',
    index_ymd: rows[rows.length - 1][0],
  };
}

function loadMirrorBars(mirrorDir, symbol) {
  const p = path.join(mirrorDir, symbol.replace(/\//g, '-') + '.json');
  if (!fs.existsSync(p)) return null;
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = m.rows || m.bars || m;
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => Array.isArray(r)
    ? { ymd: r[0], open: r[1], high: r[2], low: r[3], close: r[4], qty: r[5], turnover: r[6] }
    : r);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const mirrorDir = opt('--mirror');
  const limit = opt('--limit') ? parseInt(opt('--limit'), 10) : 0;
  const outDir = opt('--out') || path.join(ROOT, 'data');

  // ---- authoritative session date (trading day, never a fetch timestamp)
  const live = readJSON(path.join(ROOT, 'nepse-chart', 'data', 'live.json'), {});
  const sessionDate = opt('--session') || live.session_date || null;
  if (!sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    console.error('verdicts-v2: no valid session_date (live.json session_date missing and no --session)');
    process.exit(2);
  }
  const asofYmd = ymdNum(sessionDate);
  log('session_date:', sessionDate);

  // ---- inputs
  const universe = readJSON(path.join(ROOT, 'nepse-chart', 'data', 'universe.json'), null);
  if (!universe || !universe.symbols) { console.error('verdicts-v2: universe.json missing'); process.exit(2); }
  const lockin = readJSON(path.join(ROOT, 'data', 'lockin.json'), { rows: {} });
  const dossiers = readJSON(path.join(ENG, 'dossiers-compact.json'), {});
  const fundMerged = readJSON(path.join(ENG, 'fundamentals.json'), null);
  const fundamentals = fundMerged && fundMerged.companies ? fundMerged.companies : null;
  const regime = computeRegime();
  log('regime:', regime.regime, '|', regime.note);
  log('lockin rows:', Object.keys(lockin.rows || {}).length,
    '| dossiers:', Object.keys(dossiers).length,
    '| fundamentals:', fundamentals ? Object.keys(fundamentals).length : 0);

  let symbols = universe.symbols.map((s) => s.s);
  if (limit > 0) symbols = symbols.slice(0, limit);

  // ---- exclude completed mergers (absorbed symbols must never get verdicts)
  try {
    const mtPath = path.join(ENG, 'manual', 'merger-tracker.json');
    if (fs.existsSync(mtPath)) {
      const mt = JSON.parse(fs.readFileSync(mtPath, 'utf8'));
      const absorbed = new Set((mt.completed_mergers || []).map((m) => m.absorbed));
      const before = symbols.length;
      symbols = symbols.filter((s) => !absorbed.has(s));
      if (symbols.length < before) log('merger exclusion:', (before - symbols.length) + ' absorbed symbols skipped');
    }
  } catch (e) { log('merger-tracker read failed:', e.message); }
  log('symbols:', symbols.length);

  // ---- price history (build-time fetch, transient — never republished)
  const barsBySym = {};
  if (mirrorDir) {
    for (const s of symbols) {
      const b = loadMirrorBars(mirrorDir, s);
      if (b) barsBySym[s] = b;
    }
    log('mirror bars loaded for', Object.keys(barsBySym).length, 'symbols');
  } else {
    let done = 0;
    const queue = symbols.slice();
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push((async () => {
        while (queue.length) {
          const s = queue.shift();
          try {
            const j = await getJSON(PRICE_URL(s), 2);
            if (j && !j.__404 && Array.isArray(j.data)) {
              const rows = j.data.map((d) => [
                ymdNum(d.date), +d.open || 0, +d.high || 0, +d.low || 0,
                +d.ltp || 0, +d.qty || 0, +d.turnover || 0,
              ]).filter((r) => r[4] > 0);
              rows.sort((a, b) => a[0] - b[0]);
              if (rows.length) {
                barsBySym[s] = rows.map((r) => ({
                  ymd: r[0], open: r[1], high: r[2], low: r[3],
                  close: r[4], qty: r[5], turnover: r[6],
                }));
              }
            } else if (j && !j.__404) {
              // compact mirror format fallback: {rows: [[ymd,o,h,l,c,qty,turnover]]}
              const rows = j.rows || j.bars || (Array.isArray(j) ? j : null);
              if (Array.isArray(rows) && rows.length) {
                barsBySym[s] = rows.map((r) => Array.isArray(r)
                  ? { ymd: r[0], open: r[1], high: r[2], low: r[3], close: r[4], qty: r[5], turnover: r[6] }
                  : r);
              }
            }
          } catch (e) { /* per-symbol failure recorded below */ }
          done++;
          if (done % 50 === 0) log('fetched', done + '/' + symbols.length);
        }
      })());
    }
    await Promise.all(workers);
    log('price history fetched for', Object.keys(barsBySym).length + '/' + symbols.length);
  }

  // ---- merge official closing session (v1 pattern, build-nepse-universe.js)
  // After market close, live.json holds validated official quotes. If the
  // fetched history hasn't ingested the new session yet, append the official
  // close as the latest bar. The official feed never publishes the session
  // open — it stays 0 (never invented); the engine scores on high/low/close.
  if (live.market === 'CLOSED' && Array.isArray(live.quotes)) {
    const closeYmd = ymdNum(sessionDate);
    const qmap = {};
    for (const q of live.quotes) if (q && q.symbol) qmap[q.symbol] = q;
    let merged = 0;
    for (const s of Object.keys(barsBySym)) {
      const bars = barsBySym[s];
      if (!bars.length || bars[bars.length - 1].ymd >= closeYmd) continue;
      const q = qmap[s];
      if (!q || !(+q.ltp > 0)) continue;
      bars.push({ ymd: closeYmd, open: 0, high: +q.high || +q.ltp, low: +q.low || +q.ltp,
        close: +q.ltp, qty: +q.volume || 0, turnover: +q.turnover || 0 });
      merged++;
    }
    log('official close merged:', merged + ' symbols @ ' + closeYmd);
  }

  // ---- run the engine
  const verdicts = {};
  const failures = [];
  for (const s of symbols) {
    const bars = barsBySym[s];
    if (!bars || bars.length < 5) {
      const barCount = bars ? bars.length : 0;
      const reason = barCount === 0 ? 'no price history' :
        'insufficient history (' + barCount + ' sessions, need 5+)';
      failures.push({ symbol: s, reason: reason, bars: barCount });
      continue;
    }
    try {
      // The engine was validated on ≤750-session histories (research mirror
      // window). Truncate upstream's full history to the most recent 750
      // sessions so ancient unadjusted corporate-action bars can't poison
      // the data-quality gate.
      const win = bars.length > 750 ? bars.slice(bars.length - 750) : bars;
      const v = generateVerdict({
        symbol: s,
        bars: win,
        dossier: dossiers[s] || null,
        regime: regime.regime,
        asofYmd,
        fundamentals,
      });
      verdicts[s] = v;
    } catch (e) {
      failures.push({ symbol: s, reason: String((e && e.message) || e).slice(0, 160) });
    }
  }
  log('verdicts:', Object.keys(verdicts).length, '| failures:', failures.length);

  // ---- summary (compact table feed)
  const summary = {};
  for (const [s, v] of Object.entries(verdicts)) {
    const ev = v.evidence || {};
    const sc = v.scores || {};
    summary[s] = {
      label: v.verdict,
      confidence: v.confidence,
      horizon: v.horizon_sessions,
      pump_score: sc.pump_score != null ? +Number(sc.pump_score).toFixed(3) : null,
      opportunity_score: sc.opportunity_score != null ? +Number(sc.opportunity_score).toFixed(3) : null,
      age_sessions: ev.identity ? ev.identity.age_sessions : null,
      sector: ev.identity ? ev.identity.sector : null,
      early_lifecycle: !!(ev.identity && ev.identity.age_sessions != null && ev.identity.age_sessions < 30),
      flags: (v.flags || []).map((f) => f.name || f),
      // lock-in for the index table: precise expiry ONLY when the source is
      // verified (user-verified / lockin-table tiers). Proxy sources carry
      // no date — the UI must not render a countdown from them (§2.1).
      lockin: ev.lockin ? {
        status: ev.lockin.status || null,
        source: ev.lockin.listing_date_source || null,
        expiry: (ev.lockin.listing_date_source === 'user-verified' ||
                 ev.lockin.listing_date_source === 'lockin-table')
          ? (ev.lockin.expiry || ev.lockin.lockin_end_ad || null) : null,
      } : null,
    };
  }

  const full = {
    asof: new Date().toISOString().slice(0, 10),
    session_date: sessionDate,
    regime: regime.regime,
    regime_note: regime.note,
    engine: 'verdict-v2',
    verdicts,
    failures,
  };
  const summ = {
    asof: full.asof,
    session_date: sessionDate,
    regime: regime.regime,
    regime_note: regime.note,
    engine: 'verdict-v2',
    count: Object.keys(summary).length,
    verdicts: summary,
  };
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  atomicWrite(path.join(outDir, 'verdicts-v2.json'), JSON.stringify(full));
  atomicWrite(path.join(outDir, 'verdicts-v2-summary.json'), JSON.stringify(summ));
  log('wrote', path.join(outDir, 'verdicts-v2.json'),
    '(' + fs.statSync(path.join(outDir, 'verdicts-v2.json')).size + ' bytes)');
  log('wrote', path.join(outDir, 'verdicts-v2-summary.json'),
    '(' + fs.statSync(path.join(outDir, 'verdicts-v2-summary.json')).size + ' bytes)');

  const labels = {};
  for (const v of Object.values(summary)) labels[v.label] = (labels[v.label] || 0) + 1;
  log('label distribution:', JSON.stringify(labels));
}

main().catch((e) => { console.error('verdicts-v2 FATAL:', e); process.exit(1); });
