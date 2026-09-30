#!/usr/bin/env node
/* Corporate-action history collector (per scrip, all-time).
 *
 * Scrapes ShareSansar's per-company history endpoints, which are fed from
 * company announcements:
 *   POST https://www.sharesansar.com/company-dividend   (bonus/cash %, dates, FY)
 *   POST https://www.sharesansar.com/company-agm        (AGM no, venue, dates, agenda)
 *   POST https://www.sharesansar.com/company-rightshare (ratio, units, price)
 *   POST https://www.sharesansar.com/company-auction    (type, units, open/close)
 *   POST https://www.sharesansar.com/company-announcements (misc company notices)
 * Each call needs the site's numeric company id (from the company page HTML)
 * and a CSRF token + session cookie from the same visit.
 *
 * Output: nepse-chart/data/corp-history.json
 *   { asof, source: 'sharesansar',
 *     companies: { SYM: { dividends: [...], agms: [...], rights: [...],
 *                          auctions: [...], announcements: [...] } },
 *     throttled: [SYM...]   // returned empty even after retry; needs review
 *     failed: { SYM: reason } }
 *
 * Throttle policy (critical for data quality): ShareSansar soft-throttles
 * bursts by returning empty tables. An all-empty result is therefore
 * SUSPICIOUS, not a real "no history" — every listed company must hold AGMs,
 * so all-five-empty is treated as throttled, never as genuine. Throttled
 * symbols are retried after a long pause; if still empty they go through a
 * slow second pass. Only if the second pass is also empty is the symbol
 * recorded (flagged in `throttled` for manual review).
 *
 * Provenance: history rows are ShareSansar's compilation of company
 * announcements — the stock pages label them as such. The verified-notices
 * archive (corporate-actions.json, official NEPSE PDFs) remains the
 * gold-standard layer for new actions.
 *
 * Polite by design: ~4s between requests, resume-safe (skips symbols already
 * collected), fail-soft per symbol. Node 18+, no npm dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const OUT = path.join(DATA, 'corp-history.json');
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0';

const DELAY_MS = 4000;                  // politeness delay between EVERY request
const RETRY_PAUSE_MS = 90000;           // pause before retrying a suspicious empty
const PASS2_DELAY_MS = 8000;            // slower spacing for the throttled second pass
const PASS2_RETRY_PAUSE_MS = 180000;    // longer pause in second pass
const REQ_TIMEOUT_MS = 30000;
const PAGE_LEN = 100;                   // rows per history table request
const CHECKPOINT_EVERY = 10;

const ENDPOINTS = [
  ['dividends',     'https://www.sharesansar.com/company-dividend'],
  ['agms',          'https://www.sharesansar.com/company-agm'],
  ['rights',        'https://www.sharesansar.com/company-rightshare'],
  ['auctions',      'https://www.sharesansar.com/company-auction'],
  ['announcements', 'https://www.sharesansar.com/company-announcements'],
];

let delayMs = DELAY_MS;
let retryPauseMs = RETRY_PAUSE_MS;

function log(m) { console.log('[corp-history] ' + new Date().toISOString() + ' ' + m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchWithTimeout(url, opts) {
  opts = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout ' + url)), REQ_TIMEOUT_MS);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal })).finally(() => clearTimeout(timer));
}

// Minimal cookie jar (session cookie carries the CSRF session).
const jar = new Map();
function storeCookies(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return;
  for (const part of raw.split(/,(?=[^;,]+=[^;,]+)/)) {
    const kv = part.split(';')[0].trim().split('=');
    if (kv.length >= 2) jar.set(kv[0].trim(), kv.slice(1).join('=').trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
}

async function getCompanyPage(slug) {
  const res = await fetchWithTimeout('https://www.sharesansar.com/company/' + slug, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
  });
  storeCookies(res);
  if (!res.ok) throw new Error('company page HTTP ' + res.status);
  const html = await res.text();
  const cid = (html.match(/id="companyid"[^>]*>\s*([0-9]+)/) || [])[1];
  const token = (html.match(/_token"\s+content="([^"]+)"/) || [])[1];
  if (!cid) throw new Error('companyid not found');
  if (!token) throw new Error('csrf token not found');
  return { cid, token };
}

async function postHistory(url, cid, token) {
  const body = new URLSearchParams({ company: cid, draw: '1', start: '0', length: String(PAGE_LEN) });
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': token,
      'Cookie': cookieHeader(),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: body.toString(),
  });
  storeCookies(res);
  if (!res.ok) throw new Error('history HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data.data)) throw new Error('unexpected shape');
  return data.data;
}

function isEmptyTables(out) {
  return Object.values(out).every(a => a.length === 0);
}

function counts(out) {
  return Object.entries(out).map(([k, a]) => k + '=' + a.length).join(' ');
}

// Returns { tables, throttled }. throttled=true means all tables came back
// empty even after a long-pause retry — the caller must NOT treat this as a
// genuine "no history".
async function collectSymbol(sym) {
  const slug = sym.toLowerCase();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { cid, token } = await getCompanyPage(slug);
    await sleep(delayMs);
    const out = {};
    for (const [key, url] of ENDPOINTS) {
      try { out[key] = await postHistory(url, cid, token); }
      catch (e) { log(sym + ' ' + key + ' failed: ' + e.message); out[key] = []; }
      await sleep(delayMs);
    }
    if (!isEmptyTables(out) || attempt === 1) {
      return { tables: out, throttled: isEmptyTables(out) };
    }
    // Suspicious: company page loaded but every table empty — likely the
    // server's soft throttle. Pause, then retry once before giving up.
    log(sym + ' all tables empty (attempt 1), pausing ' + (retryPauseMs / 1000) + 's and retrying');
    await sleep(retryPauseMs);
  }
}

function loadOut() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch { return null; }
}

function save(companies, throttled, failed) {
  const payload = {
    asof: new Date().toISOString(),
    source: 'sharesansar',
    companies,
    throttled: [...new Set(throttled)],
    failed,
  };
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(payload, null, 1));
  fs.renameSync(OUT + '.tmp', OUT);
}

async function main() {
  const uni = JSON.parse(fs.readFileSync(path.join(DATA, 'universe.json'), 'utf8'));
  const symbols = uni.symbols.map(s => s.s);

  const only = process.argv[2]; // optional: single symbol for testing
  const pass2only = process.argv[3] === '--pass2';

  const prev = loadOut();
  const companies = (prev && prev.companies) || {};
  const failed = (prev && prev.failed) || {};
  let throttled = (prev && prev.throttled) || [];
  let done = 0, failedCount = 0, throttledCount = 0;

  if (pass2only) {
    // Second pass: re-process throttled symbols slowly.
    delayMs = PASS2_DELAY_MS;
    retryPauseMs = PASS2_RETRY_PAUSE_MS;
    const queue = throttled.filter(s => !companies[s]);
    log('pass 2: ' + queue.length + ' throttled symbols to retry');
    for (const sym of queue) {
      try {
        const { tables, throttled: stillEmpty } = await collectSymbol(sym);
        companies[sym] = tables;
        if (stillEmpty) {
          log(sym + ' STILL EMPTY after pass 2 — recorded as empty, stays flagged');
          throttledCount++;
          // stays in `throttled` for manual review
        } else {
          done++;
          throttled = throttled.filter(s => s !== sym); // recovered
          log(sym + ' pass2 recovered: ' + counts(tables));
        }
      } catch (e) {
        failedCount++;
        failed[sym] = e.message;
        log(sym + ' pass2 FAILED: ' + e.message);
      }
      if ((done + failedCount + throttledCount) % CHECKPOINT_EVERY === 0) save(companies, throttled, failed);
      await sleep(delayMs);
    }
    save(companies, throttled, failed);
    log(`pass2 done: ${done} recovered, ${throttledCount} still empty, ${failedCount} failed`);
    return;
  }

  const list = only ? [only] : symbols;
  log(list.length + ' symbols in universe, ' + Object.keys(companies).length + ' already collected');

  for (const sym of list) {
    if (!only && companies[sym]) continue; // resume-safe
    if (!only && throttled.includes(sym)) continue; // already queued for pass 2
    try {
      const { tables, throttled: empty } = await collectSymbol(sym);
      if (empty) {
        log(sym + ' THROTTLED (empty after retry) — queued for pass 2');
        if (!throttled.includes(sym)) throttled.push(sym);
        throttledCount++;
      } else {
        companies[sym] = tables;
        done++;
        log(sym + ' ok: ' + counts(tables));
      }
    } catch (e) {
      failedCount++;
      failed[sym] = e.message;
      log(sym + ' FAILED: ' + e.message);
    }
    if ((done + failedCount + throttledCount) % CHECKPOINT_EVERY === 0) {
      save(companies, throttled, failed);
      log(`checkpoint: ${done} ok / ${throttledCount} throttled / ${failedCount} failed`);
    }
    await sleep(delayMs);
  }

  save(companies, throttled, failed);
  log(`pass1 done: ${done} collected, ${throttledCount} throttled, ${failedCount} failed, ` +
      `${Object.keys(companies).length} total in file`);
  if (throttled.length) {
    log('run pass 2 with: node tools/build-corp-history.js x --pass2');
  }
}

main().catch(e => { console.error('[corp-history] FATAL', e.message); process.exit(1); });
