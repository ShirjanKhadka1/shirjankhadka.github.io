#!/usr/bin/env node
/* Merge Capital Max "Key Financials" XLSX screener exports into
 * nepse-chart/data/quarterly.json, the quarterly archive behind the
 * stock-page Fundamentals trend table.
 *
 * Usage:
 *   node tools/merge-quarterly.js <exports-dir>
 *
 * Each XLSX filename must identify its quarter, e.g.
 *   ..._FY2080-2081_Q1_....xlsx   or   q_2080-2081-q1.xlsx
 * (fiscal year as 2080-2081 or 2080/2081, quarter as Q1..Q4, case-insensitive).
 *
 * Behavior:
 * - Parses every .xlsx in the directory (skips the 'Average' aggregate row).
 * - Merges quarter snapshots per symbol (existing quarters are replaced only
 *   when the incoming export actually carries figures for them).
 * - Enforces a 12-quarter retention window per symbol (oldest dropped).
 * - Regenerates nepse-chart/data/fundamentals.json from each symbol's latest
 *   quarter with published figures (same derivation the site has always used).
 * - Prints a JSON report to stdout. Exits non-zero on parse failure.
 *
 * Never invents figures: a quarter with no published row stays absent and
 * renders as – on the site.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'nepse-chart', 'data');
const QPATH = path.join(DATA, 'quarterly.json');
const FPATH = path.join(DATA, 'fundamentals.json');
const RETENTION = 12; // quarters per symbol (3 years)

/* Cells proven corrupt in the source exports. Nulled (rendered as –) rather
 * than published: these are demonstrably false, not merely surprising.
 * - ADBL deposits 2081/2082-Q4: source shows 2,804,657.06 (thousands) =
 *   Rs 2.8b, while the same row shows assets Rs 362.5b and loans Rs 216.0b,
 *   and adjacent quarters show ~Rs 300b+ deposits. A commercial bank cannot
 *   hold deposits under 1% of assets; the figure is off by ~100x, consistent
 *   with a source data-entry slip. Nulled pending a corrected publication. */
const BAD_CELLS = [
  { sym: 'ADBL', quarter: '2081/2082-Q4', field: 'deposits',
    reason: 'source value Rs 2.8b vs assets Rs 362.5b and ~Rs 300b deposits in adjacent quarters; off by ~100x' },
];

/* Whole quarters proven corrupt in the source exports. The entire quarter
 * record is nulled (renders as –) rather than published: every field is
 * demonstrably false, not merely surprising.
 * - SWBBL 2082/2083-Q2: paid-up capital Rs 153.4m vs Rs 1,750m in Q1, Q3 and
 *   Q4 of the same fiscal year (point-in-time figure cannot drop 91% and
 *   recover in one quarter); cumulative revenue Rs 208.8m vs Rs 2,569.2m in
 *   Q1 (cumulative YTD revenue cannot decrease quarter-over-quarter);
 *   deposits/loans/assets all ~8-19x smaller than adjacent quarters.
 *   Systematic source scaling slip for that quarter's row. Nulled pending a
 *   corrected publication. */
const BAD_QUARTERS = [
  { sym: 'SWBBL', quarter: '2082/2083-Q2',
    reason: 'paid-up Rs 153.4m vs Rs 1,750m in Q1/Q3/Q4 same FY; cumulative revenue Rs 208.8m below Q1 YTD Rs 2,569.2m (impossible); all balance-sheet items ~8-19x too small' },
];

/* Column mapping: Capital Max "Key Financials" header -> quarterly.json field.
 * quarterly.json values are in NPR thousands, matching the exports. */
