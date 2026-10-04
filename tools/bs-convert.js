#!/usr/bin/env node
/* Nepse Decode — verified BS<->AD conversion (Node).
 *
 * Uses tools/bs-month-table.json (BS 2000-2090 month lengths), the same
 * reference as js/bs-calendar.js. Verified anchors:
 *   2000-01-01 BS = 1943-04-14 AD
 *   2083-06-08 BS = 2026-09-24 AD
 * Wrong conversion is a critical bug — run `node tools/bs-convert.js --self-test`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TABLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'bs-month-table.json'), 'utf8'));
const START = TABLE.start_year;
const MONTHS = TABLE.months;
const DAY_MS = 86400000;
const REF_AD = Date.UTC(1943, 3, 14); // 2000-01-01 BS

function bsYearLen(y) {
  const a = MONTHS[y - START];
  if (!a) throw new Error('BS year out of table range: ' + y);
  return a.reduce((s, n) => s + n, 0);
}
function bsToDayNum(y, m, d) {
  let n = 0;
  for (let yy = START; yy < y; yy++) n += bsYearLen(yy);
  const a = MONTHS[y - START];
  for (let mm = 0; mm < m - 1; mm++) n += a[mm];
  return n + (d - 1);
}
function dayNumToBs(n) {
  let y = START;
  while (n >= bsYearLen(y)) { n -= bsYearLen(y); y++; }
  const a = MONTHS[y - START];
  let m = 1;
  while (n >= a[m - 1]) { n -= a[m - 1]; m++; }
  return { y, m, d: n + 1 };
}
function adToDayNum(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - REF_AD) / DAY_MS); }
function dayNumToAd(n) {
  const t = new Date(REF_AD + n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function pad(n) { return String(n).padStart(2, '0'); }

function adToBs(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error('bad AD date: ' + ymd);
  const b = dayNumToBs(adToDayNum(+m[1], +m[2], +m[3]));
  return `${b.y}-${pad(b.m)}-${pad(b.d)}`;
}
function bsToAd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error('bad BS date: ' + ymd);
  const a = dayNumToAd(bsToDayNum(+m[1], +m[2], +m[3]));
  return `${a.y}-${pad(a.m)}-${pad(a.d)}`;
}

function selfTest() {
  const cases = [
    ['1943-04-14', '2000-01-01'],
    ['2026-09-24', '2083-06-08'],
    ['2026-10-04', '2083-06-18'], // today: 06-08 + 10 days from the verified anchor
    ['2026-10-19', '2083-07-02'],
    ['2026-01-01', '2082-09-17'],
  ];
  let ok = 0;
  for (const [ad, bs] of cases) {
    const got = adToBs(ad);
    const back = bsToAd(bs);
    const pass = got === bs && back === ad;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${ad} <-> ${bs} (got ${got} / ${back})`);
    if (pass) ok++;
  }
  // round-trip sweep: every day of BS 2083
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const len = MONTHS[2083 - START][m - 1];
    for (let d = 1; d <= len; d++) {
      const bs = `2083-${pad(m)}-${pad(d)}`;
      if (adToBs(bsToAd(bs)) !== bs) { console.log('FAIL round-trip ' + bs); process.exit(1); }
      n++;
    }
  }
  console.log(`round-trip sweep: ${n} days OK`);
  if (ok !== cases.length) process.exit(1);
  console.log('SELF-TEST PASS');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const [ad] = process.argv.slice(2);
    if (!ad) { console.error('usage: node tools/bs-convert.js YYYY-MM-DD [--self-test]'); process.exit(2); }
    console.log(adToBs(ad));
  }
}
module.exports = { adToBs, bsToAd };
