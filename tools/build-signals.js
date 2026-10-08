/* Nepse Decode Signal Engine — transparent rule-based signal systems.
 *
 * Three systems, each with published rules (see SYSTEMS below):
 *   momentum    — rides established uptrends (Donchian breakout + trend filter)
 *   trend-relay — catches the start of a new uptrend (SMA20/SMA50 cross + volume)
 *   reversal    — mean-reversion in falling/sideways markets (oversold bounce)
 *
 * Data: per-symbol daily OHLCV. Historical depth from the open
 * samirwagle/Nepse-All-Scraper dataset (MIT), cached under tools/.cache/signals/.
 * Recent sessions overlaid from our own NEPSE direct feed (live.json) — our
 * data wins on collision. Provenance: output JSON includes honest `asof`
 * (actual last bar date) and `provenance` block. Never stamp build date as data date.
 * Benchmark: NEPSE index daily (js/nepse-daily.js).
 *
 * Full methodology (every formula, assumption and known limitation) lives in
 * SIGNALS_METHODOLOGY.md. Headline honesty rules:
 *  - No lookahead: every signal uses data up to and including the signal day;
 *    entries are taken at the signal day's close.
 *  - Corporate-action handling: the scraper series is not split-adjusted, so
 *    any overnight gap beyond ±10% (outside NEPSE's circuit) is treated as a
 *    bonus/split/rights adjustment and all prior bars are reverse-adjusted
 *    for price continuity. Bars with internally impossible OHLC (open or close
 *    outside the day's [low, high]) are repaired by clamping into the range
 *    first, because such bars are feed errors or unadjusted corporate-action
 *    opens. All repairs and adjustments are counted and published.
 *  - Costs: 0.5% round-trip (broker + SEBON + DP, simplified) on every trade.
 *  - Only symbols with >= 250 sessions are backtested; symbols whose data
 *    ends >90 days before the newest bar are excluded as stale/delisted.
 *  - Position sizing is a FIXED Rs 10 lakh notional per position (no
 *    compounding): as the portfolio grows, each position stays Rs 10L, so the
 *    system becomes progressively less invested. This is conservative and is
 *    disclosed; it drags CAGR down versus a compounding sizer.
 *  - T1/T2 "targets" are reference levels for position management. They are
 *    NOT traded: the backtest exits only via stop-loss and the documented
 *    trailing/mean-reversion rules.
 *
 * Output: nepse-chart/data/signals/<system>.json with stats, weekly equity
 * curve, open positions (alerts) and a full closed-trade ledger.
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
const POSITION_NOTIONAL = 1000000; // Rs 10 L per position, fixed (no compounding)
const ROUNDTRIP_COST = 0.005; // 0.5%
const MIN_SESSIONS = 250;
const CA_GAP = 0.10; // overnight gap beyond ±10% => corporate action
const STALE_DAYS = 90; // exclude symbols whose data ends this long before the newest bar

/* ------------------------------- systems ------------------------------- */

