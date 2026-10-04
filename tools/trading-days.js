#!/usr/bin/env node
/**
 * tools/trading-days.js
 * Single source of truth for NEPSE trading-day logic.
 * Trading week: Monday-Friday (Sunday is a government holiday since the
 * Sun-Thu -> Mon-Fri schedule change, owner-confirmed 2026-10-01).
 * All dates handled as YYYY-MM-DD strings in Asia/Kathmandu.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'nepse-holidays.json'), 'utf8'));
// V3 schema: holidays is a flat array with date_ad; only VERIFIED entries
// affect trading-day computation (unverified entries are informational —
// treating an unverified holiday as closed would skip a real session;
// evidence wins, so the pipeline checks for a session anyway).
const HOLIDAYS = new Set();
for (const h of CAL.holidays || []) {
  if (h.status === 'verified' && h.date_ad) HOLIDAYS.add(h.date_ad);
}
// Weekend rule: Saturday/Sunday closed (verified) → trading days Mon-Fri.
const TRADING_DOW = new Set([1, 2, 3, 4, 5]);
// Trading hours from the V3 schema ("11:00-15:00").
const _hours = (CAL.trading_hours && CAL.trading_hours.continuous_npt || '11:00-15:00').split('-');
const MARKET_OPEN = _hours[0], MARKET_CLOSE = _hours[1];

function parseYMD(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toYMD(date) {
  return date.toISOString().slice(0, 10);
}
/** Kathmandu "today" as YYYY-MM-DD */
function todayNPT(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  return parts; // en-CA gives YYYY-MM-DD
}
/** Current time in Kathmandu as HH:MM (24h) */
function timeNPT(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now);
}
function isWeekend(ymd) {
  const dow = parseYMD(ymd).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 || dow === 6;
}
function isHoliday(ymd) {
  return HOLIDAYS.has(ymd);
}
function isTradingDay(ymd) {
  if (isWeekend(ymd)) return false;
  if (isHoliday(ymd)) return false;
  return true;
}
function addDays(ymd, n) {
  const d = parseYMD(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYMD(d);
}
/** Most recent trading day on or before ymd */
function lastTradingDay(ymd) {
  let d = ymd;
  for (let i = 0; i < 30; i++) {
    if (isTradingDay(d)) return d;
    d = addDays(d, -1);
  }
  throw new Error('No trading day found in last 30 days before ' + ymd);
}
/** Next trading day strictly after ymd */
function nextTradingDay(ymd) {
  let d = addDays(ymd, 1);
  for (let i = 0; i < 30; i++) {
    if (isTradingDay(d)) return d;
    d = addDays(d, 1);
  }
  throw new Error('No trading day found in next 30 days after ' + ymd);
}
/**
 * The session date the pipeline should consider "current".
 * If today is a trading day and market is closed for the day (>= 15:00 NPT),
 * the session is today. Otherwise it is the last completed trading day.
 */
function expectedSessionDate(now = new Date()) {
  const today = todayNPT(now);
  const t = timeNPT(now);
  if (isTradingDay(today) && t >= MARKET_CLOSE) return today;
  return lastTradingDay(addDays(today, -1));
}
/** LIVE / CLOSED market state for badge logic */
function marketState(now = new Date()) {
  const today = todayNPT(now);
  const t = timeNPT(now);
  if (!isTradingDay(today)) return 'CLOSED';
  if (t >= MARKET_OPEN && t < MARKET_CLOSE) return 'LIVE';
  return 'CLOSED';
}

module.exports = {
  todayNPT, timeNPT, isTradingDay, isHoliday, isWeekend,
  lastTradingDay, nextTradingDay, expectedSessionDate, marketState,
  MARKET_OPEN, MARKET_CLOSE,
  CAL
};

if (require.main === module) {
  const now = new Date();
  console.log(JSON.stringify({
    today_npt: todayNPT(now),
    time_npt: timeNPT(now),
    market_state: marketState(now),
    expected_session: expectedSessionDate(now),
  }, null, 2));
}
