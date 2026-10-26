/* Sector–Symbol Relation — renders data/sector-symbol.json (nd-sector-symbol/v1)
   plus the live forward ledger data/sector-symbol-forward.json when present.
   Static file, no framework; all numbers printed beside every visual.
   Market-aware auto-refresh: re-checks on the market schedule and only
   re-renders when a new board has actually landed; window, sector, sort
   and band selections survive every refresh. */
(function () {
  'use strict';
  var DATA_URL = '/data/sector-symbol.json';
  var FWD_URL = '/data/sector-symbol-forward.json';
  var PAGE_SIZE = 25;
  var state = { days: '30', sector: 'ALL', sort: 'rel', q: '', band: 'all', page: 1, fw: 'all', fwPage: 1 };
  var PAYLOAD = null, FORWARD = null, firstLoad = true, refreshTimer = null;

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
  function cls(x) { return x > 0 ? 'ss-pos' : (x < 0 ? 'ss-neg' : ''); }
  function board() { return PAYLOAD.boards[state.days]; }

  function readURL() {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('window')) state.days = q.get('window');
      if (q.get('sector')) state.sector = q.get('sector');
      if (q.get('sort')) state.sort = q.get('sort');
      if (q.get('band')) state.band = q.get('band');
    } catch (e) { /* URL state is a nicety, never a blocker */ }
  }
  function sanitizeURL() {
    var okDays = PAYLOAD.windows.map(String);
    if (okDays.indexOf(state.days) === -1) state.days = String(PAYLOAD.default_days);
    var names = board().sectors.map(function (s) { return s.sector; });
    if (state.sector !== 'ALL' && names.indexOf(state.sector) === -1) state.sector = 'ALL';
    if (['rel', 'ret', 'secrel', 'sym'].indexOf(state.sort) === -1) state.sort = 'rel';
    if (['all', 'strong_out', 'out', 'flat', 'under', 'strong_under'].indexOf(state.band) === -1) state.band = 'all';
  }
  function writeURL() {
    try {
      var q = new URLSearchParams();
      q.set('window', state.days + 'D');
      if (state.sector !== 'ALL') q.set('sector', state.sector);
      if (state.sort !== 'rel') q.set('sort', state.sort);
      if (state.band !== 'all') q.set('band', state.band);
      history.replaceState(null, '', location.pathname + '?' + q.toString());
    } catch (e) { /* ignore */ }
  }
  function noteDays() {
    // URL carries "30D"; state.days is the bare number.
    if (state.days && state.days.slice(-1) === 'D') state.days = state.days.slice(0, -1);
  }

  function renderStats() {
    var b = board(), s = b.summary, st = b.stability;
    var share = s.priced ? Math.round(1000 * s.outperformers / s.priced) / 10 : 0;
    var rels = b.rows.map(function (r) { return r.rel_return; })
      .sort(function (a, c) { return a - c; });
    var med = rels.length ? rels[Math.floor(rels.length / 2)] : null;
    var stats = [
      { k: 'Window', v: state.days + ' days', s: 'base ' + b.base_date },
      { k: 'Stocks scored', v: String(s.priced), s: 'of ' + PAYLOAD.universe.constituents + ' constituents · ' + s.unscored + ' unscored' },
      { k: 'Ahead of their sector', v: String(s.outperformers), s: share + '% of scored stocks' },
      { k: 'Median relative return', v: pp(med), s: 'half the board sits above this line' }
    ];
    if (st) stats.push({ k: 'Sign persistence · 4 wks', v: st.sign_persistence_pct + '%',
      s: st.snapshots + ' weekly snapshots · trailing 3y · descriptive' });
    document.getElementById('statStrip').innerHTML = stats.map(function (x) {
      return '<div class="cx-stat"><p class="cx-stat-k">' + esc(x.k) +
        '</p><p class="cx-stat-v">' + esc(x.v) +
        '</p><p class="cx-stat-s">' + esc(x.s) + '</p></div>';
    }).join('');
  }

  function renderTabs() {
    document.getElementById('winTabs').innerHTML = PAYLOAD.windows.map(function (d) {
      return '<button type="button" role="tab" aria-selected="' + (String(d) === state.days) + '" data-days="' + d + '"' +
        (String(d) === state.days ? ' class="on"' : '') + '>' + d + 'D</button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#winTabs button'), function (btn) {
        btn.addEventListener('click', function () {
          state.days = btn.getAttribute('data-days'); state.page = 1; writeURL(); renderAll();
        });
      });
  }

  function renderPills() {
    var b = board();
    var pills = [{ name: 'ALL', label: 'All sectors', n: b.summary.priced }].concat(
      b.sectors.map(function (s) { return { name: s.sector, label: s.sector, n: s.priced }; }));
    document.getElementById('sectorPills').innerHTML = pills.map(function (p) {
      return '<button type="button" class="ss-pill' + (state.sector === p.name ? ' on' : '') +
        '" aria-pressed="' + (state.sector === p.name) + '" data-sector="' + esc(p.name) + '">' +
        esc(p.label) + '<span class="ss-pill-n">' + p.n + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#sectorPills button'), function (btn) {
        btn.addEventListener('click', function () {
          state.sector = btn.getAttribute('data-sector'); state.page = 1; writeURL();
          renderPills(); renderBoard(); scrollToBoard();
        });
      });
  }
  function scrollToBoard() {
    var el = document.getElementById('board');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function selectSector(name) {
    state.sector = name; state.page = 1; writeURL(); renderPills(); renderBoard(); scrollToBoard();
  }

  function bandOf(rel) {
    if (rel >= 5) return 'strong_out';
    if (rel > 0) return 'out';
    if (rel === 0) return 'flat';
    if (rel > -5) return 'under';
    return 'strong_under';
  }
  function renderDist() {
    var b = board(), d = b.distribution, total = b.summary.priced || 1;
    var segs = [
      ['strong_out', 'Strong ahead (≥ +5 pp)', d.strong_out, 'var(--nd-up)'],
      ['out', 'Ahead (0 to +5 pp)', d.out, 'color-mix(in srgb, var(--nd-up) 55%, var(--nd-surface))'],
      ['flat', 'Level (0 pp)', d.flat, 'var(--nd-faint)'],
      ['under', 'Behind (−5 to 0 pp)', d.under, 'color-mix(in srgb, var(--nd-down) 55%, var(--nd-surface))'],
      ['strong_under', 'Strong behind (≤ −5 pp)', d.strong_under, 'var(--nd-down)']
    ];
    var bar = segs.map(function (s) {
      var w = 100 * s[2] / total;
      return '<button type="button" class="ss-dist-seg' + (state.band === s[0] ? ' on' : '') +
        '" aria-pressed="' + (state.band === s[0]) + '" title="' + esc(s[1] + ': ' + s[2]) +
        '" data-band="' + s[0] + '" style="width:' + w + '%;background:' + s[3] + '"></button>';
    }).join('');
    var legend = segs.map(function (s) {
      return '<span><span class="ss-dot" style="background:' + s[3] + '"></span>' +
        esc(s[1]) + ' · <b>' + s[2] + '</b> (' +
        (Math.round(1000 * s[2] / total) / 10) + '%)</span>';
    }).join('');
    document.getElementById('distBox').innerHTML =
      '<div class="ss-dist-bar">' + bar + '</div>' +
      '<div class="ss-dist-legend">' + legend + '</div>';
    Array.prototype.forEach.call(
      document.querySelectorAll('#distBox .ss-dist-seg'), function (btn) {
        btn.addEventListener('click', function () {
          var k = btn.getAttribute('data-band');
          state.band = (state.band === k) ? 'all' : k; state.page = 1; writeURL();
          renderDist(); renderBoard();
        });
      });
  }

  function visibleRows() {
    var rows = board().rows.slice();
    if (state.sector !== 'ALL')
      rows = rows.filter(function (r) { return r.sector === state.sector; });
    if (state.band !== 'all')
      rows = rows.filter(function (r) { return bandOf(r.rel_return) === state.band; });
    if (state.q)
      rows = rows.filter(function (r) {
        return r.symbol.toLowerCase().indexOf(state.q.toLowerCase()) !== -1;
      });
    if (state.sort === 'rel') rows.sort(function (a, b) { return b.rel_return - a.rel_return || (a.symbol < b.symbol ? -1 : 1); });
    if (state.sort === 'ret') rows.sort(function (a, b) { return b.return_ - a.return_ || (a.symbol < b.symbol ? -1 : 1); });
    if (state.sort === 'secrel') rows.sort(function (a, b) { return b.sector_return - a.sector_return || (a.symbol < b.symbol ? -1 : 1); });
    if (state.sort === 'sym') rows.sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; });
    return rows;
  }

  function pagerHTML(page, pages, prefix) {
    return '<button type="button" class="ss-pagebtn" data-' + prefix + '-nav="prev"' +
      (page <= 1 ? ' disabled' : '') + '>Prev</button>' +
      '<span class="ss-pageinfo">Page ' + page + ' of ' + pages + '</span>' +
      '<button type="button" class="ss-pagebtn" data-' + prefix + '-nav="next"' +
      (page >= pages ? ' disabled' : '') + '>Next</button>';
  }
  function bindPager(elId, prefix, getPage, setPage, render) {
    var el = document.getElementById(elId);
    Array.prototype.forEach.call(el.querySelectorAll('[data-' + prefix + '-nav]'), function (btn) {
      btn.addEventListener('click', function () {
        var p = getPage() + (btn.getAttribute('data-' + prefix + '-nav') === 'next' ? 1 : -1);
        setPage(p); render();
      });
    });
  }

  function renderBoard() {
    var rows = visibleRows(), total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    var from = total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
    var to = Math.min(total, state.page * PAGE_SIZE);
    document.getElementById('rowCount').textContent =
      'Showing ' + from + '–' + to + ' of ' + total +
      ' scored stocks · ' + state.days + 'D window · session ' + PAYLOAD.asof;
    var slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    document.getElementById('boardBody').innerHTML = slice.map(function (r) {
      return '<tr><td><a href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) +
        '</a></td><td>' + esc(r.sector) + '</td>' +
        '<td class="num ' + cls(r.return_) + '">' + pct(r.return_) + '</td>' +
        '<td class="num">' + pct(r.sector_return) + '</td>' +
        '<td class="num ' + cls(r.rel_return) + '">' + pp(r.rel_return) + '</td>' +
        '<td class="num">#' + r.sector_rank + '</td></tr>';
    }).join('') || '<tr><td colspan="6">No stocks match.</td></tr>';
    document.getElementById('boardPager').innerHTML = pagerHTML(state.page, pages, 'b');
    bindPager('boardPager', 'b', function () { return state.page; },
      function (p) { state.page = p; }, renderBoard);
  }

  function rankList(el, rows, inverted) {
    var max = Math.max.apply(null, rows.map(function (r) {
      return Math.abs(r.rel_return);
    }).concat([0.01]));
    document.getElementById(el).innerHTML = rows.map(function (r, i) {
      var share = Math.max(2, Math.round(100 * Math.abs(r.rel_return) / max));
      var fill = inverted
        ? 'background:var(--nd-down);margin-left:auto;width:' + share + '%'
        : 'background:var(--nd-up);width:' + share + '%';
      return '<li class="cx-rank-row"><span class="cx-rank-n">' + (i + 1) +
        '</span><span class="cx-rank-name"><a href="/stocks/' + esc(r.symbol) +
        '/">' + esc(r.symbol) + '</a> <span class="cx-rank-sym">' +
        esc(r.sector) + '</span><span class="cx-rank-sub">stock ' + pct(r.return_) +
        ' · sector ' + pct(r.sector_return) + '</span></span><span class="cx-rank-val ' +
        cls(r.rel_return) + '">' + pp(r.rel_return) +
        '</span><span class="cx-rank-track"><span class="cx-rank-fill" style="' +
        fill + '"></span></span></li>';
    }).join('');
  }

  function renderExtremes() {
    var b = board();
    rankList('topList', b.top, false);
    rankList('botList', b.bottom, true);
  }

  function renderSectors() {
    var secs = board().sectors;
    var max = Math.max.apply(null, secs.map(function (s) { return Math.abs(s.sector_return); }).concat([0.01]));
    document.getElementById('secVis').innerHTML = secs.map(function (s) {
      var w = 50 * Math.abs(s.sector_return) / max;
      var fill = s.sector_return >= 0
        ? 'left:50%;width:' + w + '%;background:var(--nd-up)'
        : 'left:' + (50 - w) + '%;width:' + w + '%;background:var(--nd-down)';
      return '<button type="button" class="ss-secbar" data-sector="' + esc(s.sector) + '">' +
        '<span class="ss-secbar-name">' + esc(s.sector) + '</span>' +
        '<span class="ss-secbar-track"><span class="ss-secbar-zero"></span>' +
        '<span class="ss-secbar-fill" style="' + fill + '"></span></span>' +
        '<span class="ss-secbar-val ' + cls(s.sector_return) + '">' + pct(s.sector_return) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#secVis .ss-secbar'), function (btn) {
        btn.addEventListener('click', function () { selectSector(btn.getAttribute('data-sector')); });
      });
    document.getElementById('sectorBody').innerHTML = secs.map(function (s) {
      var share = s.priced ? Math.round(100 * s.outperformers / s.priced) : 0;
      return '<tr class="ss-clickrow" tabindex="0" data-sector="' + esc(s.sector) + '"><td>' + esc(s.sector) + '</td>' +
        '<td class="num ' + cls(s.sector_return) + '">' + pct(s.sector_return) + '</td>' +
        '<td class="num">' + s.priced + ' / ' + s.constituents + '</td>' +
        '<td class="ss-sharecell"><span class="ss-sharetext">' +
          s.outperformers + ' ahead · ' + share + '%</span>' +
          '<div class="ss-sharebar"><div class="ss-sharefill" style="width:' +
          share + '%"></div></div></td>' +
        '<td class="num ' + cls(s.median_rel_return) + '">' + pp(s.median_rel_return) + '</td>' +
        '<td>' + (s.leader ? '<a href="/stocks/' + esc(s.leader.symbol) + '/">' +
          esc(s.leader.symbol) + '</a> <span class="' + cls(s.leader.rel_return) +
          '">' + pp(s.leader.rel_return) + '</span>' : '—') + '</td>' +
        '<td>' + (s.laggard ? '<a href="/stocks/' + esc(s.laggard.symbol) + '/">' +
          esc(s.laggard.symbol) + '</a> <span class="' + cls(s.laggard.rel_return) +
          '">' + pp(s.laggard.rel_return) + '</span>' : '—') + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#sectorBody .ss-clickrow'), function (tr) {
        var go = function () { selectSector(tr.getAttribute('data-sector')); };
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
      });
  }

  function renderStability() {
    document.getElementById('stabBody').innerHTML = PAYLOAD.windows.map(function (d) {
      var st = PAYLOAD.boards[String(d)].stability;
      if (!st) return '<tr><td>' + d + 'D</td><td class="num" colspan="3">—</td></tr>';
      return '<tr><td>' + d + 'D</td><td class="num">' + st.snapshots + '</td>' +
        '<td class="num">' + st.sign_persistence_pct + '%</td>' +
        '<td class="num">' + st.top_decile_still_positive_pct + '%</td></tr>';
    }).join('');
  }

  function fwFiltered() {
    var list = (FORWARD && FORWARD.entries) ? FORWARD.entries.slice() : [];
    if (state.fw === 'resolved') list = list.filter(function (e) { return e.resolved; });
    if (state.fw === 'pending') list = list.filter(function (e) { return !e.resolved; });
    list.sort(function (a, b) {
      return (a.board_date < b.board_date ? 1 : a.board_date > b.board_date ? -1 : b.window - a.window);
    });
    return list;
  }
  function renderForward() {
    var wrap = document.getElementById('fwTableWrap');
    var prow = document.getElementById('fwPagerow');
    var box = document.getElementById('fwBox');
    if (!FORWARD || !FORWARD.entries) {
      document.getElementById('fwSum').textContent = '';
      document.getElementById('fwPills').innerHTML = '';
      document.getElementById('fwCount').textContent = '';
      wrap.style.display = 'none'; prow.style.display = 'none';
      box.innerHTML = '<p class="ss-fwnote">Forward tracking arrives with the next data publish. ' +
        'The relation board above is unaffected.</p>';
      return;
    }
    wrap.style.display = ''; prow.style.display = ''; box.innerHTML = '';
    var entries = FORWARD.entries;
    var resolved = entries.filter(function (e) { return e.resolved; });
    var leadHit = 0, leadTot = 0, signHit = 0, signTot = 0;
    resolved.forEach(function (e) {
      leadHit += e.leaders_still_ahead_28d || 0; leadTot += e.leaders_resolved_total || 0;
      signHit += e.sign_hits || 0; signTot += e.sign_n || 0;
    });
    var leadPct = leadTot ? (Math.round(1000 * leadHit / leadTot) / 10) + '%' : '—';
    var signPct = signTot ? (Math.round(1000 * signHit / signTot) / 10) + '%' : '—';
    document.getElementById('fwSum').innerHTML =
      '<b>' + entries.length + '</b> calls tracked · <b>' + resolved.length + '</b> resolved · ' +
      '<b>' + (entries.length - resolved.length) + '</b> pending · leaders still ahead <b>' + leadPct + '</b> · ' +
      'realized sign persistence <b>' + signPct + '</b>';
    var counts = { all: entries.length, resolved: resolved.length, pending: entries.length - resolved.length };
    document.getElementById('fwPills').innerHTML = ['all', 'resolved', 'pending'].map(function (k) {
      var label = k === 'all' ? 'All' : k === 'resolved' ? 'Resolved' : 'Pending';
      return '<button type="button" class="ss-pill' + (state.fw === k ? ' on' : '') +
        '" aria-pressed="' + (state.fw === k) + '" data-fw="' + k + '">' + label +
        '<span class="ss-pill-n">' + counts[k] + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#fwPills button'), function (btn) {
        btn.addEventListener('click', function () {
          state.fw = btn.getAttribute('data-fw'); state.fwPage = 1; renderForward();
        });
      });
    var list = fwFiltered(), total = list.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.fwPage > pages) state.fwPage = pages;
    if (state.fwPage < 1) state.fwPage = 1;
    var from = total === 0 ? 0 : (state.fwPage - 1) * PAGE_SIZE + 1;
    var to = Math.min(total, state.fwPage * PAGE_SIZE);
    document.getElementById('fwCount').textContent =
      'Showing ' + from + '–' + to + ' of ' + total + ' tracked calls';
    var slice = list.slice((state.fwPage - 1) * PAGE_SIZE, state.fwPage * PAGE_SIZE);
    document.getElementById('fwBody').innerHTML = slice.map(function (e) {
      var leaders = e.leaders.slice(0, 3).join(', ') +
        (e.leaders.length > 3 ? ' + ' + (e.leaders.length - 3) + ' more' : '');
      var ahead = e.resolved ? e.leaders_still_ahead_28d + ' / ' + e.leaders_resolved_total : '—';
      var sign = e.resolved ? e.sign_persistence_28d + '%' : '—';
      var status = e.resolved ? 'Resolved ' + e.resolution_board_date : 'Pending';
      return '<tr><td>' + esc(e.board_date) + '</td><td class="num">' + e.window + 'D</td>' +
        '<td>' + esc(leaders) + '</td><td class="num">' + ahead + '</td>' +
        '<td class="num">' + sign + '</td><td>' + esc(status) + '</td></tr>';
    }).join('') || '<tr><td colspan="6">No tracked calls match.</td></tr>';
    document.getElementById('fwPager').innerHTML = pagerHTML(state.fwPage, pages, 'f');
    bindPager('fwPager', 'f', function () { return state.fwPage; },
      function (p) { state.fwPage = p; }, renderForward);
  }

  function renderMethod() {
    var b = board();
    document.getElementById('covText').textContent =
      'The board scores ' + b.summary.priced + ' of ' + PAYLOAD.universe.constituents +
      ' sector constituents on the ' + state.days + 'D window (all windows: ' +
      PAYLOAD.windows.map(function (d) {
        return d + 'D ' + PAYLOAD.boards[String(d)].summary.priced;
      }).join(' · ') + ').';
    var un = PAYLOAD.windows.map(function (d) {
      var u = PAYLOAD.boards[String(d)].unscored;
      return d + 'D: ' + (u.length ? u.join(', ') : 'none');
    }).join(' · ');
    document.getElementById('unscoredText').textContent = un + '.';
  }

  function renderAll() {
    renderTabs(); renderPills(); renderStats(); renderDist();
    renderBoard(); renderExtremes(); renderSectors(); renderStability();
    renderForward(); renderMethod();
  }

  function initSession() {
    var el = document.getElementById('ssSession');
    if (el) el.textContent = 'Session ' + PAYLOAD.asof +
      ' · end-of-day board, rebuilt after every close · source: ' +
      PAYLOAD.source;
  }

  function marketDelay() {
    var now = new Date(), day = now.getDay();
    var h = now.getHours() + now.getMinutes() / 60;
    if (day === 0 || day === 6) return 2 * 3600 * 1000;
    if (h >= 11 && h < 15) return 5 * 60 * 1000;
    return 30 * 60 * 1000;
  }
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(tickRefresh, marketDelay());
  }
  function tickRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (document.hidden) { scheduleRefresh(); return; }
    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (p) {
        var changed = !PAYLOAD || p.asof !== PAYLOAD.asof;
        PAYLOAD = p;
        if (changed) { sanitizeURL(); renderAll(); initSession(); }
        return fetch(FWD_URL, { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (f) { FORWARD = f; renderForward(); })
          .catch(function () { /* forward file may not exist yet; board stands */ });
      })
      .catch(function () { /* keep showing the last good board */ })
      .then(scheduleRefresh);
  }

  document.getElementById('sortSel').addEventListener('change', function (e) {
    state.sort = e.target.value; state.page = 1; writeURL(); renderBoard();
  });
  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value; state.page = 1; renderBoard();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tickRefresh();
  });

  readURL(); noteDays();
  fetch(DATA_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (p) {
      PAYLOAD = p;
      if (firstLoad) { sanitizeURL(); firstLoad = false; }
      renderAll(); initSession(); scheduleRefresh();
      return fetch(FWD_URL, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (f) { FORWARD = f; renderForward(); })
        .catch(function () { FORWARD = null; renderForward(); });
    })
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="6">The relation board could not be loaded (' +
        esc(e.message) + ').</td></tr>';
    });
})();
