#!/usr/bin/env node
/* Nepse Decode — NEPSE Calendar events builder (single source of truth).
 *
 * Assembles data/calendar-events.json from OUR records only:
 *   - market closures .... tools/calendar-holidays-seed.json (curated seed)
 *   - promoter lock-ins .. data/lockin.json (allotment + 3y SEBON lock-in)
 *                          cross-checked against data/verdicts-v2-summary.json
 *                          PROMOTER lock-ins ONLY — no MF/QII lock-in data
 *                          exists in our records, so none is published.
 *   - issue open/close ... data/ipo.json (SEBON-approved issue tracker)
 *   - dividend/book close  nepse-chart/data/div-live.json (recorded archive)
 *   - AGM + other actions  nepse-chart/data/corporate-actions.json + AGM
 *                          dates stated inside div-live officialPdf notes
 *
 * The same build REGENERATES the machine holiday files the pipeline gates
 * read, so every gate consumes one authoritative list:
 *   - tools/nepse-holidays.json          (repo, V3 schema — format unchanged)
 *   - nepse-holidays.txt                 (only with --archive-dir; the file
 *     at ~/workspace/nepse-data-archive/nepse-holidays.txt, format unchanged)
 * With --archive-dir DIR it also drops an archived copy of the events JSON
 * at DIR/calendar-events.json.
 *
 * Usage: node tools/build-calendar-events.js [--archive-dir DIR] [--check]
 *   --check: build in memory and validate only; write nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { adToBs } = require('./bs-convert');

const ROOT = path.join(__dirname, '..');
const load = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; } };
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const archIdx = args.indexOf('--archive-dir');
const ARCHIVE_DIR = archIdx >= 0 ? args[archIdx + 1] : null;

const warnings = [];
const warn = (m) => { warnings.push(m); console.log('  WARN: ' + m); };

const events = [];
const seen = new Set();
function add(ev) {
  if (!ev.date_ad || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date_ad)) { warn('bad date skipped: ' + JSON.stringify(ev)); return; }
  const dow = new Date(ev.date_ad + 'T00:00:00Z').getUTCDay();
  ev.date_bs = adToBs(ev.date_ad);
  ev.symbol = ev.symbol || null;
  ev.units = (ev.units === undefined ? null : ev.units);
  ev.detail = ev.detail || null;
  ev.weekend = (dow === 0 || dow === 6);
  const key = [ev.date_ad, ev.type, ev.symbol || '', ev.title].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  events.push(ev);
}

/* ---------- 1. Market closures (seed) ---------- */
const seed = load(path.join(ROOT, 'tools', 'calendar-holidays-seed.json'), null);
if (!seed) { console.error('FATAL: tools/calendar-holidays-seed.json missing/unreadable'); process.exit(1); }
for (const c of seed.closures) {
  add({
    date_ad: c.date_ad,
    type: c.kind === 'nepse_closed' ? 'nepse_closed' : 'public_holiday',
    title: c.name,
    source: c.source,
    verified: c.status === 'verified',
  });
}

/* ---------- 2. Promoter lock-in expiries ---------- */
const lockin = load(path.join(ROOT, 'data', 'lockin.json'), { rows: {} });
const verdictsDoc = load(path.join(ROOT, 'data', 'verdicts-v2-summary.json'), { verdicts: {} });
const verdicts = verdictsDoc.verdicts || {};
const lockEventsBySymbol = new Map(); // symbol -> event object (mutable for upgrades)

