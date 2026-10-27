/* nepse-engine-verdict/verdict.js — engine ranking table, teardown 2026-10-27.
 * Loads /nepse-chart/data/verdicts.json (daily batch) + /nepse-chart/data/live.json
 * (live tape) + screener-calls.json (forward ledger) + screener-verdict-archive.json
 * + universe.json (coverage denominator).
 *
 * TAPE REPAINT (audit condition 2, 2026-10-27): the batch renders rows directly,
 * so a stale-asof row (BENH: batch Oct-16, price 353 / +12.46) used to display
 * while the live tape showed 466.7 / +14.98. Price and change are now repainted
 * from the tape wherever a quote exists and the tape session is at least the
 * row's own session — mirroring the screener's live overlay ("Signals, SL/TP
 * and hit rates stay daily-batch"). Rows without a tape quote keep batch values
 * and carry a stale marker. 52W position is recomputed from the repainted price
 * (capped at 0–100%, with a new-high / new-low marker past the batch range).
 * Volume, stops, targets, verdicts and scores are NEVER repainted.
 *
 * 60s change-gated refresh (series standard): a signature over the loaded data
 * is recomputed every tick; unchanged payloads advance only the freshness
 * clock. View-change handlers never touch the signature — it is set only by
 * rebaseline() after a data render, never nulled. */
