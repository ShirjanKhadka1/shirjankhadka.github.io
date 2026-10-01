#!/usr/bin/env node
/**
 * tests/link-check.js — internal link integrity, zero tolerance.
 *
 * Walks every *.html file, resolves every same-origin href/src, and fails
 * (exit 1) on any target that does not exist in the tree. External URLs,
 * mailto:/tel:, fragments and javascript: are skipped (external rot is
 * covered by the SEO watch, not CI).
 *
 * Run from the repo root: node tests/link-check.js
 *
 * Cloudflare's /cdn-cgi/ email-protection artifacts (l/email-protection,
 * email-decode.min.js) are skipped: they are CDN serve-time infrastructure,
 * never repo files, and must not fail the build when a publishing step
 * bakes CF-processed HTML into the tree.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (rel.split(path.sep)[0] && SKIP_DIRS.has(rel.split(path.sep)[0])) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.html') && !e.name.includes('template')) out.push(full);
  }
  return out;
}

function targetsOf(html) {
  const out = [];
  const re = /(?:href|src)\s*=\s*["']([^"'#]+)(?:#[^"']*)?["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1].trim();
    if (!u) continue;
    if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(u)) continue;
    if (u.startsWith('/cdn-cgi/')) continue; // Cloudflare serve-time artifacts
    out.push(u);
  }
  return out;
}

function resolveTarget(fromFile, u) {
  // strip query string
  u = u.split('?')[0];
  if (!u) return null;
  let p;
  if (u.startsWith('/')) p = path.join(ROOT, u);
  else p = path.resolve(path.dirname(fromFile), u);
  // normalize: never escape the repo
  const rel = path.relative(ROOT, p);
  if (rel.startsWith('..')) return null;
  const candidates = [p, p + '.html', path.join(p, 'index.html')];
  // extensionless clean URLs: /foo -> /foo/index.html is covered above
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return null; } catch (e) { /* not found */ }
  }
  return '/' + rel;
}

function main() {
  const files = walk(ROOT);
  const broken = [];
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    const rel = '/' + path.relative(ROOT, f);
    for (const u of targetsOf(html)) {
      const miss = resolveTarget(f, u);
      if (miss) broken.push(`${rel} -> ${u}`);
    }
  }
  console.log(`checked ${files.length} HTML files`);
  if (broken.length) {
    console.error(`BROKEN INTERNAL LINKS: ${broken.length}`);
    for (const b of broken.slice(0, 50)) console.error('  - ' + b);
    if (broken.length > 50) console.error(`  ... and ${broken.length - 50} more`);
    process.exit(1);
  }
  console.log('OK: zero broken internal links');
}

main();
