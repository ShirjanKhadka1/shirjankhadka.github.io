#!/usr/bin/env node
/* Nepse Decode — stamp a book-close date onto a corporate-actions.json item.
 *
 * Called by the approval feed after a book-closure notice is verified against
 * the official NEPSE PDF: the book-close date belongs to the dividend/bonus
 * declaration it closes, so this finds the most recent dividend/bonus-share
 * item for the symbol that still lacks a bookclose_date and stamps it.
 *
 * Usage: node tools/set-action-bookclose.js SYMBOL YYYY-MM-DD
 *
 * Dates are never invented — the caller passes the date read from the
 * verified official notice. Exits 2 when no matching open item exists.
 * Matches dividend/bonus-share/right-share items (book closes apply to
 * rights entitlements too).
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'nepse-chart', 'data', 'corporate-actions.json');

function main() {
  const sym = String(process.argv[2] || '').toUpperCase().trim();
  const date = String(process.argv[3] || '').slice(0, 10);
  if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: node tools/set-action-bookclose.js SYMBOL YYYY-MM-DD');
    process.exit(1);
  }
  let store;
  try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch (e) { console.error('set-action-bookclose: cannot read corporate-actions.json'); process.exit(1); }
  const items = store.items || [];
  let best = -1, bestAnn = '';
  items.forEach((it, i) => {
    if (String(it.symbol || '').toUpperCase() !== sym) return;
    if (!/^(dividend|bonus-share|right-share)$/.test(String(it.kind || ''))) return;
    if (it.bookclose_date && String(it.bookclose_date).trim() !== '') return;
    const ann = String(it.announced || '');
    if (best < 0 || ann >= bestAnn) { best = i; bestAnn = ann; }
  });
  if (best < 0) {
    console.error(`set-action-bookclose: no open dividend/bonus item for ${sym}`);
    process.exit(2);
  }
  items[best].bookclose_date = date;
  store.updated = new Date().toISOString();
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
  console.log(JSON.stringify({
    ok: true, symbol: sym, bookclose_date: date,
    item: String(items[best].headline || '').slice(0, 80),
  }));
}

main();
