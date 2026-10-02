#!/usr/bin/env node
/* Nepse Decode — intraday NEPSE index accumulator.
 *
 * Appends the current live.json index snapshot to
 * nepse-chart/data/intraday-index.json so the chart page can draw a real
 * 1D (10:45-15:00 NPT) line. Never invents data: only appends genuine
 * observations from live.json.
 *
 * Run every 15 minutes during market hours (see nepse-intraday-floorsheet.yml).
 * Keeps only today's NPT session; prunes older days on each run.
 *
 * Record: { "t": "<ISO asof from live.json>", "v": <index value> }
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
const OUT = path.join(ROOT, 'nepse-chart', 'data', 'intraday-index.json');

function nptDate(iso) {
  // YYYY-MM-DD in Asia/Kathmandu for the given instant.
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return parts; // YYYY-MM-DD
}

function nptHM(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d); // HH:MM
}

function main() {
  let live;
  try {
    live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  } catch (e) {
    console.log('intraday-index: live.json unreadable, nothing to append');
    return;
  }
  const asof = live && live.asof;
  const value = live && live.index && live.index.value;
  if (!asof || value == null || !isFinite(Number(value))) {
    console.log('intraday-index: no usable snapshot in live.json');
    return;
  }
  const day = nptDate(asof);
  const hm = nptHM(asof);
  // Session window 10:45-15:00 NPT; ignore anything outside.
  if (!day || !hm || hm < '10:45' || hm > '15:00') {
    console.log('intraday-index: snapshot outside 10:45-15:00 NPT, skipped');
    return;
  }
  let data = { day: day, obs: [] };
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (prev && prev.day === day && Array.isArray(prev.obs)) data = prev;
  } catch (e) { /* first run of the day */ }
  const last = data.obs[data.obs.length - 1];
  if (last && last.t === asof) {
    console.log('intraday-index: already have ' + asof);
    return;
  }
  data.obs.push({ t: asof, v: Number(value) });
  // Cap at a sane size (15-min cadence over 4h15m ~= 17 points; keep 40).
  if (data.obs.length > 40) data.obs = data.obs.slice(-40);
  fs.writeFileSync(OUT, JSON.stringify(data) + '\n');
  console.log('intraday-index: appended ' + asof + ' v=' + value + ' (' + data.obs.length + ' obs)');
}

main();
