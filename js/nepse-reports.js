/* NEPSE Alpha Lab - printable report builder.
 * Assembles a report from real data only: the browser-local portfolio and
 * watchlist stores plus the daily batch (verdicts.json, wave1.json).
 * Sections are toggleable; empty stores render honest empty notes, never
 * placeholder numbers. Print via window.print() with a print stylesheet. */
(function () {
  'use strict';

  var VER_URL = '/nepse-chart/data/verdicts.json';
  var WAVE_URL = '/nepse-chart/data/wave1.json';
  var PF_KEY = 'nl_portfolios_v1';
  var WL_KEY = 'nl_watchlist_v1';

  /* ---------- pure helpers (also exported for node tests) ---------- */
  function median(vals) {
    var a = vals.filter(function (v) { return typeof v === 'number' && isFinite(v); })
      .sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function num(v, d) {
    if (v == null || !isFinite(v)) return '–';
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { median: median, num: num, portfolioTotals: portfolioTotals, sectorBreadth: sectorBreadth };
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
    html += '<p class="rp-sub">Active portfolio: <b>' + esc(active.name) + '</b> · ' + holdings.length + ' holdings' +
      (t.missing ? ' · ' + t.missing + ' without a current price (excluded)' : '') + '</p>';
    html += '<div class="rp-stats">' +
      stat('Invested', 'Rs ' + num(t.invested, 2)) +
      stat('Current value', 'Rs ' + num(t.value, 2)) +
      stat('Unrealized P&L', 'Rs ' + num(t.unrealized, 2), t.unrealized >= 0 ? 'up' : 'down') +
      stat('Return', t.ret == null ? '–' : num(t.ret, 2) + '%', t.ret >= 0 ? 'up' : 'down') +
      '</div>';
    html += '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>Symbol</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>P&L</th></tr></thead><tbody>' +
      holdings.map(function (h) {
        var p = prices[h.s];
        var val = p == null ? null : h.qty * p;
        var pl = val == null ? null : val - h.qty * h.cost;
        return '<tr><td><b>' + esc(h.s) + '</b></td><td>' + num(h.qty, 0) + '</td><td>' + num(h.cost, 2) + '</td>' +
          '<td>' + (p == null ? '–' : num(p, 2)) + '</td><td>' + (val == null ? '–' : num(val, 2)) + '</td>' +
          '<td class="' + (pl == null ? '' : pl >= 0 ? 'up' : 'down') + '">' + (pl == null ? '–' : num(pl, 2)) + '</td></tr>';
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
    html += '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>Symbol</th><th>Price</th><th>Day change</th><th>Signal</th><th>RSI</th></tr></thead><tbody>' +
      syms.map(function (s) {
        var v = ver.verdicts[s];
        if (!v) return '<tr><td><b>' + esc(s) + '</b></td><td colspan="4">Not in the latest batch.</td></tr>';
        var chCls = v.ch == null ? '' : (v.ch >= 0 ? 'up' : 'down');
        return '<tr><td><b>' + esc(s) + '</b></td><td>' + num(v.p, 2) + '</td>' +
          '<td class="' + chCls + '">' + (v.ch == null ? '–' : num(v.ch, 2) + '%') + '</td>' +
          '<td>' + esc(v.v || '–') + '</td><td>' + num(v.rsi, 1) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  }

  function secScreener() {
    var rows = Object.keys(ver.verdicts).map(function (k) {
      var r = ver.verdicts[k];
      return { s: k, score: r.s, v: r.v, p: r.p, ch: r.ch };
    }).filter(function (r) { return typeof r.score === 'number' && isFinite(r.score); });
    rows.sort(function (a, b) { return b.score - a.score; });
    function tbl(list, title) {
      return '<h3>' + title + '</h3><div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>#</th><th>Symbol</th><th>Signal</th><th>Score</th><th>Price</th><th>Day change</th></tr></thead><tbody>' +
        list.map(function (r, i) {
          var chCls = r.ch == null ? '' : (r.ch >= 0 ? 'up' : 'down');
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(r.s) + '</b></td><td>' + esc(r.v || '–') + '</td>' +
            '<td>' + num(r.score, 1) + '</td><td>' + num(r.p, 2) + '</td>' +
            '<td class="' + chCls + '">' + (r.ch == null ? '–' : num(r.ch, 2) + '%') + '</td></tr>';
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
      '<p class="rp-sub">Advancers vs decliners by sector, latest batch (' + esc(ver.asof) + ').</p>' +
      '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>Sector</th><th>Up</th><th>Down</th><th>Flat</th></tr></thead><tbody>' +
      secs.map(function (s) {
        return '<tr><td>' + esc(s) + '</td><td class="up">' + b[s].up + '</td><td class="down">' + b[s].down + '</td><td>' + b[s].flat + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  }

  var BUILDERS = {
    'rp-portfolio': secPortfolio, 'rp-watchlist': secWatchlist, 'rp-screener': secScreener,
    'rp-market': secMarket, 'rp-sectors': secSectors
  };

  function build() {
    var out = '';
    SECTIONS.forEach(function (id) {
      var cb = $('cb-' + id);
      if (cb && cb.checked) out += '<section class="rp-sec" id="sec-' + id + '">' + BUILDERS[id]() + '</section>';
    });
    var body = out || '<p class="rp-empty">Tick at least one section above, then rebuild.</p>';
    $('rp-report').innerHTML =
      '<div class="rp-dochead"><p class="rp-doc-title"><small>Nepse Decode</small>Market report</p>' +
      '<p class="rp-doc-date">Prepared ' + esc(todayStr()) + '</p></div>' + body +
      '<p class="rp-docfoot">Educational use only. Figures come from the Alpha Lab engine\'s daily batch and your browser-local data; nothing here is investment advice or a buy or sell recommendation.</p>';
    $('rp-printhead-date').textContent = todayStr();
    $('rp-result').hidden = false;
    mountSnap(); // Wave 7: paint the shared snapshot after the report is injected
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
    $('rp-status').textContent = '';
    if (window.NepseFresh) $('rp-asof').innerHTML = window.NepseFresh.badge(ver.asof);
    build();
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
  });
})();
