/* Nepse Decode - printable report builder.
 * Assembles a report from real data only: the browser-local portfolio and
 * watchlist stores plus the daily batch (verdicts.json, wave1.json).
 * Sections are toggleable; empty stores render honest empty notes, never
 * placeholder numbers. Print via window.print() with a print stylesheet. */
(function () {
  'use strict';

  var VER_URL = '/nepse-chart/data/verdicts.json';
  var WAVE_URL = '/nepse-chart/data/wave1.json';
  var ARCH_URL = '/data/reports-archive.json';
  var PF_KEY = 'nl_portfolios_v1';
  var WL_KEY = 'nl_watchlist_v1';
  var PAGE_SIZE = 25;

  /* ---------- refresh + drill-down state ---------- */
  var state = { sector: '', secPage: 1, pastPage: 1 };
  var archive = null, refreshTimer = null, printing = false;

  /* ---------- pure helpers (also exported for node tests) ---------- */
  function median(vals) {
    var a = vals.filter(function (v) { return typeof v === 'number' && isFinite(v); })
      .sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function num(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // portfolio totals from holdings [{s, qty, cost}] and a price map {sym: price}
  function portfolioTotals(holdings, prices) {
    var invested = 0, value = 0, missing = 0;
    holdings.forEach(function (h) {
      var q = Number(h.qty) || 0, c = Number(h.cost) || 0;
      if (q <= 0 || c < 0) return;
      invested += q * c;
      var p = prices[h.s];
      if (p == null || !isFinite(p)) { missing++; return; }
      value += q * p;
    });
    var un = value - invested;
    return { invested: invested, value: value, unrealized: un,
      ret: invested > 0 ? un / invested * 100 : null, missing: missing, n: holdings.length };
  }
  // sector breadth from verdicts map
  function sectorBreadth(verdicts) {
    var out = {};
    Object.keys(verdicts).forEach(function (k) {
      var r = verdicts[k];
      var sec = r.sec || 'Others';
      if (typeof r.ch !== 'number' || !isFinite(r.ch)) return;
      out[sec] = out[sec] || { up: 0, down: 0, flat: 0 };
      if (r.ch > 0) out[sec].up++;
      else if (r.ch < 0) out[sec].down++;
      else out[sec].flat++;
    });
    return out;
  }
  // one sector's rankable rows from the batch (finite score only,
  // matching the screener section's filter), ranked by score desc
  function sectorStocks(verdicts, sector) {
    return Object.keys(verdicts).map(function (k) {
      var r = verdicts[k];
      return { s: k, score: r.s, v: r.v, p: r.p, ch: r.ch, rsi: r.rsi, sec: r.sec || 'Others' };
    }).filter(function (r) { return r.sec === sector && typeof r.score === 'number' && isFinite(r.score); })
      .sort(function (a, b) { return b.score - a.score; });
  }
  // one page of a list (1-based page, PAGE_SIZE rows)
  function pageSlice(list, page) {
    var p = Math.max(1, page || 1);
    return list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { median: median, num: num, portfolioTotals: portfolioTotals, sectorBreadth: sectorBreadth, sectorStocks: sectorStocks, pageSlice: pageSlice };
    return;
  }

  /* ---------- page ---------- */
  var ver = null, wave = null, snap = null;

  // Wave 7: the shared snapshot data path (daily batch + live overlay).
  // Falls back to the batch alone when the live feed is unreachable.
  function loadSnap() {
    var NL = window.NepseLive || null;
    if (NL) return NL.loadSnapshot().catch(function () { return null; });
    return Promise.resolve(null);
  }
  var $ = function (id) { return document.getElementById(id); };
  var SECTIONS = ['rp-portfolio', 'rp-watchlist', 'rp-screener', 'rp-market', 'rp-sectors'];

  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return (d && typeof d === 'object') ? d : null;
    } catch (e) { return null; }
  }

  function todayStr() {
    var d = new Date();
    var M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
  }

  function secPortfolio() {
    var store = readStore(PF_KEY);
    var html = '<h2>Portfolio summary</h2>';
    if (!store || !store.portfolios || !store.portfolios.length) {
      return html + '<p class="rp-empty">No portfolios saved in this browser yet. <a href="/nepse-portfolio/">Create one on the portfolio page</a>, then rebuild this report.</p>';
    }
    var active = null, i;
    for (i = 0; i < store.portfolios.length; i++) {
      if (store.portfolios[i].id === store.active) { active = store.portfolios[i]; break; }
    }
    active = active || store.portfolios[0];
    var holdings = (active.holdings || []).filter(function (h) { return h && h.s && Number(h.qty) > 0; });
    if (!holdings.length) {
      return html + '<p class="rp-empty">Portfolio <b>' + esc(active.name) + '</b> has no holdings yet.</p>';
    }
    var prices = {};
    Object.keys(ver.verdicts).forEach(function (k) {
      var p = ver.verdicts[k].p;
      if (typeof p === 'number' && isFinite(p)) prices[k] = p;
    });
    var t = portfolioTotals(holdings, prices);
    var totalVal = 0;
    holdings.forEach(function (h) {
      var p = prices[h.s];
      if (p != null && isFinite(p)) totalVal += h.qty * p;
    });
    html += '<p class="rp-sub">Active portfolio: <b>' + esc(active.name) + '</b> · ' + holdings.length + ' holdings' +
      (t.missing ? ' · ' + t.missing + ' without a current price (excluded)' : '') + '</p>';
    html += '<div class="rp-stats">' +
      stat('Invested', 'Rs ' + num(t.invested, 2)) +
      stat('Current value', 'Rs ' + num(t.value, 2)) +
      stat('Unrealized P&L', 'Rs ' + num(t.unrealized, 2), t.unrealized >= 0 ? 'up' : 'down') +
      stat('Return', t.ret == null ? '—' : num(t.ret, 2) + '%', t.ret >= 0 ? 'up' : 'down') +
      '</div>';
    html += '<div class="rp-table-wrap"><table class="rp-table nd-table"><thead><tr><th>Symbol</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Share</th><th>P&L</th></tr></thead><tbody>' +
      holdings.map(function (h) {
        var p = prices[h.s];
        var val = p == null ? null : h.qty * p;
        var pl = val == null ? null : val - h.qty * h.cost;
        var share = val == null || !totalVal ? null : val / totalVal * 100;
        return '<tr><td><b>' + esc(h.s) + '</b></td><td>' + num(h.qty, 0) + '</td><td>' + num(h.cost, 2) + '</td>' +
          '<td>' + (p == null ? '—' : num(p, 2)) + '</td><td>' + (val == null ? '—' : num(val, 2)) + '</td>' +
          '<td class="rp-barcell">' + (share == null ? '—' :
            '<span class="cx-prop"><span class="cx-prop-track"><i class="cx-prop-fill" style="--w:' + share.toFixed(1) + '%"></i></span></span> ' +
            '<span class="rp-barval">' + share.toFixed(1) + '%</span>') + '</td>' +
          '<td class="' + (pl == null ? '' : pl >= 0 ? 'up' : 'down') + '">' + (pl == null ? '—' : num(pl, 2)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<p class="rp-note">Prices from the daily batch (' + esc(ver.asof) + '). Holdings without a current price are excluded from totals.</p>';
    return html;
  }
  function stat(k, v, cls) {
    return '<div class="rp-stat"><span class="rp-k">' + esc(k) + '</span><span class="rp-v ' + (cls || '') + '">' + v + '</span></div>';
  }

  function secWatchlist() {
    var list = readStore(WL_KEY);
    var html = '<h2>Watchlist</h2>';
    var syms = (list && list.symbols) || (Array.isArray(list) ? list : []);
    syms = syms.filter(function (s) { return typeof s === 'string'; });
    if (!syms.length) {
      return html + '<p class="rp-empty">Your watchlist is empty in this browser. <a href="/nepse-watchlist/">Add symbols on the watchlist page</a>, then rebuild this report.</p>';
    }
    html += '<div class="rp-table-wrap"><table class="rp-table nd-table"><thead><tr><th>Symbol</th><th>Price</th><th>Day change</th><th>Signal</th><th>RSI</th></tr></thead><tbody>' +
      syms.map(function (s) {
        var v = ver.verdicts[s];
        if (!v) return '<tr><td><b>' + esc(s) + '</b></td><td colspan="4">Not in the latest batch.</td></tr>';
        var chCls = v.ch == null ? '' : (v.ch >= 0 ? 'up' : 'down');
        return '<tr><td><b>' + esc(s) + '</b></td><td>' + num(v.p, 2) + '</td>' +
          '<td class="' + chCls + '">' + (v.ch == null ? '—' : num(v.ch, 2) + '%') + '</td>' +
          '<td>' + esc(v.v || '—') + '</td><td>' + num(v.rsi, 1) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  }

  function secScreener() {
    var rows = Object.keys(ver.verdicts).map(function (k) {
      var r = ver.verdicts[k];
      return { s: k, score: r.s, v: r.v, p: r.p, ch: r.ch };
    }).filter(function (r) { return typeof r.score === 'number' && isFinite(r.score); });
    rows.sort(function (a, b) { return b.score - a.score; });
    var maxAbs = 0;
    rows.forEach(function (r) { if (Math.abs(r.score) > maxAbs) maxAbs = Math.abs(r.score); });
    function scoreBar(score) {
      if (!maxAbs) return '—';
      var w = (Math.abs(score) / maxAbs * 100).toFixed(1);
      var col = score < 0 ? ' style="--w:' + w + '%;background:var(--nd-down)"' : ' style="--w:' + w + '%"';
      return '<span class="cx-prop"><span class="cx-prop-track"><i class="cx-prop-fill"' + col + '></i></span></span>';
    }
    function tbl(list, title) {
      return '<h3>' + title + '</h3><div class="rp-table-wrap"><table class="rp-table nd-table"><thead><tr><th>#</th><th>Symbol</th><th>Signal</th><th>Score</th><th>Score bar</th><th>Price</th><th>Day change</th></tr></thead><tbody>' +
        list.map(function (r, i) {
          var chCls = r.ch == null ? '' : (r.ch >= 0 ? 'up' : 'down');
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(r.s) + '</b></td><td>' + esc(r.v || '—') + '</td>' +
            '<td>' + num(r.score, 1) + '</td><td class="rp-barcell">' + scoreBar(r.score) + '</td><td>' + num(r.p, 2) + '</td>' +
            '<td class="' + chCls + '">' + (r.ch == null ? '—' : num(r.ch, 2) + '%') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<h2>Screener: strongest and weakest signals</h2>' +
      '<p class="rp-sub">Top and bottom 10 by engine score, latest batch (' + esc(ver.asof) + ').</p>' +
      tbl(rows.slice(0, 10), 'Strongest signals') + tbl(rows.slice(-10).reverse(), 'Weakest signals');
  }

  function secMarket() {
    var html = '<h2>Market snapshot</h2>';
    if (!snap || !snap.batch) return html + '<p class="rp-empty">Market summary data is unavailable right now.</p>';
    // Wave 7: the shared snapshot component, rendering the same figures the dashboard
    // shows, placed once here (reports are printable, not live-polled).
    return html + '<div id="rp-snapmount"></div>';
  }

  function mountSnap() {
    var mount = $('rp-snapmount');
    var Snap = window.NepseSnapshot, NL = window.NepseLive;
    if (!mount || !Snap || !snap) return;
    mount.innerHTML = Snap.statsHTML(snap, { spark: true });
    Snap.fillSpark(mount);
    var liveEl = mount.querySelector('[data-nlsnap-live]');
    if (liveEl && NL) liveEl.innerHTML = NL.badgeHTML(NL.statusOf(snap.live));
    var M = window.NepseMotion;
    if (M) M.watchCounts(mount);
  }

  function secSectors() {
    var b = sectorBreadth(ver.verdicts);
    var secs = Object.keys(b).sort();
    var html = '<h2>Sector breadth</h2>' +
      '<p class="rp-sub">Advancers vs decliners by sector, latest batch (' + esc(ver.asof) + '). ' +
      'Scope is the full batch: all 15 sectors, including Debentures, Mutual Funds and Promoter Shares — not ordinary equities only. ' +
      'Tap a sector row to see its stocks below.</p>' +
      '<div class="rp-table-wrap"><table class="rp-table nd-table"><thead><tr><th>Sector</th><th>Up</th><th>Down</th><th>Flat</th><th>Breadth</th></tr></thead><tbody>' +
      secs.map(function (s) {
        var t = b[s].up + b[s].down + b[s].flat;
        var wUp = t ? (b[s].up / t * 100).toFixed(1) : 0;
        var wFlat = t ? (b[s].flat / t * 100).toFixed(1) : 0;
        var wDown = t ? (b[s].down / t * 100).toFixed(1) : 0;
        var active = state.sector === s ? ' rp-sector-active' : '';
        return '<tr class="rp-sector-row' + active + '" tabindex="0" role="button" aria-pressed="' + (state.sector === s) + '" data-sector-row="' + esc(s) + '">' +
          '<td><b>' + esc(s) + '</b></td><td class="up">' + b[s].up + '</td><td class="down">' + b[s].down + '</td><td>' + b[s].flat + '</td>' +
          '<td class="rp-breadth"><span class="cx-breadth"><i class="b-up" style="width:' + wUp + '%"></i><i class="b-flat" style="width:' + wFlat + '%"></i><i class="b-down" style="width:' + wDown + '%"></i></span> ' +
          '<span class="rp-breadth-legend">' + b[s].up + '↑ · ' + b[s].down + '↓ · ' + b[s].flat + '—</span></td></tr>';
      }).join('') + '</tbody></table></div>';
    return html + renderSectorBlock();
  }

  function renderSectorBlock() {
    if (!state.sector) {
      return '<div class="rp-sector-block"><h3>Stocks in the selected sector</h3>' +
        '<p class="rp-sub">Tap a sector row above to see that sector\'s stocks here — ranked by engine score, with their signal, price, day change, RSI and score bar. The block follows the batch refresh.</p></div>';
    }
    var rows = sectorStocks(ver.verdicts, state.sector);
    var maxAbs = 0;
    rows.forEach(function (r) { if (typeof r.score === 'number' && isFinite(r.score) && Math.abs(r.score) > maxAbs) maxAbs = Math.abs(r.score); });
    var scores = rows.map(function (r) { return r.score; }).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var med = median(scores);
    var b = sectorBreadth(ver.verdicts)[state.sector] || { up: 0, down: 0, flat: 0 };
    var top = rows.length ? rows[0] : null;
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.secPage > pages) state.secPage = pages;
    var pageRows = pageSlice(rows, state.secPage);
    var lo = rows.length ? (state.secPage - 1) * PAGE_SIZE + 1 : 0;
    var hi = (state.secPage - 1) * PAGE_SIZE + pageRows.length;
    var html = '<div class="rp-sector-block"><h3>Stocks in ' + esc(state.sector) + '</h3>' +
      '<p class="rp-sub">Scope: the full batch for this sector (see the breadth note above). Ranked by engine score. ' +
      'The stock list counts every scored row; breadth counts only rows with a day change, so the two totals can differ by a row.</p>' +
      '<div class="rp-sector-summary">' +
      stat('Stocks scored', String(rows.length)) +
      stat('Advancers', String(b.up), 'up') +
      stat('Decliners', String(b.down), 'down') +
      stat('Median score', med == null ? '—' : num(med, 1)) +
      stat('Top signal', top ? esc(top.s) + ' · ' + esc(top.v || '—') : '—') +
      '</div>';
    if (!rows.length) {
      html += '<p class="rp-empty">No stocks in this sector in the latest batch.</p>';
    } else {
      html += '<div class="rp-table-wrap"><table class="rp-table nd-table"><thead><tr><th>Symbol</th><th>Price</th><th>Day change</th><th>Signal</th><th>Score</th><th>RSI</th><th>Score bar</th></tr></thead><tbody>' +
        pageRows.map(function (r) {
          var chCls = r.ch == null ? '' : (r.ch >= 0 ? 'up' : 'down');
          var w = maxAbs && typeof r.score === 'number' && isFinite(r.score) ? (Math.abs(r.score) / maxAbs * 100).toFixed(1) : 0;
          var col = r.score < 0 ? ' style="--w:' + w + '%;background:var(--nd-down)"' : ' style="--w:' + w + '%"';
          return '<tr><td><b>' + esc(r.s) + '</b></td><td>' + num(r.p, 2) + '</td>' +
            '<td class="' + chCls + '">' + (r.ch == null ? '—' : num(r.ch, 2) + '%') + '</td>' +
            '<td>' + esc(r.v || '—') + '</td><td>' + num(r.score, 1) + '</td><td>' + num(r.rsi, 1) + '</td>' +
            '<td class="rp-barcell"><span class="cx-prop"><span class="cx-prop-track"><i class="cx-prop-fill"' + col + '></i></span></span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<div class="rp-pager">' +
      '<button type="button" class="cx-btn quiet" data-sec-page="prev"' + (state.secPage <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<span class="rp-pager-txt">Showing ' + lo + '–' + hi + ' of ' + rows.length + ' stocks in ' + esc(state.sector) + ' · Page ' + state.secPage + ' of ' + pages + '</span>' +
      '<button type="button" class="cx-btn" data-sec-page="next"' + (state.secPage >= pages ? ' disabled' : '') + '>Next →</button>' +
      '<button type="button" class="cx-btn quiet" data-sec-clear>Show full report</button>' +
      '</div></div>';
    return html;
  }

  var BUILDERS = {
    'rp-portfolio': secPortfolio, 'rp-watchlist': secWatchlist, 'rp-screener': secScreener,
    'rp-market': secMarket, 'rp-sectors': secSectors
  };

  function syncSel() {
    var fill = $('rp-selbar-fill'), txt = $('rp-selbar-txt');
    if (!fill) return;
    var n = 0;
    SECTIONS.forEach(function (id) { var cb = $('cb-' + id); if (cb && cb.checked) n++; });
    fill.style.width = (SECTIONS.length ? (n / SECTIONS.length * 100) : 0) + '%';
    if (txt) txt.textContent = n + ' of ' + SECTIONS.length + ' sections in the report';
  }

  function build() {
    syncSel();
    var out = '';
    SECTIONS.forEach(function (id) {
      var cb = $('cb-' + id);
      if (cb && cb.checked) out += '<section class="rp-sec" id="sec-' + id + '">' + BUILDERS[id]() + '</section>';
    });
    var body = out || '<p class="rp-empty">Tick at least one section above, then rebuild.</p>';
    $('rp-report').innerHTML =
      '<div class="rp-dochead"><p class="rp-doc-title"><small>Nepse Decode</small>Market report</p>' +
      '<p class="rp-doc-date">Prepared ' + esc(todayStr()) + '</p></div>' + body +
      '<p class="rp-docfoot">Educational use only. Figures come from the Engine Verdict\'s daily batch and your browser-local data; nothing here is investment advice or a buy or sell recommendation.</p>';
    $('rp-printhead-date').textContent = todayStr();
    $('rp-result').hidden = false;
    mountSnap(); // Wave 7: paint the shared snapshot after the report is injected
  }

  /* ---------- past reports archive (on-screen only) ---------- */
  function loadArchive() {
    return fetch(ARCH_URL).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        archive = Array.isArray(d) ? d : null;
        renderPast();
        return archive;
      });
  }

  function renderPast() {
    var list = $('rp-past-list'), pager = $('rp-past-pager');
    if (!list) return;
    if (!archive || !archive.length) {
      list.innerHTML = '<p class="rp-empty">No past reports archived yet. The first archive lands after the next close, once the post-close archive run records the session.</p>';
      if (pager) pager.innerHTML = '';
      return;
    }
    var entries = archive.slice().sort(function (a, b) { return (b.session_date || '') < (a.session_date || '') ? -1 : 1; });
    var pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    if (state.pastPage > pages) state.pastPage = pages;
    var pageRows = pageSlice(entries, state.pastPage);
    var lo = (state.pastPage - 1) * PAGE_SIZE + 1;
    var hi = (state.pastPage - 1) * PAGE_SIZE + pageRows.length;
    list.innerHTML = pageRows.map(function (e) {
      var m = e.market || {};
      var b = e.breadth || {};
      var up = 0, down = 0, flat = 0;
      Object.keys(b).forEach(function (k) { up += b[k].up || 0; down += b[k].down || 0; flat += b[k].flat || 0; });
      var top = (e.screener_top10 && e.screener_top10[0]) || null;
      var s = e.summary || {};
      var callsLine;
      if (!s.calls_total) callsLine = 'No Buy-side calls recorded in this session\'s top 10.';
      else if (!s.calls_resolved) callsLine = 'Calls: ' + s.calls_total + ' recorded, 0 resolved yet — outcomes are pending until sessions land.';
      else callsLine = 'Calls: ' + s.calls_total + ' recorded · ' + s.calls_resolved + ' resolved (' + (s.calls_tp || 0) + ' target, ' + (s.calls_sl || 0) + ' stop, ' + (s.calls_expired || 0) + ' expired) · hit rate ' + (s.hit_rate == null ? '—' : (s.hit_rate * 100).toFixed(1) + '%') + ' · ' + (s.calls_open || 0) + ' still open.';
      function fwd(h) {
        var f = (e.forward || {})[h];
        if (!f || f.n == null || !f.n) return h + ': pending (no sessions landed yet)';
        return h + ': mean spread ' + (f.mean_spread >= 0 ? '+' : '') + (f.mean_spread * 100).toFixed(2) + 'pp · beat rate ' + (f.beat_rate * 100).toFixed(1) + '% (n=' + f.n + ')';
      }
      return '<article class="rp-past-entry"><h3>Session ' + esc(e.session_date || '—') + '</h3>' +
        '<p>Market: NEPSE ' + (m.index == null ? '—' : num(m.index, 2)) +
        (m.change == null ? '' : ' (' + (m.change >= 0 ? '+' : '') + num(m.change, 2) + ')') +
        ' · traded ' + (m.traded == null ? '—' : m.traded) +
        ' · breadth ' + up + '↑ / ' + down + '↓ / ' + flat + '—</p>' +
        '<p>Top signal: ' + (top ? '<b>' + esc(top.s) + '</b> · ' + esc(top.v || '—') + ' (score ' + num(top.score, 1) + ')' : '—') + '</p>' +
        '<p>' + callsLine + '</p>' +
        '<p>Forward vs the average stock — ' + fwd('h5') + ' · ' + fwd('h10') + ' · ' + fwd('h20') + '.</p></article>';
    }).join('');
    if (pager) {
      pager.innerHTML =
        '<button type="button" class="cx-btn quiet" data-past-page="prev"' + (state.pastPage <= 1 ? ' disabled' : '') + '>← Prev</button>' +
        '<span class="rp-pager-txt">Showing ' + lo + '–' + hi + ' of ' + entries.length + ' past reports · Page ' + state.pastPage + ' of ' + pages + '</span>' +
        '<button type="button" class="cx-btn" data-past-page="next"' + (state.pastPage >= pages ? ' disabled' : '') + '>Next →</button>';
    }
  }

  /* ---------- auto-refresh (market-aware, change-gated) ---------- */
  function hhmm(d) {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false }).format(d || new Date());
    } catch (e) { return ''; }
  }
  function refreshDelayMs() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
      var wd = '', hr = 0;
      parts.forEach(function (p) { if (p.type === 'weekday') wd = p.value; if (p.type === 'hour') hr = Number(p.value); });
      if (wd === 'Sat' || wd === 'Sun') return 2 * 60 * 60 * 1000;
      if (hr >= 11 && hr < 15) return 15 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }
  function archKey(a) {
    if (!a) return 'noarch';
    return a.length + '|' + (a.length ? a[a.length - 1].session_date : '');
  }
  function dataKey() {
    var liveAsof = snap && snap.live && snap.live.asof != null ? String(snap.live.asof) : 'nolive';
    return [ver && ver.asof, wave && wave.asof, snap && snap.batchAsof, liveAsof, archKey(archive)].join('|');
  }
  function setStatusLine(kind) {
    var el = $('rp-status');
    if (!el || !ver) return;
    var check = hhmm();
    if (kind === 'updated') el.textContent = 'Report updated · batch ' + ver.asof + ' · last refresh check ' + check + ' NPT';
    else if (kind === 'unchanged') el.textContent = 'No new batch · batch ' + ver.asof + ' · last refresh check ' + check + ' NPT';
    else if (kind === 'failed') el.textContent = 'Check failed — showing last loaded batch (' + ver.asof + ') · last check ' + check + ' NPT';
    else el.textContent = 'Batch ' + ver.asof + ' · last refresh check ' + check + ' NPT';
  }
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(checkForUpdate, refreshDelayMs());
  }
  function checkForUpdate() {
    if (printing || document.hidden) { scheduleRefresh(); return; }
    var before = dataKey();
    Promise.all([
      fetch(VER_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(WAVE_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      loadSnap(),
      fetch(ARCH_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      if (!res[0]) { setStatusLine('failed'); scheduleRefresh(); return; }
      ver = res[0]; wave = res[1];
      snap = res[2] || (res[1] ? {
        batch: res[1].market,
        batchAsof: res[1].asof || (res[1].market && res[1].market.date) || null,
        live: null
      } : snap);
      var newArch = Array.isArray(res[3]) ? res[3] : archive;
      var changed = dataKey() !== before || archKey(newArch) !== archKey(archive);
      archive = newArch;
      if (changed) { build(); renderPast(); setStatusLine('updated'); }
      else setStatusLine('unchanged');
      scheduleRefresh();
    }).catch(function () { setStatusLine('failed'); scheduleRefresh(); });
  }

  /* ---------- boot ---------- */
  Promise.all([
    fetch(VER_URL).then(function (r) { return r.ok ? r.json() : null; }),
    fetch(WAVE_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    loadSnap()
  ]).then(function (res) {
    ver = res[0]; wave = res[1];
    snap = res[2] || (res[1] ? {
      batch: res[1].market,
      batchAsof: res[1].asof || (res[1].market && res[1].market.date) || null,
      live: null
    } : null);
    if (!ver) {
      $('rp-status').textContent = 'Could not load the daily batch. Please reload the page.';
      return;
    }
    $('rp-build').disabled = false;
    if (window.NepseFresh) $('rp-asof').innerHTML = window.NepseFresh.badge(ver.asof);
    build();
    setStatusLine('loaded');
    loadArchive();
    scheduleRefresh();
  }).catch(function () {
    $('rp-status').textContent = 'Could not load the daily batch. Please reload the page.';
  });

  document.addEventListener('DOMContentLoaded', function () {
    $('rp-build').addEventListener('click', build);
    $('rp-print').addEventListener('click', function () { window.print(); });
    SECTIONS.forEach(function (id) {
      var cb = $('cb-' + id);
      if (cb) cb.addEventListener('change', build);
    });
    syncSel();
    /* Delegated clicks survive every build() re-render. */
    $('rp-report').addEventListener('click', function (ev) {
      var row = ev.target.closest ? ev.target.closest('[data-sector-row]') : null;
      if (row) {
        var sec = row.getAttribute('data-sector-row');
        state.sector = state.sector === sec ? '' : sec;
        state.secPage = 1;
        build();
        return;
      }
      var pg = ev.target.closest ? ev.target.closest('[data-sec-page]') : null;
      if (pg && !pg.disabled) {
        if (pg.getAttribute('data-sec-page') === 'prev' && state.secPage > 1) state.secPage--;
        if (pg.getAttribute('data-sec-page') === 'next') state.secPage++;
        build();
        return;
      }
      var clr = ev.target.closest ? ev.target.closest('[data-sec-clear]') : null;
      if (clr) { state.sector = ''; state.secPage = 1; build(); }
    });
    $('rp-report').addEventListener('keydown', function (ev) {
      var row = ev.target.closest ? ev.target.closest('[data-sector-row]') : null;
      if (row && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        state.sector = state.sector === row.getAttribute('data-sector-row') ? '' : row.getAttribute('data-sector-row');
        state.secPage = 1;
        build();
      }
    });
    var pastPager = $('rp-past-pager');
    if (pastPager) pastPager.addEventListener('click', function (ev) {
      var pg = ev.target.closest ? ev.target.closest('[data-past-page]') : null;
      if (pg && !pg.disabled) {
        if (pg.getAttribute('data-past-page') === 'prev' && state.pastPage > 1) state.pastPage--;
        if (pg.getAttribute('data-past-page') === 'next') state.pastPage++;
        renderPast();
      }
    });
    /* Never refresh while printing; re-check right after. */
    window.addEventListener('beforeprint', function () { printing = true; if (refreshTimer) clearTimeout(refreshTimer); });
    window.addEventListener('afterprint', function () { printing = false; checkForUpdate(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkForUpdate(); });
  });
})();
