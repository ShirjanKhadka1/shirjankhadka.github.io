#!/usr/bin/env node
/* Nepse Decode — sitemap refresh.
 *
 * Preserves every existing <url> entry in sitemap.xml (blog posts, tools,
 * homepage) and (re)adds the Wave 8 generated URLs: all /stocks/{SYM}/
 * pages, /stocks/ itself and /nepse-actions/. Generated entries use the
 * batch asof date as lastmod, changefreq weekly, priority 0.6 (0.7 for
 * the two index pages).
 *
 * Idempotent: re-running replaces the generated block, never duplicates.
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SM = path.join(ROOT, 'sitemap.xml');
const SITE = 'https://shirjankhadka.com.np';
const GEN_OPEN = '  <!-- WAVE8-GENERATED-START -->';
const GEN_CLOSE = '  <!-- WAVE8-GENERATED-END -->';

const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

function main() {
  let xml = fs.readFileSync(SM, 'utf8');
  // Strip any previous generated block.
  const re = new RegExp(GEN_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + GEN_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?');
  xml = xml.replace(re, '');

  const universe = loadJson(path.join(ROOT, 'nepse-chart', 'data', 'universe.json'), null);
  const ver = loadJson(path.join(ROOT, 'nepse-chart', 'data', 'verdicts.json'), null);
  const asof = (ver && ver.asof) || (universe && universe.asof) || new Date().toISOString().slice(0, 10);
  const symbols = (universe && universe.symbols) || [];

  const lines = [GEN_OPEN];
  const url = (loc, lastmod, freq, pri) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
  lines.push(url(`${SITE}/stocks/`, asof, 'weekly', '0.7'));
  lines.push(url(`${SITE}/nepse-actions/`, asof, 'daily', '0.7'));
  const slug = (s) => String(s).replace(/\//g, '-');
  const sorted = symbols.map((u) => u.s).sort();
  for (const s of sorted) lines.push(url(`${SITE}/stocks/${slug(s)}/`, asof, 'weekly', '0.6'));
  lines.push(GEN_CLOSE);

  xml = xml.replace(/<\/urlset>/, lines.join('\n') + '\n</urlset>');
  fs.writeFileSync(SM, xml);
  console.log(JSON.stringify({ stockUrls: sorted.length, lastmod: asof }));
}

main();
