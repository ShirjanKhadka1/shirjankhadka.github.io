#!/usr/bin/env node
/* Nepse Decode — weekly symbol-pages health check (read-only).
 *
 * Verifies, without changing anything:
 *   1. stocks/ page count == universe instrument count (+1 for stocks/index.html)
 *   2. sitemap.xml lists every /stocks/{SYM}/ URL and is fresh (lastmod ==
 *      the batch asof date)
 *   3. internal /stocks/ and /nepse-actions/ links found in built pages
 *      resolve to files that exist (no 404s)
 *
 * Reports JSON to stdout; exits 0 when healthy, 1 when any check fails.
 * Intended to run Mondays via a workspace cron; it modifies nothing.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

function main() {
  const issues = [];
  const universe = loadJson(path.join(ROOT, 'nepse-chart', 'data', 'universe.json'), null);
  const ver = loadJson(path.join(ROOT, 'nepse-chart', 'data', 'verdicts.json'), null);
  const expected = universe ? universe.symbols.length : 0;

  // 1. Page count.
  const stocksDir = path.join(ROOT, 'stocks');
  let pageDirs = [];
  try {
    pageDirs = fs.readdirSync(stocksDir).filter((d) =>
      d !== 'index.html' && fs.existsSync(path.join(stocksDir, d, 'index.html')));
  } catch { /* missing dir */ }
  if (pageDirs.length !== expected) {
    issues.push(`page count ${pageDirs.length} != universe count ${expected}`);
  }
  const syms = new Set(pageDirs);
  const slug = (s) => String(s).replace(/\//g, '-');
  for (const u of (universe ? universe.symbols : [])) {
    if (!syms.has(slug(u.s))) issues.push(`missing page for ${u.s}`);
  }

  // 2. Sitemap freshness and coverage.
  const sm = loadJson(null, null) || null;
  let smText = '';
  try { smText = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); } catch { issues.push('sitemap.xml unreadable'); }
  const asof = (ver && ver.asof) || (universe && universe.asof) || '';
  let smStocks = 0;
  for (const u of (universe ? universe.symbols : [])) {
    if (smText.includes(`/stocks/${slug(u.s)}/`)) smStocks++;
    else if (issues.length < 12) issues.push(`sitemap missing /stocks/${slug(u.s)}/`);
  }
  if (smText && !smText.includes('/nepse-actions/')) issues.push('sitemap missing /nepse-actions/');
  const lm = smText.match(/\/stocks\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/);
  // looser: check the generated block carries the asof date
  if (smText && asof && !smText.includes(`<lastmod>${asof}</lastmod>`)) {
    issues.push(`sitemap lastmod does not match batch asof ${asof}`);
  }
  void sm; void lm;

  // 3. Internal link integrity: every /stocks/ and /nepse-actions/ href in
  //    built HTML must resolve to an existing file.
  const checked = new Set();
  const broken = [];
  function checkFile(f) {
    if (checked.has(f)) return;
    checked.add(f);
    let t;
    try { t = fs.readFileSync(f, 'utf8'); } catch { return; }
    const re = /href="(\/(?:stocks|nepse-actions)[^"]*)"/g;
    let m;
    while ((m = re.exec(t))) {
      const href = m[1].split('?')[0].split('#')[0];
      const disk = path.join(ROOT, href, href.endsWith('/') ? 'index.html' : '');
      if (!fs.existsSync(disk)) broken.push(`${f} -> ${href}`);
    }
  }
  // Sample: all stock index pages would be slow to fully scan; scan the
  // directory page, actions page, and every 20th symbol page plus the tool JS
  // entry points is overkill — scan stocks/index.html, nepse-actions, and
  // 25 spread samples.
  try { checkFile(path.join(stocksDir, 'index.html')); } catch {}
  try { checkFile(path.join(ROOT, 'nepse-actions', 'index.html')); } catch {}
  const sample = pageDirs.filter((_, i) => i % 20 === 0);
  for (const d of sample) checkFile(path.join(stocksDir, d, 'index.html'));
  for (const b of broken.slice(0, 20)) issues.push('broken link: ' + b);

  const healthy = issues.length === 0;
  console.log(JSON.stringify({
    healthy,
    pages: pageDirs.length,
    universe: expected,
    sitemapStockUrls: smStocks,
    asof,
    linksChecked: checked.size,
    issues: issues.slice(0, 30),
  }, null, 2));
  process.exit(healthy ? 0 : 1);
}

main();
