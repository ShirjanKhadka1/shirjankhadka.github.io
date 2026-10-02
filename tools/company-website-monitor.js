#!/usr/bin/env node
/* Nepse Decode — company website monitor (production).
 *
 * Checks listed companies' official websites for new announcements,
 * press releases, and financial documents. Only financial/share-market
 * related updates become news items.
 *
 * PRODUCTION BEHAVIOR:
 * - Baseline-first: the first time a company is checked, all found PDFs
 *   are recorded as "seen" WITHOUT publishing. Only PDFs appearing on
 *   SUBSEQUENT checks become news. This prevents 280 companies' historical
 *   PDFs from flooding news.json on first run.
 * - Rotation: with 280 companies, a full sweep takes too long for one run.
 *   Use --batch <n> --of <m> to check 1/m of companies per run.
 *   E.g. --batch 0 --of 6 checks companies[0::6], next run --batch 1 --of 6, etc.
 *   A cron can cycle through batches for full coverage over time.
 *
 * Usage:
 *   node tools/company-website-monitor.js --batch 0 --of 6
 *   node tools/company-website-monitor.js --symbols HATHY,NABIL  (targeted check)
 *   node tools/company-website-monitor.js --baseline --symbols HATHY  (force re-baseline)
 *
 * Output: merges new items into nepse-chart/data/news.json with src="Company website"
 * State: nepse-chart/data/company-website-state.json
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'nepse-chart', 'data', 'company-websites.json');
const NEWS = path.join(ROOT, 'nepse-chart', 'data', 'news.json');
const STATE = path.join(ROOT, 'nepse-chart', 'data', 'company-website-state.json');

const UA = { 'User-Agent': 'Mozilla/5.0 (NepseDecode company monitor)' };

// Financial/share-market keywords that qualify a document as news-worthy.
const FIN_KW = [
  'dividend', 'bonus', 'right share', 'rightshare', 'agm', 'annual general meeting',
  'quarterly', 'financial', 'profit', 'loss', 'merger', 'acquisition', 'amalgamation',
  'intention to sell', 'promoter', 'auction', 'book closure', 'bookclose', 'book-close',
  'share', 'nepse', 'capital', 'investment', 'annual report', 'audit',
  // Nepali
  'लाभांश', 'बोनस', 'हकप्रद', 'साधारण सभा', 'नाफा', 'घाटा', 'सेयर',
  'वित्तीय', 'प्रतिवेदन', 'लिलाम',
];

function fetch(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: UA, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        return done(resolve, fetch(new URL(res.headers.location, url).href, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return done(reject, new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 2e6) { req.destroy(); done(resolve, data); } });
      res.on('end', () => done(resolve, data));
    });
    req.on('timeout', () => { req.destroy(); done(reject, new Error('timeout')); });
    req.on('error', (e) => done(reject, e));
    // Some servers/proxies close the connection after headers without 'end':
    // without this the promise never settles, the event loop drains, and
    // Node exits 0 mid-batch with no output at all.
    req.on('close', () => done(reject, new Error('connection closed before response completed')));
  });
}

// Extract PDF links from HTML.
function extractPdfs(html, baseUrl) {
  const pdfs = [];
  const re = /href=["']([^"']+\.pdf[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1], baseUrl).href;
      const fname = decodeURIComponent(url.split('/').pop().split('?')[0]).toLowerCase();
      pdfs.push({ url, fname });
    } catch { /* skip invalid URLs */ }
  }
  // Deduplicate by URL
  return [...new Map(pdfs.map(p => [p.url, p])).values()];
}

function isFinancial(fname) {
  const lower = fname.toLowerCase();
  return FIN_KW.some(kw => lower.includes(kw.toLowerCase()));
}

/* Humanize a PDF filename into a readable title:
 * - strips repeated ".pdf.pdf"
 * - turns separators into spaces
 * - title-cases words, keeping acronyms (GVL, AGM, IPO) uppercase */
