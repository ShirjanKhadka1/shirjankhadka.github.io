#!/usr/bin/env node
/* Nepse Decode — extract newly published quarterly/annual reports from the
 * company-website monitor's news items into the quarterly pending queue.
 *
 * The company-website monitor detects new PDFs on company IR pages and merges
 * them into news.json with src="Company website". This script scans those
 * items for quarterly/annual-report publications and appends them to the
 * pending queue consumed by the nepse-quarterly-processor cron, which imports
 * the new quarter's figures into quarterly.json and rebuilds the stock page.
 *
 * Usage:
 *   node tools/extract-quarterly-pending.js <news.json> <pending.json>
 * Prints JSON: { "added": [<symbols>], "pending_total": <n> }
 *
 * A doc counts as a quarterly/annual report when its title carries a strong
 * report signal (quarterly, unaudited, annual report, Q1-Q4, ...) and NOT a
 * corporate-action signal (dividend/bonus/right/agm/promoter/auction/book
 * close) — those belong to the dividend-watch pipeline, not the quarterly
 * figures pipeline.
 */
'use strict';
const fs = require('fs');

const REPORT_RE = /quarterly|traimasik|त्रैमासिक|unaudited|financial results|annual report|वार्षिक प्रतिवेदन|\bq[1-4]\b|first quarter|second quarter|third quarter|fourth quarter|qtr/i;
const ACTION_RE = /dividend|bonus|right ?share|hakprad|हकप्रद|agm|annual general|साधारण सभा|promoter|auction|लिलाम|book ?clos/i;

function isQuarterlyReport(title) {
  const t = String(title || '');
  return REPORT_RE.test(t) && !ACTION_RE.test(t);
}

function main() {
  const [newsPath, pendingPath] = process.argv.slice(2);
  if (!newsPath || !pendingPath) {
    console.error('Usage: extract-quarterly-pending.js <news.json> <pending.json>');
    process.exit(1);
  }
  const news = JSON.parse(fs.readFileSync(newsPath, 'utf8'));
  const items = news.items || news || [];
  let pending = [];
  try { pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8')); } catch { /* first run */ }
  if (!Array.isArray(pending)) pending = [];
  const seen = new Set(pending.map((p) => p.link).filter(Boolean));
  const added = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const it of items) {
    if (String(it.src || '') !== 'Company website') continue;
    if (!it.link || seen.has(it.link)) continue;
    if (!isQuarterlyReport(it.title)) continue;
    const sym = String(it.sym || '').toUpperCase().trim();
    if (!sym) continue;
    pending.push({
      symbol: sym,
      title: String(it.title || ''),
      link: it.link,
      detected_at: today,
      status: 'pending',
      attempts: 0,
    });
    seen.add(it.link);
    added.push(sym);
  }
  fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 1));
  console.log(JSON.stringify({ added, pending_total: pending.length }));
}

main();
