/* Sector–Symbol Relation — renders data/sector-symbol.json (nd-sector-symbol/v1).
   Static file, no framework; all numbers printed beside every visual. */
(function () {
  'use strict';
  var DATA_URL = '/data/sector-symbol.json?v=20261023a';
  var state = { days: '30', sector: 'ALL', sort: 'rel', q: '' };
  var PAYLOAD = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(x, dp) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + Number(x).toFixed(dp == null ? 2 : dp) + '%';
  }
  function pp(x) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + Number(x).toFixed(2) + ' pp';
  }
  function cls(x) { return x > 0 ? 'ss-pos' : (x < 0 ? 'ss-neg' : ''); }
  function board() { return PAYLOAD.boards[state.days]; }

  function renderStats() {
    var b = board(), s = b.summary, st = b.stability;
    var share = s.priced ? Math.round(1000 * s.outperformers / s.priced) / 10 : 0;
    var rels = b.rows.map(function (r) { return r.rel_return; })
      .sort(function (a, c) { return a - c; });
    var med = rels.length ? rels[Math.floor(rels.length / 2)] : null;
    var stats = [
      { k: 'Window', v: state.days + ' days', s: 'base ' + b.base_date },
      { k: 'Stocks scored', v: String(s.priced), s: 'of ' + PAYLOAD.universe.constituents + ' constituents · ' + s.unscored + ' unscored' },
      { k: 'Ahead of their sector', v: String(s.outperformers), s: share + '% of scored stocks' },
      { k: 'Median relative return', v: pp(med), s: 'half the board sits above this line' }
    ];
    if (st) stats.push({ k: 'Sign persistence · 4 wks', v: st.sign_persistence_pct + '%',
      s: st.snapshots + ' weekly snapshots · trailing 3y · descriptive' });
    document.getElementById('statStrip').innerHTML = stats.map(function (x) {
      return '<div class="cx-stat"><p class="cx-stat-k">' + esc(x.k) +
        '</p><p class="cx-stat-v">' + esc(x.v) +
        '</p><p class="cx-stat-s">' + esc(x.s) + '</p></div>';
    }).join('');
  }

  function renderTabs() {
    document.getElementById('winTabs').innerHTML = PAYLOAD.windows.map(function (d) {
      return '<button type="button" role="tab" data-days="' + d + '"' +
        (String(d) === state.days ? ' class="on"' : '') + '>' + d + 'D</button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#winTabs button'), function (btn) {
        btn.addEventListener('click', function () {
          state.days = btn.getAttribute('data-days'); renderAll();
        });
      });
  }

  function renderSectorOptions() {
    var sel = document.getElementById('sectorSel');
    var names = board().sectors.map(function (s) { return s.sector; });
    sel.innerHTML = '<option value="ALL">All sectors</option>' + names.map(function (n) {
      return '<option value="' + esc(n) + '"' +
        (state.sector === n ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  function renderDist() {
    var b = board(), d = b.distribution, total = b.summary.priced || 1;
    var segs = [
      ['Strong ahead (≥ +5 pp)', d.strong_out, 'var(--nd-up)'],
      ['Ahead (0 to +5 pp)', d.out, 'color-mix(in srgb, var(--nd-up) 55%, var(--nd-surface))'],
      ['Level (0 pp)', d.flat, 'var(--nd-faint)'],
      ['Behind (−5 to 0 pp)', d.under, 'color-mix(in srgb, var(--nd-down) 55%, var(--nd-surface))'],
      ['Strong behind (≤ −5 pp)', d.strong_under, 'var(--nd-down)']
    ];
    var bar = segs.map(function (s) {
      var w = 100 * s[1] / total;
      return '<div class="ss-dist-seg" title="' + esc(s[0] + ': ' + s[1]) +
        '" style="width:' + w + '%;background:' + s[2] + '"></div>';
    }).join('');
    var legend = segs.map(function (s) {
      return '<span><span class="ss-dot" style="background:' + s[2] + '"></span>' +
        esc(s[0]) + ' · <b>' + s[1] + '</b> (' +
        (Math.round(1000 * s[1] / total) / 10) + '%)</span>';
    }).join('');
    document.getElementById('distBox').innerHTML =
      '<div class="ss-dist-bar">' + bar + '</div>' +
      '<div class="ss-dist-legend">' + legend + '</div>';
  }

  function visibleRows() {
    var rows = board().rows.slice();
    if (state.sector !== 'ALL')
      rows = rows.filter(function (r) { return r.sector === state.sector; });
    if (state.q)
      rows = rows.filter(function (r) {
        return r.symbol.toLowerCase().indexOf(state.q.toLowerCase()) !== -1;
      });
    if (state.sort === 'rel') rows.sort(function (a, b) { return b.rel_return - a.rel_return || (a.symbol < b.symbol ? -1 : 1); });
    if (state.sort === 'ret') rows.sort(function (a, b) { return b.return_ - a.return_ || (a.symbol < b.symbol ? -1 : 1); });
    if (state.sort === 'secrel') rows.sort(function (a, b) { return b.sector_return - a.sector_return || (a.symbol < b.symbol ? -1 : 1); });
    if (state.sort === 'sym') rows.sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; });
    return rows;
  }

  function renderTable() {
    var rows = visibleRows();
    document.getElementById('rowCount').textContent =
      'Showing ' + rows.length + ' of ' + board().summary.priced +
      ' scored stocks · ' + state.days + 'D window · session ' + PAYLOAD.asof;
    document.getElementById('boardBody').innerHTML = rows.map(function (r) {
      return '<tr><td><a href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) +
        '</a></td><td>' + esc(r.sector) + '</td>' +
        '<td class="num ' + cls(r.return_) + '">' + pct(r.return_) + '</td>' +
        '<td class="num">' + pct(r.sector_return) + '</td>' +
        '<td class="num ' + cls(r.rel_return) + '">' + pp(r.rel_return) + '</td>' +
        '<td class="num">#' + r.sector_rank + '</td></tr>';
    }).join('') || '<tr><td colspan="6">No stocks match.</td></tr>';
  }

  function rankList(el, rows, inverted) {
    var max = Math.max.apply(null, rows.map(function (r) {
      return Math.abs(r.rel_return);
    }).concat([0.01]));
    document.getElementById(el).innerHTML = rows.map(function (r, i) {
      var share = Math.max(2, Math.round(100 * Math.abs(r.rel_return) / max));
      var fill = inverted
        ? 'background:var(--nd-down);margin-left:auto;width:' + share + '%'
        : 'background:var(--nd-up);width:' + share + '%';
      return '<li class="cx-rank-row"><span class="cx-rank-n">' + (i + 1) +
        '</span><span class="cx-rank-name"><a href="/stocks/' + esc(r.symbol) +
        '/">' + esc(r.symbol) + '</a> <span class="cx-rank-sym">' +
        esc(r.sector) + '</span></span><span class="cx-rank-val ' +
        cls(r.rel_return) + '">' + pp(r.rel_return) +
        '</span><span class="cx-rank-track"><span class="cx-rank-fill" style="' +
        fill + '"></span></span></li>';
    }).join('');
  }

  function renderExtremes() {
    var b = board();
    rankList('topList', b.top, false);
    rankList('botList', b.bottom, true);
  }

  function renderSectors() {
    document.getElementById('sectorBody').innerHTML =
      board().sectors.map(function (s) {
        var share = s.priced ? Math.round(100 * s.outperformers / s.priced) : 0;
        return '<tr><td>' + esc(s.sector) + '</td>' +
          '<td class="num ' + cls(s.sector_return) + '">' + pct(s.sector_return) + '</td>' +
          '<td class="num">' + s.priced + ' / ' + s.constituents + '</td>' +
          '<td class="ss-sharecell"><span class="ss-sharetext">' +
            s.outperformers + ' ahead · ' + share + '%</span>' +
            '<div class="ss-sharebar"><div class="ss-sharefill" style="width:' +
            share + '%"></div></div></td>' +
          '<td class="num ' + cls(s.median_rel_return) + '">' + pp(s.median_rel_return) + '</td>' +
          '<td>' + (s.leader ? '<a href="/stocks/' + esc(s.leader.symbol) + '/">' +
            esc(s.leader.symbol) + '</a> <span class="' + cls(s.leader.rel_return) +
            '">' + pp(s.leader.rel_return) + '</span>' : '—') + '</td>' +
          '<td>' + (s.laggard ? '<a href="/stocks/' + esc(s.laggard.symbol) + '/">' +
            esc(s.laggard.symbol) + '</a> <span class="' + cls(s.laggard.rel_return) +
            '">' + pp(s.laggard.rel_return) + '</span>' : '—') + '</td></tr>';
      }).join('');
  }

  function renderStability() {
    document.getElementById('stabBody').innerHTML = PAYLOAD.windows.map(function (d) {
      var st = PAYLOAD.boards[String(d)].stability;
      if (!st) return '<tr><td>' + d + 'D</td><td class="num" colspan="3">—</td></tr>';
      return '<tr><td>' + d + 'D</td><td class="num">' + st.snapshots + '</td>' +
        '<td class="num">' + st.sign_persistence_pct + '%</td>' +
        '<td class="num">' + st.top_decile_still_positive_pct + '%</td></tr>';
    }).join('');
  }

  function renderMethod() {
    var b = board();
    document.getElementById('covText').textContent =
      'The board scores ' + b.summary.priced + ' of ' + PAYLOAD.universe.constituents +
      ' sector constituents on the ' + state.days + 'D window (all windows: ' +
      PAYLOAD.windows.map(function (d) {
        return d + 'D ' + PAYLOAD.boards[String(d)].summary.priced;
      }).join(' · ') + ').';
    var un = PAYLOAD.windows.map(function (d) {
      var u = PAYLOAD.boards[String(d)].unscored;
      return d + 'D: ' + (u.length ? u.join(', ') : 'none');
    }).join(' · ');
    document.getElementById('unscoredText').textContent = un + '.';
  }

  function renderAll() {
    renderTabs(); renderSectorOptions(); renderStats(); renderDist();
    renderTable(); renderExtremes(); renderSectors(); renderStability();
    renderMethod();
  }

  function initSession() {
    var el = document.getElementById('ssSession');
    if (el) el.textContent = 'Session ' + PAYLOAD.asof +
      ' · end-of-day board, rebuilt after every close · source: ' +
      PAYLOAD.source;
  }

  document.getElementById('sectorSel').addEventListener('change', function (e) {
    state.sector = e.target.value; renderAll();
  });
  document.getElementById('sortSel').addEventListener('change', function (e) {
    state.sort = e.target.value; renderTable();
  });
  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value; renderTable();
  });

  fetch(DATA_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) { PAYLOAD = p; state.days = String(p.default_days); renderAll(); initSession(); })
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="6">The relation board could not be loaded (' +
        esc(e.message) + ').</td></tr>';
    });
})();
