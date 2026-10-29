#!/usr/bin/env node
/* ROUND 2 / R2 unit tests for the invariant gates in tools/build-nepse-universe.js.
 * Each test FAILS (non-zero exit) on violation. Run: node tools/round2-test-r2.js
 * No network, no repo writes: requires the builder module (main() runs only
 * when the builder is the entry point) and exercises r2GateReasons directly.
 */
'use strict';
const { r2GateReasons, r2ApplyGate } = require('./build-nepse-universe.js');
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) failures++;
}
const confDT = [{ label: 'Double Top', note: 'Confirmed: closed below the neckline 2026-10-28.' }];
const formingDT = [{ label: 'Double Top', note: 'Forming: neckline at 500.' }];
const confHS = [{ label: 'Head & Shoulders', note: 'Confirmed: neckline broke 2026-10-27, classic reversal lower.' }];
// S1: confirmed bearish caps Buy/Strong Buy at Hold; forming does not.
check('S1 confirmed Double Top caps Strong Buy', r2ApplyGate('Strong Buy', r2GateReasons('Strong Buy', confDT, 'Banking', 'Equity', 1000)) === 'Hold');
check('S1 confirmed H&S caps Buy', r2ApplyGate('Buy', r2GateReasons('Buy', confHS, 'Hydropower', 'Equity', 500)) === 'Hold');
check('S1 forming Double Top does NOT cap (engine scores forming at 0)', r2GateReasons('Buy', formingDT, 'Banking', 'Equity', 1000).length === 0);
check('S1 does not touch Hold/Exit labels', r2GateReasons('Hold', confDT, 'Banking', 'Equity', 1000).length === 0);
// S2: sector+type UNION.
check('S2 sector Debentures caps Buy', r2GateReasons('Buy', [], 'Debentures', 'Equity', 1000).some((r) => r.startsWith('S2')));
check('S2 sector Mutual Funds caps Strong Buy', r2GateReasons('Strong Buy', [], 'Mutual Funds', 'Equity', 1000).some((r) => r.startsWith('S2')));
check('S2 sector Promoter Shares caps Buy', r2GateReasons('Buy', [], 'Promoter Shares', 'Equity', 1000).some((r) => r.startsWith('S2')));
check('S2 type Promoter share caps Buy even when sector is Others (PROFLP case)', r2GateReasons('Buy', [], 'Others', 'Promoter share', 1000).some((r) => r.startsWith('S2')));
check('S2 type Debenture caps Buy even when sector is Others', r2GateReasons('Buy', [], 'Others', 'Debenture', 1000).some((r) => r.startsWith('S2')));
check('S2 type Mutual fund caps Buy even when sector is Others', r2GateReasons('Buy', [], 'Others', 'Mutual fund', 1000).some((r) => r.startsWith('S2')));
check('S2 equity sector+type passes through', r2GateReasons('Buy', [], 'Banking', 'Equity', 1000).length === 0);
// S3: zero volume caps; positive volume passes.
check('S3 zero volume caps Buy', r2GateReasons('Buy', [], 'Banking', 'Equity', 0).some((r) => r.startsWith('S3')));
check('S3 null volume caps Buy', r2GateReasons('Buy', [], 'Banking', 'Equity', null).some((r) => r.startsWith('S3')));
check('S3 positive volume passes', r2GateReasons('Buy', [], 'Banking', 'Equity', 1).length === 0);
// Score-preservation contract is structural: r2ApplyGate changes only the
// label, never a score — the builder keeps v.score untouched (asserted by
// the before/after table: every gated row keeps its score).
if (failures) { console.error('R2 UNIT TESTS: ' + failures + ' FAILURES'); process.exit(1); }
console.log('R2 UNIT TESTS: ALL PASS');
