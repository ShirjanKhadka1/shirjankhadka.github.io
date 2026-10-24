/* Smart-Money EPS — renders /data/smart-money-eps.json (+ history ledger).
   All numbers come from the payload; nothing is computed client-side
   except ordering, filtering and display formatting. Payload shape is
   nd-smart-money-eps/v1 (see tools/build-smart-money-eps.py). */
(function () {
  'use strict';
  var VT = '?v=20261024';
  var DATA = '/data/smart-money-eps.json' + VT;
  var HIST = '/data/smart-money-eps-history.json' + VT;
  var STORIES = ['rising', 'falling', 'flat', 'loss-making', 'new', 'none'];
  var STORY_LABEL = {
    'rising': 'Rising earnings', 'falling': 'Falling earnings',
    'flat': 'Flat earnings', 'loss-making': 'Loss-making',
    'new': 'New coverage', 'none': 'No EPS data'
  };
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  function money(v) {
    if (v === null || v === undefined) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e7) return s + 'Rs ' + (a / 1e7).toFixed(2) + ' crore';
    if (a >= 1e5) return s + 'Rs ' + (a / 1e5).toFixed(2) + ' lakh';
    return s + 'Rs ' + a.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function num(v, d) {
    if (v === null || v === undefined) return '—';
    return v.toLocaleString('en-IN',
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(v, d) {
    if (v === null || v === undefined) return '—';
    var s = v < 0 ? '−' : '+';
    return s + Math.abs(v).toFixed(d === undefined ? 2 : d) + '%';
  }
  function pp(v, d) {
    if (v === null || v === undefined) return '—';
    var s = v < 0 ? '−' : '+';
    return s + Math.abs(v).toFixed(d === undefined ? 2 : d) + ' pp';
  }
  function qty(v) {
    if (v === null || v === undefined) return '—';
    return v.toLocaleString('en-IN');
  }
  function storyChip(s) {
    var cls = { 'rising': 'sme-chip-rising', 'falling': 'sme-chip-falling',
      'loss-making': 'sme-chip-loss', 'flat': 'sme-chip-flat',
      'new': 'sme-chip-new', 'none': 'sme-chip-none' }[s] || 'sme-chip-none';
    return '<span class="sme-chip ' + cls + '">' +
      esc(STORY_LABEL[s] || s) + '</span>';
  }
  function statCard(n, lbl, sub) {
    return '<div class="cx-stat"><div class="num">' + n + '</div>' +
      '<div class="lbl">' + lbl + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  var P = null, HISTD = null;
  var curStory = 'all', curSector = 'all', curSort = 'conviction',
      curSearch = '', curSym = null;

  function epsDeltaCell(r) {
    if (r.eps_change_pct !== null && r.eps_change_pct !== undefined)
      return pct(r.eps_change_pct);
    if (r.eps_change_pp !== null && r.eps_change_pp !== undefined)
      return pp(r.eps_change_pp);
    return '—';
  }

  function renderMeta() {
    var m = P.market;
    $('smeSession').textContent = 'Session ' + P.asof + ' · EPS vintage ' +
      P.eps_asof + ' (' + P.eps_period + ')' +
      (P.gap_dates && P.gap_dates.length ?
        ' · flow gap: ' + P.gap_dates.join(', ') : '') + ' · FINAL';
    var risingMoney = m.stories.rising ? m.stories.rising.positive_skilled_net : 0;
    var risingShare = m.positive_skilled_net ?
      (100 * risingMoney / m.positive_skilled_net) : 0;
    var top = P.board.length ? P.board[0] : null;
    $('statStrip').innerHTML =
      statCard(m.board_symbols, 'Stocks on the board',
        'Link 12 board, same session') +
      statCard(m.eps_covered_on_board, 'With an EPS series',
        'of ' + m.board_symbols + ' board stocks') +
      statCard(money(m.positive_skilled_net), 'Positive skilled net',
        'buying side of the skilled split') +
      statCard(risingShare.toFixed(1) + '%', 'Skilled money in rising names',
        money(risingMoney) + ' of the total') +
      statCard(top ? top.symbol + ' ' + num(top.conviction_score, 2) : '—',
        'Top conviction', top ? 'EPS ' + num(top.eps_ttm, 2) + ', ' +
        STORY_LABEL[top.eps_story] : '');
    $('coverageNote').textContent =
      'EPS series from published quarterly filings, vintage ' + P.eps_asof +
      ' (' + P.eps_period + '). ' + P.unscored.length +
      ' board stocks carry no EPS series and show as unscored; their ' +
      'skilled rows are still printed in full. ' +
      (P.gap_dates && P.gap_dates.length ?
        '2026-10-07 has broker totals only, so the Link 12 board ' +
        'windows spanning it rest on the sessions the archive holds.' : '');
    var secs = {};
    P.board.forEach(function (r) { if (r.sector) secs[r.sector] = 1; });
    var sel = $('sectorSel');
    var keep = sel.value;
    sel.innerHTML = '<option value="all">All sectors</option>' +
      Object.keys(secs).sort().map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
    if (keep && secs[keep]) sel.value = keep; else curSector = 'all';
    var seg = $('storySeg');
    seg.innerHTML = '<button type="button" data-story="all" aria-pressed="' +
      (curStory === 'all') + '">All stories</button>' +
      STORIES.map(function (s) {
        return '<button type="button" data-story="' + s + '" aria-pressed="' +
          (curStory === s) + '">' + esc(STORY_LABEL[s]) +
          ' (' + m.stories[s].symbols + ')</button>';
      }).join('');
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        curStory = b.getAttribute('data-story');
        renderMeta(); renderBoard();
      });
    });
  }

  function renderStories() {
    var m = P.market;
    $('storyBody').innerHTML = STORIES.map(function (s) {
      var st = m.stories[s];
      var share = m.positive_skilled_net ?
        (100 * st.positive_skilled_net / m.positive_skilled_net) : 0;
      var mo = st.momentum_20d;
      return '<tr><td>' + storyChip(s) + '</td>' +
        '<td class="num sme-num">' + st.symbols + '</td>' +
        '<td class="num sme-num">' + money(st.positive_skilled_net) + '</td>' +
        '<td class="num sme-num">' + share.toFixed(1) + '%</td>' +
        '<td class="num sme-num">' + (mo.mean === null ? '—' :
          pct(mo.mean) + ' <span style="color:var(--nd-text-soft)">(n=' +
          mo.n + ')</span>') + '</td></tr>';
    }).join('');
  }

  function boardRows() {
    var rows = P.board.filter(function (r) {
      if (curStory !== 'all' && r.eps_story !== curStory) return false;
      if (curSector !== 'all' && r.sector !== curSector) return false;
      if (curSearch) {
        var q = curSearch.toLowerCase();
        if (r.symbol.toLowerCase().indexOf(q) < 0 &&
            (r.name || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = {
      'conviction': function (r) {
        return -(r.conviction_score === null ? -1 : r.conviction_score);
      },
      'skilled': function (r) { return -r.skilled_net_amt; },
      'epschg': function (r) {
        return -(r.eps_change_pct === null ? -1e9 : r.eps_change_pct);
      },
      'eps': function (r) {
        return -(r.eps_ttm === null ? -1e9 : r.eps_ttm);
      },
      'pe': function (r) {
        return r.pe_ttm === null ? 1e18 : r.pe_ttm;
      },
      'sym': function (r) { return r.symbol; }
    }[curSort];
    rows.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.symbol < b.symbol ? -1 : 1;
    });
    return rows;
  }

  function renderBoard() {
    var rows = boardRows();
    $('boardBody').innerHTML = rows.length ? rows.map(function (r, i) {
      return '<tr class="sme-rowclick' +
        (r.symbol === curSym ? ' sme-active' : '') +
        '" data-sym="' + esc(r.symbol) + '">' +
        '<td class="num sme-num">' + (i + 1) + '</td>' +
        '<td><strong>' + esc(r.symbol) + '</strong><br><span style="color:var(--nd-text-soft);font-size:12px">' +
        esc(r.name || '') + '</span></td>' +
        '<td>' + esc(r.sector || '—') + '</td>' +
        '<td class="num sme-num">' + num(r.conviction_score, 2) + '</td>' +
        '<td>' + esc(r.tier) + '</td>' +
        '<td class="num sme-num">' + money(r.skilled_net_amt) + '</td>' +
        '<td class="num sme-num">' + num(r.broker_quality, 2) + '</td>' +
        '<td class="num sme-num">' + num(r.eps_ttm, 2) + '</td>' +
        '<td class="num sme-num">' + epsDeltaCell(r) + '</td>' +
        '<td class="num sme-num">' + num(r.pe_ttm, 2) + '</td>' +
        '<td>' + storyChip(r.eps_story) + '</td></tr>';
    }).join('') :
      '<tr><td colspan="12" class="sme-loading">No stocks match this filter.</td></tr>';
    $('boardBody').querySelectorAll('tr[data-sym]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        selectSym(tr.getAttribute('data-sym'));
      });
    });
    $('boardCount').textContent = rows.length + ' of ' + P.board.length +
      ' board stocks shown. Conviction is Link 12\'s ranking, unchanged; ' +
      'Watch / None rows carry no conviction score (Link 12 scores the ' +
      'positive side only) and sort last.';
  }

  function selectSym(sym) {
    curSym = sym;
    renderBoard();
    renderDetail();
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth' });
  }

  function renderDetail() {
    var r = null;
    P.board.forEach(function (b) { if (b.symbol === curSym) r = b; });
    if (!r) return;
    var sel = $('symSel');
    if (!sel.options.length) {
      sel.innerHTML = P.board.map(function (b) {
        return '<option value="' + esc(b.symbol) + '">' + esc(b.symbol) +
          ' — ' + esc(b.name || '') + '</option>';
      }).join('');
    }
    sel.value = curSym;
    $('detailHead').textContent = r.symbol + ' — ' + (r.name || '') +
      ' · ' + (r.sector || '') + ' · ' + r.tier;
    $('detailStats').innerHTML =
      statCard(num(r.conviction_score, 2), 'Conviction',
        r.tier + (r.conviction_rank ? ', rank ' + r.conviction_rank : '')) +
      statCard(money(r.skilled_net_amt), 'Skilled net, 30 days',
        'quality ' + num(r.broker_quality, 2) + ' · ' +
        (r.n_skilled_brokers === null ? '—' : r.n_skilled_brokers) +
        ' skilled backers') +
      statCard(num(r.eps_ttm, 2), 'EPS (TTM)',
        r.eps_latest_quarter ? r.eps_latest_quarter +
        (r.eps_quarters ? ' · ' + r.eps_quarters + ' quarters on file' : '')
        : 'no EPS series') +
      statCard(epsDeltaCell(r), 'EPS change, year on year',
        r.eps_prev_year === null ? '' : 'year ago ' + num(r.eps_prev_year, 2)) +
      statCard(num(r.pe_ttm, 2), 'P/E (TTM)',
        r.price_momentum_20d === null ? '' :
        '20-session momentum ' + pct(r.price_momentum_20d));
    var series = (r.eps_series || []).slice().reverse();
    $('epsBody').innerHTML = series.length ? series.map(function (q) {
      return '<tr><td>' + esc(q.q) + '</td>' +
        '<td class="num sme-num">' + num(q.eps_ttm, 2) + '</td>' +
        '<td class="num sme-num">' + num(q.eps_ann, 2) + '</td>' +
        '<td class="num sme-num">' + num(q.pe_ttm, 2) + '</td>' +
        '<td class="num sme-num">' + (q.netprofit_cr === null ? '—' :
          'Rs ' + num(q.netprofit_cr, 2) + ' crore') + '</td></tr>';
    }).join('') :
      '<tr><td colspan="5" class="sme-loading">No EPS series on file for this stock.</td></tr>';
    var acc = r.top_accumulators || [];
    $('accBody').innerHTML = acc.length ? acc.map(function (a) {
      return '<tr><td><strong>' + esc(a.broker) + '</strong> ' +
        esc(a.name || '') + '</td>' +
        '<td class="num sme-num">' + qty(a.net_qty) + '</td>' +
        '<td class="num sme-num">' + money(a.net_amt) + '</td>' +
        '<td class="num sme-num">' + num(a.skill_board, 3) + '</td>' +
        '<td>' + (a.in_cohort ?
          '<span class="sme-cohort">Skilled cohort</span>' : '—') + '</td></tr>';
    }).join('') :
      '<tr><td colspan="5" class="sme-loading">No accumulator detail published for this stock.</td></tr>';
    var reading;
    if (r.eps_story === 'none')
      reading = r.symbol + ' carries no EPS series, so it is unscored on ' +
        'earnings — its skilled row is printed in full, but no story is claimed.';
    else if (r.eps_story === 'new')
      reading = r.symbol + ' has a latest TTM EPS of ' + num(r.eps_ttm, 2) +
        ' but no year-ago quarter yet, so no trend is claimed.';
    else
      reading = r.symbol + ' — ' + STORY_LABEL[r.eps_story] + ': TTM EPS ' +
        num(r.eps_ttm, 2) + ' against ' + num(r.eps_prev_year, 2) +
        ' a year earlier (' + epsDeltaCell(r) + '). Skilled net over the ' +
        'trailing 30 days is ' + money(r.skilled_net_amt) + '.';
    $('detailNote').textContent = reading;
  }

  function renderDivergence() {
    $('divBody').innerHTML = P.divergence.map(function (d) {
      return '<tr class="sme-rowclick" data-sym="' + esc(d.symbol) + '">' +
        '<td><strong>' + esc(d.symbol) + '</strong><br><span style="color:var(--nd-text-soft);font-size:12px">' +
        esc(d.name || '') + '</span></td>' +
        '<td>' + esc(d.sector || '—') + '</td>' +
        '<td>' + storyChip(d.eps_story) + '</td>' +
        '<td class="num sme-num">' + num(d.eps_ttm, 2) + '</td>' +
        '<td class="num sme-num">' + num(d.eps_prev_year, 2) + '</td>' +
        '<td class="num sme-num">' + (d.eps_change_pct === null ? '—' :
          pct(d.eps_change_pct)) + '</td>' +
        '<td class="num sme-num">' + money(d.skilled_net_amt) + '</td>' +
        '<td class="num sme-num">' + num(d.conviction_score, 2) + '</td>' +
        '<td>' + esc(d.lead_pusher || '—') +
        (d.lead_pusher_name ? ' ' + esc(d.lead_pusher_name) : '') + '</td></tr>';
    }).join('');
    $('divBody').querySelectorAll('tr[data-sym]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        selectSym(tr.getAttribute('data-sym'));
      });
    });
  }

  function renderForward() {
    var f = P.forward_by_eps;
    $('forwardSub').textContent = 'Walk-forward cohorts of skilled ' +
      'brokers, scored on the 10 sessions after each weekly snapshot ' +
      '(excess vs the average stock). ' + f.scored_snapshots.length +
      ' snapshots scored, ' + f.pooled_skilled.n + ' skilled events, ' +
      f.excluded_no_eps_events + ' events excluded for no usable EPS ' +
      'story at the snapshot.';
    var order = ['rising', 'falling', 'flat', 'loss-making'];
    $('forwardBody').innerHTML = order.map(function (s) {
      var g = f.groups[s];
      return '<tr><td>' + storyChip(s) + '</td>' +
        '<td class="num sme-num">' + g.n + '</td>' +
        '<td class="num sme-num">' + pp(g.mean_excess_pp) + '</td>' +
        '<td class="num sme-num">' + pp(g.median_excess_pp) + '</td>' +
        '<td class="num sme-num">' + (g.share_up_pct === null ? '—' :
          g.share_up_pct.toFixed(1) + '%') + '</td></tr>';
    }).join('') + '<tr><td><strong>All skilled events</strong></td>' +
      '<td class="num sme-num"><strong>' + f.pooled_skilled.n + '</strong></td>' +
      '<td class="num sme-num"><strong>' + pp(f.pooled_skilled.mean_excess_pp) + '</strong></td>' +
      '<td class="num sme-num"><strong>' + pp(f.pooled_skilled.median_excess_pp) + '</strong></td>' +
      '<td class="num sme-num"><strong>' + (f.pooled_skilled.share_up_pct === null ? '—' :
        f.pooled_skilled.share_up_pct.toFixed(1) + '%') + '</strong></td></tr>';
    $('forwardNote').textContent = 'Rising minus falling: ' +
      pp(f.spread_rising_minus_falling_pp) + '. Read plainly: in this ' +
      'short Aug–Oct 2026 era, skilled accumulation into earnings-rising ' +
      'names beat the average stock by ' +
      pp(f.groups.rising.mean_excess_pp) + ' on average over the next 10 ' +
      'sessions, while skilled accumulation into earnings-falling names ' +
      'was flat (' + pp(f.groups.falling.mean_excess_pp) + '). ' +
      'Overlapping weekly snapshots, a single market regime — ' +
      'descriptive, not a forecast. The flat group has only ' +
      f.groups.flat.n + ' events and is not interpreted.';
  }

  function renderHistory() {
    var rows = (HISTD.entries || []).slice().reverse();
    $('historyBody').innerHTML = rows.length ? rows.map(function (e) {
      return '<tr><td>' + esc(e.asof) + '</td>' +
        '<td class="num sme-num">' + e.board_symbols + '</td>' +
        '<td class="num sme-num">' + e.eps_covered_on_board + '</td>' +
        '<td class="num sme-num">' + (e.stories.rising || 0) + '</td>' +
        '<td class="num sme-num">' + (e.stories.falling || 0) + '</td>' +
        '<td>' + esc(e.top_conviction || '—') + ' ' +
        num(e.top_conviction_score, 2) + '</td>' +
        '<td class="num sme-num">' +
        pp(e.forward_spread_rising_minus_falling_pp) + '</td></tr>';
    }).join('') :
      '<tr><td colspan="7" class="sme-loading">No sessions published yet.</td></tr>';
  }

  function renderMethod() {
    var m = P.method;
    $('methodBox').innerHTML =
      '<p><strong>Board.</strong> ' + esc(m.board) + '</p>' +
      '<p><strong>EPS story.</strong> ' + esc(m.eps_story) + '</p>' +
      '<p><strong>Filing lag.</strong> ' + esc(m.filing_lag) + '</p>' +
      '<p><strong>Skilled.</strong> ' + esc(m.skilled) + '</p>' +
      '<p><strong>Forward replay.</strong> ' + esc(m.forward) + '</p>' +
      '<p><strong>Coverage.</strong> ' + esc(m.coverage) + '</p>' +
      '<p><strong>Gaps.</strong> ' + esc(m.gaps) + '</p>' +
      '<p><strong>Source.</strong> ' + esc(P.source) + ' Net profit in ' +
      'the EPS table is shown in Rs crore (the archive stores NPR ' +
      'thousands).</p>';
    $('unscoredText').textContent = P.unscored.length +
      ' board stocks carry no EPS series and are unscored on earnings: ' +
      P.unscored.join(', ') + '.';
    $('notOnBoardText').textContent =
      P.eps_covered_not_on_board.length + ' EPS-covered symbols have no ' +
      'row on this board: ' +
      P.eps_covered_not_on_board.map(function (x) {
        return x.symbol + ' (' + x.note + ')';
      }).join('; ') + '.';
  }

  function init() {
    Promise.all([
      fetch(DATA).then(function (r) { return r.json(); }),
      fetch(HIST).then(function (r) { return r.json(); })
        .catch(function () { return { entries: [] }; })
    ]).then(function (res) {
      P = res[0]; HISTD = res[1];
      curSym = P.board.length ? P.board[0].symbol : null;
      renderMeta(); renderStories(); renderBoard(); renderDetail();
      renderDivergence(); renderForward(); renderHistory(); renderMethod();
    }).catch(function () {
      $('boardBody').innerHTML = '<tr><td colspan="12" class="sme-loading">' +
        'Board data could not be loaded. Please refresh.</td></tr>';
    });
    $('sectorSel').addEventListener('change', function () {
      curSector = this.value; renderBoard();
    });
    $('sortSel').addEventListener('change', function () {
      curSort = this.value; renderBoard();
    });
    $('symSearch').addEventListener('input', function () {
      curSearch = this.value.trim(); renderBoard();
    });
    $('symSel').addEventListener('change', function () {
      curSym = this.value; renderBoard(); renderDetail();
    });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
