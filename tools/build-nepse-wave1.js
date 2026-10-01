#!/usr/bin/env node
/* NEPSE Alpha Lab — Wave 1 market-intelligence builder.
 *
 * Computes the market summary, RSI extremes and "moves the most" lists
 * from the existing data files and the open OHLC history, and writes one
 * static file the pages load directly:
 *   nepse-chart/data/wave1.json
 *
 * Sources (nothing fabricated):
 *   nepse-chart/data/live.json      — last session index + per-security quotes
 *                                     (advancers/decliners, gainers, losers,
 *                                     turnover leaders)
 *   nepse-chart/data/verdicts.json  — per-symbol RSI(14) from the daily batch
 *                                     (oversold/overbought, lowest/highest)
 *   Nepse-All-Scraper price history — last 20 OHLC sessions per symbol for
 *                                     the average daily range ("moves most").
 *   nepse-chart/data/universe.json  — company names.
 *   nepse-chart/data/audit.json     — which symbols have OHLC history.
 *
 * Freshness is honest: the market section is one session (the live.json
 * session); RSI values come from each symbol's own latest scored session;
 * the movers list uses each symbol's own last 20 sessions and records the
 * session count and end date per symbol.
 *
 * Node 18+, no npm dependencies. Run: node tools/build-nepse-wave1.js
 * Suggested wiring: run after tools/build-nepse-universe.js in the daily
 * nepse-universe-refresh workflow.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const OUT = path.join(DATA, 'wave1.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (NEPSE-Alpha-Lab wave1 builder)' };
const PRICE_URL = (s) =>
  'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' +
  s.replace(/\//g, '-') + '.json';
const RANGE_SESSIONS = 20;
const MOVERS_TOP = 10;
const LIST_TOP = 10;
const CONCURRENCY = 12;

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function getJSON(url, tries) {
  tries = tries == null ? 2 : tries;
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
      if (left > 0) return new Promise((r) => setTimeout(r, 700)).then(() => attempt(left - 1));
      throw e;
    });
  };
  return attempt(tries);
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0, failed = 0;
  const workers = new Array(Math.min(n, items.length)).fill(0).map(async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = null; failed++; }
    }
  });
  await Promise.all(workers);
  return { out, failed };
}

function main() {
  console.log('> Wave 1 market-intelligence builder');
  const live = readJSON(path.join(DATA, 'live.json'));
  const vj = readJSON(path.join(DATA, 'verdicts.json'));
  const uj = readJSON(path.join(DATA, 'universe.json'));
  const audit = readJSON(path.join(DATA, 'audit.json'));

  const names = {};
  (uj.symbols || []).forEach((it) => { if (it.s) names[it.s] = it.n || it.s; });
  const ohlcSyms = new Set(
    (audit.rows || []).filter((r) => r.src === 'ohlc' && r.days >= 2).map((r) => r.s)
  );

  // ---------- market section: one session from live.json ----------
  const quotes = (live.quotes || []).filter((q) => q && q.symbol);
  const sessDate = String(live.asof || '').slice(0, 10) ||
    String((live.index && live.index.last_updated) || '').slice(0, 10);
  const adv = [], dec = [], unc = [];
  quotes.forEach((q) => {
    const c = +q.percent_change;
    if (!(c >= 0) && !(c < 0)) { unc.push(q); return; }
    if (c > 0) adv.push(q);
    else if (c < 0) dec.push(q);
    else unc.push(q);
  });
  const qItem = (q) => ({
    s: q.symbol, n: names[q.symbol] || q.name || q.symbol,
    p: q.ltp == null ? null : +q.ltp, ch: q.percent_change == null ? null : +q.percent_change,
  });
  const gainers = quotes.slice().sort((a, b) => (+b.percent_change) - (+a.percent_change))
    .slice(0, LIST_TOP).map(qItem);
  const losers = quotes.slice().sort((a, b) => (+a.percent_change) - (+b.percent_change))
    .slice(0, LIST_TOP).map(qItem);
  const turnover = quotes.filter((q) => q.turnover != null).slice()
    .sort((a, b) => (+b.turnover) - (+a.turnover)).slice(0, LIST_TOP)
    .map((q) => Object.assign(qItem(q), {
      t: +q.turnover, vol: q.volume == null ? null : +q.volume,
    }));
  const idx = live.index || {};
  // Honesty guard: live.json intraday snapshots must never be presented as
  // the session close. Only a snapshot explicitly marked as the close
  // (close === true / market === 'CLOSED') counts; consumers label
  // accordingly ("as of 3:00 PM" vs intraday time).
  const isClose = live.close === true || live.market === 'CLOSED';
  const market = {
    date: sessDate,
    close: isClose,
    index: {
      value: idx.value == null ? null : +idx.value,
      change: idx.change == null ? null : +idx.change,
      pct: idx.percent_change == null ? null : +idx.percent_change,
      high: idx.high == null ? null : +idx.high,
      low: idx.low == null ? null : +idx.low,
    },
    traded: quotes.length,
    advancers: adv.length, decliners: dec.length, unchanged: unc.length,
    totalTurnover: Math.round(quotes.reduce((a, q) => a + (+q.turnover || 0), 0)),
    gainers, losers, turnover,
  };
  console.log('  market: ' + sessDate + ' adv=' + adv.length + ' dec=' + dec.length +
    ' unc=' + unc.length + ' traded=' + quotes.length);

  // ---------- RSI section: from the verdict batch ----------
  const v = vj.verdicts || {};
  const rsiRows = Object.keys(v).map((sym) => {
    const e = v[sym];
    return (typeof e.rsi === 'number' && isFinite(e.rsi)) ? {
      s: sym, n: names[sym] || sym, rsi: +e.rsi.toFixed(2),
      p: e.p == null ? null : +e.p, ch: e.ch == null ? null : +e.ch,
      asof: e.asof || vj.asof || '',
    } : null;
  }).filter(Boolean);
  const byAsc = rsiRows.slice().sort((a, b) => a.rsi - b.rsi);
  const rsi = {
    asof: vj.asof || '',
    withRsi: rsiRows.length,
    oversold: byAsc.filter((r) => r.rsi < 30),
    overbought: byAsc.filter((r) => r.rsi > 70).reverse(),
    lowest: byAsc.slice(0, LIST_TOP),
    highest: byAsc.slice().reverse().slice(0, LIST_TOP),
  };
  console.log('  rsi: withRsi=' + rsiRows.length + ' oversold=' + rsi.oversold.length +
    ' overbought=' + rsi.overbought.length);

  return { names, ohlcSyms, market, rsi, vj };
}

function avgRange(sym, hist) {
  // last RANGE_SESSIONS sessions, chronological; skip rows missing high/low
  const rows = hist.slice(-RANGE_SESSIONS);
  let sum = 0, n = 0, lastClose = null, lastDate = '';
  rows.forEach((r) => {
    const h = parseFloat(r.high), l = parseFloat(r.low), c = parseFloat(r.ltp != null ? r.ltp : r.close);
    if (isFinite(h) && isFinite(l) && h >= l) { sum += (h - l); n++; }
    if (isFinite(c)) { lastClose = c; }
    if (r.date) lastDate = r.date;
  });
  if (!n || lastClose == null || lastClose <= 0) return null;
  const avg = sum / n;
  return { avgRange: +avg.toFixed(2), rangePct: +(avg / lastClose * 100).toFixed(2), sessions: n, asof: lastDate };
}

async function buildMovers(names, ohlcSyms) {
  const syms = [...ohlcSyms].sort();
  console.log('  movers: fetching ' + syms.length + ' OHLC histories…');
  const { out, failed } = await mapPool(syms, CONCURRENCY, async (sym) => {
    const j = await getJSON(PRICE_URL(sym));
    if (!j || j.__404 || !Array.isArray(j.data) || j.data.length < 2) return null;
    const r = avgRange(sym, j.data);
    if (!r) return null;
    return Object.assign({ s: sym, n: names[sym] || sym }, r);
  });
  const rows = out.filter(Boolean).sort((a, b) => b.rangePct - a.rangePct);
  console.log('  movers: ok=' + rows.length + ' failed=' + failed);
  return {
    note: 'Ranked by ' + RANGE_SESSIONS + '-session average daily range (high minus low), as a share of the latest close.',
    computed: rows.length,
    failed,
    top: rows.slice(0, MOVERS_TOP),
  };
}

async function run() {
  const { names, ohlcSyms, market, rsi, vj } = main();
  const movers = await buildMovers(names, ohlcSyms);
  const today = new Date().toISOString().slice(0, 10);
  const out = {
    asof: market.date || vj.asof || today,
    built: today,
    sources: {
      market: 'nepse-chart/data/live.json',
      rsi: 'nepse-chart/data/verdicts.json',
      movers: 'Nepse-All-Scraper per-symbol price history (open dataset)',
    },
    market, rsi, movers,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('> wrote ' + OUT + ' (' +
    Math.round(fs.statSync(OUT).size / 1024) + ' KB)');

  // "Today on NEPSE" static snapshot removed 2026-10-01 (user request) —
  // the live dashboard below is the single source of truth.
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
