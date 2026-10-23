/* Sector Rotation page (RRG) — renders /data/sector-rotation.json */
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

  var COLORS = {
    'Banking': '#2563eb', 'Development Bank': '#7c3aed', 'Finance': '#db2777',
    'Hotels And Tourism': '#f59e0b', 'Hydropower': '#06b6d4', 'Investment': '#84cc16',
    'Life Insurance': '#22c55e', 'Manufacturing And Processing': '#f97316',
    'Microfinance': '#e11d48', 'Non Life Insurance': '#14b8a6', 'Others': '#94a3b8'
  };
  var SHORT = {
    'Banking': 'Banking', 'Development Bank': 'Dev Bank', 'Finance': 'Finance',
    'Hotels And Tourism': 'Hotels', 'Hydropower': 'Hydropower', 'Investment': 'Investment',
    'Life Insurance': 'Life Ins.', 'Manufacturing And Processing': 'Manuf.',
    'Microfinance': 'Microfinance', 'Non Life Insurance': 'Non-Life', 'Others': 'Others'
  };

  var state = { rows: [], sortKey: 'rotation_rank', sortDir: 1 };

  function statCard(k, v, s) {
    return '<div class="rr-stat"><div class="sk">' + esc(k) + '</div><div class="sv">' + esc(v) + '</div><div class="ss">' + esc(s) + '</div></div>';
  }

  /* ---------------- RRG chart (inline SVG) ---------------- */

  function buildChart(rows) {
    var W = 680, H = 560, ML = 48, MR = 16, MT = 16, MB = 42;
    var pw = W - ML - MR, ph = H - MT - MB;
    var xs = [100], ys = [100];
    rows.forEach(function (r) {
      (r.trail || []).forEach(function (p) { xs.push(p.rs_ratio); ys.push(p.rs_momentum); });
      xs.push(r.rs_ratio); ys.push(r.rs_momentum);
    });
    function extent(v) {
      var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
      var pad = Math.max((hi - lo) * 0.14, 0.9);
      return [Math.floor((lo - pad) * 2) / 2, Math.ceil((hi + pad) * 2) / 2];
    }
    var xe = extent(xs), ye = extent(ys);
    function X(v) { return ML + (v - xe[0]) / (xe[1] - xe[0]) * pw; }
    function Y(v) { return MT + ph - (v - ye[0]) / (ye[1] - ye[0]) * ph; }
    var x100 = X(100), y100 = Y(100);
    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Relative rotation graph: NEPSE sectors by RS-Ratio and RS-Momentum" class="rr-svg">';
    /* quadrant zones */
    s += '<rect x="' + ML + '" y="' + MT + '" width="' + (x100 - ML) + '" height="' + (y100 - MT) + '" class="rr-zone improving"/>';
    s += '<rect x="' + x100 + '" y="' + MT + '" width="' + (ML + pw - x100) + '" height="' + (y100 - MT) + '" class="rr-zone leading"/>';
    s += '<rect x="' + ML + '" y="' + y100 + '" width="' + (x100 - ML) + '" height="' + (MT + ph - y100) + '" class="rr-zone lagging"/>';
    s += '<rect x="' + x100 + '" y="' + y100 + '" width="' + (ML + pw - x100) + '" height="' + (MT + ph - y100) + '" class="rr-zone weakening"/>';
    /* gridlines + ticks */
    function ticks(e, isX) {
      var step = (e[1] - e[0]) > 14 ? 4 : 2;
      var out = '';
      for (var v = Math.ceil(e[0] / step) * step; v <= e[1]; v += step) {
        if (isX) out += '<line x1="' + X(v) + '" y1="' + MT + '" x2="' + X(v) + '" y2="' + (MT + ph) + '" class="rr-grid"/><text x="' + X(v) + '" y="' + (MT + ph + 16) + '" class="rr-tick" text-anchor="middle">' + v + '</text>';
        else out += '<line x1="' + ML + '" y1="' + Y(v) + '" x2="' + (ML + pw) + '" y2="' + Y(v) + '" class="rr-grid"/><text x="' + (ML - 6) + '" y="' + (Y(v) + 3) + '" class="rr-tick" text-anchor="end">' + v + '</text>';
      }
      return out;
    }
    s += ticks(xe, true) + ticks(ye, false);
    /* centre crosshair */
    s += '<line x1="' + x100 + '" y1="' + MT + '" x2="' + x100 + '" y2="' + (MT + ph) + '" class="rr-axis100"/>';
    s += '<line x1="' + ML + '" y1="' + y100 + '" x2="' + (ML + pw) + '" y2="' + y100 + '" class="rr-axis100"/>';
    /* quadrant labels */
    s += '<text x="' + (ML + pw - 8) + '" y="' + (MT + 18) + '" class="rr-qlabel q-leading" text-anchor="end">LEADING</text>';
    s += '<text x="' + (ML + 8) + '" y="' + (MT + 18) + '" class="rr-qlabel q-improving">IMPROVING</text>';
    s += '<text x="' + (ML + pw - 8) + '" y="' + (MT + ph - 8) + '" class="rr-qlabel q-weakening" text-anchor="end">WEAKENING</text>';
    s += '<text x="' + (ML + 8) + '" y="' + (MT + ph - 8) + '" class="rr-qlabel q-lagging">LAGGING</text>';
    /* axis titles */
    s += '<text x="' + (ML + pw / 2) + '" y="' + (H - 4) + '" class="rr-axtitle" text-anchor="middle">RS-Ratio →</text>';
    s += '<text x="14" y="' + (MT + ph / 2) + '" class="rr-axtitle" text-anchor="middle" transform="rotate(-90 14 ' + (MT + ph / 2) + ')">RS-Momentum →</text>';
    /* trails + endpoints */
    rows.forEach(function (r) {
      var c = COLORS[r.sector] || '#94a3b8';
      var pts = (r.trail || []).map(function (p) { return X(p.rs_ratio).toFixed(1) + ',' + Y(p.rs_momentum).toFixed(1); });
      if (pts.length > 1) s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="1.6" opacity="0.55"/>';
      (r.trail || []).forEach(function (p, i) {
        if (i === r.trail.length - 1) return;
        s += '<circle cx="' + X(p.rs_ratio) + '" cy="' + Y(p.rs_momentum) + '" r="2.1" fill="' + c + '" opacity="0.65"/>';
      });
      var ex = X(r.rs_ratio), ey = Y(r.rs_momentum);
      var anchorEnd = ex > ML + pw * 0.78;
      s += '<g><title>' + esc(r.sector) + ' — ' + esc(r.quadrant) + ' · RS-Ratio ' + fmt(r.rs_ratio) + ' · RS-Momentum ' + fmt(r.rs_momentum) + ' · ' + r.quadrant_days + ' sessions in quadrant</title>' +
        '<circle cx="' + ex + '" cy="' + ey + '" r="5.5" fill="' + c + '" class="rr-endpoint"/>' +
        '<text x="' + (anchorEnd ? ex - 9 : ex + 9) + '" y="' + (ey + 4) + '" class="rr-ptlabel" text-anchor="' + (anchorEnd ? 'end' : 'start') + '">' + esc(SHORT[r.sector] || r.sector) + '</text></g>';
    });
    s += '</svg>';
    return s;
  }

  /* ---------------- table ---------------- */

  function renderTable() {
    var k = state.sortKey, dir = state.sortDir;
    var rows = state.rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
    var h = '';
    rows.forEach(function (r) {
      var fs = r.flow_shift_pp;
      var rc = r.rank_change_1w;
      h += '<tr>' +
        '<td><span class="rr-dot" style="background:' + (COLORS[r.sector] || '#94a3b8') + '"></span><strong>' + esc(r.sector) + '</strong></td>' +
        '<td><span class="rr-chip ' + esc(r.quadrant) + '">' + esc(r.quadrant) + '</span></td>' +
        '<td class="rr-num"><strong>' + fmt(r.rs_ratio) + '</strong></td>' +
        '<td class="rr-num">' + fmt(r.rs_momentum) + '</td>' +
        '<td class="rr-num">' + r.quadrant_days + '</td>' +
        '<td class="rr-num rr-hide-m">' + fmt(r.consistency, 1) + '</td>' +
        '<td class="rr-num">' + fmt(r.turnover_share_pct) + '%</td>' +
        '<td class="rr-num rr-hide-m ' + (fs > 0 ? 'rr-pos' : fs < 0 ? 'rr-neg' : '') + '">' + (fs == null ? '—' : (fs > 0 ? '+' : '') + fmt(fs)) + '</td>' +
        '<td class="rr-num rr-hide-s ' + (rc > 0 ? 'rr-pos' : rc < 0 ? 'rr-neg' : '') + '">' + (rc == null ? '—' : (rc > 0 ? '▲ ' + rc : rc < 0 ? '▼ ' + Math.abs(rc) : '— 0')) + '</td>' +
        '</tr>';
    });
    $('rrBody').innerHTML = h || '<tr><td colspan="9" class="rr-loading">No sector data.</td></tr>';
  }

  function init(data) {
    state.rows = data.sectors || [];
    var counts = data.counts || {};
    $('rrSession').textContent = 'Session ' + data.asof + ' · 11 sectors vs the ' +
      (data.benchmark || 'NEPSE Index') + ' · rebuilt after every close · Source: Nepse Decode derived sector indices';
    function names(q) {
      return state.rows.filter(function (r) { return r.quadrant === q; })
        .map(function (r) { return r.sector; }).join(', ') || 'none';
    }
    var tLeader = state.rows.slice().sort(function (a, b) { return (b.turnover_share_pct || 0) - (a.turnover_share_pct || 0); })[0];
    var fBest = state.rows.slice().sort(function (a, b) { return (b.flow_shift_pp || 0) - (a.flow_shift_pp || 0); })[0];
    var fWorst = state.rows.slice().sort(function (a, b) { return (a.flow_shift_pp || 0) - (b.flow_shift_pp || 0); })[0];
    var flowCard = (fBest && fBest.flow_shift_pp > 0)
      ? statCard('Money rotating in', fBest.sector, '+' + fmt(fBest.flow_shift_pp) + ' pp turnover share vs its 120-session average')
      : statCard('Money rotating out', fWorst ? fWorst.sector : '—', fWorst ? fmt(fWorst.flow_shift_pp) + ' pp turnover share vs its 120-session average' : '');
    $('rrStats').innerHTML =
      statCard('Leading', String(counts.Leading || 0), names('Leading')) +
      statCard('Improving', String(counts.Improving || 0), names('Improving')) +
      statCard('Turnover leader', tLeader ? tLeader.sector : '—', tLeader ? fmt(tLeader.turnover_share_pct) + '% of market turnover in the latest session' : '') +
      flowCard;
    $('rrChart').innerHTML = buildChart(state.rows);
    $('rrLegend').innerHTML = state.rows.map(function (r) {
      return '<span class="rr-leg"><span class="rr-dot" style="background:' + (COLORS[r.sector] || '#94a3b8') + '"></span>' +
        esc(r.sector) + ' <em>' + esc(r.quadrant) + '</em></span>';
    }).join('');
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
    renderTable();
  }

  fetchJSON('/data/sector-rotation.json').then(init).catch(function () {
    $('rrBody').innerHTML = '<tr><td colspan="9" class="rr-loading">The rotation map is being rebuilt — please check back after the next market close.</td></tr>';
    $('rrSession').textContent = 'Map temporarily unavailable';
  });
})();