const SYSTEMS = {
  momentum: {
    title: 'Momentum Signal',
    tagline: 'Built for uptrending markets. Rides established trends with a trailing exit.',
    ruleLabel: 'Donchian-50 breakout + trend filter',
    rules: [
      'Setup: close above 50-day SMA and 20-day SMA above 50-day SMA (trend aligned)',
      'Trigger: close prints a 50-session highest close (breakout)',
      'Filter: RSI(14) between 55 and 80, 20-day avg turnover above Rs 10 lakh',
      'Stop: 2 × ATR(14) below entry. Trail: exit when close breaks the 20-session lowest close',
      'Targets: T1 = entry + 1.5 × risk, T2 = entry + 3 × risk (reference levels — not traded; see methodology)',
    ],
  },
  'trend-relay': {
    title: 'Trend Relay',
    tagline: 'Built for the beginning of an uptrend. Catches the turn with volume confirmation.',
    ruleLabel: 'SMA20/SMA50 golden cross + volume',
    rules: [
      'Setup: price below 50-day SMA for at least 20 of the last 30 sessions (was weak)',
      'Trigger: 20-day SMA crosses above 50-day SMA with volume over 1.5 × 20-day average',
      'Filter: 20-day avg turnover above Rs 10 lakh',
      'Stop: 2 × ATR(14) below entry. Trail: 20-day SMA cross back below 50-day SMA, or 3 closes under the 50-day SMA',
      'Targets: T1 = entry + 1.5 × risk, T2 = entry + 3 × risk (reference levels — not traded; see methodology)',
    ],
  },
  reversal: {
    title: 'Reversal Signal',
    tagline: 'Built for falling and sideways markets. Buys oversold bounces, exits at the mean.',
    ruleLabel: 'RSI(14)<30 + below lower Bollinger Band + bullish rejection',
    rules: [
      'Setup: RSI(14) below 30 and close below the lower Bollinger Band (20, 2)',
      'Trigger: bullish candle (close > open) closing in the top half of its range (rejection)',
      'Filter: 20-day avg turnover above Rs 10 lakh',
      'Stop: 1.5 × ATR(14) below entry (tighter — mean reversion). Trail: none; exit at the mean',
      'Targets: T1 = 20-day SMA (the mean), T2 = entry + 2 × risk (reference levels — not traded; see methodology)',
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
  let data = null;
  if (fs.existsSync(cachePath)) {
    try { data = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) { /* refetch */ }
  }
  if (!data && !noFetch) {
    const url = API + symbol.replace('/', '-') + '.json';
    data = await fetchJson(url);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data));
  }
  if (!data) return null;
  // Overlay our fresh NEPSE data (2026-10-07 fix): third-party lags by a day,
  // so inject today's bar from our own live.json when it's newer.
  try {
    const livePath = path.join(REPO, 'nepse-chart', 'data', 'live.json');
    if (fs.existsSync(livePath)) {
      const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
      const session = live.session_date; // YYYY-MM-DD
      if (session && live.quotes) {
        const q = live.quotes.find(x => x.symbol === symbol);
        if (q && q.ltp > 0) {
          const rows = Array.isArray(data) ? data : (data.data || []);
          const lastDate = rows.length ? String(rows[rows.length - 1].date || '') : '';
          if (lastDate < session) {
            // Our data is newer — append today's bar
            const bar = {
              date: session,
              open: q.previous_close || q.ltp,
              high: q.high || q.ltp,
              low: q.low || q.ltp,
              ltp: q.ltp,
              qty: q.volume || 0,
              turnover: q.turnover || 0,
            };
            if (Array.isArray(data)) data.push(bar);
            else if (data.data) data.data.push(bar);
          }
        }
      }
    }
  } catch (e) { /* overlay failed, use third-party data as-is */ }
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
  const lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += Math.pow(closes[j] - mid[i], 2);
    const sd = Math.sqrt(sum / n);
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, lower };
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
/* Each generator returns per-bar {entry:boolean, stop, t1, t2} using only
 * data up to bar i (no lookahead). Entries are taken at bar i's close.
 * Exits are evaluated on subsequent bars' closes inside simulate(). */

