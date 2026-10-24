/* Broker Smart Money — renders /data/broker-smart-money.json + history ledger.
   All numbers come from the payload; nothing is computed client-side except
   ordering, filtering and display formatting. */
(function () {
  'use strict';
  var DATA = '/data/broker-smart-money.json?v=20261024a';
  var HIST = '/data/broker-smart-money-history.json?v=20261024a';
  var TIER_CLASS = {
    'Very High': 'sm-tier-vh', 'High': 'sm-tier-h',
    'Moderate': 'sm-tier-m', 'Low': 'sm-tier-l',
    'Watch / None': 'sm-tier-w'
  };
  var TIER_DOT = {
    'Very High': 'sm-dot-vh', 'High': 'sm-dot-h',
    'Moderate': 'sm-dot-m', 'Low': 'sm-dot-l',
    'Watch / None': 'sm-dot-w'
  };
  function $(id) { return document.getElementById(id); }
  function money(v) {
    if (v === null || v === undefined) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e7) return s + 'Rs ' + (a / 1e7).toFixed(2) + ' crore';
    if (a >= 1e5) return s + 'Rs ' + (a / 1e5).toFixed(2) + ' lakh';
    return s + 'Rs ' + a.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function pp(v, d) {
    if (v === null || v === undefined) return '—';
    var s = v < 0 ? '−' : '+';
    return s + Math.abs(v).toFixed(d === undefined ? 2 : d) + ' pp';
  }
  function pct(v, d) {
    if (v === null || v === undefined) return '—';
    var s = v < 0 ? '−' : '+';
    return s + Math.abs(v).toFixed(d === undefined ? 2 : d) + '%';
  }
  function qty(v) {
    if (v === null || v === undefined) return '—';
    return v.toLocaleString('en-IN');
  }
  function chip(tier) {
    return '<span class="sm-tierspan ' + (TIER_CLASS[tier] || '') + '">' + tier + '</span>';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  var P = null, BOARD = [], BY_SYM = {}, LB = [];
  var curSector = 'all', curSort = 'score', curSearch = '';
  var curSym = null;

  function statCard(num, lbl, sub) {
    return '<div class="cx-stat"><div class="num">' + num + '</div>' +
      '<div class="lbl">' + lbl + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderMeta() {
    var m = P.market;
    $('smSession').textContent =
      'Session ' + P.asof + ' · window ' + P.window.start + ' → ' + P.window.end +
      ' (' + P.window.calendar_days + ' calendar days) · board covers ' +
      m.board_symbols + ' stock-like names · ' + money(m.total_turnover) + ' window turnover';
    $('statStrip').innerHTML =
      statCard(m.board_symbols, 'Names on the board', 'of ' + m.symbols_in_window + ' traded in the window') +
      statCard(P.skill_meta.cohort.length, 'Skilled cohort brokers', 'top decile, ' + P.skill_meta.n_decile_eligible + ' eligible') +
      statCard(P.skill_meta.n_rated, 'Rated brokers', '5+ matured events') +
      statCard(P.skill_meta.full_events.toLocaleString('en-IN'), 'Skill events scored', 'weekly snapshots since Jul 2026') +
      statCard(P.top[0].symbol + ' · ' + P.top[0].score.toFixed(1), 'Highest conviction', money(P.top[0].skilled_net_amt) + ' skilled net');
    var tiers = {};
    BOARD.forEach(function (r) { tiers[r.tier] = (tiers[r.tier] || 0) + 1; });
    $('tierDist').innerHTML = ['Very High', 'High', 'Moderate', 'Low', 'Watch / None'].map(function (t) {
      return '<span class="sm-distitem"><span class="sm-dot ' + TIER_DOT[t] + '"></span>' +
        t + ' <b>' + (tiers[t] || 0) + '</b></span>';
    }).join('');
    $('coverageNote').textContent =
      'Window universe: ' + m.symbols_in_window + ' symbols traded. ' +
      m.board_symbols + ' reach this board; ' + m.unscoped_symbols +
      ' carry no sector mapping, and ' + m.excluded_instrument_symbols +
      ' are debentures or mutual funds — those stay on the Zero-Sum board. ' +
      P.gap_dates.length + ' session in the archive is totals-only (' +
      P.gap_dates.join(', ') + ') and contributes no per-stock rows.';
  }

  function boardRows() {
    var rows = BOARD.filter(function (r) {
      if (curSector !== 'all' && r.sector !== curSector) return false;
      if (curSearch && r.symbol.toLowerCase().indexOf(curSearch) < 0) return false;
      return true;
    });
    var key = curSort;
    rows.sort(function (a, b) {
      if (key === 'sym') return a.symbol < b.symbol ? -1 : 1;
      var av = key === 'score' ? a.conviction_score : key === 'net' ? a.skilled_net_amt :
        key === 'quality' ? a.broker_quality : a.momentum_20d;
      var bv = key === 'score' ? b.conviction_score : key === 'net' ? b.skilled_net_amt :
        key === 'quality' ? b.broker_quality : b.momentum_20d;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return bv - av;
    });
    $('boardBody').innerHTML = rows.map(function (r) {
      var score = r.conviction_score === null ? '—' : r.conviction_score.toFixed(1);
      var bar = r.conviction_score === null ? '' :
        '<span class="sm-scorebar"><i style="width:' + Math.round(r.conviction_score) + '%"></i></span>';
      return '<tr class="sm-rowclick" data-sym="' + esc(r.symbol) + '"><td class="sm-num">' +
        (r.conviction_rank || '—') + '</td><td><strong>' + esc(r.symbol) + '</strong></td><td>' +
        esc(r.sector) + '</td><td>' + chip(r.tier) + '</td><td class="sm-num"><span class="sm-score">' +
        bar + score + '</span></td><td class="sm-num">' + money(r.skilled_net_amt) + '</td><td class="sm-num">' +
        pct(r.intensity_pct) + '</td><td class="sm-num">' + pp(r.broker_quality) + '</td><td class="sm-num">' +
        r.n_skilled_brokers + '</td><td class="sm-num">' + pct(r.momentum_20d) + '</td><td>' +
        esc(r.reading) + '</td></tr>';
    }).join('');
    $('boardCount').textContent = rows.length + ' names shown of ' + BOARD.length + ' on the board.';
    document.querySelectorAll('#boardBody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        $('symSel').value = tr.getAttribute('data-sym');
        renderDetail(tr.getAttribute('data-sym'));
        $('detail').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function renderDetail(sym) {
    curSym = sym;
    var r = BY_SYM[sym], d = P.details[sym];
    if (!r || !d) return;
    $('detailHead').innerHTML = esc(sym) + ' <span style="font-size:14px;color:var(--nd-text-soft)">' +
      esc(P.names[sym] || '') + '</span> ' + chip(r.tier) + ' · ' + esc(r.flow_state);
    $('detailStats').innerHTML =
      statCard(money(r.skilled_net_amt), 'Skilled net flow', r.sector) +
      statCard(pp(r.broker_quality), 'Broker quality', 'weighted skill of accumulators') +
      statCard(pct(r.intensity_pct), 'Skilled intensity', 'share of window turnover') +
      statCard(pct(r.momentum_20d), '20-day momentum', 'price trend') +
      statCard(r.n_skilled_brokers, 'Skilled brokers touching it', r.n_top_decile + ' top-decile');
    $('readingLine').textContent = r.reading + '. ' +
      (r.newly_started ? 'Newly started: the cohort was not net long over the prior 30 days.' :
        'Continued: the cohort was already net long over the prior 30 days.') + ' ' +
      (r.price_confirmed ? 'Price is confirming the accumulation over 20 sessions.' :
        'Price is not confirming the accumulation over 20 sessions.');
    var lad = P.ladders[sym] || {};
    $('ladderList').innerHTML = [['7-day', 'skilled_net_7'], ['30-day', 'skilled_net_30'],
      ['90-day', 'skilled_net_90'], ['prior 30-day', 'skilled_net_prior_30']].map(function (x) {
      return '<li><span class="lbl">' + x[0] + '</span><span class="val">' + money(lad[x[1]]) + '</span></li>';
    }).join('');
    function sideRows(list) {
      return (list || []).map(function (x) {
        var b = LB.find(function (y) { return y.broker === x.broker; });
        return '<tr><td>' + x.broker + ' · ' + esc(P.brokers[x.broker] || '') + '</td><td class="sm-num">' +
          qty(x.net_qty) + '</td><td class="sm-num">' + money(x.net_amt) + '</td><td class="sm-num">' +
          pp(b ? b.skill_full : null) + '</td><td>' + (x.cohort ? '<span class="sm-cohort">★ Cohort</span>' : '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="sm-loading">None in this window.</td></tr>';
    }
    $('accumBody').innerHTML = sideRows(d.accumulators);
    $('distBody').innerHTML = sideRows(d.distributors);
    document.querySelectorAll('#boardBody tr').forEach(function (tr) {
      tr.classList.toggle('sm-active', tr.getAttribute('data-sym') === sym);
    });
  }

  function renderDistribution() {
    var neg = BOARD.filter(function (r) { return r.skilled_net_amt < 0; })
      .sort(function (a, b) { return a.skilled_net_amt - b.skilled_net_amt; }).slice(0, 25);
    $('distBoardBody').innerHTML = neg.map(function (r, i) {
      return '<tr class="sm-rowclick" data-sym="' + esc(r.symbol) + '"><td class="sm-num">' + (i + 1) +
        '</td><td><strong>' + esc(r.symbol) + '</strong></td><td>' + esc(r.sector) + '</td><td class="sm-num">' +
        money(r.skilled_net_amt) + '</td><td class="sm-num">' + pct(r.intensity_pct) + '</td><td class="sm-num">' +
        pp(r.broker_quality) + '</td><td class="sm-num">' + r.n_skilled_brokers + '</td><td class="sm-num">' +
        pct(r.momentum_20d) + '</td></tr>';
    }).join('');
    $('distBoardCount').textContent = 'Top 25 of ' + BOARD.filter(function (r) { return r.skilled_net_amt < 0; }).length +
      ' names the skilled cohort net-sold this window. Select a row to open its breakdown.';
    document.querySelectorAll('#distBoardBody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        $('symSel').value = tr.getAttribute('data-sym');
        renderDetail(tr.getAttribute('data-sym'));
        $('detail').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function renderLeaderboard() {
    var sm = P.skill_meta;
    $('leaderSub').textContent = 'Skill = net-amount-weighted mean outcome of a broker\'s ' +
      'matured accumulation events, in percentage points against the average stock. Cohort = ' +
      sm.cohort.join(', ') + ' — the top decile of ' + sm.n_decile_eligible +
      ' decile-eligible brokers, chosen on pre-window skill only. Full-era skill uses all ' +
      sm.full_events.toLocaleString('en-IN') + ' events across ' + sm.full_snapshots.length +
      ' weekly snapshots, including outcomes inside the board window.';
    $('leaderBody').innerHTML = LB.map(function (b) {
      return '<tr><td class="sm-num">' + b.rank + '</td><td><strong>' + b.broker + '</strong> · ' +
        esc(P.brokers[b.broker] || '') + '</td><td class="sm-num">' + pp(b.skill_full) +
        '</td><td class="sm-num">' + pct(b.hit_rate_full * 100, 1) + '</td><td class="sm-num">' +
        b.n_events_full + '</td><td class="sm-num">' + b.n_snapshots_full + '</td><td class="sm-num">' +
        pp(b.skill_board) + '</td><td>' + (b.cohort ? '<span class="sm-cohort">★ Cohort</span>' : '—') +
        '</td><td class="sm-num">' + money(b.window_net_amt) + '</td></tr>';
    }).join('');
    $('leaderNote').textContent = 'Unrated brokers (fewer than 5 matured events) are not shown; ' +
      'the leaderboard covers the ' + LB.length + ' brokers rated on the full era. A broker\'s ' +
      'window net flow is its flow this window, not a skill measure — size and skill are different things.';
  }

  function renderRecord() {
    var sp = P.persistence, po = P.pooled;
    $('recordSub').textContent = 'Split-half check: the cohort was picked on the era\'s first ' +
      sp.snapshots_first.length + ' snapshots (' + sp.snapshots_first.join(', ') + '); outcomes ' +
      'measured on the later ' + sp.snapshots_second.length + ' snapshots. Pooled contrasts use ' +
      'the whole era and are in-sample — they describe the ranking, they do not prove it.';
    $('recordBody').innerHTML = [
      ['Split-half — cohort', 'Top decile of first-half skill', sp.top_events, pp(sp.top_mean)],
      ['Split-half — everyone else', 'All other rated brokers', sp.rest_events, pp(sp.rest_mean)],
      ['Split-half — difference', 'Cohort minus rest', '', pp(sp.spread)],
      ['Pooled — top-decile brokers', 'Full-era top decile (in-sample)', po.top_events, pp(po.top_mean)],
      ['Pooled — bottom-decile brokers', 'Full-era bottom decile (in-sample)', po.bottom_events, pp(po.bottom_mean)],
      ['Pooled — all rated brokers', 'All rated brokers (in-sample)', po.all_events, pp(po.all_mean)]
    ].map(function (row) {
      return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td><td class="sm-num">' +
        row[2] + '</td><td class="sm-num">' + row[3] + '</td></tr>';
    }).join('');
    $('recordNote').textContent = 'Reading: on the split-half check the first-half cohort beat the ' +
      'rest by ' + pp(sp.spread) + ' — close to zero on ' + sp.top_events.toLocaleString('en-IN') +
      ' cohort events against ' + sp.rest_events.toLocaleString('en-IN') + ' for the rest. The era is ' +
      'three months long, in one regime, with overlapping windows; this is why the page presents the ' +
      'board as description, not prediction, and publishes the check rather than burying it.';
  }

  function renderHistory(entries) {
    if (!entries || !entries.length) {
      $('historyBody').innerHTML = '<tr><td colspan="6" class="sm-loading">No published sessions yet.</td></tr>';
      return;
    }
    var rows = entries.slice().reverse();
    $('historyBody').innerHTML = rows.map(function (e) {
      return '<tr><td>' + esc(e.asof) + '</td><td class="sm-num">' + e.board_symbols + '</td><td class="sm-num">' +
        e.rated_brokers + '</td><td>' + esc(e.cohort.join(', ')) + '</td><td>' +
        esc(e.top_conviction.symbol) + ' (' + e.top_conviction.score.toFixed(1) + ')</td><td>' +
        esc(e.top_skill.broker) + ' (' + pp(e.top_skill.skill_full) + ')</td></tr>';
    }).join('');
  }

  fetch(DATA).then(function (r) { return r.json(); }).then(function (d) {
    P = d;
    BOARD = d.board;
    LB = d.leaderboard;
    BOARD.forEach(function (r) { BY_SYM[r.symbol] = r; });
    var sectors = [];
    BOARD.forEach(function (r) { if (sectors.indexOf(r.sector) < 0) sectors.push(r.sector); });
    sectors.sort();
    $('sectorSel').innerHTML = '<option value="all">All sectors</option>' +
      sectors.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    $('symSel').innerHTML = BOARD.map(function (r) {
      return '<option value="' + esc(r.symbol) + '">' + esc(r.symbol) + ' — ' + esc(d.names[r.symbol] || '') + '</option>';
    }).join('');
    $('sectorSel').addEventListener('change', function () { curSector = this.value; boardRows(); });
    $('sortSel').addEventListener('change', function () { curSort = this.value; boardRows(); });
    $('symSearch').addEventListener('input', function () { curSearch = this.value.trim().toLowerCase(); boardRows(); });
    $('symSel').addEventListener('change', function () { renderDetail(this.value); });
    renderMeta();
    boardRows();
    renderDistribution();
    renderLeaderboard();
    renderRecord();
    var first = BOARD.find(function (r) { return r.conviction_rank === 1; });
    renderDetail(first ? first.symbol : BOARD[0].symbol);
    return fetch(HIST).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }).then(function (entries) { renderHistory(entries); })
    .catch(function (e) {
      var b = $('boardBody');
      if (b) b.innerHTML = '<tr><td colspan="11" class="sm-loading">The board could not be loaded. Please refresh.</td></tr>';
      console.error(e);
    });
})();