const TITLE_ACRONYMS = new Set(['ipo', 'agm', 'gvl', 'fy', 'q1', 'q2', 'q3', 'q4']);
function humanizeTitle(fname) {
  const base = String(fname || '')
    .replace(/(\.pdf)+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base.split(' ').map(w => {
    if (!w) return w;
    if (TITLE_ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
    if (/^[a-z]{1,4}$/.test(w) && !/[aeiou]/i.test(w)) return w.toUpperCase();
    if (/^[A-Z0-9.]+$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

async function checkCompany(sym, info, state, forceBaseline) {
  const st = state[sym] || { pdfs: [], baselined: false, lastCheck: null, errors: 0 };
  const isFirstRun = !st.baselined || forceBaseline;
  const results = [];
  const foundPdfs = new Set(st.pdfs);
  // Reachability is per-company, not per-path: the check_paths are guesses
  // and a 404 on one of them usually means the guess was wrong, not that
  // the site is down. Only a failure across ALL paths counts as an error.
  let anyPathOk = false;

  for (const checkPath of (info.check_paths || ['/'])) {
    const url = info.website.replace(/\/$/, '') + checkPath;
    try {
      const html = await fetch(url);
      const pdfs = extractPdfs(html, url);
      for (const pdf of pdfs) {
        if (!isFinancial(pdf.fname)) continue;
        if (!foundPdfs.has(pdf.url)) {
          foundPdfs.add(pdf.url);
          // Only publish if this company already has a baseline
          if (!isFirstRun) {
            results.push({
              sym,
              title: `${info.name}: ${humanizeTitle(pdf.fname)}`,
              link: pdf.url,
              src: 'Company website',
              date: new Date().toISOString().slice(0, 10),
            });
          }
        }
      }
      anyPathOk = true;
    } catch (e) {
      // Best-effort sub-path failed (often a 404 on a guessed path).
      // Don't log every error verbosely in production; batch summary at end.
    }
    await new Promise(r => setTimeout(r, 800));
  }

  st.errors = anyPathOk ? 0 : (st.errors || 0) + 1;
  st.pdfs = [...foundPdfs];
  st.baselined = true;
  st.lastCheck = new Date().toISOString();
  state[sym] = st;
  return { results, isFirstRun, errorCount: st.errors };
}

async function main() {
  const args = process.argv.slice(2);
  let filterSyms = null, batch = null, of = null, forceBaseline = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbols' && args[i + 1]) filterSyms = args[i + 1].split(',').map(s => s.trim().toUpperCase());
    if (args[i] === '--batch' && args[i + 1]) batch = parseInt(args[i + 1], 10);
    if (args[i] === '--of' && args[i + 1]) of = parseInt(args[i + 1], 10);
    if (args[i] === '--baseline') forceBaseline = true;
  }

  if (!fs.existsSync(DB)) { console.log('No company websites database.'); return; }
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

  let companies = Object.entries(db.companies || {});
  // Stable sort so batch slicing is deterministic across runs
  companies.sort(([a], [b]) => a.localeCompare(b));

  if (filterSyms) {
    companies = companies.filter(([sym]) => filterSyms.includes(sym));
  } else if (batch !== null && of !== null) {
    companies = companies.filter((_, idx) => idx % of === batch);
  }

  console.log(`> Company website monitor: checking ${companies.length} companies` +
    (batch !== null ? ` (batch ${batch}/${of})` : ''));

  let totalNew = 0, totalBaselined = 0, totalErrors = 0;
  const allResults = [];

  for (const [sym, info] of companies) {
    const { results, isFirstRun, errorCount } = await checkCompany(sym, info, state, forceBaseline);
    if (isFirstRun) totalBaselined++;
    if (errorCount > 3) totalErrors++;
    if (results.length > 0) {
      console.log(`  ${sym}: ${results.length} NEW document(s)`);
      for (const r of results) console.log(`    - ${r.title.slice(0, 80)}`);
    }
    allResults.push(...results);
    totalNew += results.length;
    // Checkpoint after every company: a killed run keeps its progress,
    // and already-baselined companies resume as normal monitoring.
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  }

  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  if (allResults.length > 0 && fs.existsSync(NEWS)) {
    const news = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
    const existing = new Set((news.items || []).map(it => it.link));
    const fresh = allResults.filter(r => !existing.has(r.link));
    news.items = [...fresh, ...(news.items || [])].slice(0, 500);
    fs.writeFileSync(NEWS, JSON.stringify(news, null, 2));
    console.log(`> added ${fresh.length} new items to news.json`);
  }

  console.log(`> done: ${totalNew} new, ${totalBaselined} baselined (first run), ${totalErrors} persistent errors`);
}

main().catch(e => { console.error(e); process.exit(1); });
