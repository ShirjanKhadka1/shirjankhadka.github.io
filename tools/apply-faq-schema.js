#!/usr/bin/env node
/* Wave E — FAQPage JSON-LD for blog posts that already carry a genuine
 * FAQ section but no schema.
 *
 * Detection is structural, never invented: a post qualifies only when it
 * has a "Frequently asked questions" heading followed by <details>
 * blocks whose <summary> is a real question (ends with '?') and whose
 * body is the answer. Questions and answers are copied verbatim from
 * the page (tags stripped, entities decoded) — nothing is reworded,
 * added, or dropped. Posts that already have FAQPage schema are skipped,
 * as is any post without this exact structure.
 *
 * The block is emitted in the site's existing house format (a separate
 * <script type="application/ld+json"> in <head>, 2-space pretty JSON),
 * matching posts like him-parbat-hydropower-ipo-explained.
 *
 * Idempotent: a second run changes nothing.
 * Usage: node tools/apply-faq-schema.js [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG = path.join(ROOT, 'blog');
const DRY = process.argv.includes('--dry-run');

const text = (s) => String(s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
  .replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

function extractFaq(html) {
  const head = html.match(/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i);
  if (!head) return null;
  const rest = html.slice(head.index + head[0].length);
  const nextH2 = rest.search(/<h2[\s>]/i);
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2);
  const pairs = [];
  for (const m of section.matchAll(/<details>([\s\S]*?)<\/details>/g)) {
    const sm = m[1].match(/<summary>([\s\S]*?)<\/summary>/);
    if (!sm) continue;
    const q = text(sm[1]);
    const body = m[1].slice(sm.index + sm[0].length);
    const a = text(body);
    if (q.endsWith('?') && a) pairs.push({ q, a });
  }
  return pairs.length >= 2 ? pairs : null;
}

function faqScript(pairs, indent) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a },
    })),
  };
  return indent + '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n' + indent + '</script>\n';
}

function main() {
  const slugs = fs.readdirSync(BLOG, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const report = [];
  for (const slug of slugs) {
    const file = path.join(BLOG, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    let html = fs.readFileSync(file, 'utf8');
    if (html.includes('"FAQPage"')) continue;
    const pairs = extractFaq(html);
    if (!pairs) continue;
    /* Insert after the last ld+json script inside <head>, reusing its
     * indentation — the same position the house format uses. */
    const headEnd = html.indexOf('</head>');
    const headPart = html.slice(0, headEnd);
    const scripts = [...headPart.matchAll(/([ \t]*)<script type="application\/ld\+json">[\s\S]*?<\/script>\n/g)];
    if (!scripts.length) { report.push(slug + ': NO head ld script — skipped'); continue; }
    const last = scripts[scripts.length - 1];
    const at = last.index + last[0].length;
    html = html.slice(0, at) + faqScript(pairs, last[1]) + html.slice(at);
    if (!DRY) fs.writeFileSync(file, html);
    report.push(slug + ': ' + pairs.length + ' Q&A added');
  }
  console.log(JSON.stringify({ dryRun: DRY, processed: report }, null, 1));
}

main();
