#!/usr/bin/env node
/**
 * tools/check-source-session.js — did the source publish a new session?
 *
 * Compares the newest session present in the freshly-built live.json /
 * universe.json against the expected session (calendar). Used by the
 * market-close pipeline to distinguish a real data failure from a day when
 * the market simply did not trade (e.g. an unlisted public holiday that is
 * missing from tools/nepse-holidays.json).
 *
 * Usage: node tools/check-source-session.js [--session YYYY-MM-DD]
 * Always exits 0 (informational — callers gate on the GITHUB_OUTPUT values):
 *   new_session=true|false   — is the newest data session >= expected?
 *   data_session=YYYY-MM-DD  — newest session actually present in the data
 *   expected=YYYY-MM-DD      — expected session per the trading calendar
 */
'use strict';
const fs = require('fs');
const path = require('path');
const td = require('./trading-days');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');

function sessionOf(obj) {
  const a = (obj && (obj.asof || obj.updated)) || '';
  return String(a).slice(0, 10);
}
function readData(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8')); }
  catch (e) { return null; }
}
function out(kv) {
  const s = process.env.GITHUB_OUTPUT;
  if (s) fs.appendFileSync(s, kv + '\n');
  console.log(kv);
}

function main() {
  const argSession = (process.argv.find(a => a.startsWith('--session=')) || '').split('=')[1];
  const expected = argSession || td.expectedSessionDate(new Date());
  const live = readData('live.json');
  const universe = readData('universe.json');
  const sessions = [sessionOf(live), sessionOf(universe)].filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const dataSession = sessions.sort().pop() || 'none';
  const newSession = dataSession !== 'none' && dataSession >= expected;
  console.log(`expected=${expected} data_session=${dataSession} new_session=${newSession}`);
  out('expected=' + expected);
  out('data_session=' + dataSession);
  out('new_session=' + newSession);
  if (!newSession) {
    console.log('NOTE: no new session at the source — likely a market closure ' +
      '(e.g. an unlisted holiday missing from tools/nepse-holidays.json). ' +
      'This is NOT a data failure; callers should treat the day as market closed.');
  }
}

if (require.main === module) main();
module.exports = {};