const skippedLockin = [];
for (const [sym, r] of Object.entries(lockin.rows || {})) {
  if (!r.lockin_end_ad) { skippedLockin.push(sym); continue; }
  const ev = {
    date_ad: r.lockin_end_ad,
    type: 'lock_in_expiry',
    title: `${sym} — promoter lock-in expires`,
    symbol: sym,
    // Units deliberately omitted: the share counts in lockin.json were
    // transcribed from a third-party terminal table whose republication
    // clearance is still pending (see lockin.json _meta.tos_status).
    units: null,
    detail: `Promoter shares of ${sym} complete the 3-year SEBON lock-in (allotted ${r.allotment_ad || 'n/a'}) and become tradable. Derived date — allotment + 3 years.`,
    source: 'Derived: IPO allotment date + 3-year SEBON promoter lock-in (allotment records held by Nepse Decode, captured 2026-10-05)',
    verified: false,
  };
  lockEventsBySymbol.set(sym, ev);
}
/* Cross-check / upgrade with the verdict engine's dated lock-in fields. */
for (const [sym, v] of Object.entries(verdicts)) {
  const lk = v && v.lockin;
  if (!lk || !lk.expiry) continue;
  const held = lockEventsBySymbol.get(sym);
  if (!held) {
    const ev = {
      date_ad: lk.expiry, type: 'lock_in_expiry',
      title: `${sym} — promoter lock-in expires`, symbol: sym, units: null,
      detail: `Promoter lock-in expiry held in the verdict engine's lock-in table.`,
      source: 'Verdicts lock-in table (' + (lk.source || 'lockin-table') + ')',
      verified: lk.source === 'user-verified',
    };
    lockEventsBySymbol.set(sym, ev);
    continue;
  }
  if (held.date_ad !== lk.expiry) {
    warn(`lock-in date mismatch for ${sym}: lockin.json=${held.date_ad} vs verdicts=${lk.expiry} — verdicts value kept`);
    held.date_ad = lk.expiry;
  }
  if (lk.source === 'user-verified') {
    held.verified = true;
    held.source = 'Lock-in expiry verified against the official notice (user-verified, verdicts lock-in table)';
    held.detail = `Promoter lock-in expiry for ${sym}, verified against the official notice.`;
  }
}
if (skippedLockin.length) console.log(`  note: ${skippedLockin.length} lockin.json rows carry no allotment/lock-in dates (empty placeholders, status Open) — skipped: ${skippedLockin.join(', ')}`);
for (const ev of lockEventsBySymbol.values()) add(ev);

/* Lock-in RELEASE notices in the corporate-actions archive are separate
 * facts (they can cover a single tranche — e.g. TPKHL's Oct 2026 release
 * notice while its promoter lock-in runs to 2029). Always added standalone,
 * never superseding the promoter expiry above. */
const corp = load(path.join(ROOT, 'nepse-chart', 'data', 'corporate-actions.json'), { items: [] });
for (const it of corp.items || []) {
  if (it.kind === 'promoter-share' && /lock[\s-]?in/i.test(it.headline || '')) {
    add({
      date_ad: it.announced, type: 'lock_in_expiry',
      title: `${it.symbol} — lock-in release notice`,
      symbol: it.symbol, units: null,
      detail: `Official lock-in release notice published ${it.announced}. A release notice can cover a specific tranche; the promoter lock-in expiry is listed separately.`,
      source: it.source || 'Official notice (corporate-actions archive)',
      verified: true,
    });
  } else if (it.kind === 'right-share' || it.kind === 'bonus-share') {
    add({
      date_ad: it.announced, type: 'other_event',
      title: it.headline, symbol: it.symbol, units: null,
      detail: `Recorded corporate action (${it.kind}), announced ${it.announced}.`,
      source: it.source || 'Official notice (corporate-actions archive)',
      verified: true,
    });
  }
  /* kind 'dividend' and promoter-sale notices are covered elsewhere / are
   * not calendar events (a sale intention has no fixed calendar date). */
}

/* ---------- 3. Issue opens / closes (IPO tracker) ---------- */
const ipo = load(path.join(ROOT, 'data', 'ipo.json'), { categories: {} });
const openKeys = new Set();
const ipoItems = [];
for (const [cat, c] of Object.entries(ipo.categories || {})) {
  for (const it of c.items || []) ipoItems.push({ cat, label: c.label || cat, it });
}
/* The umbrella 'ipo' category duplicates its own tranche categories
 * (foreign-ipo / local-ipo) for the same symbol+date — drop the umbrella. */
