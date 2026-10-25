/* Stock–Sector Sentiment — renders data/stock-sector-sentiment.json
   (nd-stock-sector-sentiment/v1). Static file, no framework; all numbers
   printed beside every visual. */
(function () {
  'use strict';
  var DATA_URL = '/data/stock-sector-sentiment.json?v=9a14e547';
  var PAGE_SIZE = 25;
  var state = { win: '20', sector: 'ALL', sort: 'score', q: '', horizon: '10', page: 1 };
  var PAYLOAD = null;

  function readUrlState() {
    try {
      var p = new URLSearchParams(window.location.search);
      if (p.get('win')) state.win = p.get('win');
      if (p.get('sector')) state.sector = p.get('sector');
      if (p.get('sort')) state.sort = p.get('sort');
      if (p.get('q')) state.q = p.get('q');
      if (p.get('page')) state.page = Math.max(1, parseInt(p.get('page'), 10) || 1);
    } catch (e) { /* share links stay optional */ }
  }
  function syncUrlState() {
    try {
      var p = new URLSearchParams();
      if (state.win !== '20') p.set('win', state.win);
      if (state.sector !== 'ALL') p.set('sector', state.sector);
      if (state.sort !== 'score') p.set('sort', state.sort);
      if (state.q) p.set('q', state.q);
      if (state.page > 1) p.set('page', String(state.page));
      var qs = p.toString();
      history.replaceState(null, '', qs ? ('?' + qs) : window.location.pathname);
    } catch (e) { /* non-fatal */ }
  }

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

  function renderHero() {
    var b = board(), s = b.summary;
    var mean = s.mean_score;
    var band = mean >= 80 ? 'Strong Bullish' : mean >= 60 ? 'Bullish' :
      mean >= 40 ? 'Neutral' : mean >= 20 ? 'Bearish' : 'Strong Bearish';
    document.getElementById('snHeroWin').textContent = state.win + ' sessions';
    document.getElementById('snHeroNum').textContent = num(mean, 1);
    var bandEl = document.getElementById('snHeroBand');
    bandEl.textContent = band;
    bandEl.className = 'sn-state ' + stateCls(band);
    document.getElementById('snHeroSub').textContent =
      'median stock ' + num(s.median_score, 1) + ' · strongest sector ' +
      (s.top_sector || '—') + ' · weakest ' + (s.bottom_sector || '—');
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
          state.win = btn.getAttribute('data-win'); state.page = 1;
          renderAll(); syncUrlState();
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

  function bandDotCls(s) {
    return s === 'Strong Bullish' ? 'wd-up' : s === 'Bullish' ? 'wd-mild' :
      s === 'Neutral' ? 'wd-flat' : 'wd-down';
  }

  function renderAuto() {
    var t = PAYLOAD.tracking;
    var built = PAYLOAD.built_at ?
      PAYLOAD.built_at.replace('T', ' ').slice(0, 16) + ' NPT' : 'after the last close';
    document.getElementById('autoSub').textContent =
      'Session ' + PAYLOAD.asof + ' · board built ' + built +
      ' · next board after the next session\'s close, around 16:38 NPT. ' +
      'During market hours this page still shows the last close\'s board.';
    var steps = [
      ['01 · Rebuild', 'After every close the Python builder recomputes all three windows from the OHLC archive.'],
      ['02 · Categorise', 'Every stock is scored 0–100, banded from Strong Bullish to Strong Bearish, and placed in a score quintile.'],
      ['03 · Archive', 'The day\'s board is appended to the board archive, never edited after the fact.'],
      ['04 · Resolve', 'As sessions close, each archived reading\'s 5, 10 and 20-session horizons resolve against its own sector.']
    ];
    document.getElementById('autoSteps').innerHTML = steps.map(function (s) {
      return '<div class="sn-auto-step"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>';
    }).join('');
    document.getElementById('autoNote').textContent = t && t.latest ?
      'Tracking so far: ' + t.sessions_tracked + ' sessions archived · ' +
      t.resolved_outcomes.toLocaleString('en-IN') + ' resolved quintile-horizon cells. ' +
      'Latest session ' + t.latest.asof + ' (' + t.latest.scored + ' stocks): all three ' +
      'horizons pending — each resolves when that many sessions have closed after it. ' +
      'Nothing here is typed in by hand: the daily run is a deterministic script, and the page reads only the published files.'
      : 'Tracking starts with the next daily build: the archive and the cohort ledger grow one session at a time, by script, never by hand.';
  }

  function renderTable() {
    var rows = visibleRows();
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var from = (state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(from, from + PAGE_SIZE);
    var byWin = {};
    ['5', '20', '60'].forEach(function (w) {
      var m = {};
      ((PAYLOAD.boards[w] || {}).rows || []).forEach(function (r) { m[r.symbol] = r.state; });
      byWin[w] = m;
    });
    var dots = function (r) {
      var parts = ['5', '20', '60'].map(function (w) {
        var st = byWin[w][r.symbol];
        return '<i class="sn-windot ' + bandDotCls(st || 'Neutral') + '" title="' +
          w + ' sessions: ' + esc(st || 'unscored') + '"></i>';
      }).join('');
      var label = ['5', '20', '60'].map(function (w) {
        return w + ' sessions: ' + (byWin[w][r.symbol] || 'unscored');
      }).join('; ');
      return '<span class="sn-windots" aria-label="' + esc(label) + '">' + parts + '</span>';
    };
    document.getElementById('boardCount').textContent =
      'Showing ' + (total ? (from + 1) : 0) + '–' + (from + pageRows.length) +
      ' of ' + total + ' stocks' +
      (state.sector !== 'ALL' ? ' in ' + state.sector : '') +
      ' · ' + state.win + '-session window · session ' + PAYLOAD.asof;
    document.getElementById('boardBody').innerHTML = pageRows.map(function (r) {
      return '<tr><td class="num sn-stick-first">' + r.rank + '</td>' +
        '<td class="sn-sym sn-stick"><a href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a>' +
        (r.name ? '<span class="sn-name">' + esc(r.name) + '</span>' : '') + '</td>' +
        '<td class="sn-sector">' + esc(r.sector) +
        '<span class="sn-sub">sector rank #' + r.sector_rank + '</span></td>' +
        '<td class="num"><span class="sn-score"><span class="sn-gauge" aria-hidden="true">' +
        '<i style="--pos:' + r.score + '%"></i></span><b>' + num(r.score, 1) + '</b></span></td>' +
        '<td><span class="sn-state ' + stateCls(r.state) + '">' + esc(r.state) + '</span></td>' +
        '<td>' + dots(r) + '</td>' +
        '<td class="num ' + cls(r.rel_mom_pp) + '">' + pp(r.rel_mom_pp) +
        '<span class="sn-sub">stock ' + pct(r.stock_ret_pct) + ' · sector ' + pct(r.sector_ret_pct) + '</span></td>' +
        '<td class="num ' + cls(r.up_edge_pp) + '">' + pp(r.up_edge_pp) +
        '<span class="sn-sub">stock ' + num(r.up_share_pct, 1) + '% · sector ' + num(r.sector_up_share_pct, 1) + '%</span></td>' +
        '<td class="num ' + cls(r.flow_edge) + '">' + num(r.flow_edge, 3) +
        '<span class="sn-sub">stock ' + num(r.flow_pressure, 3) + ' · sector ' + num(r.sector_flow_pressure, 3) + '</span></td>' +
        '<td class="num">' + num(r.close, 2) + '</td>' +
        '<td class="num ' + cls(r.change_pct) + '">' + pct(r.change_pct) + '</td></tr>';
    }).join('') || '<tr><td colspan="11" class="sn-loading">No stocks match.</td></tr>';
    var pager = document.getElementById('boardPager');
    pager.innerHTML = '<button type="button" class="sn-pagebtn" data-pg="prev" aria-label="Previous page"' +
      (state.page <= 1 ? ' disabled' : '') + '>‹ Prev</button>' +
      '<span class="sn-pagenum">Page ' + state.page + ' of ' + pages + '</span>' +
      '<button type="button" class="sn-pagebtn" data-pg="next" aria-label="Next page"' +
      (state.page >= pages ? ' disabled' : '') + '>Next ›</button>';
    Array.prototype.forEach.call(pager.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-pg') === 'prev' && state.page > 1) state.page -= 1;
        if (btn.getAttribute('data-pg') === 'next' && state.page < pages) state.page += 1;
        syncUrlState(); renderTable();
        document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    var wrap = document.querySelector('#board .sn-tablewrap');
    var hint = document.getElementById('scrollHint');
    if (wrap && hint) hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
    var b = board();
    document.getElementById('coverageNote').textContent =
      'The board scores ' + b.summary.scored + ' of ' + PAYLOAD.universe.constituents +
      ' sector constituents on the ' + state.win + '-session window (all windows: ' +
      PAYLOAD.windows.map(function (w) {
        return w + ' sessions ' + PAYLOAD.boards[String(w)].summary.scored;
      }).join(' · ') + '). Unscored names are listed under Methodology.';
  }

  function renderCards() {
    var b = board();
    var rows = b.rows;
    document.getElementById('sectorCardsBody').innerHTML =
      b.sectors.map(function (s) {
        var top = rows.filter(function (r) { return r.sector === s.sector; }).slice(0, 5);
        var active = state.sector === s.sector;
        return '<button type="button" class="sn-card' + (active ? ' active' : '') +
          '" data-sector="' + esc(s.sector) + '" aria-pressed="' + active + '">' +
          '<span class="sn-card-head"><span class="sn-card-name">' + esc(s.sector) + '</span>' +
          '<span class="sn-card-mean">' + num(s.mean_score, 1) + '</span></span>' +
          '<span class="sn-meanbar sn-card-bar" aria-hidden="true"><i style="width:' + s.mean_score + '%"></i></span>' +
          '<span class="sn-card-meta">breadth ≥ 50: ' + num(s.breadth_pos_pct, 1) + '% · ' +
          s.scored + ' of ' + s.constituents + ' scored</span>' +
          '<span class="sn-card-meta">leader ' + esc(s.leader.symbol) + ' · ' + num(s.leader.score, 1) +
          ' · laggard ' + esc(s.laggard.symbol) + ' · ' + num(s.laggard.score, 1) + '</span>' +
          '<span class="sn-card-stocks">' + top.map(function (r) {
            return '<span class="sn-card-row"><span class="sn-card-sym">' + esc(r.symbol) + '</span>' +
              '<span class="sn-card-score">' + num(r.score, 1) + '</span></span>';
          }).join('') + '</span>' +
          '<span class="sn-card-cta">' + (active ? 'Showing in the board ↓' : 'Show in the board ↓') + '</span></button>';
      }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#sectorCardsBody .sn-card'), function (btn) {
        btn.addEventListener('click', function () {
          state.sector = btn.getAttribute('data-sector'); state.page = 1;
          renderAll(); syncUrlState();
          document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
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
    document.getElementById('sectorChart').innerHTML =
      board().sectors.map(function (s) {
        return '<div class="sn-srow"><span class="sn-srow-label">#' + s.rank + ' ' + esc(s.sector) + '</span>' +
          '<span class="sn-strack" aria-hidden="true"><i class="sn-sbar" style="width:' + s.mean_score + '%"></i></span>' +
          '<span class="sn-sval"><b>' + num(s.mean_score, 1) + '</b><span>breadth ' + num(s.breadth_pos_pct, 1) + '%</span></span></div>';
      }).join('');
    document.getElementById('sectorBody').innerHTML =
      board().sectors.map(function (s) {
        return '<tr><td class="sn-sector" style="color:var(--nd-text);font-weight:700">' +
          '<span class="sn-sub" style="display:inline;margin-right:6px">#' + s.rank + '</span>' + esc(s.sector) + '</td>' +
          '<td class="num">' + num(s.mean_score, 1) +
          '<span class="sn-meanbar" aria-hidden="true"><i style="width:' + s.mean_score + '%"></i></span></td>' +
          '<td class="num">' + num(s.median_score, 1) + '</td>' +
          '<td class="num">' + num(s.breadth_pos_pct, 1) + '% · ' + s.scored + ' of ' + s.constituents + ' scored</td>' +
          '<td class="num">' + num(s.pct_ahead_pct, 1) + '%</td>' +
          '<td class="num ' + cls(s.sector_ret_pct) + '">' + pct(s.sector_ret_pct) +
          '<span class="sn-sub">flow pressure ' + num(s.sector_flow_pressure, 3) + '</span></td>' +
          '<td>' + (s.leader ? '<a href="/stocks/' + esc(s.leader.symbol) + '/">' +
            esc(s.leader.symbol) + '</a> · ' + num(s.leader.score, 1) : '—') + '</td>' +
          '<td>' + (s.laggard ? '<a href="/stocks/' + esc(s.laggard.symbol) + '/">' +
            esc(s.laggard.symbol) + '</a> · ' + num(s.laggard.score, 1) : '—') + '</td></tr>';
      }).join('');
  }

  function renderTracking() {
    var t = PAYLOAD.tracking;
    if (!t || !t.latest) {
      document.getElementById('trackingSub').textContent =
        'Live cohort tracking starts with the next daily build: each published board\'s score quintiles are followed to their closes 5, 10 and 20 sessions later, measured against each stock\'s own sector.';
      document.getElementById('trackingBody').innerHTML =
        '<tr><td colspan="6" class="sn-loading">No live cohorts recorded yet.</td></tr>';
      document.getElementById('trackingNote').textContent = '';
      document.getElementById('trackingLatest').innerHTML = '';
      document.getElementById('cohortChart').innerHTML = '';
      return;
    }
    var latest = t.latest;
    document.getElementById('trackingSub').textContent =
      'Every published board since tracking began, split into score quintiles at the reading and followed to its closes 5, 10 and 20 sessions later, against each stock\'s own sector. ' +
      t.sessions_tracked + ' sessions tracked · ' + t.resolved_outcomes + ' resolved quintile-horizon cells.';
    var qLabel = ['Q1 · lowest scores', 'Q2', 'Q3', 'Q4', 'Q5 · highest scores'];
    var cell = function (c) {
      return c ? pp(c.mean_rel_fwd_pct) + '<span class="sn-sub">' + num(c.pct_positive, 1) + '% beat their sector</span>'
        : 'pending<span class="sn-sub">horizon not reached</span>';
    };
    document.getElementById('trackingLatest').innerHTML =
      '<p class="sn-note" style="margin-top:0">Latest tracked session ' + esc(latest.asof) +
      ' (' + latest.scored + ' stocks) — every horizon still pending:</p>' +
      '<div class="sn-pending">' + qLabel.map(function (label, qi) {
        var q = String(qi + 1);
        var outs = latest.outcomes;
        return '<span class="sn-pend"><b>' + label + '</b> · 5: ' +
          (outs['5'][q] ? pp(outs['5'][q].mean_rel_fwd_pct) : 'pending') + ' · 10: ' +
          (outs['10'][q] ? pp(outs['10'][q].mean_rel_fwd_pct) : 'pending') + ' · 20: ' +
          (outs['20'][q] ? pp(outs['20'][q].mean_rel_fwd_pct) : 'pending') + '</span>';
      }).join('') + '</div>';
    var maxAbs = 0.01;
    ['5', '10', '20'].forEach(function (h) {
      qLabel.forEach(function (_, qi) {
        var c = t.aggregate[h][String(qi + 1)];
        if (c) maxAbs = Math.max(maxAbs, Math.abs(c.mean_rel_fwd_pct));
      });
    });
    var gline = function (h, c) {
      if (!c) return '<span class="sn-gtag">' + h + '</span><span class="sn-gtrack"></span><span class="sn-gval">pending</span>';
      var w = Math.max(2, Math.round(100 * Math.abs(c.mean_rel_fwd_pct) / maxAbs));
      return '<span class="sn-gtag">' + h + '</span><span class="sn-gtrack" aria-hidden="true">' +
        '<i class="sn-gbar ' + (c.mean_rel_fwd_pct < 0 ? 'neg' : 'pos') + '" style="width:' + w + '%"></i></span>' +
        '<span class="sn-gval">' + pp(c.mean_rel_fwd_pct) + '</span>';
    };
    document.getElementById('cohortChart').innerHTML =
      qLabel.map(function (label, qi) {
        var q = String(qi + 1);
        return '<div class="sn-grow"><span class="sn-grow-label">' + label + '</span><span class="sn-glines">' +
          '<span class="sn-gline">' + gline('5', t.aggregate['5'][q]) + '</span>' +
          '<span class="sn-gline">' + gline('10', t.aggregate['10'][q]) + '</span>' +
          '<span class="sn-gline">' + gline('20', t.aggregate['20'][q]) + '</span></span></div>';
      }).join('') +
      '<p class="sn-glegend">Bars are mean forward return vs sector; longer = further from the sector. Pending = that horizon has not closed yet.</p>';
    document.getElementById('trackingBody').innerHTML =
      qLabel.map(function (label, qi) {
        var q = String(qi + 1);
        var a = t.aggregate;
        var sess = a['5'][q] ? a['5'][q].sessions : 0;
        var mem = a['5'][q] ? a['5'][q].total_n : 0;
        return '<tr><td>' + label + '</td>' +
          '<td class="num">' + sess + '</td><td class="num">' + mem.toLocaleString('en-IN') + '</td>' +
          '<td class="num ' + cls(a['5'][q] ? a['5'][q].mean_rel_fwd_pct : 0) + '">' + cell(a['5'][q]) + '</td>' +
          '<td class="num ' + cls(a['10'][q] ? a['10'][q].mean_rel_fwd_pct : 0) + '">' + cell(a['10'][q]) + '</td>' +
          '<td class="num ' + cls(a['20'][q] ? a['20'][q].mean_rel_fwd_pct : 0) + '">' + cell(a['20'][q]) + '</td></tr>';
      }).join('');
    var h10 = t.aggregate['10'];
    var spread = (h10['5'] && h10['1']) ?
      pp(h10['5'].mean_rel_fwd_pct - h10['1'].mean_rel_fwd_pct) : '—';
    document.getElementById('trackingNote').textContent =
      'Aggregate cells are the mean of session means (each session counts once). ' +
      'Top-minus-bottom spread at 10 sessions: ' + spread + '. ' +
      'A cohort never closes because a later board flipped a stock\'s score — only the horizon close resolves it, exactly like the weekly replay above it in method but on the published daily boards.';
  }

  function renderForward() {
    var f = PAYLOAD.forward, h = f.horizons[state.horizon];
    document.getElementById('forwardSub').textContent =
      'The 20-session construction recomputed at ' + f.snapshots +
      ' weekly snapshots, ' + f.era_start + ' to ' + f.era_end +
      ', each reading\'s forward return measured against the stock\'s own ' +
      'sector. ' + f.basis;
    var maxAbs = 0.01;
    h.quintiles.forEach(function (q) { maxAbs = Math.max(maxAbs, Math.abs(q.mean_rel_fwd_pct)); });
    document.getElementById('forwardChart').innerHTML = h.quintiles.map(function (q) {
      var label = ['Q1 · lowest scores', 'Q2', 'Q3', 'Q4', 'Q5 · highest scores'][q.quintile - 1];
      var w = Math.max(2, Math.round(100 * Math.abs(q.mean_rel_fwd_pct) / maxAbs));
      return '<div class="sn-hrow"><span class="sn-hrow-label">' + label + '</span>' +
        '<span class="sn-htrack" aria-hidden="true"><i class="sn-hbar ' +
        (q.mean_rel_fwd_pct < 0 ? 'neg' : 'pos') + '" style="width:' + w + '%"></i></span>' +
        '<span class="sn-hval">' + pp(q.mean_rel_fwd_pct) + '</span></div>';
    }).join('');
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
      ['Coverage', m.coverage],
      ['The live cohorts', 'Starting with the 2025-07-01 backfill, every daily 20-session board is archived as a lean snapshot (score, band, score quintile, sector per stock). Each archived session\'s quintiles are followed to their closes 5, 10 and 20 sessions later, measured against each stock\'s own sector index — the same bar-step convention and the same over-15%-single-session corporate-action guard as the weekly replay, but on the published daily boards. A horizon with no resolvable observation yet reads "pending", never zero. Aggregate cells are the mean of session means, so a session with many members cannot dominate the average. The archive and the cohort ledger are published alongside the board; the page reads only the small tracking summary.']
    ];
    document.getElementById('methodBox').innerHTML = blocks.map(function (b) {
      var wide = b[0] === 'The live cohorts' ? ' sn-method-wide' : '';
      return '<div class="sn-method-card' + wide + '"><h3>' + esc(b[0]) + '</h3><p>' + esc(b[1]) + '</p></div>';
    }).join('') + '<div class="sn-method-card sn-method-foot"><h3>Source</h3><p>' +
      esc(PAYLOAD.source) + '.</p></div>';
    var un = PAYLOAD.windows.map(function (w) {
      var u = PAYLOAD.boards[String(w)].unscored;
      return w + ' sessions: ' + (u.length ? u.join(', ') : 'none');
    }).join(' · ');
    document.getElementById('unscoredText').textContent =
      'Unscored on session ' + PAYLOAD.asof + ' — ' + un + '.';
  }

  function renderAll() {
    renderTabs(); renderSectorOptions(); renderHero(); renderStats(); renderDist();
    renderAuto();
    renderTable(); renderCards(); renderExtremes(); renderSectors(); renderTracking(); renderForward();
    renderHistory(); renderMethod();
  }

  function initSession() {
    var el = document.getElementById('snSession');
    if (el) el.textContent = 'Session ' + PAYLOAD.asof +
      ' · end-of-day board, rebuilt after every close · source: ' +
      PAYLOAD.source;
  }

  document.getElementById('sectorSel').addEventListener('change', function (e) {
    state.sector = e.target.value; state.page = 1; renderAll(); syncUrlState();
  });
  document.getElementById('sortSel').addEventListener('change', function (e) {
    state.sort = e.target.value; state.page = 1; renderTable(); syncUrlState();
  });
  document.getElementById('symSearch').addEventListener('input', function (e) {
    state.q = e.target.value; state.page = 1; renderTable(); syncUrlState();
  });

  fetch(DATA_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) {
      PAYLOAD = p; state.win = String(p.default_window);
      state.horizon = p.forward.horizons['10'] ? '10' : Object.keys(p.forward.horizons)[0];
      readUrlState();
      if (PAYLOAD.boards[state.win] === undefined) state.win = String(p.default_window);
      if (state.sector !== 'ALL' &&
        PAYLOAD.boards[state.win].sectors.every(function (s) { return s.sector !== state.sector; }))
        state.sector = 'ALL';
      document.getElementById('symSearch').value = state.q;
      renderAll(); initSession(); syncUrlState();
    })
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="11" class="sn-loading">The sentiment board could not be loaded (' +
        esc(e.message) + ').</td></tr>';
    });
})();