function genSignals(system, d) {
  const n = d.c.length;
  const entry = new Array(n).fill(false);
  const stop = new Array(n).fill(null);
  const t1 = new Array(n).fill(null);
  const t2 = new Array(n).fill(null);

  for (let i = 60; i < n; i++) {
    if (d.caBar[i]) continue; // the corporate-action bar itself: repaired OHLC, no entries
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
  return { entry, stop, t1, t2 };
}

/* ------------------------------ simulator ------------------------------ */
/* One shared portfolio per system across all symbols: Rs 1 Cr, max 10
 * concurrent positions, Rs 10 L fixed notional each, 0.5% round-trip cost. */

function isoWeek(ds) {
  const d = new Date(ds + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 864e5));
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

function simulate(system, symbols, dataMap) {
  let cash = START_CAPITAL;
  const open = []; // {symbol, qty, entryPx, entryDate, stop, t1, t2, trailRef, consecBelow, holdDays}
  const trades = [];
  let charges = 0;

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

  const ptr = {};
  for (const sym of symbols) ptr[sym] = 60;
  const openBySymbol = new Map();

  const dateSet = new Set();
  for (const sym of symbols) {
    const dd = dataMap[sym].date;
    for (let i = 60; i < dd.length; i++) dateSet.add(dd[i]);
  }
  const walkDates = [...dateSet].sort();

  // weekly equity snapshots: ISO week -> portfolio value at week's last walk date
  const weeklyEq = new Map();

  for (const ds of walkDates) {
    // 1. evaluate exits for open positions using bars up to this date
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      const d = dataMap[p.symbol];
      while (ptr[p.symbol] < d.c.length - 1 && d.date[ptr[p.symbol] + 1] <= ds) ptr[p.symbol]++;
      const i = ptr[p.symbol];
      if (d.date[i] !== ds) continue; // symbol did not trade today: hold
      let exitPx = null, reason = null;
      const c = d.c[i], l = d.l[i];
      // stop loss (intraday low breaches stop; gap-through exits at the close)
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
        cash += p.qty * exitPx - cost;
        const notional = p.entryPx * p.qty;
        trades.push({
          symbol: p.symbol, rule: SYSTEMS[system].ruleLabel,
          entry_date: p.entryDate, entry_price: r2(p.entryPx), qty: p.qty,
          notional_rs: Math.round(notional),
          stop_loss: r2(p.stop), target_1: r2(p.t1), target_2: r2(p.t2),
          exit_date: ds, exit_price: r2(exitPx), exit_reason: reason,
          pnl_rs: r2(net), pnl_pct: r2(net / notional * 100),
          hold_days: p.holdDays + 1,
        });
        openBySymbol.delete(p.symbol);
        open.splice(k, 1);
      } else {
        p.holdDays = (p.holdDays || 0) + 1;
        if (system === 'momentum') p.trailRef = lowestLow(d.c, 20, i);
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
      ptr[ev.symbol] = i; // pin bar pointer so the equity snapshot marks at today's close
    }
    // 3. mark-to-market equity snapshot (cash + open positions at latest closes)
    let eq = cash;
    for (const p of open) {
      const d = dataMap[p.symbol];
      const cur = d.c[ptr[p.symbol]];
      eq += p.qty * cur - p.qty * cur * (ROUNDTRIP_COST / 2);
    }
    weeklyEq.set(isoWeek(ds), { w: isoWeek(ds), v: Math.round(eq) });
  }

  // open positions marked to market at last available close
  const alerts = [];
  for (const p of open) {
    const d = dataMap[p.symbol];
    const last = d.c.length - 1;
    const cur = d.c[last];
    const unreal = (cur - p.entryPx) * p.qty;
    const risk = p.entryPx - p.stop;
    const progress = risk > 0 ? Math.max(0, Math.min(1.5, (cur - p.entryPx) / risk)) : 0;
    alerts.push({
      status: 'active', date: p.entryDate, symbol: p.symbol,
      rule: SYSTEMS[system].ruleLabel, alert: 'Entry',
      entry: r2(p.entryPx), stop_loss: r2(p.stop),
      trail_stop: system === 'momentum' ? r2(p.trailRef || p.stop) : r2(p.stop),
      target_1: r2(p.t1), target_2: r2(p.t2),
      targets_note: 'Reference levels for position management — not traded in the backtest.',
      current: r2(cur), unrealized: r2(unreal),
      unrealized_pct: r2(unreal / (p.entryPx * p.qty) * 100),
      progress: r2(progress * 100),
      hold_days: p.holdDays || 0,
      data_asof: d.date[last],
    });
  }
  alerts.sort((a, b) => b.date.localeCompare(a.date));

  // final portfolio value: cash + open positions marked to market (minus exit costs)
  let finalValue = cash;
  for (const p of open) {
    const d = dataMap[p.symbol];
    const cur = d.c[d.c.length - 1];
    finalValue += p.qty * cur - p.qty * cur * (ROUNDTRIP_COST / 2);
  }
  return { cash, finalValue, trades, charges, alerts,
    openCount: open.length, weeklyEq: [...weeklyEq.values()] };
}

function r2(x) { return Math.round(x * 100) / 100; }
function r4(x) { return Math.round(x * 10000) / 10000; }

/* -------------------------------- stats -------------------------------- */

