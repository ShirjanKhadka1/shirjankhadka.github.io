/* Nepse Decode Signal Engine — transparent rule-based signal systems.
 *
 * Three systems, each with published rules (see SYSTEMS below):
 *   momentum    — rides established uptrends (Donchian breakout + trend filter)
 *   trend-relay — catches the start of a new uptrend (SMA20/SMA50 cross + volume)
 *   reversal    — mean-reversion in falling/sideways markets (oversold bounce)
 *
 * Data: per-symbol daily OHLCV from the open samirwagle/Nepse-All-Scraper
 * dataset (MIT). Benchmark: NEPSE index daily (window.NEPSE_DAILY).
 *
 * Honesty rules baked in:
 *  - No lookahead: every signal uses data up to and including the signal day;
 *    entries are taken at the signal day's close.
 *  - Corporate-action guard: entries are skipped for 5 sessions after an
 *    overnight gap larger than 12% (beyond NEPSE's 10% circuit), because the
 *    scraper series is not split-adjusted and such gaps are bonus/rights
 *    adjustments, not real breakouts.
 *  - Costs: 0.5% round-trip (broker + SEBON + DP, simplified) on every trade.
 *  - Only symbols with >= 250 sessions are backtested.
 *
 * Output: nepse-chart/data/signals/<system>.json with stats, equity curve,
 * open positions (today's alerts) and closed trades.
 *
 * Usage: node tools/build-signals.js [--system=momentum] [--no-fetch]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO, 'nepse-chart', 'data', 'signals');
const CACHE_DIR = path.join(REPO, 'tools', '.cache', 'signals');
const API = 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/';

const START_CAPITAL = 10000000; // Rs 1 Cr
const MAX_POSITIONS = 10;
const POSITION_NOTIONAL = 1000000; // Rs 10 L per position
const ROUNDTRIP_COST = 0.005; // 0.5%
const MIN_SESSIONS = 250;
const CA_GAP = 0.12; // overnight gap flagging corporate actions
const CA_COOLDOWN = 5; // sessions to skip entries after a CA gap

/* ------------------------------- systems ------------------------------- */

const SYSTEMS = {
  momentum: {
    title: 'Momentum Signal',
    tagline: 'Built for uptrending markets. Rides established trends with a trailing exit.',
    rules: [
      'Setup: close above 50-day SMA and 20-day SMA above 50-day SMA (trend aligned)',
      'Trigger: close prints a 50-session highest close (breakout)',
      'Filter: RSI(14) between 55 and 80, 20-day avg turnover above Rs 10 lakh',
      'Stop: 2 × ATR(14) below entry. Trail: exit when close breaks the 20-session lowest close',
      'Targets: T1 = entry + 1.5 × risk, T2 = entry + 3 × risk',
    ],
  },
  'trend-relay': {
    title: 'Trend Relay',
    tagline: 'Built for the beginning of an uptrend. Catches the turn with volume confirmation.',
    rules: [
      'Setup: price below 50-day SMA for at least 20 of the last 30 sessions (was weak)',
      'Trigger: 20-day SMA crosses above 50-day SMA with volume over 1.5 × 20-day average',
      'Filter: 20-day avg turnover above Rs 10 lakh',
      'Stop: 2 × ATR(14) below entry. Trail: 20-day SMA cross back below 50-day SMA, or 3 closes under the 50-day SMA',
      'Targets: T1 = entry + 1.5 × risk, T2 = entry + 3 × risk',
    ],
  },
  reversal: {
    title: 'Reversal Signal',
    tagline: 'Built for falling and sideways markets. Buys oversold bounces, exits at the mean.',
    rules: [
      'Setup: RSI(14) below 30 and close below the lower Bollinger Band (20, 2)',
      'Trigger: bullish candle (close > open) closing in the top half of its range (rejection)',
      'Filter: 20-day avg turnover above Rs 10 lakh',
      'Stop: 1.5 × ATR(14) below entry (tighter — mean reversion). Trail: none; exit at the mean',
      'Targets: T1 = 20-day SMA (the mean), T2 = entry + 2 × risk. Exit early if RSI(14) crosses above 55',
    ],
  },
};

