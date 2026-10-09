#!/usr/bin/env node
/*
 * info-freshness-sweep.js — weekly staleness sweep for informational/editorial pages.
 *
 * Report-only: it NEVER edits site copy. Where a figure can be sourced
 * automatically it is already wired client-side on the pages themselves
 * (signals landing + methodology read their numbers from the published JSONs);
 * everything else is flagged here for human review instead of guessed.
 *
 * Checks:
 *  1. Signal-engine consistency — methodology/landing claims vs published signal JSONs
 *     (backtest window, universe size, live_track_record presence, hardcoded year patterns).
 *  2. "all N securities" claims vs universe.json count.
 *  3. Internal link integrity on the informational page set (href="/..." -> file exists).
 *  4. External link health (HEAD, best-effort; failures are reported, not fatal).
 *  5. Stale date patterns in informational copy (dates older than STALE_DAYS).
 *  6. Methodology-vs-engine claim checks (MIN_SESSIONS/STALE_DAYS match the copy,
 *     claimed builder scripts exist).
 *
 * Usage: node tools/info-freshness-sweep.js [--report-dir <dir>]
 * Report: <report-dir>/info-freshness-YYYY-MM-DD.md (default: repo-adjacent goal
 * hidden_files). Exit 0 always; prints a STALE/OK summary for the cron log.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const REPO = path.join(__dirname, '..');
const STALE_DAYS = 60;            // dates older than this in informational copy get flagged
const EXT_TIMEOUT_MS = 8000;

const INFO_PAGES = [
  'about.html',
  'nepse-signals/index.html',
  'nepse-signals/momentum/index.html',
  'nepse-signals/trend-relay/index.html',
  'nepse-signals/reversal/index.html',
  'nepse-signals/methodology/index.html',
  'nepse-verdicts-v2/index.html',
  'nepse-verdicts-v2/methodology/index.html',
  'editorial-standards/index.html',
  'corrections/index.html',
  'ownership/index.html',
  'ask/index.html',
  'nepse-radar/index.html',
  'data-terms.html',
  'privacy.html',
  'contact.html',
  'ne/editorial-standards/index.html',
];

const findings = [];
function flag(sev, page, msg) { findings.push({ sev, page, msg }); }
function ok(msg) { /* kept for future verbosity */ }

function read(p) {
  try { return fs.readFileSync(path.join(REPO, p), 'utf8'); } catch (e) { return null; }
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8')); } catch (e) { return null; }
}

/* ---------- 1. signal-engine consistency ---------- */
function checkSignals() {
  const page = 'nepse-signals/methodology/index.html';
  const method = read(page);
  const sigs = ['momentum', 'trend-relay', 'reversal'].map(s =>
    ({ sys: s, d: readJson(`nepse-chart/data/signals/${s}.json`) }));
  const missing = sigs.filter(s => !s.d);
  if (missing.length) {
    flag('ERROR', 'nepse-chart/data/signals/', 'missing signal JSON: ' + missing.map(s => s.sys).join(', '));
    return;
  }
  // hardcoded stale patterns that must never return to these pages
  const stalePatterns = [/23\s*years/i, /23\.2/i, /2003-07-17/, /2026-09-29/, /315 symbols/, /314 symbols/, /410 securities/, /backtested 23 years/i];
  for (const p of ['nepse-signals/index.html', page, 'nepse-signals/momentum/index.html',
                   'nepse-signals/trend-relay/index.html', 'nepse-signals/reversal/index.html']) {
    const html = read(p);
    if (!html) { flag('ERROR', p, 'page missing'); continue; }
    for (const re of stalePatterns) {
      if (re.test(html)) flag('STALE', p, `hardcoded stale pattern returned: ${re}`);
    }
  }
  // live_track_record presence + freshness
  for (const s of sigs) {
    const lr = s.d.live_track_record;
    if (!lr || !lr.stats) {
      flag('STALE', `nepse-chart/data/signals/${s.sys}.json`, 'live_track_record missing — the Live forward record section will show the empty state');
      continue;
    }
    if (!lr.tracking_started) flag('WARN', `nepse-chart/data/signals/${s.sys}.json`, 'live_track_record has no tracking_started');
  }
  // backtest window sanity: backtest_to should be within ~4 days of today (weekend gap)
  const mom = sigs[0].d, st = mom.stats || {};
  if (st.backtest_to) {
    const ageDays = (Date.now() - Date.parse(st.backtest_to + 'T00:00:00Z')) / 864e5;
    if (ageDays > 4) flag('STALE', 'nepse-chart/data/signals/momentum.json',
      `backtest_to=${st.backtest_to} is ${ageDays.toFixed(1)} days old — the 15:05 signals rebuild may have stalled`);
  }
  if (st.backtest_from !== '2024-09-01') {
    flag('WARN', page, `backtest window start changed to ${st.backtest_from} — methodology fallback copy assumes 2024-09-01`);
  }
  // builder template must not reference the removed st.backtest_years field
  const tpl = read('tools/build-signal-pages.js');
  if (tpl && /st\.backtest_years/.test(tpl)) {
    flag('STALE', 'tools/build-signal-pages.js', 'still references st.backtest_years (removed field) — pages render "undefined years"');
  }
}

