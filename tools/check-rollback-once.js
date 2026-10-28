#!/usr/bin/env node
/**
 * tools/check-rollback-once.js — P3-1 rollback-once-per-session guard.
 * Usage: node tools/check-rollback-once.js <session>
 * Exits 0 if no rollback is recorded for the session in
 * nepse-chart/data/rollback-log.json; exits 1 (loud) if one already exists.
 * To force a second rollback, an operator must delete that session's entry
 * from rollback-log.json by hand — that deletion is the audit trail that
 * the guard was deliberately overridden.
 * NOTE: jobs.json cannot serve this guard — record-job.js keeps only the
 * LATEST record per job name, so a rollback from an earlier retry leaves no
 * per-session history there. The append-only rollback-log.json exists
 * because of that.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEDGER = path.join(ROOT, 'nepse-chart', 'data', 'rollback-log.json');

const session = process.argv[2];
if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(session)) {
  console.error(`check-rollback-once: invalid session "${session}" (expected YYYY-MM-DD)`);
  process.exit(2);
}
let ledger = [];
try {
  ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') {
    // Fail CLOSED on a corrupt/unreadable ledger: an anomaly must block
    // the rollback (operator fixes the file by hand), never silently allow
    // a repeat rollback the guard can no longer see.
    console.error(`check-rollback-once: ledger ${LEDGER} unreadable (${e.message}) — refusing rollback until it is fixed by hand.`);
    process.exit(2);
  }
  /* ENOENT: no ledger yet — no prior rollback */
}
if (!Array.isArray(ledger)) {
  console.error(`check-rollback-once: ledger ${LEDGER} is not a JSON array — refusing rollback until it is fixed by hand.`);
  process.exit(2);
}
const hit = ledger.find((e) => e && e.session === session);
if (hit) {
  console.error(`check-rollback-once: REFUSED — session ${session} was already rolled back once (to ${hit.tag}). Refusing a second rollback. To override deliberately, remove that session's entry from nepse-chart/data/rollback-log.json and re-run.`);
  process.exit(1);
}
console.log(`check-rollback-once: OK — no prior rollback recorded for session ${session}`);