/* ------------------------------- fetching ------------------------------ */

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NepseDecode-SignalEngine/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getSymbolData(symbol, noFetch) {
  const cachePath = path.join(CACHE_DIR, symbol.replace('/', '-') + '.json');
  if (fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) { /* refetch */ }
  }
  if (noFetch) return null;
  const url = API + symbol.replace('/', '-') + '.json';
  const data = await fetchJson(url);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(data));
  return data;
}

/* ------------------------------ indicators ----------------------------- */

function sma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= n) sum -= vals[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(vals, n) {
  const out = new Array(vals.length).fill(null);
  const k = 2 / (n + 1);
  let e = null;
  for (let i = 0; i < vals.length; i++) {
    e = e === null ? vals[i] : vals[i] * k + e * (1 - k);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}

function rsi(closes, n) {
  const out = new Array(closes.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1];
    gain += Math.max(chg, 0);
    loss += Math.max(-chg, 0);
    if (i < n) continue;
    if (i === n) { gain /= n; loss /= n; }
    else { gain = (gain * (n - 1) + Math.max(chg, 0)) / n; loss = (loss * (n - 1) + Math.max(-chg, 0)) / n; }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function atr(bars, n) {
  const out = new Array(bars.length).fill(null);
  let a = null;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    );
    a = a === null ? tr : (a * (n - 1) + tr) / n;
    if (i >= n) out[i] = a;
  }
  return out;
}

function bollinger(closes, n, mult) {
  const mid = sma(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += Math.pow(closes[j] - mid[i], 2);
    const sd = Math.sqrt(sum / n);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

function highestHigh(closes, n, i) {
  let m = -Infinity;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) if (closes[j] > m) m = closes[j];
  return m;
}
function lowestLow(closes, n, i) {
  let m = Infinity;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) if (closes[j] < m) m = closes[j];
  return m;
}

/* --------------------------- signal generation ------------------------- */
/* Each generator returns per-bar {entry:boolean, exit:boolean, stop, t1, t2}
 * using only data up to bar i (no lookahead). Entries are taken at bar i's
 * close. Exits are evaluated on subsequent bars' closes. */

function genSignals(system, d) {
  const n = d.c.length;
  const entry = new Array(n).fill(false);
  const exitS = new Array(n).fill(false);
  const stop = new Array(n).fill(null);
  const t1 = new Array(n).fill(null);
  const t2 = new Array(n).fill(null);

  for (let i = 60; i < n; i++) {
    if (d.ca[i]) continue; // corporate-action cooldown: no new entries
    const liq = d.turn20[i] !== null && d.turn20[i] > 1000000; // Rs 10L avg turnover
    if (system === 'momentum') {
      const setup = d.c[i] > d.sma50[i] && d.sma20[i] > d.sma50[i];
      const prevHigh = highestHigh(d.c, 50, i - 1); // prior 50 sessions, excl. today
      const breakout = prevHigh !== null && d.c[i] > prevHigh;
      const rsiOk = d.rsi[i] !== null && d.rsi[i] >= 55 && d.rsi[i] <= 80;
      if (setup && breakout && rsiOk && liq) {
        entry[i] = true;
        const risk = 2 * d.atr[i];
        stop[i] = d.c[i] - risk;
        t1[i] = d.c[i] + 1.5 * risk;
        t2[i] = d.c[i] + 3 * risk;
      }
      // trailing exit evaluated per open position in the simulator
    } else if (system === 'trend-relay') {
      // was weak: below sma50 for >=20 of last 30 sessions
      let weak = 0;
      for (let j = i - 29; j <= i; j++) if (d.c[j] < d.sma50[j]) weak++;
      const cross = d.sma20[i - 1] <= d.sma50[i - 1] && d.sma20[i] > d.sma50[i];
      const volOk = d.v[i] > 1.5 * d.vma20[i];
      if (weak >= 20 && cross && volOk && liq) {
        entry[i] = true;
        const risk = 2 * d.atr[i];
        stop[i] = d.c[i] - risk;
        t1[i] = d.c[i] + 1.5 * risk;
        t2[i] = d.c[i] + 3 * risk;
      }
    } else if (system === 'reversal') {
      const oversold = d.rsi[i] !== null && d.rsi[i] < 30;
      const belowBand = d.bbL[i] !== null && d.c[i] < d.bbL[i];
      const bullish = d.c[i] > d.o[i];
      const range = d.h[i] - d.l[i];
      const rejection = range > 0 && d.c[i] > d.l[i] + 0.5 * range;
      if (oversold && belowBand && bullish && rejection && liq) {
        entry[i] = true;
        const risk = 1.5 * d.atr[i];
        stop[i] = d.c[i] - risk;
        t1[i] = d.sma20[i]; // the mean
        t2[i] = d.c[i] + 2 * risk;
      }
    }
  }
  return { entry, exitS, stop, t1, t2 };
}

/* ------------------------------ simulator ------------------------------ */
/* One shared portfolio per system across all symbols: Rs 1 Cr, max 10
 * concurrent positions, Rs 10 L notional each, 0.5% round-trip cost. */

function simulate(system, symbols, dataMap) {
  let cash = START_CAPITAL;
  const open = []; // {symbol, qty, entryPx, entryDate, stop, t1, t2, trailRef, consecBelow}
  const trades = [];
  let charges = 0;

  // Build a global event list: for each symbol, entries and per-bar exits.
  // Simpler: iterate bars chronologically per symbol, but portfolio-level
  // position cap needs global ordering. Approach: collect all entry events
  // sorted by date, then walk day by day.
  const entriesByDate = new Map(); // dateStr -> [{symbol, i}]
  for (const sym of symbols) {
    const d = dataMap[sym];
    const sig = d.sig[system];
    for (let i = 60; i < d.c.length; i++) {
      if (sig.entry[i]) {
        const ds = d.date[i];
        if (!entriesByDate.has(ds)) entriesByDate.set(ds, []);
        entriesByDate.get(ds).push({ symbol: sym, i });
      }
    }
  }
  const allDates = [...entriesByDate.keys()].sort();

  // per-symbol bar pointer for exit evaluation
  const ptr = {};
  for (const sym of symbols) ptr[sym] = 60;

  const openBySymbol = new Map();

  // Walk EVERY trading day (union of entry dates and all symbol dates would be
  // ideal; entry dates plus daily exit checks on open positions is enough):
  // build the full date list from all symbols.
  const dateSet = new Set(allDates);
  for (const sym of symbols) {
    const dd = dataMap[sym].date;
    for (let i = 60; i < dd.length; i++) dateSet.add(dd[i]);
  }
  const walkDates = [...dateSet].sort();

  for (const ds of walkDates) {
    // 1. evaluate exits for open positions using bars up to this date
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      const d = dataMap[p.symbol];
      // advance pointer to this date
      while (ptr[p.symbol] < d.c.length - 1 && d.date[ptr[p.symbol] + 1] <= ds) ptr[p.symbol]++;
      const i = ptr[p.symbol];
      if (d.date[i] !== ds) continue;
      let exitPx = null, reason = null;
      const c = d.c[i], l = d.l[i];
      // stop loss (intraday low breaches stop)
      if (l <= p.stop) { exitPx = Math.min(p.stop, c); reason = 'stop-loss'; }
      else if (system === 'momentum') {
        const trail = lowestLow(d.c, 20, i - 1);
        if (c < trail) { exitPx = c; reason = 'trail-break'; }
      } else if (system === 'trend-relay') {
        const crossDown = d.sma20[i - 1] > d.sma50[i - 1] && d.sma20[i] <= d.sma50[i];
        if (crossDown) { exitPx = c; reason = 'trend-relay-exit'; }
        else {
          p.consecBelow = (c < d.sma50[i]) ? (p.consecBelow || 0) + 1 : 0;
          if (p.consecBelow >= 3) { exitPx = c; reason = 'below-sma50'; }
        }
      } else if (system === 'reversal') {
        if (c >= d.sma20[i]) { exitPx = c; reason = 'mean-reached'; }
        else if (d.rsi[i] !== null && d.rsi[i] > 55) { exitPx = c; reason = 'rsi-recovered'; }
      }
      if (exitPx !== null && exitPx > 0) {
        const gross = (exitPx - p.entryPx) * p.qty;
        const cost = (p.entryPx * p.qty + exitPx * p.qty) * (ROUNDTRIP_COST / 2);
        charges += cost;
        const net = gross - cost;
        cash += p.qty * exitPx - cost + 0; // proceeds; entry cash was reserved at entry
        // (we track cash simply: deduct notional+half cost at entry, add proceeds-half cost at exit)
        trades.push({ symbol: p.symbol, entry_date: p.entryDate, entry: r2(p.entryPx),
          exit_date: ds, exit: r2(exitPx), qty: p.qty, pnl: r2(net),
          pnl_pct: r2(net / (p.entryPx * p.qty) * 100),
          hold_days: p.holdDays + 1, reason });
        openBySymbol.delete(p.symbol);
        open.splice(k, 1);
      } else {
        p.holdDays = (p.holdDays || 0) + 1;
        if (system === 'momentum') {
          // ratchet informational trail
          p.trailRef = lowestLow(d.c, 20, i);
        }
      }
    }
    // 2. take new entries while slots free
    const todaysEntries = entriesByDate.get(ds) || [];
    for (const ev of todaysEntries) {
      if (open.length >= MAX_POSITIONS) break;
      if (openBySymbol.has(ev.symbol)) continue; // one position per symbol
      const d = dataMap[ev.symbol];
      const i = ev.i;
      const px = d.c[i];
      if (!(px > 0)) continue;
      const notional = Math.min(POSITION_NOTIONAL, cash * 0.95);
      if (notional < 100000) continue; // too little cash left
      const qty = Math.floor(notional / px);
      if (qty <= 0) continue;
      const cost = px * qty * (ROUNDTRIP_COST / 2);
      cash -= px * qty + cost;
      charges += cost;
      const sig = d.sig[system];
      const pos = { symbol: ev.symbol, qty, entryPx: px, entryDate: ds,
        stop: sig.stop[i], t1: sig.t1[i], t2: sig.t2[i], holdDays: 0, consecBelow: 0 };
      open.push(pos);
      openBySymbol.set(ev.symbol, pos);
    }
  }

  // mark open positions to market at last available close
  const alerts = [];
  for (const p of open) {
    const d = dataMap[p.symbol];
    const last = d.c.length - 1;
    const cur = d.c[last];
    const unreal = (cur - p.entryPx) * p.qty;
    const risk = p.entryPx - p.stop;
    const progress = risk > 0 ? Math.max(0, Math.min(1.5, (cur - p.entryPx) / risk)) : 0;
    alerts.push({
      date: p.entryDate, symbol: p.symbol, alert: 'Entry',
      entry: r2(p.entryPx), stop_loss: r2(p.stop),
      trail_stop: system === 'momentum' ? r2(p.trailRef || p.stop) : r2(p.stop),
      target_1: r2(p.t1), target_2: r2(p.t2),
      current: r2(cur), unrealized: r2(unreal),
      unrealized_pct: r2(unreal / (p.entryPx * p.qty) * 100),
      progress: r2(progress * 100),
      hold_days: p.holdDays || 0,
    });
  }
  alerts.sort((a, b) => b.date.localeCompare(a.date));
  return { cash, trades, charges, alerts, openCount: open.length };
}