const COLS = {
  'company': 'sym',
  'paid up cap': 'paidup',
  'reserves &  surplus': 'reserves',
  'reserves & surplus': 'reserves',
  'deposits': 'deposits',
  'total  assets': 'assets',
  'total assets': 'assets',
  'loans &  advances': 'loans',
  'loans & advances': 'loans',
  'total  liabilities': 'liabilities',
  'total liabilities': 'liabilities',
  'revenue': 'revenue',
  'gross  profit': 'grossprofit',
  'gross profit': 'grossprofit',
  'operating  profit': 'opprofit',
  'operating profit': 'opprofit',
  'net  profit': 'netprofit',
  'net profit': 'netprofit',
  'distributable  profit': 'distprofit',
  'distributable profit': 'distprofit',
  'eps  (annu.)': 'eps_ann',
  'eps (annu.)': 'eps_ann',
  'eps  (ttm)': 'eps_ttm',
  'eps (ttm)': 'eps_ttm',
  'p/e  (annu.)': 'pe_ann',
  'p/e (annu.)': 'pe_ann',
  'p/e  (latest)': 'pe_latest',
  'p/e (latest)': 'pe_latest',
  'p/e  (ttm)': 'pe_ttm',
  'p/e (ttm)': 'pe_ttm',
  'npl to  total loan': 'npl_pct',
  'npl to total loan': 'npl_pct',
  'credit to  deposit': 'cd_ratio',
  'credit to deposit': 'cd_ratio',
  'int. rate  spread': 'spread',
  'int. rate spread': 'spread',
};

