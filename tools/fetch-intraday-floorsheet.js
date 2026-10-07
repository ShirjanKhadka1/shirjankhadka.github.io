#!/usr/bin/env node
/* Nepse Decode — intraday floorsheet fetcher (official NEPSE API).
 *
 * Polls NEPSE's official current-day floorsheet endpoint during market hours
 * and writes an aggregated broker x symbol snapshot:
 *   nepse-brokers/data/intraday.json
 *   { asof, market, date, rows, pages,
 *     brokers: { "<code>": { buy_value, sell_value, buy_qty, sell_qty } },
 *     symbols: { "<SYM>": { qty, value, buyers: {code: [qty, value]}, sellers: {code: [qty, value]} } } }
 *
 * Auth reuses the same Salter token dance as tools/fetch-nepse-live.js
 * (duplicated here so the live-quote script stays untouched).
 *
 * FAIL-SAFE: on any failure exits 0 without touching intraday.json.
 * Run from GitHub Actions (nepalstock.com is not reachable from the dev VM).
 *
 * NOTE: the exact floorsheet response field names are resolved defensively
 * at runtime — the first row's keys are logged so the mapping can be
 * verified from Actions logs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = 'https://www.nepalstock.com';
const OUT = path.join(__dirname, '..', 'nepse-brokers', 'data', 'intraday.json');
const UA = 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)';
const REQ_TIMEOUT_MS = 30000;
const PAGE_SIZE = 500;
const MAX_PAGES = 200; // ~48k rows/day worst case

const DUMMY = [40, 31, 22, 13, 4, 55, 46, 37, 28, 19, 10, 61, 52, 43, 34, 25, 16, 7,
  58, 49, 40, 31, 22, 13, 4, 55, 46, 37, 28, 19, 10, 61, 52, 43, 34, 25, 16, 7,
  58, 49, 40, 31, 22, 13, 4, 55, 46, 37, 28, 19, 10, 61, 52, 43, 34, 25, 16, 7,
  58, 49, 40, 31, 22, 13, 4, 55, 46, 37, 28, 19, 10, 61, 52, 43, 34, 25, 16, 7,
  58, 49, 40, 31, 22, 13, 4, 55, 46, 37, 28, 19, 10, 61, 52, 43, 34, 25, 16, 7];

function log(...a) { console.log('[intraday-floorsheet]', ...a); }

/* ---- auth (ported from tools/fetch-nepse-live.js; keep in sync) ---- */
const CUT_TABLE = [5, 8, 4, 7, 9, 4, 6, 9, 5, 5, 6, 5, 3, 5, 4, 4, 9, 6, 6, 8,
                   8, 6, 8, 6, 5, 8, 4, 9, 5, 9, 8, 5, 3, 4, 7, 7, 4, 7, 3, 9];
