/* nepse-ipo/ipo.js — IPO/FPO tracker rendering.
 * Fetches /data/ipo.json, renders category tabs, a dense sortable
 * table per tab, and a symbol search. All output is escaped.
 * Default sort: Closing Date descending. */
(function () {
  'use strict';

  var DATA_URL = '/data/ipo.json';

  var ORDER = ['ipo', 'local-ipo', 'foreign-ipo', 'mutual-ipo', 'fpo', 'right-share', 'auction'];

  var COL_LABELS = {
    symbol: 'Symbol', units: 'Units', ratio: 'Ratio',
    opening_date: 'Opening Date', closing_date: 'Closing Date',
    book_closure_date: 'Book Closure Date', listing_date: 'Listing Date',
    status: 'Status', issue_manager: 'Issue Manager',
    auction_units: 'Auction Units', total_alloted: 'Total Alloted',
    bid_opening_date: 'Bid Opening Date', closing_price: 'Closing Price',
    cut_off_price: 'Cut Off Price'
  };

  var NUMERIC_COLS = { units: 1, auction_units: 1, total_alloted: 1, closing_price: 1, cut_off_price: 1 };

  var state = { data: null, tab: 'ipo', q: '', sortKey: 'closing_date', sortDir: -1 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }

  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v + 'T00:00:00');
    if (isNaN(d)) return esc(v);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtNum(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString('en-US') : esc(v);
  }

  function cellHtml(col, row) {
    var v = row[col];
    if (col === 'symbol') return '<td class="sym">' + esc(v) + '</td>';
    if (col === 'status') {
      var open = String(v).toLowerCase() === 'open';
      return '<td><span class="ipo-status ' + (open ? 'open' : 'closed') + '">' + esc(v) + '</span></td>';
    }
    if (NUMERIC_COLS[col]) return '<td class="num">' + fmtNum(v) + '</td>';
    if (col.indexOf('_date') !== -1) return '<td class="dim">' + fmtDate(v) + '</td>';
    if (col === 'issue_manager') return '<td class="dim">' + (v ? esc(v) : '—') + '</td>';
    if (col === 'ratio') return '<td class="dim">' + (v ? esc(v) : '—') + '</td>';
    return '<td>' + esc(v) + '</td>';
  }

  function sortVal(col, v) {
    if (col.indexOf('_date') !== -1) return v ? String(v) : '';
    if (NUMERIC_COLS[col]) { var n = Number(v); return isFinite(n) ? n : -Infinity; }
    return String(v == null ? '' : v).toLowerCase();
  }

  function rowsFor() {
    var cat = state.data.categories[state.tab];
    var cols = cat.columns;
    var rows = (cat.items || []).slice();
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return String(r.symbol || '').toLowerCase().indexOf(q) !== -1; });
    }
    rows.sort(function (a, b) {
      var va = sortVal(state.sortKey, a[state.sortKey]);
      var vb = sortVal(state.sortKey, b[state.sortKey]);
      if (va < vb) return -1 * state.sortDir;
      if (va > vb) return 1 * state.sortDir;
      return 0;
    });
    return { cols: cols, rows: rows, label: cat.label };
  }

  function renderTabs() {
    var host = $('ipoTabs');
    if (!host || !state.data) return;
    host.innerHTML = ORDER.filter(function (k) { return state.data.categories[k]; }).map(function (k) {
      var c = state.data.categories[k];
      var n = (c.items || []).length;
      return '<button type="button" class="ipo-tab" role="tab" data-tab="' + esc(k) + '" aria-selected="' + (state.tab === k) + '">' +
        esc(c.label) + ' <span class="cnt">' + n + '</span></button>';
    }).join('');
    host.querySelectorAll('.ipo-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        state.sortKey = 'closing_date'; state.sortDir = -1;
        renderTabs(); renderTable();
      });
    });
  }

  function renderTable() {
    var host = $('ipoTableWrap');
    var cnt = $('ipoCount');
    if (!host || !state.data) return;
    var d = rowsFor();
    var th = d.cols.map(function (c) {
      var lab = COL_LABELS[c] || c;
      var active = state.sortKey === c;
      var arr = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
      return '<th scope="col" class="sortable' + (NUMERIC_COLS[c] ? ' num' : '') + '" data-col="' + esc(c) + '" title="Sort by ' + esc(lab) + '">' +
        esc(lab) + '<span class="arr">' + arr + '</span></th>';
    }).join('');
    var body = d.rows.length ? d.rows.map(function (r) {
      return '<tr>' + d.cols.map(function (c) { return cellHtml(c, r); }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + d.cols.length + '"><div class="ipo-empty">No ' + esc(d.label) + ' records match your search.</div></td></tr>';
    host.innerHTML = '<table class="ipo-table"><caption>' + esc(d.label) + ' — sorted by ' +
      esc(COL_LABELS[state.sortKey] || state.sortKey) + ' ' + (state.sortDir === 1 ? 'ascending' : 'descending') +
      '</caption><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
    host.querySelectorAll('th.sortable').forEach(function (h) {
      h.addEventListener('click', function () {
        var c = h.getAttribute('data-col');
        if (state.sortKey === c) state.sortDir *= -1;
        else { state.sortKey = c; state.sortDir = (c === 'symbol' ? 1 : -1); }
        renderTable();
      });
    });
    if (cnt) cnt.textContent = 'Showing ' + d.rows.length + ' of ' + (state.data.categories[state.tab].items || []).length + ' ' + d.label + ' records';
  }

  function renderOpenStrip() {
    var host = $('ipoOpen');
    if (!host || !state.data) return;
    var open = [];
    Object.keys(state.data.categories).forEach(function (k) {
      (state.data.categories[k].items || []).forEach(function (it) {
        if (String(it.status).toLowerCase() === 'open') open.push({ sym: it.symbol, label: state.data.categories[k].label, close: it.closing_date });
      });
    });
    if (!open.length) { host.innerHTML = ''; return; }
    host.innerHTML = open.map(function (o) {
      return '<span class="open-chip"><span class="dot"></span>' + esc(o.sym) + ' · ' + esc(o.label) +
        (o.close ? ' · closes ' + fmtDate(o.close) : '') + '</span>';
    }).join('');
  }

  function init() {
    var search = $('ipoSearch');
    if (search) search.addEventListener('input', function () { state.q = search.value.trim(); renderTable(); });
    fetch(DATA_URL, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        state.data = json;
        var asof = $('ipoAsof');
        if (asof && json.updated) asof.textContent = 'Data last updated ' + fmtDate(json.updated) + ' · verified against issue-manager notices';
        renderOpenStrip(); renderTabs(); renderTable();
      })
      .catch(function () {
        var host = $('ipoTableWrap');
        if (host) host.innerHTML = '<div class="ipo-empty">Could not load IPO data. Please reload the page.</div>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
