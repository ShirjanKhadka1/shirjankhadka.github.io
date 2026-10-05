#!/usr/bin/env node
/* NEPSE intraday 15m quote archive.
 *
 * Extends the intraday accumulation pattern of build-intraday-index.js:
 * while that script archives the NEPSE index value, this one archives
 * per-stock quote snapshots (symbol, ltp, high, low, volume) so the
 * Technical Charts page can build 15-minute OHLCV bars client-side.
 *
 * HARD GUARDRAIL (owner decision, 2026-10-05): this script NEVER polls
 * NEPSE. It only reads the locally committed nepse-chart/data/live.json
 * snapshot, which the live-quotes workflow publishes every 15 minutes.
 * Snapshots are deduped by live.asof, so the archive cadence can never
 * exceed 15 minutes — NEPSE rate-limits aggressively and a faster poll
 * risks an IP ban that would kill the site's existing live feed.
 *
 * Storage: nepse-chart/data/intraday/quotes-YYYY-MM-DD.json, one file per
 * session day, pruned to the last 5 sessions, plus a tiny manifest listing
 * the kept days. Per snapshot only [ltp, high, low, volume] are stored
 * (compact arrays keyed by symbol); the chart builds the 15m bars.
 *
 * Run inside the nepse-intraday-floorsheet workflow right after
 * build-intraday-index.js (same schedule — the asof dedupe below is what
 * enforces the <=15-minute cadence, not the workflow timer).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LIVE = path.join(REPO, 'nepse-chart', 'data', 'live.json');
const DIR = path.join(REPO, 'nepse-chart', 'data', 'intraday');
const MANIFEST = path.join(DIR, 'manifest.json');
const KEEP_DAYS = 5;
const MAX_OBS_PER_DAY = 40; // 15-min cadence over a session ~= 17; headroom for safety

function nptDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // YYYY-MM-DD
}

function nptHM(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d); // HH:MM
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function main() {
  let live;
  try {
    live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  } catch (e) {
    console.log('intraday-quotes: live.json unreadable, nothing to append');
    return;
  }
  const asof = live && live.asof;
  const quotes = live && live.quotes;
  if (!asof || !Array.isArray(quotes) || !quotes.length) {
    console.log('intraday-quotes: no usable snapshot in live.json');
    return;
  }
  const day = nptDate(asof);
  const hm = nptHM(asof);
  // Session window 10:45-15:00 NPT (pre-open through close); ignore the rest.
  if (!day || !hm || hm < '10:45' || hm > '15:00') {
    console.log('intraday-quotes: snapshot outside 10:45-15:00 NPT, skipped');
    return;
  }
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  // Prune to the last KEEP_DAYS session files and refresh the manifest.
  // Runs on every invocation — even when there is no new snapshot — so a
  // quiet day still ages old files out.
  prune();

  const file = path.join(DIR, 'quotes-' + day + '.json');
  let data = { day: day, obs: [] };
  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prev && prev.day === day && Array.isArray(prev.obs)) data = prev;
  } catch (e) { /* first run of the day */ }

  const last = data.obs[data.obs.length - 1];
  if (last && last.t === asof) {
    console.log('intraday-quotes: already have ' + asof);
    return;
  }

  const q = {};
  let kept = 0;
  for (const r of quotes) {
    if (!r || !r.symbol) continue;
    const ltp = num(r.ltp);
    if (ltp == null) continue;
    const high = num(r.high), low = num(r.low), vol = num(r.volume);
    q[String(r.symbol).toUpperCase()] = [ltp, high, low, vol];
    kept++;
  }
  if (!kept) {
    console.log('intraday-quotes: no usable quotes in snapshot, skipped');
    return;
  }
  data.obs.push({ t: asof, q: q });
  if (data.obs.length > MAX_OBS_PER_DAY) data.obs = data.obs.slice(-MAX_OBS_PER_DAY);
  fs.writeFileSync(file, JSON.stringify(data) + '\n');
  console.log('intraday-quotes: appended ' + asof + ' (' + kept + ' symbols, ' + data.obs.length + ' obs)');
  prune();
}

function prune() {
  // Prune to the last KEEP_DAYS session files; refresh the manifest.
  const days = fs.readdirSync(DIR)
    .filter(function (f) { return /^quotes-\d{4}-\d{2}-\d{2}\.json$/.test(f); })
    .map(function (f) { return f.slice(7, 17); })
    .sort();
  const drop = days.slice(0, Math.max(0, days.length - KEEP_DAYS));
  for (const d of drop) {
    try { fs.unlinkSync(path.join(DIR, 'quotes-' + d + '.json')); } catch (e) {}
    console.log('intraday-quotes: pruned quotes-' + d + '.json');
  }
  const keptDays = days.slice(-KEEP_DAYS);
  fs.writeFileSync(MANIFEST, JSON.stringify({ days: keptDays }) + '\n');
}

main();
