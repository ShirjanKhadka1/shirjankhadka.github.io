#!/usr/bin/env node
/* Nepse Decode — shared NEPSE official API client (V4).
 *
 * The NEPSE official API (nepalstock.com/api) needs a token dance:
 * GET /api/authenticate/prove returns {accessToken, salt1..salt5}; the token
 * is derived by cutting characters at WASM-derived points. This module is the
 * single implementation, used by fetch-nepse-live.js and capture-close.js.
 *
 * Per owner directive (2026-10-04): the official NEPSE site is the source for
 * closing data — no dependency on third-party mirrors for the close.
 * Identifying User-Agent on every request, per polite-polling policy.
 */
'use strict';

const ROOT = 'https://www.nepalstock.com';
const UA = 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)';
const REQ_TIMEOUT_MS = 25000;

function log(msg) { console.log('[nepse-api] ' + msg); }

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

// Token cut table — pure-JS port of NEPSE's derivation module
// (shubhamnpk/yonepse scripts/nepse-scraper/official_api/nepse.wasm).
const CUT_TABLE = [5, 8, 4, 7, 9, 4, 6, 9, 5, 5, 6, 5, 3, 5, 4, 4, 9, 6, 6, 8,
                   8, 6, 8, 6, 5, 8, 4, 9, 5, 9, 8, 5, 3, 4, 7, 7, 4, 7, 3, 9];

function fetchWithTimeout(url, opts) {
  opts = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout ' + url)), REQ_TIMEOUT_MS);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal }))
    .finally(() => clearTimeout(timer));
}

function baseHeaders() {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': ROOT + '/'
  };
}

async function getJSON(url, headers) {
  const res = await fetchWithTimeout(url, { headers: headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('non-JSON response from ' + url); }
}

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

function cutPoints(salt2) {
  const s = salt2 | 0;
  const d0 = s % 10, d1 = ((s / 10) | 0) % 10, d2 = ((s / 100) | 0) % 10;
  const t = CUT_TABLE[d0 + d1 + d2];
  if (t === undefined) throw new Error('cut index out of range for salt2=' + salt2);
  return [t + 22, d1 + d2 + t + 32, d1 + d2 + t + 60, d1 + t + 88, d2 + t + 110];
}

let AUTH = null;

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

function nptDayOfMonth() {
  return new Date(Date.now() + (5 * 60 + 45) * 60000).getUTCDate();
}

function payloadId(marketOpenId, salts) {
  const gid = parseInt(marketOpenId, 10);
  if (!Number.isFinite(gid) || gid < 0 || gid >= DUMMY.length) {
    throw new Error('market-open id out of range: ' + marketOpenId);
  }
  const day = nptDayOfMonth();
  const base = DUMMY[gid] + gid + 2 * day;
  const idx = (base % 10 < 5) ? 1 : 3;
  return base + salts[idx] * day - salts[idx - 1];
}

module.exports = {
  ROOT, UA, REQ_TIMEOUT_MS, DUMMY,
  fetchWithTimeout, baseHeaders, getJSON,
  cutToken, cutPoints, authenticate, apiFetch,
  nptDayOfMonth, payloadId,
  getAuth: () => AUTH,
};
