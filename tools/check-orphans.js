#!/usr/bin/env node
/* Wave E — orphan + sitemap integrity check.
 *
 * Method:
 *   1. Page set: every .html file in the tree (tests/ excluded), mapped
 *      to its served URL (dir/index.html -> /dir/, file.html -> /file.html).
 *   2. Inbound graph: every href in every page's static HTML, plus every
 *      '/path/' literal in the site's JS (the shared chrome, js/
 *      nd-chrome.js, renders nav/footer links client-side — a static
 *      HTML-only crawl would falsely orphan every tool page).
 *   3. Orphan = a page with no inbound link from any other page or JS
 *      file (the homepage is exempt as the root entry point).
 *   4. Sitemap cross-check: every sitemap.xml <loc> must map to a real
 *      file (no phantoms); every page file should be listed unless it
 *      excludes itself by design — detected from the file itself:
 *      a noindex robots meta, a meta-refresh redirect stub, or a build
 *      template (path contains 'article-template').
 *
 * Exit 1 when: any blog post or stock page is orphaned, any sitemap URL
 * is a phantom, or any page is missing from the sitemap without a
 * by-design reason. Run from the repo root: node tools/check-orphans.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://shirjankhadka.com.np';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const pages = new Map(); // url -> rel file
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (!rel.endsWith('.html') || rel.startsWith('tests/') || rel.startsWith('includes/')) continue;
  const url = rel === 'index.html' ? '/' : rel.replace(/\/index\.html$/, '/').replace(/^([^/])/, '/$1');
  pages.set(url.startsWith('/') ? url : '/' + url, rel);
}

const inbound = new Map(); // url -> Set of source urls/files
function addEdge(target, source) {
  const t = target.split('#')[0].split('?')[0];
  if (!t || t === source) return;
  if (!inbound.has(t)) inbound.set(t, new Set());
  inbound.get(t).add(source);
}
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (rel.startsWith('tests/')) continue;
  const src = pages.get('/' + rel.replace(/\/index\.html$/, '/').replace(/^index\.html$/, '')) || rel;
  if (rel.endsWith('.html')) {
    const html = fs.readFileSync(f, 'utf8');
    /* Root-relative and absolute same-origin hrefs (canonical/hreflang
     * links are absolute and are real discovery paths). */
    for (const m of html.matchAll(/href="(?:https:\/\/shirjankhadka\.com\.np)?(\/[^"]*)"/g)) addEdge(m[1], src);
  } else if (rel.endsWith('.js')) {
    const js = fs.readFileSync(f, 'utf8');
    for (const m of js.matchAll(/["'`](\/[a-z0-9\-\/]*\/)["'`]/gi)) addEdge(m[1], rel);
  }
}

const orphans = [];
for (const [url, rel] of pages) {
  if (url === '/') continue;
  if (!inbound.has(url)) orphans.push({ url, rel });
}

/* Sitemap cross-check. */
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const smUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, ''));
const phantoms = smUrls.filter((u) => !pages.has(u.endsWith('/') || u === '' ? (u || '/') : u));
function designReason(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (/name="robots" content="[^"]*noindex/i.test(html)) return 'noindex by design';
  if (/http-equiv="refresh"/i.test(html)) return 'meta-refresh redirect stub';
  if (rel.includes('article-template')) return 'build template, not a page';
  return null;
}
const missing = [];
for (const [url, rel] of pages) {
  if (!smUrls.includes(url)) missing.push({ url, rel, reason: designReason(rel) });
}
const unexplained = missing.filter((m) => !m.reason);

const blogOrphans = orphans.filter((o) => o.url.startsWith('/blog/'));
const stockOrphans = orphans.filter((o) => o.url.startsWith('/stocks/'));
console.log(JSON.stringify({
  pages: pages.size,
  orphans: orphans.map((o) => ({ url: o.url, reason: designReason(o.rel) })),
  blogOrphans: blogOrphans.map((o) => o.url),
  stockOrphans: stockOrphans.map((o) => o.url),
  sitemapUrls: smUrls.length,
  phantoms,
  missingFromSitemap: missing,
}, null, 1));
const fail = blogOrphans.length || stockOrphans.length || phantoms.length || unexplained.length;
console.log(fail ? 'CHECK: FAIL' : 'CHECK: PASS (blog/stock orphans 0, phantoms 0, sitemap gaps all by-design)');
process.exit(fail ? 1 : 0);
