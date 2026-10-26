/* NEPSE paper-trading simulator.
   Historical, rule-based, educational backtests on daily OHLC data.
   Conventions (also stated on the page):
   - Signals use only data through day t; trades execute at day t's CLOSE.
   - A position entered at day t's close can first hit its stop/target on day t+1.
   - If stop and target are both touched the same day, the stop is assumed hit first (conservative).
   - Strategy exit signals are evaluated and executed at day t's close.
   - One position per symbol at a time. No slippage modeled.
   - Trading costs ON by default: Nepali broker commission tiers, SEBON 0.015%,
     DP Rs 25 per sell, Rs 5 name transfer per buy, and CGT (5% short-term,
     3.75% long-term, editable) on positive taxable gains. */
(function () {
  'use strict';

  /* ================= pure indicators (same math as nepse-lab.js) ================= */
  function smaArr(vals, n) {
    var out = new Array(vals.length).fill(null), s = 0, i;
    for (i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function rsiArr(closes, n) {
    var out = new Array(closes.length).fill(null);
    if (closes.length < n + 1) return out;
    var g = 0, l = 0, i;
    for (i = 1; i <= n; i++) { var d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (i = n + 1; i < closes.length; i++) {
      var dd = closes[i] - closes[i - 1], gg = dd > 0 ? dd : 0, ll = dd < 0 ? -dd : 0;
      g = (g * (n - 1) + gg) / n; l = (l * (n - 1) + ll) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function atrArr(rows, n) {
    var out = new Array(rows.length).fill(null), trs = [], i;
    for (i = 1; i < rows.length; i++) {
      var h = rows[i][2], l = rows[i][3], pc = rows[i - 1][4];
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    var a = 0;
    for (i = 0; i < trs.length; i++) {
      a = i < n ? a + trs[i] / Math.min(n, i + 1) : (a * (n - 1) + trs[i]) / n;
      if (i >= n - 1) out[i + 1] = a;
    }
    return out;
  }
  function fmtYMD(ymd) {
    var s = String(ymd);
    return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : s;
  }

  /* ================= simulation engine (pure, deterministic) ================= */
  /* ================= simulation engine (pure, deterministic) ================= */
  var REASONS = { stop: 'Stop loss', target: 'Take profit', signal: 'Strategy exit', end: 'End of period' };

  /* Wave 7: Nepali brokerage cost model (verified broker schedule).
     - Broker commission per side: up to Rs 50,000: 0.36% (min Rs 10);
       Rs 50,001-500,000: 0.33%; Rs 500,001-2,000,000: 0.306%;
       Rs 2,000,001-10,000,000: 0.27%; above Rs 10,000,000: 0.243%.
     - SEBON fee 0.015% on buy and sell; DP charge Rs 25 flat on each sell;
       name transfer Rs 5 on each buy.
     - CGT on positive taxable gains only: held 365 days or less at
       opts.cgtShort (default 5%), over 365 days at opts.cgtLong
       (default 3.75%). Both editable.
     Buy-side costs enter the cost basis; the equity curve is net of estimated
     exit costs and CGT at every bar, and the final point equals actual net
     liquidation. Pass opts.costs === false for the old gross model. */
  function costModel(opts) {
    var on = !opts || opts.costs !== false; // default ON
    var cgtShort = opts && opts.cgtShort != null ? Number(opts.cgtShort) : 5;
    var cgtLong = opts && opts.cgtLong != null ? Number(opts.cgtLong) : 3.75;
    var SEBON = 0.00015, DP = 25, TRANSFER = 5;
    function commission(value) {
      if (!on) return 0;
      if (value <= 50000) return Math.max(10, value * 0.0036);
      if (value <= 500000) return value * 0.0033;
      if (value <= 2000000) return value * 0.00306;
      if (value <= 10000000) return value * 0.0027;
      return value * 0.00243;
    }
    function buyCostOf(value) { return on ? commission(value) + value * SEBON + TRANSFER : 0; }
    function sellCostOf(value) { return on ? commission(value) + value * SEBON + DP : 0; }
    function daysBetween(a, b) {
      function ms(s) {
        s = String(s);
        return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
      }
      return Math.max(0, Math.round((ms(b) - ms(a)) / 86400000));
    }
    function cgtRate(days) { return days > 365 ? cgtLong : cgtShort; }
    return {
      on: on, cgtShort: cgtShort, cgtLong: cgtLong,
      commission: commission, buyCostOf: buyCostOf, sellCostOf: sellCostOf,
      daysBetween: daysBetween, cgtRate: cgtRate
    };
  }

  function runSimulation(rows, opts) {
    var n = rows.length;
    var from = Math.max(0, opts.fromIdx || 0);
    var to = opts.toIdx == null ? n - 1 : Math.min(n - 1, opts.toIdx);
    if (!(opts.startCash > 0)) return { error: 'Starting cash must be greater than zero.' };
    if (to - from + 1 < 60) return { error: 'The selected range has fewer than 60 sessions. Pick a wider range.' };

    var closes = rows.map(function (r) { return r[4]; });
    var s20 = smaArr(closes, 20), s50 = smaArr(closes, 50);
    var rsi = rsiArr(closes, 14), atr = atrArr(rows, 14);
    var strat = opts.strategy || 'sma-cross';
    var CM = costModel(opts);
    var cash = opts.startCash, pos = null, openTrade = null, trades = [], curve = [];

    // Net liquidation value of an open position at a price/date: gross
    // proceeds minus estimated exit commission, SEBON, DP, and CGT on the
    // positive taxable gain. Buy-side costs sit in the cost basis.
    function netPosValue(p, price, ymd) {
      var sellVal = p.qty * price;
      var sCost = CM.sellCostOf(sellVal);
      var basis = p.qty * p.entry + (p.buyCost || 0);
      var taxable = Math.max(0, (sellVal - sCost) - basis);
      var cgt = CM.on ? taxable * CM.cgtRate(CM.daysBetween(p.entryYmd, ymd)) / 100 : 0;
      return sellVal - sCost - cgt;
    }
    function equityAt(i) { return cash + (pos ? netPosValue(pos, closes[i], rows[i][0]) : 0); }

    // Fill a realized exit: gross pnl, commission, other fees, CGT, net pnl.
    function settleExit(t, exitIdx, price, reason) {
      var qty = t.qty;
      var buyVal = qty * t.entry, sellVal = qty * price;
      var bCost = t.buyCost || 0;
      var sCost = CM.sellCostOf(sellVal);
      var basis = buyVal + bCost;
      var taxable = Math.max(0, (sellVal - sCost) - basis);
      var days = CM.daysBetween(t.entryYmd, rows[exitIdx][0]);
      var rate = CM.cgtRate(days);
      var cgt = CM.on ? taxable * rate / 100 : 0;
      t.exitIdx = exitIdx; t.exitYmd = rows[exitIdx][0];
      t.exit = price; t.reason = reason;
      t.pnl = sellVal - buyVal; // gross, before any costs
      t.retPct = t.entry > 0 ? (price - t.entry) / t.entry * 100 : 0;
      t.buyCost = bCost; t.sellCost = sCost;
      t.commission = CM.commission(buyVal) + CM.commission(sellVal);
      t.otherFees = (bCost + sCost) - t.commission; // SEBON + DP + name transfer
      t.cgt = cgt; t.cgtRate = rate; t.holdingDays = days;
      t.netPnl = (sellVal - sCost - cgt) - basis;
      t.netRetPct = basis > 0 ? t.netPnl / basis * 100 : 0;
      t.netProceeds = sellVal - sCost - cgt; // actual cash received on exit
      return t;
    }
    function exitPos(i, price, reason) {
      var t = settleExit(openTrade, i, price, reason);
      cash += t.netProceeds;
      trades.push(t);
      pos = null; openTrade = null;
    }
    function tryEnter(i) {
      var entry = closes[i], a = atr[i];
      if (a == null || a <= 0 || entry <= 0) return;
      var stop = entry - opts.stopMult * a;
      var target = entry + opts.targetMult * a;
      var riskAmt = (opts.riskPct / 100) * equityAt(i);
      var dist = entry - stop;
      var qty = dist > 0 ? Math.floor(riskAmt / dist) : 0;
      // Whole shares, never more than cash allows (buy costs included).
      while (qty >= 1 && qty * entry + CM.buyCostOf(qty * entry) > cash) qty--;
      if (qty < 1) return;
      var bCost = CM.buyCostOf(qty * entry);
      cash -= qty * entry + bCost;
      pos = { qty: qty, entry: entry, stop: stop, target: target, entryIdx: i, entryYmd: rows[i][0], buyCost: bCost };
      openTrade = {
        entryIdx: i, entryYmd: rows[i][0], entry: entry, qty: qty,
        stop: stop, target: target, buyCost: bCost, exitIdx: null
      };
    }
    function enterSignal(i) {
      if (i < warm) return false;
      if (strat === 'sma-cross') {
        return s20[i - 1] != null && s50[i - 1] != null &&
               s20[i - 1] <= s50[i - 1] && s20[i] > s50[i];
      }
      if (strat === 'rsi-swing') {
        return rsi[i] != null && rsi[i] < 30;
      }
      return false;
    }
    function exitSignal(i) {
      if (strat === 'sma-cross') {
        return s20[i - 1] != null && s50[i - 1] != null &&
               s20[i - 1] >= s50[i - 1] && s20[i] < s50[i];
      }
      if (strat === 'rsi-swing') {
        return rsi[i] != null && rsi[i] > 70;
      }
      return false;
    }

    // Buy-and-hold baseline: position sizing and the cost model apply to it too.
    var bhQty = Math.floor(opts.startCash / closes[from]);
    while (bhQty >= 1 && bhQty * closes[from] + CM.buyCostOf(bhQty * closes[from]) > opts.startCash) bhQty--;
    var bhEntry = closes[from];
    var bhBuyCost = bhQty >= 1 ? CM.buyCostOf(bhQty * bhEntry) : 0;
    var bhCash = opts.startCash - bhQty * bhEntry - bhBuyCost;
    function bhPos() {
      return { qty: bhQty, entry: bhEntry, entryYmd: rows[from][0], buyCost: bhBuyCost };
    }
    function bhNetAt(b) {
      return bhQty >= 1 ? bhCash + netPosValue(bhPos(), closes[b], rows[b][0]) : bhCash;
    }
    var warm = from + 50; // SMA50 needs 50 in-range bars before signals are valid

    if (strat === 'buyhold') {
      // Full equity in at the first close of the range, out at the last.
      if (bhQty >= 1) {
        trades.push(settleExit({
          entryIdx: from, entryYmd: rows[from][0], entry: bhEntry, qty: bhQty,
          stop: null, target: null, buyCost: bhBuyCost, exitIdx: null
        }, to, closes[to], 'end'));
      }
      for (var b = from; b <= to; b++) {
        var eq = bhNetAt(b);
        curve.push({ i: b, ymd: rows[b][0], equity: eq, bh: eq });
      }
    } else {
      for (var i = from; i <= to; i++) {
        if (pos && i > pos.entryIdx) {
          var lo = rows[i][3], hi = rows[i][2];
          if (lo <= pos.stop) exitPos(i, pos.stop, 'stop');
          else if (hi >= pos.target) exitPos(i, pos.target, 'target');
        }
        if (pos && exitSignal(i)) exitPos(i, closes[i], 'signal');
        if (!pos && enterSignal(i)) tryEnter(i);
        curve.push({ i: i, ymd: rows[i][0], equity: equityAt(i), bh: bhNetAt(i) });
      }
      if (pos) exitPos(to, closes[to], 'end');
    }

    var finalEq = curve.length ? curve[curve.length - 1].equity : opts.startCash;
    var wins = trades.filter(function (t) { return t.pnl > 0; });
    var losses = trades.filter(function (t) { return t.pnl <= 0; });
    var avg = function (arr) { return arr.length ? arr.reduce(function (s, t) { return s + t.pnl; }, 0) / arr.length : 0; };
    var avgNet = function (arr) { return arr.length ? arr.reduce(function (s, t) { return s + t.netPnl; }, 0) / arr.length : 0; };
    var peak = -Infinity, mdd = 0;
    curve.forEach(function (p) {
      if (p.equity > peak) peak = p.equity;
      if (peak > 0) { var dd = (peak - p.equity) / peak * 100; if (dd > mdd) mdd = dd; }
    });
    var bhFinal = curve.length ? curve[curve.length - 1].bh : opts.startCash;
    var tot = function (k) { return trades.reduce(function (s, t) { return s + (t[k] || 0); }, 0); };
    return {
      error: null,
      strat: strat,
      fromYmd: rows[from][0], toYmd: rows[to][0],
      startCash: opts.startCash,
      costsOn: CM.on, cgtShort: CM.cgtShort, cgtLong: CM.cgtLong,
      trades: trades,
      curve: curve,
      stats: {
        finalEquity: finalEq,
        totalReturnPct: (finalEq - opts.startCash) / opts.startCash * 100,
        nTrades: trades.length,
        wins: wins.length,
        winRate: trades.length ? wins.length / trades.length * 100 : 0,
        avgWin: avg(wins), avgLoss: avg(losses),
        avgNetWin: avgNet(wins), avgNetLoss: avgNet(losses),
        grossPnl: tot('pnl'), netPnl: tot('netPnl'),
        totalCommission: tot('commission'),
        totalOtherFees: tot('otherFees'),
        totalCgt: tot('cgt'),
        tradingCosts: tot('commission') + tot('otherFees'),
        maxDrawdownPct: mdd,
        bhFinal: bhFinal,
        bhReturnPct: (bhFinal - opts.startCash) / opts.startCash * 100,
        bhTrades: bhQty >= 1 ? 1 : 0
      }
    };
  }

  var api = { smaArr: smaArr, rsiArr: rsiArr, atrArr: atrArr, fmtYMD: fmtYMD, runSimulation: runSimulation, REASONS: REASONS, feeSchedule: costModel({}) };

  /* ---------- journal store (browser-local; pure storage logic, testable) ---------- */
  var JKEY = 'nl_sim_journal_v1';
  function lsGet() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function loadJournal() {
    var ls = lsGet(); if (!ls) return [];
    try { var j = JSON.parse(ls.getItem(JKEY)); return Array.isArray(j) ? j : []; }
    catch (e) { return []; }
  }
  function saveJournal(j) { var ls = lsGet(); if (!ls) return; try { ls.setItem(JKEY, JSON.stringify(j)); } catch (e) {} }
  function addJournal(entry) {
    var j = loadJournal();
    entry.id = 'j' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    entry.ts = new Date().toISOString();
    j.unshift(entry); saveJournal(j);
    return entry.id;
  }
  function delJournal(id) { saveJournal(loadJournal().filter(function (e) { return e.id !== id; })); }
  api.JKEY = JKEY; api.loadJournal = loadJournal; api.saveJournal = saveJournal;
  api.addJournal = addJournal; api.delJournal = delJournal;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ================= browser UI ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(x, d) {
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function fmtRs(x) { return 'Rs ' + fmtNum(x, 2); }
  function fmtPct(x) { return (x >= 0 ? '+' : '') + fmtNum(x, 2) + '%'; }
  function cls(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; }

  /* Own archive (tools/build-sim-history.js, refreshed daily after close):
   * nepse-chart/data/history/{SYM}.json = { symbol, updated, data: [[YYYYMMDD, open, high, low, close, volume, turnover], ...] }.
   * Replaced the stale third-party prices API (stopped 2026-02-12). */
  var PRICES = function (s) { return '/nepse-chart/data/history/' + s.replace('/', '-') + '.json'; };
  var universe = [], rows = [], curSym = null, lastRun = null, runSeq = 0;
  /* Freshness state: `loadedHist` = the history file the in-memory rows
   * came from; `publishedHist` = the newest file the refresh check saw.
   * A run records the loaded key at run time (res.histKey). */
  var universeAsof = null, loadedHist = null, publishedHist = null;
  var lastCheckAt = null, lastCheckOk = null, freshTimer = null;
  var verdicts = null, verdictsFailed = false, sectorPage = 0, sectorList = [];
  var histCover = {}; /* sym -> through-date string or '' when no file */
  var benchmarks = null, trackStrat = 'sma-cross';
  /* ---------- journal UI ---------- */
  function renderJournal() {
    var list = $('sim-journal-list'), empty = $('sim-journal-empty');
    var j = loadJournal();
    empty.hidden = j.length > 0;
    list.innerHTML = j.map(function (e) {
      return '<div class="sj-row"><div><strong>' + esc(e.title) + '</strong>' +
        '<span class="sj-meta">' + esc(e.ts.slice(0, 10)) + ' · ' + esc(e.kind === 'run' ? 'run note' : 'trade note') + '</span>' +
        '<p>' + esc(e.note) + '</p></div>' +
        '<button class="wl-rm" data-jdel="' + e.id + '" aria-label="Delete note">×</button></div>';
    }).join('');
  }

  /* ---------- autocomplete (OHLC history only) ---------- */
  var matches = [], activeIdx = -1, chosen = null;
  function known(s) { return universe.some(function (u) { return u.s === s; }); }
  function renderSuggest() {
    var ul = $('sim-suggest');
    if (!matches.length) { ul.hidden = true; ul.innerHTML = ''; return; }
    ul.innerHTML = matches.slice(0, 8).map(function (u, i) {
      return '<li role="option" data-sym="' + esc(u.s) + '" aria-selected="' + (i === activeIdx) + '">' +
        '<strong>' + esc(u.s) + '</strong><span>' + esc(u.n) + '</span></li>';
    }).join('');
    ul.hidden = false;
    $('sim-sym').setAttribute('aria-expanded', 'true');
  }
  function hideSuggest() {
    var ul = $('sim-suggest');
    ul.hidden = true; ul.innerHTML = ''; activeIdx = -1;
    $('sim-sym').setAttribute('aria-expanded', 'false');
  }
  function pick(u) {
    chosen = u.s; $('sim-sym').value = u.s + ' - ' + u.n;
    hideSuggest(); loadHistory(u.s);
  }

  /* ---------- history ---------- */
  function setStatus(msg, isErr) {
    var el = $('sim-status');
    el.textContent = msg; el.hidden = !msg;
    el.classList.toggle('err', !!isErr);
  }
  function histKeyOf(meta) { return meta ? meta.updated + '|' + meta.lastYmd : null; }
  function fmtTimeNPT(d) {
    try { return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function renderFreshLine() {
    var el = $('sim-fresh-line'); if (!el) return;
    var parts = [];
    if (universeAsof) parts.push('Universe ' + esc(universeAsof));
    if (loadedHist) parts.push('Loaded history: updated ' + esc(loadedHist.updated) + ' · latest session ' + esc(fmtYMD(loadedHist.lastYmd)));
    if (publishedHist && histKeyOf(publishedHist) !== histKeyOf(loadedHist))
      parts.push('Latest published: updated ' + esc(publishedHist.updated) + ' · latest session ' + esc(fmtYMD(publishedHist.lastYmd)));
    if (lastCheckAt) parts.push('Last refresh check ' + esc(fmtTimeNPT(lastCheckAt)) + ' NPT' + (lastCheckOk === false ? ' (failed — showing last good data)' : ''));
    el.innerHTML = parts.length ? parts.join(' · ') : 'Loading market data…';
  }
  function renderNewerNotice() {
    var box = $('sim-newer'); if (!box) return;
    var show = !!(lastRun && curSym && lastRun.sym === curSym && loadedHist &&
      publishedHist && histKeyOf(publishedHist) !== lastRun.histKey);
    box.hidden = !show;
    if (show) $('sim-newer-text').textContent = 'Newer history published (updated ' +
      publishedHist.updated + ', latest session ' + fmtYMD(publishedHist.lastYmd) +
      ') after this run was computed. Your setup is preserved — re-run to use it.';
  }
  function loadHistory(sym, opts) {
    curSym = sym; rows = [];
    setStatus('Loading ' + sym + ' history…');
    $('sim-run').disabled = true;
    var keepStart = opts && opts.preserve ? $('sim-start').value : null;
    var keepEnd = opts && opts.preserve ? $('sim-end').value : null;
    return fetch(PRICES(sym), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      rows = ((j && j.data) || []).map(function (d) {
        return [d[0], +d[1] || 0, +d[2] || 0, +d[3] || 0, +d[4] || 0, +d[5] || 0, +d[6] || 0];
      }).filter(function (r) { return r[4] > 0 && r[2] > 0 && r[3] > 0; });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      if (rows.length < 60) throw new Error('only ' + rows.length + ' sessions');
      loadedHist = { updated: (j && j.updated) || fmtYMD(rows[rows.length - 1][0]), lastYmd: rows[rows.length - 1][0] };
      if (!publishedHist) publishedHist = loadedHist;
      var first = fmtYMD(rows[0][0]), last = fmtYMD(rows[rows.length - 1][0]);
      var st = $('sim-start'), en = $('sim-end');
      st.min = first; st.max = last; en.min = first; en.max = last;
      if (keepStart && keepEnd) {
        st.value = keepStart < first ? first : keepStart > last ? last : keepStart;
        en.value = keepEnd < first ? first : keepEnd > last ? last : keepEnd;
      } else {
        var back = rows[Math.max(0, rows.length - 253)][0];
        st.value = fmtYMD(back); en.value = last;
      }
      renderFreshLine(); renderNewerNotice();
      setStatus('');
      $('sim-run').disabled = false;
    }).catch(function () {
      setStatus('Could not load full OHLC history for ' + sym + '. This security may not have usable history for simulation.', true);
    });
  }

  /* ---------- run ---------- */
  function strategy() {
    var el = document.querySelector('input[name="sim-strat"]:checked');
    return el ? el.value : 'sma-cross';
  }
  function doRun() {
    if (!curSym || !rows.length) { setStatus('Pick a security from the suggestions first.', true); return; }
    var st = $('sim-start').value, en = $('sim-end').value;
    var fromIdx = 0, toIdx = rows.length - 1, ok = true;
    if (st) { var f = rows.findIndex(function (r) { return fmtYMD(r[0]) >= st; }); if (f < 0) ok = false; else fromIdx = f; }
    if (en) { for (var k = rows.length - 1; k >= 0; k--) { if (fmtYMD(rows[k][0]) <= en) { toIdx = k; break; } } }
    if (!ok || toIdx <= fromIdx) { setStatus('That date range has no sessions in the loaded history.', true); return; }
    var cash = parseFloat($('sim-cash').value);
    var risk = parseFloat($('sim-risk').value);
    var sm = parseFloat($('sim-stopmult').value), tm = parseFloat($('sim-targetmult').value);
    if (!(cash > 0)) { setStatus('Starting cash must be greater than zero.', true); return; }
    if (!(risk > 0 && risk <= 100)) { setStatus('Risk per trade must be between 0 and 100%.', true); return; }
    if (!(sm > 0) || !(tm > 0)) { setStatus('Stop and target ATR multiples must be greater than zero.', true); return; }
    var costsOn = !$('sim-costs-on') || $('sim-costs-on').checked;
    var cgtS = parseFloat($('sim-cgt-short').value), cgtL = parseFloat($('sim-cgt-long').value);
    if (!(cgtS >= 0 && cgtS <= 100)) { setStatus('Short-term CGT must be between 0 and 100%.', true); return; }
    if (!(cgtL >= 0 && cgtL <= 100)) { setStatus('Long-term CGT must be between 0 and 100%.', true); return; }
    var res = runSimulation(rows, {
      strategy: strategy(), startCash: cash, riskPct: risk,
      stopMult: sm, targetMult: tm, fromIdx: fromIdx, toIdx: toIdx,
      costs: costsOn, cgtShort: cgtS, cgtLong: cgtL
    });
    if (res.error) { setStatus(res.error, true); return; }
    res.sym = curSym; res.runId = 'run' + (++runSeq);
    res.histKey = histKeyOf(loadedHist); res.histMeta = loadedHist;
    lastRun = res;
    setStatus('');
    renderResults(res);
    $('sim-results').hidden = false;
    $('sim-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- results ---------- */
  function statCard(k, v, c) {
    return '<div class="stat"><span class="nl-stat-k">' + k + '</span>' +
      '<span class="nl-stat-v ' + (c || '') + '">' + v + '</span></div>';
  }
  function renderResults(res) {
    var s = res.stats, strat = res.strat;
    var stratName = strat === 'buyhold' ? 'Buy and hold' : strat === 'sma-cross' ? 'SMA 20 / 50 crossover' : 'RSI(14) swing';
    $('sim-res-head').innerHTML = '<h2>Results: ' + esc(res.sym) + ' · ' + esc(stratName) + '</h2>' +
      '<p class="asof">' + fmtYMD(res.fromYmd) + ' to ' + fmtYMD(res.toYmd) + ' · ' + res.trades.length + ' trades · starting ' + fmtRs(res.startCash) + '</p>';
    $('sim-stats').innerHTML =
      '<div class="stats-key">' +
      statCard('Total return', fmtPct(s.totalReturnPct), cls(s.totalReturnPct)) +
      statCard('Max drawdown', '−' + fmtNum(s.maxDrawdownPct, 2) + '%', 'down') +
      statCard('Win rate', s.nTrades ? fmtNum(s.winRate, 1) + '%' : '—') +
      statCard('Number of trades', String(s.nTrades)) +
      '</div>' +
      '<details class="sim-details"><summary>All figures: costs, averages, buy-and-hold</summary>' +
      '<div class="stats">' +
      statCard('Final equity', fmtRs(s.finalEquity)) +
      statCard('Buy-and-hold return', fmtPct(s.bhReturnPct), cls(s.bhReturnPct)) +
      statCard('Gross P&L', (s.grossPnl >= 0 ? '+' : '') + fmtRs(s.grossPnl), cls(s.grossPnl)) +
      statCard('Net P&L', (s.netPnl >= 0 ? '+' : '') + fmtRs(s.netPnl), cls(s.netPnl)) +
      statCard('Trading costs', fmtRs(s.tradingCosts)) +
      statCard('CGT paid', fmtRs(s.totalCgt)) +
      statCard('Avg win', s.wins ? fmtRs(s.avgWin) : '—', 'up') +
      statCard('Avg loss', s.nTrades - s.wins ? fmtRs(s.avgLoss) : '—', 'down') +
      '</div></details>';
    drawEquity(res);
    var tb = $('sim-trades-body');
    var maxAbsNet = res.trades.reduce(function (m, t) { return Math.max(m, Math.abs(t.netPnl || 0)); }, 0);
    tb.innerHTML = res.trades.map(function (t, i) {
      function money(x, signed) {
        return '<td class="' + cls(x) + '">' + (signed && x >= 0 ? '+' : '') +
          fmtRs(x).replace('Rs ', 'Rs\u00a0') + '</td>';
      }
      return '<tr><td>' + (i + 1) + '</td><td>' + fmtYMD(t.entryYmd) + '</td><td>' + fmtRs(t.entry) + '</td>' +
        '<td>' + fmtYMD(t.exitYmd) + '</td><td>' + fmtRs(t.exit) + '</td><td>' + t.qty + '</td>' +
        money(t.pnl, true) +
        '<td>' + fmtRs(t.commission || 0).replace('Rs ', 'Rs\u00a0') + '</td>' +
        '<td>' + fmtRs(t.otherFees || 0).replace('Rs ', 'Rs\u00a0') + '</td>' +
        '<td>' + fmtRs(t.cgt || 0).replace('Rs ', 'Rs\u00a0') + '</td>' +
        '<td class="pnl-cell">' + (t.netPnl >= 0 ? '+' : '') + fmtRs(t.netPnl).replace('Rs ', 'Rs\u00a0') +
        '<span class="pnlbar"><i class="' + (t.netPnl >= 0 ? 'pos' : 'neg') + '" style="width:' +
        (maxAbsNet > 0 ? (Math.abs(t.netPnl) / maxAbsNet * 50).toFixed(1) : 0) + '%"></i></span></td>' +
        '<td>' + esc(REASONS[t.reason] || t.reason) + '</td>' +
        '<td><button class="linklike" data-note="' + i + '">Note</button><div class="tnote" id="tnote-' + i + '" hidden></div></td></tr>';
    }).join('') || '<tr><td colspan="13" class="muted">No trades were triggered in this range.</td></tr>';
    $('sim-run-note').value = '';
    var rd = $('sim-run-data');
    if (rd) {
      rd.hidden = !(res.histMeta);
      if (res.histMeta) rd.textContent = 'Run data: history updated ' + res.histMeta.updated +
        ' · latest session ' + fmtYMD(res.histMeta.lastYmd) + ' · ' + res.curve.length + ' sessions in range';
    }
    renderBaseline(res); renderExitBreakdown(res); renderCosts(res); renderNewerNotice();
  }
  function bhDrawdown(res) {
    var peak = -Infinity, mdd = 0;
    res.curve.forEach(function (p) {
      if (p.bh > peak) peak = p.bh;
      if (peak > 0) { var dd = (peak - p.bh) / peak * 100; if (dd > mdd) mdd = dd; }
    });
    return mdd;
  }
  function measureRow(label, stratV, bhV, c1, c2) {
    return '<tr><td>' + label + '</td><td class="' + (c1 || '') + '">' + stratV + '</td><td class="' + (c2 || '') + '">' + bhV + '</td></tr>';
  }
  function renderBaseline(res) {
    var el = $('sim-baseline'); if (!el) return;
    var s = res.stats, spread = s.totalReturnPct - s.bhReturnPct;
    var bhDd = bhDrawdown(res);
    var isBh = res.strat === 'buyhold';
    el.innerHTML = '<div class="sim-measure"><h3>Baseline comparison</h3>' +
      '<p class="res-sub">Same symbol, same date range. Buy-and-hold final equity and drawdown are derived from the buy-and-hold curve already computed for this run — no new math.</p>' +
      '<div class="sim-measure-wrap"><table class="cx-table"><thead><tr><th></th><th class="num">Strategy</th><th class="num">Buy and hold</th></tr></thead><tbody>' +
      measureRow('Return', fmtPct(s.totalReturnPct), fmtPct(s.bhReturnPct), cls(s.totalReturnPct), cls(s.bhReturnPct)) +
      measureRow('Final equity', fmtRs(s.finalEquity), fmtRs(s.bhFinal)) +
      measureRow('Max drawdown', '−' + fmtNum(s.maxDrawdownPct, 2) + '%', '−' + fmtNum(bhDd, 2) + '%', 'down', 'down') +
      measureRow('Trades', String(s.nTrades), String(s.bhTrades != null ? s.bhTrades : '—')) +
      '</tbody></table></div>' +
      '<p class="sim-spread-note">Spread vs buy-and-hold: <span class="sim-spread ' + cls(spread) + '">' + fmtPct(spread) + '</span>' +
      (isBh ? ' — this run IS buy-and-hold, so the spread is zero by construction.' : '') + '</p></div>';
  }
  function renderExitBreakdown(res) {
    var el = $('sim-exit'); if (!el) return;
    var agg = {};
    res.trades.forEach(function (t) {
      var a = agg[t.reason] || (agg[t.reason] = { n: 0, net: 0 });
      a.n++; a.net += t.netPnl || 0;
    });
    var order = ['stop', 'target', 'signal', 'end'];
    var body = order.filter(function (r) { return agg[r]; }).map(function (r) {
      var a = agg[r];
      return '<tr><td>' + esc(REASONS[r] || r) + '</td><td class="num">' + a.n + '</td>' +
        '<td class="num ' + cls(a.net / a.n) + '">' + (a.net / a.n >= 0 ? '+' : '') + fmtRs(a.net / a.n) + '</td>' +
        '<td class="num ' + cls(a.net) + '">' + (a.net >= 0 ? '+' : '') + fmtRs(a.net) + '</td></tr>';
    }).join('');
    el.innerHTML = '<div class="sim-measure"><h3>Exit breakdown</h3>' +
      '<p class="res-sub">Counts and mean net P&L per exit reason, aggregated from this run\'s own trade log. Mean P&L is net of costs and CGT.</p>' +
      '<div class="sim-measure-wrap"><table class="cx-table"><thead><tr><th>Exit reason</th><th class="num">Trades</th><th class="num">Mean net P&L</th><th class="num">Total net P&L</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="4" class="muted">No trades in this range.</td></tr>') +
      '</tbody></table></div></div>';
  }
  function renderCosts(res) {
    var el = $('sim-costs'); if (!el) return;
    var s = res.stats, cgtS = 0, cgtL = 0;
    res.trades.forEach(function (t) {
      if ((t.holdingDays || 0) > 365) cgtL += t.cgt || 0; else cgtS += t.cgt || 0;
    });
    el.innerHTML = '<div class="sim-measure"><h3>Cash &amp; costs</h3>' +
      '<p class="res-sub">Final equity is net liquidation after every cost below. CGT split uses each trade\'s holding period (≤ 365 days short-term, above long-term).</p>' +
      '<div class="sim-measure-wrap"><table class="cx-table"><tbody>' +
      '<tr><td>Starting cash</td><td class="num">' + fmtRs(res.startCash) + '</td></tr>' +
      '<tr><td>Final equity (net)</td><td class="num">' + fmtRs(s.finalEquity) + '</td></tr>' +
      '<tr><td>Net P&L</td><td class="num ' + cls(s.netPnl) + '">' + (s.netPnl >= 0 ? '+' : '') + fmtRs(s.netPnl) + '</td></tr>' +
      '<tr><td>Trading costs (commission + other fees)</td><td class="num">' + fmtRs(s.tradingCosts) + '</td></tr>' +
      '<tr><td>CGT — short-term (≤ 365 days)</td><td class="num">' + fmtRs(cgtS) + '</td></tr>' +
      '<tr><td>CGT — long-term (&gt; 365 days)</td><td class="num">' + fmtRs(cgtL) + '</td></tr>' +
      '<tr><td>Total CGT</td><td class="num">' + fmtRs(s.totalCgt) + '</td></tr>' +
      '</tbody></table></div></div>';
  }

  function tok(name, fallback) {
    /* Canvas fills cannot use CSS var(): read the --nd-* token value from
     * computed style at draw time. Fallbacks are the dark-theme token hexes. */
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function drawEquity(res) {
    var cv = $('sim-equity'), dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 800, H = 260;
    cv.width = W * dpr; cv.height = H * dpr;
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    var pts = res.curve;
    if (!pts.length) return;
    var min = Infinity, max = -Infinity;
    pts.forEach(function (p) { min = Math.min(min, p.equity, p.bh); max = Math.max(max, p.equity, p.bh); });
    if (max === min) max = min + 1;
    var pad = 34, X = function (i) { return pad + (W - pad - 12) * i / Math.max(1, pts.length - 1); };
    var Y = function (v) { return H - 24 - (H - 48) * (v - min) / (max - min); };
    ctx.strokeStyle = tok('--nd-border', '#1E2430'); ctx.lineWidth = 1;
    ctx.fillStyle = tok('--nd-dim', '#8E98A8'); ctx.font = '11px Inter, sans-serif';
    for (var g = 0; g <= 4; g++) {
      var v = min + (max - min) * g / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 12, y); ctx.stroke();
      ctx.fillText('Rs ' + fmtNum(v, 0), 2, y + 4);
    }
    function line(key, color, width, dash) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      pts.forEach(function (p, i) { var x = X(i), y = Y(p[key]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    line('bh', tok('--nd-dim', '#8E98A8'), 2, [6, 4]);
    line('equity', tok('--nd-lime', '#B8E62E'), 3);
    ctx.setLineDash([]);
    ctx.fillStyle = tok('--nd-dim', '#8E98A8');
    ctx.fillText(fmtYMD(pts[0].ymd), pad, H - 6);
    var le = fmtYMD(pts[pts.length - 1].ymd);
    ctx.fillText(le, W - 12 - ctx.measureText(le).width, H - 6);
    cv.setAttribute('aria-label', 'Equity curve for ' + res.sym + ': strategy ends at ' +
      fmtRs(res.stats.finalEquity) + ', buy and hold at ' + fmtRs(res.stats.bhFinal) + '.');
  }

  /* ---------- trade notes ---------- */
  function openTradeNote(i) {
    var t = lastRun.trades[i];
    var box = $('tnote-' + i);
    var existing = loadJournal().filter(function (e) { return e.runRef === lastRun.runId && e.tradeIdx === i; });
    box.innerHTML = (existing.length ? existing.map(function (e) {
      return '<p class="tnote-saved">' + esc(e.note) + ' <button class="linklike" data-jdel="' + e.id + '">delete</button></p>';
    }).join('') : '') +
      '<textarea id="tnote-ta-' + i + '" rows="2" aria-label="Note for trade ' + (i + 1) + '" placeholder="What did this trade teach you?"></textarea>' +
      '<button class="btn small" data-notesave="' + i + '">Save note</button>';
    box.hidden = false;
    var ta = $('tnote-ta-' + i);
    if (ta) ta.focus();
  }

  /* ---------- freshness auto-refresh ----------
   * Market-aware cadence, NPT clock: 15 min during market hours
   * (11:00-15:00 Mon-Fri), 30 min otherwise, 2 h on weekends.
   * The backtest run itself stays user-triggered: a refresh only
   * re-renders freshness state. If the published history advanced past
   * the displayed run's data key, a plain notice offers a one-click
   * re-run with the setup preserved; nothing re-runs silently.
   * Hidden tabs skip fetches and re-check on visibilitychange. */
  function refreshDelayMs() {
    var now;
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
      var wd = parts.filter(function (x) { return x.type === 'weekday'; })[0].value;
      var hr = parseInt(parts.filter(function (x) { return x.type === 'hour'; })[0].value, 10);
      if (wd === 'Sat' || wd === 'Sun') return 2 * 60 * 60 * 1000;
      if (wd !== 'Sat' && wd !== 'Sun' && hr >= 11 && hr < 15) return 15 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }
  function loadUniverse() {
    return fetch('/nepse-chart/data/universe.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (u) {
      universe = (u.symbols || []).filter(function (x) { return x.o === 1; })
        .sort(function (a, b) { return a.s < b.s ? -1 : 1; });
      universeAsof = u.asof || null;
    }).catch(function () { universe = []; });
  }
  function checkFreshness() {
    if (document.hidden) { scheduleFreshCheck(); return; }
    var sym = curSym;
    loadUniverse().then(function () {
      if (!sym) { lastCheckAt = new Date(); lastCheckOk = true; renderFreshLine(); renderNewerNotice(); return; }
      return fetch(PRICES(sym), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        var data = j.data || [];
        publishedHist = { updated: j.updated || null, lastYmd: data.length ? data[data.length - 1][0] : null };
        lastCheckAt = new Date(); lastCheckOk = true;
        /* No displayed run for this symbol: refresh the loaded rows so
         * the next user-triggered Run uses fresh data (dates preserved
         * where still in range). A displayed run keeps its rows until
         * the user re-runs — see renderNewerNotice. */
        if (!(lastRun && lastRun.sym === sym) && histKeyOf(publishedHist) !== histKeyOf(loadedHist)) {
          loadHistory(sym, { preserve: true });
        }
        renderFreshLine(); renderNewerNotice();
      });
    }).catch(function () {
      lastCheckAt = new Date(); lastCheckOk = false;
      renderFreshLine(); renderNewerNotice();
    }).then(function () { scheduleFreshCheck(); });
  }
  function scheduleFreshCheck() {
    if (freshTimer) clearTimeout(freshTimer);
    freshTimer = setTimeout(checkFreshness, refreshDelayMs());
  }
  function startFreshness() {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkFreshness();
    });
    scheduleFreshCheck();
  }

  /* ---------- sector drill-down ----------
   * Sector membership comes from verdicts.json `sec` (universe.json
   * carries no sector field: entries are {s, n, t, o} only). Rows show
   * latest close + day change from verdicts, company name from
   * universe, and history coverage through-date fetched per visible
   * page from the symbol's history file (cached; missing file = no
   * history). Top backtested performer comes from the benchmark
   * archive when published, else "not yet published". */
  function loadVerdicts() {
    if (verdicts || verdictsFailed) return Promise.resolve();
    return fetch('/nepse-chart/data/verdicts.json').then(function (r) { return r.json(); }).then(function (v) {
      verdicts = v.verdicts || {};
      var secs = {};
      Object.keys(verdicts).forEach(function (sym) { if (verdicts[sym].sec) secs[verdicts[sym].sec] = true; });
      sectorList = Object.keys(secs).sort();
      var sel = $('sim-sector');
      sectorList.forEach(function (sec) {
        var n = Object.keys(verdicts).filter(function (sym) { return verdicts[sym].sec === sec; }).length;
        var o = document.createElement('option'); o.value = sec; o.textContent = sec + ' (' + n + ')';
        sel.appendChild(o);
      });
    }).catch(function () { verdictsFailed = true; });
  }
  function sectorMembers(sec) {
    return Object.keys(verdicts || {}).filter(function (sym) { return verdicts[sym].sec === sec; }).sort();
  }
  function medianOf(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function topBacktested(members) {
    if (!benchmarks || !benchmarks.rows) return null;
    var best = null;
    benchmarks.rows.forEach(function (r) {
      if (r.window !== '1Y' || members.indexOf(r.symbol) < 0) return;
      if (!best || r.returnPct > best.returnPct) best = r;
    });
    return best;
  }
  function renderSector() {
    var block = $('sim-sector-block'), sel = $('sim-sector');
    var sec = sel.value;
    if (!sec) { block.hidden = true; return; }
    if (verdictsFailed) {
      block.hidden = false;
      $('sim-sector-title').textContent = sec;
      $('sim-sector-summary').innerHTML = '';
      $('sim-sector-note').textContent = 'Sector data unavailable — verdicts could not be loaded. No membership is shown rather than an invented list.';
      $('sim-sector-body').innerHTML = '';
      $('sim-sector-pager').textContent = '';
      return;
    }
    block.hidden = false;
    $('sim-sector-title').textContent = sec + ' stocks';
    var members = sectorMembers(sec);
    var withHist = members.filter(function (sym) { return universe.some(function (u) { return u.s === sym; }); });
    var chs = members.map(function (sym) { return verdicts[sym].ch; }).filter(function (x) { return typeof x === 'number' && isFinite(x); });
    var med = medianOf(chs);
    var top = topBacktested(members);
    var unmapped = universe.filter(function (u) { return !(verdicts && verdicts[u.s]); }).length;
    $('sim-sector-summary').innerHTML =
      statCard('Stocks in sector', String(members.length)) +
      statCard('With full history', String(withHist.length)) +
      statCard('Median day change', med == null ? '—' : fmtPct(med));
    $('sim-sector-note').textContent = 'Sector membership from verdicts.json (sec field). ' +
      (top ? 'Top 1Y backtested: ' + top.symbol + ' ' + fmtPct(top.returnPct) + ' (' + top.strategy + '). ' : 'Top backtested performer: not yet published — the benchmark archive is pending. ') +
      unmapped + ' universe symbols have no verdicts sector mapping and appear in no sector.';
    var per = 25, pages = Math.max(1, Math.ceil(members.length / per));
    if (sectorPage >= pages) sectorPage = pages - 1;
    var page = members.slice(sectorPage * per, sectorPage * per + per);
    $('sim-sector-pager').textContent = 'Showing ' + (members.length ? sectorPage * per + 1 : 0) + '–' +
      Math.min(members.length, sectorPage * per + per) + ' of ' + members.length + ' stocks in ' + sec;
    $('sim-sector-prev').disabled = sectorPage <= 0;
    $('sim-sector-next').disabled = sectorPage >= pages - 1;
    $('sim-sector-body').innerHTML = page.map(function (sym) {
      var v = verdicts[sym] || {};
      var u = universe.filter(function (x) { return x.s === sym; })[0];
      var cov = histCover[sym];
      return '<tr><td><strong>' + esc(sym) + '</strong></td><td>' + esc(u ? u.n : '—') + '</td>' +
        '<td class="num">' + (v.p != null ? fmtRs(v.p) : '—') + '</td>' +
        '<td class="num ' + cls(v.ch) + '">' + (v.ch != null ? fmtPct(v.ch) : '—') + '</td>' +
        '<td>' + (cov === undefined ? '…' : cov === '' ? 'no history file' : esc(cov)) + '</td>' +
        '<td><button type="button" class="cx-btn quiet sim-load" data-load="' + esc(sym) + '">Load into backtest</button></td></tr>';
    }).join('');
    page.forEach(function (sym) {
      if (histCover[sym] !== undefined) return;
      fetch(PRICES(sym)).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        var d = j.data || [];
        histCover[sym] = d.length ? fmtYMD(d[d.length - 1][0]) : '';
        if ($('sim-sector').value === sec) renderSector();
      }).catch(function () { histCover[sym] = ''; if ($('sim-sector').value === sec) renderSector(); });
    });
  }

  /* ---------- strategy track record (benchmark archive) ---------- */
  var STRAT_NAMES = { buyhold: 'Buy and hold', 'sma-cross': 'SMA 20 / 50 crossover', 'rsi-swing': 'RSI(14) swing' };
  function loadBenchmarks() {
    return fetch('/data/sim-benchmarks.json').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) { benchmarks = j; }).catch(function () { benchmarks = null; });
  }
  function renderTrack() {
    var seg = $('sim-track-seg'), body = $('sim-track-body'), pend = $('sim-track-pending');
    seg.innerHTML = Object.keys(STRAT_NAMES).map(function (k) {
      return '<button type="button" aria-pressed="' + (k === trackStrat) + '" data-track="' + k + '">' + esc(STRAT_NAMES[k]) + '</button>';
    }).join('');
    if (!benchmarks || !benchmarks.aggregates) { body.innerHTML = ''; pend.hidden = false; return; }
    pend.hidden = true;
    var aggs = (benchmarks.aggregates || []).filter(function (a) { return a.strategy === trackStrat; });
    var winRows = (benchmarks.windows || []).map(function (w) {
      var a = aggs.filter(function (x) { return x.window === w; })[0];
      if (!a) return '';
      return '<tr><td>' + esc(w) + '</td><td class="num">' + a.nSymbols + '</td>' +
        '<td class="num ' + cls(a.meanReturnPct) + '">' + fmtPct(a.meanReturnPct) + '</td>' +
        '<td class="num ' + cls(a.medianReturnPct) + '">' + fmtPct(a.medianReturnPct) + '</td>' +
        '<td class="num">' + fmtNum(a.winRatePct, 1) + '%</td>' +
        '<td class="num">' + a.nTrades + '</td><td class="num">' + a.nResolved + ' / ' + a.nPending + '</td>' +
        '<td class="num ' + cls(a.meanBhSpreadPct) + '">' + fmtPct(a.meanBhSpreadPct) + '</td></tr>';
    }).join('');
    var secs = (benchmarks.sectors || []).filter(function (x) { return x.strategy === trackStrat && x.window === '1Y'; })
      .sort(function (a, b) { return b.meanReturnPct - a.meanReturnPct; });
    var secRows = secs.map(function (x) {
      return '<tr><td>' + esc(x.sector) + '</td><td class="num ' + cls(x.meanReturnPct) + '">' + fmtPct(x.meanReturnPct) + '</td>' +
        '<td class="num">' + x.nSymbols + '</td><td>' + esc(x.bestSymbol || '—') + ' ' + (x.bestReturnPct != null ? fmtPct(x.bestReturnPct) : '') + '</td></tr>';
    }).join('');
    body.innerHTML = '<h3 class="res-h">Strategy × window — ' + esc(STRAT_NAMES[trackStrat]) + '</h3>' +
      '<p class="res-sub">n = symbols with a full window. Resolved = trades closed by stop, target or signal; pending = positions still open at the window end (marked to market, re-categorized when new sessions land). Mean return is the average across symbols; win rate is trade-weighted.</p>' +
      '<div class="sim-track-wrap"><table class="cx-table"><thead><tr><th>Window</th><th class="num">Symbols</th><th class="num">Mean return</th><th class="num">Median return</th><th class="num">Win rate</th><th class="num">Trades</th><th class="num">Resolved / pending</th><th class="num">Mean spread vs buy-hold</th></tr></thead><tbody>' + winRows + '</tbody></table></div>' +
      '<h3 class="res-h">Sector ranking — 1Y window</h3>' +
      '<div class="sim-track-wrap"><table class="cx-table"><thead><tr><th>Sector</th><th class="num">Mean return</th><th class="num">Symbols</th><th>Best symbol</th></tr></thead><tbody>' +
      (secRows || '<tr><td colspan="4" class="muted">No sector aggregates in this archive.</td></tr>') + '</tbody></table></div>' +
      '<p class="sim-fineprint">Archive generated ' + esc(benchmarks.generated || '—') + ' from the owned OHLC archive with the page\'s exact cost, tax and sizing rules. Daily closes only; dividends, bonus and rights are not adjusted; past performance does not predict future results.</p>';
  }

  /* ---------- init ---------- */
  function init() {
    renderJournal();
    var symInput = $('sim-sym');
    loadUniverse().then(function () { renderFreshLine(); });
    loadVerdicts().then(function () { if ($('sim-sector').value) renderSector(); });
    loadBenchmarks().then(function () { renderTrack(); });
    startFreshness();
    symInput.addEventListener('input', function () {
      chosen = null;
      var q = symInput.value.trim().toLowerCase();
      if (q.length < 1) { hideSuggest(); return; }
      matches = universe.filter(function (u) {
        return u.s.toLowerCase().indexOf(q) === 0 || u.n.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      activeIdx = -1; renderSuggest();
    });
    symInput.addEventListener('keydown', function (e) {
      if ($('sim-suggest').hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = e.key === 'ArrowDown'
          ? Math.min(matches.length - 1, activeIdx + 1)
          : Math.max(0, activeIdx - 1);
        renderSuggest();
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault(); pick(matches[activeIdx]);
      } else if (e.key === 'Escape') hideSuggest();
    });
    $('sim-suggest').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-sym]');
      if (!li) return;
      var u = universe.filter(function (x) { return x.s === li.getAttribute('data-sym'); })[0];
      if (u) pick(u);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.sim-search-wrap')) hideSuggest();
    });
    document.querySelectorAll('input[name="sim-strat"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var bh = strategy() === 'buyhold';
        ['sim-risk', 'sim-stopmult', 'sim-targetmult'].forEach(function (id) { $(id).disabled = bh; });
        $('sim-sizing').classList.toggle('dimmed', bh);
      });
    });
    $('sim-run').addEventListener('click', doRun);
    $('sim-rerun').addEventListener('click', function () {
      if (!curSym) return;
      loadHistory(curSym, { preserve: true }).then(function () { if (rows.length) doRun(); });
    });
    $('sim-sector').addEventListener('change', function () { sectorPage = 0; loadVerdicts().then(renderSector); });
    $('sim-sector').addEventListener('focus', function () { loadVerdicts().then(renderSector); });
    $('sim-sector-prev').addEventListener('click', function () { if (sectorPage > 0) { sectorPage--; renderSector(); } });
    $('sim-sector-next').addEventListener('click', function () { sectorPage++; renderSector(); });
    $('sim-sector-clear').addEventListener('click', function () { $('sim-sector').value = ''; sectorPage = 0; renderSector(); });
    document.addEventListener('click', function (e) {
      var lb = e.target.closest('[data-load]');
      if (lb) {
        var sym = lb.getAttribute('data-load');
        var u = universe.filter(function (x) { return x.s === sym; })[0];
        if (u) pick(u); else { $('sim-sym').value = sym; loadHistory(sym); }
        return;
      }
      var tb = e.target.closest('[data-track]');
      if (tb) { trackStrat = tb.getAttribute('data-track'); renderTrack(); }
    });
    $('sim-save-run-note').addEventListener('click', function () {
      var ta = $('sim-run-note'), v = ta.value.trim();
      if (!v || !lastRun) return;
      addJournal({ kind: 'run', runRef: lastRun.runId, title: lastRun.sym + ' · ' + lastRun.strat, note: v });
      ta.value = ''; renderJournal();
    });
    document.addEventListener('click', function (e) {
      var nb = e.target.closest('[data-note]');
      if (nb) { openTradeNote(parseInt(nb.getAttribute('data-note'), 10)); return; }
      var ns = e.target.closest('[data-notesave]');
      if (ns) {
        var i = parseInt(ns.getAttribute('data-notesave'), 10);
        var ta = $('tnote-ta-' + i), v = ta.value.trim();
        if (v && lastRun) {
          var t = lastRun.trades[i];
          addJournal({ kind: 'trade', runRef: lastRun.runId, tradeIdx: i,
            title: lastRun.sym + ' trade ' + (i + 1) + ' (' + fmtYMD(t.entryYmd) + ')', note: v });
          renderJournal(); openTradeNote(i);
        }
        return;
      }
      var jd = e.target.closest('[data-jdel]');
      if (jd) {
        delJournal(jd.getAttribute('data-jdel')); renderJournal();
        if (lastRun && jd.closest('.tnote')) {
          var box = jd.closest('.tnote');
          openTradeNote(parseInt(box.id.replace('tnote-', ''), 10));
        }
      }
    });
    window.addEventListener('resize', function () { if (lastRun && !$('sim-results').hidden) drawEquity(lastRun); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
