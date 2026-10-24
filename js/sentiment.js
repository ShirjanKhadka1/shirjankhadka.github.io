/* Stock–Sector Sentiment — renders data/stock-sector-sentiment.json
   (nd-stock-sector-sentiment/v1). Static file, no framework; all numbers
   printed beside every visual. */
(function () {
  'use strict';
  var DATA_URL = '/data/stock-sector-sentiment.json?v=20261024a';
  var state = { win: '20', sector: 'ALL', sort: 'score', q: '', horizon: '10' };
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
  function num(x, dp) {
    if (x == null || isNaN(x)) return '—';
    return Number(x).toFixed(dp == null ? 2 : dp);
  }
  function cls(x) { return x > 0 ? 'sn-pos' : (x < 0 ? 'sn-neg' : ''); }
  function board() { return PAYLOAD.boards[state.win]; }
  function stateCls(s) {
    return s === 'Strong Bullish' ? 'up' : s === 'Bullish' ? 'mild-up' :
      s === 'Neutral' ? 'flat' : s === 'Bearish' ? 'mild-down' : 'down';
  }

  function renderStats() {
    var b = board(), s = b.summary, d = b.distribution;
    var bull = d.strong_bullish + d.bullish;
    var share = s.scored ? Math.round(1000 * bull / s.scored) / 10 : 0;
    var stats = [
      { k: 'Window', v: state.win + ' sessions', s: 'components measured over this span' },
      { k: 'Stocks scored', v: String(s.scored), s: 'of ' + PAYLOAD.universe.constituents + ' constituents · ' + s.unscored + ' unscored' },
      { k: 'Market sentiment', v: num(s.mean_score, 1), s: 'median stock ' + num(s.median_score, 1) + ' · 0–100 scale' },
      { k: 'Bullish-zone readings', v: String(bull), s: share + '% of the board scores 60 or more' },
      { k: 'Strongest sector', v: s.top_sector || '—', s: 'weakest: ' + (s.bottom_sector || '—') }
    ];
    document.getElementById('statStrip').innerHTML = stats.map(function (x) {
      return '<div class="cx-stat"><p class="cx-stat-l">' + esc(x.k) +
        '</p><p class="cx-stat-v">' + esc(x.v) +
        '</p><p class="cx-stat-s">' + esc(x.s) + '</p></div>';
    }).join('');
  }

  var BANDS = [
    ['Strong Bullish', 'strong_bullish', 'var(--nd-up)'],
    ['Bullish', 'bullish', 'var(--nd-lime)'],
    ['Neutral', 'neutral', 'var(--nd-dim)'],
    ['Bearish', 'bearish', 'color-mix(in srgb, var(--nd-down) 55%, var(--nd-panel))'],
    ['Strong Bearish', 'strong_bearish', 'var(--nd-down)']
  ];
  function renderDist() {
    var b = board(), d = b.distribution, total = b.summary.scored || 1;
    var bar = BANDS.map(function (s) {
      if (!d[s[1]]) return '';
      var w = 100 * d[s[1]] / total;
      return '<i title="' + esc(s[0] + ': ' + d[s[1]]) +
        '" style="width:' + w + '%;background:' + s[2] + '"></i>';
    }).join('');
    var legend = BANDS.map(function (s) {
      if (!d[s[1]]) return '';
      return '<span><span class="sn-dot" style="background:' + s[2] + '"></span>' +
        esc(s[0]) + ' · <b>' + d[s[1]] + '</b> (' +
        (Math.round(1000 * d[s[1]] / total) / 10) + '%)</span>';
    }).join('');
    document.getElementById('bandDist').innerHTML =
      '<div class="sn-dist-bar" role="img" aria-label="Sentiment band distribution">' +
      bar + '</div><div class="sn-dist-legend">' + legend + '</div>';
  }

  function renderTabs() {
    document.getElementById('winTabs').innerHTML = PAYLOAD.windows.map(function (w) {
      return '<button type="button" role="tab" data-win="' + w + '"' +
        ' aria-pressed="' + (String(w) === state.win) + '">' + w + ' sessions</button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#winTabs button'), function (btn) {
        btn.addEventListener('click', function () {
          state.win = btn.getAttribute('data-win'); renderAll();
        });
      });
    var hz = document.getElementById('horizonTabs');
    hz.innerHTML = Object.keys(PAYLOAD.forward.horizons).map(function (h) {
      return '<button type="button" role="tab" data-h="' + h + '"' +
        ' aria-pressed="' + (h === state.horizon) + '">' + h + ' sessions ahead</button>';
    }).join('');
    Array.prototype.forEach.call(
      hz.querySelectorAll('button'), function (btn) {
        btn.addEventListener('click', function () {
          state.horizon = btn.getAttribute('data-h'); renderForward();
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

  function visibleRows() {
    var rows = board().rows.slice();
    if (state.sector !== 'ALL')
      rows = rows.filter(function (r) { return r.sector === state.sector; });
    if (state.q)
      rows = rows.filter(function (r) {
        return r.symbol.toLowerCase().indexOf(state.q.toLowerCase()) !== -1;
      });
    var bySym = function (a, b) { return a.symbol < b.symbol ? -1 : 1; };
    if (state.sort === 'score') rows.sort(function (a, b) { return b.score - a.score || bySym(a, b); });
    if (state.sort === 'rel') rows.sort(function (a, b) { return b.rel_mom_pp - a.rel_mom_pp || bySym(a, b); });
    if (state.sort === 'up') rows.sort(function (a, b) { return b.up_edge_pp - a.up_edge_pp || bySym(a, b); });
    if (state.sort === 'flow') rows.sort(function (a, b) { return b.flow_edge - a.flow_edge || bySym(a, b); });
    if (state.sort === 'sym') rows.sort(bySym);
    return rows;
  }

  function renderTable() {
    var rows = visibleRows();
    document.getElementById('boardCount').textContent =
      'Showing ' + rows.length + ' of ' + board().summary.scored +
      ' scored stocks · ' + state.win + '-session window · session ' + PAYLOAD.asof;
    document.getElementById('boardBody').innerHTML = rows.map(function (r) {
      return '<tr><td class="num">' + r.rank + '</td>' +
        '<td class="sn-sym"><a href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a>' +
        (r.name ? '<span class="sn-name">' + esc(r.name) + '</span>' : '') + '</td>' +
        '<td class="sn-sector">' + esc(r.sector) + '</td>' +
        '<td class="num"><span class="sn-score"><span class="sn-gauge" aria-hidden="true">' +
        '<i style="--pos:' + r.score + '%"></i></span><b>' + num(r.score, 1) + '</b></span></td>' +
        '<td><span class="sn-state ' + stateCls(r.state) + '">' + esc(r.state) + '</span></td>' +
        '<td class="num ' + cls(r.rel_mom_pp) + '">' + pp(r.rel_mom_pp) + '</td>' +
        '<td class="num ' + cls(r.up_edge_pp) + '">' + pp(r.up_edge_pp) + '</td>' +
        '<td class="num ' + cls(r.flow_edge) + '">' + num(r.flow_edge, 3) + '</td>' +
        '<td class="num">' + num(r.close, 2) + '</td>' +
        '<td class="num ' + cls(r.change_pct) + '">' + pct(r.change_pct) + '</td></tr>';
    }).join('') || '<tr><td colspan="10" class="sn-loading">No stocks match.</td></tr>';
    var b = board();
    document.getElementById('coverageNote').textContent =
      'The board scores ' + b.summary.scored + ' of ' + PAYLOAD.universe.constituents +
      ' sector constituents on the ' + state.win + '-session window (all windows: ' +
      PAYLOAD.windows.map(function (w) {
        return w + ' sessions ' + PAYLOAD.boards[String(w)].summary.scored;
      }).join(' · ') + '). Unscored names are listed under Methodology.';
  }

  function rankList(el, rows, inverted) {
    var max = Math.max.apply(null, rows.map(function (r) {
      return Math.abs(r.rel_mom_pp);
    }).concat([0.01]));
    document.getElementById(el).innerHTML = rows.map(function (r, i) {
      var share = Math.max(2, Math.round(100 * Math.abs(r.rel_mom_pp) / max));
      return '<li class="cx-rank-row"><span class="cx-rank-n">' + (i + 1) +
        '</span><span class="cx-rank-sym"><a href="/stocks/' + esc(r.symbol) + '/" ' +
        'style="color:inherit;text-decoration:none">' + esc(r.symbol) + '</a>' +
        '<span class="sn-ranksec">' + esc(r.sector) + '</span></span>' +
        '<span class="cx-rank-val">' + num(r.score, 1) + ' · ' +
        '<span class="' + cls(r.rel_mom_pp) + '">' + pp(r.rel_mom_pp) + '</span></span>' +
        '<span class="cx-rank-track"><span class="cx-rank-fill ' +
        (inverted ? 'down' : 'up') + '" style="width:' + share + '%"></span></span></li>';
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
        return '<tr><td class="sn-sector" style="color:var(--nd-text);font-weight:700">' + esc(s.sector) + '</td>' +
          '<td class="num">' + num(s.mean_score, 1) +
          '<span class="sn-meanbar" aria-hidden="true"><i style="width:' + s.mean_score + '%"></i></span></td>' +
          '<td class="num">' + num(s.median_score, 1) + '</td>' +
          '<td class="num">' + num(s.breadth_pos_pct, 1) + '% (' + s.scored + ' scored)</td>' +
          '<td class="num">' + num(s.pct_ahead_pct, 1) + '%</td>' +
          '<td class="num ' + cls(s.sector_ret_pct) + '">' + pct(s.sector_ret_pct) + '</td>' +
          '<td>' + (s.leader ? '<a href="/stocks/' + esc(s.leader.symbol) + '/">' +
            esc(s.leader.symbol) + '</a> · ' + num(s.leader.score, 1) : '—') + '</td>' +
          '<td>' + (s.laggard ? '<a href="/stocks/' + esc(s.laggard.symbol) + '/">' +
            esc(s.laggard.symbol) + '</a> · ' + num(s.laggard.score, 1) : '—') + '</td></tr>';
      }).join('');
  }

  function renderForward() {
    var f = PAYLOAD.forward, h = f.horizons[state.horizon];
    document.getElementById('forwardSub').textContent =
      'The 20-session construction recomputed at ' + f.snapshots +
      ' weekly snapshots, ' + f.era_start + ' to ' + f.era_end +
      ', each reading\'s forward return measured against the stock\'s own ' +
      'sector. ' + f.basis;
    document.getElementById('forwardBody').innerHTML = h.quintiles.map(function (q) {
      var label = ['Q1 · lowest scores', 'Q2', 'Q3', 'Q4', 'Q5 · highest scores'][q.quintile - 1];
      return '<tr><td>' + label + '</td>' +
        '<td class="num">' + q.n.toLocaleString('en-IN') + '</td>' +
        '<td class="num ' + cls(q.mean_rel_fwd_pct) + '">' + pp(q.mean_rel_fwd_pct) + '</td>' +
        '<td class="num">' + num(q.pct_positive, 1) + '%</td></tr>';
    }).join('');
    document.getElementById('forwardNote').textContent =
      'Top-minus-bottom spread at this horizon: ' + pp(h.spread_q5_q1_pp) +
      '. Readings in the bullish zone (score 60+) went on to average ' +
      pp(h.bullish_zone.mean_rel_fwd_pct) + ' against their sector (' +
      h.bullish_zone.n.toLocaleString('en-IN') + ' readings); bearish-zone ' +
      'readings (40 or less) averaged ' + pp(h.bearish_zone.mean_rel_fwd_pct) +
      ' (' + h.bearish_zone.n.toLocaleString('en-IN') + ' readings). ' +
      'In plain words: on this replay the score describes the recent past ' +
      'well and predicts the near future weakly at best — high readings ' +
      'were not followed by sector-relative gains. Treat it as a description, ' +
      'never as a signal to act on.';
  }

  function renderHistory() {
    var rows = (PAYLOAD.history_recent || []).slice().reverse();
    document.getElementById('historyBody').innerHTML = rows.map(function (e) {
      var c = e.band_counts || {};
      return '<tr><td>' + esc(e.asof) + '</td>' +
        '<td class="num">' + e.scored + '</td>' +
        '<td class="num">' + num(e.market_mean_score, 1) + '</td>' +
        '<td class="num">' + num(e.market_median_score, 1) + '</td>' +
        '<td class="num">' + (c.strong_bullish || 0) + '</td>' +
        '<td class="num">' + (c.bullish || 0) + '</td>' +
        '<td class="num">' + (c.neutral || 0) + '</td>' +
        '<td class="num">' + (c.bearish || 0) + '</td>' +
        '<td class="num">' + (c.strong_bearish || 0) + '</td></tr>';
    }).join('') || '<tr><td colspan="9" class="sn-loading">No sessions recorded yet.</td></tr>';
  }

  function renderMethod() {
    var m = PAYLOAD.methodology;
    var blocks = [
      ['Whose construction is this?', m.provenance],
      ['The construction', m.construction],
      ['The bands', m.bands],
      ['Sector basis', m.sector_basis],
      ['The forward panel', m.forward],
      ['Coverage', m.coverage]
    ];
    document.getElementById('methodBox').innerHTML = blocks.map(function (b) {
      return '<h3>' + esc(b[0]) + '</h3><p>' + esc(b[1]) + '</p>';
    }).join('') + '<p>Source: ' + esc(PAYLOAD.source) + '.</p>';
    var un = PAYLOAD.windows.map(function (w) {
      var u = PAYLOAD.boards[String(w)].unscored;
      return w + ' sessions: ' + (u.length ? u.join(', ') : 'none');
    }).join(' · ');
    document.getElementById('unscoredText').textContent =
      'Unscored on session ' + PAYLOAD.asof + ' — ' + un + '.';
  }

  function renderAll() {
    renderTabs(); renderSectorOptions(); renderStats(); renderDist();
    renderTable(); renderExtremes(); renderSectors(); renderForward();
    renderHistory(); renderMethod();
  }

  function initSession() {
    var el = document.getElementById('snSession');
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
  document.getElementById('symSearch').addEventListener('input', function (e) {
    state.q = e.target.value; renderTable();
  });

  fetch(DATA_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) {
      PAYLOAD = p; state.win = String(p.default_window);
      state.horizon = p.forward.horizons['10'] ? '10' : Object.keys(p.forward.horizons)[0];
      renderAll(); initSession();
    })
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="10" class="sn-loading">The sentiment board could not be loaded (' +
        esc(e.message) + ').</td></tr>';
    });
})();
