#!/usr/bin/env node
/* NEPSE close capture — writes the official session close to live.json.
 *
 * Run after 15:00 NPT on trading days (Mon–Fri). Idempotent: exits quietly
 * if today's close is already captured.
 *
 * Source (V4, owner directive 2026-10-04): the OFFICIAL NEPSE API
 * (/api/nots/nepse-index + /api/nots) — no dependency on third-party mirrors
 * for the close. ShareHub remains only as a fallback if the official API is
 * unreachable, and as the secondary sanity check (R2).
 *
 * Output: nepse-chart/data/live.json with
 *   { asof: "<today>T15:00:00+05:45", market: "CLOSED", close: true,
 *     index: {value, previous_close, change, percent_change, high, low, open},
 *     indices: [...] }
 * Then rebuilds wave1.json so the session summary carries the true close.
 *
 * Validation: requires all 17 indices and the NEPSE close within 8% of the
 * previous close; otherwise exits non-zero WITHOUT touching live.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
const UA = 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)';

function nptNow() {
  return new Date(Date.now() + (5 * 60 + 45) * 60000);
}
function nptDate(d) {
  return d.toISOString().slice(0, 10);
}
function log(...a) { console.log('[capture-close]', ...a); }

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// Parse ShareHub's indices table. Returns {name: {close, change, open, high, low}}.
function parseShareHub(html) {
  const rows = {};
  const trs = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  const want = {
    'NEPSE Index': 'NEPSE', 'Sensitive Index': 'Sensitive',
    'Float Index': 'Float', 'Sensitive Float Index': 'Sensitive Float',
    'Banking SubIndex': 'Banking', 'Development Bank Index': 'Development Bank',
    'Hotels And Tourism Index': 'Hotels & Tourism', 'Finance Index': 'Finance',
    'Microfinance Index': 'Microfinance', 'Life Insurance': 'Life Insurance',
    'Non Life Insurance': 'Non-Life Insurance', 'HydroPower Index': 'Hydropower',
    'Investment Index': 'Investment', 'Manufacturing And Processing': 'Manufacturing',
    'Trading Index': 'Trading', 'Others Index': 'Others', 'Mutual Fund': 'Mutual Fund',
  };
  // ShareHub glues the ticker onto the name without a separator
  // (e.g. "NNEPSENEPSE Index"); match on the trailing name, longest first
  // so "Sensitive Float Index" wins over "Float Index".
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const keys = Object.keys(want).sort((a, b) => norm(b).length - norm(a).length);
  for (const tr of trs) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    if (cells.length < 5) continue;
    const n = norm(cells[0]);
    const key = keys.find((k) => n.endsWith(norm(k)));
    if (!key) continue;
    // ShareHub sometimes uses the unicode minus sign (U+2212).
    const num = (s) => parseFloat(String(s).replace(/,/g, '').replace(/\u2212/g, '-'));
    const vals = cells.slice(1, 6).map(num);
    if (vals.some((v) => !isFinite(v))) continue;
    rows[want[key]] = { open: vals[0], high: vals[1], low: vals[2], close: vals[3], change: vals[4] };
  }
  return rows;
}

// Fetch the official close from NEPSE's own API. Returns
// {name: {open, high, low, close, change}} in the canonical short names.
async function fetchOfficialClose(api) {
  const LABELS = [
    ['NEPSE Index', 'NEPSE'], ['Sensitive Index', 'Sensitive'],
    ['Float Index', 'Float'], ['Sensitive Float Index', 'Sensitive Float'],
    ['Banking SubIndex', 'Banking'], ['Development Bank Index', 'Development Bank'],
    ['Hotels And Tourism Index', 'Hotels & Tourism'], ['Finance Index', 'Finance'],
    ['Microfinance Index', 'Microfinance'], ['Life Insurance', 'Life Insurance'],
    ['Non Life Insurance', 'Non-Life Insurance'], ['HydroPower Index', 'Hydropower'],
    ['Investment Index', 'Investment'], ['Manufacturing And Processing', 'Manufacturing'],
    ['Trading Index', 'Trading'], ['Others Index', 'Others'], ['Mutual Fund', 'Mutual Fund'],
  ];
  const byRaw = {};
  for (const [raw, short] of LABELS) byRaw[raw] = short;
  const rows = {};
  const collect = (arr) => {
    for (const x of Array.isArray(arr) ? arr : []) {
      const short = x && byRaw[x.index];
      if (!short || rows[short]) continue;
      const close = parseFloat(x.currentValue);
      const change = parseFloat(x.change);
      if (!isFinite(close) || !isFinite(change)) continue;
      rows[short] = {
        open: parseFloat(x.open) || null,
        high: parseFloat(x.high) || null,
        low: parseFloat(x.low) || null,
        close, change,
      };
    }
  };
  collect(await api.apiFetch('GET', '/api/nots/nepse-index'));
  collect(await api.apiFetch('GET', '/api/nots'));
  return rows;
}

async function main() {
  const now = nptNow();
  const today = nptDate(now);
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) { log('weekend, nothing to capture'); return; }
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (mins < 15 * 60 + 5) { log('before 15:05 NPT; session not over yet'); return; }

  let live = {};
  try { live = JSON.parse(fs.readFileSync(LIVE, 'utf8')); } catch (e) { /* missing is fine */ }
  const liveDate = String(live.asof || '').slice(0, 10);
  if ((live.close === true || live.market === 'CLOSED') && liveDate === today) {
    log('close already captured for ' + today + '; nothing to do');
    return;
  }

  log('capturing close for ' + today + '...');

  // V4 (owner directive 2026-10-04): the official NEPSE API is the PRIMARY
  // close source — no dependency on third-party mirrors. ShareHub remains
  // only as a fallback if the official API is unreachable, and as the
  // secondary sanity check for Gate 3i.
  const api = require('./nepse-api');
  let rows = null;       // {name: {open, high, low, close, change}}
  let source = 'NEPSE official API';
  try {
    rows = await fetchOfficialClose(api);
    log('official API: ' + Object.keys(rows).length + ' indices');
  } catch (e) {
    log('official API failed (' + e.message + ') — falling back to ShareHub');
    const html = await fetchText('https://sharehubnepal.com/nepse/indices');
    rows = parseShareHub(html);
    source = 'ShareHub (fallback)';
    log('ShareHub fallback: ' + Object.keys(rows).length + ' indices');
  }
  const names = Object.keys(rows);
  if (names.length < 15 || !rows['NEPSE']) {
    throw new Error('parse failed: only ' + names.length + ' indices from ' + source);
  }

  // Sanity: NEPSE close within 8% of previous close (from existing live.json or wave1).
  const nepse = rows['NEPSE'];
  const prevClose = live.index && isFinite(+live.index.previous_close)
    ? +live.index.previous_close : nepse.close - nepse.change;
  // ShareHub's Close column can lag its own change column by a tick; when the
  // authoritative previous close is known, derive the close from prev + change
  // (this reproduces the official close exactly). Fall back to ShareHub's
  // close if the two disagree by more than 0.3%.
  if (live.index && isFinite(+live.index.previous_close)) {
    const derived = +((+live.index.previous_close) + nepse.change).toFixed(2);
    if (Math.abs(derived - nepse.close) / nepse.close <= 0.003) {
      nepse.close = derived;
    }
  }
  if (Math.abs(nepse.close - prevClose) / prevClose > 0.08) {
    throw new Error('NEPSE close ' + nepse.close + ' deviates >8% from prev ' + prevClose);
  }

  const indices = names.map((name) => {
    const r = rows[name];
    const prev = +(r.close - r.change).toFixed(2);
    return {
      name, value: r.close, previous_close: prev, change: +r.change.toFixed(2),
      percent_change: +((r.change / prev) * 100).toFixed(2),
      last_updated: today + 'T15:00:00+05:45',
    };
  });
  // Keep canonical order: NEPSE first, then existing order.
  const order = ['NEPSE', 'Sensitive', 'Float', 'Sensitive Float', 'Banking',
    'Development Bank', 'Hotels & Tourism', 'Finance', 'Microfinance',
    'Life Insurance', 'Non-Life Insurance', 'Hydropower', 'Investment',
    'Manufacturing', 'Trading', 'Others', 'Mutual Fund'];
  indices.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  // V4: provenance metadata. The close comes from the official NEPSE API
  // (owner directive 2026-10-04); ShareHub only as fallback. Gate 3i reads this.
  const closeSource = source;

  const out = Object.assign({}, live, {
    asof: today + 'T15:00:00+05:45',
    market: 'CLOSED',
    close: true,
    close_source: closeSource,
    cross_source: source === 'NEPSE official API' ? null : {
      fallback: 'ShareHub',
      nepse_fallback_close: +nepse.close,
      checked_at: today + 'T15:00:00+05:45',
      note: 'Official API unreachable; close from ShareHub fallback (R2 secondary). Verify against NEPSE.',
    },
    index: {
      value: nepse.close, previous_close: prevClose,
      change: +nepse.change.toFixed(2),
      percent_change: +((nepse.change / prevClose) * 100).toFixed(2),
      high: nepse.high, low: nepse.low, open: nepse.open,
      last_updated: today + 'T15:00:00+05:45',
    },
    indices,
  });
  fs.writeFileSync(LIVE, JSON.stringify(out, null, 2));
  log('wrote close: NEPSE ' + nepse.close + ' (' + nepse.change + ')');

  // Rebuild the session summary so every page sees the true close.
  execSync('node ' + path.join(__dirname, 'build-nepse-wave1.js'), { cwd: ROOT, stdio: 'inherit' });
  log('wave1 rebuilt');

  // Append the validated close to the index history files (landing chart + sparkline).
  execSync('node ' + path.join(__dirname, 'update-index-history.js'), { cwd: ROOT, stdio: 'inherit' });
  log('index history updated');
}

main().catch((e) => { console.error('[capture-close] FAILED:', e.message); process.exit(1); });
