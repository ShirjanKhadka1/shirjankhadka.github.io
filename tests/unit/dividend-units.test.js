/**
 * tests/unit/dividend-units.test.js — unit tests for the Investment
 * Calendar dividend row renderer (tools/build-symbol-pages.js
 * dividendCells, extracted from the inline table loop in 4C).
 *
 * Regression cover for the UNL fix: a per-share dividend must NEVER
 * render with a % suffix ("NPR 1,540 per share", not "1540 %"), while
 * percent rows keep "%". A row is per-share when it carries
 * dividend_unit 'per_share' (div-live) or the symbol is UNL (legacy
 * yonepse rows carry no unit field).
 *
 * Deliberate non-guessing: a rupee-scale row with NO unit evidence
 * (NMBCAP 2073/2074, cash 105.26, bonus 0) still renders as percent
 * until evidence arrives — the 4C dividend scan lists it unchanged;
 * the renderer must not guess a unit from magnitude alone.
 *
 * LEGACY DEFAULT (documented, NOT verified-correct): a row with NO
 * dividend_unit and a non-UNL symbol renders as percent. That is the
 * current default for unproven rows, not a claim that the unit IS
 * percent — any such row is only as correct as its source data.
 * The NMBCAP case below pins this default so a future change to it
 * is a deliberate, reviewed decision, not a silent drift.
 *
 * Run: node tests/unit/dividend-units.test.js   (exit 0 = pass)
 * CI: .github/workflows/ci.yml "Node unit tests" step runs every
 * tests/unit/*.test.js on every PR (added after #351 landed this
 * file without any CI wiring — until then it ran nowhere).
 */
'use strict';
var B = require('../../tools/build-symbol-pages.js');
var dividendCells = B.dividendCells;
if (!dividendCells) { console.error('FAIL: dividendCells not exported'); process.exit(1); }

var failures = 0;
function eq(actual, expected, label) {
  if (actual === expected) { console.log('ok   ' + label); }
  else {
    failures++;
    console.log('FAIL ' + label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
  }
}

// --- per_share unit flag (div-live UNL 2082/2083) ---
var live = dividendCells({ bonus_share: '0', cash_dividend: '1540', total_dividend: '1540', dividend_unit: 'per_share' }, 'UNL');
eq(live.cash, 'NPR 1,540 per share', 'per_share: cash renders "NPR 1,540 per share"');
eq(live.total, 'NPR 1,540 per share', 'per_share: total renders "NPR 1,540 per share"');
eq(live.bonus, '0 %', 'per_share: bonus stays a percent');
eq(live.perShare, true, 'per_share: flag true');
eq(/%/.test(live.cash), false, 'per_share: cash carries no % suffix');
eq(/%/.test(live.total), false, 'per_share: total carries no % suffix');

// --- per_share flag on a non-UNL symbol (unit decides, not symbol) ---
var other = dividendCells({ bonus_share: '5', cash_dividend: '1200', total_dividend: '1200', dividend_unit: 'per_share' }, 'NABIL');
eq(other.cash, 'NPR 1,200 per share', 'per_share on other symbol: cash per-share');
eq(other.bonus, '5 %', 'per_share on other symbol: bonus stays percent');

// --- UNL legacy row without a unit field (yonepse history) ---
var legacy = dividendCells({ bonus_share: '0', cash_dividend: '1842', total_dividend: '1842' }, 'UNL');
eq(legacy.cash, 'NPR 1,842 per share', 'UNL legacy: cash renders per-share without unit field');
eq(legacy.total, 'NPR 1,842 per share', 'UNL legacy: total renders per-share without unit field');

// --- ordinary percent row keeps "%" everywhere, never per-share text ---
var pct = dividendCells({ bonus_share: '10', cash_dividend: '5', total_dividend: '15' }, 'NABIL');
eq(pct.bonus, '10 %', 'percent row: bonus "10 %"');
eq(pct.cash, '5 %', 'percent row: cash "5 %"');
eq(pct.total, '15 %', 'percent row: total "15 %"');
eq(pct.perShare, false, 'percent row: flag false');
eq(/per share/.test(pct.cash), false, 'percent row: cash carries no per-share text');
eq(/per share/.test(pct.total), false, 'percent row: total carries no per-share text');
eq(/NPR/.test(pct.cash), false, 'percent row: cash carries no NPR text');
eq(/NPR/.test(pct.total), false, 'percent row: total carries no NPR text');

// --- legacy default: NO dividend_unit + non-UNL symbol keeps percent rendering ---
// (current default, NOT verified-correct — see header; the percent claim
// for such a row rests on its source data, not on this test)
var legacyPct = dividendCells({ bonus_share: '10', cash_dividend: '5', total_dividend: '15' }, 'EBL');
eq(legacyPct.cash, '5 %', 'legacy default: no-unit non-UNL row keeps percent cash');
eq(legacyPct.total, '15 %', 'legacy default: no-unit non-UNL row keeps percent total');
eq(legacyPct.perShare, false, 'legacy default: perShare flag false');

// --- missing figures render as dashes, never "NaN" or "%" ---
var dash = dividendCells({ bonus_share: null, cash_dividend: null, total_dividend: null }, 'NABIL');
eq(dash.bonus, '–', 'missing: bonus dash');
eq(dash.cash, '–', 'missing: cash dash');
eq(dash.total, '–', 'missing: total dash');

// --- comma-formatted input is normalised, not doubled ---
var comma = dividendCells({ bonus_share: '0', cash_dividend: '1,540', total_dividend: '1,540', dividend_unit: 'per_share' }, 'UNL');
eq(comma.cash, 'NPR 1,540 per share', 'comma input: "1,540" renders once, not doubled');

// --- NMBCAP 2073/2074: no-evidence row stays percent (scan lists it, renderer does not guess) ---
var nmb = dividendCells({ bonus_share: '0.00', cash_dividend: '105.26', total_dividend: '105.26' }, 'NMBCAP');
eq(nmb.cash, '105.26 %', 'NMBCAP no-evidence row: still percent until evidence arrives (see 4C scan)');

if (failures) { console.log(failures + ' FAILURES'); process.exit(1); }
console.log('dividend-units: all pass');