function isUmbrellaDup(e) {
  if (e.cat !== 'ipo' || !e.it.opening_date) return false;
  return ipoItems.some(o => o !== e && o.cat !== 'ipo' && o.it.symbol === e.it.symbol && o.it.opening_date === e.it.opening_date);
}
for (const e of ipoItems) {
  const it = e.it;
  if (isUmbrellaDup(e)) continue;
  const name = it.company || it.symbol;
  if (it.opening_date) {
    const key = it.symbol + '|open|' + it.opening_date + '|' + e.cat;
    if (!openKeys.has(key)) {
      openKeys.add(key);
      add({
        date_ad: it.opening_date, type: 'issue_opens',
        title: `${it.symbol} — ${e.label} opens`,
        symbol: it.symbol, units: it.units || it.auction_units || null,
        detail: `${name}: ${e.label} opens for subscription. Issue manager: ${it.issue_manager || 'n/a'}.`,
        source: it.source || 'SEBON IPO approved list (Nepse Decode issue tracker)',
        verified: !!it.verified_date,
      });
    }
  }
  if (it.closing_date) {
    add({
      date_ad: it.closing_date, type: 'issue_closes',
      title: `${it.symbol} — ${e.label} closes`,
      symbol: it.symbol, units: it.units || it.auction_units || null,
      detail: `${name}: last day of the ${e.label} subscription window (per the issue notice; issues can close early on full subscription).`,
      source: it.source || 'SEBON IPO approved list (Nepse Decode issue tracker)',
      verified: !!it.verified_date,
    });
  }
}

/* ---------- 4. Dividends, book closes, AGMs (div-live archive) ---------- */
const divLive = load(path.join(ROOT, 'nepse-chart', 'data', 'div-live.json'), { companies: {} });
for (const [sym, entries] of Object.entries(divLive.companies || {})) {
  for (const e of entries) {
    const total = e.total_dividend;
    if (e.announcement_date) {
      add({
        date_ad: e.announcement_date, type: 'dividend',
        title: `${sym} — dividend proposed: ${total}% (FY ${e.year})`,
        symbol: sym, units: null,
        detail: `Bonus share ${e.bonus_share}% + cash dividend ${e.cash_dividend}% = ${total}% total for FY ${e.year}, as recorded from the official disclosure.`,
        source: 'Official NEPSE/company disclosure (div-live archive)',
        verified: true,
      });
    }
    if (e.bookclose_date) {
      add({
        date_ad: e.bookclose_date, type: 'book_close',
        title: `${sym} — book close (FY ${e.year})`,
        symbol: sym, units: null,
        detail: `Book closure for the FY ${e.year} dividend/AGM: shareholders on the register at this date are eligible.`,
        source: 'Official NEPSE/company disclosure (div-live archive)',
        verified: true,
      });
    }
    /* AGM dates are stated in free text inside some officialPdf notes,
     * e.g. "8th AGM Mangsir 3, 2083 (2026-11-19)". Parse the AD date in
     * parentheses — deterministic, straight from our recorded note. */
    const pdf = e.officialPdf || '';
    const agm = /AGM[^()]*\((\d{4}-\d{2}-\d{2})\)/.exec(pdf);
    if (agm) {
      add({
        date_ad: agm[1], type: 'agm',
        title: `${sym} — Annual General Meeting`,
        symbol: sym, units: null,
        detail: `AGM date as stated in the company's official notice recorded in the dividend archive (FY ${e.year}).`,
        source: 'Official company AGM notice (div-live archive)',
        verified: true,
      });
    }
  }
}

/* ---------- assemble + validate ---------- */
events.sort((a, b) => a.date_ad < b.date_ad ? -1 : a.date_ad > b.date_ad ? 1 : (a.type < b.type ? -1 : 1));
const counts = {};
for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
const closures = events.filter(e => e.type === 'public_holiday' || e.type === 'nepse_closed');
const out = {
  generated_at: new Date().toISOString(),
  generator: 'tools/build-calendar-events.js',
  note: 'Nepse Decode market calendar. Sources: Nepal Gazette holiday lists and NEPSE closure confirmations (holidays), SEBON issue tracker (issues), official company disclosures recorded by Nepse Decode (dividends, book closes, AGMs), promoter lock-in expiries derived from IPO allotment dates + the 3-year SEBON lock-in. Unverified entries are labelled as such and confirmed against official notices as they appear.',
  counts,
  date_range: events.length ? [events[0].date_ad, events[events.length - 1].date_ad] : [],
  events,
};

