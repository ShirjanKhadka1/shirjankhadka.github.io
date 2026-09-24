#!/usr/bin/env node
/* NEPSE Alpha Lab — official-API live quote fetcher.
 *
 * Runs on a schedule (GitHub Actions, every ~15 min during NEPSE trading
 * hours) and writes a compact same-origin snapshot the static site can poll:
 *   nepse-chart/data/live.json
 *     {"asof": "<ISO timestamp>", "market": "OPEN",
 *      "quotes": [{"symbol","name","ltp","previous_close","change",
 *                  "percent_change","high","low","volume","turnover",
 *                  "trades","last_updated","market_cap"}, ...]}
 * (quote objects match shubhamnpk/yonepse data/market/live.json element shape)
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

const ROOT = 'https://www.nepalstock.com';
const OUT = path.join(__dirname, '..', 'nepse-chart', 'data', 'live.json');
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0';
const REQ_TIMEOUT_MS = 25000;
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

// Dummy payload data — identical array used by NEPSE's web client and by
// yonepse's official_api/auth.py PayloadParser (100 entries).
const DUMMY = [
  147, 117, 239, 143, 157, 312, 161, 612, 512, 804, 411, 527, 170, 511, 421,
  667, 764, 621, 301, 106, 133, 793, 411, 511, 312, 423, 344, 346, 653, 758,
  342, 222, 236, 811, 711, 611, 122, 447, 128, 199, 183, 135, 489, 703, 800,
  745, 152, 863, 134, 211, 142, 564, 375, 793, 212, 153, 138, 153, 648, 611,
  151, 649, 318, 143, 117, 756, 119, 141, 717, 113, 112, 146, 162, 660, 693,
  261, 362, 354, 251, 641, 157, 178, 631, 192, 734, 445, 192, 883, 187, 122,
  591, 731, 852, 384, 565, 596, 451, 772, 624, 691
];

function log(msg) { console.log('[fetch-nepse-live] ' + msg); }
// Fail-safe: report to stderr, exit 0, never touch live.json.
function abort(msg) {
  console.error('[fetch-nepse-live] ABORT (keeping existing live.json): ' + msg);
  process.exit(0);
}

function fetchWithTimeout(url, opts) {
  opts = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout ' + url)), REQ_TIMEOUT_MS);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal }))
    .finally(() => clearTimeout(timer));
}

async function getJSON(url, headers) {
  const res = await fetchWithTimeout(url, { headers: headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('non-JSON response from ' + url); }
}

function baseHeaders() {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': ROOT + '/'
  };
}

// Cut characters out of the raw token at the given indices, in order:
// token[0:n] + token[n+1:l] + ... (mirrors yonepse auth.py TokenParser).
function cutToken(token, pts) {
  let out = '';
  let prev = 0;
  const sorted = pts.slice().sort((a, b) => a - b);
  for (const p of sorted) {
    const cut = Math.max(0, p | 0);
    out += token.slice(prev, cut);
    prev = cut + 1;
  }
  out += token.slice(prev);
  return out;
}

// Token cut points, pure-JS port of NEPSE's derivation module
// (shubhamnpk/yonepse scripts/nepse-scraper/official_api/nepse.wasm).
// That file is served as WAT *text*, not a binary, so it cannot be
// instantiated at runtime — the math below is decoded directly from it and
// cross-checked against their official_api/auth.py TokenParser (which calls
// the same five exports with salt2 as the effective input for the access
// token). Let s = salt2, d0/d1/d2 = its units/tens/hundreds digits:
//   n = T[d0+d1+d2] + 22        (cdx)
//   l = (d1+d2) + T[d0+d1+d2] + 32   (rdx)
//   o = (d1+d2) + T[d0+d1+d2] + 60   (bdx)
//   p = d1 + T[d0+d1+d2] + 88        (ndx)
//   q = d2 + T[d0+d1+d2] + 110       (mdx)
// The five points are naturally ordered (n<l<o<p<q), matching auth.py's
// unsorted cut: token[0:n]+token[n+1:l]+token[l+1:o]+token[o+1:p]+token[p+1:q]+token[q+1:].
const CUT_TABLE = [5, 8, 4, 7, 9, 4, 6, 9, 5, 5, 6, 5, 3, 5, 4, 4, 9, 6, 6, 8,
                   8, 6, 8, 6, 5, 8, 4, 9, 5, 9, 8, 5, 3, 4, 7, 7, 4, 7, 3, 9];

function cutPoints(salt2) {
  const s = salt2 | 0; // i32 semantics, matches WASM trunc division
  const d0 = s % 10, d1 = ((s / 10) | 0) % 10, d2 = ((s / 100) | 0) % 10;
  const t = CUT_TABLE[d0 + d1 + d2];
  if (t === undefined) throw new Error('cut index out of range for salt2=' + salt2);
  return [t + 22, d1 + d2 + t + 32, d1 + d2 + t + 60, d1 + t + 88, d2 + t + 110];
}

let AUTH = null; // { token, salts:[s1..s5] }

async function authenticate() {
  const prove = await getJSON(ROOT + '/api/authenticate/prove', baseHeaders());
  const salts = [];
  for (let i = 1; i <= 5; i++) {
    const v = parseInt(prove['salt' + i], 10);
    if (!Number.isFinite(v)) throw new Error('prove response missing salt' + i);
    salts.push(v);
  }
  const rawToken = prove.accessToken;
  if (typeof rawToken !== 'string' || rawToken.length < 16) {
    throw new Error('prove response missing accessToken');
  }

  const token = cutToken(rawToken, cutPoints(salts[1]));
  if (!token || token.length < 16) throw new Error('derived token looks invalid');
  AUTH = { token: token, salts: salts };
  return AUTH;
}

// Authenticated request with one 401 -> re-authenticate -> retry cycle.
async function apiFetch(method, path, body) {
  if (!AUTH) await authenticate();
  const url = ROOT + path;
  const doReq = async (token) => {
    const headers = Object.assign(baseHeaders(), { 'Authorization': 'Salter ' + token });
    const opts = { method: method, headers: headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetchWithTimeout(url, opts);
  };
  let res = await doReq(AUTH.token);
  if (res.status === 401) {
    log('got 401, re-authenticating once');
    await authenticate();
    res = await doReq(AUTH.token);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('non-JSON response from ' + path); }
}

// Day of month in Nepal time (NPT = UTC+5:45); the payload id depends on it.
function nptDayOfMonth() {
  return new Date(Date.now() + (5 * 60 + 45) * 60000).getUTCDate();
}

// Payload id for today-price (mirrors yonepse auth.py PayloadParser with
// which=null -> the else branch with the salt adjustment).
function payloadId(marketOpenId, salts) {
  const gid = parseInt(marketOpenId, 10);
  if (!Number.isFinite(gid) || gid < 0 || gid >= DUMMY.length) {
    throw new Error('market-open id out of range: ' + marketOpenId);
  }
  const day = nptDayOfMonth();
  const base = DUMMY[gid] + gid + 2 * day;
  const idx = (base % 10 < 5) ? 1 : 3; // 1-based salt index
  return base + salts[idx] * day - salts[idx - 1]; // salts[] is 0-based
}

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
    // 1. Market status — never write quotes when the market is closed.
    const mo = await apiFetch('GET', '/api/nots/nepse-data/market-open');
    if (!mo || mo.isOpen !== 'OPEN') {
      log('market is ' + (mo && mo.isOpen) + '; leaving live.json untouched');
      process.exit(0);
    }
    log('market OPEN (asOf=' + mo.asOf + ', id=' + mo.id + ')');

    // 2. Per-symbol live prices, paginated.
    const pid = payloadId(mo.id, AUTH.salts);
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
    }
    if (!rows.length) throw new Error('today-price returned no rows while market is OPEN');

    const quotes = rows
      .filter((it) => it && typeof it.symbol === 'string' && it.symbol)
      .map(mapRow)
      .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    if (!quotes.length) throw new Error('no valid quote rows after mapping');

    const payload = {
      asof: new Date().toISOString(),
      market: 'OPEN',
      quotes: quotes
    };

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

main();