function r2(x) { return Math.round(x * 100) / 100; }

/* -------------------------------- stats -------------------------------- */

function computeStats(system, sim, indexDaily) {
  const { trades, cash, charges } = sim;
  const totalReturn = (cash - START_CAPITAL) / START_CAPITAL;
  const years = indexDaily.years;
  const cagr = years > 0 ? Math.pow(cash / START_CAPITAL, 1 / years) - 1 : 0;

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const avgHold = trades.length ? trades.reduce((s, t) => s + t.hold_days, 0) / trades.length : 0;

  // equity curve from trade pnls (monthly sampling for the chart)
  const monthly = new Map();
  for (const t of trades) {
    const m = t.exit_date.slice(0, 7);
    monthly.set(m, (monthly.get(m) || 0) + t.pnl);
  }
  const months = [...monthly.keys()].sort();
  let eq = START_CAPITAL;
  const equityCurve = months.map(m => { eq += monthly.get(m); return { m, v: Math.round(eq) }; });

  // max drawdown on monthly equity
  let peak = START_CAPITAL, maxDD = 0;
  for (const p of equityCurve) {
    if (p.v > peak) peak = p.v;
    const dd = (peak - p.v) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe/Sortino on monthly returns
  const rets = [];
  let prev = START_CAPITAL;
  for (const p of equityCurve) { rets.push((p.v - prev) / prev); prev = p.v; }
  const avgR = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + (r - avgR) ** 2, 0) / (rets.length - 1)) : 0;
  const sharpe = sd > 0 ? avgR / sd * Math.sqrt(12) : 0;
  const downside = rets.filter(r => r < 0);
  const dsd = downside.length > 1
    ? Math.sqrt(downside.reduce((s, r) => s + (r - avgR) ** 2, 0) / (downside.length - 1)) : 0;
  const sortino = dsd > 0 ? avgR / dsd * Math.sqrt(12) : 0;

  // benchmark: buy & hold NEPSE over the same span
  const bench = indexDaily.bench();

  const best = trades.length ? trades.reduce((a, b) => a.pnl_pct > b.pnl_pct ? a : b) : null;
  const worst = trades.length ? trades.reduce((a, b) => a.pnl_pct < b.pnl_pct ? a : b) : null;

  return {
    annual_return_pct: r2(cagr * 100),
    total_return_pct: r2(totalReturn * 100),
    capital_multiple: r2(cash / START_CAPITAL),
    final_value: Math.round(cash),
    win_rate_pct: r2(winRate * 100),
    total_trades: trades.length,
    max_drawdown_pct: r2(maxDD * 100),
    profit_factor: r2(profitFactor),
    avg_win_pct: wins.length ? r2(avgWin / (wins.reduce((s, t) => s + t.entry * t.qty, 0) / wins.length) * 100) : 0,
    avg_loss_pct: losses.length ? r2(Math.abs(avgLoss) / (losses.reduce((s, t) => s + t.entry * t.qty, 0) / losses.length) * 100) : 0,
    avg_holding_days: r2(avgHold),
    charges_paid: Math.round(charges),
    sharpe: r2(sharpe), sortino: r2(sortino),
    benchmark_cagr_pct: bench.cagr_pct, benchmark_multiple: bench.multiple,
    alpha_pct: r2(cagr * 100 - bench.cagr_pct),
    best_trade: best ? { symbol: best.symbol, pnl_pct: best.pnl_pct, entry_date: best.entry_date, exit_date: best.exit_date } : null,
    worst_trade: worst ? { symbol: worst.symbol, pnl_pct: worst.pnl_pct, entry_date: worst.entry_date, exit_date: worst.exit_date } : null,
    equity_curve: equityCurve,
    backtest_from: indexDaily.from, backtest_to: indexDaily.to,
  };
}

