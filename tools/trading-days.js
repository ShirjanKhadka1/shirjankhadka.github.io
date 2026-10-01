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
const HOLIDAYS = new Set();
for (const year of Object.keys(CAL.holidays || {})) {
  for (const h of CAL.holidays[year]) {
    if (h.date) HOLIDAYS.add(h.date);
  }
}
const TRADING_DOW = new Set(CAL.weekly_trading_days); // 1=Mon..5=Fri

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
  if (isTradingDay(today) && t >= CAL.market_hours_npt.close) return today;
  return lastTradingDay(addDays(today, -1));
}
/** LIVE / CLOSED market state for badge logic */
function marketState(now = new Date()) {
  const today = todayNPT(now);
  const t = timeNPT(now);
  if (!isTradingDay(today)) return 'CLOSED';
  if (t >= CAL.market_hours_npt.open && t < CAL.market_hours_npt.close) return 'LIVE';
  return 'CLOSED';
}

module.exports = {
  todayNPT, timeNPT, isTradingDay, isHoliday, isWeekend,
  lastTradingDay, nextTradingDay, expectedSessionDate, marketState,
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
