#!/usr/bin/env node
/* NEPSE Alpha Lab — official-API live quote fetcher.
 *
 * Runs on a schedule (GitHub Actions, every ~15 min during NEPSE trading
 * hours) and writes a compact same-origin snapshot the static site can poll:
 *   nepse-chart/data/live.json
 *     {"asof": "<ISO timestamp>", "market": "OPEN",
 *      "index": {"value","previous_close","change","percent_change",
 *                "high","low","last_updated"} | null,
 *      "indices": [{"name","value","previous_close","change",
 *                   "percent_change","last_updated"}, ...],
 *      "quotes": [{"symbol","name","ltp","previous_close","change",
 *                  "percent_change","high","low","volume","turnover",
 *                  "trades","last_updated","market_cap"}, ...]}
 * (quote objects match shubhamnpk/yonepse data/market/live.json element shape;
 *  last_updated stamps are NEPSE wall-clock (NPT) without an offset — the
 *  front end treats offset-less stamps as NPT)
 *
 * Auth: NEPSE's official API (https://www.nepalstock.com) requires a token
 * dance. GET /api/authenticate/prove returns {accessToken, salt1..salt5, ...};
 * the per-request token is derived by cutting characters out of the access
 * token at five indices computed from salt2 by NEPSE's own derivation module
 * (exports cdx, rdx, bdx, ndx, mdx). The vendored copy of that module is WAT
 * text, not an instantiable binary, so the derivation is ported to pure JS
 * (decoded from the module, cross-checked against yonepse's
 * official_api/auth.py TokenParser). Sent as `Authorization: Salter <derived>`.
 * The per-request payload id for today-price uses their dummy-data array:
 *   base = DUMMY[marketOpenId] + marketOpenId + 2 * dayOfMonth(NPT)
 *   id   = base + salt{idx+1} * dayOfMonth - salt{idx}, idx = base%10<5 ? 1 : 3
 *
 * FAIL-SAFE CONTRACT: on ANY failure (network, token/WASM change, 401 after
 * one re-auth, rate limit, unexpected shape, market closed) the script exits 0
 * WITHOUT touching live.json — the site keeps serving the last good snapshot
 * and falls back to the yonepse feed. JSON is written to a temp file and
 * renamed so a partial/corrupt file can never be published.
 *
 * Node 18+, no npm dependencies (global fetch + built-in WebAssembly only).
 * Do NOT run this in a tight loop; NEPSE rate-limits aggressively.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const td = require('./trading-days');

const api = require('./nepse-api');
const { ROOT, UA, REQ_TIMEOUT_MS, DUMMY } = api;
const { fetchWithTimeout, baseHeaders, getJSON } = api;
const { authenticate, apiFetch, payloadId } = api;

function log(msg) { console.log('[fetch-nepse-live] ' + msg); }
// Fail-safe: report to stderr, exit 0, never touch live.json.
function abort(msg) {
  console.error('[fetch-nepse-live] ABORT (keeping existing live.json): ' + msg);
  process.exit(0);
}

// YYYY-MM-DD of a timestamp in NPT (UTC+5:45). live.json asof is UTC ISO;
// the trading day is NPT, so compare dates in NPT.
function nptDate(isoOrMs) {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return new Date(ms + (5 * 60 + 45) * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * The trading session this snapshot belongs to — the LAST TRADING SESSION,
 * never a weekend/holiday calendar date. Mirrors the validator's
 * live-session-current expectation exactly:
 *   - trading day at/after market open  -> today (session in progress/closed)
 *   - trading day before open            -> last completed session
 *   - weekend / holiday                  -> last completed session (Friday)
 * asof stays the honest fetch time; session_date is the market session.
 */
function snapshotSessionDate(now) {
  const today = td.todayNPT(now);
  // V3 CAL schema keeps pre-open under trading_hours.pre_open_npt
  // ("10:45-11:00"); the pre-open session is part of today's session.
  const preOpenStart = ((td.CAL.trading_hours && td.CAL.trading_hours.pre_open_npt) || '10:45-11:00').split('-')[0];
  if (td.isTradingDay(today) && td.timeNPT(now) >= preOpenStart) return today;
  return td.expectedSessionDate(now);
}

function readLive() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (e) { return null; }
}

/**
 * INTRADAY PRESERVE (2026-10-09 guard): the intraday-ohlc-poll cron owns the
 * `intraday` key in live.json (the site's intraday feed). This snapshot
 * rewrites live.json wholesale; without an explicit carry-forward, every
 * Alpha Lab run wipes `intraday` until the next poll repairs it (observed
 * 2026-10-09: commit 965829440 wiped it, 4c0fa5a62 repaired it, and the
 * wipe/repair ping-pong repeated every 15 minutes all session).
 *
 * Returns the intraday dict to carry forward, or undefined when there is
 * nothing worth keeping: no intraday key, a non-object value, or a stale
 * intraday from a prior session (a new session must never show yesterday's
 * intraday numbers — the poll rewrites it within ~15 min anyway).
 */
