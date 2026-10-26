/* Nepse Decode - printable report builder.
 * Assembles a report from real data only: the browser-local portfolio and
 * watchlist stores plus the daily batch (verdicts.json).
 * Sections are toggleable; empty stores render honest empty notes, never
 * placeholder numbers. Print via window.print() with a print stylesheet. */
(function () {
  'use strict';

  var VER_URL = '/nepse-chart/data/verdicts.json';
  var ARCH_URL = '/data/reports-archive.json';
  var PF_KEY = 'nl_portfolios_v1';
  var WL_KEY = 'nl_watchlist_v1';
  var PAGE_SIZE = 25;

  /* ---------- refresh + drill-down state ---------- */
  var state = { pastPage: 1 };
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
  // one page of a list (1-based page, PAGE_SIZE rows)
  function pageSlice(list, page) {
    var p = Math.max(1, page || 1);
    return list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { median: median, num: num, portfolioTotals: portfolioTotals, pageSlice: pageSlice };
    return;
  }

  /* ---------- page ---------- */
  var ver = null;

  var $ = function (id) { return document.getElementById(id); };
  var SECTIONS = ['rp-portfolio', 'rp-watchlist'];

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

  var BUILDERS = {
    'rp-portfolio': secPortfolio, 'rp-watchlist': secWatchlist
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
      '<div class="rp-dochead"><p class="rp-doc-title"><small>Nepse Decode</small>Portfolio and watchlist report</p>' +
      '<p class="rp-doc-date">Prepared ' + esc(todayStr()) + '</p></div>' + body +
      '<p class="rp-docfoot">Educational use only. Figures come from the Engine Verdict\'s daily batch and your browser-local data; nothing here is investment advice or a buy or sell recommendation.</p>';
    $('rp-printhead-date').textContent = todayStr();
    $('rp-result').hidden = false;
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
    return [ver && ver.asof, archKey(archive)].join('|');
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
      fetch(ARCH_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      if (!res[0]) { setStatusLine('failed'); scheduleRefresh(); return; }
      ver = res[0];
      var newArch = Array.isArray(res[1]) ? res[1] : archive;
      var changed = dataKey() !== before || archKey(newArch) !== archKey(archive);
      archive = newArch;
      if (changed) {
        build(); renderPast();
        if (window.NepseFresh) $('rp-asof').innerHTML = window.NepseFresh.badge(ver.asof);
        setStatusLine('updated');
      }
      else setStatusLine('unchanged');
      scheduleRefresh();
    }).catch(function () { setStatusLine('failed'); scheduleRefresh(); });
  }

  /* ---------- boot ---------- */
  Promise.all([
    fetch(VER_URL).then(function (r) { return r.ok ? r.json() : null; })
  ]).then(function (res) {
    ver = res[0];
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
