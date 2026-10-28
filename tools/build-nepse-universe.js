#!/usr/bin/env node
/* Nepse Decode: universe builder.
 *
 * Builds the full listed-security universe from the free community feeds and
 * pre-computes a compact verdict snapshot for every symbol:
 *   nepse-chart/data/universe.json   — symbol, name, instrument type, hasOHLC
 *   nepse-chart/data/verdicts.json   — compact per-symbol verdict snapshot
 *   nepse-chart/data/ltp/{SYM}.json  — LTP-only daily series for symbols the
 *                                      scraper has no OHLC for (never fabricated
 *                                      open/high/low; flagged ltpOnly).
 *
 * Engine reused verbatim from ../../js/nepse-lab.js via its node export.
 * Daily verdicts need >= 60 sessions; weekly/monthly verdicts are computed
 * on calendar-aggregated candles with minimums of 40 weeks / 36 months.
 * Symbols below the minimums get "Insufficient history" (daily) or null
 * (weekly/monthly), never a forced call.
 *
 * Node 18+, no npm dependencies. Run: node tools/build-nepse-universe.js
 */
'use strict';
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'nepse-chart', 'data');
const LTP_DIR = path.join(OUT, 'ltp');
const ENGINE = require(path.join(ROOT, 'js', 'nepse-lab.js'));
const { updateScreenerTracking } = require('./screener-tracking.js');
// --screener-only (EOD gates, 2026-10-18): run the full data assembly + verdict
// computation (verdicts.json stays fresh) but write ONLY universe.json,
// verdicts.json and the nepse-screener/index.html snapshot. Skips per-symbol
// ltp/*.json, audit.json, track-record.json, version.json and the report.txt.
const SCREENER_ONLY = process.argv.includes('--screener-only');
if (SCREENER_ONLY) console.log('  !! --screener-only: writing universe.json, verdicts.json, screener snapshot only');
// Sector lookup for the screener page (281 symbols; fail-soft to {}).
let SECTORS = {};
try {
  SECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'sector-map.json'), 'utf8'));
} catch (e) { console.log('  !! sector-map.json not loaded:', e.message); }
function secOf(sym) {
  const e = SECTORS[sym];
  // Authoritative map (tools/sector-map.json) wins; every listed security
  // belongs to exactly one real category — never "Unclassified".
  return (e && e.sector) ? e.sector : 'Others';
}

const U = {
  manifest: 'https://shubhamnpk.github.io/yonepse/data/ltp/manifest.json',
  monthly: (m) => 'https://shubhamnpk.github.io/yonepse/data/ltp/monthly/' + m + '.json',
  companies: 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/companies.json',
  prices: (s) => 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' + s.replace('/', '-') + '.json',
  live: 'https://shubhamnpk.github.io/yonepse/data/market/live.json',
};
const UA = { 'User-Agent': 'Mozilla/5.0 (NEPSE-Alpha-Lab universe builder)' };
// Proprietary archive: our own OHLC store at ~/workspace/nepse-data-archive/.
// Populated by tools/update-ohlc-archive.js (scheduled). The builder NEVER
// hits source platforms directly — it reads only our archive. No footprint.

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