function preserveIntraday(prevLive, sessionDate) {
  if (!prevLive || prevLive.intraday == null) return undefined;
  if (typeof prevLive.intraday !== 'object') {
    log('dropping non-object intraday value (' + typeof prevLive.intraday + ')');
    return undefined;
  }
  const prevSession = prevLive.session_date ||
    (prevLive.asof ? nptDate(prevLive.asof) : null);
  if (prevSession === sessionDate) return prevLive.intraday;
  log('dropping stale intraday (session ' + prevSession + ' != ' + sessionDate + ')');
  return undefined;
}
const OUT = path.join(__dirname, '..', 'nepse-chart', 'data', 'live.json');
const PAGE_SIZE = 500;
const MAX_PAGES = 10;
const REQUEST_DELAY_MS = 2000;  // Politeness delay between paginated requests

// Index display order + short labels for the blog ticker. Raw names are the
// API's own index names; labels are cosmetic shortenings only — no values
// are ever invented here. /api/nots/nepse-index returns the 4 headline
// indices; /api/nots returns the 13 sub-indices (fields: index, change,
// perChange, currentValue; no previousClose or generatedTime).
const INDEX_LABELS = [
  ['NEPSE Index', 'NEPSE'],
  ['Sensitive Index', 'Sensitive'],
  ['Float Index', 'Float'],
  ['Sensitive Float Index', 'Sensitive Float'],
  ['Banking SubIndex', 'Banking'],
  ['Development Bank Index', 'Development Bank'],
  ['Hotels And Tourism Index', 'Hotels & Tourism'],
  ['Finance Index', 'Finance'],
  ['Microfinance Index', 'Microfinance'],
  ['Life Insurance', 'Life Insurance'],
  ['Non Life Insurance', 'Non-Life Insurance'],
  ['HydroPower Index', 'Hydropower'],
  ['Investment Index', 'Investment'],
  ['Manufacturing And Processing', 'Manufacturing'],
  ['Trading Index', 'Trading'],
  ['Others Index', 'Others'],
  ['Mutual Fund', 'Mutual Fund']
];

