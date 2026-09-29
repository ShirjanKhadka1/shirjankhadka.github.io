/* NEPSE paper-trading simulator.
   Historical, rule-based, educational backtests on daily OHLC data.
   Conventions (also stated on the page):
   - Signals use only data through day t; trades execute at day t's CLOSE.
   - A position entered at day t's close can first hit its stop/target on day t+1.
   - If stop and target are both touched the same day, the stop is assumed hit first (conservative).
   - Strategy exit signals are evaluated and executed at day t's close.
   - One position per symbol at a time. No fees, taxes, or slippage modeled. */
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
  var REASONS = { stop: 'Stop loss', target: 'Take profit', signal: 'Strategy exit', end: 'End of period' };

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
    var cash = opts.startCash, pos = null, openTrade = null, trades = [], curve = [];

    var bhQty = Math.floor(opts.startCash / closes[from]);
    var bhCash = opts.startCash - bhQty * closes[from];
    var warm = from + 50; // SMA50 needs 50 in-range bars before signals are valid

    function equityAt(i) { return cash + (pos ? pos.qty * closes[i] : 0); }
    function exitPos(i, price, reason) {
      cash += openTrade.qty * price;
      openTrade.exitIdx = i; openTrade.exitYmd = rows[i][0];
      openTrade.exit = price; openTrade.reason = reason;
      openTrade.pnl = (price - openTrade.entry) * openTrade.qty;
      openTrade.retPct = openTrade.entry > 0 ? (price - openTrade.entry) / openTrade.entry * 100 : 0;
      trades.push(openTrade);
      pos = null; openTrade = null;
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

    if (strat === 'buyhold') {
      // Baseline: full equity in at the first close of the range, out at the last.
      if (bhQty >= 1) {
        trades.push({
          entryIdx: from, entryYmd: rows[from][0], entry: closes[from], qty: bhQty,
          stop: null, target: null,
          exitIdx: to, exitYmd: rows[to][0], exit: closes[to], reason: 'end',
          pnl: (closes[to] - closes[from]) * bhQty,
          retPct: closes[from] > 0 ? (closes[to] - closes[from]) / closes[from] * 100 : 0
        });
      }
      for (var b = from; b <= to; b++) {
        curve.push({ i: b, ymd: rows[b][0], equity: bhCash + bhQty * closes[b], bh: bhCash + bhQty * closes[b] });
      }
    } else {
      for (var i = from; i <= to; i++) {
        if (pos && i > pos.entryIdx) {
          var lo = rows[i][3], hi = rows[i][2];
          if (lo <= pos.stop) exitPos(i, pos.stop, 'stop');
          else if (hi >= pos.target) exitPos(i, pos.target, 'target');
        }
        if (pos && exitSignal(i)) exitPos(i, closes[i], 'signal');
        if (!pos && enterSignal(i)) {
          var entry = closes[i], a = atr[i];
          if (a != null && a > 0 && entry > 0) {
            var stop = entry - opts.stopMult * a;
            var target = entry + opts.targetMult * a;
            var riskAmt = (opts.riskPct / 100) * equityAt(i);
            var dist = entry - stop;
            var qty = dist > 0 ? Math.floor(riskAmt / dist) : 0;
            if (qty * entry > cash) qty = Math.floor(cash / entry);
            if (qty >= 1) {
              pos = { qty: qty, entry: entry, stop: stop, target: target, entryIdx: i };
              cash -= qty * entry;
              openTrade = {
                entryIdx: i, entryYmd: rows[i][0], entry: entry, qty: qty,
                stop: stop, target: target, exitIdx: null
              };
            }
          }
        }
        curve.push({ i: i, ymd: rows[i][0], equity: equityAt(i), bh: bhCash + bhQty * closes[i] });
      }
      if (pos) exitPos(to, closes[to], 'end');
    }

    var finalEq = curve.length ? curve[curve.length - 1].equity : opts.startCash;
    var wins = trades.filter(function (t) { return t.pnl > 0; });
    var losses = trades.filter(function (t) { return t.pnl <= 0; });
    var avg = function (arr) { return arr.length ? arr.reduce(function (s, t) { return s + t.pnl; }, 0) / arr.length : 0; };
    var peak = -Infinity, mdd = 0;
    curve.forEach(function (p) {
      if (p.equity > peak) peak = p.equity;
      if (peak > 0) { var dd = (peak - p.equity) / peak * 100; if (dd > mdd) mdd = dd; }
    });
    var bhFinal = bhCash + bhQty * closes[to];
    return {
      error: null,
      strat: strat,
      fromYmd: rows[from][0], toYmd: rows[to][0],
      startCash: opts.startCash,
      trades: trades,
      curve: curve,
      stats: {
        finalEquity: finalEq,
        totalReturnPct: (finalEq - opts.startCash) / opts.startCash * 100,
        nTrades: trades.length,
        wins: wins.length,
        winRate: trades.length ? wins.length / trades.length * 100 : 0,
        avgWin: avg(wins), avgLoss: avg(losses),
        maxDrawdownPct: mdd,
        bhFinal: bhFinal,
        bhReturnPct: (bhFinal - opts.startCash) / opts.startCash * 100
      }
    };
  }

  var api = { smaArr: smaArr, rsiArr: rsiArr, atrArr: atrArr, fmtYMD: fmtYMD, runSimulation: runSimulation, REASONS: REASONS };

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

  var PRICES = function (s) { return 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' + s.replace('/', '-') + '.json'; };
  var universe = [], rows = [], curSym = null, lastRun = null, runSeq = 0;
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
  function loadHistory(sym) {
    curSym = sym; rows = [];
    setStatus('Loading ' + sym + ' history…');
    $('sim-run').disabled = true;
    fetch(PRICES(sym)).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      rows = ((j && j.data) || []).map(function (d) {
        return [Number(String(d.date).replace(/-/g, '')), +d.open || 0, +d.high || 0, +d.low || 0, +d.ltp || 0, +d.qty || 0, +d.turnover || 0];
      }).filter(function (r) { return r[4] > 0 && r[2] > 0 && r[3] > 0; });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      if (rows.length < 60) throw new Error('only ' + rows.length + ' sessions');
      var first = fmtYMD(rows[0][0]), last = fmtYMD(rows[rows.length - 1][0]);
      var st = $('sim-start'), en = $('sim-end');
      st.min = first; st.max = last; en.min = first; en.max = last;
      var back = rows[Math.max(0, rows.length - 253)][0];
      st.value = fmtYMD(back); en.value = last;
      var badge = $('sim-data-note');
      if (badge && window.NepseFresh) {
        badge.innerHTML = 'History: ' + rows.length + ' sessions, ' + first + ' to ' + last +
          ' <span class="fresh">' + esc(window.NepseFresh.label(last)) + '</span>';
      }
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
    var res = runSimulation(rows, {
      strategy: strategy(), startCash: cash, riskPct: risk,
      stopMult: sm, targetMult: tm, fromIdx: fromIdx, toIdx: toIdx
    });
    if (res.error) { setStatus(res.error, true); return; }
    res.sym = curSym; res.runId = 'run' + (++runSeq);
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
      statCard('Final equity', fmtRs(s.finalEquity)) +
      statCard('Total return', fmtPct(s.totalReturnPct), cls(s.totalReturnPct)) +
      statCard('Buy-and-hold return', fmtPct(s.bhReturnPct), cls(s.bhReturnPct)) +
      statCard('Trades', String(s.nTrades)) +
      statCard('Win rate', s.nTrades ? fmtNum(s.winRate, 1) + '%' : '–') +
      statCard('Avg win', s.wins ? fmtRs(s.avgWin) : '–', 'up') +
      statCard('Avg loss', s.nTrades - s.wins ? fmtRs(s.avgLoss) : '–', 'down') +
      statCard('Max drawdown', '−' + fmtNum(s.maxDrawdownPct, 2) + '%', 'down');
    drawEquity(res);
    var tb = $('sim-trades-body');
    tb.innerHTML = res.trades.map(function (t, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + fmtYMD(t.entryYmd) + '</td><td>' + fmtRs(t.entry) + '</td>' +
        '<td>' + fmtYMD(t.exitYmd) + '</td><td>' + fmtRs(t.exit) + '</td><td>' + t.qty + '</td>' +
        '<td class="' + cls(t.pnl) + '">' + (t.pnl >= 0 ? '+' : '') + fmtRs(t.pnl).replace('Rs ', 'Rs\u00a0') + '</td>' +
        '<td>' + esc(REASONS[t.reason] || t.reason) + '</td>' +
        '<td><button class="linklike" data-note="' + i + '">Note</button><div class="tnote" id="tnote-' + i + '" hidden></div></td></tr>';
    }).join('') || '<tr><td colspan="9" class="muted">No trades were triggered in this range.</td></tr>';
    $('sim-run-note').value = '';
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
    ctx.strokeStyle = 'rgba(12,31,22,.12)'; ctx.lineWidth = 1;
    ctx.fillStyle = '#66705F'; ctx.font = '11px Inter, sans-serif';
    for (var g = 0; g <= 4; g++) {
      var v = min + (max - min) * g / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 12, y); ctx.stroke();
      ctx.fillText('Rs ' + fmtNum(v, 0), 2, y + 4);
    }
    function line(key, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      pts.forEach(function (p, i) { var x = X(i), y = Y(p[key]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    line('bh', 'rgba(12,31,22,.35)', 1.5);
    line('equity', '#C6A86B', 2.5);
    ctx.fillStyle = '#66705F';
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

  /* ---------- init ---------- */
  function init() {
    renderJournal();
    var symInput = $('sim-sym');
    fetch('/nepse-chart/data/universe.json').then(function (r) { return r.json(); }).then(function (u) {
      universe = (u.symbols || []).filter(function (s) { return s.o === 1; })
        .sort(function (a, b) { return a.s < b.s ? -1 : 1; });
    }).catch(function () { universe = []; });
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
