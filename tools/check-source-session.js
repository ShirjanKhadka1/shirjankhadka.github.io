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
 *   source_session=YYYY-MM-DD|unknown — latest session per a direct probe of
 *     the official NEPSE API (only probed when new_session=false)
 *   source_reachable=true|false|unknown — did the probe reach NEPSE?
 *   source_has_session=true|false — source published >= expected session.
 *     true while new_session=false means BUILD/DATA FAILURE, not a holiday.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const td = require('./trading-days');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');

function sessionOf(obj) {
  // Prefer the explicit session_date stamp (last trading session); fall back
  // to asof/updated for files written before session_date existed.
  const a = (obj && (obj.session_date || obj.asof || obj.updated)) || '';
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

async function main() {
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
  // 2026-10-09 hardening: on 2026-10-08 the pipeline recorded a quiet
  // "market closed" notice for a REAL trading day. Root cause: the
  // auto-rollback had reverted the built files to the previous session, so
  // the file-based check above saw "no new session" even though NEPSE had
  // published one. Before callers conclude "market closed", probe the
  // official NEPSE API directly: if the SOURCE has the expected session but
  // our build does not, that is a build/data failure, not a holiday.
  let sourceSession = 'unknown';
  let sourceReachable = 'unknown';
  if (!newSession) {
    try {
      const api = require('./nepse-api');
      const rows = await api.apiFetch('GET', '/api/nots/nepse-index');
      sourceReachable = 'true';
      let latest = '';
      for (const r of Array.isArray(rows) ? rows : []) {
        const g = String((r && (r.generatedTime || r.generated_time)) || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(g) && g > latest) latest = g;
      }
      if (latest) sourceSession = latest;
      console.log(`source probe: reachable, latest source session=${sourceSession}`);
    } catch (e) {
      // Best-effort only: network/DNS failure here must NOT change the
      // outcome — callers keep the previous quiet-notice behavior.
      sourceReachable = 'false';
      console.log('source probe failed (' + (e && e.message) + ') — keeping file-based verdict');
    }
  }
  const sourceHasSession = sourceSession !== 'unknown' && sourceSession >= expected;
  out('source_session=' + sourceSession);
  out('source_reachable=' + sourceReachable);
  out('source_has_session=' + sourceHasSession);
  if (!newSession) {
    if (sourceHasSession) {
      console.log('ALERT: the source published session ' + sourceSession +
        ' but the build captured nothing newer than ' + dataSession +
        ' — this is a BUILD/DATA failure, not a market closure.');
    } else {
      console.log('NOTE: no new session at the source — likely a market closure ' +
        '(e.g. an unlisted holiday missing from tools/nepse-holidays.json). ' +
        'This is NOT a data failure; callers should treat the day as market closed.');
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = {};
