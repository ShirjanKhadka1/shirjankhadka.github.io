#!/usr/bin/env node
/* Nepse Decode — record a verified dividend announcement into div-live.json.
 *
 * Called by the dividend watcher the moment a dividend/bonus announcement is
 * verified against the official NEPSE notice and published. The next stock
 * page build merges this file as a third dividend source (see
 * build-symbol-pages.js), so the Investment Calendar updates automatically.
 *
 * Usage:
 *   node tools/record-live-dividend.js '{"symbol":"NABIL","bonus_share":"5.00",
 *     "cash_dividend":"10.8","total_dividend":"15.8","year":"2082/2083",
 *     "announcement_date":"2026-09-07","bookclose_date":"",
 *     "officialPdf":"https://..."}'
 *
 * Records dedupe by (fiscal year, bonus %, cash %); a repeat call for the
 * same dividend fills in newly known fields (e.g. bookclose_date) instead
 * of duplicating the row.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'nepse-chart', 'data');
const FILE = path.join(DATA, 'div-live.json');

function main() {
  let r;
  try { r = JSON.parse(process.argv[2] || ''); }
  catch { console.error('record-live-dividend: expected a JSON argument'); process.exit(1); }
  const sym = String(r.symbol || '').toUpperCase().trim();
  const year = String(r.year || r.fiscal_year || '').trim();
  if (!sym || !year) {
    console.error('record-live-dividend: symbol and year are required');
    process.exit(1);
  }
  const num = (v) => { const x = Number(v); return Number.isFinite(x) ? String(x) : ''; };
  const rec = {
    bonus_share: num(r.bonus_share),
    cash_dividend: num(r.cash_dividend),
    total_dividend: num(r.total_dividend),
    announcement_date: String(r.announcement_date || '').slice(0, 10),
    bookclose_date: String(r.bookclose_date || '').slice(0, 10),
    year,
    officialPdf: String(r.officialPdf || ''),
  };
  const key = [year, Number(rec.bonus_share) || 0, Number(rec.cash_dividend) || 0].join('|');
  let db = { asof: '', companies: {} };
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
  if (!db.companies) db.companies = {};
  const arr = db.companies[sym] || (db.companies[sym] = []);
  const ix = arr.findIndex((x) =>
    [String(x.year || ''), Number(x.bonus_share) || 0, Number(x.cash_dividend) || 0].join('|') === key);
  let updated = false;
  if (ix >= 0) {
    for (const k of Object.keys(rec)) {
      if ((!arr[ix][k] || String(arr[ix][k]).trim() === '') && rec[k]) { arr[ix][k] = rec[k]; updated = true; }
    }
  } else {
    arr.push(rec);
  }
  db.asof = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
  console.log(JSON.stringify({ ok: true, symbol: sym, count: arr.length, updated }));
}

main();
