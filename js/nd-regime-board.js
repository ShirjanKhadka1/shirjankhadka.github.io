/* Market Regime board (teardown Link 3) — 13-index regime board with
   measured forecast reliability + turn-risk, from /data/market-regime.json.
   The legacy NEPSE hero/timeline above is rendered by nd-regime.js and is
   intentionally untouched; this file only fills the board sections. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    var v = x * 100;
    return (v >= 0 ? '+' : '') + v.toFixed(digits == null ? 1 : digits) + '%';
  }
  function spct(x) { // already a percent value, signed
    if (x == null || !isFinite(x)) return '—';
    return (x >= 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  }
  function chip(state) {
    return '<span class="rgb-chip ' + state.toLowerCase() + '">' + state + '</span>';
  }

  function renderBoard(d) {
    var note = $('rgbNote');
    if (note) {
      note.textContent = 'As of ' + d.asof + ' · ' + d.counts.BULL + ' bull · ' +
        d.counts.BEAR + ' bear · ' + d.counts.RANGE + ' range · ' +
        d.counts.pending_flip + ' flip pending. Sector rows are derived ' +
        'equal-weight composites of their stocks (not official sub-indices); ' +
        'the NEPSE row is the official index.';
    }
    var tb = $('rgbTableBody');
    if (!tb) return;
    var html = '';
    d.indexes.forEach(function (r) {
      html += '<tr' + (r.early_warning ? ' class="rgb-warn-row"' : '') + '>' +
        '<td class="rgb-idx">' + esc(r.index_name) +
          (r.index_type === 'composite' ? ' <span class="rgb-derived">derived</span>' : '') +
          (r.index_type === 'sector' ? ' <span class="rgb-derived">derived</span>' : '') + '</td>' +
        '<td>' + chip(r.regime) +
          (r.pending_flip ? ' <span class="rgb-pend">flip pending</span>' : '') + '</td>' +
        '<td class="rgb-num">' + r.days_in_regime + (r.days_in_regime === 1 ? ' session' : ' sessions') + '<br><span class="rgb-sub">since ' + esc(r.regime_started_date) + '</span></td>' +
        '<td class="rgb-num">' + spct(r.gap_vs_sma200_pct) + '</td>' +
        '<td class="rgb-num">' + spct(r.sma200_slope_20d_pct) + '</td>' +
        '<td class="rgb-num">' + (r.breadth_above_sma50 == null ? '—' : (r.breadth_above_sma50 * 100).toFixed(1) + '%') + '</td>' +
        '<td>' + (r.confidence_tier ? '<span class="rgb-tier ' + r.confidence_tier.toLowerCase() + '">' + r.confidence_tier + '</span>' : '<span class="rgb-sub">thin index</span>') + '</td>' +
        '<td class="rgb-num">' + (r.turn_risk == null ? '—' : (r.turn_risk * 100).toFixed(1) + '%') +
          (r.early_warning ? ' <span class="rgb-warn">⚠ early warning</span>' : '') + '</td>' +
        '<td class="rgb-num">' + (r.turn_risk_pctl == null ? '<span class="rgb-sub">base rate</span>' : r.turn_risk_pctl.toFixed(0) + 'th') + '</td>' +
        '</tr>';
    });
    tb.innerHTML = html;
  }

  function renderReliability(d) {
    var warn = $('rgbWarnLine');
    if (warn) {
      var names = d.indexes.filter(function (r) { return r.early_warning; })
        .map(function (r) { return r.index_name; });
      warn.innerHTML = '<strong>' + d.counts.early_warning + ' of 13 indices are flagged ' +
        'early-warning today.</strong>' +
        (names.length ? ' Flagged: ' + esc(names.join(', ')) +
          ' — their measured turn-risk sits in the top tenth of their own history.' :
          ' No index\'s measured turn-risk is in the top tenth of its own history.') +
        ' Turn-risk = the measured probability that the confirmed regime no longer ' +
        'holds 10 sessions from now.';
    }
    var tb = $('rgbRelTableBody');
    if (!tb) return;
    var html = '';
    d.indexes.forEach(function (r) {
      var fc = r.forecast_confidence || {};
      function cell(h) {
        var v = fc[h];
        return v == null ? '—' : (v * 100).toFixed(1) + '%';
      }
      html += '<tr>' +
        '<td class="rgb-idx">' + esc(r.index_name) + '</td>' +
        '<td>' + chip(r.regime) + '</td>' +
        '<td class="rgb-num">' + cell('1') + '</td>' +
        '<td class="rgb-num">' + cell('5') + '</td>' +
        '<td class="rgb-num">' + cell('10') + '</td>' +
        '<td class="rgb-num">' + cell('20') + '</td>' +
        '<td class="rgb-num">' + r.n_hist + '</td>' +
        '<td class="rgb-num">' + (r.reliability && r.reliability.n_sessions != null ? r.reliability.n_sessions.toLocaleString('en-IN') : '—') + '</td>' +
        '</tr>';
    });
    tb.innerHTML = html;
  }

  fetch('/data/market-regime.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('no-data'); return r.json(); })
    .then(function (d) { renderBoard(d); renderReliability(d); })
    .catch(function () {
      var note = $('rgbNote');
      if (note) note.textContent = 'Regime board data is not available yet.';
    });
})();
