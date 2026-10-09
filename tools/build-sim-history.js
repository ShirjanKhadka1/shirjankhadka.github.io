#!/usr/bin/env node
/* Nepse Decode — simulator history publisher.
 *
 * Builds OUR OWN per-symbol OHLC history for the Practice Trading simulator
 * (/nepse-simulator/) from the proprietary archive at
 * ~/workspace/nepse-data-archive/ohlc-db/{SYM}.json (maintained by the
 * ohlc-archive-updater cron, daily 16:00 NPT after market close).
 *
 * Replaces the old third-party history feed (samirwagle.github.io
 * Nepse-All-Scraper prices API), which stopped updating on 2026-02-12 —
 * the simulator was silently backtesting on 8-month-stale data.
 *
 * Output: nepse-chart/data/history/{SYM}.json
 *   { "symbol": "NABIL", "updated": "2026-10-08",
 *     "data": [[20261008, 532.9, 534, 530, 533, 47911, 25491765.5], ...] }
 *   row = [YYYYMMDD, open, high, low, close, volume(shares), turnover(Rs)]
 *
 * "updated" is the last bar's SESSION date, never a fetch timestamp.
 * Writes a file only when its last bar advanced (or the file is missing),
 * so daily deploys touch only symbols with new data.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARCH_DIR = '/home/hatch/workspace/nepse-data-archive/ohlc-db';
const OUT_DIR = path.join(ROOT, 'nepse-chart', 'data', 'history');

function log(...a) { console.log('[build-sim-history]', ...a); }

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ymdNum(dstr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dstr || ''));
  return m ? +(m[1] + m[2] + m[3]) : null;
}

function main() {
  if (!fs.existsSync(ARCH_DIR)) { log('archive dir missing: ' + ARCH_DIR); return; }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(ARCH_DIR).filter((f) => f.endsWith('.json')).sort();
  let written = 0, skipped = 0, bad = 0;

  for (const file of files) {
    const sym = file.slice(0, -5); // archive names already use '-' for '/'
    let arch;
    try { arch = JSON.parse(fs.readFileSync(path.join(ARCH_DIR, file), 'utf8')); }
    catch (e) { bad++; continue; }
    const bars = Array.isArray(arch.bars) ? arch.bars : [];
    const rows = [];
    for (const b of bars) {
      const d = ymdNum(b.date);
      const o = num(b.open), h = num(b.high), l = num(b.low);
      const c = num(b.close != null ? b.close : b.ltp);
      const v = num(b.volume), t = num(b.turnover);
      if (d == null || o == null || h == null || l == null || c == null) continue;
      rows.push([d, o, h, l, c, v == null ? 0 : Math.round(v), t == null ? 0 : Math.round(t * 100) / 100]);
    }
    rows.sort((a, b2) => a[0] - b2[0]);
    if (!rows.length) { bad++; continue; }
    const lastYmd = rows[rows.length - 1][0];
    const lastIso = String(lastYmd).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

    const outPath = path.join(OUT_DIR, sym + '.json');
    let cur = null;
    try { cur = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { /* missing */ }
    const curData = cur && Array.isArray(cur.data) ? cur.data : [];
    const curLast = curData.length ? curData[curData.length - 1][0] : null;
    if (curLast === lastYmd && cur && cur.symbol === sym) { skipped++; continue; }

    fs.writeFileSync(outPath, JSON.stringify({ symbol: sym, updated: lastIso, data: rows }));
    written++;
  }
  log('done: wrote ' + written + ', up-to-date ' + skipped + ', unreadable ' + bad + ' of ' + files.length + ' archive files');
}

main();
