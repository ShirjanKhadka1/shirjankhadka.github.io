#!/usr/bin/env node
/**
 * tools/build-manifest.js
 * Writes data/manifest.json — the single freshness/source/count/checksum
 * contract every page and the validation gate read from.
 *
 * Canonical path: data/manifest.json (repo-relative file keys, full SHA-256,
 * build commit, embedded job status).
 *
 * Legacy copy: nepse-chart/data/manifest.json — generated at build time as a
 * copy for cached clients running the old freshness-badge.js. Marked
 * deprecated inside the file ("_deprecated": true + "_deprecated_note") and
 * removed after one release. Do not add new readers of the legacy path.
 *
 * Run at the END of every data build (market-close job, content job).
 * Never hand-edit either manifest; both are generated.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');
const td = require('./trading-days');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const CANONICAL = path.join(ROOT, 'data', 'manifest.json');
const LEGACY = path.join(DATA, 'manifest.json');

/** Known provenance per data file. 'computed' = derived locally from other files. */
const SOURCES = {
  'live.json': ['NEPSE official site (nepalstock.com)'],
  'universe.json': ['NEPSE official site (nepalstock.com)'],
  'index-spark.json': ['NEPSE official site (nepalstock.com)'],
  'news.json': ['Arthasansar RSS', 'BizMandu RSS', 'OnlineKhabar RSS'],
  'announcements.json': ['NEPSE notices', 'company announcements'],
  'corporate-actions.json': ['NEPSE official notices', 'company PDFs (verified)'],
  'corp-history.json': ['ShareSansar company pages', 'NEPSE official notices'],
  'div-live.json': ['NEPSE official dividend notices'],
  'div-history-yonepse.json': ['yonepse.com dividend archive'],
  'trending.json': ['computed: NEPSE turnover/volume'],
  'trending-research.json': ['computed: fundamentals + turnover'],
  'value.json': ['computed: NEPSE price/volume'],
  'verdicts.json': ['computed: Alpha Lab engine'],
  'signals/momentum.json': ['computed: build-signals.js (corporate-action adjusted)'],
  'signals/trend-relay.json': ['computed: build-signals.js (corporate-action adjusted)'],
  'signals/reversal.json': ['computed: build-signals.js (corporate-action adjusted)'],
  'track-record.json': ['computed: signal backtest ledger'],
  'fundamentals.json': ['company quarterly/annual filings'],
  'quarterly.json': ['company quarterly filings'],
  'company-websites.json': ['company website monitor'],
  'version.json': ['computed: build metadata'],
};

function sha256full(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Best-effort row count for a parsed JSON payload */
function rowCount(rel, obj) {
  if (Array.isArray(obj)) return obj.length;
  if (obj && typeof obj === 'object') {
    for (const k of ['count', 'total', 'sessions', 'rows']) {
      if (typeof obj[k] === 'number') return obj[k];
    }
    for (const k of ['symbols', 'items', 'quotes', 'verdicts', 'trades', 'alerts']) {
      if (Array.isArray(obj[k])) return obj[k].length;
      if (obj[k] && typeof obj[k] === 'object') return Object.keys(obj[k]).length;
    }
    if (obj.index && obj.quotes) return Object.keys(obj.quotes).length;
  }
  return null;
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, rel));
    else if (e.name.endsWith('.json') && e.name !== 'manifest.json') out.push({ rel, full });
  }
  return out;
}

function buildCommit() {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT;
  try {
    return child_process.execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return null;
  }
}

function main() {
  const now = new Date();
  const today = td.todayNPT(now);
  // SESSION_OVERRIDE pins the session date (used by rollback: the manifest
  // describes the restored session, not "today").
  const session = process.env.SESSION_OVERRIDE || td.expectedSessionDate(now);
  const files = {};
  for (const { rel, full } of walk(DATA)) {
    const repoRel = 'nepse-chart/data/' + rel; // canonical keys are repo-relative
    let rows = null, asof = null;
    try {
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
      rows = rowCount(rel, obj);
      asof = (obj && typeof obj === 'object' && (obj.asof || obj.updated)) || null;
    } catch (e) {
      rows = 'unparseable';
    }
    files[repoRel] = {
      rows,
      asof,
      sha256: sha256full(full),
      bytes: fs.statSync(full).size,
      sources: SOURCES[rel] || ['computed'],
    };
  }

  // Embed latest job status so the manifest is the single source of truth.
  let jobs = {};
  try {
    jobs = JSON.parse(fs.readFileSync(path.join(DATA, 'jobs.json'), 'utf8'));
  } catch (e) { /* first run: no jobs yet */ }

  const manifest = {
    generated_at_npt: today + 'T' + td.timeNPT(now) + ':00+05:45',
    session_date: session,
    today_npt: today,
    market_state: td.marketState(now),
    is_holiday_closure: !td.isTradingDay(today),
    data_root: 'nepse-chart/data',
    build_commit: buildCommit(),
    sources: [...new Set(Object.values(files).flatMap(f => f.sources))],
    files,
    jobs,
    note: 'Generated by tools/build-manifest.js. Do not hand-edit.',
  };

  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(CANONICAL, JSON.stringify(manifest, null, 2) + '\n');

  // Legacy copy for one release: same content, marked deprecated INSIDE
  // the file so any reader can tell it is not canonical.
  const legacy = Object.assign({}, manifest, {
    _deprecated: true,
    _deprecated_note: 'DEPRECATED — use /data/manifest.json (canonical). This copy is generated at build time for cached clients and is removed after one release; do not add new readers.',
  });
  fs.writeFileSync(LEGACY, JSON.stringify(legacy, null, 2) + '\n');

  console.log(`manifest written: data/manifest.json (+ legacy nepse-chart/data/manifest.json), session=${session} files=${Object.keys(files).length}`);
}

if (require.main === module) main();
module.exports = { main };