function normHeader(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/* Published-figure fields: everything the source actually publishes per
 * quarter. pe_latest is screener-computed (every quarter priced at today's
 * price), not a published figure, so it never counts toward "has data". */
const PUB_FIELDS = ['revenue', 'netprofit', 'grossprofit', 'opprofit', 'distprofit',
  'paidup', 'reserves', 'deposits', 'loans', 'assets', 'liabilities',
  'eps_ttm', 'eps_ann', 'pe_ttm', 'pe_ann', 'npl_pct', 'cd_ratio', 'spread'];
/* True when a quarter record carries at least one published figure. A P/E of
 * exactly 0 means the source could not compute it (no or negative EPS), so it
 * never counts. Ghost quarters (a quarter column present in an export with
 * empty cells) fail this test and stay absent. */
function hasPublishedFigures(rec) {
  if (!rec) return false;
  return PUB_FIELDS.some((f) => {
    const v = rec[f];
    if (v === null || v === undefined || v === '') return false;
    if ((f === 'pe_ttm' || f === 'pe_ann') && v === 0) return false;
    return true;
  });
}

function quarterKeyFromName(name) {
  const m = /(\d{4})[\/-](\d{4}).*?Q([1-4])/i.exec(name);
  if (!m) return null;
  return m[1] + '/' + m[2] + '-Q' + m[3];
}

/* Minimal XLSX reader: the exports are plain single-sheet workbooks.
 * We read shared strings + sheet XML directly to avoid new dependencies. */
function readXlsxRows(file) {
  const { execFileSync } = require('child_process');
  const script = `
import sys, zipfile, re, json
path = sys.argv[1]
z = zipfile.ZipFile(path)
strings = []
try:
    import xml.etree.ElementTree as ET
    ss = z.read('xl/sharedStrings.xml')
    root = ET.fromstring(ss)
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    for si in root.findall('m:si', ns):
        t = ''.join(si.itertext())
        strings.append(t)
except KeyError:
    pass
import xml.etree.ElementTree as ET
sheet = z.read('xl/worksheets/sheet1.xml')
root = ET.fromstring(sheet)
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
rows = []
for row in root.findall('.//m:row', ns):
    cells = {}
    for c in row.findall('m:c', ns):
        ref = c.get('r', '')
        col = ''.join(ch for ch in ref if ch.isalpha())
        t = c.get('t')
        v = c.find('m:v', ns)
        val = v.text if v is not None else None
        if t == 's' and val is not None:
            try: val = strings[int(val)]
            except (IndexError, ValueError): val = None
        cells[col] = val
    if cells: rows.append(cells)
cols = sorted({c for r in rows for c in r}, key=lambda x: (len(x), x))
out = [[r.get(c) for c in cols] for r in rows]
print(json.dumps(out))
`;
  const raw = execFileSync('python3', ['-c', script, file], { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(raw.toString());
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseExport(file, qkey, report) {
  const rows = readXlsxRows(file);
  // Find the header row (the one containing 'Company' and 'Fiscal Year').
  let hIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].map((c) => normHeader(c)).join('|');
    if (joined.includes('company') && joined.includes('fiscal year')) { hIdx = i; break; }
  }
  if (hIdx < 0) throw new Error('header row not found in ' + path.basename(file));
  const headers = rows[hIdx].map(normHeader);
  const colIdx = {};
  headers.forEach((hh, i) => { if (COLS[hh] && colIdx[COLS[hh]] === undefined) colIdx[COLS[hh]] = i; });
  if (colIdx.sym === undefined) throw new Error('Company column not found in ' + path.basename(file));
  const out = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    const sym = String(cells[colIdx.sym] || '').trim().toUpperCase();
    if (!sym || sym === 'AVERAGE') continue; // skip aggregate + blank rows
    if (!/^[A-Z0-9]{2,12}$/.test(sym)) continue;
    const rec = {};
    for (const [field, idx] of Object.entries(colIdx)) {
      if (field === 'sym') continue;
      rec[field] = toNum(cells[idx]);
    }
    // Skip rows that carry no published figures at all (ghost quarters:
    // a quarter column present in the export with empty cells).
    if (!hasPublishedFigures(rec)) continue;
    out.push({ sym, rec });
  }
  report.files.push({ file: path.basename(file), quarter: qkey, rows: out.length });
  return out;
}

function sortKey(k) {
  const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(k);
  return m ? (+m[1] * 10 + +m[3]) : 0;
}

function main() {
  // --regen-only: skip XLSX merging; prune ghost quarters and regenerate
  // fundamentals.json from the existing quarterly.json.
  const regenOnly = process.argv[2] === '--regen-only';
  const dir = regenOnly ? null : process.argv[2];
  if (!regenOnly && (!dir || !fs.existsSync(dir))) {
    console.error('usage: node tools/merge-quarterly.js <exports-dir> [--regen-only]');
    process.exit(1);
  }
  const report = { files: [], merged: 0, pruned: {}, symbols: 0, regenOnly };
  const q = JSON.parse(fs.readFileSync(QPATH, 'utf8'));
  q.symbols = q.symbols || {};
  if (!regenOnly) {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx')).sort();
  if (!files.length) { console.error('no .xlsx files in ' + dir); process.exit(1); }
  for (const f of files) {
    const qkey = quarterKeyFromName(f);
    if (!qkey) { report.files.push({ file: f, quarter: null, skipped: 'unrecognized quarter in filename' }); continue; }
    const rows = parseExport(path.join(dir, f), qkey, report);
    for (const { sym, rec } of rows) {
      const s = (q.symbols[sym] = q.symbols[sym] || { quarters: {} });
      s.quarters[qkey] = Object.assign({}, s.quarters[qkey] || {}, rec);
      report.merged++;
    }
  }
  }
  // Prune ghost quarters: slots with no published figures (e.g. a quarter
  // column that arrived with empty cells). Left in place they become the
  // "latest" quarter and blank out summaries and comparisons.
  report.ghostPruned = 0;
  for (const [sym, s] of Object.entries(q.symbols)) {
    for (const k of Object.keys(s.quarters)) {
      if (!hasPublishedFigures(s.quarters[k])) {
        delete s.quarters[k];
        report.ghostPruned++;
        report.pruned[sym] = (report.pruned[sym] || 0) + 1;
      }
    }
  }
  // Retention: keep the newest RETENTION quarters per symbol.
  for (const [sym, s] of Object.entries(q.symbols)) {
    const keys = Object.keys(s.quarters).sort((a, b) => sortKey(a) - sortKey(b));
    if (keys.length > RETENTION) {
      for (const drop of keys.slice(0, keys.length - RETENTION)) {
        delete s.quarters[drop];
        report.pruned[sym] = (report.pruned[sym] || 0) + 1;
      }
    }
  }
  // Null proven-corrupt source cells (see BAD_CELLS); they render as –.
  report.nulled = [];
  for (const bc of BAD_CELLS) {
    const s = q.symbols[bc.sym];
    if (s && s.quarters[bc.quarter] && s.quarters[bc.quarter][bc.field] !== undefined) {
      s.quarters[bc.quarter][bc.field] = null;
      report.nulled.push(bc.sym + ' ' + bc.quarter + ' ' + bc.field + ' (' + bc.reason + ')');
    }
  }
  // Null proven-corrupt whole quarters (see BAD_QUARTERS); they render as –.
  for (const bq of BAD_QUARTERS) {
    const s = q.symbols[bq.sym];
    if (s && s.quarters[bq.quarter]) {
      delete s.quarters[bq.quarter];
      report.nulled.push(bq.sym + ' ' + bq.quarter + ' [whole quarter] (' + bq.reason + ')');
    }
  }
  // Sanity scan: flag (not auto-null) implausible QoQ jumps in balance-sheet
  // stock figures for human review. Banks do not move these 60%+ in a quarter.
  report.flags = [];
  for (const field of ['deposits', 'assets', 'loans', 'liabilities', 'paidup']) {
    for (const [sym, s] of Object.entries(q.symbols)) {
      const keys = Object.keys(s.quarters).sort((a, b) => sortKey(a) - sortKey(b));
      for (let i = 1; i < keys.length; i++) {
        const a = s.quarters[keys[i - 1]][field], b = s.quarters[keys[i]][field];
        if (a && b && Math.abs((b - a) / a) > 0.6) {
          report.flags.push(sym + ' ' + field + ' ' + keys[i - 1] + ' -> ' + keys[i] +
            ' (' + Math.round((b - a) / a * 100) + '%)');
        }
      }
    }
  }
  report.symbols = Object.keys(q.symbols).length;
  q.asof = new Date().toISOString().slice(0, 10);
  q.retention_quarters = RETENTION;
  fs.writeFileSync(QPATH, JSON.stringify(q, null, 1) + '\n');

  // Regenerate fundamentals.json from each symbol's latest quarter WITH
  // published figures (ghost quarters are pruned above, so the last slot is
  // the latest real one). fund.companies holds every covered security with
  // all published fields; presentation layers pick the sector-appropriate
  // metrics. Money values are converted to Rs billions for display; ratios
  // stay as published. Each company carries its own quarter + period label
  // because coverage lags differ across symbols.
  const fund = JSON.parse(fs.readFileSync(FPATH, 'utf8'));
  fund.companies = {};
  delete fund.banks; // schema moved to companies in the all-sector rebuild
  const periodLabel = (k) => {
    const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(k);
    return m ? 'Q' + m[3] + ' FY ' + m[1] + '/' + m[2] : k;
  };
  let latestKey = null;
  for (const [sym, s] of Object.entries(q.symbols)) {
    const keys = Object.keys(s.quarters).sort((a, b) => sortKey(a) - sortKey(b));
    if (!keys.length) continue;
    const lk = keys[keys.length - 1];
    if (!latestKey || sortKey(lk) > sortKey(latestKey)) latestKey = lk;
    const d = s.quarters[lk];
    const b = (v) => (v === null || v === undefined) ? null : Math.round(v / 1e6 * 10000) / 10000;
    const r = (v) => (v === null || v === undefined) ? null : v;
    fund.companies[sym] = {
      quarter: lk,
      period: periodLabel(lk),
      eps_ttm: r(d.eps_ttm),
      pe_ttm: r(d.pe_ttm),
      pe_ann: r(d.pe_ann),
      pe_latest: r(d.pe_latest),
      paidup_b: b(d.paidup),
      reserves_b: b(d.reserves),
      netprofit_b: b(d.netprofit),
      revenue_b: b(d.revenue),
      grossprofit_b: b(d.grossprofit),
      opprofit_b: b(d.opprofit),
      assets_b: b(d.assets),
      liabilities_b: b(d.liabilities),
      deposits_b: b(d.deposits),
      loans_b: b(d.loans),
      npl_pct: r(d.npl_pct),
      cd_ratio: r(d.cd_ratio),
      spread: r(d.spread),
    };
  }
  if (latestKey) {
    const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(latestKey);
    fund.period = 'Q' + m[3] + ' FY ' + m[1] + '/' + m[2];
  }
  fund.asof = q.asof;
  fs.writeFileSync(FPATH, JSON.stringify(fund, null, 1) + '\n');
  report.fundamentals_period = fund.period;
  console.log(JSON.stringify(report, null, 1));
}

main();
