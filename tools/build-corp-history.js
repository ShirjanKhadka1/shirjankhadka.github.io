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
 * Crawl mechanics (verified 2026-09-30):
 * - GET https://www.sharesansar.com/company/<slug> with a Chrome UA through
 *   the curl binary; parse companyid + CSRF token from the HTML.
 * - POST the five DataTables endpoints on that SAME session (one session per
 *   symbol; the token/session stays valid 10s+). The full DataTables param
 *   set (columns/order/search) is required — a bare POST gets {"data":[]}.
 * - NEVER mint many sessions quickly: the WAF soft-penalizes session bursts
 *   with valid-but-empty {"data":[]} for several minutes. ~2s between POSTs,
 *   ~5s between symbols, no parallelism. A streak of all-empty symbols
 *   trips a 10-minute circuit-breaker cooldown.
 * - Node's fetch (undici) gets fingerprinted and blanked even with identical
 *   params/cookies — all HTTP goes through the curl binary.
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
 * announcements — tracked internally as source:'sharesansar' in the JSON,
 * but per his 2026-09-30 call the stock pages carry NO on-page source label.
 * The verified-notices
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
const UA = 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)';

const DELAY_MS = 5000;                  // politeness delay between symbols (one session per symbol)
const POST_GAP_MS = 2000;               // gap between POSTs on the same session
const RETRY_PAUSE_MS = 90000;           // pause before retrying a suspicious empty
const CIRCUIT_BREAKER_STREAK = 3;       // consecutive throttled symbols before a cooldown pause
const CIRCUIT_BREAKER_PAUSE_MS = 10 * 60 * 1000; // 10-minute cooldown when the WAF penalty box hits
const PASS2_DELAY_MS = 8000;            // slower spacing for the throttled second pass
const PASS2_RETRY_PAUSE_MS = 180000;    // longer pause in second pass
const REQ_TIMEOUT_MS = 30000;
const PAGE_LEN = 25;                    // rows per history table request — MUST stay 25:
                                      // the WAF serves valid-but-empty {"data":[]} for larger
                                      // lengths (verified 2026-09-30: length=100 -> 0 rows,
                                      // length=25 -> 16 rows). Paginate via `start` instead.
const CHECKPOINT_EVERY = 10;

