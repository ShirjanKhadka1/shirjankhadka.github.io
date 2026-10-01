#!/usr/bin/env node
/**
 * tools/validate-build.js
 * Hard data-validation gates. Exit 0 = pass, exit 1 = FAIL (no deploy).
 *
 * Gates:
 *  1. session_date in live.json/universe.json matches newest expected trading day
 *  2. quoted security count within ±3% of the previous manifest (or universe count)
 *  3. no null/zero/negative LTP on any quoted symbol; high>=low>=0 sanity on OHLC
 *  4. no duplicate symbols in universe.json
 *  5. signal files regenerated for the current session (generated_at >= session)
 *  6. manifest.json exists and every tracked file parses as JSON
 *
 * Usage: node tools/validate-build.js [--session YYYY-MM-DD]
 * Writes validation results to nepse-chart/data/validation.json for /status/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const td = require('./trading-days');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');

const results = [];
function gate(name, ok, detail) {
  results.push({ gate: name, pass: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function readData(rel) {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
}
function readRepo(rel) {
  // manifest file keys are repo-relative (e.g. 'nepse-chart/data/live.json')
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
function sessionOf(obj) {
  // live.json asof is ISO datetime; universe.json asof is YYYY-MM-DD
  const a = obj.asof || obj.updated || '';
  return String(a).slice(0, 10);
}

function main() {
  const argSession = (process.argv.find(a => a.startsWith('--session=')) || '').split('=')[1];
  const now = new Date();
  const expected = argSession || td.expectedSessionDate(now);
  const failures = [];

  // Gate 0: manifest exists and is fresh
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    gate('manifest-present', true, `data/manifest.json session=${manifest.session_date}`);
  } catch (e) {
    gate('manifest-present', false, 'data/manifest.json: ' + e.message);
  }

  // Gate 1: session date matches expected trading day
  let live = null, universe = null;
  try { live = readData('live.json'); } catch (e) { gate('live.json-parse', false, e.message); }
  try { universe = readData('universe.json'); } catch (e) { gate('universe.json-parse', false, e.message); }
  if (live) {
    const s = sessionOf(live);
    gate('live-session-current', s === expected, `live=${s} expected=${expected}`);
  }
  if (universe) {
    const s = sessionOf(universe);
    gate('universe-session-current', s === expected, `universe=${s} expected=${expected}`);
  }

  // Gate 2: quoted count stable vs PREVIOUS build (±5%).
  // Compared against the previous manifest's live.json row count, NOT the
  // universe count: live.json only carries securities with quotes (traded),
  // while universe.json lists every listed security incl. untraded
  // debentures / mutual funds / suspended equities. A ±5% band (not ±3%)
  // because suspensions and trading halts legitimately move the count.
  if (live) {
    const q = Object.values(live.quotes || {}).length;
    let baseline = null, baselineSrc = '';
    try {
      const prev = child_process.execSync('git show HEAD:data/manifest.json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
      const pm = JSON.parse(prev.toString());
      baseline = pm.files && pm.files['nepse-chart/data/live.json'] && pm.files['nepse-chart/data/live.json'].rows;
      baselineSrc = 'previous manifest';
    } catch (e) { /* first run: no baseline */ }
    if (baseline && typeof baseline === 'number' && baseline > 0) {
      const drift = Math.abs(q - baseline) / baseline;
      gate('security-count-stable', drift <= 0.05, `quotes=${q} baseline=${baseline} (${baselineSrc}) drift=${(drift * 100).toFixed(1)}% band=±5%`);
    } else {
      gate('security-count-stable', q >= 300, `quotes=${q} (no baseline yet; absolute floor 300)`);
    }
    // no duplicate symbols inside the quotes themselves
    const seen = new Set(); const dups = [];
    for (const v of Object.values(live.quotes || {})) {
      if (seen.has(v.symbol)) dups.push(v.symbol); else seen.add(v.symbol);
    }
    gate('no-dup-quotes', dups.length === 0, dups.length ? 'dups: ' + dups.slice(0, 5).join(',') : `${seen.size} unique quoted symbols`);
  }

  // Gate 3: price sanity on every quote
  if (live) {
    const bad = [];
    for (const [sym, q] of Object.entries(live.quotes || {})) {
      if (q.ltp == null || !(q.ltp > 0)) bad.push(`${sym}:ltp=${q.ltp}`);
      else if (q.high != null && q.low != null && (q.high < q.low || q.low < 0)) bad.push(`${sym}:ohlc`);
      if (bad.length >= 10) break;
    }
    gate('price-sanity', bad.length === 0, bad.length ? bad.slice(0, 10).join('; ') : `${Object.keys(live.quotes).length} quotes ok`);
  }

  // Gate 4: no duplicate symbols in universe
  if (universe && Array.isArray(universe.symbols)) {
    const seen = new Set(); const dups = [];
    for (const s of universe.symbols) {
      const k = s.s || s.symbol;
      if (seen.has(k)) dups.push(k); else seen.add(k);
    }
    gate('no-dup-symbols', dups.length === 0, dups.length ? 'dups: ' + dups.slice(0, 5).join(',') : `${seen.size} unique`);
  }

  // Gate 5: signals recomputed for this session
  for (const f of ['signals/momentum.json', 'signals/trend-relay.json', 'signals/reversal.json']) {
    try {
      const sig = readData(f);
      const gen = String(sig.generated_at || sig.asof || '').slice(0, 10);
      gate(`${f}-fresh`, gen >= expected, `generated=${gen || 'missing'} expected>=${expected}`);
    } catch (e) {
      gate(`${f}-fresh`, false, e.message);
    }
  }

  // Gate 6: every manifest-tracked file still parses
  if (manifest) {
    const bad = [];
    for (const rel of Object.keys(manifest.files || {})) {
      try { readRepo(rel); } catch (e) { bad.push(rel); if (bad.length >= 10) break; }
    }
    gate('all-files-parse', bad.length === 0, bad.length ? bad.join(', ') : `${Object.keys(manifest.files).length} files ok`);
  }

  const failed = results.filter(r => !r.pass);
  const report = {
    ran_at_npt: td.todayNPT(now) + 'T' + td.timeNPT(now) + ':00+05:45',
    expected_session: expected,
    passed: failed.length === 0,
    gates: results,
  };
  fs.writeFileSync(path.join(DATA, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${results.length - failed.length}/${results.length} gates passed — validation.json written`);
  if (failed.length) {
    console.error('VALIDATION FAILED — deploy blocked.');
    process.exit(1);
  }
}

if (require.main === module) main();