/* --------------------------- data preparation -------------------------- */

function prepare(symbol, raw) {
  // raw: {date, open, high, low, ltp, qty, turnover, ...} array (any key style)
  const rows = (Array.isArray(raw) ? raw : raw.data || []).filter(r => r);
  const bars = [];
  for (const r of rows) {
    const o = num2(r.open ?? r.o), h = num2(r.high ?? r.h),
          l = num2(r.low ?? r.l), c = num2(r.ltp ?? r.close ?? r.c);
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    const dt = String(r.date ?? r.d ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
    bars.push({ d: dt, o, h, l, c,
      v: num2(r.qty ?? r.volume ?? r.v),
      turn: num2(r.turnover ?? r.turnover_rs ?? r.t) });
  }
  bars.sort((a, b) => a.d < b.d ? -1 : 1);
  // de-dupe by date, keep last
  const ded = [];
  for (const b of bars) {
    if (ded.length && ded[ded.length - 1].d === b.d) ded[ded.length - 1] = b;
    else ded.push(b);
  }
  if (ded.length < MIN_SESSIONS) return null;

  // Corporate-action adjustment: NEPSE enforces a ±10% daily circuit, so any
  // overnight gap beyond ±10% is a bonus/split/right adjustment (or bad data),
  // not a real market move. Reverse-adjust all prior bars so indicators and
  // stops are computed on a continuous series. Volume is scaled inversely;
  // turnover (value) is unchanged.
  const adjustments = [];
  let cumFactor = 1;
  for (let i = 1; i < ded.length; i++) {
    const prevC = ded[i - 1].c, open = ded[i].o;
    if (!(prevC > 0 && open > 0)) continue;
    const ratio = open / prevC;
    if (ratio < 0.9 || ratio > 1.1) {
      for (let j = 0; j < i; j++) {
        ded[j].o *= ratio; ded[j].h *= ratio; ded[j].l *= ratio; ded[j].c *= ratio;
        if (ded[j].v) ded[j].v /= ratio;
      }
      cumFactor *= ratio;
      adjustments.push({ date: ded[i].d, ratio: Math.round(ratio * 10000) / 10000 });
    }
  }
  const n = ded.length;
  const d = {
    date: ded.map(b => b.d), o: ded.map(b => b.o), h: ded.map(b => b.h),
    l: ded.map(b => b.l), c: ded.map(b => b.c),
    v: ded.map(b => b.v), turn: ded.map(b => b.turn),
  };
  d.sma20 = sma(d.c, 20); d.sma50 = sma(d.c, 50);
  d.rsi = rsi(d.c, 14); d.atr = atr(ded, 14);
  const bb = bollinger(d.c, 20, 2);
  d.bbL = bb.lower; d.bbM = bb.mid;
  d.vma20 = sma(d.v.map(x => x || 0), 20);
  d.turn20 = sma(d.turn.map(x => x || 0), 20);
  // corporate-action guard: overnight gap > 12% => skip entries for 5 sessions
  d.ca = new Array(n).fill(false);
  let cool = 0;
  for (let i = 1; i < n; i++) {
    const gap = Math.abs(d.o[i] - d.c[i - 1]) / d.c[i - 1];
    if (gap > CA_GAP) cool = CA_COOLDOWN;
    if (cool > 0) { d.ca[i] = true; cool--; }
  }
  d.sig = {};
  for (const sys of Object.keys(SYSTEMS)) d.sig[sys] = genSignals(sys, d);
  return d;
}

function num2(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; }

function loadIndexDaily() {
  const src = fs.readFileSync(path.join(REPO, 'js', 'nepse-daily.js'), 'utf8');
  const m = src.match(/window\.NEPSE_DAILY=\[([\s\S]*?)\];\s*$/);
  if (!m) throw new Error('NEPSE_DAILY not found');
  const rows = m[1].split('],[').map(s => s.replace(/[\[\]]/g, '').split(','));
  const closes = rows.map(r => parseFloat(r[3])).filter(Number.isFinite);
  const first = rows[0][0], last = rows[rows.length - 1][0];
  const from = `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}`;
  const to = `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}`;
  const years = (Date.parse(to) - Date.parse(from)) / 365.25 / 864e5;
  const cagr = Math.pow(closes[closes.length - 1] / closes[0], 1 / years) - 1;
  return {
    from, to, years,
    bench() {
      return { cagr_pct: r2(cagr * 100), multiple: r2(closes[closes.length - 1] / closes[0]) };
    },
  };
}

/* --------------------------------- main -------------------------------- */

async function main() {
  const onlySystem = (process.argv.find(a => a.startsWith('--system=')) || '').split('=')[1];
  const noFetch = process.argv.includes('--no-fetch');
  const systems = onlySystem ? [onlySystem] : Object.keys(SYSTEMS);
  for (const s of systems) if (!SYSTEMS[s]) throw new Error('unknown system ' + s);

  const uni = JSON.parse(fs.readFileSync(path.join(REPO, 'nepse-chart', 'data', 'universe.json'), 'utf8'));
  const symbols = uni.symbols.map(x => x.s || x);
  console.log(`universe: ${symbols.length} symbols`);

  const indexDaily = loadIndexDaily();
  console.log(`index: ${indexDaily.from} .. ${indexDaily.to} (${indexDaily.years.toFixed(1)}y)`);

  // fetch + prepare (concurrency 8)
  const dataMap = {};
  let done = 0;
  const queue = symbols.slice();
  async function worker() {
    while (queue.length) {
      const sym = queue.shift();
      try {
        const raw = await getSymbolData(sym, noFetch);
        if (raw) {
          const d = prepare(sym, raw);
          if (d) dataMap[sym] = d;
        }
      } catch (e) { /* skip symbol on fetch error */ }
      if (++done % 50 === 0) console.log(`  prepared ${done}/${symbols.length} (${Object.keys(dataMap).length} usable)`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const usable = Object.keys(dataMap);
  console.log(`usable symbols: ${usable.length}/${symbols.length}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const sys of systems) {
    console.log(`\n=== ${sys} ===`);
    const t0 = Date.now();
    const sim = simulate(sys, usable, dataMap);
    const stats = computeStats(sys, sim, indexDaily);
    // keep the closed-trade list compact: last 500 + summary
    const trades = sim.trades.slice(-500).map(t => ({
      symbol: t.symbol, entry_date: t.entry_date, entry: t.entry,
      exit_date: t.exit_date, exit: t.exit, pnl_pct: t.pnl_pct, reason: t.reason,
    }));
    const out = {
      system: sys, title: SYSTEMS[sys].title, tagline: SYSTEMS[sys].tagline,
      rules: SYSTEMS[sys].rules,
      generated_at: new Date().toISOString(),
      universe_symbols: usable.length,
      stats, alerts: sim.alerts, recent_trades: trades,
      costs: '0.5% round-trip (broker + SEBON + DP, simplified)',
      portfolio: { start: START_CAPITAL, max_positions: MAX_POSITIONS, notional: POSITION_NOTIONAL },
      disclaimer: 'Educational backtest on historical data. Not investment advice. Past performance does not predict future results.',
    };
    const p = path.join(OUT_DIR, sys + '.json');
    fs.writeFileSync(p, JSON.stringify(out));
    console.log(`wrote ${p} (${(fs.statSync(p).size / 1024).toFixed(0)}KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log(`  CAGR ${stats.annual_return_pct}% | win ${stats.win_rate_pct}% | trades ${stats.total_trades} | maxDD ${stats.max_drawdown_pct}% | alerts ${sim.alerts.length}`);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