function cutPoints(salt2) {
  const s = salt2 | 0;
  const d0 = s % 10, d1 = ((s / 10) | 0) % 10, d2 = ((s / 100) | 0) % 10;
  const t = CUT_TABLE[d0 + d1 + d2];
  if (t === undefined) throw new Error('cut index out of range for salt2=' + salt2);
  return [t + 22, d1 + d2 + t + 32, d1 + d2 + t + 60, d1 + t + 88, d2 + t + 110];
}
function cutToken(token, pts) {
  let out = ''; let prev = 0;
  const sorted = pts.slice().sort((a, b) => a - b);
  for (const p of sorted) { const cut = Math.max(0, p | 0); out += token.slice(prev, cut); prev = cut + 1; }
  out += token.slice(prev);
  return out;
}
function baseHeaders() {
  return { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
           'Accept-Language': 'en-US,en;q=0.5', 'Referer': ROOT + '/' };
}
function fetchWithTimeout(url, opts) {
  opts = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout ' + url)), REQ_TIMEOUT_MS);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal })).finally(() => clearTimeout(timer));
}
async function getJSON(url, headers) {
  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('non-JSON response from ' + url); }
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
  if (typeof rawToken !== 'string' || rawToken.length < 16) throw new Error('prove response missing accessToken');
  const token = cutToken(rawToken, cutPoints(salts[1]));
  if (!token || token.length < 16) throw new Error('derived token looks invalid');
  AUTH = { token, salts };
  return AUTH;
}
async function apiFetch(method, path, body) {
  if (!AUTH) await authenticate();
  const url = ROOT + path;
  const doReq = async (token) => {
    const headers = Object.assign(baseHeaders(), { 'Authorization': 'Salter ' + token });
    const opts = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetchWithTimeout(url, opts);
  };
  let res = await doReq(AUTH.token);
  if (res.status === 401) { log('got 401, re-authenticating once'); await authenticate(); res = await doReq(AUTH.token); }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('non-JSON response from ' + path); }
}
function nptDayOfMonth() { return new Date(Date.now() + (5 * 60 + 45) * 60000).getUTCDate(); }
function payloadId(marketOpenId, salts) {
  const gid = parseInt(marketOpenId, 10);
  if (!Number.isFinite(gid) || gid < 0 || gid >= DUMMY.length) throw new Error('market-open id out of range: ' + marketOpenId);
  const day = nptDayOfMonth();
  const base = DUMMY[gid] + gid + 2 * day;
  const idx = (base % 10 < 5) ? 1 : 3;
  return base + salts[idx] * day - salts[idx - 1];
}
function nptDate(ms) { return new Date(ms + (5 * 60 + 45) * 60 * 1000).toISOString().slice(0, 10); }
function num(v, fb) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : fb; }

/* ---- floorsheet row mapping (defensive; keys logged on first row) ---- */
const FIELD_CANDIDATES = {
  symbol: ['symbol', 'stockSymbol', 'scrip', 'securityName'],
  buyer: ['buyerBrokerName', 'buyerMemberId', 'buyerBroker', 'buyer', 'buyerMemberCode'],
  seller: ['sellerBrokerName', 'sellerMemberId', 'sellerBroker', 'seller', 'sellerMemberCode'],
  qty: ['contractQuantity', 'quantity', 'tradedQuantity', 'qty'],
  amount: ['contractAmount', 'amount', 'tradedValue', 'totalAmount'],
};
let loggedKeys = false;
function mapRow(row) {
  if (!loggedKeys) { loggedKeys = true; log('floorsheet row keys:', Object.keys(row).join(',')); }
  const pick = (cands) => {
    for (const c of cands) if (row[c] !== undefined && row[c] !== null) return row[c];
    return null;
  };
  const symbol = pick(FIELD_CANDIDATES.symbol);
  const buyer = pick(FIELD_CANDIDATES.buyer);
  const seller = pick(FIELD_CANDIDATES.seller);
  const qty = num(pick(FIELD_CANDIDATES.qty), 0);
  const amount = num(pick(FIELD_CANDIDATES.amount), 0);
  if (!symbol || buyer === null || seller === null || !(qty > 0)) return null;
  return { symbol: String(symbol).trim(), buyer: String(buyer).trim(),
           seller: String(seller).trim(), qty, amount };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['floorsheets', 'floorsheet', 'content', 'data', 'rows', 'result']) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return [];
}

