#!/usr/bin/env node
/* Nepse Decode — own per-stock daily OHLC archive.
 *
 * Builds OUR OWN price history from OUR OWN live-quote captures, ending the
 * dependence on external scraper archives for recent sessions.
 *
 * Reads the final nepse-chart/data/live.json snapshot for a session and
 * appends one OHLCV row per symbol to nepse-chart/data/daily-ohlc/{SYMBOL}.json:
 *   { symbol, updated, rows: [[YYYYMMDD, open, high, low, close, volume], ...] }
 *
 * Field sourcing (never invented):
 *   close  = quote.ltp (last traded price at capture)
 *   high   = quote.high (NEPSE session high)
 *   low    = quote.low (NEPSE session low)
 *   volume = quote.volume (session share volume)
 *   open   = first intraday snapshot ltp for the symbol that session
 *            (nepse-chart/data/intraday/quotes-YYYY-MM-DD.json), else
 *            quote.previous_close with open_src="prev_close".
 * Each row carries open_src so consumers know the open's provenance:
 *   "intraday" | "prev_close".
 *
 * Idempotent: skips symbols whose last row already matches the session date.
 * Run in the market-close workflow after the final live snapshot lands.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
const INTRADAY_DIR = path.join(ROOT, 'nepse-chart', 'data', 'intraday');
const OUT_DIR = path.join(ROOT, 'nepse-chart', 'data', 'daily-ohlc');

function log(...a) { console.log('[build-daily-ohlc]', ...a); }

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Session date from live.json (authoritative trading-day stamp).
function sessionDate(live) {
  if (live.session_date && /^\d{4}-\d{2}-\d{2}$/.test(live.session_date)) return live.session_date;
  return null;
}

// First intraday ltp per symbol for the session (session open proxy).
function intradayOpens(isoDay) {
  const p = path.join(INTRADAY_DIR, 'quotes-' + isoDay + '.json');
  let d;
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return {}; }
  const opens = {};
  if (!d || !Array.isArray(d.obs)) return opens;
  for (const ob of d.obs) {
    const q = ob && ob.q;
    if (!q || typeof q !== 'object') continue;
    for (const sym of Object.keys(q)) {
      if (opens[sym] !== undefined) continue; // first snapshot wins
      const arr = q[sym];
      const ltp = Array.isArray(arr) ? num(arr[0]) : num(arr && arr.ltp);
      if (ltp != null) opens[sym] = ltp;
    }
  }
  return opens;
}

function main() {
  let live;
  try { live = JSON.parse(fs.readFileSync(LIVE, 'utf8')); }
  catch (e) { log('live.json unreadable, nothing to do'); return; }

  const day = sessionDate(live);
  if (!day) { log('no session_date in live.json, nothing to do'); return; }
  const ymd = +day.replace(/-/g, '');
  const quotes = Array.isArray(live.quotes) ? live.quotes : [];
  if (!quotes.length) { log('no quotes in live.json, nothing to do'); return; }

  const opens = intradayOpens(day);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let appended = 0, skipped = 0;
  for (const qt of quotes) {
    const sym = qt && qt.symbol;
    if (!sym) continue;
    const close = num(qt.ltp);
    const high = num(qt.high);
    const low = num(qt.low);
    const volume = num(qt.volume);
    if (close == null || high == null || low == null) { skipped++; continue; }

    let open, openSrc;
    if (opens[sym] != null) { open = opens[sym]; openSrc = 'intraday'; }
    else {
      const pc = num(qt.previous_close);
      if (pc == null) { skipped++; continue; }
      open = pc; openSrc = 'prev_close';
    }

    const file = path.join(OUT_DIR, sym.replace('/', '-') + '.json');
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { doc = { symbol: sym, updated: null, rows: [] }; }
    if (!Array.isArray(doc.rows)) doc.rows = [];
    const last = doc.rows[doc.rows.length - 1];
    if (last && last[0] === ymd) { skipped++; continue; } // idempotent

    doc.rows.push([ymd, open, high, low, close, volume == null ? 0 : Math.round(volume), openSrc]);
    doc.rows.sort((a, b) => a[0] - b[0]);
    doc.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(doc));
    appended++;
  }
  log('session ' + day + ': appended ' + appended + ' symbols, skipped ' + skipped);
}

main();