// Name fallback from our OWN NEPSE archive (2026-10-16): the community live
// feed sometimes carries no name at all for a symbol (e.g. LVF2 was absent,
// so its name fell back to the bare symbol and the classifier could not tag
// it). Our eod snapshots carry the official securityName per symbol — use the
// newest files first, first name seen wins. Fail-soft to {}.
function loadOwnSecurityNames() {
  const map = {};
  try {
    const dir = path.join(os.homedir(), 'workspace', 'nepse-data-archive', 'eod');
    const files = fs.readdirSync(dir)
      .filter((f) => /^eod-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort().reverse().slice(0, 10);
    const walk = (o) => {
      if (!o) return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (typeof o === 'object') {
        if (typeof o.symbol === 'string' && typeof o.securityName === 'string'
            && o.securityName && !(o.symbol in map)) map[o.symbol] = o.securityName;
        Object.values(o).forEach(walk);
      }
    };
    files.forEach((f) => { try { walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (e) {} });
  } catch (e) {}
  return map;
}

function classify(sym, name, assetType) {
  const nm = ((name || '') + ' ' + sym);
  if (assetType === 'open_ended_mutual_fund') return 'Mutual fund';
  if (/debenture/i.test(nm)) return 'Debenture';
  // 2026-10-28 (gap-2 item 3): port of the sector builder's symbol rule,
  // extended with the UR alternative for energy-bond tickers. Bare-ticker
  // feed names carry no word for the word tests above to catch, so the
  // symbol pattern is what tags these debentures. Verified against all
  // 413 symbols: flips exactly the intended debentures, zero others.
  if (/(D|UR)\d{2,4}(\/\d{2})?(KA)?$/i.test(sym)) return 'Debenture';
  if (/\bbond\b|rinpatra/i.test(nm)) return 'Debenture';
  if (/preference/i.test(nm)) return 'Preference share';
  if (/mutual fund|mutual|yojana|scheme|\bfund\b|\bkosh\b/i.test(nm)) return 'Mutual fund';
  if (/promoter/i.test(nm)) return 'Promoter share';
  return 'Equity';
}

// Verified name/type overrides (EOD Gate 5, 2026-10-22 — Shirjan's call:
// "go with the corroborated map"). Some genuinely listed, actively traded
// instruments are absent from EVERY community feed (companies list, live
// feed, our EOD archive — root cause confirmed 2026-10-20), so their names
// can never reach classify() and a bare ticker would mistag them Equity.
// Each entry below is corroborated by two independent sources and proven to
// trade by our own broker floorsheets (see Gate 5 in main()). The map is
// authoritative wherever it exists: it also wins over a wrong feed name.
//   PCBLP    — ShareSansar "Prime Commercial Bank Limited Promoter (PCBLP)";
//              Nepalytix lists PCBLP among promoter lines. Floorsheets:
//              504,676 qty / Rs 5.54 crore in the 30 sessions to 2026-10-16.
//   PROFLP   — ShareSansar "Progressive Finance Limited Promoter Share";
//              ShareHub PROFL page (Progressive Finance Ltd). Floorsheets:
//              49,638 qty / Rs 1.01 crore in the same window.
//   SAND2085 — ShareHub symbol page: 10% Sanima Bank Limited Debenture,
//              listed 2019-06-03, 20,00,000 units. Floorsheets: 2,178 qty.
//   SBD89    — ShareHub: 10.25% Sanima Debenture 2089, listed 2022-08-30;
//              ShareSansar 2079 issue coverage. NOT SBLD89 (Siddhartha
//              Bank's 10.75% debenture — a different instrument, already in
//              the universe). Floorsheets: 100 qty (thin, but real trades).
const VERIFIED_OVERRIDES = {
  PCBLP:    { name: 'Prime Commercial Bank Limited Promoter',    type: 'Promoter share' },
  PROFLP:   { name: 'Progressive Finance Limited Promoter',      type: 'Promoter share' },
  SAND2085: { name: '10% Sanima Bank Limited Debenture 2085',    type: 'Debenture' },
  SBD89:    { name: '10.25% Sanima Debenture 2089',               type: 'Debenture' },
  // 2026-10-26 (Shirjan's call): promoter lines mistagged Equity in the
  // universe. TYPE verified by verdicts-v2 identity sector "Promoter
  // Shares" + the VPI sector-gate failures on every session they traded
  // (243/295 backfill sessions). NAMES are NOT verified in any available
  // source (NEPSE EOD securityNames, live feed, broker 1M, v2 identity,
  // community companies list all carry these as bare symbols) — so the
  // bare symbol is kept deliberately, never an invented company name.
  // Update the names when a verified source exists; the type fix stands.
  JBLBP:    { name: 'JBLBP', type: 'Promoter share' },
  KBLPO:    { name: 'KBLPO', type: 'Promoter share' },
  MLBLPO:   { name: 'MLBLPO', type: 'Promoter share' },
  RBCLPO:   { name: 'RBCLPO', type: 'Promoter share' },
  // 2026-10-28 (gap-2 item 3): universe type-tag corrections. Each entry
  // corroborated by two independent sources (evidence:
  // hidden_files/gap2-items/type-tags.md). SCBD/NIFRAGED match no symbol
  // rule (no digits); CMF2/H8020/LSH12/NMB50/RBBF40 carry no fund word in
  // any available name or are absent from the official close; RURU's
  // feed asset_type is wrong (hydro equity, not a fund) and the override
  // wins outright, which also protects it against future feed relapses.
  // All 8 are already in the union, so Gate 5's floorsheet-admission
  // rule below does not apply to them.
  SCBD:     { name: '10.30% Standard Chartered Bank Limited Debenture', type: 'Debenture' },
  NIFRAGED: { name: 'Nifra Green Energy Debenture 6% - 2088/89',        type: 'Debenture' },
  CMF2:     { name: 'Citizens Mutual Fund 2',                          type: 'Mutual fund' },
  H8020:    { name: 'Himalayan 80-20',                                 type: 'Mutual fund' },
  LSH12:    { name: 'LS Horizon 12',                                   type: 'Mutual fund' },
  NMB50:    { name: 'NMB 50',                                          type: 'Mutual fund' },
  RBBF40:   { name: 'RBB Focus 40',                                    type: 'Mutual fund' },
  RURU:     { name: 'Ru Ru Jalbidhyut Pariyojana Limited',             type: 'Equity' },
};

// ---- buy-call track record (no-lookahead backtest) ----
// For each EQUITY security with >= 80 OHLC sessions: replay the engine over the
// last TR_LOOKBACK sessions, using only data available at each session
// (sliced series + the index regime as of that date — no future data).
// Debentures, preference shares, mutual funds and promoter shares are
// excluded: their prices do not trend, so ATR-based hit rates on them are
// microstructure noise, not meaningful buy calls.
// Every historical Buy/Strong Buy is scored against its own frame:
//   WIN  = +4xATR target touched before the -2xATR stop within 20 sessions
//   LOSS = stop touched first (same-session double touch counts as a loss)
//   undecided (no touch in 20 sessions) is excluded from the hit rate.
// Returns { n: decided calls, w: hit rate } or null when fewer than
// TR_MINCALLS decided calls exist. setupStats accumulates per-setup
// { n, w } so engine ideas can be tuned per setup.
const TR_LOOKBACK = 250, TR_TUNE_LOOKBACK = 250, TR_FORWARD = 20, TR_MINN = 80, TR_MINCALLS = 5;
const setupStats = {}; // label -> { n, w } — eval window (most recent sessions)
const tuneSetupStats = {}; // label -> { n, w } — tune window (older sessions)
function idxRegimeAt(IDX, ymd) {
  const { daily, closes, s200 } = IDX;
  let lo = 0, hi = daily.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (daily[mid][0] <= ymd) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return closes[ans] >= s200[ans] ? 'up' : 'down';
}
function setupLabelOf(pats, divs) {
  const byRecency = (a, b) => (b.i2 || 0) - (a.i2 || 0);
  const topPat = pats.slice().sort(byRecency)[0];
  const topDiv = divs.slice().sort(byRecency)[0];
  return (topPat && topPat.label) || (topDiv && topDiv.label) || null;
}
function bumpSetup(stats, label, win) {
  const s = stats[label] || (stats[label] = { n: 0, w: 0 });
  s.n++;
  s.w += win ? 1 : 0;
}
function trackRecord(ENGINE, IDX, series, isEquity) {
  const n = series.length;
  if (!isEquity || n < TR_MINN) return null;
  // Replay one window of signal sessions. Returns { wins, decided, } and
  // fills the given per-setup stats object.
  function replay(t0, t1, stats) {
    let wins = 0, decided = 0;
    for (let t = t0; t < t1; t++) {
      const slice = series.slice(0, t + 1);
      const regime = idxRegimeAt(IDX, slice[t][0]);
      const divs = ENGINE.detectDivergences(slice);
      const pats = ENGINE.detectPatterns(slice);
      const v = ENGINE.computeVerdict({ rows: slice, divs, pats, isIndex: false, idxRegime: regime });
      if (v.label !== 'Buy' && v.label !== 'Strong Buy') continue;
      const atrA = ENGINE.atrArr(slice, 14);
      const atr = atrA[slice.length - 1];
      if (!Number.isFinite(atr) || atr <= 0) continue;
      const px = slice[t][4];
      const tp = px + 4 * atr, sl = px - 2 * atr;
      const setup = setupLabelOf(pats, divs);
      for (let j = t + 1; j <= t + TR_FORWARD; j++) {
        const h = series[j][2], l = series[j][3];
        if (l <= sl) { decided++; if (setup) bumpSetup(stats, setup, false); break; }
        if (h >= tp) { wins++; decided++; if (setup) bumpSetup(stats, setup, true); break; }
      }
    }
    return { wins: wins, decided: decided };
  }
  // Eval window: the most recent TR_LOOKBACK sessions — this is the number
  // shown on the site. Tune window: the TR_TUNE_LOOKBACK sessions before
  // that — used to check that engine changes hold up out of sample.
  const evalT0 = Math.max(60, n - TR_LOOKBACK);
  const evalT1 = n - TR_FORWARD;
  const ev = replay(evalT0, evalT1, setupStats);
  let tune = null;
  const tuneT0 = Math.max(60, n - TR_LOOKBACK - TR_TUNE_LOOKBACK);
  if (evalT0 - tuneT0 >= 50) tune = replay(tuneT0, evalT0, tuneSetupStats);
  if (ev.decided < TR_MINCALLS) return null;
  const out = { n: ev.decided, w: Math.round(ev.wins / ev.decided * 1000) / 1000 };
  if (tune && tune.decided >= TR_MINCALLS) out.tune = { n: tune.decided, w: Math.round(tune.wins / tune.decided * 1000) / 1000 };
  return out;
}

// ---- multi-timeframe verdicts (Wave 8) ----
// The same rule set, applied on weekly and monthly candles aggregated from
// the daily OHLC this builder already fetched. Minimums: 40 weekly bars,
// 36 monthly bars. LTP-only symbols and short histories get null, never a
// fabricated verdict. Price/change stay the latest daily figures (a price
// has no timeframe); the verdict, RSI, stop/target and setup are per
// timeframe. asof is the latest session the verdict's data runs through.
const TF_MIN = { w: 40, m: 36 };
function tfVerdict(agg, tf, regime, asofD) {
  const minN = TF_MIN[tf];
  if (!agg || agg.length < minN) return null;
  const divs = ENGINE.detectDivergences(agg);
  const pats = ENGINE.detectPatterns(agg);
  const v = ENGINE.computeVerdict({
    rows: agg, divs, pats, isIndex: false, idxRegime: regime,
    minN: minN, unit: tf === 'w' ? 'weeks' : 'months'
  });
  const n = agg.length, last = agg[n - 1];
  const rsiA = ENGINE.rsiArr(agg.map((r) => r[4]), 14);
  let sl = null, tp = null;
  const atrA = ENGINE.atrArr(agg, 14);
  const atr = atrA[n - 1];
  if (Number.isFinite(atr) && atr > 0) { sl = r2(last[4] - 2 * atr); tp = r2(last[4] + 4 * atr); }
  const byRecency = (a, b) => (b.i2 || 0) - (a.i2 || 0);
  const topPat = pats.slice().sort(byRecency)[0];
  const topDiv = divs.slice().sort(byRecency)[0];
  return {
    v: v.label, s: v.score, rsi: r2(rsiA[n - 1]),
    sl: sl, tp: tp, setup: (topPat && topPat.label) || (topDiv && topDiv.label) || null,
    n: n, asof: asofD
  };
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

  // ---- Proprietary OHLC archive: fills gaps when community monthly files lag ----
  // Reads ONLY from our own archive at ~/workspace/nepse-data-archive/.
  // The archive is populated by tools/update-ohlc-archive.js (scheduled job).
  // The builder never contacts source platforms directly — no footprint.
  // Merges into monthlySeries: only fills missing dates, never overwrites.
  console.log('> proprietary OHLC archive…');
  try {
    const archDir = '/home/hatch/workspace/nepse-data-archive';
    let archFilled = 0;
    if (fs.existsSync(archDir)) {
      const files = fs.readdirSync(archDir).filter(f => f.endsWith('.json'));
      files.forEach((fn) => {
        try {
          const arch = JSON.parse(fs.readFileSync(path.join(archDir, fn), 'utf8'));
          Object.keys(arch.data || {}).forEach((sym) => {
            let m = monthlySeries.get(sym);
            if (!m) { m = new Map(); monthlySeries.set(sym, m); }
            arch.data[sym].forEach((r) => {
              const ymd = ymdNum(r.date);
              if (ymd && r.close && !m.has(ymd)) {
                m.set(ymd, [r.close, r.volume || 0, r.amount || 0, 0]);
                archFilled++;
              }
            });
          });
        } catch (e) { /* skip bad files */ }
      });
    }
    console.log('  archive filled:', archFilled, 'date-points');
  } catch (e) {
    console.log('  !! archive read failed:', e.message, '(continuing with community data)');
  }

  // ---- union universe: currently-listed securities only ----
  // companies.json (scraper's listed list) ∪ live feed symbols. Symbols that
  // appear ONLY in monthly history are delisted/renamed and are excluded.
  const union = new Set();
  companies.forEach((s) => union.add(s));
  Object.keys(liveMap).forEach((s) => union.add(s));
  // EOD Gate 4 (2026-10-18): union our own validated close into the symbol set.
  // Feed-lagged scrips (2026-10-16: BENH vanished from the community feeds for a
  // day) must never drop out of the universe again. Gated on a CLOSED session so
  // a stale or partial intraday file can't inject symbols. The completed-merger
  // absorbed filter runs AFTER this union, as before. Honest boundary: symbols
  // absent from ALL sources are NOT restored by this gate — the four such
  // scrips verified in Oct 2026 (PCBLP/PROFLP/SAND2085/SBD89) are restored by
  // Gate 5 below under their own stricter rule, never by invention here.
  // Name-supply (2026-10-28, gap-2 item 3): the same closed file also
  // supplies descriptive names where the community feed name is missing or
  // bare — this is what lets the fund-word rules tag C30MF/LVF2/NIBLGF/
  // SFEF/SFMF/SIGS2 and the bond/rinpatra rules tag NMBUR93/94. Only
  // names that differ from the symbol are kept; fail-soft to {}.
  const officialNames = {};
  try {
    const ownLive = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepse-chart', 'data', 'live.json'), 'utf8'));
    if (ownLive.market === 'CLOSED' && Array.isArray(ownLive.quotes)) {
      let gate4Added = 0;
      ownLive.quotes.forEach((q) => { if (q && q.symbol && !union.has(q.symbol)) { union.add(q.symbol); gate4Added++; } });
      ownLive.quotes.forEach((q) => { if (q && q.symbol && q.name && q.name.trim() !== q.symbol) officialNames[q.symbol] = q.name.trim(); });
      if (gate4Added) console.log('  Gate 4: +' + gate4Added + ' symbols from own validated close (live.json)');
    }
  } catch (e) { console.log('  Gate 4: own live.json unavailable:', e.message); }
  // EOD Gate 5 (2026-10-22): floorsheet-proven scrips with verified names.
  // A symbol from VERIFIED_OVERRIDES joins the union ONLY when our own
  // broker floorsheet aggregates (nepse-brokers/data/periods/1M.json —
  // trailing 30 sessions, built from Chukul raw floorsheets) prove it
  // actually traded in that window. Both conditions are required: the map
  // alone never admits an untraded ticker, and floorsheet presence alone
  // never admits an unverified name (the 1M file carries ~38 further
  // promoter/debenture lines still awaiting the same verification — they
  // stay out until their map entries are approved). The completed-merger
  // absorbed filter still runs after this union.
  try {
    const p1m = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepse-brokers', 'data', 'periods', '1M.json'), 'utf8'));
    const traded = (p1m && p1m.symbols) ? new Set(Object.keys(p1m.symbols)) : new Set();
    let gate5Added = 0;
    Object.keys(VERIFIED_OVERRIDES).forEach((s) => {
      if (traded.has(s) && !union.has(s)) { union.add(s); gate5Added++; console.log('  Gate 5: +' + s + ' (floorsheet-proven, verified override)'); }
    });
    if (gate5Added) console.log('  Gate 5: +' + gate5Added + ' symbols from broker floorsheets + verified override map');
  } catch (e) { console.log('  Gate 5: broker 1M periods unavailable:', e.message); }
  const monthlyOnly = [];
  monthlySeries.forEach((_, s) => { if (!union.has(s)) monthlyOnly.push(s); });
  const unionSymbols = Array.from(union).sort();
  // Completed mergers: the absorbed symbol no longer trades as a separate
  // listing (tracker: tools/verdict-engine-v2/manual/merger-tracker.json).
  // Its stock page is deleted on completion, so it must never re-enter the
  // universe even if the source feeds still carry it (2026-10-08: stale
  // WNLB->SLBBL and SFCL->PFL entries broke CI's zero-broken-links gate).
  const mergerTrackerAbsorbed = (() => {
    try {
      const tracker = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'verdict-engine-v2', 'manual', 'merger-tracker.json'), 'utf8'));
      return (tracker.completed_mergers || []).map((m) => m.absorbed).filter(Boolean);
    } catch (e) { console.log('  merger-tracker unavailable, skipping exclusion:', e.message); return []; }
  })();
  const absorbedSet = new Set(mergerTrackerAbsorbed);
  const symbols = unionSymbols.filter((s) => !absorbedSet.has(s));
  if (mergerTrackerAbsorbed.length) console.log('  completed mergers excluded:', mergerTrackerAbsorbed.filter((s) => unionSymbols.includes(s)).join(', ') || '(none present)');
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

  // ---- Merge official closing session (2026-09-30) ----
  // After market close, nepse-chart/data/live.json holds the validated official
  // quotes. If the community OHLC history hasn't ingested the new session yet,
  // append the official close as the latest row so verdicts, signal history,
  // and page dates reflect the actual latest closed session. The official API
  // never publishes the session open — it stays 0 (never invented); the
  // verdict engine scores on high/low/close only.
  let officialCloseDate = null;
  try {
    const liveJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepse-chart', 'data', 'live.json'), 'utf8'));
    const mClose = /^(\d{4})-(\d{2})-(\d{2})/.exec(liveJ.asof || '');
    if (mClose && liveJ.market === 'CLOSED' && Array.isArray(liveJ.quotes)) {
      const closeYmd = +(mClose[1] + mClose[2] + mClose[3]);
      const qmap = {};
      liveJ.quotes.forEach((q) => { if (q && q.symbol) qmap[q.symbol] = q; });
      let merged = 0;
      for (const [sym, rows] of ohlcRows) {
        if (!rows || !rows.length) continue;
        if (rows[rows.length - 1][0] >= closeYmd) continue;
        const q = qmap[sym];
        if (!q || !(+q.ltp > 0)) continue;
        rows.push([closeYmd, 0, +q.high || +q.ltp, +q.low || +q.ltp, +q.ltp, +q.volume || 0, +q.turnover || 0]);
        merged++;
      }
      console.log('  Official close merged:', merged + ' symbols @ ' + closeYmd);
      // The universe asof follows the latest session actually present.
      if (merged > 0) officialCloseDate = mClose[1] + '-' + mClose[2] + '-' + mClose[3];
    }
  } catch (e) {
    console.log('  Official-close merge skipped:', e.message);
  }

  // ---- index rows for market-regime factor ----
  const dailySrc = fs.readFileSync(path.join(ROOT, 'js', 'nepse-daily.js'), 'utf8');
  const mIdx = dailySrc.match(/window\.NEPSE_DAILY=(\[[\s\S]*?\]);?\s*$/);
  if (!mIdx) throw new Error('could not parse nepse-daily.js');
  const idxDaily = JSON.parse(mIdx[1]); // [YYYYMMDD,o,h,l,c,volume]
  const idxCloses = idxDaily.map((r) => r[4]);
  const idxS200 = ENGINE.smaArr(idxCloses, 200);
  const idxRegime = idxCloses[idxCloses.length - 1] >= idxS200[idxS200.length - 1] ? 'up' : 'down';
  console.log('  index sessions:', idxDaily.length, '| regime:', idxRegime);
  const IDX = { daily: idxDaily, closes: idxCloses, s200: idxS200 };
  // Weekly/monthly index regime for the multi-timeframe verdicts: the same
  // SMA200 backdrop rule, applied on each timeframe's own clock.
  const idxWeekly = ENGINE.toWeekly(idxDaily);
  const idxMonthly = ENGINE.toMonthly(idxDaily);
  function tfRegime(agg) {
    const closes = agg.map((r) => r[4]);
    const s200 = ENGINE.smaArr(closes, 200);
    const n = closes.length;
    if (n && s200[n - 1] != null) return closes[n - 1] >= s200[n - 1] ? 'up' : 'down';
    return idxRegime; // too little aggregated history: fall back to the daily read
  }
  const idxRegimeW = tfRegime(idxWeekly), idxRegimeM = tfRegime(idxMonthly);
  console.log('  index weekly bars:', idxWeekly.length, '| monthly bars:', idxMonthly.length,
    '| regimes W/M:', idxRegimeW + '/' + idxRegimeM);

  // ---- build outputs ----
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(LTP_DIR, { recursive: true });

  // The universe asof follows the latest session actually present: the official
  // close (if merged) wins over the community manifest date.
  const universe = { asof: officialCloseDate || manifest.latestDate || fmtD(idxDaily[idxDaily.length - 1][0]), count: symbols.length, symbols: [] };
  const verdicts = {};
  const audit = []; // per-stock data-check rows for data-check.html
  const report = {
    total: symbols.length, ohlc: ohlcCount, ltpOnly: [], insufficient: [], failures: [],
    byType: {}, byVerdict: {}, debByType: {}
  };

  let done = 0;
  const ownNames = loadOwnSecurityNames();
  console.log('  own-archive securityNames:', Object.keys(ownNames).length);
  for (const sym of symbols) {
    const q = liveMap[sym];
    // Verified override (Gate 5) wins outright; else community name when
    // present; otherwise the own official-close name when descriptive
    // (gap-2 item 3 name-supply — never overwrites a descriptive feed
    // name); otherwise our own NEPSE archive's securityName (never the
    // bare symbol — it defeats classify()).
    const ovr = VERIFIED_OVERRIDES[sym];
    const name = ovr ? ovr.name : ((q && q.name && q.name !== sym) ? q.name : (officialNames[sym] || ownNames[sym] || sym));
    const type = ovr ? ovr.type : classify(sym, name, q && q.asset_type);
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
        if (!SCREENER_ONLY) fs.writeFileSync(path.join(LTP_DIR, sym.replace('/', '-') + '.json'),
          JSON.stringify({ s: sym, ltpOnly: true, rows: compact }));
      }
    }

    universe.symbols.push({ s: sym, n: name, t: type, o: rows ? 1 : 0 });
    report.byType[type] = (report.byType[type] || 0) + 1;
    const liveFlag = liveMap[sym] ? 1 : 0;
    const isNew = newSet.has(sym) ? 1 : 0;

    if (!series || !series.length) {
      report.failures.push(sym);
      verdicts[sym] = { v: 'Insufficient history', s: null, p: null, ch: null, h52: null, l52: null, pos: null, rsi: null, n: 0, l: 0, asof: universe.asof, sec: secOf(sym), vol: null, volAvg: null, sl: null, tp: null, setup: null, w: null, m: null };
      report.byVerdict['Insufficient history'] = (report.byVerdict['Insufficient history'] || 0) + 1;
      report.insufficient.push(sym + ' (0)');
      audit.push({ s: sym, n: name, t: type, src: 'none', days: 0, lp: null, ld: null, verdict: 'Insufficient history', live: liveFlag, isNew });
      continue;
    }

    const n = series.length;
    const last = series[n - 1], prev = series[n - 2] || last;
    const price = last[4];
    const chgPct = prev[4] ? (last[4] - prev[4]) / prev[4] * 100 : 0;
    // Guard: no NEPSE instrument can move more than the +-10% single-session
    // circuit. Beyond that the reference price in the source feed is bad
    // (stale listing reference, bad previous close) — never display it as a
    // session move; show no change figure instead. Only applied to
    // established series (n >= 3) so genuine listing-day pops are untouched.
    const chgOut = (n >= 3 && Math.abs(chgPct) > 10) ? null : r2(chgPct);
    const win = series.slice(-252);
    let h52 = -Infinity, l52 = Infinity;
    win.forEach((x) => { if (x[2] > h52) h52 = x[2]; if (x[3] < l52) l52 = x[3]; });
    const pos = h52 > l52 ? (price - l52) / (h52 - l52) : 0.5;
    const rsiA = ENGINE.rsiArr(series.map((r) => r[4]), 14);
    const rsi = rsiA[n - 1];

    let v, divs = [], pats = [];
    if (ltpOnly) report.ltpOnly.push(sym + ' (' + n + ')');
    if (n < 60) {
      v = { score: null, label: 'Insufficient history', cls: 'insufficient' };
      report.insufficient.push(sym + ' (' + n + ')');
    } else {
      if (!ltpOnly) {
        divs = ENGINE.detectDivergences(series);
        pats = ENGINE.detectPatterns(series);
      }
      v = ENGINE.computeVerdict({ rows: series, divs, pats, isIndex: false, idxRegime });
    }
    // ---- screener fields (uniform shape on every entry) ----
    const sec = secOf(sym);
    const vol = Number.isFinite(last[5]) ? Math.round(last[5]) : null;
    // 20-session average volume (prior sessions, for relative-volume badges)
    let volAvg = null;
    if (n >= 6) {
      const vols = series.slice(-21, -1).map((r) => r[5]).filter((x) => Number.isFinite(x) && x > 0);
      if (vols.length >= 5) volAvg = Math.round(vols.reduce((a, b) => a + b, 0) / vols.length);
    }
    let sl = null, tp = null, setup = null;
    if (!ltpOnly && n >= 60) {
      const atrA = ENGINE.atrArr(series, 14);
      const atr = atrA[n - 1];
      if (Number.isFinite(atr) && atr > 0) {
        sl = r2(price - 2 * atr);
        tp = r2(price + 4 * atr);
      }
      const byRecency = (a, b) => (b.i2 || 0) - (a.i2 || 0);
      const topPat = pats.slice().sort(byRecency)[0];
      const topDiv = divs.slice().sort(byRecency)[0];
      setup = (topPat && topPat.label) || (topDiv && topDiv.label) || null;
    }
    if (sec) report.secCount = (report.secCount || 0) + 1;
    if (sl != null && tp != null) report.sltpCount = (report.sltpCount || 0) + 1;
    // buy-call track record (OHLC history only; LTP-only has no intrabar range; equity only)
    const tr = (!ltpOnly && n >= TR_MINN) ? trackRecord(ENGINE, IDX, series, type === 'Equity') : null;
    if (tr) report.trCount = (report.trCount || 0) + 1;
    if (tr && tr.tune) { (report.tuneWs = report.tuneWs || []).push(tr.tune.w); (report.tuneNs = report.tuneNs || []).push(tr.tune.n); }
    // Multi-timeframe verdicts: weekly + monthly on aggregated candles.
    // Only for symbols with a real daily OHLC verdict (n >= 60, not LTP-only).
    let wV = null, mV = null;
    if (!ltpOnly && n >= 60) {
      wV = tfVerdict(ENGINE.toWeekly(series), 'w', idxRegimeW, fmtD(last[0]));
      mV = tfVerdict(ENGINE.toMonthly(series), 'm', idxRegimeM, fmtD(last[0]));
      if (wV) report.tfW = (report.tfW || 0) + 1;
      if (mV) report.tfM = (report.tfM || 0) + 1;
    }
    report.byVerdict[v.label] = (report.byVerdict[v.label] || 0) + 1;
    verdicts[sym] = {
      v: v.label, s: v.score, p: r2(price), ch: chgOut,
      h52: r2(h52), l52: r2(l52), pos: r2(pos), rsi: r2(rsi),
      n: n, l: ltpOnly ? 1 : 0, asof: fmtD(last[0]),
      sec: sec, vol: vol, volAvg: volAvg, sl: sl, tp: tp, setup: setup,
      tr: tr ? { n: tr.n, w: tr.w } : null,
      w: wV, m: mV
    };
    audit.push({ s: sym, n: name, t: type, src: ltpOnly ? 'ltp' : 'ohlc', days: n, lp: r2(price), ld: fmtD(last[0]), verdict: v.label, live: liveFlag, isNew });

    if (++done % 100 === 0) console.log('  verdicts: ' + done + '/' + symbols.length);
  }

  // The manifest's monthly LTP feed can lag the daily data by days, which once
  // left the whole site displaying a stale date while the data was fresh. The
  // honest "as of" for the snapshot is the session most symbols actually
  // closed on (each verdict carries its own last-session date).
  const asofVotes = {};
  for (const k of Object.keys(verdicts)) {
    const d = verdicts[k].asof;
    if (d) asofVotes[d] = (asofVotes[d] || 0) + 1;
  }
  const trueAsof = Object.keys(asofVotes).sort().reduce(
    (a, b) => (asofVotes[b] > asofVotes[a] ? b : a), universe.asof) || universe.asof;
  if (trueAsof !== universe.asof) {
    console.log('  asof corrected: ' + universe.asof + ' -> ' + trueAsof + ' (most symbols closed then)');
    universe.asof = trueAsof;
  }

  // Defensive purge (2026-10-09): completed-merger absorbed symbols must never
  // reach the derived outputs. The exclusion above covers the build loop, but a
  // tree restore resurrected stale WNLB/SFCL verdicts (months-old data) onto the
  // live screener on 2026-10-08, so purge again right before writing — loud in
  // the log, self-healing on write.
  const absorbedVerdicts = Object.keys(verdicts).filter((s) => absorbedSet.has(s));
  for (const s of absorbedVerdicts) delete verdicts[s];
  const absorbedAudits = audit.filter((r) => absorbedSet.has(r.s)).map((r) => r.s);
  for (let i = audit.length - 1; i >= 0; i--) if (absorbedSet.has(audit[i].s)) audit.splice(i, 1);
  const strayVerdicts = Object.keys(verdicts).filter((s) => symbols.indexOf(s) < 0);
  if (absorbedVerdicts.length || absorbedAudits.length) {
    console.log('  !! purged absorbed symbols from derived outputs: ' +
      Array.from(new Set(absorbedVerdicts.concat(absorbedAudits))).join(', '));
  }
  if (strayVerdicts.length) {
    console.log('  !! verdicts without universe entry (investigate): ' + strayVerdicts.join(', '));
  }

  // Screener tracking (2026-10-25): verdict archive + live call ledger.
  // Runs on the final verdicts (after purge + asof correction) so the
  // per-verdict tracking fields land in verdicts.json below. Additive
  // and non-fatal: any failure logs loudly and the universe build
  // continues without tracking — never fail the universe over this.
  let screenerChanges = null;
  try {
    screenerChanges = updateScreenerTracking({
      fs, path, OUT, verdicts, symbols, universe, ohlcRows });
  } catch (e) {
    console.log('  !! screener tracking skipped: ' + (e && e.message));
  }

  fs.writeFileSync(path.join(OUT, 'universe.json'), JSON.stringify(universe));
  fs.writeFileSync(path.join(OUT, 'verdicts.json'), JSON.stringify({ asof: universe.asof, count: symbols.length, verdicts, changes: screenerChanges }));
  // Per-stock data-check audit: one row per listed security (source, history
  // depth, live-quote presence, verdict, new-listing flag). Consumed by
  // nepse-chart/data-check.html. Deterministic (no timestamps) so scheduled
  // runs only commit on real data changes. Skipped in --screener-only mode.
  if (!SCREENER_ONLY) fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify({
    asof: universe.asof, count: symbols.length,
    newListings: newListings, rows: audit
  }));
  // Per-setup buy-call hit rates (engine tuning): only setups with >= 10
  // decided calls are published. Two windows: eval (most recent 250 sessions
  // — the number shown on the site) and tune (the 250 sessions before that —
  // the out-of-sample check for engine changes). Consumed by nothing
  // client-side yet — it is the tuning dataset for tweaking engine ideas.
  function setupRowsOf(stats) {
    return Object.keys(stats)
      .map((label) => ({ label, n: stats[label].n, w: Math.round(stats[label].w / stats[label].n * 1000) / 1000 }))
      .filter((r) => r.n >= 10)
      .sort((a, b) => b.w - a.w || b.n - a.n);
  }
  function winSummary(ws, ns) {
    if (!ws.length) return null;
    const avg = ws.reduce((a, b) => a + b, 0) / ws.length;
    const sorted = ws.slice().sort((a, b) => a - b);
    return {
      securities: ws.length,
      calls: ns.reduce((a, b) => a + b, 0),
      mean: Math.round(avg * 1000) / 1000,
      median: sorted[Math.floor(sorted.length / 2)]
    };
  }
  const evalWs = [], evalNs = [];
  Object.keys(verdicts).forEach((sym) => { const t = verdicts[sym].tr; if (t) { evalWs.push(t.w); evalNs.push(t.n); } });
  const evalRows = setupRowsOf(setupStats), tuneRows = setupRowsOf(tuneSetupStats);
  // Skipped in --screener-only mode (tuning dataset, not a site dependency).
  if (!SCREENER_ONLY) fs.writeFileSync(path.join(OUT, 'track-record.json'), JSON.stringify({
    asof: universe.asof,
    method: 'Buy/Strong Buy replayed per signal session; win = +4xATR target before -2xATR stop within 20 sessions (daily high/low); undecided excluded; min 10 decided calls per setup.',
    eval: Object.assign({ window: 'most recent 250 sessions' }, winSummary(evalWs, evalNs) || {}, { setups: evalRows }),
    tune: Object.assign({ window: '250 sessions before the eval window' }, winSummary(report.tuneWs || [], report.tuneNs || []) || {}, { setups: tuneRows })
  }));
  // ---- static "top 10" snapshot for SEO ----
  // The interactive table renders via JavaScript, which crawlers read slowly.
  // This bakes a plain-HTML snapshot of the day's top-ranked signals into
  // nepse-screener/index.html (between SNAP-START / SNAP-END markers) so
  // search engines see real content immediately. Refreshed by every build.
  // The scheduled workflow must `git add nepse-screener/index.html` too.
  (function writeSnapshot() {
    const RANK = { 'Strong Buy': 0, 'Buy': 1, 'Hold': 2, 'Exit / Reduce': 3, 'Strong Exit': 4, 'Insufficient history': 5 };
    const rows = symbols
      .map((sym) => ({ sym, e: verdicts[sym] }))
      .filter((r) => r.e && (r.e.v === 'Strong Buy' || r.e.v === 'Buy'))
      .sort((a, b) => (RANK[a.e.v] - RANK[b.e.v]) || ((b.e.s || 0) - (a.e.s || 0)))
      .slice(0, 10);
    const trs = rows.map((r, i) => {
      const e = r.e;
      const ch = e.ch == null ? '–' : (e.ch >= 0 ? '+' : '') + e.ch.toFixed(2) + '%';
      return '      <tr><td>' + (i + 1) + '</td>' +
        '<td><a href="/nepse-chart/?s=' + r.sym + '">' + r.sym + '</a></td>' +
        '<td>' + (e.p == null ? '–' : e.p.toFixed(2)) + '</td>' +
        '<td>' + ch + '</td>' +
        '<td>' + e.v + '</td>' +
        '<td>' + (e.setup ? e.setup : '–') + '</td>' +
        '<td>' + (e.sl == null ? '–' : e.sl.toFixed(2)) + '</td>' +
        '<td>' + (e.tp == null ? '–' : e.tp.toFixed(2)) + '</td></tr>';
    }).join('\n');
    // When the market-regime gate blocks every Buy, say so plainly instead of
    // rendering an empty table.
    const bodyRows = rows.length ? trs :
      '      <tr><td colspan="8">No buy signals in this snapshot &middot; the NEPSE index is below its 200-day average, so the engine is standing aside. The full interactive table below still ranks every security.</td></tr>';
    const frag = '<section class="sc-top10" aria-label="Top ranked signals">\n' +
      '    <h2>Top 10 ranked signals <span class="sc-asof-inline">&middot; ' + universe.asof + '</span></h2>\n' +
      '    <div class="table-scroll"><table class="sc-table">\n' +
      '      <caption class="visually-hidden">Top 10 ranked NEPSE signals from the daily snapshot</caption>\n' +
      '      <thead><tr><th scope="col">#</th><th scope="col">Symbol</th><th scope="col">Price</th><th scope="col">Change</th><th scope="col">Signal</th><th scope="col">Setup</th><th scope="col">Stop loss</th><th scope="col">Target</th></tr></thead>\n' +
      '      <tbody>\n' + bodyRows + '\n      </tbody>\n' +
      '    </table></div>\n' +
      '    <p class="sc-static-note">Static daily snapshot &middot; the full interactive ranking of ' + symbols.length +
      ' securities, with hit-rate tracking and filters, is below.</p>\n' +
      '  </section>';
    const p = path.join(ROOT, 'nepse-screener', 'index.html');
    let html = fs.readFileSync(p, 'utf8');
    const a = html.indexOf('<!-- SNAP-START -->'), b = html.indexOf('<!-- SNAP-END -->');
    if (a < 0 || b < 0 || b < a) { console.log('  !! snapshot markers missing in nepse-screener/index.html'); return; }
    html = html.slice(0, a + '<!-- SNAP-START -->'.length) + '\n  ' + frag + '\n  ' + html.slice(b);
    fs.writeFileSync(p, html);
    console.log('  snapshot: top-10 fragment written into nepse-screener/index.html');
  })();
  // Deterministic build id: only changes when the underlying data changes,
  // so scheduled runs commit (and trigger a Pages rebuild) only on real updates.
  // Skipped in --screener-only mode.
  const crypto = require('crypto');
  const sig = crypto.createHash('sha1')
    .update(fs.readFileSync(path.join(OUT, 'universe.json')))
    .update(fs.readFileSync(path.join(OUT, 'verdicts.json')))
    .digest('hex').slice(0, 12);
  if (!SCREENER_ONLY) fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ v: universe.asof + '-' + sig, asof: universe.asof }));

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
  lines.push('screener fields:');
  lines.push('  symbols with sector (sec) : ' + (report.secCount || 0));
  lines.push('  symbols with stop/target (sl/tp): ' + (report.sltpCount || 0));
  lines.push('  symbols with buy-call track record: ' + (report.trCount || 0));
  lines.push('  symbols with weekly verdict (>=40 weeks): ' + (report.tfW || 0));
  lines.push('  symbols with monthly verdict (>=36 months): ' + (report.tfM || 0));
  lines.push('');
  lines.push('buy-call track record (win = +4xATR before -2xATR within 20 sessions):');
  function winLines(tag, ws, ns, rows) {
    if (!ws.length) { lines.push('  ' + tag + ': none'); return; }
    const avg = ws.reduce((a, b) => a + b, 0) / ws.length;
    const sorted = ws.slice().sort((a, b) => a - b);
    lines.push('  ' + tag + ': ' + ws.length + ' securities, ' + ns.reduce((a, b) => a + b, 0) + ' decided calls');
    lines.push('    mean hit rate: ' + (avg * 100).toFixed(1) + '% | median: ' + (sorted[Math.floor(sorted.length / 2)] * 100).toFixed(1) + '%');
    rows.forEach((r) => lines.push('    ' + (r.w * 100).toFixed(1) + '%  (' + r.n + ' calls)  ' + r.label));
  }
  winLines('EVAL (most recent 250 sessions)', evalWs, evalNs, evalRows);
  winLines('TUNE (250 sessions before eval)', report.tuneWs || [], report.tuneNs || [], tuneRows);
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
  if (!SCREENER_ONLY) fs.writeFileSync(path.join(__dirname, 'nepse-universe-report.txt'), text);
  console.log('\n' + text);
}

if (require.main === module) {
  main().catch((e) => { console.error('BUILD FAILED:', e); process.exit(1); });
} else {
  module.exports = { trackRecord, idxRegimeAt, setupLabelOf, TR_LOOKBACK, TR_FORWARD, TR_MINN, TR_MINCALLS, setupStats, tuneSetupStats };
}
