#!/usr/bin/env node
/* Nepse Decode — index history updater.
 *
 * Appends the latest validated close from nepse-chart/data/live.json to
 * js/nepse-daily.js (full OHLC) and nepse-chart/data/index-spark.json
 * (closes only), so the landing chart and sparkline never go stale.
 *
 * Idempotent: exits quietly if the session is already the last row.
 * Never invents sessions — only appends the validated live.json close.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
const DAILY_JS = path.join(ROOT, 'js', 'nepse-daily.js');
const SPARK = path.join(ROOT, 'nepse-chart', 'data', 'index-spark.json');
const ARCH = path.join(ROOT, 'data', 'index-history.json'); // /nepse-technical/ long OHLC archive

function log(...a) { console.log('[update-index-history]', ...a); }

function main() {
  const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  const ix = live && live.index;
  if (!ix || !live.asof) { log('no validated close in live.json; nothing to do'); return; }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(live.asof);
  if (!m) { log('unparseable asof ' + live.asof); return; }
  const ymd = +(m[1] + m[2] + m[3]);
  const iso = m[1] + '-' + m[2] + '-' + m[3];
  // The official NEPSE index API does not publish the session open. The
  // sparkline (closes only) can always be updated; the full OHLC row needs
  // high/low/value, with open falling back to previous_close (the index's
  // published reference price — flagged in the row comment, never invented).
  const hasOHLC = ['high', 'low', 'value'].every((k) => Number.isFinite(+ix[k]));
  const openPx = Number.isFinite(+ix.open) ? +ix.open
    : (Number.isFinite(+ix.previous_close) ? +ix.previous_close : null);
  if (!hasOHLC || openPx == null) log('index OHLC incomplete; daily.js row skipped (sparkline still updates)');
  // Session turnover = sum of quote turnovers (same canonical payload).
  let turnover = 0;
  if (Array.isArray(live.quotes)) {
    for (const q of live.quotes) { const t = +q.turnover; if (Number.isFinite(t)) turnover += t; }
  }
  turnover = Math.round(turnover);

  // 1) js/nepse-daily.js — rows are [YYYYMMDD, open, high, low, close, volume]
  // Only appended when the full OHLC is available (never invented).
  if (hasOHLC) {
    let js = fs.readFileSync(DAILY_JS, 'utf8');
    const lastRow = js.match(/\[(\d{8}),[^\]]*\]\];?\s*$/);
    const lastYmd = lastRow ? +lastRow[1] : 0;
    if (ymd > lastYmd) {
      const row = '[' + ymd + ',' + openPx + ',' + ix.high + ',' + ix.low + ',' + ix.value + ',' + turnover + ']';
      // Insert the new row between the last row's closing "]" and the outer
      // array's closing "]". The regex consumes the final "]];": the head then
      // ends with the last row still open, so the replacement re-closes it ("]"),
      // appends ",newrow", then closes the outer array ("];"). The row string
      // already carries its own closing "]", so only one more is added here.
      // (2026-09-30: two earlier variants each produced a stray "]" -> "]]];".)
      if (!/\]\];\s*$/.test(js)) throw new Error('could not find array terminator in nepse-daily.js');
      js = js.replace(/\]\];\s*$/, '],' + row + '];');
      // fix the header comment date range: "2003-07-17 to 2026-09-18."
      js = js.replace(/to \d{4}-\d{2}-\d{2}\./, 'to ' + iso + '.');
      fs.writeFileSync(DAILY_JS, js);
      log('appended ' + iso + ' to nepse-daily.js (NEPSE ' + ix.value + ')');
    } else {
      log('nepse-daily.js already at/after ' + iso + '; skipping');
    }
  } else {
    log('nepse-daily.js OHLC skipped (open unavailable from official API)');
  }

  // 2) index-spark.json — closes: [[YYYYMMDD, close], ...]
  const spark = JSON.parse(fs.readFileSync(SPARK, 'utf8'));
  const closes = spark.closes || [];
  const lastC = closes.length ? closes[closes.length - 1][0] : 0;
  if (ymd > lastC) {
    closes.push([ymd, ix.value]);
    spark.closes = closes;
    spark.to = iso;
    fs.writeFileSync(SPARK, JSON.stringify(spark));
    log('appended ' + iso + ' to index-spark.json');
  } else {
    log('index-spark.json already at/after ' + iso + '; skipping');
  }

  // 3) data/index-history.json — the /nepse-technical/ chart's long OHLC
  // archive (rows [YYYYMMDD, open, high, low, close, volume]). Appended only
  // with full validated OHLC (same gate as nepse-daily.js — never invented);
  // volume stays 0 per this archive's convention; `to` tracks the last row.
  // Idempotent: exits quietly if the session is already the last row.
  if (hasOHLC) {
    const arch = JSON.parse(fs.readFileSync(ARCH, 'utf8'));
    const arows = arch.rows || [];
    const lastA = arows.length ? arows[arows.length - 1][0] : 0;
    if (ymd > lastA) {
      const r2 = (x) => Math.round(x * 100) / 100;
      arows.push([ymd, r2(openPx), r2(+ix.high), r2(+ix.low), r2(+ix.value), 0]);
      arch.rows = arows;
      arch.to = iso;
      fs.writeFileSync(ARCH, JSON.stringify(arch));
      log('appended ' + iso + ' to data/index-history.json');
    } else {
      log('data/index-history.json already at/after ' + iso + '; skipping');
    }
  } else {
    log('data/index-history.json OHLC skipped (incomplete)');
  }
}

main();
