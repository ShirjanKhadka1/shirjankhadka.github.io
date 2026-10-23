/* Sector Strength — renders data/sector-strength.json (nd-sector-strength/v1).
   Static file, no framework; all numbers printed beside every visual. */
(function () {
  'use strict';
  var DATA_URL = '/data/sector-strength.json?v=20261023a';
  var state = { win: '90' };
  var PAYLOAD = null;
  var PHASES = ['Leading', 'Improving', 'Weakening', 'Lagging'];
  var PHASE_FILL = { Leading: 'var(--nd-up)', Improving: 'var(--nd-info)',
                     Weakening: 'var(--nd-flat)', Lagging: 'var(--nd-down)' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(x) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  }
  function pp(x) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + Number(x).toFixed(2) + ' pp';
  }
  function num(x) {
    if (x == null || isNaN(x)) return '—';
    return Number(x).toFixed(2);
  }
  function cls(x) { return x > 0 ? 'st-pos' : (x < 0 ? 'st-neg' : ''); }
  function rows() { return PAYLOAD.rows; }
  function bySector(name) {
    var r = rows().filter(function (x) { return x.sector === name; });
    return r.length ? r[0] : null;
  }

  function renderStats() {
    var rs = rows();
    var top = rs[0];
    var leading = rs.filter(function (x) { return x.trend_phase === 'Leading'; }).length;
    var improving = rs.filter(function (x) { return x.trend_phase === 'Improving'; }).length;
    var mean = rs.reduce(function (a, x) { return a + x.overall_score; }, 0) / rs.length;
    var stats = [
      { k: 'Strongest sector', v: esc(top.sector), s: 'overall ' + num(top.overall_score) + ' of 100 · ' + esc(top.trend_phase) },
      { k: 'Leading + Improving', v: leading + improving + ' of ' + rs.length, s: leading + ' Leading · ' + improving + ' Improving' },
      { k: 'Mean overall score', v: num(mean), s: 'the board average across all 11 sectors' },
      { k: 'NEPSE · 90 days', v: pct(PAYLOAD.nepse_returns['90d']), s: 'the benchmark every relative strength is measured against' }
    ];
    document.getElementById('statStrip').innerHTML = stats.map(function (x) {
      return '<div class="cx-stat"><p class="cx-stat-k">' + x.k +
        '</p><p class="cx-stat-v">' + x.v +
        '</p><p class="cx-stat-s">' + x.s + '</p></div>';
    }).join('');
  }

  function renderTabs() {
    document.getElementById('winTabs').innerHTML = PAYLOAD.windows.map(function (d) {
      return '<button type="button" role="tab" data-win="' + d + '"' +
        (String(d) === state.win ? ' class="on"' : '') + '>' + d + 'D</button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#winTabs button'), function (btn) {
        btn.addEventListener('click', function () {
          state.win = btn.getAttribute('data-win'); renderWindow();
        });
      });
  }

  function renderBoard() {
    var w = state.win + 'd';
    document.getElementById('thStrength').textContent = 'Strength · ' + state.win + 'd';
    document.getElementById('thRs').textContent = 'Rel. strength · ' + state.win + 'd';
    document.getElementById('thRet').textContent = 'Return · ' + state.win + 'd';
    document.getElementById('thLabel').textContent = 'Momentum · ' + state.win + 'd';
    document.getElementById('boardBody').innerHTML = rows().map(function (x) {
      var rc = x.rank_change_1w;
      var rcTxt = rc == null ? '—' : (rc > 0 ? '▲ ' + rc : (rc < 0 ? '▼ ' + (-rc) : '— 0'));
      var rcCls = rc > 0 ? 'st-pos' : (rc < 0 ? 'st-neg' : '');
      return '<tr>' +
        '<td class="st-sector">' + esc(x.sector) + '</td>' +
        '<td><span class="cx-chip st-phase st-phase-' + esc(x.trend_phase.toLowerCase()) + '">' +
          esc(x.trend_phase) + '</span></td>' +
        '<td class="num st-overallcell"><span class="st-overalltext">' + num(x.overall_score) +
          '</span><span class="st-overallbar"><span class="st-overallfill" style="width:' +
          Math.max(0, Math.min(100, x.overall_score)) + '%"></span></span></td>' +
        '<td class="num ' + rcCls + '">' + rcTxt + '</td>' +
        '<td class="num">' + num(x.strength_scores[w]) + '</td>' +
        '<td class="num ' + cls(x.relative_strength[w]) + '">' + pp(x.relative_strength[w]) + '</td>' +
        '<td class="num ' + cls(x.returns[w]) + '">' + pct(x.returns[w]) + '</td>' +
        '<td>' + esc(x.momentum_labels[w]) + '</td>' +
        '<td class="num">' + num(x.volatility_long) + '</td>' +
        '<td class="num">' + num(x.risk_score) + ' · ' + esc(x.risk_level) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderPhaseMix() {
    var counts = PAYLOAD.phase_counts || {};
    var total = rows().length;
    var present = PHASES.filter(function (p) { return counts[p] > 0; });
    var bar = present.map(function (p) {
      return '<span class="st-dist-seg" style="display:block;width:' +
        (100 * counts[p] / total) + '%;background:' + PHASE_FILL[p] + '"></span>';
    }).join('');
    var legend = present.map(function (p) {
      return '<span><span class="st-dot" style="background:' + PHASE_FILL[p] +
        '"></span>' + esc(p) + ' <b>' + counts[p] + '</b></span>';
    }).join('');
    document.getElementById('phaseBox').innerHTML =
      '<div class="st-dist-bar" role="img" aria-label="Phase mix: ' +
      esc(present.map(function (p) { return p + ' ' + counts[p]; }).join(', ')) + '">' +
      bar + '</div><div class="st-dist-legend">' + legend + '</div>';
  }

  function renderRs() {
    var w = state.win + 'd';
    var sorted = rows().slice().sort(function (a, b) {
      return b.relative_strength[w] - a.relative_strength[w];
    });
    var max = Math.max.apply(null, sorted.map(function (x) {
      return Math.abs(x.relative_strength[w]);
    }).concat([0.01]));
    document.getElementById('rsList').innerHTML = sorted.map(function (x, i) {
      var v = x.relative_strength[w];
      return '<li class="cx-rank-row"><span class="cx-rank-n">' + (i + 1) +
        '</span><span class="cx-rank-sym">' + esc(x.sector) +
        '</span><span class="cx-rank-val ' + cls(v) + '">' + pp(v) +
        '</span><span class="cx-rank-track"><span class="cx-rank-fill' +
        (v < 0 ? ' down' : ' up') + '" style="width:' +
        Math.round(100 * Math.abs(v) / max) + '%"></span></span></li>';
    }).join('');
  }

  function renderPersist() {
    var st = PAYLOAD.persistence;
    var el = document.getElementById('persistStrip');
    if (!st) { el.innerHTML = ''; return; }
    var stats = [
      { k: 'Snapshots replayed', v: String(st.snapshots), s: 'weekly boards · trailing 3 years' },
      { k: 'Rank correlation · 4 wks later', v: num(st.overall_rank_rho), s: 'Spearman ρ of the overall ranking, snapshot vs +28 days' },
      { k: 'Leader still top-3 · 4 wks', v: st.leader_still_top3_pct + '%', s: 'share of snapshots whose #1 sector was still top-3 a month later' }
    ];
    el.innerHTML = stats.map(function (x) {
      return '<div class="cx-stat"><p class="cx-stat-k">' + esc(x.k) +
        '</p><p class="cx-stat-v">' + esc(x.v) +
        '</p><p class="cx-stat-s">' + esc(x.s) + '</p></div>';
    }).join('');
  }

  function renderReadings() {
    document.getElementById('readings').innerHTML = rows().map(function (x) {
      return '<div class="st-reading"><h3>' + esc(x.sector) + ' · #' + x.rank +
        ' · ' + esc(x.trend_phase) + '</h3><p>' + esc(x.comment) + '</p></div>';
    }).join('');
  }

  function renderWindow() { renderBoard(); renderRs(); }

  function renderAll() {
    document.getElementById('stSession').textContent =
      'Session ' + PAYLOAD.asof + ' · ' + PAYLOAD.universe.sectors + ' sectors · ' +
      PAYLOAD.universe.constituents + ' constituent stocks · NEPSE returns: ' +
      PAYLOAD.windows.map(function (d) {
        return d + 'd ' + pct(PAYLOAD.nepse_returns[d + 'd']);
      }).join(' · ');
    document.getElementById('nepseLine').textContent =
      PAYLOAD.windows.map(function (d) {
        return d + '-day ' + pct(PAYLOAD.nepse_returns[d + 'd']);
      }).join(', ');
    renderStats(); renderTabs(); renderBoard(); renderPhaseMix();
    renderRs(); renderPersist(); renderReadings();
  }

  fetch(DATA_URL, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) { PAYLOAD = p; renderAll(); })
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="10" class="st-loading">The board could not be loaded (' +
        esc(e.message) + ').</td></tr>';
    });
})();