/* Holiday machine files share the closure set (weekend dates are the
 * standing weekend rule in the consumers, never file entries). */
const closureEntries = closures.filter(e => !e.weekend);
const seedByDate = new Map(seed.closures.map(c => [c.date_ad, c]));
const holJson = (() => {
  const prev = load(path.join(ROOT, 'tools', 'nepse-holidays.json'), {});
  return {
    _comment: prev._comment || '',
    weekend_rule: prev.weekend_rule,
    trading_hours: prev.trading_hours,
    authority: prev.authority,
    _generated: 'Regenerated by tools/build-calendar-events.js from tools/calendar-holidays-seed.json — edit the seed, never this file.',
    holidays: closureEntries.map(e => {
      const s = seedByDate.get(e.date_ad) || {};
      /* The machine-file schema requires a source_url on verified entries;
       * a verified seed entry without one is written as unverified there
       * (with the reason in notes) — the events DB keeps its own status. */
      const verified = e.verified && !!s.source_url;
      return {
        date_ad: e.date_ad, date_bs: e.date_bs, name: e.title,
        type: 'closed', source_url: s.source_url || null, retrieved_at: seed.retrieved_at,
        status: verified ? 'verified' : 'unverified',
        notes: (s.source || '') + (s.machine_status_note ? ' ' + s.machine_status_note : ''),
      };
    }),
  };
})();

function txtContent() {
  const lines = [
    '# NEPSE Holiday Calendar',
    '# Dates when NEPSE is closed (no trading).',
    '# Format: YYYY-MM-DD: Holiday name',
    '# Saturdays and Sundays are always closed (handled in code, not listed here).',
    '# GENERATED by tools/build-calendar-events.js from tools/calendar-holidays-seed.json.',
    '# Do not edit by hand — edit the seed and rebuild. Generated ' + out.generated_at.slice(0, 10) + '.',
    '# Status key: entries from the BS 2083 gazette list and all BS 2084 forward',
    '# entries are gazette/estimate-grade until a NEPSE notice confirms them;',
    '# the pipeline treats a real trading session as evidence over this list.',
    '',
  ];
  let year = '';
  for (const e of closureEntries) {
    const y = e.date_ad.slice(0, 4);
    if (y !== year) { year = y; lines.push('# ' + y); }
    lines.push(`${e.date_ad}: ${e.title}`);
  }
  return lines.join('\n') + '\n';
}

/* schema validation (mirrors tools/build-holidays.js --check rules) */
const errs = [];
for (const h of holJson.holidays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date_ad)) errs.push('bad date_ad ' + h.date_ad);
  try { if (adToBs(h.date_ad) !== h.date_bs) errs.push('BS mismatch ' + h.date_ad); } catch (e) { errs.push('BS convert fail ' + h.date_ad); }
}
if (!holJson.weekend_rule || holJson.weekend_rule.status !== 'verified') errs.push('weekend_rule missing/unverified');
if (errs.length) { console.error('VALIDATION FAILED:\n' + errs.join('\n')); process.exit(1); }

console.log(`events: ${events.length} total`, counts);
console.log(`closures (weekday, written to holiday files): ${closureEntries.length}`);
console.log(`range: ${out.date_range[0]} -> ${out.date_range[1]}`);
if (warnings.length) console.log(`warnings: ${warnings.length} (see above)`);

if (!CHECK) {
  fs.writeFileSync(path.join(ROOT, 'data', 'calendar-events.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(ROOT, 'tools', 'nepse-holidays.json'), JSON.stringify(holJson, null, 2) + '\n');
  console.log('wrote data/calendar-events.json + tools/nepse-holidays.json');
  if (ARCHIVE_DIR) {
    fs.writeFileSync(path.join(ARCHIVE_DIR, 'nepse-holidays.txt'), txtContent());
    fs.writeFileSync(path.join(ARCHIVE_DIR, 'calendar-events.json'), JSON.stringify(out, null, 1) + '\n');
    console.log('wrote archive nepse-holidays.txt + calendar-events.json -> ' + ARCHIVE_DIR);
  }
} else {
  console.log('--check: nothing written');
}
