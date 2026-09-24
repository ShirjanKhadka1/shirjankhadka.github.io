#!/usr/bin/env node
/* NEPSE Alpha Lab — universe builder.
 *
 * Builds the full listed-security universe from the free community feeds and
 * pre-computes a compact verdict snapshot for every symbol:
 *   nepse-chart/data/universe.json   — symbol, name, instrument type, hasOHLC
 *   nepse-chart/data/verdicts.json   — compact per-symbol verdict snapshot
 *   nepse-chart/data/ltp/{SYM}.json  — LTP-only daily series for symbols the
 *                                      scraper has no OHLC for (never fabricated
 *                                      open/high/low; flagged ltpOnly).
 *
 * Engine reused verbatim from ../../js/nepse-lab.js via its node export
 * (no threshold changes). Symbols with <60 valid sessions get
 * "Insufficient history", never a forced Hold.
 *
 * Node 18+, no npm dependencies. Run: node tools/build-nepse-universe.js
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'nepse-chart', 'data');
const LTP_DIR = path.join(OUT, 'ltp');
const ENGINE = require(path.join(ROOT, 'js', 'nepse-lab.js'));

const U = {
  manifest: 'https://shubhamnpk.github.io/yonepse/data/ltp/manifest.json',
  monthly: (m) => 'https://shubhamnpk.github.io/yonepse/data/ltp/monthly/' + m + '.json',
  companies: 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/companies.json',
  prices: (s) => 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' + s.replace('/', '-') + '.json',
  live: 'https://shubhamnpk.github.io/yonepse/data/market/live.json'
};
const UA = { 'User-Agent': 'Mozilla/5.0 (NEPSE-Alpha-Lab universe builder)' };

function getJSON(url, tries) {
  tries = tries == null ? 3 : tries;
  // NOTE: use global fetch (undici honors NODE_USE_ENV_PROXY=1) — the legacy
  // https.get ignores the egress proxy and hangs in this sandbox.
  const attempt = (left) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('timeout ' + url)), 30000);
    return fetch(url, { headers: UA, signal: ctl.signal }).then((res) => {
      clearTimeout(timer);
      if (res.status === 404) return { __404: true };
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return res.json();
    }).catch((e) => {
      clearTimeout(timer);
      if (left > 0) return new Promise((r) => setTimeout(r, 900)).then(() => attempt(left - 1));
      throw e;
    });
  };
  return attempt(tries);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0, active = 0;
  return new Promise((resolve) => {
    function next() {
      if (i >= items.length && active === 0) return resolve(out);
      while (active < n && i < items.length) {
        const k = i++; active++;
        Promise.resolve()
          .then(() => fn(items[k], k))
          .then((v) => { out[k] = v; }, (e) => { out[k] = { __err: String((e && e.message) || e) }; })
          .finally(() => { active--; next(); });
      }
    }
    next();
  });
}

function ymdNum(dstr) { return +String(dstr).replace(/-/g, ''); }
function fmtD(ymd) { const s = String(ymd); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
function r2(x) { return x == null || !isFinite(x) ? null : Math.round(x * 100) / 100; }

function classify(sym, name, assetType) {
  const nm = ((name || '') + ' ' + sym);
  if (assetType === 'open_ended_mutual_fund') return 'Mutual fund';
  if (/debenture/i.test(nm)) return 'Debenture';
  if (/preference/i.test(nm)) return 'Preference share';
  if (/mutual fund|mutual|yojana|scheme/i.test(nm)) return 'Mutual fund';
  if (/promoter/i.test(nm)) return 'Promoter share';
  return 'Equity';
}

async function main() {
  const t0 = Date.now();
  console.log('== NEPSE universe build ==');

  console.log('> manifest…');
  const manifest = await getJSON(U.manifest);
  const months = manifest.availableMonths || [];
  console.log('  months available:', months.length, '| latest:', manifest.latestDate);

  console.log('> companies + live…');
  const [companies, live] = await Promise.all([getJSON(U.companies), getJSON(U.live)]);
  console.log('  scraper companies:', companies.length, '| live symbols:', live.length);

  const liveMap = {};
  live.forEach((q) => { if (q && q.symbol) liveMap[q.symbol] = q; });

  console.log('> monthly LTP files (%d)…', months.length);
  const monthlyFiles = await pool(months, 4, (m) => getJSON(U.monthly(m)));
  // per-symbol daily LTP series from monthly files: sym -> Map(ymd -> [ltp,vol,turnover,trades])
  const monthlySeries = new Map();
  let monthlyOk = 0;
  monthlyFiles.forEach((mf, k) => {
    if (!mf || mf.__err || mf.__404 || !mf.dates || !mf.series) { console.log('  !! month failed:', months[k]); return; }
    monthlyOk++;
    const dates = mf.dates.map(ymdNum);
    Object.keys(mf.series).forEach((sym) => {
      let m = monthlySeries.get(sym);
      if (!m) { m = new Map(); monthlySeries.set(sym, m); }
      mf.series[sym].forEach((pt) => {
        const ymd = dates[pt[0]];
        if (ymd && pt[1] > 0 && !m.has(ymd)) m.set(ymd, [pt[1], pt[2] || 0, pt[3] || 0, pt[4] || 0]);
      });
    });
  });
  console.log('  monthly files ok:', monthlyOk + '/' + months.length, '| symbols with monthly data:', monthlySeries.size);

  // ---- union universe: currently-listed securities only ----
  // companies.json (scraper's listed list) ∪ live feed symbols. Symbols that
  // appear ONLY in monthly history are delisted/renamed and are excluded.
  const union = new Set();
  companies.forEach((s) => union.add(s));
  Object.keys(liveMap).forEach((s) => union.add(s));
  const monthlyOnly = [];
  monthlySeries.forEach((_, s) => { if (!union.has(s)) monthlyOnly.push(s); });
  const symbols = Array.from(union).sort();
  console.log('> union universe (currently listed):', symbols.length, 'symbols');
  console.log('  monthly-only historical symbols (excluded):', monthlyOnly.length);

  // New listings: symbols in today's union that were absent from the last
  // published universe (e.g. newly listed IPOs). Only computed when a
  // previous universe exists, so the very first build flags nothing.
  let prevSymbols = new Set();
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'universe.json'), 'utf8'));
    prevSymbols = new Set((prev.symbols || []).map((x) => x.s));
  } catch (e) { /* first build — no baseline */ }
  const newListings = prevSymbols.size ? symbols.filter((s) => !prevSymbols.has(s)) : [];
  const newSet = new Set(newListings);
  if (newListings.length) console.log('  NEW listings vs last build:', newListings.join(', '));

  // ---- OHLC per symbol ----
  console.log('> scraper OHLC per symbol…');
  const ohlcRows = new Map();
  const ohlcRes = await pool(symbols, 6, async (sym) => {
    const j = await getJSON(U.prices(sym), 2);
    if (!j || j.__404 || j.__err || !Array.isArray(j.data)) return null;
    const rows = j.data.map((d) => [
      ymdNum(d.date), +d.open || 0, +d.high || 0, +d.low || 0, +d.ltp || 0, +d.qty || 0, +d.turnover || 0
    ]).filter((r) => r[4] > 0);
    rows.sort((a, b) => a[0] - b[0]);
    return rows.length ? rows : null;
  });
  let ohlcCount = 0;
  ohlcRes.forEach((rows, k) => { if (rows) { ohlcRows.set(symbols[k], rows); ohlcCount++; } });
  console.log('  OHLC available:', ohlcCount + '/' + symbols.length);

  // ---- index rows for market-regime factor ----
  const dailySrc = fs.readFileSync(path.join(ROOT, 'js', 'nepse-daily.js'), 'utf8');
  const mIdx = dailySrc.match(/window\.NEPSE_DAILY=(\[[\s\S]*?\]);?\s*$/);
  if (!mIdx) throw new Error('could not parse nepse-daily.js');
  const idxDaily = JSON.parse(mIdx[1]); // [YYYYMMDD,o,h,l,c,volume]
  const idxCloses = idxDaily.map((r) => r[4]);
  const idxS200 = ENGINE.smaArr(idxCloses, 200);
  const idxRegime = idxCloses[idxCloses.length - 1] >= idxS200[idxS200.length - 1] ? 'up' : 'down';
  console.log('  index sessions:', idxDaily.length, '| regime:', idxRegime);

  // ---- build outputs ----
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(LTP_DIR, { recursive: true });

  const universe = { asof: manifest.latestDate || fmtD(idxDaily[idxDaily.length - 1][0]), count: symbols.length, symbols: [] };
  const verdicts = {};
  const audit = []; // per-stock data-check rows for data-check.html
  const report = {
    total: symbols.length, ohlc: ohlcCount, ltpOnly: [], insufficient: [], failures: [],
    byType: {}, byVerdict: {}, debByType: {}
  };

  let done = 0;
  for (const sym of symbols) {
    const q = liveMap[sym];
    const name = (q && q.name) || sym;
    const type = classify(sym, name, q && q.asset_type);
    const rows = ohlcRows.get(sym) || null;
    let series = rows, ltpOnly = false;

    if (!series) {
      const m = monthlySeries.get(sym);
      if (m && m.size) {
        ltpOnly = true;
        series = Array.from(m.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([ymd, pt]) => [ymd, pt[0], pt[0], pt[0], pt[0], pt[1], pt[2]]); // o=h=l=c=ltp; vol; turnover
        // persist compact LTP history for the client fallback
        const compact = Array.from(m.entries()).sort((a, b) => a[0] - b[0])
          .map(([ymd, pt]) => [ymd, pt[0], pt[1], pt[2], pt[3]]);
        fs.writeFileSync(path.join(LTP_DIR, sym.replace('/', '-') + '.json'),
          JSON.stringify({ s: sym, ltpOnly: true, rows: compact }));
      }
    }

    universe.symbols.push({ s: sym, n: name, t: type, o: rows ? 1 : 0 });
    report.byType[type] = (report.byType[type] || 0) + 1;
    const liveFlag = liveMap[sym] ? 1 : 0;
    const isNew = newSet.has(sym) ? 1 : 0;

    if (!series || !series.length) {
      report.failures.push(sym);
      verdicts[sym] = { v: 'Insufficient history', s: null, p: null, ch: null, h52: null, l52: null, pos: null, rsi: null, n: 0, l: 0, asof: universe.asof };
      report.byVerdict['Insufficient history'] = (report.byVerdict['Insufficient history'] || 0) + 1;
      report.insufficient.push(sym + ' (0)');
      audit.push({ s: sym, n: name, t: type, src: 'none', days: 0, lp: null, ld: null, verdict: 'Insufficient history', live: liveFlag, isNew });
      continue;
    }

    const n = series.length;
    const last = series[n - 1], prev = series[n - 2] || last;
    const price = last[4];
    const chgPct = prev[4] ? (last[4] - prev[4]) / prev[4] * 100 : 0;
    const win = series.slice(-252);
    let h52 = -Infinity, l52 = Infinity;
    win.forEach((x) => { if (x[2] > h52) h52 = x[2]; if (x[3] < l52) l52 = x[3]; });
    const pos = h52 > l52 ? (price - l52) / (h52 - l52) : 0.5;
    const rsiA = ENGINE.rsiArr(series.map((r) => r[4]), 14);
    const rsi = rsiA[n - 1];

    let v;
    if (ltpOnly) report.ltpOnly.push(sym + ' (' + n + ')');
    if (n < 60) {
      v = { score: null, label: 'Insufficient history', cls: 'insufficient' };
      report.insufficient.push(sym + ' (' + n + ')');
    } else {
      const divs = ltpOnly ? [] : ENGINE.detectDivergences(series);
      const pats = ltpOnly ? [] : ENGINE.detectPatterns(series);
      v = ENGINE.computeVerdict({ rows: series, divs, pats, isIndex: false, idxRegime });
    }
    report.byVerdict[v.label] = (report.byVerdict[v.label] || 0) + 1;
    verdicts[sym] = {
      v: v.label, s: v.score, p: r2(price), ch: r2(chgPct),
      h52: r2(h52), l52: r2(l52), pos: r2(pos), rsi: r2(rsi),
      n: n, l: ltpOnly ? 1 : 0, asof: fmtD(last[0])
    };
    audit.push({ s: sym, n: name, t: type, src: ltpOnly ? 'ltp' : 'ohlc', days: n, lp: r2(price), ld: fmtD(last[0]), verdict: v.label, live: liveFlag, isNew });

    if (++done % 100 === 0) console.log('  verdicts: ' + done + '/' + symbols.length);
  }

  fs.writeFileSync(path.join(OUT, 'universe.json'), JSON.stringify(universe));
  fs.writeFileSync(path.join(OUT, 'verdicts.json'), JSON.stringify({ asof: universe.asof, count: symbols.length, verdicts }));
  // Per-stock data-check audit: one row per listed security (source, history
  // depth, live-quote presence, verdict, new-listing flag). Consumed by
  // nepse-chart/data-check.html. Deterministic (no timestamps) so scheduled
  // runs only commit on real data changes.
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify({
    asof: universe.asof, count: symbols.length,
    newListings: newListings, rows: audit
  }));
  // Deterministic build id: only changes when the underlying data changes,
  // so scheduled runs commit (and trigger a Pages rebuild) only on real updates.
  const crypto = require('crypto');
  const sig = crypto.createHash('sha1')
    .update(fs.readFileSync(path.join(OUT, 'universe.json')))
    .update(fs.readFileSync(path.join(OUT, 'verdicts.json')))
    .digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ v: universe.asof + '-' + sig, asof: universe.asof }));

  const uBytes = fs.statSync(path.join(OUT, 'universe.json')).size;
  const vBytes = fs.statSync(path.join(OUT, 'verdicts.json')).size;
  const ltpFiles = fs.readdirSync(LTP_DIR).length;

  const lines = [];
  lines.push('NEPSE universe build — ' + new Date().toISOString());
  lines.push('duration: ' + Math.round((Date.now() - t0) / 1000) + 's');
  lines.push('data asof: ' + universe.asof);
  lines.push('');
  lines.push('universe symbols (currently listed): ' + report.total);
  lines.push('  monthly-only historical symbols excluded: ' + monthlyOnly.length);
  lines.push('  new listings vs last build: ' + (newListings.length ? newListings.join(', ') : 'none'));
  lines.push('  with scraper OHLC : ' + report.ohlc);
  lines.push('  LTP-only fallback : ' + report.ltpOnly.length + ' (files in data/ltp: ' + ltpFiles + ')');
  lines.push('  no data at all    : ' + report.failures.length);
  lines.push('');
  lines.push('by instrument type:');
  Object.keys(report.byType).sort().forEach((t) => lines.push('  ' + t + ': ' + report.byType[t]));
  lines.push('');
  lines.push('by verdict:');
  ['Strong Buy', 'Buy', 'Hold', 'Exit / Reduce', 'Strong Exit', 'Insufficient history'].forEach((k) =>
    lines.push('  ' + k + ': ' + (report.byVerdict[k] || 0)));
  lines.push('');
  lines.push('file sizes: universe.json ' + (uBytes / 1024).toFixed(1) + 'KB, verdicts.json ' + (vBytes / 1024).toFixed(1) + 'KB');
  lines.push('');
  lines.push('LTP-only symbols (' + report.ltpOnly.length + '):');
  report.ltpOnly.forEach((s) => lines.push('  ' + s));
  lines.push('');
  lines.push('Insufficient history (' + report.insufficient.length + '):');
  report.insufficient.forEach((s) => lines.push('  ' + s));
  lines.push('');
  lines.push('Fetch failures — no OHLC and no monthly data (' + report.failures.length + '):');
  report.failures.forEach((s) => lines.push('  ' + s));
  const text = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'nepse-universe-report.txt'), text);
  console.log('\n' + text);
}

if (require.main === module) {
  main().catch((e) => { console.error('BUILD FAILED:', e); process.exit(1); });
}
