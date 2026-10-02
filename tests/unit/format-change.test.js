/**
 * tests/unit/format-change.test.js — unit tests for the shared day-change
 * formatter (NepseFormat.fmtChange / pctOfChange in js/nepse-format.js).
 *
 * A rupee amount must NEVER carry a % suffix:
 *   "Rs 5,278.20 · -277.70 (-5.00%)"   (negative)
 *   "Rs 1,460.00 · +12.30 (+1.20%)"    (positive)
 *   "0.00 (0.00%)"                     (zero — never "310.000.00")
 *
 * Run: node tests/unit/format-change.test.js   (exit 0 = pass)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'nepse-format.js'), 'utf8');
var sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'nepse-format.js' });
var F = sandbox.NepseFormat;
if (!F) { console.error('FAIL: NepseFormat did not load'); process.exit(1); }

var failures = 0;
function eq(actual, expected, label) {
  if (actual === expected) { console.log('ok   ' + label); }
  else {
    failures++;
    console.log('FAIL ' + label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
  }
}

// --- positive / negative / zero change ---
eq(F.fmtChange(-277.7, -4.9979), '-277.70 (-5.00%)', 'negative: rupee leg has no % suffix');
eq(F.fmtChange(12.345, 1.234), '+12.35 (+1.23%)', 'positive: signed rupee + signed pct');
eq(F.fmtChange(0, 0), '0.00 (0.00%)', 'zero: renders "0.00 (0.00%)"');

// --- unknown / missing ---
eq(F.fmtChange(null, null), '—', 'null change -> em dash');
eq(F.fmtChange(undefined, 1.5), '—', 'undefined change -> em dash');
eq(F.fmtChange('abc', 1.5), '—', 'non-numeric change -> em dash');
eq(F.fmtChange(-277.7, null), '-277.70', 'null pct -> rupee leg only, no dangling parens');
eq(F.fmtChange(5, undefined), '+5.00', 'undefined pct -> rupee leg only');

// --- no doubled decimals, ever ("310.000.00" regression) ---
var dbl = /^\D?[\d,]+\.\d{2}( \([+-]?[\d,]+\.\d{2}%\))?$/;
['-277.70 (-5.00%)', '+12.35 (+1.23%)', '0.00 (0.00%)', '-277.70'].forEach(function (s) {
  eq(dbl.test(s), true, 'shape ok (no doubled decimals): ' + s);
});
eq(dbl.test('310.000.00'), false, 'shape rejects the old "310.000.00" defect');

// --- pctOfChange: percent derived from rupee change + last price ---
eq(F.pctOfChange(-277.7, 5278.2).toFixed(2), '-5.00', 'pctOfChange(-277.70, 5278.20) = -5.00%');
eq(F.pctOfChange(0, 100), 0, 'pctOfChange(0, 100) = 0');
eq(F.pctOfChange(null, 100), null, 'pctOfChange(null, price) = null');
eq(F.pctOfChange(5, null), null, 'pctOfChange(ch, null) = null');
eq(F.pctOfChange(0, 0), null, 'pctOfChange(0, 0) = null (no prev close)');

// --- rsOfPct: rupee change derived from percent + last price ---
// (verdicts.json ch is PERCENT; live quotes carry rupees directly)
eq(F.rsOfPct(-1.23, 5555.9).toFixed(2), '-69.19', 'rsOfPct(-1.23, 5555.90) = -69.18 Rs');
eq(F.rsOfPct(0, 100), 0, 'rsOfPct(0, 100) = 0');
eq(F.rsOfPct(null, 100), null, 'rsOfPct(null, price) = null');
eq(F.rsOfPct(1.5, null), null, 'rsOfPct(pct, null) = null');
eq(F.rsOfPct(5, 0), null, 'rsOfPct(pct, 0) = null');

// --- batch rows (verdicts percent) render rupee + percent, never "x%" on rupees ---
var batchRow = 'Rs ' + F.fmtPrice(5555.9) + ' · ' + F.fmtChange(F.rsOfPct(-1.23, 5555.9), -1.23);
eq(batchRow, 'Rs 5,555.90 · -69.19 (-1.23%)', 'engine batch row: rupee leg has no % suffix');

// --- full watchlist row rendering (brief accept criteria) ---
var pct = F.pctOfChange(-277.7, 5278.2);
var row = 'Rs ' + F.fmtPrice(5278.2) + ' · ' + F.fmtChange(-277.7, pct);
eq(row, 'Rs 5,278.20 · -277.70 (-5.00%)', 'STC row: "Rs 5,278.20 · -277.70 (-5.00%)"');
eq(F.fmtPrice(0), '—', 'fmtPrice(0) is never "0.00"');

if (failures) { console.error('\n' + failures + ' assertion(s) FAILED'); process.exit(1); }
console.log('\nformat-change: all assertions passed');
