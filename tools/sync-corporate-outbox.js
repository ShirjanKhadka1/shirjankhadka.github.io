#!/usr/bin/env node
/* Nepse Decode - corporate-action outbox sync (one-way, VM-side).
 *
 * The Facebook breaking-news watcher (share-sanket/dividend-watch.js)
 * records every PUBLISHED + officially-PDF-verified corporate action to
 *   ~/workspace/goals/sharesanket-page-growth/hidden_files/corporate-actions-outbox.json
 * GitHub Actions cannot read that path, so this script merges any new
 * outbox records into the repo's durable archive
 *   nepse-chart/data/corporate-actions.json
 * before publishing. Dedup is by storyKey, so re-running is safe and the
 * daily portal collector never double-adds what this sync already merged.
 *
 * Run: node tools/sync-corporate-outbox.js
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'nepse-chart', 'data', 'corporate-actions.json');
const OUTBOX = '/home/hatch/workspace/goals/sharesanket-page-growth/hidden_files/corporate-actions-outbox.json';

function loadJson(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fb; }
}

function main() {
  const outbox = loadJson(OUTBOX, []);
  if (!outbox.length) {
    console.log(JSON.stringify({ added: 0, reason: 'outbox empty or missing' }));
    return;
  }
  const store = loadJson(STORE, null);
  if (!store || !Array.isArray(store.items)) {
    console.error('sync: archive store missing or malformed:', STORE);
    process.exit(1);
  }
  const known = new Set(store.items.map((i) => i.storyKey));
  let added = 0;
  for (const r of outbox) {
    if (!r || !r.kind || !r.headline || !r.officialPdf) continue;
    const sk = r.storyKey || (r.symbol ? r.kind + '|' + r.symbol : null);
    if (!sk || known.has(sk)) continue;
    store.items.push({
      kind: r.kind,
      symbol: r.symbol || null,
      company: r.company || null,
      headline: r.headline,
      announced: r.announced || String(r.recordedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      officialPdf: r.officialPdf,
      source: r.source || 'NEPSE disclosure',
      sourceUrl: r.sourceUrl || null,
      facts: r.facts || {},
      seenKey: null,
      storyKey: sk,
      verifiedAt: r.recordedAt || new Date().toISOString(),
    });
    known.add(sk);
    added++;
    console.log('SYNCED', r.kind, r.symbol || '-', String(r.headline).slice(0, 60));
  }
  if (added) {
    store.items.sort((a, b) => String(b.announced).localeCompare(String(a.announced)));
    store.updated = new Date().toISOString();
    store.count = store.items.length;
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
  }
  console.log(JSON.stringify({ added, total: store.items.length }));
}

main();
