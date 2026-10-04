#!/usr/bin/env node
/* Nepse Decode — NEPSE trading-holiday file builder/validator.
 *
 * Reads the legacy entries, migrates them to the V3 schema, computes BS dates
 * with the verified converter (tools/bs-convert.js), and validates every field.
 * Usage: node tools/build-holidays.js [--check]
 *   --check: validate the committed file, exit 1 on any schema violation.
 *
 * Schema per entry: date_ad, date_bs, name, type (closed|half_session|
 * early_close|extra_session), source_url, retrieved_at, status
 * (verified|unverified|superseded), notes.
 * The Saturday/Sunday weekend rule is a standing VERIFIED rule (owner-confirmed
 * 2026-10-04), not per-date entries. Public holidays follow NEPSE's own
 * official calendar (owner, 2026-10-04) — entries stay UNVERIFIED until an
 * official NEPSE notice confirms them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { adToBs } = require('./bs-convert');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'nepse-holidays.json');
const LEGACY = path.join(ROOT, 'tools', 'nepse-holidays.legacy.json');

const TYPES = ['closed', 'half_session', 'early_close', 'extra_session'];
const STATUSES = ['verified', 'unverified', 'superseded'];

function build() {
  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  const entries = [];
  for (const h of legacy.holidays['2026'] || []) {
    if (!h || !h.date) continue; // skip empty slots
    // Weekend dates are covered by the standing weekend_rule — not entries.
    const dow = new Date(h.date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) {
      console.log(`  skip ${h.date} (${h.name}) — weekend, covered by weekend_rule`);
      continue;
    }
    entries.push({
      date_ad: h.date,
      date_bs: adToBs(h.date),
      name: h.name,
      type: 'closed',
      source_url: null,
      retrieved_at: null,
      status: 'unverified',
      notes: 'Assembled from public lists 2026-10-03; NOT verified against an official NEPSE notice. Lunar-calendar festival dates shift yearly.',
    });
  }
  entries.sort((a, b) => a.date_ad < b.date_ad ? -1 : 1);
  return {
    _comment: 'NEPSE trading calendar. Standing rule: Saturday and Sunday are closed (VERIFIED — owner-confirmed 2026-10-04; NEPSE trades Monday-Friday). Public holidays follow NEPSE\'s own official calendar/notices (owner, 2026-10-04). Per-date entries below are UNVERIFIED until confirmed by an official NEPSE notice — never treat an unverified entry as authoritative for labels; the pipeline always checks for a real session (evidence wins).',
    weekend_rule: {
      days: ['Saturday', 'Sunday'],
      status: 'verified',
      verified_by: 'owner confirmed 2026-10-04',
      notes: 'NEPSE moved to Mon-Fri trading in April 2026 (government weekend Sat-Sun).',
    },
    trading_hours: {
      days: 'Monday-Friday',
      pre_open_npt: '10:45-11:00',
      continuous_npt: '11:00-15:00',
      timezone: 'Asia/Kathmandu',
      authority: 'NEPSE official calendar',
    },
    authority: 'For any public holiday, NEPSE\'s own official calendar/notices are the authority (owner, 2026-10-04).',
    holidays: entries,
  };
}

function validate(doc) {
  const errs = [];
  if (!doc.weekend_rule || doc.weekend_rule.status !== 'verified') errs.push('weekend_rule must be present and verified');
  const seen = new Set();
  for (const h of doc.holidays || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date_ad)) errs.push(`bad date_ad: ${h.date_ad}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date_bs)) errs.push(`bad date_bs: ${h.date_ad}`);
    try { if (adToBs(h.date_ad) !== h.date_bs) errs.push(`BS mismatch for ${h.date_ad}: file has ${h.date_bs}`); } catch (e) { errs.push(`BS convert failed for ${h.date_ad}`); }
    if (!TYPES.includes(h.type)) errs.push(`bad type for ${h.date_ad}: ${h.type}`);
    if (!STATUSES.includes(h.status)) errs.push(`bad status for ${h.date_ad}: ${h.status}`);
    if (h.status === 'verified' && !h.source_url) errs.push(`verified entry ${h.date_ad} needs source_url`);
    if (seen.has(h.date_ad)) errs.push(`duplicate date: ${h.date_ad}`);
    seen.add(h.date_ad);
    // weekend entries are redundant (covered by the standing rule)
    const dow = new Date(h.date_ad + 'T00:00:00Z').getUTCDay();
    if ((dow === 0 || dow === 6) && h.type === 'closed') errs.push(`redundant: ${h.date_ad} is a weekend (covered by weekend_rule)`);
  }
  return errs;
}

function main() {
  if (process.argv.includes('--check')) {
    const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const errs = validate(doc);
    if (errs.length) { console.error('HOLIDAY FILE INVALID:\n - ' + errs.join('\n - ')); process.exit(1); }
    console.log(`holidays file OK: ${doc.holidays.length} entries, weekend_rule=${doc.weekend_rule.status}`);
    return;
  }
  const doc = build();
  const errs = validate(doc);
  if (errs.length) { console.error('BUILD FAILED:\n - ' + errs.join('\n - ')); process.exit(1); }
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${doc.holidays.length} entries`);
}

if (require.main === module) main();
module.exports = { validate };
