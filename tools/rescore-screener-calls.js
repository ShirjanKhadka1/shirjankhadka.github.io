/* ROUND 2 / R3: re-score the screener-calls ledger through the FIXED
 * tools/screener-tracking.js walk (date-type fix + corporate-action
 * adjustment) against the archive history series.
 *
 * Usage (from the repo root):
 *   node tools/rescore-screener-calls.js           # dry run, prints report
 *   node tools/rescore-screener-calls.js --write   # writes the ledger
 *
 * Scope guardrails (R3 correctness only):
 * - Walks ONLY calls already in the file; creates no new calls.
 * - Series truncated to the ledger's own asof: the re-score never
 *   advances data_through beyond what it covers, and never scores a
 *   session past asof (no lookahead).
 * - Ledger asof, note and schema are left untouched; already-closed
 *   calls are left untouched (none exist at R3 time, but the rule
 *   stands: a close is final).
 * - Summary is recomputed with the builder's exact rules (decided =
 *   tp + sl only; expired closes are not wins/losses).
 * - Output is written in the builder's compact single-line JSON form,
 *   so the next universe refresh rewrites it identically.
 * - The screener-verdict-archive.json is NOT touched here: verdict
 *   snapshots were never affected by the walk bug, and the refresh
 *   regenerates the archive under the fixed builder.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { walkCall, adjustForCorporateActions, ymdNum } =
  require('./screener-tracking.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'nepse-chart', 'data');
const WRITE = process.argv.includes('--write');

function persistenceBucket(streak) {
  if (streak <= 1) return 'flash';
  if (streak === 2) return 'mid';
  return 'persistent';
}

const callsPath = path.join(OUT, 'screener-calls.json');
const callsDoc = JSON.parse(fs.readFileSync(callsPath, 'utf8'));
const asofNum = ymdNum(callsDoc.asof);
const prevSession = callsDoc.summary ? callsDoc.summary.prev_session : null;

const report = { asof: callsDoc.asof, walked: 0, closed: [], caApplied: [],
  unknown: [], missing: [], untouchedClosed: 0 };
let nCreatedKept = 0;
for (const call of callsDoc.calls) {
  if (call.status !== 'open') { report.untouchedClosed++; continue; }
  const file = path.join(OUT, 'history', call.sym.replace(/\//g, '-') + '.json');
  let hj;
  try { hj = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { report.missing.push(call.sym + ' ' + call.date); continue; }
  const srs = (hj.data || []).filter((r) => r[0] <= asofNum);
  const adjd = adjustForCorporateActions(call, srs);
  const upd = walkCall(adjd.call, adjd.series);
  if (upd.unknown_series) { report.unknown.push(call.sym + ' ' + call.date); continue; }
  report.walked++;
  if (adjd.adjustments.length) {
    report.caApplied.push({ sym: call.sym, date: call.date,
      adjustments: adjd.adjustments,
      adjEntry: Math.round(adjd.call.entry * 100) / 100,
      adjSl: Math.round(adjd.call.sl * 100) / 100,
      adjTp: Math.round(adjd.call.tp * 100) / 100 });
  }
  if (upd.status === 'closed') {
    call.status = 'closed'; call.exit = upd.exit;
    call.exit_date = upd.exit_date; call.sessions_held = upd.sessions_held;
    call.exit_return = upd.exit_return; call.last_return = upd.last_return;
    call.updated_asof = callsDoc.asof;
    report.closed.push({ sym: call.sym, date: call.date, exit: upd.exit,
      exit_date: upd.exit_date, sessions_held: upd.sessions_held,
      exit_return: upd.exit_return });
  } else {
    call.sessions_elapsed = upd.sessions_elapsed;
    call.last_return = upd.last_return;
    call.updated_asof = callsDoc.asof;
  }
}

// Summary, builder rules verbatim (tools/screener-tracking.js).
const bySetup = {};
const byPers = { flash: { decided: 0, wins: 0, n: 0 },
  mid: { decided: 0, wins: 0, n: 0 },
  persistent: { decided: 0, wins: 0, n: 0 } };
let open = 0, tp = 0, sl = 0, expired = 0;
for (const c of callsDoc.calls) {
  const bucket = byPers[persistenceBucket(c.streak || 1)];
  bucket.n++;
  if (c.status === 'open') { open++; continue; }
  if (c.exit === 'tp') { tp++; bucket.decided++; bucket.wins++; }
  else if (c.exit === 'sl') { sl++; bucket.decided++; }
  else if (c.exit === 'expired') { expired++; }
  if (c.exit === 'tp' || c.exit === 'sl') {
    const key = c.setup || '(no setup)';
    bySetup[key] = bySetup[key] || { decided: 0, wins: 0 };
    bySetup[key].decided++;
    if (c.exit === 'tp') bySetup[key].wins++;
  }
}
const decided = tp + sl;
const prevSummary = callsDoc.summary || {};
callsDoc.summary = { asof: callsDoc.asof, prev_session: prevSession, open,
  closed_tp: tp, closed_sl: sl, closed_expired: expired,
  decided, win_rate: decided ? Math.round((tp / decided) * 1000) / 1000 : null,
  created_today: prevSummary.created_today || 0,
  closed_today: report.closed.length,
  by_setup: Object.keys(bySetup).sort().map((k) => ({
    setup: k, decided: bySetup[k].decided, wins: bySetup[k].wins,
    win_rate: bySetup[k].decided
      ? Math.round((bySetup[k].wins / bySetup[k].decided) * 1000) / 1000 : null })),
  by_persistence: byPers };

console.log('R3 rescore @ asof ' + callsDoc.asof + ': ' + callsDoc.calls.length +
  ' calls, walked ' + report.walked + ', closed ' + report.closed.length +
  ' (tp ' + tp + ' / sl ' + sl + ' / expired ' + expired + '), open ' + open +
  ', decided ' + decided + ', win_rate ' + callsDoc.summary.win_rate +
  ', unknown ' + report.unknown.length + ', missing ' + report.missing.length);
for (const c of report.closed) {
  console.log('  CLOSED ' + c.sym + ' ' + c.date + ' -> ' + c.exit + ' ' +
    c.exit_date + ' held ' + c.sessions_held + ' ret ' + c.exit_return);
}
for (const c of report.caApplied) {
  console.log('  CA ' + c.sym + ' ' + c.date + ' adjustments ' +
    JSON.stringify(c.adjustments) + ' adj entry/sl/tp ' +
    c.adjEntry + '/' + c.adjSl + '/' + c.adjTp);
}
if (report.unknown.length) console.log('  UNKNOWN: ' + report.unknown.join(', '));
if (report.missing.length) console.log('  MISSING: ' + report.missing.join(', '));
if (WRITE) {
  if (report.unknown.length || report.missing.length) {
    console.error('R3 rescore REFUSES to write: unwalkable calls present.');
    process.exit(1);
  }
  fs.writeFileSync(callsPath, JSON.stringify(callsDoc));
  console.log('  WROTE ' + callsPath);
} else {
  console.log('  DRY RUN (pass --write to write)');
}