/* ---------- 2. universe-count claims ---------- */
function checkUniverseClaims() {
  const u = readJson('nepse-chart/data/universe.json');
  const count = u && (u.count || (Array.isArray(u.symbols) ? u.symbols.length : null));
  if (!count) { flag('WARN', 'nepse-chart/data/universe.json', 'could not read universe count'); return; }
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) files.push(p);
    }
  })(REPO);
  const re = /all (\d{3,4}) securities/i;
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(html))) {
      if (+m[1] !== count) {
        flag('STALE', path.relative(REPO, f),
          `"all ${m[1]} securities" but universe.json count is ${count}`);
      }
    }
  }
}

/* ---------- 3. internal link integrity (informational pages only) ---------- */
function resolveInternal(href) {
  let p = href.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) return null;
  p = decodeURIComponent(p).replace(/^\/+/, '');
  if (!p) return 'index.html';
  let cand = path.join(REPO, p);
  try {
    const st = fs.statSync(cand);
    if (st.isDirectory()) cand = path.join(cand, 'index.html');
  } catch (e) { /* may be extensionless or missing */ }
  if (!fs.existsSync(cand)) {
    if (fs.existsSync(cand + '.html')) cand = cand + '.html';
    else return null;
  }
  return path.relative(REPO, cand);
}
function checkInternalLinks() {
  const hrefRe = /href="(\/[^"]*)"/g;
  for (const page of INFO_PAGES) {
    const html = read(page);
    if (!html) { flag('ERROR', page, 'page missing from tree'); continue; }
    const seen = new Set();
    let m;
    while ((m = hrefRe.exec(html))) {
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      if (/\.(css|js|png|jpg|jpeg|svg|ico|woff2?|json|xml|txt|pdf)(\?|$)/i.test(href.split('#')[0])) continue; // assets handled elsewhere
      const resolved = resolveInternal(href);
      if (!resolved) flag('STALE', page, `dead internal link: ${href}`);
    }
  }
}

/* ---------- 4. external link health (best-effort) ---------- */
function headCheck(url) {
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method: 'HEAD', timeout: EXT_TIMEOUT_MS,
      headers: { 'User-Agent': 'NepseDecode-info-freshness-sweep' } }, res => {
      resolve({ url, status: res.statusCode });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 'timeout' }); });
    req.on('error', e => resolve({ url, status: 'error:' + (e.code || e.message) }));
    req.end();
  });
}
async function checkExternalLinks() {
  const urls = new Set();
  const tagRe = /<(a|link)\b[^>]*>/gi;
  for (const page of INFO_PAGES) {
    const html = read(page);
    if (!html) continue;
    let t;
    while ((t = tagRe.exec(html))) {
      const tag = t[0];
      if (/rel\s*=\s*"(preconnect|dns-prefetch|icon|apple-touch-icon|stylesheet)"/i.test(tag) &&
          !/^<a\b/i.test(tag)) continue; // not a navigational link
      const hm = /href="(https?:\/\/[^"]*)"/i.exec(tag);
      if (!hm) continue;
      const u = hm[1].split('#')[0];
      if (/facebook\.com|nepalstock\.com/.test(u)) continue; // known-flaky / login-walled; covered by other monitors
      urls.add(u);
    }
  }
  const list = [...urls].slice(0, 40); // bounded: informational pages only
  for (const u of list) {
    const r = await headCheck(u);
    if (r.status === 'timeout' || String(r.status).startsWith('error')) {
      flag('WARN', 'external', `could not verify ${u} (${r.status}) — network may be flaky, recheck manually if persistent`);
    } else if (r.status >= 400 && r.status !== 405) {
      flag('STALE', 'external', `${u} returned HTTP ${r.status}`);
    }
  }
}

