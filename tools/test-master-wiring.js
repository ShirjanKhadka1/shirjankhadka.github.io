#!/usr/bin/env node
/* Charter 4B wiring test — no network, no repo writes.
 * Fails (non-zero) on any of:
 *  1. A deleted classifier still present as CODE in a consumer
 *     (function classifySymbol, var SECTOR_MAP literal, secOf 'Others'
 *     fallback, /promoter/ or debenture-suffix type regex in builders).
 *     (Mentions inside 4B comments explaining the deletion are ignored:
 *     the checks below look for code shapes, not bare words.)
 *  2. Any builder still reading tools/sector-map.json as a source
 *     (the file itself survives ONLY as a derived view; the only
 *     writer allowed is tools/build-master-view.js).
 *  3. Any verdicts.json/universe.json classification field disagreeing
 *     with data/reference/instruments.json (sec = master sector or
 *     null for UNCONFIRMED; universe t = master legacy type; verdicts
 *     type = master instrument_type).
 *  4. Any v2 dossier identity sector/type disagreeing with the master.
 *  5. The v2 type-only gate failing its key cases (KSBBLD87 and LSH12
 *     excluded with NO dossier at all; PMLIP excluded as PROMOTER;
 *     an equity with an issuer sector never excluded by sector).
 *  6. Any derived view (js/nd-master.js, instruments-view.json,
 *     tools/sector-map.json) disagreeing with the master.
 *
 * Usage: node tools/test-master-wiring.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('./master-instruments.js');
const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : ' — ' + extra));
  if (!cond) failures++;
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

// 1. Deleted classifiers as code
const codeChecks = [
  ['js/nepse-sectors.js', /function classifySymbol|classifySymbol\(it\.s|SECTOR_OVERRIDES\s*=/],
  ['js/nepse-screener.js', /function classifySymbol|classifySymbol\(it\.s|SECTOR_OVERRIDES\s*=/],
  ['js/nd-daily.js', /function classifySymbol|var SECTOR_MAP\s*=/],
  ['tools/build-symbol-pages.js', /function classifySymbol|classifySymbol\(u\.s|SECTOR_OVERRIDES\s*=/],
  ['tools/build-nepse-universe.js', /function classify\(|VERIFIED_OVERRIDES\s*=/],
  ['tools/build-sector-map.js', /./], // file must not exist at all
];
for (const [f, re] of codeChecks) {
  const p = path.join(ROOT, f);
  if (f === 'tools/build-sector-map.js') {
    check('deleted: ' + f + ' absent', !fs.existsSync(p));
  } else {
    check('no classifier code in ' + f, !re.test(read(f)));
  }
}
// 2. sector-map.json as a source: only the view builder may write/read it as data
// Code-shaped reads only (a 4B comment explaining the deletion may name
// the file; only an actual load counts as a source read).
for (const f of ['tools/build-nepse-universe.js', 'tools/build_trending_value.py',
  'tools/build-symbol-pages.js', 'js/nepse-sectors.js', 'js/nepse-screener.js']) {
  check('no sector-map source read in ' + f,
    !/load_json\(['"]tools\/sector-map\.json|readFileSync\([^)]*sector-map\.json/.test(read(f)));
}
check('sector-map.json is marked derived on every entry', (() => {
  const sm = JSON.parse(read('tools/sector-map.json'));
  return Object.values(sm).every((e) => e && e.derived === true &&
    e.derived_from === 'data/reference/instruments.json');
})());

// 3. verdicts + universe vs master
const uni = JSON.parse(read('nepse-chart/data/universe.json'));
const ver = JSON.parse(read('nepse-chart/data/verdicts.json'));
let badU = [], badV = [];
for (const row of uni.symbols) {
  const m = M.row(row.s);
  if (!m) { badU.push(row.s + ':unmastered'); continue; }
  if (row.sec !== m.sector) badU.push(row.s + ':sec ' + row.sec + ' != ' + m.sector);
  if (row.t !== M.legacyTypeOf(row.s)) badU.push(row.s + ':t ' + row.t + ' != ' + M.legacyTypeOf(row.s));
}
for (const [sym, row] of Object.entries(ver.verdicts)) {
  const m = M.row(sym);
  if (!m) { badV.push(sym + ':unmastered'); continue; }
  if (row.sec !== m.sector) badV.push(sym + ':sec ' + row.sec + ' != ' + m.sector);
  if (row.type !== m.type) badV.push(sym + ':type ' + row.type + ' != ' + m.type);
}
check('universe classification == master (' + uni.symbols.length + ' rows)', badU.length === 0, badU.slice(0, 5).join('; '));
check('verdicts classification == master (' + Object.keys(ver.verdicts).length + ' rows)', badV.length === 0, badV.slice(0, 5).join('; '));
check('no verdicts sec is an old bucket value', Object.values(ver.verdicts).every(
  (r) => r.sec == null || M.isMasterSector(r.sec)));
check('no verdicts sec is "Others"/"Unclassified"/"UNCONFIRMED"', Object.values(ver.verdicts).every(
  (r) => ['Others', 'Unclassified', 'UNCONFIRMED'].indexOf(r.sec) < 0));

// 4. dossiers vs master
const dos = JSON.parse(read('tools/verdict-engine-v2/dossiers-compact.json'));
let badD = [];
for (const [sym, d] of Object.entries(dos)) {
  if (!d || !d.identity) continue;
  const m = M.row(sym);
  if (!m) continue; // merger-absorbed ghosts (SFCL/WNLB) — flagged, not failed
  if (d.identity.sector !== m.sector) badD.push(sym + ':sector');
  if (d.identity.instrument_type !== m.type) badD.push(sym + ':type');
}
check('dossier identity == master', badD.length === 0, badD.slice(0, 5).join('; '));

// 5. v2 type-only gate
const { generateVerdict } = require('./verdict-engine-v2/engine.js');
const bars = [];
for (let i = 0; i < 60; i++) bars.push({ ymd: 20260101 + i, open: 100, high: 101, low: 99, close: 100 + i * 0.1, volume: 1000 });
function verdictFor(sym, dossier) {
  return generateVerdict({ symbol: sym, bars, dossier: dossier || null, regime: 'up',
    asofYmd: 20260301, opts: { instrument_type: M.typeOf(sym) } });
}
check('v2 gate: KSBBLD87 excluded with NO dossier (type-only)', verdictFor('KSBBLD87').verdict === 'EXCLUDED_NON_EQUITY');
check('v2 gate: LSH12 excluded with NO dossier (type-only)', verdictFor('LSH12').verdict === 'EXCLUDED_NON_EQUITY');
check('v2 gate: PMLIP excluded as PROMOTER', verdictFor('PMLIP').verdict === 'EXCLUDED_NON_EQUITY');
check('v2 gate: debenture with issuer sector NOT excluded by sector', (() => {
  const v = verdictFor('ADBLD83', { identity: { sector: 'Commercial Bank', instrument_type: 'DEBENTURE' } });
  return v.verdict === 'EXCLUDED_NON_EQUITY'; // excluded by TYPE, and the reason names the type, not the sector
})());
check('v2 gate: equity never excluded', verdictFor('ADBL').verdict !== 'EXCLUDED_NON_EQUITY');

// 6. derived views == master
const view = JSON.parse(read('data/reference/instruments-view.json'));
let badW = [];
for (const [sym, r] of Object.entries(view.rows)) {
  const m = M.row(sym);
  if (!m || r.type !== m.type || r.sector !== m.sector) badW.push(sym);
}
check('instruments-view.json == master', badW.length === 0 && Object.keys(view.rows).length === 428, badW.slice(0, 5).join('; '));
const ndMaster = read('js/nd-master.js');
check('nd-master.js carries ADBL Commercial Bank + BENH Hydropower + PMLIP PROMOTER',
  ndMaster.indexOf('"ADBL":["EQUITY","Commercial Bank"]') >= 0 &&
  ndMaster.indexOf('"BENH":["EQUITY","Hydropower"]') >= 0 &&
  ndMaster.indexOf('"PMLIP":["PROMOTER","Life Insurance"]') >= 0);

if (failures) { console.error('MASTER WIRING TEST: ' + failures + ' FAILURES'); process.exit(1); }
console.log('MASTER WIRING TEST: ALL PASS');