function num(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Map one raw today-price row to the yonepse live.json element shape.
function mapRow(item) {
  const ltp = num(item.lastUpdatedPrice, 0);
  const prev = num(item.previousDayClosePrice, 0);
  const change = (ltp && prev) ? Math.round((ltp - prev) * 100) / 100 : 0;
  const pct = prev !== 0 ? Math.round((change / prev) * 10000) / 100 : 0;
  return {
    symbol: item.symbol,
    name: item.securityName != null ? String(item.securityName) : item.symbol,
    ltp: ltp,
    previous_close: prev,
    change: change,
    percent_change: pct,
    high: num(item.highPrice, null),
    low: num(item.lowPrice, null),
    volume: num(item.totalTradedQuantity, null),
    turnover: num(item.totalTradedValue, null),
    trades: num(item.totalTrades, null),
    last_updated: item.lastUpdatedTime != null ? String(item.lastUpdatedTime) : null,
    market_cap: item.marketCapitalization != null ? num(item.marketCapitalization, null) : null
  };
}

async function main() {
  try {
    // 1. Market status.
    const mo = await apiFetch('GET', '/api/nots/nepse-data/market-open');
    const marketOpen = !!(mo && mo.isOpen === 'OPEN');
    // Closing run: after the bell, capture the final session snapshot once
    // per trading day. Without this the last intraday poll is the newest
    // data forever and the actual close never lands on the site.
    let closingRun = false;
    if (!marketOpen) {
      const now = new Date();
      const thisSession = snapshotSessionDate(now);
      const prev = readLive();
      // Prefer the explicit session stamp; fall back to the asof date for
      // snapshots written before session_date existed.
      const prevSession = prev && (prev.session_date || (prev.asof ? nptDate(prev.asof) : null));
      if (prev && prevSession === thisSession && prev.market === 'CLOSED') {
        log('closing snapshot for session ' + thisSession + ' already captured; leaving live.json untouched');
        process.exit(0);
      }
      if (!mo || mo.id == null) {
        log('market is ' + (mo && mo.isOpen) + ' with no session id; leaving live.json untouched');
        process.exit(0);
      }
      closingRun = true;
      log('market ' + (mo.isOpen || 'UNKNOWN') + ' — capturing closing snapshot for session ' + thisSession + ' (id=' + mo.id + ')');
    } else {
      log('market OPEN (asOf=' + mo.asOf + ', id=' + mo.id + ')');
    }

    // 2. Per-symbol live prices, paginated.
    const pid = payloadId(mo.id, api.getAuth().salts);
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await apiFetch(
        'POST',
        '/api/nots/nepse-data/today-price?page=' + page + '&size=' + PAGE_SIZE,
        { id: pid }
      );
      const content = r && r.content;
      if (!Array.isArray(content) || content.length === 0) break;
      rows.push.apply(rows, content);
      if (content.length < PAGE_SIZE) break;
      // Politeness delay between paginated requests
      if (page < MAX_PAGES - 1) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      }
    }
    if (!rows.length) throw new Error('today-price returned no rows (market ' + (closingRun ? 'CLOSED' : 'OPEN') + ')');

    const quotes = rows
      .filter((it) => it && typeof it.symbol === 'string' && it.symbol)
      .map(mapRow)
      .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    if (!quotes.length) throw new Error('no valid quote rows after mapping');

    // 2b. Live NEPSE index — best-effort: a failure here must never abort
    // the quote snapshot (the site draws the index candle only if present).
    let index = null;
    try {
      const idxList = await apiFetch('GET', '/api/nots/nepse-index');
      const ix = (Array.isArray(idxList) ? idxList : [])
        .find((x) => x && x.index === 'NEPSE Index');
      if (ix && Number.isFinite(+ix.currentValue)) {
        index = {
          value: +ix.currentValue,
          previous_close: num(ix.previousClose, null),
          change: num(ix.change, null),
          percent_change: num(ix.perChange, null),
          high: num(ix.high, null),
          low: num(ix.low, null),
          // generatedTime is NPT wall-clock without an offset; keep it that
          // way — the front end treats offset-less stamps as NPT.
          last_updated: ix.generatedTime != null ? String(ix.generatedTime) : null
        };
      } else {
        log('NEPSE Index entry missing from /api/nots/nepse-index');
      }
    } catch (e) {
      log('index fetch failed (non-fatal): ' + (e && e.message));
    }

    // 2c. Full index + sub-index list for the blog ticker — best-effort:
    // a failure here must never abort the quote snapshot.
    let indices = [];
    try {
      const mainList = await apiFetch('GET', '/api/nots/nepse-index');
      const subList = await apiFetch('GET', '/api/nots');
      const byName = {};
      const collect = (arr) => {
        (Array.isArray(arr) ? arr : []).forEach((x) => {
          if (x && typeof x.index === 'string' && !byName[x.index] &&
              Number.isFinite(+x.currentValue)) {
            byName[x.index] = x;
          }
        });
      };
      collect(mainList);
      collect(subList);
      const stamp = byName['NEPSE Index'] && byName['NEPSE Index'].generatedTime != null
        ? String(byName['NEPSE Index'].generatedTime) : null;
      indices = INDEX_LABELS.map((pair) => {
        const x = byName[pair[0]];
        if (!x) return null;
        const value = +x.currentValue;
        const change = num(x.change, 0);
        const prev = value - change;
        const pct = num(x.perChange, prev !== 0 ? Math.round((change / prev) * 10000) / 100 : null);
        return {
          name: pair[1],
          value: Math.round(value * 100) / 100,
          previous_close: Math.round(prev * 100) / 100,
          change: Math.round(change * 100) / 100,
          percent_change: pct,
          // generatedTime is NPT wall-clock without an offset; keep it that
          // way — the front end treats offset-less stamps as NPT.
          last_updated: x.generatedTime != null ? String(x.generatedTime) : stamp
        };
      }).filter((i) => i !== null);
      log('captured ' + indices.length + ' indices for ticker');
    } catch (e) {
      log('index list fetch failed (non-fatal): ' + (e && e.message));
    }

    const payload = {
      asof: new Date().toISOString(),
      // The trading session this snapshot belongs to: the last trading
      // session, never a weekend/holiday calendar date. Validators and the
      // site read this (not asof) for "which session is this data".
      session_date: snapshotSessionDate(new Date()),
      // V2 honesty: NEPSE's own timestamp for this data (not our fetch time).
      // mo.asOf is the exchange's authoritative "as of" for the market state.
      data_asof: (mo && mo.asOf) || null,
      source: 'NEPSE',
      source_tier: 1,
      market: closingRun ? 'CLOSED' : 'OPEN',
      index: index,
      indices: indices,
      quotes: quotes
    };

    // 2d. Carry the intraday-ohlc-poll's `intraday` key forward (see
    // preserveIntraday above): a wholesale rewrite must never drop the
    // site's intraday feed mid-session.
    const keptIntraday = preserveIntraday(readLive(), payload.session_date);
    if (keptIntraday !== undefined) {
      payload.intraday = keptIntraday;
      log('preserved intraday key for session ' + payload.session_date);
    }

    // 3. Atomic write: temp file + rename, never a partial live.json.
    const tmp = OUT + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, OUT);
    try { fs.unlinkSync(tmp); } catch (e) { /* renamed already */ }
    log('wrote ' + quotes.length + ' quotes to ' + OUT);
  } catch (e) {
    abort((e && e.stack) || String(e));
  }
}

if (require.main === module) main();

// Exported for the intraday-guard regression test (no network, main() is not
// run when required as a module).
module.exports = { preserveIntraday, nptDate, snapshotSessionDate };
