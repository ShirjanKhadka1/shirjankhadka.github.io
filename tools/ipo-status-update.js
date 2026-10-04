#!/usr/bin/env node
/* Nepse Decode — IPO status updater (V5).
 *
 * Daily: updates data/ipo.json entry statuses based on dates.
 *   - 'upcoming' → 'Open' when opening_date <= today <= closing_date
 *   - 'Open' → 'Closed' when closing_date < today
 *   - 'upcoming' stays if opening_date is in the future or unknown
 *
 * Also backfills units from SEBON prospectus text where the unit count
 * appears (e.g. "10,00,000 units"). Never invents data — null stays null.
 *
 * Run: node tools/ipo-status-update.js [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'ipo.json');
const DRY_RUN = process.argv.includes('--dry-run');

function todayNPT() {
  return new Date(Date.now() + (5 * 60 + 45) * 60000).toISOString().slice(0, 10);
}

function extractUnits(text) {
  // "10,00,000 units", "1,000,000 shares", "5 lakh units"
  const m = String(text || '').match(/([\d,]+)\s*(?:units|shares)/i);
  if (m) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const lakh = String(text || '').match(/([\d.]+)\s*lakh/i);
  if (lakh) {
    const n = Math.round(parseFloat(lakh[1]) * 100000);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const today = todayNPT();
  let updated = 0;

  for (const [cat, catData] of Object.entries(data.categories || {})) {
    for (const it of catData.items || []) {
      let changed = false;

      // Status transitions based on dates.
      const open = it.opening_date, close = it.closing_date;
      if (it.status === 'upcoming' && open && open <= today && (!close || close >= today)) {
        it.status = 'Open';
        changed = true;
      } else if ((it.status === 'Open' || it.status === 'upcoming') && close && close < today) {
        it.status = 'Closed';
        changed = true;
      }

      // Backfill units from notes/text if missing.
      if (!it.units) {
        const u = extractUnits(it.notes || '') || extractUnits(it.company || '');
        if (u) { it.units = u; changed = true; }
      }

      if (changed) {
        updated++;
        console.log(`[ipo-status] ${cat}/${it.symbol || it.company}: status=${it.status} units=${it.units || '?'}`);
      }
    }
  }

  if (updated > 0) {
    data.updated = today;
    if (!DRY_RUN) {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
      console.log(`[ipo-status] updated ${updated} entries`);
    } else {
      console.log(`[ipo-status] DRY RUN — would update ${updated} entries`);
    }
  } else {
    console.log('[ipo-status] no updates needed');
  }
}

if (require.main === module) main();
module.exports = { extractUnits };
