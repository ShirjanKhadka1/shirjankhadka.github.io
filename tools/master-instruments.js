#!/usr/bin/env node
/* Master instrument reader — Charter v4.2 item 4B.
 *
 * THE single source of truth for instrument_type + sector in every
 * Node builder/consumer: data/reference/instruments.json (adopted 4A).
 * No other map, heuristic, name pattern, or suffix regex may decide a
 * symbol's sector or type. Builders that used tools/sector-map.json,
 * classify()/secOf() heuristics, or VERIFIED_OVERRIDES must use this
 * module instead; tools/build-master-view.js regenerates every derived
 * view (js/nd-master.js, data/reference/instruments-view.json, and the
 * derived tools/sector-map.json) from this same file.
 *
 * Semantics (master README):
 *  - sectorOf(sym) returns the master sector string, or null when the
 *    master row is UNCONFIRMED or the symbol is absent. null means
 *    "no sector asserted" — NEVER render it as "Others", "Unclassified",
 *    or any other bucket; exclude such rows from sector boards/groups.
 *  - typeOf(sym) returns the master instrument_type (EQUITY, DEBENTURE,
 *    MUTUAL_FUND, PROMOTER) or null when absent. TYPE decides ranking /
 *    verdict / equity-board inclusion, never sector: a DEBENTURE row
 *    carrying a real issuer sector is still non-equity.
 *  - legacyType() maps master types to the universe/verdicts vocabulary
 *    (Equity / Debenture / Mutual fund / Promoter share) so existing
 *    payload shapes do not change; the mapping is a vocabulary rename,
 *    not a classification.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MASTER_PATH = path.join(__dirname, '..', 'data', 'reference', 'instruments.json');
const MASTER_SECTORS = [
  'Commercial Bank', 'Development Bank', 'Finance', 'Hotels and Tourism',
  'Hydropower', 'Investment', 'Life Insurance', 'Manufacturing and Processing',
  'Microfinance', 'Non Life Insurance', 'Trading',
];
const LEGACY_TYPE = {
  EQUITY: 'Equity', DEBENTURE: 'Debenture',
  MUTUAL_FUND: 'Mutual fund', PROMOTER: 'Promoter share',
};
const MASTER_TYPE = {
  Equity: 'EQUITY', Debenture: 'DEBENTURE',
  'Mutual fund': 'MUTUAL_FUND', 'Promoter share': 'PROMOTER',
};

let cache = null;
function load() {
  if (cache) return cache;
  const doc = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const rows = {};
  for (const r of (doc.instruments || [])) {
    rows[r.symbol] = {
      symbol: r.symbol,
      name: r.name || null,
      type: r.instrument_type || null,
      sector: (r.sector && r.sector !== 'UNCONFIRMED') ? r.sector : null,
      sectorRaw: r.sector || null,
      parent_symbol: r.parent_symbol || null,
    };
  }
  cache = { doc, rows };
  return cache;
}
function row(sym) { return load().rows[String(sym || '').toUpperCase()] || null; }
function sectorOf(sym) { const r = row(sym); return r ? r.sector : null; }
function typeOf(sym) { const r = row(sym); return r ? r.type : null; }
function legacyTypeOf(sym) { const t = typeOf(sym); return t ? (LEGACY_TYPE[t] || null) : null; }
function isEquity(sym) { return typeOf(sym) === 'EQUITY'; }
function isMasterSector(s) { return MASTER_SECTORS.indexOf(s) >= 0; }
function allRows() { return load().rows; }
function masterPath() { return MASTER_PATH; }

module.exports = {
  load, row, sectorOf, typeOf, legacyTypeOf, isEquity, isMasterSector,
  allRows, masterPath, MASTER_SECTORS, LEGACY_TYPE, MASTER_TYPE,
};
