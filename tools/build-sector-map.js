/* Build the authoritative NEPSE sector map: tools/sector-map.json.
 *
 * This is the single source of truth for per-symbol sectors. The universe
 * builder (tools/build-nepse-universe.js) loads it at build time and writes
 * the sector into every verdicts.json entry's `sec` field, which is what the
 * heatmap, screener, portfolio, fundamentals and stock pages read first.
 *
 * Classification order (must match js/nepse-sectors.js, js/nepse-screener.js,
 * tools/build-symbol-pages.js — those are fallback copies):
 *   1. Explicit verified symbol overrides (below) — checked FIRST, before
 *      any keyword matching. These cover symbols whose official company name
 *      does not reveal the real sector.
 *   2. NEPSE-official sub-index overrides: Investment (CIT, HIDCL, HIDCLP,
 *      NIFRA, NRN, CHDC, ENL, HATHY) and Trading (BBC, STC).
 *   3. Instrument type (Debenture / Mutual fund / Promoter share) and
 *      NEPSE's own debenture symbol suffixes (D + maturity year).
 *   4. Business keywords in the official company name.
 *   5. Fallback: "Others" (the NEPSE "Others" sub-index bucket). There is NO
 *      "Unclassified" — every listed security belongs to exactly one real
 *      category.
 *
 * Usage: node tools/build-sector-map.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const universe = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepse-chart', 'data', 'universe.json'), 'utf8'));

/* Verified 2026-09-30 against official NEPSE/company notices and market
 * sources (sharesansar company pages, ShareHub, investopaper NAV tables,
 * SEBON/NEPSE listing notices). Each entry: SYMBOL -> sector. */
const SECTOR_OVERRIDES = {
  // Hydropower — hydro producers whose names carry no hydro keyword
  GVL: 'Hydropower',    // Green Ventures Ltd (Likhu-IV HEP)
  SNORL: 'Hydropower',  // Snow Rivers Ltd (hydro)
  // Manufacturing And Processing
  BNL: 'Manufacturing And Processing',   // Bottlers Nepal Ltd
  UNL: 'Manufacturing And Processing',   // Unilever Nepal Ltd
  SAIL: 'Manufacturing And Processing',  // Shreenagar Agrofarm Industries Ltd
  // Hotels And Tourism — cable-car operators
  CGH: 'Hotels And Tourism',  // Chandragiri Hills Ltd
  KDL: 'Hotels And Tourism',  // Kalinchowk Darshan Ltd
  // Mutual Funds — verified via NAV tables / NEPSE listing notices
  SAGF: 'Mutual Funds',   // Sanima Growth Fund
  H8020: 'Mutual Funds',  // Himalayan 80-20
  NMB50: 'Mutual Funds',  // NMB 50
  CMF2: 'Mutual Funds',   // Citizens Mutual Fund 2
  NICBF: 'Mutual Funds',  // NIC Asia Balanced Fund
  LSH12: 'Mutual Funds',  // LS Horizon 12
  RBBF40: 'Mutual Funds', // RBB Focus 40
  // Promoter Shares — verified promoter-share listings
  JBLBP: 'Promoter Shares',  // Jeevan Bikas Laghubitta promoter share
  KBLPO: 'Promoter Shares',  // Kumari Bank promoter share
  MLBLPO: 'Promoter Shares', // Mahalaxmi Bikas Bank promoter share
  // Debentures — verified debenture listings
  SCBD: 'Debentures',   // 10.30% Standard Chartered Bank Nepal Debenture
  SHINED: 'Debentures', // 8% Shine Resunga Debenture
  // Finance
  SFCL: 'Finance',      // Samriddhi Finance Company Ltd
  // Microfinance
  WNLB: 'Microfinance', // Wean Nepal Laghubitta Bittiya Sanstha Ltd
  // Others — NEPSE "Others" sub-index companies
  NTC: 'Others',   // Nepal Telecom
  NRM: 'Others',   // Nepal Republic Media Ltd
  NWCL: 'Others',  // Nepal Warehousing Company Ltd
  TTL: 'Others',   // Trade Tower Ltd
  MKCL: 'Others',  // Muktinath Krishi Company Ltd
};

const INVESTMENT_SYMBOLS = { CIT: 1, HIDCL: 1, HIDCLP: 1, NIFRA: 1, NRN: 1, CHDC: 1, ENL: 1, HATHY: 1 };
const TRADING_SYMBOLS = { BBC: 1, STC: 1 };
const DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;

function classifySymbol(sym, name, type) {
  const symU = String(sym || '').toUpperCase();
  if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
  if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
  if (TRADING_SYMBOLS[symU]) return 'Trading';
  const n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
  if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
      n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
  if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
  if (type === 'Promoter share') return 'Promoter Shares';
  if (type && type !== 'Equity') return 'Others';
  const has = (...ws) => ws.some((w) => n.indexOf(w) >= 0);
  if (has('laghu', 'microfinance')) return 'Microfinance';
  if (has('hydropower', 'hydro', 'power', 'urja', 'dhyut', 'dyut', 'energy')) return 'Hydropower';
  if (has('development bank')) return 'Development Bank';
  if (has('bank')) return 'Banking';
  if (has('life insurance')) return 'Life Insurance';
  if (has('reinsurance', 'insurance', 'beema')) return 'Non Life Insurance';
  if (has('finance')) return 'Finance';
  if (has('hotel', 'tourism', 'cablecar')) return 'Hotels And Tourism';
  if (has('investment')) return 'Investment';
  if (has('trading')) return 'Trading';
  if (has('manufacturing', 'cement', 'bottler', 'distiller', 'spinning', 'pharmaceut',
    'paints', 'colour', 'panel', 'mineral', 'lube')) return 'Manufacturing And Processing';
  return 'Others';
}

const map = {};
const counts = {};
const seen = new Set();
const problems = [];
for (const u of universe.symbols) {
  const sym = u.s;
  if (seen.has(sym)) problems.push('duplicate symbol in universe: ' + sym);
  seen.add(sym);
  const sec = classifySymbol(sym, u.n, u.t);
  if (!sec || sec === 'Unclassified') problems.push('unclassified: ' + sym);
  map[sym] = { sector: sec };
  counts[sec] = (counts[sec] || 0) + 1;
}
// Every override must actually exist in the universe (catches typos).
for (const sym of Object.keys(SECTOR_OVERRIDES)) {
  if (!seen.has(sym)) problems.push('override symbol not in universe: ' + sym);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log('symbols classified: ' + seen.size + ' | sum of sector counts: ' + total);
console.log('sector counts:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k + ': ' + v);
}
if (problems.length) {
  console.log('PROBLEMS:');
  problems.forEach((p) => console.log('  !! ' + p));
  process.exit(1);
}
if (total !== seen.size) {
  console.log('!! count mismatch');
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, 'sector-map.json'), JSON.stringify(map, null, 1) + '\n');
console.log('wrote tools/sector-map.json (' + seen.size + ' symbols, 0 unclassified)');