/* ---------- 5. stale date patterns in informational copy ---------- */
function checkStaleDates() {
  const cutoff = Date.now() - STALE_DAYS * 864e5;
  const dateRe = /(as of|updated|through|data through|last updated)\s+(\d{4}-\d{2}-\d{2})/gi;
  for (const page of INFO_PAGES) {
    const html = read(page);
    if (!html) continue;
    // strip scripts/styles so we only scan visible copy
    const copy = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    let m;
    while ((m = dateRe.exec(copy))) {
      const t = Date.parse(m[2] + 'T00:00:00Z');
      if (isFinite(t) && t < cutoff) {
        flag('STALE', page, `"${m[1]} ${m[2]}" is older than ${STALE_DAYS} days — refresh or remove the date`);
      }
    }
  }
}

/* ---------- 6. methodology-vs-engine claim checks ---------- */
function checkEngineClaims() {
  const bs = read('tools/build-signals.js');
  const method = read('nepse-signals/methodology/index.html');
  if (bs && method) {
    const minSess = /const MIN_SESSIONS\s*=\s*(\d+)/.exec(bs);
    const staleD = /const STALE_DAYS\s*=\s*(\d+)/.exec(bs);
    if (minSess && !new RegExp(`≥ ${minSess[1]} valid sessions|>= ${minSess[1]} valid sessions`).test(method)) {
      flag('WARN', 'nepse-signals/methodology/index.html',
        `methodology claims "≥ 250 valid sessions" but build-signals.js MIN_SESSIONS=${minSess[1]}`);
    }
    if (staleD && !new RegExp(`${staleD[1]} days before the newest bar`).test(method)) {
      flag('WARN', 'nepse-signals/methodology/index.html',
        `methodology claims 90-day stale exclusion but build-signals.js STALE_DAYS=${staleD[1]}`);
    }
  }
  if (!read('tools/build-signal-pages.js')) flag('ERROR', 'tools/build-signal-pages.js', 'missing — methodology names it the sole source of truth for signal pages');
  if (!read('tools/track-live-signals.py')) flag('ERROR', 'tools/track-live-signals.py', 'missing — methodology says it rewrites live_track_record daily');
  const v2m = read('nepse-verdicts-v2/methodology/index.html');
  if (v2m) {
    if (!read('tools/build-verdicts-v2.js')) flag('ERROR', 'tools/build-verdicts-v2.js', 'missing — v2 methodology names it as the producer');
    if (!read('tools/verdict-engine-v2/rules.js')) flag('ERROR', 'tools/verdict-engine-v2/rules.js', 'missing — v2 methodology names it the single source of truth');
  }
}

/* ---------- report ---------- */
function reportDir() {
  const i = process.argv.indexOf('--report-dir');
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  return path.join(process.env.HOME || '/home/hatch',
    'workspace/goals/finance-portfolio-and-daily-blog/hidden_files/info-freshness');
}

async function main() {
  checkSignals();
  checkUniverseClaims();
  checkInternalLinks();
  await checkExternalLinks();
  checkStaleDates();
  checkEngineClaims();

  const date = new Date().toISOString().slice(0, 10);
  const dir = reportDir();
  fs.mkdirSync(dir, { recursive: true });
  const bySev = s => findings.filter(f => f.sev === s);
  const lines = [
    `# Info-freshness sweep — ${date}`,
    '',
    `Pages scanned: ${INFO_PAGES.length} informational pages.`,
    `Findings: ${bySev('ERROR').length} error, ${bySev('STALE').length} stale, ${bySev('WARN').length} warnings.`,
    '',
  ];
  for (const sev of ['ERROR', 'STALE', 'WARN']) {
    const fs2 = bySev(sev);
    if (!fs2.length) continue;
    lines.push(`## ${sev} (${fs2.length})`, '');
    for (const f of fs2) lines.push(`- **${f.page}** — ${f.msg}`);
    lines.push('');
  }
  if (!findings.length) lines.push('No stale copy, dead links, or engine-claim mismatches found.');
  lines.push('', '_Report-only sweep: no site files were modified. Fix flagged items by hand or wire the figure client-side, then re-run._');
  fs.writeFileSync(path.join(dir, `info-freshness-${date}.md`), lines.join('\n') + '\n');

  const staleN = bySev('STALE').length, errN = bySev('ERROR').length;
  console.log(`info-freshness-sweep ${date}: ${errN} errors, ${staleN} stale, ${bySev('WARN').length} warnings across ${INFO_PAGES.length} pages`);
  for (const f of findings.filter(f => f.sev !== 'WARN')) console.log(`  [${f.sev}] ${f.page} — ${f.msg}`);
  console.log(errN || staleN ? 'RESULT: STALE FOUND (see report)' : 'RESULT: OK — informational copy fresh');
}

main().catch(e => { console.error('sweep crashed:', e.message); process.exit(1); });
