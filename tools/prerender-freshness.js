#!/usr/bin/env node
/**
 * tools/prerender-freshness.js — inject the freshness-badge mount + script into
 * the data pages. Idempotent: skips pages that already have the mount.
 *
 * Run once per page set (committed), and re-run in the market-close workflow
 * so regenerated pages keep the badge. The badge itself reads
 * /data/manifest.json client-side, so dates never go stale.
 *
 * Also removes the hardcoded `session YYYY-MM-DD` span on /nepse-decode/
 * (defect: it goes stale when a build is skipped).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = [
  'nepse-decode', 'nepse-chart', 'nepse-screener', 'nepse-trending',
  'nepse-value', 'nepse-news', 'nepse-sectors', 'nepse-reports', 'nepse-simulator',
];
const MOUNT = '<div class="fb-wrap" style="display:flex;justify-content:center;padding:10px 16px 0"><div data-freshness-badge></div></div>';
const SCRIPT = '<script src="/js/freshness-badge.js" defer></script>';

let changed = 0;
for (const page of PAGES) {
  const file = path.join(ROOT, page, 'index.html');
  if (!fs.existsSync(file)) { console.log(`skip ${page}: no index.html`); continue; }
  let html = fs.readFileSync(file, 'utf8');
  let updated = false;

  // 1. kill hardcoded session spans like <span class="snap-asof">· session 2026-09-30</span>
  const hardSpan = html.match(/<span class="snap-asof">[^<]*session \d{4}-\d{2}-\d{2}[^<]*<\/span>/);
  if (hardSpan) {
    html = html.replace(hardSpan[0], '<div data-freshness-badge style="display:inline-flex"></div>');
    updated = true;
    console.log(`${page}: replaced hardcoded session span with badge mount`);
  }

  // 2. mount after topbar </header>, else after <body...>
  if (!html.includes('data-freshness-badge')) {
    const headerClose = html.indexOf('</header>');
    const bodyOpen = html.match(/<body[^>]*>/);
    if (headerClose !== -1) {
      html = html.slice(0, headerClose + 9) + '\n' + MOUNT + html.slice(headerClose + 9);
    } else if (bodyOpen) {
      const at = html.indexOf(bodyOpen[0]) + bodyOpen[0].length;
      html = html.slice(0, at) + '\n' + MOUNT + html.slice(at);
    }
    updated = true;
    console.log(`${page}: inserted badge mount`);
  }

  // 3. script before </body>
  if (!html.includes('freshness-badge.js')) {
    html = html.replace('</body>', SCRIPT + '\n</body>');
    updated = true;
    console.log(`${page}: added badge script`);
  }

  if (updated) { fs.writeFileSync(file, html); changed++; }
}
console.log(changed ? `updated ${changed} page(s)` : 'all pages already have the badge');