(function () {
  'use strict';
  var DATA_URL = '/nepse-chart/data/verdicts.json';
  var TAPE_URL = '/nepse-chart/data/live.json';
  var CALLS_URL = '/nepse-chart/data/screener-calls.json';
  var ARCHIVE_URL = '/nepse-chart/data/screener-verdict-archive.json';
  var UNIVERSE_URL = '/nepse-chart/data/universe.json';
  var PER_PAGE = 50, CALLS_PER_PAGE = 25, REFRESH_MS = 60000;

  var state = {
    rows: [], batchAsof: '', tapeAsOf: '', tapeSession: '', callsAsOf: '',
    archiveLast: '', listed: 0, changes: null, calls: [], callsSummary: null,
    archive: null, verdict: 'all', sector: 'all', q: '', staleOnly: false,
    sortKey: 's', sortDir: -1, page: 1, callsPage: 1, sig: null, timer: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function fmtN(v, d) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '—';
  }
  function fmtK(v) {
    if (v == null) return '—';
    var n = Number(v);
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function fmtClock(d) {
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  var VCLASS = {
    'Strong Buy': 'sb', 'Buy': 'b', 'Hold': 'h',
    'Exit': 'e', 'Exit / Reduce': 'e', 'Strong Exit': 'se', 'Strong Sell': 'se',
    'Insufficient history': 'ins'
  };
  function vClass(v) { return VCLASS[v] || 'h'; }
  function isBuySide(v) { return v === 'Strong Buy' || v === 'Buy'; }
  function isExitSide(v) { return v === 'Exit' || v === 'Exit / Reduce' || v === 'Strong Exit' || v === 'Strong Sell'; }

  /* ---------------- data load + tape repaint ---------------- */

  function enrichRows(batch, tape) {
    var quotes = {};
    if (tape && Array.isArray(tape.quotes)) {
      tape.quotes.forEach(function (q) { if (q && q.symbol) quotes[q.symbol] = q; });
    }
    var tapeSession = '';
    if (tape && tape.asof) tapeSession = String(tape.asof).slice(0, 10);
    state.tapeAsOf = tape ? (tape.asof || '') : '';
    state.tapeSession = tapeSession;
    var v = (batch && batch.verdicts) || {};
    var rows = Object.keys(v).map(function (sym) {
      var r = v[sym] || {};
      var row = {
        sym: sym, v: r.v || 'Hold', s: (typeof r.s === 'number' ? r.s : null),
        p: r.p, ch: r.ch, h52: r.h52, l52: r.l52, pos: r.pos, rsi: r.rsi,
        n: r.n, l: r.l, asof: r.asof || '', sec: r.sec || '—',
        vol: r.vol, volAvg: r.volAvg, sl: r.sl, tp: r.tp, setup: r.setup || null,
        tr: r.tr || null, w: r.w || null, m: r.m || null, pv: r.pv || null,
        ps: (typeof r.ps === 'number' ? r.ps : null), st: r.st || 0,
        vc: r.vc || 'flat', flip: !!r.flip,
        repainted: false, newHigh: false, newLow: false
      };
      /* Tape repaint: live market fields only. Guards mirror nepse-data.js
         validation (finite ltp, finite positive previous_close). */
      var q = quotes[sym];
      if (q && tapeSession && row.asof && tapeSession >= row.asof &&
          isFinite(Number(q.ltp)) && isFinite(Number(q.previous_close)) &&
          Number(q.previous_close) > 0) {
        var pct = isFinite(Number(q.percent_change)) ? Number(q.percent_change)
          : ((Number(q.ltp) - Number(q.previous_close)) / Number(q.previous_close)) * 100;
        row.p = Number(q.ltp);
        row.ch = Math.round(pct * 100) / 100;
        row.repainted = true;
        /* 52W position recomputed from the repainted price; capped, flagged. */
        if (row.h52 != null && row.l52 != null && row.h52 > row.l52) {
          var raw = (row.p - row.l52) / (row.h52 - row.l52);
          if (raw > 1) { row.pos = 1; row.newHigh = true; }
          else if (raw < 0) { row.pos = 0; row.newLow = true; }
          else row.pos = Math.round(raw * 100) / 100;
        }
      }
      row.stale = !!(state.batchAsof && row.asof && row.asof < state.batchAsof);
      row.ltpOnly = row.l === 1;
      return row;
    });
    return rows;
  }

  function loadAll() {
    return Promise.all([
      fetchJSON(DATA_URL),
      fetchJSON(TAPE_URL).catch(function () { return null; }),
      fetchJSON(CALLS_URL).catch(function () { return null; }),
      fetchJSON(ARCHIVE_URL).catch(function () { return null; }),
      fetchJSON(UNIVERSE_URL).catch(function () { return null; })
    ]).then(function (parts) {
      var batch = parts[0], tape = parts[1], callsDoc = parts[2],
          archiveDoc = parts[3], uni = parts[4];
      state.batchAsof = batch.asof || '';
      state.changes = batch.changes || null;
      state.rows = enrichRows(batch, tape);
      state.listed = (uni && Array.isArray(uni.symbols)) ? uni.symbols.length
        : (uni && typeof uni.count === 'number' ? uni.count : 0);
      if (callsDoc) {
        state.calls = Array.isArray(callsDoc.calls) ? callsDoc.calls : [];
        state.callsSummary = callsDoc.summary || null;
        state.callsAsOf = callsDoc.asof || (callsDoc.summary && callsDoc.summary.asof) || '';
      }
      if (archiveDoc && archiveDoc.sessions) {
        state.archive = archiveDoc.sessions;
        var keys = Object.keys(archiveDoc.sessions).sort();
        state.archiveLast = keys.length ? keys[keys.length - 1] : '';
      }
      return true;
    });
  }

  /* ---------------- signature + refresh ---------------- */

  function distCounts(rows) {
    var c = {};
    rows.forEach(function (r) { c[r.v] = (c[r.v] || 0) + 1; });
    return c;
  }
  function computeSig() {
    var dist = distCounts(state.rows);
    var distStr = Object.keys(dist).sort().map(function (k) { return k + ':' + dist[k]; }).join(',');
    var secStr = Object.keys(sectorCounts(state.rows)).sort().map(function (k) {
      return k + ':' + sectorCounts(state.rows)[k];
    }).join(',');
    return [state.batchAsof, state.rows.length, distStr, secStr,
      state.tapeSession, state.callsAsOf, state.archiveLast].join('|');
  }
  function rebaseline() { state.sig = computeSig(); }

  function renderFresh() {
    var el = $('evFresh');
    if (!el) return;
    var now = new Date(), next = new Date(now.getTime() + REFRESH_MS);
    var tapeBit = state.tapeSession ? ' · tape ' + state.tapeSession : ' · tape unavailable';
    el.textContent = state.batchAsof
      ? 'Ranking as of ' + state.batchAsof + tapeBit + ' · checked ' + fmtClock(now) +
        ' · next check ' + fmtClock(next) + ' · refreshes every 60s when the data changes'
      : 'Ranking session unavailable';
  }

  function refreshTick() {
    var oldSig = state.sig;
    loadAll().then(function () {
      var newSig = computeSig();
      if (newSig !== oldSig) {
        renderAll();
        rebaseline();
      }
      renderFresh();
    }).catch(function () { renderFresh(); });
  }

  /* ---------------- derived views ---------------- */

  function sectorCounts(rows) {
    var c = {};
    rows.forEach(function (r) { c[r.sec] = (c[r.sec] || 0) + 1; });
    return c;
  }
  function sectorList() {
    var counts = sectorCounts(state.rows);
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  }

  function filtered() {
    var rows = state.rows.slice();
    if (state.verdict === 'buy-side') rows = rows.filter(function (r) { return isBuySide(r.v); });
    else if (state.verdict === 'exit-side') rows = rows.filter(function (r) { return isExitSide(r.v); });
    else if (state.verdict !== 'all') rows = rows.filter(function (r) { return r.v === state.verdict; });
    if (state.sector !== 'all') rows = rows.filter(function (r) { return r.sec === state.sector; });
    if (state.staleOnly) rows = rows.filter(function (r) { return r.stale; });
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return r.sym.toLowerCase().indexOf(q) !== -1; });
    }
    var k = state.sortKey, d = state.sortDir;
    rows.sort(function (a, b) {
      var va = a[k], vb = b[k];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') { va = va.toLowerCase(); vb = String(vb).toLowerCase(); }
      if (va < vb) return -1 * d;
      if (va > vb) return 1 * d;
      return 0;
    });
    return rows;
  }

  /* ---------------- stats + distribution + histogram ---------------- */

  function renderStats() {
    var host = $('evStats');
    if (!host) return;
    var dist = distCounts(state.rows);
    var buySide = (dist['Strong Buy'] || 0) + (dist['Buy'] || 0);
    var exitSide = (dist['Exit'] || 0) + (dist['Exit / Reduce'] || 0) +
      (dist['Strong Exit'] || 0) + (dist['Strong Sell'] || 0);
    var hold = dist['Hold'] || 0, ins = dist['Insufficient history'] || 0;
    var take = '';
    if (exitSide > buySide * 2) {
      take = '<p class="ev-take">The engine is cautious: <strong>' + exitSide + ' exit signals</strong> vs <strong>' + buySide + ' buys</strong>. ' +
        'In this tape, even Strong Buys deserve smaller size. <a href="/nepse-screener/">See the Strong Buys →</a></p>';
    } else if (buySide > exitSide) {
      take = '<p class="ev-take">The engine is constructive: <strong>' + buySide + ' buy signals</strong> vs <strong>' + exitSide + ' exits</strong>. ' +
        'Momentum favors the buy-side. <a href="/nepse-screener/">Rank the buys →</a></p>';
    } else {
      take = '<p class="ev-take">The engine is mixed: <strong>' + buySide + ' buys</strong> vs <strong>' + exitSide + ' exits</strong>. ' +
        'Stock-picking matters more than market direction today.</p>';
    }
    var seg = [['dsb', 'Strong Buy', dist['Strong Buy'] || 0], ['db', 'Buy', dist['Buy'] || 0],
      ['dh', 'Hold', hold], ['de', 'Exit / Reduce', (dist['Exit'] || 0) + (dist['Exit / Reduce'] || 0)],
      ['dse', 'Strong Exit', (dist['Strong Exit'] || 0) + (dist['Strong Sell'] || 0)],
      ['dins', 'Insufficient history', ins]];
    var tot = state.rows.length || 1, track = '', legend = '';
    seg.forEach(function (s) {
      if (!s[2]) return;
      track += '<i class="' + s[0] + '" style="width:' + (s[2] / tot * 100).toFixed(2) + '%"></i>';
      legend += '<span><b class="' + s[0] + '"></b>' + s[1] + ' ' + s[2] + '</span>';
    });
    var statBtn = function (v, num, lbl, cls) {
      return '<button type="button" class="ev-stat' + (cls ? ' ' + cls : '') + '" data-v="' + esc(v) +
        '" aria-pressed="' + (state.verdict === v) + '"><span class="num">' + num +
        '</span><span class="lbl">' + lbl + '</span></button>';
    };
    host.innerHTML =
      statBtn('buy-side', buySide, 'Buy-side', 'buy') +
      statBtn('Hold', hold, 'Hold', '') +
      statBtn('exit-side', exitSide, 'Exit-side', 'exit') +
      statBtn('Insufficient history', ins, 'Insufficient history', '') +
      statBtn('all', state.rows.length, 'Securities scored', '') +
      '<div class="ev-dist" role="img" aria-label="Verdict balance across ' + state.rows.length + ' scored securities"><div class="ev-dist-track">' + track + '</div><div class="ev-dist-legend">' + legend + '</div></div>' +
      take;
    host.querySelectorAll('.ev-stat').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1;
        renderStats(); renderFilters(); renderTable();
        $('evTableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    renderHistogram();
  }

  function renderHistogram() {
    var host = $('evHist');
    if (!host) return;
    var buckets = [['< −5', function (s) { return s < -5; }],
      ['−5 to −2.5', function (s) { return s >= -5 && s < -2.5; }],
      ['−2.5 to 0', function (s) { return s >= -2.5 && s < 0; }],
      ['0 to 2.5', function (s) { return s >= 0 && s < 2.5; }],
      ['2.5 to 5', function (s) { return s >= 2.5 && s < 5; }],
      ['> 5', function (s) { return s >= 5; }]];
    var counts = buckets.map(function () { return 0; });
    var unscored = 0;
    state.rows.forEach(function (r) {
      if (r.s == null) { unscored++; return; }
      for (var i = 0; i < buckets.length; i++) {
        if (buckets[i][1](r.s)) { counts[i]++; break; }
      }
    });
    var max = 0;
    counts.forEach(function (c) { if (c > max) max = c; });
    var tot = state.rows.length || 1;
    var rows = counts.map(function (c, i) {
      var w = max ? (c / max * 100).toFixed(1) : 0;
      var cls = i < 3 ? 'neg' : 'pos';
      return '<div class="ev-hist-row"><span class="ev-hist-lbl">' + buckets[i][0] +
        '</span><span class="ev-hist-track"><i class="' + cls + '" style="width:' + w + '%"></i></span>' +
        '<span class="ev-hist-val">' + c + ' (' + (c / tot * 100).toFixed(1) + '%)</span></div>';
    }).join('');
    host.innerHTML = '<h3 class="ev-h3">Score distribution</h3>' +
      '<p class="ev-hist-note">Every scored security, bucketed by engine score. ' +
      unscored + ' insufficient-history rows have no score and are not in the histogram.</p>' + rows;
  }

  /* ---------------- sector blocks ---------------- */

  function renderSectors() {
    var host = $('evSectors');
    if (!host) return;
    var counts = sectorCounts(state.rows);
    var cards = sectorList().map(function (sec) {
      var rows = state.rows.filter(function (r) { return r.sec === sec; });
      var b = rows.filter(function (r) { return isBuySide(r.v); }).length;
      var e = rows.filter(function (r) { return isExitSide(r.v); }).length;
      var h = rows.filter(function (r) { return r.v === 'Hold'; }).length;
      var tot = rows.length || 1;
      var top = rows.slice().sort(function (a, c) {
        var va = a.s == null ? -Infinity : a.s, vb = c.s == null ? -Infinity : c.s;
        return vb - va;
      }).slice(0, 3);
      var topHtml = top.map(function (r) {
        return '<li><a href="/stocks/' + esc(r.sym) + '/">' + esc(r.sym) + '</a> ' +
          '<span class="ev-v ' + vClass(r.v) + '">' + esc(r.v) + '</span> ' +
          '<span class="ev-score">' + (r.s == null ? '—' : (r.s > 0 ? '+' : '') + r.s.toFixed(1)) + '</span></li>';
      }).join('');
      var bar = [['sb', b], ['sh', h], ['se', e]].filter(function (x) { return x[1] > 0; })
        .map(function (x) { return '<i class="' + x[0] + '" style="width:' + (x[1] / tot * 100).toFixed(1) + '%"></i>'; }).join('');
      var active = state.sector === sec;
      return '<article class="ev-sector' + (active ? ' is-active' : '') + '" data-sec="' + esc(sec) + '" tabindex="0" role="button" aria-pressed="' + active + '">' +
        '<h3>' + esc(sec) + '</h3><p class="ev-sector-count">' + rows.length + ' stocks · ' + b + ' buy · ' + e + ' exit</p>' +
        '<div class="ev-sector-bar" role="img" aria-label="' + esc(sec) + ': ' + b + ' buy, ' + h + ' hold, ' + e + ' exit"><div class="ev-sector-track">' + bar + '</div></div>' +
        '<ul class="ev-sector-top">' + topHtml + '</ul>' +
        '<p class="ev-sector-cta">' + (active ? 'Showing this sector — click to clear' : 'Click to filter the table') + '</p></article>';
    }).join('');
    host.innerHTML = cards;
    host.querySelectorAll('.ev-sector').forEach(function (el) {
      var go = function () {
        var sec = el.getAttribute('data-sec');
        state.sector = (state.sector === sec) ? 'all' : sec;
        state.page = 1;
        renderSectors(); renderControls(); renderTable();
        $('evTableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  /* ---------------- session moves ---------------- */

  function renderMoves() {
    var host = $('evMoves');
    if (!host || !state.changes) { if (host) { host.innerHTML = ''; host.style.display = 'none'; } return; }
    host.style.display = '';
    var ch = state.changes;
    var tot = (ch.upgraded || 0) + (ch.held || 0) + (ch.downgraded || 0) + (ch.new || 0) || 1;
    var bar = [['mu', ch.upgraded || 0, 'Upgraded'], ['mh', ch.held || 0, 'Held'],
      ['md', ch.downgraded || 0, 'Downgraded'], ['mn', ch.new || 0, 'New']]
      .filter(function (x) { return x[1] > 0; })
      .map(function (x) { return '<i class="' + x[0] + '" style="width:' + (x[1] / tot * 100).toFixed(1) + '%"></i>'; }).join('');
    var legend = [['mu', 'Upgraded', ch.upgraded || 0], ['mh', 'Held', ch.held || 0],
      ['md', 'Downgraded', ch.downgraded || 0], ['mn', 'New', ch.new || 0]]
      .map(function (x) { return '<span><b class="' + x[0] + '"></b>' + x[1] + ' ' + x[2] + '</span>'; }).join('');
    var bySym = {};
    state.rows.forEach(function (r) { bySym[r.sym] = r; });
    var flips = (ch.flips || []).map(function (f) {
      var cur = bySym[f.symbol];
      var curTxt = cur ? ' now ' + esc(cur.v) + (cur.s == null ? '' : ' (' + (cur.s > 0 ? '+' : '') + cur.s.toFixed(1) + ')') : '';
      return '<li><a href="/stocks/' + esc(f.symbol) + '/">' + esc(f.symbol) + '</a> ' +
        '<span class="ev-flip-from">' + esc(f.from) + '</span> → ' +
        '<span class="ev-flip-to">' + esc(f.to) + '</span>' + curTxt + '</li>';
    }).join('');
    host.innerHTML = '<h3 class="ev-h3">Session moves — vs ' + esc(ch.prev_session || 'previous session') + '</h3>' +
      '<div class="ev-dist" role="img" aria-label="Session moves"><div class="ev-dist-track">' + bar + '</div><div class="ev-dist-legend">' + legend + '</div></div>' +
      '<p class="ev-moves-note">' + (ch.flips || []).length + ' verdicts flipped label this session:</p>' +
      '<ul class="ev-flips">' + flips + '</ul>';
  }

  /* ---------------- filters + controls ---------------- */

  var FILTERS = [['all', 'All'], ['buy-side', 'Buy-side'], ['Strong Buy', 'Strong Buy'], ['Buy', 'Buy'],
    ['Hold', 'Hold'], ['exit-side', 'Exit-side'], ['Exit / Reduce', 'Exit / Reduce'],
    ['Strong Exit', 'Strong Exit'], ['Insufficient history', 'Insufficient history']];
  function renderFilters() {
    var host = $('evFilters');
    if (!host) return;
    host.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="ev-f" data-v="' + esc(f[0]) + '" aria-pressed="' + (state.verdict === f[0]) + '">' + esc(f[1]) + '</button>';
    }).join('');
    host.querySelectorAll('.ev-f').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1;
        renderStats(); renderFilters(); renderTable();
        $('evTableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
  function renderControls() {
    var secSel = $('evSector');
    if (secSel) {
      var cur = state.sector;
      secSel.innerHTML = '<option value="all">All sectors</option>' + sectorList().map(function (s) {
        return '<option value="' + esc(s) + '"' + (cur === s ? ' selected' : '') + '>' +
          esc(s) + ' (' + sectorCounts(state.rows)[s] + ')</option>';
      }).join('');
    }
    var staleBtn = $('evStale');
    if (staleBtn) staleBtn.setAttribute('aria-pressed', state.staleOnly ? 'true' : 'false');
    var sortSel = $('evSort');
    if (sortSel) {
      var val = state.sortKey + ':' + (state.sortDir === 1 ? 'asc' : 'desc');
      sortSel.value = sortSel.querySelector('option[value="' + val + '"]') ? val : '';
    }
  }

  /* ---------------- main table ---------------- */

  var COLS = [
    { k: 'sym', l: 'Symbol' }, { k: 'v', l: 'Verdict' }, { k: 's', l: 'Score', n: 1 },
    { k: 'p', l: 'Price', n: 1 }, { k: 'ch', l: 'Chg %', n: 1 }, { k: 'rsi', l: 'RSI', n: 1 },
    { k: 'pos', l: '52W Pos', n: 1 }, { k: 'setup', l: 'Setup' }, { k: 'sl', l: 'Stop-loss', n: 1 },
    { k: 'tp', l: 'Target', n: 1 }, { k: 'wm', l: 'W / M' }, { k: 'tr', l: 'Backtest' },
    { k: 'vol', l: 'Volume', n: 1 }
  ];

  function moveArrow(vc) {
    if (vc === 'up') return '<span class="ev-move up" title="Score moved up this session">▲</span>';
    if (vc === 'down') return '<span class="ev-move down" title="Score moved down this session">▼</span>';
    if (vc === 'new') return '<span class="ev-move new" title="New this session">✦</span>';
    return '';
  }
  function cell(r, k) {
    if (k === 'sym') {
      var flags = '';
      if (r.stale) flags += ' <span class="ev-flag" title="Last scored ' + esc(r.asof) + ' — thin trading, no new session">◷ ' + esc(r.asof.slice(5)) + '</span>';
      if (r.ltpOnly) flags += ' <span class="ev-flag" title="LTP-only data — no full OHLC">LTP-only</span>';
      var hist = 'History: ' + fmtN(r.n, 0) + ' sessions · last scored ' + esc(r.asof);
      return '<td class="sym"><a href="/stocks/' + esc(r.sym) + '/" title="' + esc(hist) + '">' + esc(r.sym) + '</a>' + flags + '</td>';
    }
    if (k === 'v') {
      var streak = (isBuySide(r.v) && r.st >= 1)
        ? ' <span class="ev-streak" title="Buy-side for ' + r.st + ' consecutive sessions">· ' + r.st + 'd</span>' : '';
      var flip = r.flip ? ' <span class="ev-flipmark" title="Verdict flipped this session (previous: ' + esc(r.pv || '') + ')">FLIP</span>' : '';
      var prev = (r.pv != null || r.ps != null)
        ? 'Previous verdict: ' + esc(r.pv || '—') + (r.ps != null ? ', score ' + r.ps.toFixed(1) : '') : '';
      return '<td><span class="ev-v ' + vClass(r.v) + '" title="' + esc(prev) + '">' + esc(r.v) + '</span>' + streak + flip + '</td>';
    }
    if (k === 's') {
      var cls = r.s > 0 ? 'pos' : r.s < 0 ? 'neg' : '';
      return '<td class="num"><span class="ev-score ' + cls + '">' + (r.s == null ? '—' : (r.s > 0 ? '+' : '') + r.s.toFixed(1)) + '</span> ' + moveArrow(r.vc) + '</td>';
    }
    if (k === 'p') {
      var pt = r.repainted ? 'Live tape, ' + esc(state.tapeSession) : 'Batch price, ' + esc(r.asof);
      return '<td class="num" title="' + pt + '">' + fmtN(r.p, 2) + (r.repainted ? ' <span class="ev-live-dot" title="Repainted from the live tape">●</span>' : '') + '</td>';
    }
    if (k === 'ch') {
      var c = r.ch == null ? '—' : (r.ch > 0 ? '+' : '') + Number(r.ch).toFixed(2) + '%';
      var cc = r.ch > 0 ? 'pos' : r.ch < 0 ? 'neg' : '';
      return '<td class="num"><span class="ev-score ' + cc + '">' + c + '</span></td>';
    }
    if (k === 'rsi') return '<td class="num dim">' + (r.rsi == null ? '—' : Number(r.rsi).toFixed(1)) + '</td>';
    if (k === 'pos') {
      var range = (r.h52 != null && r.l52 != null) ? '52-week range ' + fmtN(r.l52, 1) + ' – ' + fmtN(r.h52, 1) : '';
      var mark = r.newHigh ? ' <span class="ev-newmark" title="Above the batch 52-week high — new high">new high</span>'
        : r.newLow ? ' <span class="ev-newmark" title="Below the batch 52-week low — new low">new low</span>' : '';
      return '<td class="num dim" title="' + esc(range) + '">' + (r.pos == null ? '—' : Math.round(r.pos * 100) + '%') + mark + '</td>';
    }
    if (k === 'sl' || k === 'tp') return '<td class="num dim">' + fmtN(r[k], 2) + '</td>';
    if (k === 'wm') {
      var pill = function (tf, o) {
        if (!o) return '<span class="ev-wm none" title="No ' + tf + ' timeframe verdict (short history or LTP-only)">—</span>';
        var t = tf + ' verdict: ' + o.v + ', score ' + (o.s == null ? '—' : o.s.toFixed(1)) +
          (o.setup ? ', ' + o.setup : '') + ', as of ' + (o.asof || '');
        return '<span class="ev-wm ' + vClass(o.v) + '" title="' + esc(t) + '">' + tf + ' ' + esc(o.v) + '</span>';
      };
      return '<td class="ev-wm-cell">' + pill('W', r.w) + ' ' + pill('M', r.m) + '</td>';
    }
    if (k === 'tr') {
      if (!r.tr) return '<td class="num dim" title="No backtest: fewer than 5 decided calls, non-equity, or short history">—</td>';
      var t = 'Backtest over the last 250 sessions: ' + r.tr.n + ' Buy calls decided within 20 sessions, ' +
        (r.tr.w * 100).toFixed(1) + '% hit target before stop';
      return '<td class="num" title="' + esc(t) + '">' + r.tr.n + ' · ' + (r.tr.w * 100).toFixed(1) + '%</td>';
    }
    if (k === 'vol') {
      var vt = r.volAvg != null ? 'Average volume ' + fmtN(r.volAvg, 0) : 'No average volume';
      return '<td class="num dim" title="' + esc(vt) + '">' + fmtK(r.vol) + '</td>';
    }
    return '<td class="dim">' + esc(r[k] == null ? '—' : r[k]) + '</td>';
  }

  function renderTable() {
    var host = $('evTableWrap'), cnt = $('evCount'), pager = $('evPager');
    if (!host) return;
    var rows = filtered();
    var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PER_PAGE;
    var page = rows.slice(start, start + PER_PAGE);
    var th = COLS.map(function (c) {
      var active = state.sortKey === c.k;
      var arr = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
      var sortable = (c.k !== 'wm' && c.k !== 'tr');
      return '<th scope="col" data-k="' + c.k + '" class="' + (sortable ? 'sortable' : '') + (c.n ? ' num' : '') + '">' + esc(c.l) + '<span class="arr">' + arr + '</span></th>';
    }).join('');
    var body = page.length
      ? page.map(function (r) { return '<tr>' + COLS.map(function (c) { return cell(r, c.k); }).join('') + '</tr>'; }).join('')
      : '<tr><td colspan="' + COLS.length + '"><div class="ev-empty">No securities match your filters.</div></td></tr>';
    host.innerHTML = '<table class="ev-table nd-table"><caption>Ranked by engine score ' +
      (state.sortDir === 1 ? 'ascending' : 'descending') + ' · ' + esc(state.batchAsof || 'date unavailable') +
      '</caption><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
    host.querySelectorAll('th.sortable').forEach(function (h) {
      h.addEventListener('click', function () {
        var k = h.getAttribute('data-k');
        if (k === 'wm' || k === 'tr') return;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = (k === 'sym' || k === 'v' || k === 'setup' ? 1 : -1); }
        state.page = 1; renderControls(); renderTable();
      });
    });
    if (cnt) cnt.textContent = rows.length
      ? 'Showing ' + (start + 1) + '–' + Math.min(start + PER_PAGE, rows.length) + ' of ' + rows.length + ' securities'
      : 'No securities found';
    var note = $('evRepaintNote');
    if (note) {
      var quoted = state.rows.filter(function (r) { return r.repainted; }).length;
      note.textContent = state.tapeSession
        ? 'Price and change repainted from the ' + state.tapeSession + ' live tape where available (' + quoted + ' of ' + state.rows.length + ' rows); stops, targets and verdicts stay daily-batch. Rows without a tape quote show batch values.'
        : 'Live tape unavailable — batch prices shown.';
    }
    renderPager(pager, totalPages, state.page, function (p) { state.page = p; renderTable(); });
  }

  function renderPager(host, totalPages, current, onPage) {
    if (!host) return;
    if (totalPages <= 1) { host.innerHTML = ''; return; }
    var h = '<button type="button" class="ev-pagebtn prev" data-p="prev"' + (current <= 1 ? ' disabled' : '') + ' aria-label="Previous page">← Prev</button>';
    var lo = Math.max(1, current - 2), hi = Math.min(totalPages, current + 2);
    if (lo > 1) h += '<button type="button" class="ev-pagebtn" data-p="1">1</button>' + (lo > 2 ? '<span class="ev-pageinfo">…</span>' : '');
    for (var p = lo; p <= hi; p++) h += '<button type="button" class="ev-pagebtn" data-p="' + p + '"' + (p === current ? ' aria-current="true"' : '') + '>' + p + '</button>';
    if (hi < totalPages) h += (hi < totalPages - 1 ? '<span class="ev-pageinfo">…</span>' : '') + '<button type="button" class="ev-pagebtn" data-p="' + totalPages + '">' + totalPages + '</button>';
    h += '<button type="button" class="ev-pagebtn next" data-p="next"' + (current >= totalPages ? ' disabled' : '') + ' aria-label="Next page">Next →</button>';
    h += '<span class="ev-pageinfo">Page ' + current + ' of ' + totalPages + '</span>';
    host.innerHTML = h;
    host.querySelectorAll('.ev-pagebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var v = b.getAttribute('data-p');
        var next;
        if (v === 'prev') next = Math.max(1, current - 1);
        else if (v === 'next') next = Math.min(totalPages, current + 1);
        else next = parseInt(v, 10) || 1;
        onPage(next);
        $('evTableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ---------------- forward tracking + archive ---------------- */

  function renderTracking() {
    var host = $('evTracking');
    if (!host) return;
    if (!state.callsSummary && !state.calls.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = '';
    var s = state.callsSummary || {};
    var open = (s.open != null ? s.open : state.calls.filter(function (c) { return c.status === 'open'; }).length);
    var closed = (s.closed_tp || 0) + (s.closed_sl || 0) + (s.closed_expired || 0);
    var pers = s.by_persistence || {};
    var persTxt = ['flash', 'mid', 'persistent'].map(function (k) {
      return k + ' ' + ((pers[k] && pers[k].n) || 0);
    }).join(' · ');
    var banner = closed === 0
      ? '<p class="ev-noclosed">No closed paper trades yet — ' + open + ' open Buy calls are being walked forward to target, stop or 20-session expiry. A win rate appears only after the first calls close; none is shown until then.</p>'
      : '<p class="ev-noclosed">Closed paper trades: ' + closed + ' (win rate ' + (s.win_rate == null ? '—' : (s.win_rate * 100).toFixed(1) + '%') + ').</p>';
    var totalPages = Math.max(1, Math.ceil(state.calls.length / CALLS_PER_PAGE));
    if (state.callsPage > totalPages) state.callsPage = totalPages;
    var start = (state.callsPage - 1) * CALLS_PER_PAGE;
    var page = state.calls.slice(start, start + CALLS_PER_PAGE);
    var rows = page.map(function (c) {
      return '<tr><td class="sym"><a href="/stocks/' + esc(c.sym) + '/">' + esc(c.sym) + '</a></td>' +
        '<td>' + esc(c.date || '') + '</td><td class="num">' + fmtN(c.entry, 2) + '</td>' +
        '<td class="num">' + fmtN(c.sl, 2) + '</td><td class="num">' + fmtN(c.tp, 2) + '</td>' +
        '<td class="dim">' + esc(c.setup || '—') + '</td><td class="num dim">' + (c.streak || 1) + '</td>' +
        '<td class="num dim">' + (c.sessions_elapsed == null ? '—' : c.sessions_elapsed) + '</td>' +
        '<td class="num dim">' + (c.last_return == null ? '—' : (c.last_return * 100).toFixed(2) + '%') + '</td></tr>';
    }).join('');
    host.innerHTML = '<h3 class="ev-h3">Forward paper-trade ledger</h3>' +
      '<p class="ev-track-meta">' + open + ' open calls · ' + closed + ' closed · ' +
      (s.created_today != null ? s.created_today + ' created ' + esc(state.callsAsOf || '') + ' · ' : '') +
      'persistence: ' + esc(persTxt) + ' · ledger as of ' + esc(state.callsAsOf || '') + '</p>' + banner +
      '<div class="ev-tablewrap"><table class="ev-table nd-table"><caption>Open Buy calls, walked to target (+4×ATR), stop (−2×ATR) or 20-session expiry</caption>' +
      '<thead><tr><th scope="col">Symbol</th><th scope="col">Call date</th><th scope="col" class="num">Entry</th>' +
      '<th scope="col" class="num">Stop</th><th scope="col" class="num">Target</th><th scope="col">Setup</th>' +
      '<th scope="col" class="num">Streak</th><th scope="col" class="num">Sessions</th><th scope="col" class="num">Last return</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="9"><div class="ev-empty">No open calls.</div></td></tr>') + '</tbody></table></div>' +
      '<p class="ev-count" id="evCallsCount">Showing ' + (state.calls.length ? start + 1 : 0) + '–' + Math.min(start + CALLS_PER_PAGE, state.calls.length) + ' of ' + state.calls.length + ' open calls</p>' +
      '<nav class="ev-pager" id="evCallsPager" aria-label="Call pages"></nav>' +
      '<p class="ev-track-note">Note: all open calls currently show 0 sessions elapsed and no last return, including October 16 entries — walk advancement is under verification with the tracking pipeline; figures shown as stored.</p>';
    renderPager($('evCallsPager'), totalPages, state.callsPage, function (p) { state.callsPage = p; renderTracking(); });
  }

  function renderArchive() {
    var host = $('evArchive');
    if (!host || !state.archive) { if (host) { host.innerHTML = ''; host.style.display = 'none'; } return; }
    host.style.display = '';
    var rows = Object.keys(state.archive).sort().map(function (d) {
      var snap = state.archive[d] || {};
      var syms = Object.keys(snap);
      var b = 0, h = 0, e = 0, ins = 0;
      syms.forEach(function (s) {
        var v = snap[s] && snap[s].v;
        if (isBuySide(v)) b++;
        else if (isExitSide(v)) e++;
        else if (v === 'Hold') h++;
        else ins++;
      });
      return '<tr><td>' + esc(d) + '</td><td class="num">' + syms.length + '</td><td class="num">' + b + '</td>' +
        '<td class="num">' + h + '</td><td class="num">' + e + '</td><td class="num">' + ins + '</td></tr>';
    }).join('');
    host.innerHTML = '<h3 class="ev-h3">Verdict archive</h3>' +
      '<p class="ev-track-meta">Tracking starts 2026-10-16. Each session stores every symbol\u2019s verdict, score and Buy-side streak.</p>' +
      '<div class="ev-tablewrap"><table class="ev-table nd-table"><caption>Scored sessions in the archive</caption>' +
      '<thead><tr><th scope="col">Session</th><th scope="col" class="num">Scored</th><th scope="col" class="num">Buy-side</th>' +
      '<th scope="col" class="num">Hold</th><th scope="col" class="num">Exit-side</th><th scope="col" class="num">Insufficient</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------------- coverage + render all ---------------- */

  function renderAsof() {
    var asof = $('evAsof');
    if (!asof) return;
    asof.textContent = state.batchAsof
      ? 'Scores from the ' + state.batchAsof + ' session · ' + state.rows.length +
        (state.listed ? ' of ' + state.listed + ' listed securities scored' : ' securities scored') +
        ' · rebuilt daily after close'
      : 'Session date unavailable';
  }

  function renderAll() {
    renderAsof();
    renderStats();
    renderSectors();
    renderMoves();
    renderFilters();
    renderControls();
    renderTable();
    renderTracking();
    renderArchive();
  }

  function init() {
    var s = $('evSearch');
    if (s) s.addEventListener('input', function () { state.q = s.value.trim(); state.page = 1; renderTable(); });
    var secSel = $('evSector');
    if (secSel) secSel.addEventListener('change', function () {
      state.sector = secSel.value; state.page = 1;
      renderSectors(); renderTable();
      $('evTableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    var sortSel = $('evSort');
    if (sortSel) sortSel.addEventListener('change', function () {
      var parts = (sortSel.value || 's:desc').split(':');
      state.sortKey = parts[0]; state.sortDir = parts[1] === 'asc' ? 1 : -1;
      state.page = 1; renderTable();
    });
    var staleBtn = $('evStale');
    if (staleBtn) staleBtn.addEventListener('click', function () {
      state.staleOnly = !state.staleOnly; state.page = 1;
      staleBtn.setAttribute('aria-pressed', state.staleOnly ? 'true' : 'false');
      renderTable();
      $('evTableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    loadAll().then(function () {
      renderAll();
      rebaseline();
      renderFresh();
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(refreshTick, REFRESH_MS);
    }).catch(function () {
      var w = $('evTableWrap');
      if (w) w.innerHTML = '<div class="ev-empty">Could not load engine verdicts. Please reload.</div>';
      renderFresh();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
