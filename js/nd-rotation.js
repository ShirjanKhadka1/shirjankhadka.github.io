/* Sector Rotation page (RRG) — cinematic rebuild 2026-10-26.
   Renders /data/sector-rotation.json + /data/sector-rotation-forward.json.
   Dots only on the quadrant chart (no trails); dots, table rows and
   sector pills all select the sector shown in the stocks panel.
   Auto-refreshes on a market-aware schedule; selections survive refresh. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
  }
  function fmt(n, d) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d });
  }
  function signed(n, d) {
    if (n == null || isNaN(n)) return '—';
    return (n > 0 ? '+' : '') + fmt(n, d);
  }

  var SHORT = {
    'Banking': 'Banking', 'Development Bank': 'Dev Bank', 'Finance': 'Finance',
    'Hotels And Tourism': 'Hotels', 'Hydropower': 'Hydropower', 'Investment': 'Investment',
    'Life Insurance': 'Life Ins.', 'Manufacturing And Processing': 'Manuf.',
    'Microfinance': 'Microfinance', 'Non Life Insurance': 'Non-Life', 'Others': 'Others'
  };
  var QUADS = ['Leading', 'Improving', 'Weakening', 'Lagging'];
  var PAGE = 25;

  var state = {
    board: null, fwd: null,
    rows: [], sortKey: 'rotation_rank', sortDir: 1, quad: 'All',
    sector: null, stockSort: 'rs20', stockPage: 1,
    fwdFilter: 'All', fwdPage: 1
  };

  function statCard(k, v, s) {
    return '<div class="cx-stat"><div class="cx-stat-l">' + esc(k) + '</div><div class="cx-stat-v">' + esc(v) + '</div><div class="cx-stat-s">' + esc(s) + '</div></div>';
  }

  /* ------------- Sector Rotation Quadrant (inline SVG, dots only) ------------- */

  function buildQuadrantChart(rows) {
    var W = 680, H = 560, ML = 48, MR = 16, MT = 16, MB = 42;
    var pw = W - ML - MR, ph = H - MT - MB;
    var hx = [0], hy = [0];
    rows.forEach(function (r) { hx.push(r.rs_ratio); hy.push(r.rs_momentum); });
    function headExtent(v, minSpan) {
      var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
      var pad = Math.max((hi - lo) * 0.22, 1.1);
      lo -= pad; hi += pad;
      if (hi - lo < minSpan) { var c = (lo + hi) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
      return [Math.floor(lo * 2) / 2, Math.ceil(hi * 2) / 2];
    }
    var xe = headExtent(hx, 8), ye = headExtent(hy, 4);
    function X(v) { return ML + (v - xe[0]) / (xe[1] - xe[0]) * pw; }
    function Y(v) { return MT + ph - (v - ye[0]) / (ye[1] - ye[0]) * ph; }
    var x0 = X(0), y0 = Y(0);
    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sector Rotation Quadrant: NEPSE sectors by 20-day relative strength, 5-day smoothed, and its 5-day change" class="rr-svg">';
    s += '<defs><clipPath id="rrClip"><rect x="' + ML + '" y="' + MT + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>';
    s += '<rect x="' + ML + '" y="' + MT + '" width="' + (x0 - ML) + '" height="' + (y0 - MT) + '" class="rr-zone improving"/>';
    s += '<rect x="' + x0 + '" y="' + MT + '" width="' + (ML + pw - x0) + '" height="' + (y0 - MT) + '" class="rr-zone leading"/>';
    s += '<rect x="' + ML + '" y="' + y0 + '" width="' + (x0 - ML) + '" height="' + (MT + ph - y0) + '" class="rr-zone lagging"/>';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + (ML + pw - x0) + '" height="' + (MT + ph - y0) + '" class="rr-zone weakening"/>';
    function ticks(e, isX) {
      var span = e[1] - e[0];
      var step = span > 16 ? 4 : span > 8 ? 2 : 1;
      var out = '';
      for (var v = Math.ceil(e[0] / step) * step; v <= e[1]; v += step) {
        if (isX) out += '<line x1="' + X(v) + '" y1="' + MT + '" x2="' + X(v) + '" y2="' + (MT + ph) + '" class="rr-grid"/><text x="' + X(v) + '" y="' + (MT + ph + 16) + '" class="rr-tick" text-anchor="middle">' + v + '</text>';
        else out += '<line x1="' + ML + '" y1="' + Y(v) + '" x2="' + (ML + pw) + '" y2="' + Y(v) + '" class="rr-grid"/><text x="' + (ML - 6) + '" y="' + (Y(v) + 3) + '" class="rr-tick" text-anchor="end">' + v + '</text>';
      }
      return out;
    }
    s += ticks(xe, true) + ticks(ye, false);
    s += '<line x1="' + x0 + '" y1="' + MT + '" x2="' + x0 + '" y2="' + (MT + ph) + '" class="rr-axis100"/>';
    s += '<line x1="' + ML + '" y1="' + y0 + '" x2="' + (ML + pw) + '" y2="' + y0 + '" class="rr-axis100"/>';
    s += '<text x="' + (ML + pw - 8) + '" y="' + (MT + 18) + '" class="rr-qlabel q-leading" text-anchor="end">LEADING</text>';
    s += '<text x="' + (ML + 8) + '" y="' + (MT + 18) + '" class="rr-qlabel q-improving">IMPROVING</text>';
    s += '<text x="' + (ML + pw - 8) + '" y="' + (MT + ph - 8) + '" class="rr-qlabel q-weakening" text-anchor="end">WEAKENING</text>';
    s += '<text x="' + (ML + 8) + '" y="' + (MT + ph - 8) + '" class="rr-qlabel q-lagging">LAGGING</text>';
    s += '<text x="' + (ML + pw / 2) + '" y="' + (H - 4) + '" class="rr-axtitle" text-anchor="middle">Relative strength, 20-day (%) →</text>';
    s += '<text x="14" y="' + (MT + ph / 2) + '" class="rr-axtitle" text-anchor="middle" transform="rotate(-90 14 ' + (MT + ph / 2) + ')">5-day change (pts) →</text>';
    var placed = [];
    var items = rows.map(function (r) {
      var ex = X(r.rs_ratio), ey = Y(r.rs_momentum);
      var label = SHORT[r.sector] || r.sector;
      var near = 0;
      rows.forEach(function (o) {
        if (o === r) return;
        var dx = X(o.rs_ratio) - ex, dy = Y(o.rs_momentum) - ey;
        if (dx * dx + dy * dy < 55 * 55) near++;
      });
      return { r: r, ex: ex, ey: ey, label: label, w: label.length * 6.9 + 8, h: 15, near: near };
    });
    items.sort(function (a, b) { return b.near - a.near; });
    function overlap(a, b) {
      var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return (ox > 0 && oy > 0) ? ox * oy : 0;
    }
    items.forEach(function (it) {
      var cands = [
        { x: it.ex + 10, y: it.ey - it.h / 2 },
        { x: it.ex - 10 - it.w, y: it.ey - it.h / 2 },
        { x: it.ex + 7, y: it.ey - 13 - it.h },
        { x: it.ex + 7, y: it.ey + 13 },
        { x: it.ex - 7 - it.w, y: it.ey - 13 - it.h },
        { x: it.ex - 7 - it.w, y: it.ey + 13 },
        { x: it.ex - it.w / 2, y: it.ey - 14 - it.h },
        { x: it.ex - it.w / 2, y: it.ey + 14 }
      ];
      var best = null, bestScore = Infinity;
      cands.forEach(function (cd, ci) {
        var box = { x: cd.x, y: cd.y, w: it.w, h: it.h };
        var score = ci * 0.01;
        placed.forEach(function (pb) { score += overlap(box, pb) * 10; });
        if (box.x < ML + 2 || box.x + box.w > ML + pw - 2 || box.y < MT + 2 || box.y + box.h > MT + ph - 2) score += 5000;
        var dcx = box.x + box.w / 2 - it.ex, dcy = box.y + box.h / 2 - it.ey;
        score += Math.sqrt(dcx * dcx + dcy * dcy) * 0.02;
        if (score < bestScore) { bestScore = score; best = box; }
      });
      it.box = best;
      placed.push(best);
    });
    items.forEach(function (it) {
      var r = it.r;
      var bcx = it.box.x + it.box.w / 2, bcy = it.box.y + it.box.h / 2;
      var dx = bcx - it.ex, dy = bcy - it.ey;
      var sel = (state.sector === r.sector) ? ' rr-selected' : '';
      s += '<g class="rr-dotg' + sel + '" data-sector="' + esc(r.sector) + '" tabindex="0" role="button" aria-label="' + esc(r.sector) + ' — ' + esc(r.quadrant) + ', see its stocks"><title>' + esc(r.sector) + ' — ' + esc(r.quadrant) + ' · 20-day relative strength ' + fmt(r.rs_ratio) + '% (5-day smoothed) · 5-day change ' + fmt(r.rs_momentum) + ' pts · click to see its stocks</title>';
      if (Math.sqrt(dx * dx + dy * dy) > 17) {
        s += '<line x1="' + it.ex + '" y1="' + it.ey + '" x2="' + bcx + '" y2="' + bcy + '" class="rr-leader"/>';
      }
      s += '<circle cx="' + it.ex + '" cy="' + it.ey + '" r="7" class="rr-qdot ' + esc(r.quadrant) + '"/>' +
        '<text x="' + bcx + '" y="' + (bcy + 4) + '" class="rr-ptlabel" text-anchor="middle">' + esc(it.label) + '</text></g>';
    });
    s += '</svg>';
    return s;
  }

  /* ---------------- posture table ---------------- */

  function filteredRows() {
    var rows = state.rows;
    if (state.quad !== 'All') rows = rows.filter(function (r) { return r.quadrant === state.quad; });
    return rows;
  }

  function renderTable() {
    var k = state.sortKey, dir = state.sortDir;
    var rows = filteredRows().slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
    var h = '';
    rows.forEach(function (r) {
      var fs = r.flow_shift_pp, rc = r.rank_change_1w;
      var sel = (state.sector === r.sector) ? ' rr-selected' : '';
      h += '<tr class="rr-clickable' + sel + '" data-sector="' + esc(r.sector) + '" tabindex="0" role="button" aria-label="' + esc(r.sector) + ', see its stocks">' +
        '<td class="num">' + (r.rotation_rank == null ? '—' : r.rotation_rank) + '</td>' +
        '<td><strong>' + esc(r.sector) + '</strong></td>' +
        '<td><span class="rr-chip ' + esc(r.quadrant) + '">' + esc(r.quadrant) + '</span>' +
          (r.quadrant_changed ? ' <span class="rr-moved" title="Quadrant changed from the previous week">moved</span>' : '') + '</td>' +
        '<td class="num"><strong>' + fmt(r.rs_ratio) + '</strong></td>' +
        '<td class="num">' + fmt(r.rs_momentum) + '</td>' +
        '<td class="num">' + r.quadrant_weeks + '</td>' +
        '<td class="num rr-hide-m">' + fmt(r.consistency, 1) + '</td>' +
        '<td class="num">' + fmt(r.turnover_share_pct) + '%</td>' +
        '<td class="num rr-hide-m ' + (fs > 0 ? 'rr-pos' : fs < 0 ? 'rr-neg' : '') + '">' + (fs == null ? '—' : signed(fs)) + '</td>' +
        '<td class="num rr-hide-s ' + (rc > 0 ? 'rr-pos' : rc < 0 ? 'rr-neg' : '') + '">' + (rc == null ? '—' : (rc > 0 ? '▲ ' + rc : rc < 0 ? '▼ ' + Math.abs(rc) : '— 0')) + '</td>' +
        '</tr>';
    });
    $('rrBody').innerHTML = h || '<tr><td colspan="10" class="rr-loading">No sectors in this view.</td></tr>';
    bindRowClicks();
  }

  function bindRowClicks() {
    document.querySelectorAll('#rrBody tr[data-sector]').forEach(function (tr) {
      function go() { selectSector(tr.getAttribute('data-sector'), true); }
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  /* ---------------- money-flow bars ---------------- */

  function renderFlow() {
    var rows = state.rows.slice();
    var share = rows.filter(function (r) { return r.turnover_share_pct != null; })
      .sort(function (a, b) { return b.turnover_share_pct - a.turnover_share_pct; });
    var maxShare = share.length ? share[0].turnover_share_pct : 0;
    $('rrFlowShare').innerHTML = share.map(function (r) {
      var w = maxShare ? (r.turnover_share_pct / maxShare * 100) : 0;
      return '<div class="rr-bar"><span class="rr-bar-label">' + esc(r.sector) + '</span>' +
        '<span class="rr-bar-val">' + fmt(r.turnover_share_pct) + '%</span>' +
        '<span class="rr-bar-track"><i class="rr-bar-fill q-' + esc(r.quadrant) + '" style="width:' + w.toFixed(1) + '%"></i></span></div>';
    }).join('') || '<p class="rr-loading">No turnover data.</p>';
    var flow = rows.filter(function (r) { return r.flow_shift_pp != null; })
      .sort(function (a, b) { return b.flow_shift_pp - a.flow_shift_pp; });
    var maxAbs = flow.length ? Math.max.apply(null, flow.map(function (r) { return Math.abs(r.flow_shift_pp); })) : 0;
    $('rrFlowShift').innerHTML = flow.map(function (r) {
      var w = maxAbs ? (Math.abs(r.flow_shift_pp) / maxAbs * 50) : 0;
      var cls = r.flow_shift_pp >= 0 ? 'divpos' : 'divneg';
      var side = r.flow_shift_pp >= 0 ? 'left:50%;width:' : 'right:50%;width:';
      return '<div class="rr-bar"><span class="rr-bar-label">' + esc(r.sector) + '</span>' +
        '<span class="rr-bar-val ' + (r.flow_shift_pp > 0 ? 'rr-pos' : r.flow_shift_pp < 0 ? 'rr-neg' : '') + '">' + signed(r.flow_shift_pp) + '</span>' +
        '<span class="rr-bar-track"><i class="rr-bar-zero"></i><i class="rr-bar-fill ' + cls + '" style="' + side + w.toFixed(1) + '%"></i></span></div>';
    }).join('') || '<p class="rr-loading">No flow data.</p>';
  }

  /* ---------------- stocks panel ---------------- */

  function selectSector(name, scroll) {
    if (!name || !state.board) return;
    var stocks = state.board.stocks || {};
    if (!stocks[name]) return;
    state.sector = name;
    state.stockPage = 1;
    syncUrl();
    renderSectorPills();
    renderStocks();
    renderTable();
    renderChartSelection();
    if (scroll) {
      var el = document.querySelector('.rr-stocks');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderChartSelection() {
    document.querySelectorAll('#rrChart .rr-dotg').forEach(function (g) {
      g.classList.toggle('rr-selected', g.getAttribute('data-sector') === state.sector);
    });
  }

  function renderSectorPills() {
    var stocks = (state.board && state.board.stocks) || {};
    var names = Object.keys(stocks);
    $('rrSectorPills').innerHTML = names.map(function (n) {
      return '<button type="button" data-sector="' + esc(n) + '" aria-pressed="' + (state.sector === n) + '">' + esc(SHORT[n] || n) + '</button>';
    }).join('');
    document.querySelectorAll('#rrSectorPills button').forEach(function (b) {
      b.addEventListener('click', function () { selectSector(b.getAttribute('data-sector'), false); });
    });
  }

  function sortedStocks() {
    var rows = ((state.board && state.board.stocks) || {})[state.sector] || [];
    var k = state.stockSort;
    return rows.slice().sort(function (a, b) {
      if (k === 'symbol') return a.symbol.localeCompare(b.symbol);
      var x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }

  function renderStocks() {
    if (!state.board.stocks || !Object.keys(state.board.stocks).length) {
      $('rrStockMeta').textContent = '—';
      $('rrStockCount').textContent = '';
      $('rrStockBody').innerHTML = '<tr><td colspan="4" class="rr-loading">Stock lists arrive with the next data publish.</td></tr>';
      $('rrStockPage').textContent = '';
      return;
    }
    var all = sortedStocks();
    var total = all.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.stockPage > pages) state.stockPage = pages;
    var from = (state.stockPage - 1) * PAGE;
    var page = all.slice(from, from + PAGE);
    var withData = all.filter(function (r) { return r.rs20 != null; }).length;
    var row = state.rows.filter(function (r) { return r.sector === state.sector; })[0];
    $('rrStockMeta').textContent = (state.sector || '—') + ' · ' + total + ' stocks' +
      (row ? ' · sector rank ' + row.rotation_rank + ' · ' + row.quadrant : '');
    $('rrStockCount').textContent = total
      ? 'Showing ' + (from + 1) + '–' + Math.min(from + PAGE, total) + ' of ' + total + ' · ' + withData + ' with 20-day data'
      : '';
    $('rrStockBody').innerHTML = page.map(function (r) {
      return '<tr><td class="sym">' + esc(r.symbol) + '</td><td>' + esc(r.name) + '</td>' +
        '<td class="num ' + (r.rs20 > 0 ? 'rr-pos' : r.rs20 < 0 ? 'rr-neg' : '') + '">' + (r.rs20 == null ? '—' : signed(r.rs20)) + '</td>' +
        '<td class="num ' + (r.ret20 > 0 ? 'rr-pos' : r.ret20 < 0 ? 'rr-neg' : '') + '">' + (r.ret20 == null ? '—' : signed(r.ret20)) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="rr-loading">No stocks in this sector.</td></tr>';
    $('rrStockPage').textContent = 'Page ' + state.stockPage + ' of ' + pages;
    $('rrStockPrev').disabled = state.stockPage <= 1;
    $('rrStockNext').disabled = state.stockPage >= pages;
  }

  /* ---------------- forward ledger ---------------- */

  function fwdResolved(e) { return e.fwd_4w != null || e.fwd_13w != null; }

  function renderFwd() {
    var f = state.fwd;
    var body = $('rrFwdBody');
    if (!f || !f.entries) {
      body.innerHTML = '<tr><td colspan="6" class="rr-loading">Forward tracking arrives with the next data publish.</td></tr>';
      $('rrFwdSummary').textContent = '';
      $('rrFwdMeta').textContent = '—';
      $('rrFwdNote').textContent = '';
      $('rrFwdPage').textContent = '';
      return;
    }
    var s = (f.summary && f.summary.overall) || {};
    var sum = (f.started || '—') + ' · ' + (s.tracked || 0) + ' calls tracked';
    if (s.resolved_4w) {
      sum += ' · 4w resolved ' + s.resolved_4w + ' (' + (s.rate_4w == null ? '—' : s.rate_4w + '% beat') + ')';
    } else {
      sum += ' · no resolved calls yet';
    }
    if (s.resolved_13w) {
      sum += ' · 13w resolved ' + s.resolved_13w + ' (' + (s.rate_13w == null ? '—' : s.rate_13w + '% beat') + ')';
    }
    $('rrFwdSummary').textContent = sum + '.';
    $('rrFwdMeta').textContent = 'tracking since ' + (f.started || '—');
    $('rrFwdNote').textContent = f.launch_note || '';
    var entries = f.entries.slice();
    if (state.fwdFilter === 'Resolved') entries = entries.filter(fwdResolved);
    if (state.fwdFilter === 'Pending') entries = entries.filter(function (e) { return !fwdResolved(e); });
    entries.sort(function (a, b) {
      if (a.board_date !== b.board_date) return b.board_date.localeCompare(a.board_date);
      return (a.rotation_rank || 99) - (b.rotation_rank || 99);
    });
    var pages = Math.max(1, Math.ceil(entries.length / PAGE));
    if (state.fwdPage > pages) state.fwdPage = pages;
    var from = (state.fwdPage - 1) * PAGE;
    var page = entries.slice(from, from + PAGE);
    body.innerHTML = page.map(function (e) {
      return '<tr><td>' + esc(e.board_date) + '</td><td><strong>' + esc(e.sector) + '</strong></td>' +
        '<td><span class="rr-chip ' + esc(e.quadrant) + '">' + esc(e.quadrant) + '</span></td>' +
        '<td class="num">' + fmt(e.rs_ratio) + '</td>' +
        '<td class="num ' + (e.fwd_4w > 0 ? 'rr-pos' : e.fwd_4w < 0 ? 'rr-neg' : '') + '">' + (e.fwd_4w == null ? '— pending' : signed(e.fwd_4w)) + '</td>' +
        '<td class="num ' + (e.fwd_13w > 0 ? 'rr-pos' : e.fwd_13w < 0 ? 'rr-neg' : '') + '">' + (e.fwd_13w == null ? '— pending' : signed(e.fwd_13w)) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="rr-loading">No calls in this view.</td></tr>';
    $('rrFwdPage').textContent = 'Page ' + state.fwdPage + ' of ' + pages;
    $('rrFwdPrev').disabled = state.fwdPage <= 1;
    $('rrFwdNext').disabled = state.fwdPage >= pages;
  }

  /* ---------------- init / render-all ---------------- */

  function names(q, rows) {
    return rows.filter(function (r) { return r.quadrant === q; })
      .map(function (r) { return r.sector; }).join(', ') || 'none';
  }

  function renderAll() {
    var data = state.board;
    if (!data) return;
    state.rows = data.sectors || [];
    var counts = data.counts || {};
    $('rrSession').textContent = 'Session ' + data.asof + ' · 11 sectors vs the ' +
      (data.benchmark || 'NEPSE Index') + ' · rebuilt after every close · Source: Nepse Decode derived sector indices';
    var tLeader = state.rows.slice().sort(function (a, b) { return (b.turnover_share_pct || 0) - (a.turnover_share_pct || 0); })[0];
    var fBest = state.rows.slice().sort(function (a, b) { return (b.flow_shift_pp || 0) - (a.flow_shift_pp || 0); })[0];
    var fWorst = state.rows.slice().sort(function (a, b) { return (a.flow_shift_pp || 0) - (b.flow_shift_pp || 0); })[0];
    var flowCard = (fBest && fBest.flow_shift_pp > 0)
      ? statCard('Money rotating in', fBest.sector, '+' + fmt(fBest.flow_shift_pp) + ' pp turnover share vs its 120-session average')
      : statCard('Money rotating out', fWorst ? fWorst.sector : '—', fWorst ? fmt(fWorst.flow_shift_pp) + ' pp turnover share vs its 120-session average' : '');
    $('rrStats').innerHTML =
      statCard('Leading', String(counts.Leading || 0), names('Leading', state.rows)) +
      statCard('Improving', String(counts.Improving || 0), names('Improving', state.rows)) +
      statCard('Turnover leader', tLeader ? tLeader.sector : '—', tLeader ? fmt(tLeader.turnover_share_pct) + '% of market turnover in the latest session' : '') +
      flowCard;
    var qc = data.quadrant_chart || { sectors: [] };
    if ($('rrChartSession')) $('rrChartSession').textContent = 'session ' + (qc.asof || data.asof);
    $('rrChart').innerHTML = buildQuadrantChart((qc.sectors || []).map(function (r) {
      return { sector: r.sector, rs_ratio: r.x, rs_momentum: r.y, quadrant: r.quadrant };
    }));
    var qCounts = {};
    (qc.sectors || []).forEach(function (r) { qCounts[r.quadrant] = (qCounts[r.quadrant] || 0) + 1; });
    $('rrLegend').innerHTML = QUADS.map(function (q) {
      return '<span class="rr-leg"><span class="rr-dot ' + q + '"></span>' + q + ' <em>' + (qCounts[q] || 0) + ' sectors</em></span>';
    }).join('');
    var total = QUADS.reduce(function (acc, q) { return acc + (counts[q] || 0); }, 0);
    var segs = '', leg = '';
    QUADS.forEach(function (q) {
      var c = counts[q] || 0;
      if (!c || !total) return;
      segs += '<i class="' + q + '" style="width:' + (c / total * 100).toFixed(1) + '%"></i>';
      leg += '<span class="rr-mixrow"><i class="' + q + '"></i>' + q + ' <em>' + c + '</em></span>';
    });
    $('rrMix').innerHTML = '<div class="rr-mixlabel">Weekly posture mix — same sectors, slower weekly lens (not the daily chart above)</div><div class="rr-mixtrack">' + segs + '</div><div class="rr-mixlegend">' + leg + '</div>';
    $('rrMix').setAttribute('aria-label', 'Sector quadrant mix: ' + QUADS.map(function (q) { return q + ' ' + (counts[q] || 0); }).join(', '));
    // default sector = top-ranked, unless the URL (or a click) picked one
    var stocks = data.stocks || {};
    if (!state.sector || !stocks[state.sector]) {
      var top = state.rows.slice().sort(function (a, b) { return (a.rotation_rank || 99) - (b.rotation_rank || 99); })[0];
      state.sector = top ? top.sector : Object.keys(stocks)[0];
    }
    document.querySelectorAll('#rrQuadFilter button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-quad') === state.quad);
    });
    renderTable();
    renderFlow();
    renderSectorPills();
    renderStocks();
    renderFwd();
    renderScope();
    bindChartClicks();
  }

  /* Scope + unscored disclosure (2026-10-30): equity-sector symbols
     classified by the site classifier but absent from the keystone
     because only LTP data exists for them are listed, not dropped. */
  function renderScope() {
    var data = state.board;
    if (!data || !data.scope_note) return;
    var box = document.querySelector('.rr-method');
    if (!box) return;
    var p = document.getElementById('rrScopeNote');
    if (!p) {
      p = document.createElement('p');
      p.id = 'rrScopeNote';
      box.appendChild(p);
    }
    var un = data.unscored || [];
    p.innerHTML = '<strong>Scope.</strong> ' + esc(data.scope_note) +
      (un.length ? ' Unscored: ' + un.map(function (u) {
        return esc(u.symbol) + ' (' + esc(u.sector) + ', ' + esc(u.reason) + ')';
      }).join('; ') + '.' : '');
  }

  function bindChartClicks() {
    document.querySelectorAll('#rrChart .rr-dotg').forEach(function (g) {
      function go() { selectSector(g.getAttribute('data-sector'), true); }
      g.addEventListener('click', go);
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  function syncUrl() {
    try {
      var u = new URL(window.location.href);
      if (state.sector) u.searchParams.set('sector', state.sector); else u.searchParams.delete('sector');
      if (state.quad && state.quad !== 'All') u.searchParams.set('quad', state.quad); else u.searchParams.delete('quad');
      history.replaceState(null, '', u.toString());
    } catch (e) { /* URL state is a nicety, never fatal */ }
  }

  function readUrl() {
    try {
      var u = new URL(window.location.href);
      var s = u.searchParams.get('sector');
      if (s) state.sector = s;
      var q = u.searchParams.get('quad');
      if (q && QUADS.indexOf(q) >= 0) state.quad = q;
    } catch (e) { /* ignore */ }
  }

  function init() {
    readUrl();
    Promise.all([
      fetchJSON('/data/sector-rotation.json'),
      fetchJSON('/data/sector-rotation-forward.json').catch(function () { return null; })
    ]).then(function (res) {
      state.board = res[0];
      state.fwd = res[1];
      renderAll();
    }).catch(function () {
      $('rrBody').innerHTML = '<tr><td colspan="10" class="rr-loading">The rotation map is being rebuilt — please check back after the next market close.</td></tr>';
      $('rrSession').textContent = 'Map temporarily unavailable';
    });
  }

  /* ---------------- controls ---------------- */

  document.querySelectorAll('#rrTable th.rr-sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var kk = th.getAttribute('data-key');
      if (state.sortKey === kk) state.sortDir *= -1;
      else { state.sortKey = kk; state.sortDir = (kk === 'sector' || kk === 'quadrant' || kk === 'rotation_rank') ? 1 : -1; }
      document.querySelectorAll('#rrTable th .rr-arrow').forEach(function (a) { a.remove(); });
      var sp = document.createElement('span');
      sp.className = 'rr-arrow'; sp.textContent = state.sortDir === 1 ? '▲' : '▼';
      th.appendChild(sp);
      renderTable();
    });
  });
  document.querySelectorAll('#rrQuadFilter button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.quad = b.getAttribute('data-quad');
      document.querySelectorAll('#rrQuadFilter button').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b);
      });
      syncUrl();
      renderTable();
    });
  });
  document.querySelectorAll('#rrFwdFilter button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.fwdFilter = b.getAttribute('data-fwd');
      state.fwdPage = 1;
      document.querySelectorAll('#rrFwdFilter button').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b);
      });
      renderFwd();
    });
  });
  $('rrStockSort').addEventListener('change', function () {
    state.stockSort = $('rrStockSort').value;
    state.stockPage = 1;
    renderStocks();
  });
  $('rrStockPrev').addEventListener('click', function () {
    if (state.stockPage > 1) { state.stockPage--; renderStocks(); }
  });
  $('rrStockNext').addEventListener('click', function () {
    state.stockPage++; renderStocks();
  });
  $('rrFwdPrev').addEventListener('click', function () {
    if (state.fwdPage > 1) { state.fwdPage--; renderFwd(); }
  });
  $('rrFwdNext').addEventListener('click', function () {
    state.fwdPage++; renderFwd();
  });

  init();

  // Auto-refresh with market calendar awareness (same rule as Seasonality):
  // - Mon-Fri 11:00-15:00 NPT: every 5 min
  // - Mon-Fri outside hours: every 30 min (catches post-close pipeline update)
  // - Sat/Sun (holiday): every 2 hours (Friday's data won't change)
  function refreshIntervalMs() {
    try {
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
      var day = now.getDay();
      if (day === 0 || day === 6) return 2 * 60 * 60 * 1000;
      var mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= 660 && mins < 900) return 5 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }
  setInterval(function () {
    if (document.hidden) return;
    init();
  }, refreshIntervalMs());
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) init();
  });
})();
