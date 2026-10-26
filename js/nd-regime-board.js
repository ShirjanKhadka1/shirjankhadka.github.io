/* Market Regime board (teardown Link 3, cinematic rebuild 2026-10-26) —
   13-index regime board with measured forecast reliability + turn-risk,
   from /data/market-regime.json, plus the sector-stocks panel and the
   calls-ledger section. The hero gauge is MEASURED: it plots the NEPSE
   row's confirmed gap vs its 200-day average on a -10%..+10% scale,
   with the +/-2% band edges marked — no invented score mapping.
   Fetches are cache:'no-store' (the board is EOD data, published once
   per session), and the board + ledger re-fetch on the same
   market-aware interval as the legacy hero so an open page picks up
   the post-close publish without a reload. */
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
    return '<span class="rgb-chip ' + String(state).toLowerCase() + '">' + state + '</span>';
  }
  function minibar(frac) {
    if (frac == null || !isFinite(frac)) return '';
    var w = Math.max(0, Math.min(100, frac * 100));
    return '<div class="rgb-minibar"><i style="width:' + w.toFixed(1) + '%"></i></div>';
  }
  function fmtLevel(v) {
    return v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  /* ---- measured gauge: gap on a -10%..+10% semicircle ---- */
  function gapXY(gap) {
    var g = Math.max(-10, Math.min(10, gap == null || !isFinite(gap) ? 0 : gap));
    var th = (180 - ((g + 10) / 20) * 180) * Math.PI / 180;
    return { x: 100 + 85 * Math.cos(th), y: 105 - 85 * Math.sin(th), th: th };
  }
  function bandPoint(gap, r) {
    var th = (180 - ((gap + 10) / 20) * 180) * Math.PI / 180;
    return { x: 100 + r * Math.cos(th), y: 105 - r * Math.sin(th) };
  }
  function setLine(el, p1, p2) {
    if (!el) return;
    el.setAttribute('x1', p1.x.toFixed(1)); el.setAttribute('y1', p1.y.toFixed(1));
    el.setAttribute('x2', p2.x.toFixed(1)); el.setAttribute('y2', p2.y.toFixed(1));
  }
  function setText(el, p, txt) {
    if (!el) return;
    el.setAttribute('x', p.x.toFixed(1)); el.setAttribute('y', p.y.toFixed(1));
    el.textContent = txt;
  }

  var STATE_NAME = { BULL: 'Bull', BEAR: 'Bear', RANGE: 'Range' };

  function renderHero(d) {
    var nepse = null;
    d.indexes.forEach(function (r) { if (r.index_name === 'NEPSE') nepse = r; });
    if (!nepse) return;
    var gap = nepse.gap_vs_sma200_pct;
    var m = $('rgGaugeMarker'), label = $('rgGaugeLabel');
    var p = gapXY(gap);
    if (m) { m.setAttribute('cx', p.x.toFixed(1)); m.setAttribute('cy', p.y.toFixed(1)); }
    if (label) label.textContent = gap == null ? '—' : spct(gap);
    setLine($('rgGaugeTickNeg'), bandPoint(-2, 76), bandPoint(-2, 94));
    setLine($('rgGaugeTickPos'), bandPoint(2, 76), bandPoint(2, 94));
    setText($('rgGaugeBandNeg'), bandPoint(-2, 102), '−2%');
    setText($('rgGaugeBandPos'), bandPoint(2, 102), '+2%');
    var nm = $('rgRegimeName');
    if (nm) {
      nm.textContent = (STATE_NAME[nepse.regime] || nepse.regime) +
        ' — confirmed, ' + nepse.days_in_regime + ' session' + (nepse.days_in_regime === 1 ? '' : 's');
      nm.className = 'rg-regime-name ' + nepse.regime.toLowerCase();
    }
    var ds = $('rgRegimeDesc');
    if (ds) {
      var above = '';
      if (nepse.constituents) {
        var judged = nepse.constituents.filter(function (c) { return c.above_sma50 != null; });
        var up = judged.filter(function (c) { return c.above_sma50; }).length;
        above = ' · ' + up + ' of ' + judged.length + ' judged stocks above their 50-day average';
      } else if (nepse.breadth_above_sma50 != null) {
        above = ' · breadth ' + (nepse.breadth_above_sma50 * 100).toFixed(1) + '%';
      }
      ds.textContent = 'NEPSE ' + fmtLevel(nepse.level) + ' sits ' + spct(gap) +
        ' from its 200-day average, in ' + nepse.regime + ' since ' + nepse.regime_started_date +
        ' · trust ' + (nepse.confidence_tier || 'withheld') +
        ' · turn-risk ' + (nepse.turn_risk == null ? '—' : (nepse.turn_risk * 100).toFixed(1) + '%') +
        (nepse.turn_risk_pctl == null ? ' (base rate)' : ' (' + nepse.turn_risk_pctl.toFixed(0) + 'th percentile)') + above + '.';
    }
    var sess = $('rgSession');
    if (sess) {
      sess.textContent = 'NEPSE ' + fmtLevel(nepse.level) + ' · session ' + d.asof +
        ' · FINAL · Source: Nepse Decode archive (index history + sector composites + breadth)';
    }
  }

  /* ---- board ---- */
  function renderBoard(d) {
    var note = $('rgbNote');
    if (note) {
      note.textContent = 'As of ' + d.asof + ' · ' + d.counts.BULL + ' bull · ' +
        d.counts.BEAR + ' bear · ' + d.counts.RANGE + ' range · ' +
        d.counts.pending_flip + ' flip pending. Sector rows are derived ' +
        'equal-weight composites of their stocks (not official sub-indices); ' +
        'the NEPSE row is the official index. Tap an index name to see its stocks.';
    }
    var tb = $('rgbTableBody');
    if (!tb) return;
    var html = '';
    d.indexes.forEach(function (r) {
      var pend = r.pending_flip
        ? ' <span class="rgb-pend">flip pending → ' + esc(r.raw_state) + '</span>' : '';
      var br = r.breadth_above_sma50 == null ? '—'
        : (r.breadth_above_sma50 * 100).toFixed(1) + '%';
      var brSub = r.breadth_n != null ? '<br><span class="rgb-sub">n = ' + r.breadth_n + ' judged</span>' : '';
      var turn = r.turn_risk == null ? '—' : (r.turn_risk * 100).toFixed(1) + '%';
      var turnSub = (r.turn_risk_model === 'base-rate' && r.turn_risk_base_rate != null)
        ? '<br><span class="rgb-sub">base rate ' + (r.turn_risk_base_rate * 100).toFixed(1) + '%</span>' : '';
      html += '<tr' + (r.early_warning ? ' class="rgb-warn-row"' : '') + '>' +
        '<td class="rgb-idx"><button type="button" class="rgb-idxbtn" data-index="' + esc(r.index_name) + '" aria-pressed="' + (r.index_name === state.index ? 'true' : 'false') + '">' + esc(r.index_name) + '</button>' +
          (r.index_type !== 'index' ? ' <span class="rgb-derived">derived</span>' : '') + '</td>' +
        '<td class="rgb-num">' + fmtLevel(r.level) + '</td>' +
        '<td>' + chip(r.regime) + pend + '</td>' +
        '<td class="rgb-num">' + r.days_in_regime + (r.days_in_regime === 1 ? ' session' : ' sessions') + '<br><span class="rgb-sub">since ' + esc(r.regime_started_date) + '</span></td>' +
        '<td class="rgb-num">' + spct(r.gap_vs_sma200_pct) + '</td>' +
        '<td class="rgb-num">' + spct(r.sma200_slope_20d_pct) + '</td>' +
        '<td class="rgb-num">' + br + brSub + '</td>' +
        '<td>' + (r.confidence_tier ? '<span class="rgb-tier ' + r.confidence_tier.toLowerCase() + '">' + r.confidence_tier + '</span>' : '<span class="rgb-sub">thin index</span>') + '</td>' +
        '<td class="rgb-num">' + turn + minibar(r.turn_risk) +
          (r.early_warning ? ' <span class="rgb-warn">⚠ early warning</span>' : '') + turnSub + '</td>' +
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
      var fwd10 = (r.reliability && r.reliability.horizons && r.reliability.horizons['10'])
        ? r.reliability.horizons['10'].mean_fwd_ret_pct : null;
      var fwdSub = fwd10 == null ? ''
        : '<br><span class="rgb-sub">' + (fwd10 >= 0 ? '+' : '') + Number(fwd10).toFixed(2) + '% mean fwd</span>';
      html += '<tr>' +
        '<td class="rgb-idx">' + esc(r.index_name) + '</td>' +
        '<td>' + chip(r.regime) + '</td>' +
        '<td class="rgb-num">' + cell('1') + '</td>' +
        '<td class="rgb-num">' + cell('5') + '</td>' +
        '<td class="rgb-num">' + cell('10') + minibar(fc['10']) + fwdSub + '</td>' +
        '<td class="rgb-num">' + cell('20') + '</td>' +
        '<td class="rgb-num">' + r.n_hist + '</td>' +
        '<td class="rgb-num">' + (r.reliability && r.reliability.n_sessions != null ? r.reliability.n_sessions.toLocaleString('en-IN') : '—') + '</td>' +
        '</tr>';
    });
    tb.innerHTML = html;
  }

  function renderValidation(d) {
    var el = $('rgbValidLine');
    if (!el) return;
    var v = d.validation && d.validation.turn_risk_heldout;
    if (!v) { el.textContent = ''; return; }
    el.innerHTML = '<strong>Held-out validation.</strong> Turn-risk bins fit on the first 60% of sessions and scored on the last 40%: ' +
      'conditional Brier ' + Number(v.brier_conditional).toFixed(4) + ' vs base-rate Brier ' + Number(v.brier_base_rate).toFixed(4) +
      ', n = ' + Number(v.n_test).toLocaleString('en-IN') + ' sessions. Indexes whose conditional model does not beat their base rate publish the base rate instead (labelled “base rate” above).';
  }

  /* ---- sector-stocks panel ---- */
  var state = { index: 'NEPSE', filter: 'all', page: 1, asof: null };
  var PAGE_SIZE = 25;

  function consCounts(cons) {
    var above = 0, below = 0, na = 0;
    cons.forEach(function (c) {
      if (c.above_sma50 === true) above++;
      else if (c.above_sma50 === false) below++;
      else na++;
    });
    return { above: above, below: below, na: na, total: cons.length };
  }

  function renderConsPanel(d) {
    var row = null;
    d.indexes.forEach(function (r) { if (r.index_name === state.index) row = r; });
    if (!row) { row = d.indexes[0]; state.index = row.index_name; }
    var note = $('rgConsNote'), list = $('rgConsList');
    if (!note || !list) return;
    // keep board buttons in sync
    document.querySelectorAll('.rgb-idxbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-index') === state.index ? 'true' : 'false');
    });
    var cons = row.constituents || null;
    var head = esc(row.index_name) + ' ' + chip(row.regime) +
      ' · level ' + fmtLevel(row.level) + ' · gap ' + spct(row.gap_vs_sma200_pct) +
      ' · breadth ' + (row.breadth_above_sma50 == null ? '—' : (row.breadth_above_sma50 * 100).toFixed(1) + '%');
    if (!cons) {
      note.innerHTML = head + '.';
      list.innerHTML = '<p class="rg-note">The full stock list for this index arrives with the next daily build (Mon–Fri after close) — this board was published before the constituent field was added. The breadth split above already reflects every judged stock.</p>';
      var pg = $('rgConsPageInfo');
      if (pg) pg.textContent = '';
      setPagerEnabled(false);
      renderConsFilters(null);
      return;
    }
    var counts = consCounts(cons);
    note.innerHTML = head + ' · ' + counts.total + ' stocks: ' + counts.above + ' above their 50-day average, ' +
      counts.below + ' below, ' + counts.na + ' not judged.';
    renderConsFilters(counts);
    var filtered = cons.filter(function (c) {
      if (state.filter === 'above') return c.above_sma50 === true;
      if (state.filter === 'below') return c.above_sma50 === false;
      if (state.filter === 'na') return c.above_sma50 == null;
      return true;
    });
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var slice = filtered.slice(start, start + PAGE_SIZE);
    var html = slice.map(function (c) {
      var flag = c.above_sma50 === true
        ? '<span class="rgb-chip up">Above</span>'
        : c.above_sma50 === false
          ? '<span class="rgb-chip down">Below</span>'
          : '<span class="rgb-chip na">Not judged</span>';
      return '<div class="rg-cons-row"><span class="rg-cons-sym">' + esc(c.symbol) + '</span>' +
        '<span class="rg-cons-name">' + esc(c.name) + '</span>' + flag + '</div>';
    }).join('');
    list.innerHTML = html || '<p class="rg-note">No stocks in this filter.</p>';
    var info = $('rgConsPageInfo');
    if (info) {
      info.textContent = filtered.length
        ? 'Showing ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, filtered.length) + ' of ' + filtered.length
        : 'Showing 0 of 0';
    }
    setPagerEnabled(true);
    var prev = $('rgConsPrev'), next = $('rgConsNext');
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= pages;
  }

  function setPagerEnabled(on) {
    ['rgConsPrev', 'rgConsNext'].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !on;
    });
  }

  function renderConsFilters(counts) {
    var host = $('rgConsFilters');
    if (!host) return;
    var defs = [
      ['all', 'All', counts ? counts.total : null],
      ['above', 'Above SMA50', counts ? counts.above : null],
      ['below', 'Below SMA50', counts ? counts.below : null],
      ['na', 'Not judged', counts ? counts.na : null]
    ];
    host.innerHTML = defs.map(function (f) {
      var label = f[1] + (f[2] == null ? '' : ' (' + f[2] + ')');
      return '<button type="button" class="rg-pill" data-filter="' + f[0] + '" aria-pressed="' + (state.filter === f[0] ? 'true' : 'false') + '">' + label + '</button>';
    }).join('');
  }

  /* ---- ledger ---- */
  function renderLedger(calls) {
    var note = $('rgLedgerNote'), tb = $('rgLedgerBody');
    if (!note || !tb) return;
    if (!calls || !calls.length) {
      note.textContent = 'No ledger entries yet.';
      tb.innerHTML = '';
      return;
    }
    var last10 = calls.slice(-10).reverse();
    note.innerHTML = 'One entry per session, appended after the close. ' +
      'Forward accuracy of these calls accumulates as sessions mature — the first 10-session resolutions arrive 10 sessions after each call. ' +
      'Full per-index ledger: <a href="/data/regime-calls.json">data/regime-calls.json</a>.';
    tb.innerHTML = last10.map(function (e) {
      var nep = null, ew = 0;
      e.rows.forEach(function (r) {
        if (r.index === 'NEPSE') nep = r;
        if (r.early_warning) ew++;
      });
      return '<tr><td class="rgb-num">' + esc(e.date) + '</td>' +
        '<td>' + (nep ? chip(nep.state) : '—') + '</td>' +
        '<td class="rgb-num">' + (nep ? nep.age + (nep.age === 1 ? ' session' : ' sessions') : '—') + '</td>' +
        '<td class="rgb-num">' + (nep ? spct(nep.gap_vs_sma200_pct) : '—') + '</td>' +
        '<td class="rgb-num">' + (nep && nep.breadth_above_sma50 != null ? (nep.breadth_above_sma50 * 100).toFixed(1) + '%' : '—') + '</td>' +
        '<td class="rgb-num">' + ew + '</td></tr>';
    }).join('');
  }

  /* ---- load + refresh ---- */
  var lastFetch = 0;
  function load(scrollToPanel) {
    lastFetch = Date.now();
    fetch('/data/market-regime.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-data'); return r.json(); })
      .then(function (d) {
        var asofChanged = state.asof !== null && state.asof !== d.asof;
        state.asof = d.asof;
        if (asofChanged) state.page = 1;
        renderHero(d);
        renderBoard(d);
        renderReliability(d);
        renderValidation(d);
        renderConsPanel(d);
        window.__rgBoard = d;
        if (scrollToPanel) {
          var sec = $('rgConsSection');
          if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      })
      .catch(function () {
        var note = $('rgbNote');
        if (note) note.textContent = 'Regime board data is not available yet.';
        var nm = $('rgRegimeName');
        if (nm) nm.textContent = 'Data unavailable';
      });
    fetch('/data/regime-calls.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-data'); return r.json(); })
      .then(function (c) { renderLedger(c.calls); })
      .catch(function () {
        var note = $('rgLedgerNote');
        if (note) note.textContent = 'Ledger not available yet.';
      });
  }

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

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.rgb-idxbtn');
    if (btn && window.__rgBoard) {
      state.index = btn.getAttribute('data-index');
      state.filter = 'all';
      state.page = 1;
      renderConsPanel(window.__rgBoard);
      var sec = $('rgConsSection');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var pill = ev.target.closest('#rgConsFilters .rg-pill');
    if (pill && window.__rgBoard) {
      state.filter = pill.getAttribute('data-filter');
      state.page = 1;
      renderConsPanel(window.__rgBoard);
      return;
    }
    if (ev.target.closest('#rgConsPrev') && window.__rgBoard) {
      if (state.page > 1) { state.page--; renderConsPanel(window.__rgBoard); }
      return;
    }
    if (ev.target.closest('#rgConsNext') && window.__rgBoard) {
      state.page++; renderConsPanel(window.__rgBoard);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { load(false); });
  else load(false);
  setInterval(function () {
    if (document.hidden) return;
    load(false);
  }, refreshIntervalMs());
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - lastFetch > 5 * 60 * 1000) load(false);
  });
})();