async function main() {
  try {
    const mo = await apiFetch('GET', '/api/nots/nepse-data/market-open');
    const marketOpen = !!(mo && mo.isOpen === 'OPEN');
    log('market status:', mo && mo.isOpen, 'session id:', mo && mo.id);
    if (!mo || mo.id == null) {
      // Distinguish "market closed, no session expected" from "API failed"
      // If the API returned a response but no session ID, market is likely closed — graceful exit
      // If mo is null/undefined, the API call itself failed — this is an error
      if (mo === null || mo === undefined) {
        log('FATAL: market-open API returned no response — API may be down or blocking');
        process.exit(1);
      }
      log('no session id (market closed); leaving intraday.json untouched');
      process.exit(0);
    }

    if (!marketOpen) {
      // Market-hours poller: when the market is not OPEN (e.g. a cron run
      // delayed past 15:00 NPT), the floorsheet endpoint returns zero rows
      // for the last session — not a field-mapping change. Exit cleanly so a
      // delayed out-of-hours run can't fire a false failure alert.
      log('market is', mo.isOpen || 'unknown', '- not OPEN; leaving intraday.json untouched');
      process.exit(0);
    }

    const pid = payloadId(mo.id, AUTH.salts);
    const brokers = {};  // code -> {buy_value, sell_value, buy_qty, sell_qty}
    const symbols = {};  // sym -> {qty, value, buyers:{}, sellers:{}}
    let totalRows = 0, pages = 0, mapped = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const payload = await apiFetch('POST',
        '/api/nots/nepse-data/floorsheet?page=' + page + '&size=' + PAGE_SIZE,
        { id: pid });
      const rows = extractRows(payload);
      pages++;
      if (rows.length === 0) break;
      for (const r of rows) {
        totalRows++;
        const m = mapRow(r);
        if (!m) continue;
        mapped++;
        const b = brokers[m.buyer] || (brokers[m.buyer] = { buy_value: 0, sell_value: 0, buy_qty: 0, sell_qty: 0 });
        b.buy_value += m.amount; b.buy_qty += m.qty;
        const s = brokers[m.seller] || (brokers[m.seller] = { buy_value: 0, sell_value: 0, buy_qty: 0, sell_qty: 0 });
        s.sell_value += m.amount; s.sell_qty += m.qty;
        const sym = symbols[m.symbol] || (symbols[m.symbol] = { qty: 0, value: 0, buyers: {}, sellers: {} });
        sym.qty += m.qty; sym.value += m.amount;
        const bb = sym.buyers[m.buyer] || (sym.buyers[m.buyer] = [0, 0]);
        bb[0] += m.qty; bb[1] += m.amount;
        const ss = sym.sellers[m.seller] || (sym.sellers[m.seller] = [0, 0]);
        ss[0] += m.qty; ss[1] += m.amount;
      }
      log('page ' + page + ': ' + rows.length + ' rows');
      if (rows.length < PAGE_SIZE) break;
    }

    log('total rows: ' + totalRows + ', mapped: ' + mapped + ', pages: ' + pages);
    if (mapped === 0) {
      log('FATAL: no rows mapped — API returned data but field mapping failed');
      log('This means NEPSE changed their API format. Field mapping needs fixing.');
      process.exit(1);
    }

    // round for compactness
    const round2 = (n) => Math.round(n * 100) / 100;
    for (const k of Object.keys(brokers)) {
      const b = brokers[k];
      b.buy_value = round2(b.buy_value); b.sell_value = round2(b.sell_value);
      b.buy_qty = round2(b.buy_qty); b.sell_qty = round2(b.sell_qty);
    }
    for (const k of Object.keys(symbols)) {
      const s = symbols[k];
      s.qty = round2(s.qty); s.value = round2(s.value);
      for (const bk of Object.keys(s.buyers)) { s.buyers[bk][0] = round2(s.buyers[bk][0]); s.buyers[bk][1] = round2(s.buyers[bk][1]); }
      for (const bk of Object.keys(s.sellers)) { s.sellers[bk][0] = round2(s.sellers[bk][0]); s.sellers[bk][1] = round2(s.sellers[bk][1]); }
    }

    const out = {
      asof: new Date().toISOString(),
      date: nptDate(Date.now()),
      market: marketOpen ? 'OPEN' : 'CLOSED',
      rows: mapped, pages,
      brokers, symbols,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const tmp = OUT + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, OUT);
    log('wrote ' + OUT + ' (' + Object.keys(brokers).length + ' brokers, ' +
        Object.keys(symbols).length + ' symbols)');
  } catch (e) {
    log('FATAL:', e.message);
    log('Stack:', e.stack);
    process.exit(1);
  }
}

main();
