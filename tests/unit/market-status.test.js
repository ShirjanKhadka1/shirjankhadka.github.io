/**
 * tests/unit/market-status.test.js — unit tests for the canonical NEPSE
 * market-status module (js/nepse-market-config.js).
 *
 * Run: node tests/unit/market-status.test.js   (exit 0 = pass)
 *
 * NEPSE trades Monday–Friday; Sat/Sun are holidays.
 * Pre-open 10:45:00–10:59:59 NPT; regular session 11:00–15:00 NPT.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'nepse-market-config.js'), 'utf8');
var sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'nepse-market-config.js' });
var MC = sandbox.NepseMarketConfig;
if (!MC) { console.error('FAIL: NepseMarketConfig did not load'); process.exit(1); }

// NPT wall-clock date (the config reads local getters off nowNPT()-style dates)
function npt(y, mo, d, h, mi) { return new Date(y, mo - 1, d, h, mi, 0); }

var failures = 0;
function eq(actual, expected, label) {
  if (actual === expected) { console.log('ok   ' + label); }
  else {
    failures++;
    console.log('FAIL ' + label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
  }
}

// --- Brief accept criteria ---
eq(MC.marketState(npt(2026, 10, 2, 11, 30)), 'OPEN', 'Fri 2026-10-02 11:30 NPT -> OPEN');
eq(MC.marketState(npt(2026, 10, 3, 11, 30)), 'CLOSED', 'Sat 2026-10-03 11:30 NPT -> CLOSED');

// --- Regression: the old nepse-live.js bug (d > 4) closed Friday, opened Sunday ---
eq(MC.marketState(npt(2026, 10, 2, 12, 0)), 'OPEN', 'Friday midday is OPEN (old bug: closed)');
eq(MC.marketState(npt(2026, 10, 4, 12, 0)), 'CLOSED', 'Sunday midday is CLOSED (old bug: open)');

// --- Pre-open window boundaries ---
eq(MC.marketState(npt(2026, 10, 2, 10, 44)), 'CLOSED', 'Fri 10:44 -> CLOSED (before pre-open)');
eq(MC.marketState(npt(2026, 10, 2, 10, 45)), 'PRE-OPEN', 'Fri 10:45 -> PRE-OPEN');
eq(MC.marketState(npt(2026, 10, 2, 10, 59)), 'PRE-OPEN', 'Fri 10:59 -> PRE-OPEN');
eq(MC.marketState(npt(2026, 10, 2, 11, 0)), 'OPEN', 'Fri 11:00 -> OPEN');
eq(MC.isPreOpen(npt(2026, 10, 2, 10, 50)), true, 'isPreOpen true at 10:50');
eq(MC.isPreOpen(npt(2026, 10, 2, 11, 0)), false, 'isPreOpen false at 11:00');
eq(MC.isPreOpen(npt(2026, 10, 3, 10, 50)), false, 'isPreOpen false on Saturday');

// --- Session boundaries ---
eq(MC.marketState(npt(2026, 10, 2, 14, 59)), 'OPEN', 'Fri 14:59 -> OPEN');
eq(MC.marketState(npt(2026, 10, 2, 15, 0)), 'CLOSED', 'Fri 15:00 -> CLOSED');
eq(MC.marketState(npt(2026, 10, 5, 11, 30)), 'OPEN', 'Mon 2026-10-05 11:30 -> OPEN');

// --- Trading days & holidays ---
eq(MC.isTradingDay('2026-10-02'), true, "isTradingDay('2026-10-02') Fri -> true");
eq(MC.isTradingDay('2026-10-03'), false, "isTradingDay('2026-10-03') Sat -> false");
eq(MC.isTradingDay('2026-10-04'), false, "isTradingDay('2026-10-04') Sun -> false");
eq(MC.isTradingDay('2026-10-21'), false, "isTradingDay('2026-10-21') Dashain holiday -> false");
eq(MC.marketState(npt(2026, 10, 21, 11, 30)), 'CLOSED', 'Dashain Wed 11:30 -> CLOSED');

// --- nowNPT sanity: returns a Date-like reading NPT wall-clock via local getters ---
var now = MC.nowNPT();
eq(typeof now.getTime === 'function' && !isNaN(now.getTime()), true, 'nowNPT returns a valid Date');

if (failures) { console.error('\n' + failures + ' assertion(s) FAILED'); process.exit(1); }
console.log('\nmarket-status: all ' + 'assertions passed');