function computeStats(system, sim, indexDaily, dataQuality) {
  const { trades, finalValue, charges, weeklyEq } = sim;
  const totalReturn = (finalValue - START_CAPITAL) / START_CAPITAL;
  const years = indexDaily.years;
  const cagr = years > 0 ? Math.pow(finalValue / START_CAPITAL, 1 / years) - 1 : 0;

  const wins = trades.filter(t => t.pnl_rs > 0);
  const losses = trades.filter(t => t.pnl_rs <= 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl_rs, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl_rs, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const avgHold = trades.length ? trades.reduce((s, t) => s + t.hold_days, 0) / trades.length : 0;

  const equityCurve = weeklyEq; // [{w, v}] weekly portfolio value incl. open positions

  // max drawdown on weekly marked-to-market equity
  let peak = START_CAPITAL, maxDD = 0;
  for (const p of equityCurve) {
    if (p.v > peak) peak = p.v;
    const dd = (peak - p.v) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe/Sortino on weekly simple returns, annualised
  const rets = [];
  let prev = START_CAPITAL;
  for (const p of equityCurve) { rets.push((p.v - prev) / prev); prev = p.v; }
  const avgR = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + (r - avgR) ** 2, 0) / (rets.length - 1)) : 0;
  const sharpe = sd > 0 ? avgR / sd * Math.sqrt(52) : 0;
  const downside = rets.filter(r => r < 0);
  const dsd = downside.length > 1
    ? Math.sqrt(downside.reduce((s, r) => s + (r - avgR) ** 2, 0) / (downside.length - 1)) : 0;
  const sortino = dsd > 0 ? avgR / dsd * Math.sqrt(52) : 0;

  const bench = indexDaily.bench();

  const best = trades.length ? trades.reduce((a, b) => a.pnl_pct > b.pnl_pct ? a : b) : null;
  const worst = trades.length ? trades.reduce((a, b) => a.pnl_pct < b.pnl_pct ? a : b) : null;

  const slim = t => ({ symbol: t.symbol, pnl_pct: t.pnl_pct,
    entry_date: t.entry_date, exit_date: t.exit_date, exit_reason: t.exit_reason });

  return {
    annual_return_pct: r2(cagr * 100),
    total_return_pct: r2(totalReturn * 100),
    capital_multiple: r2(finalValue / START_CAPITAL),
    final_value: Math.round(finalValue),
    win_rate_pct: r2(winRate * 100),
    total_trades: trades.length,
    max_drawdown_pct: r2(maxDD * 100),
    profit_factor: r2(profitFactor),
    avg_win_pct: wins.length ? r2(avgWin / (wins.reduce((s, t) => s + t.entry_price * t.qty, 0) / wins.length) * 100) : 0,
    avg_loss_pct: losses.length ? r2(Math.abs(avgLoss) / (losses.reduce((s, t) => s + t.entry_price * t.qty, 0) / losses.length) * 100) : 0,
    avg_holding_days: r2(avgHold),
    charges_paid: Math.round(charges),
    sharpe: r2(sharpe), sortino: r2(sortino),
    sharpe_note: 'Annualised from weekly portfolio returns (marked to market).',
    benchmark_cagr_pct: bench.cagr_pct, benchmark_multiple: bench.multiple,
    alpha_pct: r2(cagr * 100 - bench.cagr_pct),
    best_trade: best ? slim(best) : null,
    worst_trade: worst ? slim(worst) : null,
    equity_curve: equityCurve,
    equity_note: 'Weekly portfolio value: cash + open positions at last close, minus estimated exit costs.',
    backtest_from: indexDaily.from, backtest_to: indexDaily.to,
    data_quality: dataQuality,
  };
}

/* --------------------------- data preparation -------------------------- */

