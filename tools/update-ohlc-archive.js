#!/usr/bin/env node
/* Nepse Decode: OHLC archive updater.
 *
 * Maintains our proprietary OHLC archive at ~/workspace/nepse-data-archive/.
 * Fetches recent daily OHLC for all listed symbols and merges into the archive
 * (fills missing dates only, never overwrites).
 *
 * This is the ONLY component that contacts external data feeds. The universe
 * builder (build-nepse-universe.js) reads ONLY from this archive — never from
 * source platforms directly. This separation keeps the builder footprint-free.
 *
 * Run: node tools/update-ohlc-archive.js [--universe <path>]
 * Scheduled: daily after market close (see cron).
 *
 * --universe: symbol-list source. Default: the worktree universe.json.
 *   The script-first runner passes the LIVE data-branch universe here
 *   (2026-10-31 REVIEW fix): the worktree copy goes stale (it was 410
 *   symbols / asof 2026-10-01 while live had 426), and a stale list
 *   silently skips symbols — PMLIP, BENH, PCBLP + 3 debentures were never
 *   even attempted in October. Both universe formats are accepted.
 * Fetch failures are LOUD (exit 1 after merging successes) so the runner
 * retries once and then fails visibly — never a silent partial run.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// CLI: --universe <path> (2026-10-31 REVIEW fix). Default: worktree universe.json.
let universePath = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--universe' && process.argv[i + 1]) universePath = process.argv[++i];
}

const ARCH_DIR = '/home/hatch/workspace/nepse-data-archive';
const ROOT = path.join(__dirname, '..');

// Feed endpoint (internal use only — never exposed in builder or public files)
const FEED_URL = (sym, fromTs, toTs) =>
  `https://chukul.com/api/data/historydata/?symbol=${encodeURIComponent(sym)}&from=${fromTs}&to=${toTs}`;
const FEED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://chukul.com/nepse-charts',
};

function ymdNum(dstr) { return +String(dstr).replace(/-/g, ''); }

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0, active = 0;
  return new Promise((resolve) => {
    function next() {
      if (i >= items.length && active === 0) return resolve(out);
      while (active < n && i < items.length) {
        const k = i++; active++;
        Promise.resolve()
          .then(() => fn(items[k], k))
          .then((v) => { out[k] = v; }, (e) => { out[k] = { __error: (e && e.message) || String(e) }; })
          .finally(() => { active--; next(); });
      }
    }
    next();
  });
}

async function main() {
  console.log('== OHLC archive update ==');
  if (!fs.existsSync(ARCH_DIR)) fs.mkdirSync(ARCH_DIR, { recursive: true });

  // Load symbol list from universe. Two formats (2026-10-31 REVIEW fix):
  //   (a) worktree { asof, count, symbols: [{s, n, t, o}] } (or string list)
  //   (b) data-branch dict { SYM: {s, n, t, o} } (no metadata keys)
  // An unreadable or empty list is FATAL (exit 1), never a silent 0-row run.
  if (!universePath) universePath = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
  let symbols = [];
  let universeFormat = '';
  try {
    const u = JSON.parse(fs.readFileSync(universePath, 'utf8'));
    if (Array.isArray(u.symbols)) {
      symbols = u.symbols.map(s => (typeof s === 'string' ? s : s.s)).filter(Boolean);
      universeFormat = 'list';
    } else if (u && typeof u === 'object') {
      symbols = Object.keys(u).filter(k => u[k] && typeof u[k] === 'object' && ('s' in u[k] || 'n' in u[k]));
      universeFormat = 'dict';
    }
  } catch (e) {
    console.error('FATAL: cannot load universe symbols from ' + universePath + ': ' + e.message);
    process.exit(1);
  }
  if (!symbols.length) {
    console.error('FATAL: universe symbol list is empty (' + universePath + ') — refusing a silent 0-row run');
    process.exit(1);
  }
  console.log('  universe: ' + universePath + ' (' + universeFormat + ')');
  console.log('  symbols:', symbols.length);

  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - 14 * 86400; // last 14 days (covers weekends/holidays)

  console.log('> fetching recent OHLC…');
  const results = await pool(symbols, 6, async (sym) => {
    const url = FEED_URL(sym, fromTs, nowTs);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: FEED_HEADERS, signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(sym + ': HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(sym + ': unexpected feed schema (not an array)');
      return { sym, rows: data };
    } catch (e) {
      clearTimeout(timer);
      throw new Error(sym + ': ' + e.message);
    }
  });
  // Per-symbol failures are LOUD (2026-10-31 REVIEW fix): the old code
  // mapped every failure to null, so a transient feed error for a symbol
  // vanished without a trace. A symbol with no rows in 14 days is NOT a
  // failure (it simply did not trade) — only transport/HTTP/schema errors
  // land here. Successful rows are still merged below; then exit 1 so the
  // runner retries once and fails visibly on persistent errors.
  const failures = results.filter(r => r && r.__error).map(r => r.__error);

  // Merge into archive: group by date-range into monthly files
  // Format: ohlc-YYYY-MM.json with { asof, archive, data: { SYM: [rows] } }
  const byMonth = {}; // 'YYYY-MM' -> { sym -> rows }
  let totalRows = 0;
  results.forEach((r) => {
    if (!r || !r.rows || !r.rows.length) return;
    r.rows.forEach((row) => {
      if (!row.date || !row.close) return;
      const ym = row.date.slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = {};
      if (!byMonth[ym][r.sym]) byMonth[ym][r.sym] = [];
      // Avoid duplicates within this fetch
      if (!byMonth[ym][r.sym].some(x => x.date === row.date)) {
        byMonth[ym][r.sym].push({
          date: row.date,
          symbol: r.sym,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          ltp: row.ltp || row.close,
          volume: row.volume || 0,
          amount: row.amount || 0,
        });
        totalRows++;
      }
    });
  });

  console.log('> merging into archive…');
  let merged = 0;
  Object.keys(byMonth).forEach((ym) => {
    const fp = path.join(ARCH_DIR, `ohlc-${ym}.json`);
    let arch = { asof: ym + '-01', archive: 'Nepse Decode proprietary OHLC archive', data: {} };
    try {
      if (fs.existsSync(fp)) arch = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) { /* start fresh */ }
    if (!arch.data) arch.data = {};

    Object.keys(byMonth[ym]).forEach((sym) => {
      if (!arch.data[sym]) arch.data[sym] = [];
      const existing = new Set(arch.data[sym].map(x => x.date));
      byMonth[ym][sym].forEach((row) => {
        if (!existing.has(row.date)) {
          arch.data[sym].push(row);
          merged++;
        }
      });
      // Keep sorted by date
      arch.data[sym].sort((a, b) => a.date < b.date ? -1 : 1);
    });

    // Update asof to latest date in archive
    let latest = arch.asof;
    Object.values(arch.data).forEach(rows => {
      rows.forEach(r => { if (r.date > latest) latest = r.date; });
    });
    arch.asof = latest;
    arch.pulled = new Date().toISOString().slice(0, 10);

    fs.writeFileSync(fp, JSON.stringify(arch));
  });

  console.log(`  done: ${totalRows} rows fetched, ${merged} new merged`);
  console.log(`  archive: ${ARCH_DIR}/`);
  if (failures.length) {
    console.error(`  FAILED SYMBOLS (${failures.length}) — these symbols were NOT fetched (transient failures must be retried; persistent ones need a human):`);
    failures.forEach(f => console.error('    - ' + f));
    console.error('  (successful rows above were still merged; exiting 1 so the runner retries / fails loud)');
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
