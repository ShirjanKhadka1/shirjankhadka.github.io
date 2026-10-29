/* ROUND 2 / R3 regression tests for the screener-calls ledger fix in
 * tools/screener-tracking.js.
 *
 * Run: node tools/round2-test-r3.js   (from the repo root)
 * No network, no repo writes. Exits non-zero on ANY failure.
 *
 * The headline regression test: walk EVERY call in the live
 * nepse-chart/data/screener-calls.json against its archive history
 * series through the ledger's asof, and FAIL if any call is skipped as
 * unknown_series (or has no series at all). That skip is exactly how
 * the pre-R3 date-type bug froze all 65 audit calls at
 * sessions_elapsed 0 with no error anywhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { walkCall, adjustForCorporateActions, ymdNum } =
  require('./screener-tracking.js');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) failures++;
}

// ---- Unit: date-type alignment (R3 fix 1) ----
// Series dates are YYYYMMDD numbers; call dates are 'YYYY-MM-DD' strings.
const series = [
  [20261016, 100, 102, 99, 101, 1000, 101000],
  [20261026, 101, 103, 100, 102, 1000, 102000],
  [20261027, 102, 104, 101, 103, 1000, 103000],
  [20261028, 103, 105, 102, 104, 1000, 104000],
];
const strCall = { date: '2026-10-16', entry: 101, sl: 95, tp: 110,
  sessions_elapsed: 0, last_return: null };
const updStr = walkCall(strCall, series);
check('R3-1 string call date walks (not unknown_series)', !updStr.unknown_series);
check('R3-1 string call date counts elapsed sessions', updStr.sessions_elapsed === 3);
const numCall = { date: 20261016, entry: 101, sl: 95, tp: 110,
  sessions_elapsed: 0, last_return: null };
check('R3-1 numeric call date still walks', !walkCall(numCall, series).unknown_series);
const absentCall = { date: '2026-10-20', entry: 101, sl: 95, tp: 110,
  sessions_elapsed: 0, last_return: null };
check('R3-1 genuinely absent call date still reports unknown_series',
  walkCall(absentCall, series).unknown_series === true);

// ---- Unit: walk semantics preserved (stop before target, tp, expiry) ----
const slSeries = [
  [20261016, 100, 102, 99, 101, 1000, 101000],
  [20261026, 101, 103, 94, 100, 1000, 100000], // low 94 trips sl 95
];
check('R3-walk stop closes on sl with string exit_date',
  (() => { const u = walkCall(strCall, slSeries);
    return u.status === 'closed' && u.exit === 'sl' &&
      u.exit_date === '2026-10-26' && u.sessions_held === 1; })());
const tpSeries = [
  [20261016, 100, 102, 99, 101, 1000, 101000],
  [20261026, 101, 111, 100, 108, 1000, 108000], // high 111 trips tp 110
];
check('R3-walk target closes on tp',
  (() => { const u = walkCall(strCall, tpSeries);
    return u.status === 'closed' && u.exit === 'tp'; })());
const bothSeries = [
  [20261016, 100, 102, 99, 101, 1000, 101000],
  [20261026, 101, 111, 94, 108, 1000, 108000], // both tripped: stop wins
];
check('R3-walk stop checked before target on the same bar',
  walkCall(strCall, bothSeries).exit === 'sl');
const flatSeries = [[20261016, 100, 102, 99, 101, 1000, 101000]];
for (let i = 1; i <= 21; i++) {
  flatSeries.push([20261016 + i, 101, 103, 100, 102, 1000, 102000]);
}
check('R3-walk expires after 20 sessions without tp/sl',
  walkCall(strCall, flatSeries).exit === 'expired');

// ---- Unit: corporate-action handling (R3 fix 2, MEN pattern) ----
// Bonus ex-date: prev close 675.5, next open 562.92 (ratio 0.8333).
// Raw low 560 trips sl 648.21; adjusted stop is 540.18, call stays open.
const menSeries = [
  [20261016, 664.8, 674.7, 665, 671, 173479, 116501269],
  [20261026, 671, 680, 673, 675.5, 265782, 179732028.5],
  [20261027, 562.92, 580, 560, 570.8, 177854, 101899695.3],
  [20261028, 570.8, 591.8, 570.8, 590.2, 157214, 91831166.8],
];
const menCall = { date: '2026-10-16', entry: 671, sl: 648.21, tp: 716.58,
  sessions_elapsed: 0, last_return: null };
const menRaw = walkCall(menCall, menSeries);
check('R3-2 raw (unadjusted) MEN walk false-closes on sl (bug demo)',
  menRaw.status === 'closed' && menRaw.exit === 'sl');
const menAdj = adjustForCorporateActions(menCall, menSeries);
check('R3-2 CA adjustment detected for MEN ex-date',
  menAdj.adjustments.length === 1 &&
  Math.abs(menAdj.adjustments[0].ratio - 0.8333) < 0.001);
const menFixed = walkCall(menAdj.call, menAdj.series);
check('R3-2 CA-adjusted MEN call stays open',
  menFixed.status === 'open' && !menFixed.unknown_series);
check('R3-2 CA-adjusted MEN stop is ~540.18',
  Math.abs(menAdj.call.sl - 540.18) < 0.05);
check('R3-2 sub-10% gaps are NOT adjusted (no false CA)',
  adjustForCorporateActions(menCall, series).adjustments.length === 0);

// ---- Live ledger regression: NO call skipped as unknown_series ----
const callsPath = path.join(ROOT, 'nepse-chart', 'data', 'screener-calls.json');
const callsDoc = JSON.parse(fs.readFileSync(callsPath, 'utf8'));
const asofNum = ymdNum(callsDoc.asof);
let unknown = [], missing = [], walked = 0;
for (const call of callsDoc.calls) {
  const file = path.join(ROOT, 'nepse-chart', 'data', 'history',
    call.sym.replace(/\//g, '-') + '.json');
  let hj;
  try { hj = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { missing.push(call.sym); continue; }
  // Walk only through the ledger's asof: never score beyond what the
  // ledger claims to cover (no lookahead past data_through).
  const srs = (hj.data || []).filter((r) => r[0] <= asofNum);
  const adjd = adjustForCorporateActions(call, srs);
  const upd = walkCall(adjd.call, adjd.series);
  if (upd.unknown_series) unknown.push(call.sym + ' ' + call.date);
  else walked++;
}
console.log('R3-ledger: ' + callsDoc.calls.length + ' calls @ asof ' +
  callsDoc.asof + ', walked ' + walked + ', unknown_series ' +
  unknown.length + ', missing-series ' + missing.length);
if (unknown.length) console.log('  unknown_series: ' + unknown.join(', '));
if (missing.length) console.log('  missing series: ' + missing.join(', '));
check('R3-ledger ZERO calls skipped as unknown_series', unknown.length === 0);
check('R3-ledger ZERO calls missing a history series', missing.length === 0);

if (failures) {
  console.error('R3 UNIT TESTS: ' + failures + ' FAILURES');
  process.exit(1);
}
console.log('R3 UNIT TESTS: ALL PASS');