function prepare(symbol, raw) {
  // raw: [{date, open, high, low, ltp, qty, turnover, ...}] (any key style)
  const rows = (Array.isArray(raw) ? raw : raw.data || []).filter(r => r);
  const bars = [];
  for (const r of rows) {
    const o = num2(r.open ?? r.o), h = num2(r.high ?? r.h),
          l = num2(r.low ?? r.l), c = num2(r.ltp ?? r.close ?? r.c);
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    if (h < l) continue; // corrupt bar: high below low
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

  // Data sanitisation: the feed sometimes prints an open (or close) outside
  // the day's traded range — impossible in valid OHLC. Those ticks are feed
  // errors or unadjusted corporate-action opens (e.g. NBL 2013-05-09 printed
  // open 532 against a 143–145 range). Clamp into [low, high]; the range is
  // the more reliable record of where trading happened.
  let repaired = 0;
  for (const b of ded) {
    if (b.o > b.h || b.o < b.l) { b.o = Math.min(Math.max(b.o, b.l), b.h); repaired++; }
    if (b.c > b.h || b.c < b.l) { b.c = Math.min(Math.max(b.c, b.l), b.h); repaired++; }
  }

  if (ded.length < MIN_SESSIONS) return null;

  // Corporate-action adjustment: NEPSE enforces a ±10% daily circuit, so any
  // overnight gap beyond ±10% is a bonus/split/rights adjustment, not a real
  // market move. (On sanitised bars the open always sits inside the day's
  // range, so this also catches corporate-action bars whose raw open was
  // never adjusted.) Reverse-adjust all prior bars for price continuity:
  // prices × ratio, volume ÷ ratio, turnover (value) unchanged.
  // LIMITATION: the factor is inferred from price continuity, not from the
  // official corporate-action record; multi-day adjustments and real >10%
  // gaps from the pre-circuit era can be misread. Counted and disclosed.
  const adjustments = [];
  for (let i = 1; i < ded.length; i++) {
    const prevC = ded[i - 1].c, open = ded[i].o;
    if (!(prevC > 0 && open > 0)) continue;
    const ratio = open / prevC;
    if (ratio < 1 - CA_GAP || ratio > 1 + CA_GAP) {
      for (let j = 0; j < i; j++) {
        ded[j].o *= ratio; ded[j].h *= ratio; ded[j].l *= ratio; ded[j].c *= ratio;
        if (ded[j].v) ded[j].v /= ratio;
      }
      adjustments.push({ date: ded[i].d, ratio: r4(ratio) });
      ded[i].caBar = true;
    }
  }
  const n = ded.length;
  const d = {
    date: ded.map(b => b.d), o: ded.map(b => b.o), h: ded.map(b => b.h),
    l: ded.map(b => b.l), c: ded.map(b => b.c),
    v: ded.map(b => b.v), turn: ded.map(b => b.turn),
    caBar: ded.map(b => !!b.caBar),
  };
  d.sma20 = sma(d.c, 20); d.sma50 = sma(d.c, 50);
  d.rsi = rsi(d.c, 14); d.atr = atr(ded, 14);
  d.bbL = bollinger(d.c, 20, 2).lower;
  d.vma20 = sma(d.v.map(x => x || 0), 20);
  d.turn20 = sma(d.turn.map(x => x || 0), 20);
  d.sig = {};
  for (const sys of Object.keys(SYSTEMS)) d.sig[sys] = genSignals(sys, d);
  return { d, repaired, adjustments: adjustments.length };
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
  const quality = {}; // symbol -> {repaired, adjustments}
  let done = 0;
  const queue = symbols.slice();
  async function worker() {
    while (queue.length) {
      const sym = queue.shift();
      try {
        const raw = await getSymbolData(sym, noFetch);
        if (raw) {
          const p = prepare(sym, raw);
          if (p) { dataMap[sym] = p.d; quality[sym] = { repaired: p.repaired, adjustments: p.adjustments }; }
        }
      } catch (e) { /* skip symbol on fetch error */ }
      if (++done % 50 === 0) console.log(`  prepared ${done}/${symbols.length} (${Object.keys(dataMap).length} usable)`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  // exclude stale symbols: data ending >90 days before the newest bar
  let globalMax = '';
  for (const sym of Object.keys(dataMap)) {
    const last = dataMap[sym].date[dataMap[sym].date.length - 1];
    if (last > globalMax) globalMax = last;
  }
  const cutoff = new Date(globalMax + 'T00:00:00Z').getTime() - STALE_DAYS * 864e5;
  const usable = Object.keys(dataMap).filter(sym => {
    const last = dataMap[sym].date[dataMap[sym].date.length - 1];
    return new Date(last + 'T00:00:00Z').getTime() >= cutoff;
  });
  const excludedStale = Object.keys(dataMap).length - usable.length;
  console.log(`usable symbols: ${usable.length}/${symbols.length} (excluded stale: ${excludedStale})`);

  const totalRepaired = usable.reduce((s, sym) => s + quality[sym].repaired, 0);
  const totalAdjust = usable.reduce((s, sym) => s + quality[sym].adjustments, 0);
  console.log(`data quality: ${totalRepaired} OHLC repairs, ${totalAdjust} corporate-action adjustments`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Fail-soft: if the OHLCV cache is unavailable (no usable symbols), NEVER
  // publish empty output — keep the last-good files and warn. Pages keep
  // showing the most recent computed signals instead of going blank.
  if (usable.length === 0) {
    console.log('!! no usable OHLCV data — keeping last-good signal files (fail-soft)');
    for (const sys of systems) {
      const p = path.join(OUT_DIR, sys + '.json');
      if (fs.existsSync(p)) {
        console.log(`  kept ${p}`);
      } else {
        console.log(`  !! no last-good ${p} either — writing minimal placeholder`);
        fs.writeFileSync(p, JSON.stringify({
          system: sys, title: SYSTEMS[sys].title,
          generated_at: new Date().toISOString(),
          universe_symbols: 0,
          fail_soft: true,
          note: 'No OHLCV data available at build time; no previous output to retain. Not for display as current.',
          stats: null, alerts: [], recent_trades: [],
        }));
      }
    }
    return;
  }
  for (const sys of systems) {
    console.log(`\n=== ${sys} ===`);
    const t0 = Date.now();
    const sim = simulate(sys, usable, dataMap);
    const stats = computeStats(sys, sim, indexDaily, {
      bars_repaired: totalRepaired,
      corporate_action_adjustments: totalAdjust,
      symbols_excluded_stale: excludedStale,
      data_from: indexDaily.from, data_to: indexDaily.to,
      position_sizing: 'Fixed Rs 10,00,000 notional per position; not compounded with portfolio growth.',
      targets_traded: false,
      costs: '0.5% round-trip (broker + SEBON + DP, simplified): half charged at entry, half at exit.',
    });
    // full closed-trade ledger, most recent 500
    const ledger = sim.trades.slice(-500);
    // HONEST DATA VINTAGE (2026-10-08 fix): asof = actual last bar date,
    // not build date. Never stamp today's date on stale data.
    let dataVintage = null;
    for (const sym of usable) {
      const dm = dataMap[sym];
      const dates = dm && dm.date ? dm.date : [];
      if (dates.length) {
        const lastDate = String(dates[dates.length - 1] || '');
        if (lastDate && (!dataVintage || lastDate > dataVintage)) dataVintage = lastDate;
      }
    }
    const out = {
      system: sys, title: SYSTEMS[sys].title, tagline: SYSTEMS[sys].tagline,
      rules: SYSTEMS[sys].rules,
      generated_at: new Date().toISOString(),
      asof: dataVintage,
      provenance: {
        historical_source: 'samirwagle/Nepse-All-Scraper (third-party, for backtest depth)',
        recent_source: 'own NEPSE direct via live.json overlay',
        data_vintage: dataVintage,
        note: 'Historical bars from scraper; most recent sessions from our own NEPSE feed. asof reflects actual last bar, not build time.',
      },
      universe_symbols: usable.length,
      stats, alerts: sim.alerts, recent_trades: ledger,
      trade_counts: { closed_total: sim.trades.length, closed_in_ledger: ledger.length, active: sim.alerts.length },
      costs: '0.5% round-trip (broker + SEBON + DP, simplified)',
      portfolio: { start: START_CAPITAL, max_positions: MAX_POSITIONS, notional: POSITION_NOTIONAL,
        sizing_note: 'Fixed notional — position size does not grow with the portfolio.' },
      disclaimer: 'Educational backtest on historical data. Not investment advice. Past performance does not predict future results.',
    };
    const p = path.join(OUT_DIR, sys + '.json');
    fs.writeFileSync(p, JSON.stringify(out));
    console.log(`wrote ${p} (${(fs.statSync(p).size / 1024).toFixed(0)}KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log(`  CAGR ${stats.annual_return_pct}% | win ${stats.win_rate_pct}% | trades ${stats.total_trades} | maxDD ${stats.max_drawdown_pct}% | alerts ${sim.alerts.length}`);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
