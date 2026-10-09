#!/usr/bin/env node
/* Nepse Decode — IPO lifecycle tracker (V5).
 *
 * Owner directive 2026-10-04: track every IPO/FPO from announcement through
 * close, with the Nepal-specific allocation order:
 *
 *   1. SEBON approval → status 'upcoming' (no dates yet)
 *   2. Local affected people phase → status 'local-open'
 *   3. Foreign employment phase → status 'foreign-open'
 *   4. General public phase → status 'open'
 *   5. Closing date passes → status 'closed'
 *
 * Sources (all official or openly permitted):
 *   - SEBON prospectus listings → upcoming (tools/ipo-sebon-watch.js)
 *   - ShareSansar /announcement (mirrors NEPSE disclosures) → phase notices
 *     with opening/closing dates, units, issue manager
 *   - NEPSE official notices → authoritative dates (via announcement URLs)
 *
 * Never invents: dates, units, and managers come from the notice text or
 * stay null. Status transitions are date-driven and deterministic.
 *
 * Run: node tools/ipo-lifecycle.js [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const IPO_PATH = path.join(ROOT, 'data', 'ipo.json');
const ANN_PATH = path.join(ROOT, 'nepse-chart', 'data', 'announcements.json');
const UA = { 'User-Agent': 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)' };
const DRY_RUN = process.argv.includes('--dry-run');

// Phase keywords in Nepali + English announcement titles.
const PHASES = [
  { phase: 'local-open', re: /local|affected|project.affected|आयोजना प्रभावित|स्थानीय/i },
  { phase: 'foreign-open', re: /foreign|employment|abroad|वैदेशिक|रोजगार/i },
  { phase: 'open', re: /general public|public issue|ipo open|सर्वसाधारण/i },
];

function todayNPT() {
  return new Date(Date.now() + (5 * 60 + 45) * 60000).toISOString().slice(0, 10);
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: UA, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 3e6) res.destroy(); });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Extract ISO dates from text (YYYY-MM-DD or "Oct 15, 2026" or BS dates).
function extractDates(text) {
  const dates = [];
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/g) || [];
  dates.push(...iso);
  // "October 15, 2026" / "Oct 15, 2026"
  const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const md = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})/gi) || [];
  for (const m of md) {
    const p = m.replace(/,/g, '').split(/\s+/);
    const mo = months[p[0].toLowerCase().slice(0, 3)] || months[p[0].toLowerCase()];
    if (mo) dates.push(`${p[2]}-${mo}-${String(p[1]).padStart(2, '0')}`);
  }
  return [...new Set(dates)].sort();
}

// Normalize a single date match (ISO or "Oct 15, 2026") to YYYY-MM-DD.
function normDateStr(m) {
  const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const iso = m.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return m;
  const p = m.replace(/,/g, '').split(/\s+/);
  const key = p[0].toLowerCase();
  const mo = months[key] || months[key.slice(0, 3)];
  if (mo && /^\d{4}$/.test(p[2]) && /^\d{1,2}$/.test(p[1])) {
    return `${p[2]}-${mo}-${String(p[1]).padStart(2, '0')}`;
  }
  return null;
}

// Keyword-anchored date extraction (2026-10-09 fix): only accept a date when
// the notice text explicitly ties it to an opening or closing event.
// Incidental dates (notice publish date, SEBON approval date) are ignored —
// an unanchored date stays null rather than risking an invented schedule.
const OPEN_CTX = /(?:open(?:s|ed|ing)?|खुला|खुल्ने|सुरु|शुरू)/i;
const CLOSE_CTX = /(?:clos(?:e|es|ed|ing)?|deadline|last date|बन्द|समाप्त|अन्तिम मिति)/i;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}/gi;

function extractOpenClose(text) {
  const t = String(text || '');
  let opening = null, closing = null;
  let m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(t)) !== null) {
    const iso = normDateStr(m[0]);
    if (!iso) continue;
    const ctx = t.slice(Math.max(0, m.index - 160), m.index).toLowerCase();
    const isClose = CLOSE_CTX.test(ctx);
    const isOpen = OPEN_CTX.test(ctx);
    if (isClose) { closing = iso; continue; } // last anchored close wins
    if (isOpen && !opening) { opening = iso; } // first anchored open wins
  }
  return { opening, closing };
}

// Keyword-anchored unit extraction: the "N units/shares" figure must sit near
// an issue/offering reference, otherwise it is left null.
const UNITS_CTX = /(?:issue|offering|offer|ipo|fpo|निष्काशन|units? (?:of|for)|shares? (?:of|for))/i;
function extractUnitsAnchored(text) {
  const t = String(text || '');
  const re = /([\d,]+)\s*(?:units|shares|kittas?)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(n) || n <= 100) continue;
    const ctx = t.slice(Math.max(0, m.index - 80), m.index + m[0].length);
    if (UNITS_CTX.test(ctx)) return n;
  }
  return null;
}

function extractUnits(text) {
  // Legacy loose matcher (kept for export-compat); prefer extractUnitsAnchored.
  const m = String(text).match(/([\d,]+)\s*(?:units|shares|kittas?)/i);
  if (m) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 100) return n;
  }
  return null;
}

function detectPhase(title) {
  for (const { phase, re } of PHASES) {
    if (re.test(title)) return phase;
  }
  return null;
}

function findCompany(text, items) {
  // Match against known IPO companies in our file.
  const t = text.toLowerCase();
  for (const it of items) {
    const c = String(it.company || '').toLowerCase();
    if (c.length > 5 && t.includes(c.slice(0, Math.min(20, c.length)))) return it;
  }
  return null;
}

async function main() {
  console.log('[ipo-lifecycle] starting...');
  const ipo = JSON.parse(fs.readFileSync(IPO_PATH, 'utf8'));
  const ann = JSON.parse(fs.readFileSync(ANN_PATH, 'utf8'));
  const announcements = ann.items || (Array.isArray(ann) ? ann : []);
  const today = todayNPT();

  // Flatten all IPO items for matching.
  const allItems = [];
  for (const [cat, catData] of Object.entries(ipo.categories || {})) {
    for (const it of catData.items || []) {
      allItems.push({ ...it, _cat: cat });
    }
  }

  let updated = 0;

  // Scan announcements for IPO phase notices.
  for (const a of announcements) {
    const title = a.title || '';
    if (!/ipo|fpo|public issue|सार्वजनिक/i.test(title)) continue;

    const phase = detectPhase(title);
    if (!phase) continue;

    const item = findCompany(title, allItems);
    if (!item) {
      console.log(`[ipo-lifecycle] unmatched IPO notice: ${title.slice(0, 60)}`);
      continue;
    }

    // Fetch the notice detail for dates (if URL available).
    let detailText = title;
    if (a.url) {
      try {
        detailText += ' ' + await fetch(a.url);
        await new Promise((r) => setTimeout(r, 1500)); // polite
      } catch (e) { /* detail fetch optional */ }
    }

    // Dates/units are keyword-anchored: only set when the notice text
    // explicitly ties them to opening/closing. Unanchored = stays null.
    const { opening, closing } = extractOpenClose(detailText);
    const units = extractUnitsAnchored(detailText);

    // Update the item in place.
    const catItems = ipo.categories[item._cat].items;
    const idx = catItems.findIndex((x) => x === item || x.symbol === item.symbol);
    const target = idx >= 0 ? catItems[idx] : null;
    if (!target) continue;

    let changed = false;
    // Phase progression: upcoming → local-open → foreign-open → open.
    // Never regress a phase (e.g. don't move open back to local-open).
    const order = ['upcoming', 'local-open', 'foreign-open', 'open', 'closed'];
    const curIdx = order.indexOf(target.status);
    const newIdx = order.indexOf(phase);
    if (newIdx > curIdx) {
      target.status = phase;
      changed = true;
      console.log(`[ipo-lifecycle] ${target.symbol}: ${order[curIdx]} → ${phase}`);
    }
    if (opening && !target.opening_date) { target.opening_date = opening; changed = true; }
    if (closing && !target.closing_date) { target.closing_date = closing; changed = true; }
    if (units && !target.units) { target.units = units; changed = true; }

    if (changed) updated++;
  }

  // Date-driven transitions: any open phase → closed when closing_date passes.
  for (const [cat, catData] of Object.entries(ipo.categories || {})) {
    for (const it of catData.items || []) {
      if (['local-open', 'foreign-open', 'open'].includes(it.status) &&
          it.closing_date && it.closing_date < today) {
        const prev = it.status;
        it.status = 'closed';
        updated++;
        console.log(`[ipo-lifecycle] ${it.symbol}: ${prev} → closed (past ${it.closing_date})`);
      }
    }
  }

  if (updated > 0) {
    ipo.updated = today;
    if (!DRY_RUN) {
      fs.writeFileSync(IPO_PATH, JSON.stringify(ipo, null, 2) + '\n');
      console.log(`[ipo-lifecycle] wrote ${updated} updates`);
    } else {
      console.log(`[ipo-lifecycle] DRY RUN — would update ${updated}`);
    }
  } else {
    console.log('[ipo-lifecycle] no updates');
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[ipo-lifecycle] FATAL: ' + e.message); process.exit(1); });
}
module.exports = { detectPhase, extractDates, extractUnits, extractOpenClose, extractUnitsAnchored };