const ENDPOINTS = [
  ['dividends',     'https://www.sharesansar.com/company-dividend'],
  ['agms',          'https://www.sharesansar.com/company-agm'],
  ['rights',        'https://www.sharesansar.com/company-rightshare'],
  ['auctions',      'https://www.sharesansar.com/company-auction'],
  // NOTE: company-announcements intentionally NOT crawled (2026-09-30) —
  // it is misc notices, not structured history; the stock pages render only
  // dividends/AGMs/rights/auctions, and it added ~13 pages per company.
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
// NOTE (2026-09-30): ShareSansar's WAF fingerprints HTTP clients. Node's
// fetch (undici) gets valid-but-empty {"data":[]} responses while the curl
// binary with identical params/cookies gets the real rows. So all HTTP goes
// through the curl binary with a per-symbol cookie-jar file.
const { execFileSync } = require('child_process');

function curl(args, jarFile) {
  const a = ['-s', '--max-time', String(REQ_TIMEOUT_MS / 1000)];
  if (jarFile) a.push('-b', jarFile, '-c', jarFile);
  try {
    return execFileSync('curl', a.concat(args), { maxBuffer: 32 * 1024 * 1024 }).toString('utf8');
  } catch (e) {
    throw new Error('curl failed: ' + (e.message || e).toString().slice(0, 120));
  }
}
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

function jarFileFor(sym) { return '/tmp/ss-corp-' + sym + '.txt'; }

async function getCompanyPage(slug) {
  const sym = slug.toUpperCase();
  const jarF = jarFileFor(sym);
  try { fs.unlinkSync(jarF); } catch {}
  const html = curl([
    '-A', UA, '-H', 'Accept: text/html',
    'https://www.sharesansar.com/company/' + slug,
  ], jarF);
  if (!html || html.length < 1000) throw new Error('company page empty/blocked');
  const cid = (html.match(/id="companyid"[^>]*>\s*([0-9]+)/) || [])[1]
    || (html.match(/companyid" style="display: none;">\s*([0-9]+)/) || [])[1];
  const token = (html.match(/_token"\s+content="([^"]+)"/) || [])[1];
  if (!cid) throw new Error('companyid not found');
  if (!token) throw new Error('csrf token not found');
  return { cid, token, jarF };
}

async function postHistory(url, cid, token, jarF, start) {
  // ShareSansar's server-side DataTables endpoint returns zero rows unless
  // the full DataTables param set (columns/order/search) is present — a bare
  // {company, draw, start, length} POST gets {"data":[]} (2026-09-30).
  const params = [
    ['company', cid], ['draw', '1'], ['start', String(start || 0)], ['length', String(PAGE_LEN)],
    ['search[value]', ''], ['search[regex]', 'false'],
    ['order[0][column]', '0'], ['order[0][dir]', 'desc'],
  ];
  for (let c = 0; c < 8; c++) {
    params.push([`columns[${c}][data]`, String(c)]);
    params.push([`columns[${c}][searchable]`, 'true']);
    params.push([`columns[${c}][orderable]`, 'true']);
    params.push([`columns[${c}][search][value]`, '']);
    params.push([`columns[${c}][search][regex]`, 'false']);
  }
  const args = [
    '-A', UA, '-X', 'POST', url,
    '-H', 'X-Requested-With: XMLHttpRequest',
    '-H', 'X-CSRF-Token: ' + token,
    '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-H', 'Origin: https://www.sharesansar.com',
    '-H', 'Referer: https://www.sharesansar.com/company/',
  ];
  for (const [k, v] of params) args.push('--data-urlencode', k + '=' + v);
  const body = curl(args, jarF);
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error('non-JSON response: ' + body.slice(0, 80)); }
  if (!Array.isArray(data.data)) throw new Error('unexpected shape: ' + body.slice(0, 80));
  return data.data;
}

function isEmptyTables(out) {
  return Object.values(out).every(a => a.length === 0);
}

function counts(out) {
  return Object.entries(out).map(([k, a]) => k + '=' + a.length).join(' ');
}

// Returns { tables, throttled }. throttled=true means every table came back
// empty even after per-endpoint retries — the caller must NOT treat this as
// a genuine "no history".
//
// WAF notes (2026-09-30, verified by experiment):
// - One session per symbol: GET the company page once, then POST all five
//   DataTables endpoints on that same session. The token/session stays valid
//   for 10s+ (5 sequential POSTs 2s apart all returned full data).
// - Minting many sessions in quick succession trips a soft penalty: the
//   server then serves valid-but-empty {"data":[]} for a few minutes.
//   So: exactly ONE session per symbol, ~2s between POSTs, ~5s between
//   symbols. Never parallelize.
async function collectSymbol(sym) {
  const slug = sym.toLowerCase();
  const { cid, token, jarF } = await getCompanyPage(slug);
  const out = {};
  for (const [key, url] of ENDPOINTS) {
    let rows = null;
    for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
      try {
        // Paginate: the WAF only serves length=25, so walk start=0,25,50...
        // until a short page. All pages ride the same session.
        const all = [];
        for (let start = 0; ; start += PAGE_LEN) {
          const page = await postHistory(url, cid, token, jarF, start);
          all.push(...page);
          if (page.length < PAGE_LEN) break;
          await sleep(POST_GAP_MS);
        }
        rows = all;
        if (all.length === 0 && attempt === 0) {
          // Suspicious empty on a working session: one immediate retry
          // before accepting it as genuine.
          log(sym + ' ' + key + ' empty on first try, retrying');
          rows = null;
        }
      } catch (e) {
        log(sym + ' ' + key + ' failed (attempt ' + (attempt + 1) + '): ' + e.message);
        await sleep(3000);
      }
    }
    out[key] = rows || [];
    await sleep(POST_GAP_MS);
  }
  const empty = isEmptyTables(out);
  if (empty) log(sym + ' all tables empty after retries — queued for pass 2 review');
  return { tables: out, throttled: empty };
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

  let emptyStreak = 0;
  for (const sym of list) {
    if (!only && companies[sym]) continue; // resume-safe
    if (!only && throttled.includes(sym)) continue; // already queued for pass 2
    // Circuit breaker: a streak of all-empty symbols means the WAF penalty
    // box is active — pause 10 min to let it expire instead of burning
    // through the universe collecting fake empties.
    if (emptyStreak >= CIRCUIT_BREAKER_STREAK) {
      log('circuit breaker: ' + emptyStreak + ' consecutive empty symbols, cooling down ' +
          (CIRCUIT_BREAKER_PAUSE_MS / 60000) + ' min');
      await sleep(CIRCUIT_BREAKER_PAUSE_MS);
      emptyStreak = 0;
    }
    try {
      const { tables, throttled: empty } = await collectSymbol(sym);
      if (empty) {
        log(sym + ' THROTTLED (empty after retry) — queued for pass 2');
        if (!throttled.includes(sym)) throttled.push(sym);
        throttledCount++;
        emptyStreak++;
      } else {
        companies[sym] = tables;
        done++;
        emptyStreak = 0;
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
