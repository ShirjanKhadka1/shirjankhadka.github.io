/* nepse-ipo/ipo.js — IPO/FPO tracker rendering (redesign 2026-10-04).
 * Fetches /data/ipo.json, renders category tabs, status filter,
 * paginated sortable table (50/page), stats row, and symbol search.
 * New/open issues surface first. All output is escaped. */
(function () {
  'use strict';

  var DATA_URL = '/data/ipo.json';
  var PER_PAGE = 50;

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

  var state = { data: null, sig: null, tab: 'ipo', q: '', sortKey: 'closing_date', sortDir: -1, page: 1, statusFilter: 'all' };

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
  function normStatus(v, row) {
    var s = String(v || '').toLowerCase().trim();
    // Status is date-driven against TODAY (Asia/Kathmandu), not the data's
    // updated date: a tab must move Upcoming -> Open on opening day and
    // Open -> Closed the day after close even if the data has not
    // republished. (2026-10-27: baked 'upcoming' rows never promoted, so
    // HPHL main + local would have sat on Upcoming past opening day.)
    var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
    if (row) {
      var od = row.opening_date ? String(row.opening_date) : '';
      var cd = row.closing_date ? String(row.closing_date) : '';
      if (cd && cd < today) return 'closed';
      if (od && od > today) return 'upcoming';
      if (od && od <= today) return 'open';
    }
    var openLike = s === 'open' || /-open$/.test(s);
    if (openLike) return 'open';
    if (s.indexOf('upcoming') !== -1 || s.indexOf('up coming') !== -1 || s === 'announced') return 'upcoming';
    return 'closed';
  }

  function cellHtml(col, row) {
    var v = row[col];
    if (col === 'symbol') {
      var src = row.source === 'SEBON'
        ? ' <span class="ipo-src" title="Verified from SEBON prospectus listing ' + esc(row.verified_date || '') + '">SEBON ✓</span>'
        : '';
      var co = row.company ? '<div class="ipo-co">' + esc(row.company) + '</div>' : '';
      var det = '';
      if (row.notes || row.source) {
        det = '<details class="ipo-det"><summary>Details</summary>';
        if (row.notes) det += '<div class="ipo-notes">' + esc(row.notes) + '</div>';
        if (row.source) {
          det += '<div class="ipo-det-src">Source: ';
          if (row.source_url) det += '<a href="' + esc(row.source_url) + '" target="_blank" rel="noopener">' + esc(row.source) + '</a>';
          else det += esc(row.source);
          if (row.verified_date) det += ' · verified ' + fmtDate(row.verified_date);
          det += '</div>';
        }
        det += '</details>';
      }
      return '<td class="sym">' + esc(v) + src + co + det + '</td>';
    }
    if (col === 'status') {
      var st = normStatus(v, row);
      var label = st === 'open' ? 'Open' : st === 'upcoming' ? 'Upcoming' : 'Closed';
      return '<td><span class="ipo-status ' + st + '">' + esc(label) + '</span></td>';
    }
    if (NUMERIC_COLS[col]) return '<td class="num">' + fmtNum(v) + '</td>';
    if (col.indexOf('_date') !== -1) return '<td class="dim">' + fmtDate(v) + '</td>';
    if (col === 'issue_manager') return '<td class="dim">' + (v ? esc(v) : '—') + '</td>';
    if (col === 'ratio') return '<td class="dim">' + (v ? esc(v) : '—') + '</td>';
    return '<td>' + esc(v == null ? '' : v) + '</td>';
  }

  function sortVal(col, v) {
    if (col.indexOf('_date') !== -1) return v ? String(v) : '';
    if (NUMERIC_COLS[col]) { var n = Number(v); return isFinite(n) ? n : -Infinity; }
    return String(v == null ? '' : v).toLowerCase();
  }

  // Open first, then upcoming, then by sort key (default: closing_date desc)
  function statusRank(r) {
    var s = normStatus(r.status, r);
    return s === 'open' ? 0 : s === 'upcoming' ? 1 : 2;
  }

  function rowsFor() {
    var cat = state.data.categories[state.tab];
    var cols = cat.columns;
    var rows = (cat.items || []).slice();
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.symbol || '').toLowerCase().indexOf(q) !== -1 ||
          String(r.company || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (state.statusFilter !== 'all') {
      rows = rows.filter(function (r) { return normStatus(r.status, r) === state.statusFilter; });
    }
    var defaultSort = (state.sortKey === 'closing_date' && state.sortDir === -1);
    rows.sort(function (a, b) {
      if (defaultSort) {
        var ra = statusRank(a), rb = statusRank(b);
        if (ra !== rb) return ra - rb;
      }
      var va = sortVal(state.sortKey, a[state.sortKey]);
      var vb = sortVal(state.sortKey, b[state.sortKey]);
      if (va < vb) return -1 * state.sortDir;
      if (va > vb) return 1 * state.sortDir;
      return 0;
    });
    return { cols: cols, rows: rows, label: cat.label, total: (cat.items || []).length };
  }

  function renderStats() {
    var host = $('ipoStats');
    if (!host || !state.data) return;
    var cats = state.data.categories;
    var total = 0, open = 0, upcoming = 0;
    Object.keys(cats).forEach(function (k) {
      (cats[k].items || []).forEach(function (it) {
        total++;
        var s = normStatus(it.status, it);
        if (s === 'open') open++;
        else if (s === 'upcoming') upcoming++;
      });
    });
    host.innerHTML =
      '<div class="ipo-stat"><div class="num">' + total + '</div><div class="lbl">Total issues</div></div>' +
      '<div class="ipo-stat open"><div class="num">' + open + '</div><div class="lbl">Open now</div></div>' +
      '<div class="ipo-stat"><div class="num">' + upcoming + '</div><div class="lbl">Upcoming</div></div>' +
      '<div class="ipo-stat"><div class="num">' + Object.keys(cats).length + '</div><div class="lbl">Categories</div></div>' +
      (function () {
        var rest = total - open - upcoming;
        var seg = [['dopen','Open now',open],['dup','Upcoming',upcoming],['drest','Closed / other',rest]];
        var track = '', legend = '';
        seg.forEach(function (s) {
          if (!s[2] || !total) return;
          track += '<i class="' + s[0] + '" style="width:' + (s[2] / total * 100).toFixed(2) + '%"></i>';
          legend += '<span><b class="' + s[0] + '"></b>' + s[1] + ' ' + s[2] + '</span>';
        });
        return '<div class="ipo-dist" role="img" aria-label="Issue status mix across ' + total + ' tracked issues"><div class="ipo-dist-track">' + track + '</div><div class="ipo-dist-legend">' + legend + '</div></div>';
      })();
  }

  function renderTabs() {
    var host = $('ipoTabs');
    if (!host || !state.data) return;
    host.innerHTML = ORDER.filter(function (k) { return state.data.categories[k]; }).map(function (k) {
      var c = state.data.categories[k];
      var n = (c.items || []).length;
      return '<button type="button" class="ipo-tab" role="tab" data-tab="' + esc(k) + '" aria-selected="' + (state.tab === k) + '">' +
        '<span>' + esc(c.label) + ' <span class="cnt">' + n + '</span></span></button>';
    }).join('');
    host.querySelectorAll('.ipo-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        state.sortKey = 'closing_date'; state.sortDir = -1; state.page = 1;
        renderTabs(); renderTable();
      });
    });
  }

  function renderStatusFilter() {
    var host = $('ipoStatusFilter');
    if (!host) return;
    var opts = [['all', 'All'], ['open', 'Open'], ['upcoming', 'Upcoming'], ['closed', 'Closed']];
    host.innerHTML = opts.map(function (o) {
      return '<button type="button" class="ipo-sf" data-sf="' + o[0] + '" aria-pressed="' + (state.statusFilter === o[0]) + '">' + o[1] + '</button>';
    }).join('');
    host.querySelectorAll('.ipo-sf').forEach(function (b) {
      b.addEventListener('click', function () {
        state.statusFilter = b.getAttribute('data-sf');
        state.page = 1;
        renderStatusFilter(); renderTable();
      });
    });
  }

  function renderTable() {
    var host = $('ipoTableWrap');
    var cnt = $('ipoCount');
    var pager = $('ipoPager');
    if (!host || !state.data) return;
    var d = rowsFor();
    var totalPages = Math.max(1, Math.ceil(d.rows.length / PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PER_PAGE;
    var pageRows = d.rows.slice(start, start + PER_PAGE);

    var th = d.cols.map(function (c) {
      var lab = COL_LABELS[c] || c;
      var active = state.sortKey === c;
      var arr = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
      return '<th scope="col" class="sortable' + (NUMERIC_COLS[c] ? ' num' : '') + '" data-col="' + esc(c) + '" title="Sort by ' + esc(lab) + '">' +
        esc(lab) + '<span class="arr">' + arr + '</span></th>';
    }).join('');
    var body = pageRows.length ? pageRows.map(function (r) {
      return '<tr>' + d.cols.map(function (c) { return cellHtml(c, r); }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + d.cols.length + '"><div class="ipo-empty">No ' + esc(d.label) + ' records match your filters.</div></td></tr>';
    host.innerHTML = '<table class="ipo-table nd-table"><caption>' + esc(d.label) + ' — sorted by ' +
      esc(COL_LABELS[state.sortKey] || state.sortKey) + ' ' + (state.sortDir === 1 ? 'ascending' : 'descending') +
      '</caption><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
    host.querySelectorAll('th.sortable').forEach(function (h) {
      h.addEventListener('click', function () {
        var c = h.getAttribute('data-col');
        if (state.sortKey === c) state.sortDir *= -1;
        else { state.sortKey = c; state.sortDir = (c === 'symbol' ? 1 : -1); }
        state.page = 1;
        renderTable();
      });
    });
    if (cnt) {
      var from = d.rows.length ? start + 1 : 0;
      var to = Math.min(start + PER_PAGE, d.rows.length);
      cnt.textContent = d.rows.length ? ('Showing ' + from + '–' + to + ' of ' + d.rows.length + ' ' + d.label + ' records') : ('No ' + d.label + ' records');
    }
    renderPager(pager, totalPages, d.rows.length);
  }

  function renderPager(host, totalPages, totalRows) {
    if (!host) return;
    if (totalPages <= 1) { host.innerHTML = ''; return; }
    var h = '<button type="button" class="ipo-pagebtn ipo-pagebtn-prev" data-pg="prev"' + (state.page <= 1 ? ' disabled' : '') + ' aria-label="Previous page">←</button>';
    var win = 2, lo = Math.max(1, state.page - win), hi = Math.min(totalPages, state.page + win);
    if (lo > 1) h += '<button type="button" class="ipo-pagebtn" data-pg="1">1</button>' + (lo > 2 ? '<span class="ipo-pageinfo">…</span>' : '');
    for (var p = lo; p <= hi; p++) {
      h += '<button type="button" class="ipo-pagebtn" data-pg="' + p + '"' + (p === state.page ? ' aria-current="true"' : '') + '>' + p + '</button>';
    }
    if (hi < totalPages) h += (hi < totalPages - 1 ? '<span class="ipo-pageinfo">…</span>' : '') + '<button type="button" class="ipo-pagebtn" data-pg="' + totalPages + '">' + totalPages + '</button>';
    h += '<button type="button" class="ipo-pagebtn ipo-pagebtn-next" data-pg="next"' + (state.page >= totalPages ? ' disabled' : '') + ' aria-label="Next page">→</button>';
    h += '<span class="ipo-pageinfo">Page ' + state.page + ' of ' + totalPages + '</span>';
    host.innerHTML = h;
    host.querySelectorAll('.ipo-pagebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var v = b.getAttribute('data-pg');
        if (v === 'prev') state.page = Math.max(1, state.page - 1);
        else if (v === 'next') state.page = Math.min(totalPages, state.page + 1);
        else state.page = parseInt(v, 10) || 1;
        renderTable();
        var wrap = $('ipoTableWrap');
        if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderOpenStrip() {
    var host = $('ipoOpen');
    if (!host || !state.data) return;
    var open = [];
    Object.keys(state.data.categories).forEach(function (k) {
      (state.data.categories[k].items || []).forEach(function (it) {
        if (normStatus(it.status, it) === 'open') open.push({ sym: it.symbol, label: state.data.categories[k].label, close: it.closing_date });
      });
    });
    // Soonest closing first
    open.sort(function (a, b) { return String(a.close || '9999') < String(b.close || '9999') ? -1 : 1; });
    if (!open.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = '';
    host.innerHTML = open.map(function (o) {
      return '<span class="open-chip"><span class="dot"></span>' + esc(o.sym) + ' · ' + esc(o.label) +
        (o.close ? ' · closes ' + fmtDate(o.close) : '') + '</span>';
    }).join('');
  }

  // 60s change-gated refresh. The payload is static (no intraday feed),
  // so the gate is a hash of the payload bytes: unchanged bytes advance
  // only the freshness clock; changed bytes re-render everything. The
  // freshness line always states the payload's own updated date — the
  // page never pretends the static tracker is live. View state lives
  // in `state` and is never touched by the tick, so a tab/filter/
  // search/sort/page selection survives every tick; the signature is
  // over data bytes only, so view changes can neither fake a data
  // change nor swallow a real one.
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }
  function nptHM(d) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
  }
  function renderFreshline(ok) {
    var asof = $('ipoAsof');
    if (!asof || !state.data) return;
    var now = new Date();
    var next = new Date(now.getTime() + 60000);
    var txt = 'Data last updated ' + fmtDate(state.data.updated) + ' · verified against issue-manager notices · checked ' + nptHM(now) + ' · next check ' + nptHM(next) + ' · re-checks every 60s';
    if (!ok) txt += ' · last check failed, showing last good data';
    asof.textContent = txt;
  }
  function loadData() {
    fetch(DATA_URL, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        var sig = fnv1a(text);
        if (sig === state.sig) { renderFreshline(true); return; }
        state.data = JSON.parse(text);
        state.sig = sig;
        renderFreshline(true);
        renderStats(); renderOpenStrip(); renderTabs(); renderStatusFilter(); renderTable();
      })
      .catch(function () {
        if (state.data) { renderFreshline(false); return; }
        var host = $('ipoTableWrap');
        if (host) host.innerHTML = '<div class="ipo-empty">Could not load IPO data. Please reload the page.</div>';
      });
  }

  function init() {
    var search = $('ipoSearch');
    if (search) search.addEventListener('input', function () { state.q = search.value.trim(); state.page = 1; renderTable(); });
    loadData();
    setInterval(loadData, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
