/* Smart-Money EPS — renders /data/smart-money-eps.json (+ history ledger).
   All numbers come from the payload; nothing is computed client-side
   except ordering, filtering, display aggregation and formatting.
   Payload shape is nd-smart-money-eps/v1 (see tools/build-smart-money-eps.py).

   AUTO-REFRESH (change-gated, 60s payload poll): the refresh
   signature is computed from the PAYLOADS only (asof, board length,
   history length, forward spread, money totals, top conviction) —
   view state (story, sector, sort, search, pages, selected stock)
   NEVER touches that signature, so a view change cannot swallow a
   real data change — the signature is re-read from fresh fetches on
   every poll, never nulled or reset. Unchanged payloads → no DOM
   re-render, only the freshness line's clock moves. */
(function () {
  'use strict';
  var DATA = '/data/smart-money-eps.json';
  var HIST = '/data/smart-money-eps-history.json';
  var PAGE_SIZE = 25;
  var STORIES = ['rising', 'falling', 'flat', 'loss-making', 'new', 'none'];
  var STORY_LABEL = {
    'rising': 'Rising earnings', 'falling': 'Falling earnings',
    'flat': 'Flat earnings', 'loss-making': 'Loss-making',
    'new': 'New coverage', 'none': 'No EPS data'
  };
  var SORTS = [
    { v: 'conviction', l: 'Conviction' },
    { v: 'skilled', l: 'Skilled net' },
    { v: 'epschg', l: 'EPS change, year on year' },
    { v: 'eps', l: 'EPS (TTM)' },
    { v: 'pe', l: 'P/E (TTM, low first)' },
    { v: 'sym', l: 'Symbol' }
  ];
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
  function fmtTime(d) {
    try {
      return d.toLocaleTimeString('en-GB',
        { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toLocaleTimeString(); }
  }
  function scrollTo(el) {
    if (!el) return;
    var smooth = true;
    try {
      smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }

  var P = null, HISTD = null;
  var curStory = 'all', curSector = 'all', curSort = 'conviction',
      curSearch = '', curSym = null, curPage = 1, curHistPage = 1;
  var lastSig = null, lastCheck = null, lastCheckOk = true,
      refreshTimer = null;

  function epsDeltaCell(r) {
    if (r.eps_change_pct !== null && r.eps_change_pct !== undefined)
      return pct(r.eps_change_pct);
    if (r.eps_change_pp !== null && r.eps_change_pp !== undefined)
      return pp(r.eps_change_pp);
    return '—';
  }

  function topRow() {
    if (!P || !P.board.length) return null;
    var top = null;
    P.board.forEach(function (r) {
      if (r.conviction_score !== null && r.conviction_score !== undefined &&
          (!top || r.conviction_score > top.conviction_score)) top = r;
    });
    return top || P.board[0];
  }

  function renderHero() {
    var r = topRow();
    if (!r) { $('smeHero').innerHTML = ''; return; }
    var conv = r.conviction_score === null ? 0 : r.conviction_score;
    $('smeHero').innerHTML =
      '<div class="sme-hero-kick">Top conviction · ' + esc(P.asof) + '</div>' +
      '<div class="sme-hero-row"><span class="sme-hero-sym">' + esc(r.symbol) +
      '</span><span class="sme-hero-conv">' + num(r.conviction_score, 2) +
      '</span>' + storyChip(r.eps_story) + '</div>' +
      '<div class="sme-hero-lead">' + esc(r.name || '') +
      ' — led by ' + esc(r.lead_pusher_name || r.lead_pusher || '—') +
      (r.lead_pusher ? ' (' + esc(r.lead_pusher) + ')' : '') +
      (r.lead_pusher_skill !== null && r.lead_pusher_skill !== undefined ?
        ', skill ' + num(r.lead_pusher_skill, 3) : '') +
      '. EPS (TTM) ' + num(r.eps_ttm, 2) +
      (r.eps_latest_quarter ? ' · ' + esc(r.eps_latest_quarter) : '') +
      ' (' + epsDeltaCell(r) + ' year on year).</div>' +
      '<div class="sme-hero-bar"><span class="sme-hero-track"><i style="width:' +
      Math.max(0, Math.min(100, conv)) + '%"></i></span>' +
      '<span class="sme-hero-barlbl">Conviction ' + num(r.conviction_score, 2) +
      ' / 100</span></div>' +
      '<div class="sme-hero-meta"><span>Skilled net ' + money(r.skilled_net_amt) +
      '</span><span>Quality ' + num(r.broker_quality, 2) +
      '</span><span>' + esc(r.sector || '') + '</span><span>' + esc(r.tier || '') +
      (r.conviction_rank ? ' · rank ' + r.conviction_rank : '') + '</span></div>';
  }

  function renderMeta() {
    var m = P.market;
    $('smeSession').textContent = 'Session ' + P.asof + ' · EPS vintage ' +
      P.eps_asof + ' (' + P.eps_period + ')' +
      (P.gap_dates && P.gap_dates.length ?
        ' · flow gap: ' + P.gap_dates.join(', ') : '') + ' · ' + P.status;
    var risingMoney = m.stories.rising ? m.stories.rising.positive_skilled_net : 0;
    var risingShare = m.positive_skilled_net ?
      (100 * risingMoney / m.positive_skilled_net) : 0;
    var top = topRow();
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
    seg.innerHTML = '<button type="button" data-story="all" class="' +
      (curStory === 'all' ? 'on' : '') + '" aria-pressed="' +
      (curStory === 'all') + '">All stories</button>' +
      STORIES.map(function (s) {
        return '<button type="button" data-story="' + s + '" class="' +
          (curStory === s ? 'on' : '') + '" aria-pressed="' +
          (curStory === s) + '">' + esc(STORY_LABEL[s]) +
          ' (' + m.stories[s].symbols + ')</button>';
      }).join('');
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        curStory = b.getAttribute('data-story');
        curPage = 1;
        renderMeta(); renderStoryCards(); renderBoard();
      });
    });
    var sseg = $('sortSeg');
    sseg.innerHTML = SORTS.map(function (o) {
      return '<button type="button" data-sort="' + o.v + '" class="' +
        (curSort === o.v ? 'on' : '') + '" aria-pressed="' +
        (curSort === o.v) + '">' + esc(o.l) + '</button>';
    }).join('');
    sseg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        curSort = b.getAttribute('data-sort');
        curPage = 1;
        renderMeta(); renderBoard();
      });
    });
    var reset = $('storyReset');
    reset.className = 'sme-reset' + (curStory === 'all' ? ' on' : '');
  }

  function topNameForStory(s) {
    var r = null;
    P.board.forEach(function (b) {
      if (b.eps_story === s &&
          (r === null || (b.conviction_score || -1) > (r.conviction_score || -1))) r = b;
    });
    return r;
  }

  function renderStoryCards() {
    var m = P.market;
    $('storyCards').innerHTML = STORIES.map(function (s) {
      var st = m.stories[s];
      var mo = st.momentum_20d;
      var top = topNameForStory(s);
      return '<button type="button" class="sme-story-card' +
        (curStory === s ? ' on' : '') + '" data-story="' + s +
        '" aria-pressed="' + (curStory === s) + '">' +
        '<span class="sme-card-name">' + esc(STORY_LABEL[s]) + '</span>' +
        '<span class="sme-card-count">' + st.symbols + '</span>' +
        '<span class="sme-card-meta">' + money(st.positive_skilled_net) +
        ' positive skilled net · 20d mean ' +
        (mo.mean === null ? '—' : pct(mo.mean)) +
        (mo.median === null ? '' : ' · median ' + pct(mo.median)) +
        ' (n=' + mo.n + ')</span>' +
        '<span class="sme-card-top">' + (top ?
          'Top: ' + esc(top.symbol) + ' — ' + esc(top.name || '') :
          'No stocks on the board') + '</span></button>';
    }).join('');
    $('storyCards').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        curStory = b.getAttribute('data-story');
        curPage = 1;
        renderMeta(); renderStoryCards(); renderBoard();
        scrollTo($('board'));
      });
    });
    $('storyReset').onclick = function () {
      curStory = 'all';
      curPage = 1;
      renderMeta(); renderStoryCards(); renderBoard();
    };
  }

  function renderStoryViz() {
    var m = P.market;
    var rows = STORIES.map(function (s) {
      var st = m.stories[s];
      return { s: s, share: m.positive_skilled_net ?
        (100 * st.positive_skilled_net / m.positive_skilled_net) : 0,
        net: st.positive_skilled_net, n: st.symbols };
    }).sort(function (a, b) { return b.share - a.share; });
    $('storyViz').innerHTML = rows.map(function (r) {
      return '<div class="sme-viz-row"><span class="sme-viz-name">' +
        esc(STORY_LABEL[r.s]) + '</span><span class="sme-viz-track"><i style="width:' +
        Math.max(0, Math.min(100, r.share)) + '%"></i></span>' +
        '<span class="sme-viz-val">' + r.share.toFixed(1) + '% · ' +
        money(r.net) + ' · ' + r.n + ' stocks</span></div>';
    }).join('');
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
          pct(mo.mean) + ' <span style="color:var(--nd-muted)">(n=' +
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
    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (curPage > totalPages) curPage = totalPages;
    if (curPage < 1) curPage = 1;
    var start = (curPage - 1) * PAGE_SIZE;
    var page = rows.slice(start, start + PAGE_SIZE);
    $('boardBody').innerHTML = page.length ? page.map(function (r, i) {
      return '<tr class="sme-rowclick' +
        (r.symbol === curSym ? ' sme-active' : '') +
        '" data-sym="' + esc(r.symbol) + '">' +
        '<td class="num sme-num">' + (start + i + 1) + '</td>' +
        '<td><strong>' + esc(r.symbol) + '</strong><br><span style="color:var(--nd-muted);font-size:12px">' +
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
    var lo = rows.length ? start + 1 : 0, hi = start + page.length;
    $('boardCount').textContent = 'Showing ' + lo + '–' + hi + ' of ' +
      rows.length + ' board stocks' +
      (rows.length !== P.board.length ? ' (filtered from ' + P.board.length + ')' : '') +
      '. Conviction is Link 12\'s ranking, unchanged; ' +
      'Watch / None rows carry no conviction score (Link 12 scores the ' +
      'positive side only) and sort last.';
    $('boardPageNum').textContent = 'Page ' + curPage + ' of ' + totalPages;
    $('boardPrev').disabled = curPage <= 1;
    $('boardNext').disabled = curPage >= totalPages;
  }

  function selectSym(sym) {
    curSym = sym;
    renderBoard();
    renderDetail();
    scrollTo($('detail'));
  }

  function renderSpark(series) {
    var pts = (series || []).filter(function (q) {
      return q.eps_ttm !== null && q.eps_ttm !== undefined;
    });
    if (!pts.length) { $('epsSpark').innerHTML = ''; return; }
    var W = 600, H = 120, PAD = 8;
    var vals = pts.map(function (q) { return q.eps_ttm; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var span = (mx - mn) || 1;
    var xy = pts.map(function (q, i) {
      var x = PAD + (pts.length === 1 ? W / 2 - PAD :
        i * (W - 2 * PAD) / (pts.length - 1));
      var y = H - PAD - ((q.eps_ttm - mn) / span) * (H - 2 * PAD);
      return [x, y];
    });
    var poly = xy.map(function (p) {
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    var dots = xy.map(function (p) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
        '" r="3.5" fill="var(--nd-lime)"/>';
    }).join('');
    $('epsSpark').innerHTML =
      '<svg viewBox="0 0 600 120" role="img" aria-label="EPS (TTM) from ' +
      esc(pts[0].q) + ' (' + num(pts[0].eps_ttm, 2) + ') to ' +
      esc(pts[pts.length - 1].q) + ' (' +
      num(pts[pts.length - 1].eps_ttm, 2) + ')">' +
      '<polyline points="' + poly +
      '" fill="none" stroke="var(--nd-lime)" stroke-width="2.5" ' +
      'stroke-linejoin="round" stroke-linecap="round"/>' + dots + '</svg>' +
      '<div class="sme-spark-note">EPS (TTM) across ' + pts.length +
      ' quarters, oldest to latest — same values as the table below.</div>';
  }

  function renderDetail() {
    var r = null;
    P.board.forEach(function (b) { if (b.symbol === curSym) r = b; });
    if (!r) return;
    var sel = $('symSel');
    sel.innerHTML = P.board.map(function (b) {
      return '<option value="' + esc(b.symbol) + '">' + esc(b.symbol) +
        ' — ' + esc(b.name || '') + '</option>';
    }).join('');
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
    renderSpark(r.eps_series);
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
        '<td><strong>' + esc(d.symbol) + '</strong><br><span style="color:var(--nd-muted);font-size:12px">' +
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
    var maxAbs = 0;
    order.forEach(function (s) {
      var m = Math.abs(f.groups[s].mean_excess_pp || 0);
      if (m > maxAbs) maxAbs = m;
    });
    var bars = order.concat(['pooled']).map(function (s) {
      var g = s === 'pooled' ? f.pooled_skilled : f.groups[s];
      var mean = g.mean_excess_pp;
      var w = (mean === null || !maxAbs) ? 0 :
        Math.max(2, 100 * Math.abs(mean) / maxAbs);
      var lbl = s === 'pooled' ? 'All skilled events' : STORY_LABEL[s];
      return '<div class="sme-fwd-row"><span class="sme-fwd-lbl">' +
        (s === 'pooled' ? '<strong>' + lbl + '</strong>' :
          storyChip(s) + ' ' + esc(lbl)) + '</span>' +
        '<span class="sme-fwd-track"><i class="' +
        ((mean || 0) >= 0 ? 'up' : 'down') + '" style="width:' + w +
        '%"></i></span><span class="sme-fwd-val">n=' + g.n + ' · mean ' +
        pp(mean) + ' · median ' + pp(g.median_excess_pp) + ' · ' +
        (g.share_up_pct === null ? '—' : g.share_up_pct.toFixed(1) + '%') +
        ' ahead</span></div>';
    }).join('');
    $('forwardBars').innerHTML = bars;
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
    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (curHistPage > totalPages) curHistPage = totalPages;
    if (curHistPage < 1) curHistPage = 1;
    var start = (curHistPage - 1) * PAGE_SIZE;
    var page = rows.slice(start, start + PAGE_SIZE);
    $('historyBody').innerHTML = page.length ? page.map(function (e) {
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
    $('histPageNum').textContent = 'Showing ' + (rows.length ? start + 1 : 0) +
      '–' + (start + page.length) + ' of ' + rows.length + ' sessions · Page ' +
      curHistPage + ' of ' + totalPages;
    $('histPrev').disabled = curHistPage <= 1;
    $('histNext').disabled = curHistPage >= totalPages;
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

  function renderFresh() {
    var el = $('smeFresh');
    if (!P) { el.textContent = 'Board freshness: loading…'; return; }
    var checked = lastCheck ? fmtTime(lastCheck) : '—';
    var next = lastCheck ?
      fmtTime(new Date(lastCheck.getTime() + 60000)) : '—';
    el.className = 'sme-fresh' + (lastCheckOk ? '' : ' sme-fresh-fail');
    if (lastCheckOk) {
      el.textContent = 'Board freshness: session as of ' + P.asof +
        ' · EPS vintage ' + P.eps_asof + ' (' + P.eps_period + ')' +
        ' · checked ' + checked + ' · next check ' + next + ' · ' + P.status;
    } else {
      el.textContent = 'Board freshness: last check failed at ' + checked +
        ', showing ' + P.asof + ' · next check ' + next + ' · ' + P.status;
    }
  }

  function renderAll() {
    renderHero(); renderMeta(); renderStoryCards(); renderStoryViz();
    renderStories(); renderBoard(); renderDetail(); renderDivergence();
    renderForward(); renderHistory(); renderMethod();
  }

  /* ---- change-gated refresh: signature from payloads only ---- */
  function refreshSig() {
    if (!P) return null;
    var sumNet = 0, sumConv = 0;
    P.board.forEach(function (r) {
      sumNet += r.skilled_net_amt || 0;
      sumConv += r.conviction_score || 0;
    });
    var top = topRow();
    return [P.asof, P.eps_asof, P.board.length,
      (HISTD.entries || []).length,
      P.forward_by_eps.spread_rising_minus_falling_pp,
      Math.round(sumNet), sumConv.toFixed(2),
      top ? top.symbol : ''].join('|');
  }

  function fetchPayloads() {
    return Promise.all([
      fetch(DATA, { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch(HIST, { cache: 'no-store' }).then(function (r) { return r.json(); })
        .catch(function () { return { entries: [] }; })
    ]);
  }

  function poll() {
    fetchPayloads().then(function (res) {
      P = res[0]; HISTD = res[1];
      var sig = refreshSig();
      lastCheck = new Date(); lastCheckOk = true;
      if (sig !== lastSig) {
        lastSig = sig;
        /* View survives the refresh; only vanished selections reset. */
        var still = P.board.some(function (b) { return b.symbol === curSym; });
        if (!still) curSym = P.board.length ? P.board[0].symbol : null;
        renderAll();
      }
      renderFresh();
    }).catch(function () {
      lastCheck = new Date(); lastCheckOk = false;
      renderFresh();
    });
  }

  function startRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(poll, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  function init() {
    fetchPayloads().then(function (res) {
      P = res[0]; HISTD = res[1];
      curSym = P.board.length ? P.board[0].symbol : null;
      lastSig = refreshSig();
      lastCheck = new Date(); lastCheckOk = true;
      renderAll(); renderFresh();
      startRefresh();
    }).catch(function () {
      $('boardBody').innerHTML = '<tr><td colspan="12" class="sme-loading">' +
        'Board data could not be loaded. Please refresh.</td></tr>';
      $('smeFresh').textContent =
        'Board freshness: failed to load the board: check your connection and reload.';
      $('smeFresh').className = 'sme-fresh sme-fresh-fail';
    });
    $('sectorSel').addEventListener('change', function () {
      curSector = this.value; curPage = 1; renderBoard();
    });
    $('symSearch').addEventListener('input', function () {
      curSearch = this.value.trim(); curPage = 1; renderBoard();
    });
    $('symSel').addEventListener('change', function () {
      curSym = this.value; renderBoard(); renderDetail();
    });
    $('boardPrev').addEventListener('click', function () {
      if (curPage > 1) { curPage -= 1; renderBoard(); }
    });
    $('boardNext').addEventListener('click', function () {
      curPage += 1; renderBoard();
    });
    $('histPrev').addEventListener('click', function () {
      if (curHistPage > 1) { curHistPage -= 1; renderHistory(); }
    });
    $('histNext').addEventListener('click', function () {
      curHistPage += 1; renderHistory();
    });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
