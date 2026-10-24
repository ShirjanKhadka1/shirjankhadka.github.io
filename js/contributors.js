/* NEPSE Contributors — renders data/contributors.json (nd-contributors/v2).
   Static file, no framework; all numbers printed beside every visual. */
(function () {
  'use strict';
  var DATA_URL = '/data/contributors.json?v=20261024a';
  var PAYLOAD = null;
  var state = { sector: 'All', q: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pts(x, dp) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + Number(x).toFixed(dp == null ? 2 : dp);
  }
  function pct(x) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  }
  function num(x) {
    if (x == null || isNaN(x)) return '—';
    return Number(x).toFixed(2);
  }
  function cls(x) { return x > 0 ? 'ct-pos' : (x < 0 ? 'ct-neg' : ''); }
  function intFmt(x) {
    if (x == null || isNaN(x)) return '—';
    return Math.round(Number(x)).toLocaleString('en-IN');
  }
  function rsFmt(x) {
    if (x == null || isNaN(x)) return '—';
    return 'Rs ' + intFmt(x);
  }
  function rows() { return PAYLOAD.rows; }

  function renderSession() {
    var cov = PAYLOAD.coverage;
    document.getElementById('ctSession').textContent =
      'Session ' + PAYLOAD.asof + ' · previous session ' + PAYLOAD.prev_session +
      ' · ' + cov.scored_symbols + ' of ' + cov.universe_symbols +
      ' listed symbols scored · official divisor Rs ' +
      Number(PAYLOAD.reconciliation.divisor_rs_per_point).toLocaleString('en-IN') +
      ' per index point';
  }

  function renderStats() {
    var idx = PAYLOAD.index, rec = PAYLOAD.reconciliation, cov = PAYLOAD.coverage;
    var stats = [
      { k: 'NEPSE · official', v: num(idx.close) + ' (' + pts(idx.change) + ')',
        s: 'the official close and published change for the session' },
      { k: 'Explained by this board', v: pts(rec.explained) + ' pts',
        s: rec.explained_pct + '% of the official move, from the ' +
           cov.scored_symbols + ' scored rows below' },
      { k: 'The residual', v: pts(rec.residual) + ' pts',
        s: 'official minus explained — carried as its own row in the sector ' +
           'table, with its causes, never netted away' },
      { k: 'Coverage', v: cov.scored_symbols + ' of ' + cov.universe_symbols + ' stocks',
        s: cov.cap_coverage_pct + '% of the official total market capitalisation' }
    ];
    document.getElementById('statStrip').innerHTML = stats.map(function (x) {
      return '<div class="cx-stat"><p class="cx-stat-k">' + esc(x.k) +
        '</p><p class="cx-stat-v">' + esc(x.v) +
        '</p><p class="cx-stat-s">' + esc(x.s) + '</p></div>';
    }).join('');
  }

  function topRow(x, i) {
    return '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td class="ct-sym">' + esc(x.symbol) +
      (x.traded ? '' : ' <span class="ct-notrade">no trade</span>') + '</td>' +
      '<td class="num ' + cls(x.points) + '">' + pts(x.points, 3) + '</td>' +
      '<td class="num">' + num(x.close) + '</td>' +
      '<td class="num ' + cls(x.pct_change) + '">' + pct(x.pct_change) + '</td>' +
      '<td class="num">' + Number(x.weight_pct).toFixed(2) + '%</td>' +
      '<td class="num">' + intFmt(x.volume) + '</td>' +
      '<td class="num">' + rsFmt(x.turnover_rs) + '</td></tr>';
  }

  function renderTopTables() {
    [['topGainers', 'topGainersBody'], ['topLosers', 'topLosersBody']]
      .forEach(function (pair) {
        var block = PAYLOAD[pair[0]];
        var html = block.rows.map(topRow).join('');
        html += '<tr class="ct-total"><td></td><td>Total</td>' +
          '<td class="num ' + cls(block.total_points) + '">' +
          pts(block.total_points, 3) + '</td><td></td><td></td>' +
          '<td class="num">' + Number(block.total_weight_pct).toFixed(2) +
          '%</td><td class="num">' + intFmt(block.total_volume) + '</td>' +
          '<td class="num">' + rsFmt(block.total_turnover_rs) +
          '</td></tr>';
        document.getElementById(pair[1]).innerHTML = html;
      });
  }

  function renderSectorBars() {
    var secs = PAYLOAD.sectors;
    var max = Math.max.apply(null, secs.map(function (s) {
      return Math.abs(s.points);
    }).concat([0.01]));
    document.getElementById('sectorBars').innerHTML = secs.map(function (s, i) {
      return '<li class="cx-rank-row"><span class="cx-rank-n">' + (i + 1) +
        '</span><span class="cx-rank-sym">' + esc(s.sector) + '</span>' +
        '<span class="cx-rank-val ' + cls(s.points) + '">' + pts(s.points, 3) +
        '</span><span class="cx-rank-track"><span class="cx-rank-fill' +
        (s.points < 0 ? ' down' : ' up') + '" style="width:' +
        Math.max(2, Math.round(100 * Math.abs(s.points) / max)) +
        '%"></span></span></li>';
    }).join('');
  }

  function renderSectorTable() {
    var html = PAYLOAD.sectors.map(function (s) {
      return '<tr><td class="ct-sector">' + esc(s.sector) + '</td>' +
        '<td class="num">' + num(s.index_level) + '</td>' +
        '<td class="num ' + cls(s.change_pct) + '">' + pct(s.change_pct) + '</td>' +
        '<td class="num ' + cls(s.points) + '">' + pts(s.points, 3) + '</td>' +
        '<td class="num">' + pts(s.weight_pct) + '%</td>' +
        '<td class="num">' + rsFmt(s.turnover_rs) + '</td>' +
        '<td><span class="ct-sym">' + esc(s.top_contributor.symbol) +
        '</span> <span class="' + cls(s.top_contributor.points) + '">' +
        pts(s.top_contributor.points, 3) + '</span></td>' +
        '<td><span class="ct-sym">' + esc(s.top_detractor.symbol) +
        '</span> <span class="' + cls(s.top_detractor.points) + '">' +
        pts(s.top_detractor.points, 3) + '</span></td></tr>';
    }).join('');
    var rr = PAYLOAD.residual_row, idx = PAYLOAD.index;
    html += '<tr class="ct-resid"><td>' + esc(rr.label) + '</td>' +
      '<td></td><td></td>' +
      '<td class="num ' + cls(rr.points) + '">' + pts(rr.points, 3) + '</td>' +
      '<td class="num">' + pts(rr.weight_pct) + '%</td>' +
      '<td></td><td colspan="2" class="ct-notrade">' + esc(rr.note) + '</td></tr>';
    html += '<tr class="ct-total"><td>Total — official NEPSE move</td>' +
      '<td class="num">' + num(idx.close) + '</td>' +
      '<td class="num ' + cls(idx.pct_change) + '">' + pct(idx.pct_change) +
      '</td><td class="num ' + cls(idx.change) + '">' + pts(idx.change, 3) +
      '</td><td class="num">' + (idx.change ? pts(idx.change < 0 ? -100 : 100) + '%' : '—') + '</td>' +
      '<td></td><td colspan="2"></td></tr>';
    document.getElementById('sectorBody').innerHTML = html;
  }

  function renderGross() {
    var rec = PAYLOAD.reconciliation;
    var rs = rows();
    var gainers = rs.filter(function (x) { return x.points > 0; }).length;
    var losers = rs.filter(function (x) { return x.points < 0; }).length;
    var gross = rec.gross_up + Math.abs(rec.gross_down);
    var seg = '';
    if (rec.gross_up > 0) {
      seg += '<span style="display:block;width:' + (100 * rec.gross_up / gross) +
        '%;background:var(--nd-up)"></span>';
    }
    if (rec.gross_down < 0) {
      seg += '<span style="display:block;width:' +
        (100 * Math.abs(rec.gross_down) / gross) +
        '%;background:var(--nd-down)"></span>';
    }
    var legend =
      '<span><span class="ct-dot" style="background:var(--nd-up)"></span>' +
      'Added by gainers <b>' + pts(rec.gross_up) + ' pts · ' + gainers +
      ' stocks</b></span>' +
      '<span><span class="ct-dot" style="background:var(--nd-down)"></span>' +
      'Removed by losers <b>' + pts(rec.gross_down) + ' pts · ' + losers +
      ' stocks</b></span>';
    document.getElementById('grossBox').innerHTML =
      '<div class="ct-dist-bar" role="img" aria-label="Gross movement: gainers added ' +
      pts(rec.gross_up) + ' points, losers removed ' + pts(rec.gross_down) +
      ' points">' + seg + '</div><div class="ct-dist-legend">' + legend + '</div>';
  }

  function renderRecon() {
    var idx = PAYLOAD.index, rec = PAYLOAD.reconciliation, cov = PAYLOAD.coverage;
    var rowsHtml = [
      ['Official NEPSE change', idx.change, 'NEPSE\'s published move for the session (' +
        num(idx.prev_close) + ' → ' + num(idx.close) + ')'],
      ['Explained by this board', rec.explained, 'the sum of the ' +
        cov.scored_symbols + ' scored rows on this page'],
      ['The residual', rec.residual, 'official minus explained — the net move ' +
        'of everything the index counts that this board cannot score, carried ' +
        'as the last row of the sector table']
    ].map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td class="num ' + cls(r[1]) + '">' +
        pts(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>';
    }).join('');
    document.getElementById('reconBody').innerHTML = rowsHtml;
    var un = PAYLOAD.unscored;
    var eqNoShares = un.no_share_count.filter(function (x) {
      return x.type === 'Equity';
    }).length;
    document.getElementById('residNote').textContent =
      'This board scored ' + cov.scored_symbols + ' of ' + cov.universe_symbols +
      ' listed symbols — Rs ' + (cov.cap_scored_rs / 1e12).toFixed(2) +
      ' trillion of the official Rs ' +
      (cov.official_total_cap_rs / 1e12).toFixed(2) +
      ' trillion total market capitalisation (' + cov.cap_coverage_pct +
      '%). Inside the official index but outside this board: ' + eqNoShares +
      ' ordinary shares with no share count in the filings compilation or the ' +
      'ownership archive (small caps and recent listings among them), ' +
      'and the promoter-share ' +
      'listings outside the ordinary-share basis. Their net move on the ' +
      'session, together with NEPSE\'s own divisor adjustments for listings ' +
      'and corporate actions, is the ' + pts(rec.residual) + ' residual. It ' +
      'is measured and printed — the sector table above carries it as a row, ' +
      'so the table sums exactly to the official move.';
    var hist = PAYLOAD.history_recent || [];
    if (hist.length > 1) {
      document.getElementById('historyBox').innerHTML =
        '<div class="ct-hist"><h3 class="ct-subh">Recent sessions</h3>' +
        '<div class="cx-scroll ct-tablewrap"><table class="cx-table">' +
        '<thead><tr><th>Session</th><th class="num">Official</th>' +
        '<th class="num">Explained</th><th class="num">Residual</th></tr></thead>' +
        '<tbody>' + hist.map(function (h) {
          return '<tr><td>' + esc(h.asof) + '</td><td class="num">' +
            pts(h.official_change) + '</td><td class="num">' +
            pts(h.explained) + '</td><td class="num ' + cls(h.gap) + '">' +
            pts(h.gap) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }
  }

  function sectorList() {
    var seen = [];
    rows().forEach(function (x) {
      if (seen.indexOf(x.sector) < 0) seen.push(x.sector);
    });
    return ['All'].concat(seen.sort());
  }

  function renderTabs() {
    document.getElementById('sectorTabs').innerHTML =
      sectorList().map(function (s) {
        return '<button type="button" role="tab" data-sec="' + esc(s) + '"' +
          (s === state.sector ? ' class="on"' : '') + '>' + esc(s) + '</button>';
      }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#sectorTabs button'), function (btn) {
        btn.addEventListener('click', function () {
          state.sector = btn.getAttribute('data-sec'); renderTabs(); renderBoard();
        });
      });
  }

  function renderBoard() {
    var q = state.q.trim().toUpperCase();
    var list = rows().filter(function (x) {
      if (state.sector !== 'All' && x.sector !== state.sector) return false;
      if (q && x.symbol.indexOf(q) < 0) return false;
      return true;
    });
    document.getElementById('boardBody').innerHTML = list.map(function (x) {
      return '<tr><td class="num">' + x.rank + '</td>' +
        '<td class="ct-sym">' + esc(x.symbol) +
        (x.traded ? '' : ' <span class="ct-notrade">no trade</span>') + '</td>' +
        '<td>' + esc(x.sector) + '</td>' +
        '<td class="num">' + num(x.close) + '</td>' +
        '<td class="num">' + num(x.prev_close) + '</td>' +
        '<td class="num ' + cls(x.pct_change) + '">' + pct(x.pct_change) + '</td>' +
        '<td class="num">' + Number(x.weight_pct).toFixed(2) + '%</td>' +
        '<td class="num">' + intFmt(x.volume) + '</td>' +
        '<td class="num">' + rsFmt(x.turnover_rs) + '</td>' +
        '<td class="num ' + cls(x.points) + '">' + pts(x.points, 3) + '</td></tr>';
    }).join('') || '<tr><td colspan="10" class="ct-loading">No scored stock matches.</td></tr>';
    document.getElementById('boardCount').textContent =
      'Showing ' + list.length + ' of ' + rows().length + ' scored stocks.';
  }

  function namesList(items) {
    return items.map(function (x) { return esc(x.symbol); }).join(' · ');
  }

  function renderUnscored() {
    var un = PAYLOAD.unscored;
    var html = '';
    if (un.no_price.length) {
      html += '<div class="ct-unscored"><h3>Share count held, no current price (' +
        un.no_price.length + ')</h3><p>These companies have a share count in ' +
        'the filings compilation or the ownership archive but no trade price ' +
        'since before the previous session — suspended, merged or stale in ' +
        'the archive — so no honest contribution can be computed.</p>' +
        '<p class="ct-names">' +
        namesList(un.no_price) + '</p></div>';
    }
    var eq = un.no_share_count.filter(function (x) { return x.type === 'Equity'; });
    if (eq.length) {
      html += '<div class="ct-unscored"><h3>No compiled share count — ordinary ' +
        'shares (' + eq.length + ')</h3><p>Listed companies whose paid-up ' +
        'figures are in neither the latest filings compilation nor the ' +
        'ownership archive (mostly small caps and recent listings). They ' +
        'join the board when a compilation carries them.</p>' +
        '<p class="ct-names">' + namesList(eq) + '</p></div>';
    }
    var other = un.no_share_count.filter(function (x) { return x.type !== 'Equity'; });
    if (other.length) {
      var byType = {};
      other.forEach(function (x) {
        (byType[x.type] = byType[x.type] || []).push(x);
      });
      html += '<div class="ct-unscored"><h3>Outside the ordinary-share basis (' +
        other.length + ')</h3><p>Mutual fund units, debentures and promoter ' +
        'shares are not ordinary shares, so this board does not score them. ' +
        'Debentures and mutual funds are not constituents of the NEPSE ' +
        'equity index at all.</p>' +
        Object.keys(byType).sort().map(function (t) {
          return '<p>' + esc(t) + ' (' + byType[t].length + '): ' +
            '<span class="ct-names">' + namesList(byType[t]) + '</span></p>';
        }).join('') + '</div>';
    }
    document.getElementById('unscoredBox').innerHTML = html;
  }

  function renderAll() {
    renderSession(); renderStats(); renderTopTables(); renderSectorBars();
    renderSectorTable(); renderGross(); renderRecon(); renderTabs();
    renderBoard(); renderUnscored();
    document.getElementById('symSearch').addEventListener('input', function (e) {
      state.q = e.target.value; renderBoard();
    });
  }

  fetch(DATA_URL, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) { PAYLOAD = p; renderAll(); })
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="10" class="ct-loading">The board could not be loaded (' +
        esc(e.message) + ').</td></tr>';
    });
})();

