/* Broker Smart Money — renders /data/broker-smart-money.json (+ its
   history_recent block, falling back to the ledger file) and the
   sector block (verdicts sec counts + universe names).
   All numbers come from the payloads; nothing is computed client-side
   except ordering, filtering and display formatting. Payload shape is
   nd-broker-smart-money/v1 (see tools/build-broker-smart-money.py).
   Refresh is change-gated (2026-10-27 teardown): a 60 s tick re-fetches
   the board with no-store and re-renders ONLY when the signature
   changes; unchanged ticks move only the freshness line; a failed tick
   keeps the old view. View-change handlers re-baseline the signature
   after render — never null it (the trade-pattern gate lesson). */
(function () {
  'use strict';
  var DATA = '/data/broker-smart-money.json?v=20261027a';
  var HIST = '/data/broker-smart-money-history.json?v=20261027a';
  var VERDICTS = '/nepse-chart/data/verdicts.json';
  var UNIVERSE = '/nepse-chart/data/universe.json';
  var PAGE = 25;
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
  var TIER_PROP = {
    'Very High': 'sm-prop-vh', 'High': 'sm-prop-h',
    'Moderate': 'sm-prop-m', 'Low': 'sm-prop-l',
    'Watch / None': 'sm-prop-w'
  };
  var TIER_ORDER = ['Very High', 'High', 'Moderate', 'Low', 'Watch / None'];
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
  function nptTime() {
    try {
      return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  var P = null, BOARD = [], BY_SYM = {}, LB = [];
  var curSector = 'all', curSort = 'score', curSearch = '';
  var curSym = null, boardPage = 1, leaderPage = 1;
  var sig = null;
  /* Sector block state (verdicts counts + universe names). */
  var SEC = null; /* {sectors:[{name,count}], rows:[{s,n,sec}], verdictsAsof, universeAsof} */
  var secSector = 'all', secSearch = '', secPage = 1;

  function statCard(num, lbl, sub) {
    return '<div class="cx-stat"><div class="num">' + num + '</div>' +
      '<div class="cx-stat-l">' + lbl + '</div>' +
      (sub ? '<div class="cx-stat-s">' + sub + '</div>' : '') + '</div>';
  }

  function signatureFor(d, board, lb) {
    if (!d) return null;
    var det = curSym && d.symbols ? d.symbols[curSym] : null;
    return JSON.stringify([d.asof, d.market.board_symbols,
      d.market.brokers_active, board.length,
      board.length ? board[0].symbol + '|' + board[0].skilled_net_amt : '',
      curSym, det, lb.length]);
  }
  function signature() { return signatureFor(P, BOARD, LB); }
  function rebaseline() { sig = signature(); }

  function setFresh(ok, note) {
    var el = $('smFresh');
    if (!el) return;
    el.className = 'sm-fresh' + (ok ? '' : ' sm-fresh-fail');
    el.textContent = ok
      ? 'Checked ' + nptTime() + ' NPT · next check in 60 seconds · Board as of ' + P.asof + ' · ' + (P.status || 'FINAL')
      : 'Board update failed at ' + nptTime() + ' NPT — showing the last good board · retrying in 60 seconds' + (note ? ' · ' + note : '');
  }
  function setNotice(msg) {
    var el = $('smNotice');
    if (el) el.textContent = msg || '';
  }

  function renderMeta() {
    var m = P.market, sm = P.skill_meta;
    var topRow = null;
    BOARD.forEach(function (r) { if (r.conviction_rank === 1) topRow = r; });
    $('smSession').textContent =
      'Session ' + P.asof + ' · window ' + P.window.start + ' → ' + P.window.end +
      ' (' + P.window.days + ' calendar days, ' + P.window.sessions_in_window + ' sessions) · ' +
      m.board_symbols + ' stock-like names · ' + m.brokers_active + ' brokers active in the window';
    $('statStrip').innerHTML =
      statCard(m.board_symbols, 'Names on the board', 'of ' + m.symbols_in_window + ' traded in the window') +
      statCard(sm.cohort.length, 'Skilled cohort brokers', 'top decile, ' + sm.decile_eligible + ' eligible') +
      statCard(sm.rated_brokers, 'Rated brokers', '5+ matured events') +
      statCard(sm.events_full.toLocaleString('en-IN'), 'Skill events scored', 'weekly snapshots since Jul 2026') +
      statCard(topRow ? topRow.symbol + ' · ' + topRow.conviction_score.toFixed(1) : '—',
        'Highest conviction', topRow ? money(topRow.skilled_net_amt) + ' skilled net' : '');
    var tiers = m.tier_counts;
    $('tierDist').innerHTML = TIER_ORDER.map(function (t) {
      return '<span class="sm-distitem"><span class="sm-dot ' + TIER_DOT[t] + '"></span>' +
        t + ' <b>' + (tiers[t] || 0) + '</b></span>';
    }).join('');
    /* Proportion bar from the SAME counts the legend prints; zero-count
       buckets render no segment (house distribution-bar pattern). */
    var total = TIER_ORDER.reduce(function (a, t) { return a + (tiers[t] || 0); }, 0);
    var bar = TIER_ORDER.filter(function (t) { return (tiers[t] || 0) > 0; }).map(function (t) {
      return '<i class="' + TIER_PROP[t] + '" style="width:' + ((tiers[t] / total) * 100).toFixed(2) + '%"></i>';
    }).join('');
    var prop = $('tierProp');
    prop.innerHTML = bar;
    prop.setAttribute('aria-label', TIER_ORDER.map(function (t) { return t + ' ' + (tiers[t] || 0); }).join(', ') + ' of ' + total + ' names');
    $('coverageNote').textContent =
      'Window universe: ' + m.symbols_in_window + ' symbols traded. ' +
      m.board_symbols + ' reach this board; ' + m.unscoped_symbols +
      ' carry no sector mapping, and ' + m.excluded_instrument_symbols +
      ' are debentures or mutual funds — those stay on the Zero-Sum board. ' +
      P.gap_dates.length + ' session in the archive is totals-only (' +
      P.gap_dates.join(', ') + ') and contributes no per-stock rows.';
  }

  function pagerHTML(page, pages, total, label) {
    var from = total ? (page - 1) * PAGE + 1 : 0;
    var to = Math.min(page * PAGE, total);
    return '<div class="sm-pager"><button type="button" class="sm-pager-prev" ' +
      (page <= 1 ? 'disabled' : '') + '>Prev</button><span class="sm-pager-count">Showing ' +
      from + '–' + to + ' of ' + total + ' ' + label + '</span><button type="button" class="sm-pager-next" ' +
      (page >= pages ? 'disabled' : '') + '>Next</button></div>';
  }
  function bindPager(el, getPage, setPage, render) {
    if (!el) return;
    var prev = el.querySelector('.sm-pager-prev');
    var next = el.querySelector('.sm-pager-next');
    if (prev) prev.addEventListener('click', function () {
      if (getPage() > 1) { setPage(getPage() - 1); render(); rebaseline(); }
    });
    if (next) next.addEventListener('click', function () {
      setPage(getPage() + 1); render(); rebaseline();
    });
  }

  function filteredBoard() {
    var rows = BOARD.filter(function (r) {
      if (curSector !== 'all' && r.sector !== curSector) return false;
      if (curSearch && r.symbol.toLowerCase().indexOf(curSearch) < 0 &&
          (r.name || '').toLowerCase().indexOf(curSearch) < 0) return false;
      return true;
    });
    var key = curSort;
    rows.sort(function (a, b) {
      if (key === 'sym') return a.symbol < b.symbol ? -1 : 1;
      var av = key === 'score' ? a.conviction_score : key === 'net' ? a.skilled_net_amt :
        key === 'quality' ? a.broker_quality : a.price_momentum_20d;
      var bv = key === 'score' ? b.conviction_score : key === 'net' ? b.skilled_net_amt :
        key === 'quality' ? b.broker_quality : b.price_momentum_20d;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return bv - av;
    });
    return rows;
  }

  function boardRows() {
    var rows = filteredBoard();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (boardPage > pages) boardPage = pages;
    var slice = rows.slice((boardPage - 1) * PAGE, boardPage * PAGE);
    $('boardBody').innerHTML = slice.map(function (r) {
      var score = r.conviction_score === null ? '—' : r.conviction_score.toFixed(1);
      var bar = r.conviction_score === null ? '' :
        '<span class="sm-scorebar"><i style="width:' + Math.round(r.conviction_score) + '%"></i></span>';
      return '<tr class="sm-rowclick' + (r.symbol === curSym ? ' sm-active' : '') + '" data-sym="' + esc(r.symbol) + '"><td class="sm-num">' +
        (r.conviction_rank || '—') + '</td><td><strong>' + esc(r.symbol) + '</strong></td><td>' +
        esc(r.sector) + '</td><td>' + chip(r.tier) + '</td><td class="sm-num"><span class="sm-score">' +
        bar + score + '</span></td><td class="sm-num">' + money(r.skilled_net_amt) + '</td><td class="sm-num">' +
        pct(r.intensity_pct) + '</td><td class="sm-num">' + pp(r.broker_quality) + '</td><td class="sm-num">' +
        r.n_skilled_brokers + '</td><td class="sm-num">' + pct(r.price_momentum_20d) + '</td><td>' +
        esc(r.reading) + '</td></tr>';
    }).join('');
    $('boardCount').textContent = rows.length + ' names match of ' + BOARD.length + ' on the board.';
    var pg = $('boardPager');
    pg.innerHTML = pagerHTML(boardPage, pages, rows.length, 'names');
    bindPager(pg, function () { return boardPage; }, function (v) { boardPage = v; }, boardRows);
    document.querySelectorAll('#boardBody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        selectSymbol(tr.getAttribute('data-sym'), true);
      });
    });
  }

  function selectSymbol(sym, scroll) {
    if (!sym) return;
    curSym = sym;
    var sel = $('symSel');
    if (sel) sel.value = sym;
    renderDetail(sym);
    rebaseline();
    if (scroll) $('detail').scrollIntoView({ behavior: 'smooth' });
  }

  function renderDetail(sym) {
    var r = BY_SYM[sym], d = P.symbols[sym];
    if (!r) return;
    /* Honest empty state: names the cohort never touched carry no
       breakdown in the payload. Never leave the previous stock's
       detail standing under a new symbol. */
    if (!d) {
      $('detailHead').innerHTML = esc(sym) + ' <span class="sm-detail-name">' +
        esc(r.name || '') + '</span> ' + chip(r.tier) + ' · ' + esc(r.flow_state);
      $('detailStats').innerHTML =
        statCard(money(r.skilled_net_amt), 'Skilled net flow', r.sector) +
        statCard(pp(r.broker_quality), 'Broker quality', 'weighted skill of accumulators') +
        statCard(pct(r.intensity_pct), 'Skilled intensity', 'share of window turnover') +
        statCard(pct(r.price_momentum_20d), '20-day momentum', 'price trend');
      $('readingLine').textContent = 'No skilled-broker breakdown is published for this name: ' +
        'the skilled cohort did not touch it in the window, so there are no accumulators or ' +
        'distributors to list. Its skilled net is Rs 0.';
      $('ladderList').innerHTML = '';
      $('accumBody').innerHTML = '<tr><td colspan="5" class="sm-loading">No accumulators in this window.</td></tr>';
      $('distBody').innerHTML = '<tr><td colspan="5" class="sm-loading">No distributors in this window.</td></tr>';
      markActiveRow(sym);
      return;
    }
    $('detailHead').innerHTML = esc(sym) + ' <span class="sm-detail-name">' +
      esc(r.name || '') + '</span> ' + chip(r.tier) + ' · ' + esc(r.flow_state);
    $('detailStats').innerHTML =
      statCard(money(r.skilled_net_amt), 'Skilled net flow', r.sector) +
      statCard(pp(r.broker_quality), 'Broker quality', 'weighted skill of accumulators') +
      statCard(pct(r.intensity_pct), 'Skilled intensity', 'share of window turnover') +
      statCard(pct(r.price_momentum_20d), '20-day momentum', 'price trend') +
      statCard(r.n_skilled_brokers, 'Skilled accumulators', r.n_skilled_dist + ' skilled distributors');
    $('readingLine').textContent = r.reading + '. ' +
      (r.newly_started ? 'Newly started: the cohort was not net long over the prior 30 days.' :
        'Continued: the cohort was already net long over the prior 30 days.') + ' ' +
      (r.price_confirmed ? 'Price is confirming the accumulation over 20 sessions.' :
        'Price is not confirming the accumulation over 20 sessions.');
    var lad = {};
    (d.ladder || []).forEach(function (x) { lad[x.days] = x.skilled_net_amt; });
    $('ladderList').innerHTML = [
      ['7-day skilled net', lad[7]], ['30-day skilled net', lad[30]],
      ['90-day skilled net', lad[90]], ['Prior 30-day skilled net', d.skilled_net_prior30]
    ].map(function (x) {
      return '<li><span class="lbl">' + x[0] + '</span><span class="val">' + money(x[1]) + '</span></li>';
    }).join('');
    function sideRows(list) {
      // rows are arrays: [broker, net_qty, net_amt, skill, cohort]
      return (list || []).map(function (x) {
        return '<tr><td>' + x[0] + ' · ' + esc(P.brokers[x[0]] || '') + '</td><td class="sm-num">' +
          qty(x[1]) + '</td><td class="sm-num">' + money(x[2]) + '</td><td class="sm-num">' +
          pp(x[3]) + '</td><td>' + (x[4] ? '<span class="sm-cohort">★ Cohort</span>' : '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="sm-loading">None in this window.</td></tr>';
    }
    $('accumBody').innerHTML = sideRows(d.accumulators);
    $('distBody').innerHTML = sideRows(d.distributors);
    markActiveRow(sym);
  }
  function markActiveRow(sym) {
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
        pct(r.price_momentum_20d) + '</td></tr>';
    }).join('');
    $('distBoardCount').textContent = 'Top 25 of ' + BOARD.filter(function (r) { return r.skilled_net_amt < 0; }).length +
      ' names the skilled cohort net-sold this window. Select a row to open its breakdown.';
    document.querySelectorAll('#distBoardBody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        selectSymbol(tr.getAttribute('data-sym'), true);
      });
    });
  }

  function renderLeaderboard() {
    var sm = P.skill_meta;
    var base = 'Skill = net-amount-weighted mean outcome of a broker\'s ' +
      'matured accumulation events, in percentage points against the average stock. Cohort = ' +
      sm.cohort.join(', ') + ' — the top decile of ' + sm.decile_eligible +
      ' decile-eligible brokers, chosen on pre-window skill only. Full-era skill uses all ' +
      sm.events_full.toLocaleString('en-IN') + ' events across ' + sm.full_snapshots.length +
      ' weekly snapshots, including outcomes inside the board window.';
    /* Dynamic eligibility note: a high board skill on few events does
       not make the cohort. Computed from this board's own rows, so it
       never goes stale. */
    var outsiders = LB.filter(function (b) {
      return !b.in_cohort && b.skill_board !== null && b.skill_board !== undefined && (b.n_board || 0) < 30;
    }).sort(function (a, b) { return b.skill_board - a.skill_board; });
    if (outsiders.length) {
      var o = outsiders[0];
      base += ' Highest board skill outside the cohort: broker ' + o.broker + ' (' +
        pp(o.skill_board) + ') on only ' + o.n_board + ' events — below the 30-event decile bar, so not cohort-eligible.';
    }
    $('leaderSub').textContent = base;
    var pages = Math.max(1, Math.ceil(LB.length / PAGE));
    if (leaderPage > pages) leaderPage = pages;
    var slice = LB.slice((leaderPage - 1) * PAGE, leaderPage * PAGE);
    $('leaderBody').innerHTML = slice.map(function (b) {
      return '<tr><td class="sm-num">' + b.rank + '</td><td><strong>' + b.broker + '</strong> · ' +
        esc(b.name || P.brokers[b.broker] || '') + '</td><td class="sm-num">' + pp(b.skill_full) +
        '</td><td class="sm-num">' + pct(b.hit_full, 1) + '</td><td class="sm-num">' +
        b.n_full + '</td><td class="sm-num">' + b.snaps_full + '</td><td class="sm-num">' +
        pp(b.skill_board) + '</td><td>' + (b.in_cohort ? '<span class="sm-cohort">★ Cohort</span>' : '—') +
        '</td><td class="sm-num">' + money(b.window_net_amt) + '</td></tr>';
    }).join('');
    $('leaderCount').textContent = 'Showing ' + ((leaderPage - 1) * PAGE + 1) + '–' +
      Math.min(leaderPage * PAGE, LB.length) + ' of ' + LB.length + ' rated brokers.';
    var pg = $('leaderPager');
    pg.innerHTML = pagerHTML(leaderPage, pages, LB.length, 'brokers');
    bindPager(pg, function () { return leaderPage; }, function (v) { leaderPage = v; }, renderLeaderboard);
    $('leaderNote').textContent = 'Unrated brokers (fewer than 5 matured events) are not shown; ' +
      'the leaderboard covers the ' + LB.length + ' brokers rated on the full era. A broker\'s ' +
      'window net flow is its flow this window, not a skill measure — size and skill are different things.';
  }

  function renderRecord() {
    var sp = P.persistence, po = P.pooled;
    $('recordSub').textContent = 'Split-half check: the cohort was picked on the era\'s first ' +
      sp.first_half_snapshots.length + ' snapshots (' + sp.first_half_snapshots.join(', ') + '); outcomes ' +
      'measured on the later ' + sp.second_half_snapshots.length + ' snapshots (' +
      sp.second_half_snapshots.join(', ') + '). Pooled contrasts use ' +
      'the whole era and are in-sample — they describe the ranking, they do not prove it.';
    $('recordBody').innerHTML = [
      ['Split-half — cohort', 'Top decile of first-half skill (' + sp.cohort_first_half.join(', ') + ')', sp.top.n, pp(sp.top.mean_excess_pp)],
      ['Split-half — everyone else', 'All other rated brokers', sp.rest.n, pp(sp.rest.mean_excess_pp)],
      ['Split-half — difference', 'Cohort minus rest', '', pp(sp.spread_pp)],
      ['Pooled — top-decile brokers', 'Full-era top decile (in-sample)', po.top.n, pp(po.top.mean_excess_pp)],
      ['Pooled — bottom-decile brokers', 'Full-era bottom decile (in-sample)', po.bottom.n, pp(po.bottom.mean_excess_pp)],
      ['Pooled — all rated brokers', 'All rated brokers (in-sample)', po.all.n, pp(po.all.mean_excess_pp)]
    ].map(function (row) {
      return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td><td class="sm-num">' +
        row[2] + '</td><td class="sm-num">' + row[3] + '</td></tr>';
    }).join('');
    $('recordNote').textContent = 'Reading: on the split-half check the first-half cohort beat the ' +
      'rest by ' + pp(sp.spread_pp) + ' — close to zero on ' + sp.top.n.toLocaleString('en-IN') +
      ' cohort events against ' + sp.rest.n.toLocaleString('en-IN') + ' for the rest. The era is ' +
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
      var tc = (e.top_conviction && e.top_conviction[0]) || {};
      var ts = e.top_skill_broker || {};
      return '<tr><td>' + esc(e.asof) + '</td><td class="sm-num">' + e.board_symbols + '</td><td class="sm-num">' +
        e.rated_brokers + '</td><td>' + esc((e.cohort || []).join(', ')) + '</td><td>' +
        esc(tc.symbol || '') + ' (' + (tc.score !== undefined ? tc.score.toFixed(1) : '—') + ')</td><td>' +
        esc(ts.broker || '') + ' (' + pp(ts.skill_full) + ')</td></tr>';
    }).join('');
  }

  /* ---- sector block: every universe stock, grouped by verdicts sector ---- */
  function renderSector() {
    if (!SEC) return;
    var rows = SEC.rows.filter(function (r) {
      if (secSector !== 'all' && r.sec !== secSector) return false;
      if (secSearch && r.s.toLowerCase().indexOf(secSearch) < 0 &&
          r.n.toLowerCase().indexOf(secSearch) < 0) return false;
      return true;
    });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (secPage > pages) secPage = pages;
    var slice = rows.slice((secPage - 1) * PAGE, secPage * PAGE);
    $('sectorBody').innerHTML = slice.map(function (r) {
      var b = BY_SYM[r.s];
      var tier = b ? b.tier : '—';
      var mark = r.s === curSym ? '<span class="sm-openmark"> ●</span>' : '';
      return '<tr class="sm-rowclick" data-sym="' + esc(r.s) + '"><td><strong>' + esc(r.s) + '</strong>' + mark +
        '</td><td>' + esc(r.n) + '</td><td>' + esc(r.sec) + '</td><td>' + (b ? chip(tier) : '—') +
        '</td><td><a href="/stocks/' + esc(r.s) + '/">Company page</a></td></tr>';
    }).join('');
    $('sectorCount').textContent = 'Showing ' + ((secPage - 1) * PAGE + 1) + '–' +
      Math.min(secPage * PAGE, rows.length) + ' of ' + rows.length + ' stocks' +
      (secSector !== 'all' ? ' in ' + secSector : ' in all sectors') + '.';
    var pg = $('sectorPager');
    pg.innerHTML = pagerHTML(secPage, pages, rows.length, 'stocks');
    bindPager(pg, function () { return secPage; }, function (v) { secPage = v; }, renderSector);
    document.querySelectorAll('#sectorBody tr').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.tagName === 'A') return;
        var s = tr.getAttribute('data-sym');
        if (BY_SYM[s]) { selectSymbol(s, true); }
        else {
          $('sectorNote').textContent = s + ' is not on this board — the skilled cohort did not touch it ' +
            'in the window, or it carries no board row. Its company page link still works.';
        }
      });
    });
  }

  function renderAll() {
    renderMeta();
    boardRows();
    renderDistribution();
    renderLeaderboard();
    renderRecord();
    renderSector();
    if (curSym && BY_SYM[curSym]) renderDetail(curSym);
    rebaseline();
  }

  function loadBoard(d) {
    P = d;
    BOARD = d.board;
    LB = d.leaderboard;
    BY_SYM = {};
    BOARD.forEach(function (r) { BY_SYM[r.symbol] = r; });
    var sectors = [];
    BOARD.forEach(function (r) { if (sectors.indexOf(r.sector) < 0) sectors.push(r.sector); });
    sectors.sort();
    $('sectorSel').innerHTML = '<option value="all">All sectors</option>' +
      sectors.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    $('sectorSel').value = curSector;
    var keep = curSym && BY_SYM[curSym] ? curSym : null;
    $('symSel').innerHTML = BOARD.map(function (r) {
      return '<option value="' + esc(r.symbol) + '">' + esc(r.symbol) + ' — ' + esc(r.name || '') + '</option>';
    }).join('');
    if (keep) { curSym = keep; $('symSel').value = keep; }
    else {
      var first = BOARD.find(function (r) { return r.conviction_rank === 1; });
      curSym = first ? first.symbol : BOARD[0].symbol;
      $('symSel').value = curSym;
    }
  }

  function loadSectorFiles() {
    return Promise.all([
      fetch(VERDICTS).then(function (r) { return r.json(); }),
      fetch(UNIVERSE).then(function (r) { return r.json(); })
    ]).then(function (parts) {
      var vd = parts[0].verdicts || {};
      var rows = (parts[1].symbols || []).map(function (row) {
        return { s: row.s, n: row.n || '', sec: (vd[row.s] && vd[row.s].sec) || 'Unmapped' };
      });
      var counts = {};
      rows.forEach(function (r) { counts[r.sec] = (counts[r.sec] || 0) + 1; });
      var sectors = Object.keys(counts).sort().map(function (s) { return { name: s, count: counts[s] }; });
      SEC = { sectors: sectors, rows: rows,
        verdictsAsof: parts[0].asof || '', universeAsof: parts[1].asof || '' };
      $('smSectorSel').innerHTML = '<option value="all">All sectors (' + rows.length + ')</option>' +
        sectors.map(function (s) {
          return '<option value="' + esc(s.name) + '">' + esc(s.name) + ' (' + s.count + ')</option>';
        }).join('');
      $('smSectorSel').value = secSector;
      $('sectorNote').textContent = 'Sector counts come from the verdicts batch (' + SEC.verdictsAsof +
        '), company names from the universe (' + SEC.universeAsof +
        '); universe entries carry no sector field. A lime ● marks the stock currently open below.';
    }).catch(function () {
      $('sectorNote').textContent = 'Sector data could not be loaded; the board above is unaffected.';
    });
  }

  function tick() {
    if (document.hidden) return;
    fetch(DATA, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      /* Compare BEFORE adopting: an unchanged tick must not touch
         any data DOM — only the freshness line moves. */
      var next = signatureFor(d, d.board, d.leaderboard);
      if (next !== sig) {
        loadBoard(d);
        renderAll();
        if (d.history_recent && d.history_recent.length) renderHistory(d.history_recent);
        setFresh(true);
        setNotice('Smart-money data updated · ' + nptTime() + ' NPT');
      } else {
        setFresh(true);
        setNotice('');
        rebaseline();
      }
    }).catch(function () {
      setFresh(false);
    });
  }

  function boot() {
    fetch(DATA).then(function (r) { return r.json(); }).then(function (d) {
      loadBoard(d);
      $('sectorSel').addEventListener('change', function () { curSector = this.value; boardPage = 1; boardRows(); rebaseline(); });
      $('sortSel').addEventListener('change', function () { curSort = this.value; boardPage = 1; boardRows(); rebaseline(); });
      $('symSearch').addEventListener('input', function () { curSearch = this.value.trim().toLowerCase(); boardPage = 1; boardRows(); rebaseline(); });
      $('symSel').addEventListener('change', function () { selectSymbol(this.value, false); });
      $('smSectorSel').addEventListener('change', function () { secSector = this.value; secPage = 1; renderSector(); rebaseline(); });
      $('smSectorSearch').addEventListener('input', function () { secSearch = this.value.trim().toLowerCase(); secPage = 1; renderSector(); rebaseline(); });
      renderAll();
      if (d.history_recent && d.history_recent.length) { renderHistory(d.history_recent); return d.history_recent; }
      return fetch(HIST).then(function (r) { return r.ok ? r.json() : []; })
        .then(function (h) { return h.entries || h; }).catch(function () { return []; });
    }).then(function (entries) { renderHistory(entries); })
      .then(function () { return loadSectorFiles(); })
      .then(function () { renderSector(); rebaseline(); setFresh(true); setNotice(''); })
      .catch(function (e) {
        var b = $('boardBody');
        if (b) b.innerHTML = '<tr><td colspan="11" class="sm-loading">The board could not be loaded. Please refresh.</td></tr>';
        var f = $('smFresh');
        if (f) { f.className = 'sm-fresh sm-fresh-fail'; f.textContent = 'Board could not be loaded — retrying in 60 seconds.'; }
        console.error(e);
      });
    setInterval(tick, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && P) tick();
    });
  }
  boot();
})();
