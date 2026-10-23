#!/usr/bin/env node
/**
 * sync-signal-stats.js — single source for the published backtest stats.
 *
 * The canonical stats live in nepse-chart/data/signals/momentum.json
 * (written by tools/build-signals.js; the signal detail pages are baked
 * from the same JSON family by tools/build-signal-pages.js, and both the
 * /nepse-signals/ landing and its methodology page already correct their
 * spans from momentum.json at runtime). What drifted was the BAKED
 * fallback text in those two hand-maintained pages — crawlers and no-JS
 * visitors saw a stale universe/window (313 symbols, window ending
 * 2026-10-08) while the data said 316 / 2026-10-16.
 *
 * This tool rewrites the baked fallbacks from momentum.json so all three
 * surfaces (landing, methodology, detail pages) publish ONE universe and
 * ONE window. Run it after every build-signals.js run. Idempotent; exits
 * non-zero if a target span or the data is missing, so a rename in the
 * pages surfaces here instead of silently drifting again.
 *
 * Usage: node tools/sync-signal-stats.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'nepse-chart', 'data', 'signals', 'momentum.json');

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const st = data.stats || {};
const from = st.backtest_from, to = st.backtest_to, uni = data.universe_symbols;
if (!from || !to || uni == null) {
  console.error('sync-signal-stats: momentum.json is missing stats.backtest_from/backtest_to or universe_symbols');
  process.exit(1);
}
const yrs = ((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5 / 365.25);
const yrs1 = yrs.toFixed(1), yrs2 = yrs.toFixed(2);

let failures = 0;
function patch(file, subs) {
  const p = path.join(ROOT, file);
  let s = fs.readFileSync(p, 'utf8');
  for (const [re, val, label] of subs) {
    const m = s.match(re);
    if (!m) { console.error(`sync-signal-stats: MISSING target ${label} in ${file}`); failures++; continue; }
    if (m[2] !== val) console.log(`${file}: ${label}: "${m[2]}" -> "${val}"`);
    s = s.replace(re, (whole, pre, old, post) => pre + val + post);
  }
  fs.writeFileSync(p, s);
}

const span = (id) => new RegExp(`(<span id="${id}">)([^<]*)(</span>)`);

patch('nepse-signals/index.html', [
  [span('sig-range'), `${from} to ${to}`, '#sig-range'],
  [span('sig-syms'), String(uni), '#sig-syms'],
  [/(<span class="sigwin" data-form="hyphen">)([^<]*)(<\/span>)/, `${yrs1}-year`, '.sigwin'],
]);

patch('nepse-signals/methodology/index.html', [
  [span('m-symbols'), String(uni), '#m-symbols'],
  [span('m-window'), `${from} → ${to}`, '#m-window'],
  [span('m-window-yrs'), `≈ ${yrs1}`, '#m-window-yrs'],
  [span('m-T'), yrs2, '#m-T'],
]);

if (failures) { console.error(`sync-signal-stats: ${failures} target(s) missing`); process.exit(1); }
console.log(`sync-signal-stats: baked fallbacks now match momentum.json (universe ${uni}, window ${from} -> ${to})`);
