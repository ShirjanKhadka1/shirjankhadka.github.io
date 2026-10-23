#!/usr/bin/env node
/* Nepse Decode: ADJUSTED OHLC side collection (collection only, no consumer).
 *
 * IMPORTANT — adjusted differential UNVERIFIED: in the Oct 12–16 2026 test
 * window the adjusted series returned by the feed was IDENTICAL to the raw
 * series for every symbol checked. Whether the feed actually applies
 * corporate-action adjustments is UNVERIFIED pending an ex-date test.
 * This store is collected for that future test only — NO consumer (builder,
 * engine, page) reads this series.
 *
 * Mirrors tools/update-ohlc-archive.js exactly (same symbol source, same
 * recent window, same merge rule: fills missing dates only, never
 * overwrites), but reads the adjusted-history feed and writes to the
 * SEPARATE adjusted store at ~/workspace/nepse-data-archive/ohlc-adjusted/
 * with monthly files ohlc-adj-YYYY-MM.json in the same structure as the raw
 * monthly archive files ({ asof, archive, data: { SYM: [rows] }, pulled }).
 *
 * Run: node tools/collect-adjusted-ohlc.js
 * Scheduled: appended to the OHLC archive updater runner (after the raw
 * updater), daily after market close.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ARCH_DIR = '/home/hatch/workspace/nepse-data-archive/ohlc-adjusted';
const ROOT = path.join(__dirname, '..');

// Feed endpoint (internal use only — never exposed in builder or public files)
const FEED_URL = (sym, fromTs, toTs) =>
  `https://chukul.com/api/data/adjhistorydata/?symbol=${encodeURIComponent(sym)}&from=${fromTs}&to=${toTs}`;
const FEED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://chukul.com/nepse-charts',
};

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
          .then((v) => { out[k] = v; }, () => { out[k] = null; })
          .finally(() => { active--; next(); });
      }
    }
    next();
  });
}

async function main() {
  console.log('== Adjusted OHLC side collection ==');
  console.log('  NOTE: adjusted differential UNVERIFIED (identical to raw in the Oct 12-16 test window) pending an ex-date test — collection only, no consumer uses this series.');
  if (!fs.existsSync(ARCH_DIR)) fs.mkdirSync(ARCH_DIR, { recursive: true });

  // Load symbol list from universe — same source as the raw updater.
  let symbols = [];
  try {
    const u = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepse-chart', 'data', 'universe.json'), 'utf8'));
    symbols = (u.symbols || []).map(s => (typeof s === 'string' ? s : s.s)).filter(Boolean);
  } catch (e) {
    console.log('  !! cannot load universe symbols:', e.message);
    process.exit(1);
  }
  console.log('  symbols:', symbols.length);

  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - 14 * 86400; // same recent window as the raw updater

  console.log('> fetching recent adjusted OHLC…');
  const results = await pool(symbols, 6, async (sym) => {
    const url = FEED_URL(sym, fromTs, nowTs);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: FEED_HEADERS, signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? { sym, rows: data } : null;
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  });

  const fetchedOk = results.filter(Boolean).length;
  if (fetchedOk === 0) {
    console.error('FATAL: adjusted feed returned nothing for every symbol');
    process.exit(1);
  }

  // Merge into the adjusted store: group by month into ohlc-adj-YYYY-MM.json
  // files, same structure as the raw monthly archive files.
  const byMonth = {}; // 'YYYY-MM' -> { sym -> rows }
  let totalRows = 0;
  results.forEach((r) => {
    if (!r || !r.rows || !r.rows.length) return;
    r.rows.forEach((row) => {
      if (!row.date || !row.close) return;
      const ym = row.date.slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = {};
      if (!byMonth[ym][r.sym]) byMonth[ym][r.sym] = [];
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

  console.log('> merging into adjusted store…');
  let merged = 0;
  Object.keys(byMonth).forEach((ym) => {
    const fp = path.join(ARCH_DIR, `ohlc-adj-${ym}.json`);
    let arch = { asof: ym + '-01', archive: 'Nepse Decode proprietary ADJUSTED OHLC archive (side collection; adjusted differential UNVERIFIED pending ex-date test)', data: {} };
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
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
