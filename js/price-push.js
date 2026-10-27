/* Price Push — renders /data/price-push-{window}.json (+ history ledger).
   All numbers come from the payload; nothing is computed client-side
   except ordering, filtering and display formatting/aggregation
   (sector grouping, histogram buckets, ranked viz bars).
   Payload shape is nd-price-push/v1 (see tools/build-price-push.py).
   AUTO-REFRESH (change-gated, 60s manifest poll): the refresh
   signature is the manifest SHAs for the current window, the 30-day
   forward payload, and the history ledger. View state (window, sector,
   sort, search, pages, selected stock) NEVER touches that signature,
   so a view change cannot swallow a real data change — the signature
   is re-read from the manifest on every poll, never nulled or reset
   by a render. Unchanged payloads: no DOM re-render, only the
   freshness line's clock moves. */
(function () {
  'use strict';
  var WINDOWS = [1, 7, 15, 30, 90, 180, 365];
  var SORTS = [
    { v: 'return', lbl: 'Price return' },
    { v: 'share', lbl: 'Lead pusher share' },
    { v: 'net', lbl: 'Net buying' },
    { v: 'turnover', lbl: 'Turnover' },
    { v: 'impact', lbl: 'Impact per crore' },
    { v: 'sym', lbl: 'Symbol' }
  ];
  var VT = '?v=20261024b'; // fallback only; the manifest wins when it loads
  var SHAS = null; // {windows: {w: sha8}, history: sha8} from the manifest
  function dataUrl(w) {
    var v = (SHAS && SHAS.windows && SHAS.windows[w]) ? '?v=' + SHAS.windows[w] : VT;
    return '/data/price-push-' + w + '.json' + v;
  }
  function histUrl() {
    var v = (SHAS && SHAS.history) ? '?v=' + SHAS.history : VT;
    return '/data/price-push-history.json' + v;
  }
  function loadManifest() {
    // Tiny file, fetched no-store: it carries the per-payload SHA stamp,
    // so a board published after tonight's close can never hide behind
    // yesterday's cached JSON. A failed fetch falls back to the old VT.
    return fetch('/data/price-push-manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { SHAS = j; return j; })
      .catch(function () { SHAS = null; return null; });
  }
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
  function shareBar(p) {
    var w = Math.max(0, Math.min(100, p || 0));
    return '<span class="pp-share"><span class="pp-sharebar"><i style="width:' +
      w.toFixed(1) + '%"></i></span>' + w.toFixed(1) + '%</span>';
  }
  function skilledChip(r) {
    if (r && r.in_skilled_cohort)
      return ' <span class="pp-skilled">Skilled</span>';
    return '';
  }
  function statCard(n, lbl, sub) {
    return '<div class="cx-stat"><div class="num">' + n + '</div>' +
      '<div class="lbl">' + lbl + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }
  function hhmm(d) {
    return ('0' + d.getHours()).slice(-2) + ':' +
      ('0' + d.getMinutes()).slice(-2);
  }

  var P = null, P30 = null, HISTD = null;
  var curWin = 30, curSector = 'all', curSort = 'return', curSearch = '';
  var curSym = null;
  var curPage = 0, secPage = 0, histPage = 0, PER_PAGE = 25;
  var lastCheck = null, lastCheckOk = true, refreshTimer = null;

  /* ---- page-owned freshness line: tape freshness, distinct from the
     shared badge (badge = live/manifest session state) ---- */
  function renderFresh() {
    var el = $('ppFresh');
    if (!el) return;
    if (!P) { el.textContent = 'Loading the board…'; return; }
    var checked = lastCheck ? hhmm(lastCheck) : '—';
    var next = lastCheck ?
      hhmm(new Date(lastCheck.getTime() + 60000)) : '—';
    var manAs = (SHAS && SHAS.asof) ? SHAS.asof : '—';
    if (lastCheckOk) {
      el.textContent = 'Board freshness: board as of ' + P.asof + ' · ' +
        P.status + ' · checked ' + checked + ' · next check ' + next +
        ' · manifest as of ' + manAs;
    } else {
      el.textContent = 'Board freshness: last check failed at ' + checked +
        ' — showing the ' + P.asof + ' board (last good) · next check ' +
        next + ' · manifest as of ' + manAs;
    }
  }

  function renderMeta() {
    var m = P.market;
    $('statStrip').innerHTML =
      statCard(m.risers, 'Stocks pushed up',
        'of ' + m.symbols_traded + ' traded') +
      statCard(money(m.risers_turnover), 'Pushed turnover',
        'risers only') +
      statCard(money(m.risers_net_buying), 'Net buying in risers',
        'sum of positive broker nets') +
      statCard((m.median_lead_share_pct === null ? '—' :
        m.median_lead_share_pct.toFixed(1) + '%'), 'Median lead share',
        'lead pusher share of net buying') +
      statCard(m.top_riser || '—', 'Top riser',
        P.board.length ? pct(P.board[0].return_pct) : '');
    $('coverageNote').textContent =
      'Window covers ' + P.sessions_in_window + ' trading sessions' +
      '; archive starts ' + P.archive_start +
      (P.partial ? '; the window reaches before the floorsheet archive ' +
        'starts (' + P.archive_start + '), so long-window returns are ' +
        'measured from each stock\'s first available close and marked ' +
        'partial' : '') +
      (P.gap_dates && P.gap_dates.length ?
        '; 2026-10-07 has broker totals only, so windows spanning it ' +
        'understate flow.' : '');
  }

  function renderHero() {
    var host = $('heroPush');
    if (!host) return;
    var top = P.board.length ? P.board[0] : null;
    if (!top) { host.innerHTML = ''; return; }
    var ld = top.lead;
    var ldName = ld ? esc(ld.name || ld.broker) + ' (' + ld.broker + ')' : '—';
    host.innerHTML =
      '<div class="pp-hero-kick">Top push · ' + P.window_days + '-day window</div>' +
      '<div class="pp-hero-row"><span class="pp-hero-sym">' + top.symbol + '</span>' +
      '<span class="pp-hero-ret">' + pct(top.return_pct) + '</span>' +
      (top.partial ? '<span class="pp-hero-part">partial — from ' +
        top.base_date + '</span>' : '') + '</div>' +
      '<div class="pp-hero-lead">Led by <b>' + ldName + '</b>' +
      (ld ? ' · ' + ld.share_pct.toFixed(1) + '% of the net buying' : '') + '</div>' +
      (ld ? '<div class="pp-hero-bar"><span class="pp-hero-track"><i style="width:' +
        Math.max(0, Math.min(100, ld.share_pct)).toFixed(1) + '%"></i></span>' +
        '<span class="pp-hero-barlbl">lead share ' + ld.share_pct.toFixed(1) + '%</span></div>' : '') +
      '<div class="pp-hero-meta"><span>Net buying ' + money(top.net_buying) + '</span>' +
      '<span>Turnover ' + money(top.turnover) + '</span>' +
      '<span>Impact ' + (top.impact_pp_per_crore === null ? '—' :
        pp(top.impact_pp_per_crore) + '/cr') + '</span>' +
      '<span>Close ' + num(top.close, 2) + '</span></div>';
  }

  function sectorGroups() {
    var g = {};
    P.board.forEach(function (r) {
      var s = r.sector || 'Unclassified';
      if (!g[s]) g[s] = { name: s, rows: [], net: 0, turnover: 0 };
      g[s].rows.push(r);
      g[s].net += r.net_buying;
      g[s].turnover += r.turnover;
    });
    var tot = P.board.reduce(function (a, r) { return a + r.net_buying; }, 0);
    return Object.keys(g).sort(function (a, b) {
      return g[b].rows.length - g[a].rows.length;
    }).map(function (s) {
      var grp = g[s];
      var top = grp.rows.slice().sort(function (a, b) {
        return b.return_pct - a.return_pct;
      })[0];
      var shares = grp.rows.map(function (r) {
        return r.lead ? r.lead.share_pct : 0;
      }).sort(function (a, b) { return a - b; });
      var med = shares.length ? shares[Math.floor(shares.length / 2)] : 0;
      return { name: s, rows: grp.rows, count: grp.rows.length,
        net: grp.net, turnover: grp.turnover, top: top,
        medianLead: med, netShare: tot ? 100 * grp.net / tot : 0 };
    });
  }

  /* Shared pager: Prev quiet, Next lime primary, real buttons. */
  function pagerHtml(page, totalPages) {
    return '<button type="button" class="pp-pagebtn pp-prev" data-dir="-1"' +
      (page === 0 ? ' disabled' : '') + '>← Prev</button>' +
      '<span class="pp-pagenum">Page ' + (page + 1) + ' of ' +
      totalPages + '</span>' +
      '<button type="button" class="pp-pagebtn pp-next" data-dir="1"' +
      (page >= totalPages - 1 ? ' disabled' : '') + '>Next →</button>';
  }
  function bindPager(hostId, getPage, setPage, render) {
    Array.prototype.forEach.call(
      document.querySelectorAll('#' + hostId + ' .pp-pagebtn'),
      function (b) {
        b.addEventListener('click', function () {
          setPage(getPage() + parseInt(b.getAttribute('data-dir'), 10));
          render();
        });
      });
  }

  function renderSectorBlock() {
    var grid = $('sectorGrid');
    if (!grid || !P) return;
    var groups = sectorGroups();
    if (curSector !== 'all' && !groups.some(function (g) {
      return g.name === curSector;
    })) {
      curSector = 'all';
      secPage = 0;
    }
    grid.innerHTML = groups.map(function (gr) {
      var on = curSector === gr.name;
      return '<button type="button" class="pp-sector-card' + (on ? ' on' : '') +
        '" aria-pressed="' + on + '" data-sector="' + esc(gr.name) + '">' +
        '<span class="pp-sec-name">' + esc(gr.name) + '</span>' +
        '<span class="pp-sec-count">' + gr.count + '</span>' +
        '<span class="pp-sec-meta">stocks pushed · top ' + gr.top.symbol +
        ' ' + pct(gr.top.return_pct) + '</span>' +
        '<span class="pp-sec-bar"><i style="width:' +
        Math.max(0, Math.min(100, gr.netShare)).toFixed(1) + '%"></i></span>' +
        '<span class="pp-sec-meta">Net buying ' + money(gr.net) +
        ' · median lead ' + gr.medianLead.toFixed(1) + '%</span></button>';
    }).join('');
    var resetBtn = $('secReset');
    if (resetBtn) {
      resetBtn.className = 'pp-sec-reset' + (curSector === 'all' ? ' on' : '');
      resetBtn.setAttribute('aria-pressed', String(curSector === 'all'));
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('#sectorGrid .pp-sector-card'),
      function (btn) {
        btn.addEventListener('click', function () {
          curSector = btn.getAttribute('data-sector');
          secPage = 0; curPage = 0;
          renderSectorBlock();
          renderBoard();
        });
      });
    renderSectorViz(groups);
    renderSectorList(groups);
  }

  /* Ranked net-buying share bars: which sector dominates the flow. */
  function renderSectorViz(groups) {
    var host = $('sectorViz');
    if (!host) return;
    var ranked = groups.slice().sort(function (a, b) {
      return b.netShare - a.netShare;
    });
    host.innerHTML = ranked.map(function (gr) {
      return '<div class="pp-secviz-row"><span class="pp-secviz-name">' +
        esc(gr.name) + '</span><span class="pp-secviz-track"><i style="width:' +
        Math.max(0, Math.min(100, gr.netShare)).toFixed(1) + '%"></i></span>' +
        '<span class="pp-secviz-val">' + gr.netShare.toFixed(1) + '% · ' +
        money(gr.net) + '</span></div>';
    }).join('');
  }

  function sectorRow(r, i, withSector) {
    var ld = r.lead;
    var ldTxt = ld ? esc(ld.name || ld.broker) + ' (' + ld.broker + ')' +
      skilledChip(ld) : '—';
    return '<tr class="pp-rowclick" data-sym="' + r.symbol + '">' +
      '<td class="num">' + (i + 1) + '</td>' +
      (withSector ? '<td>' + esc(r.sector || '—') + '</td>' : '') +
      '<td><b>' + r.symbol + '</b></td>' +
      '<td class="num">' + pct(r.return_pct) + '</td>' +
      '<td class="num">' + num(r.close, 2) + '</td>' +
      '<td>' + ldTxt + '</td>' +
      '<td class="num">' + (ld ? shareBar(ld.share_pct) : '—') + '</td>' +
      '<td class="num">' + num(r.top3_share_pct, 1) + '%</td>' +
      '<td class="num">' + money(r.net_buying) + '</td>' +
      '<td class="num">' + money(r.turnover) + '</td>' +
      '<td class="num">' + (r.impact_pp_per_crore === null ? '—' :
        pp(r.impact_pp_per_crore) + '/cr') + '</td></tr>';
  }

  function renderSectorList(groups) {
    var head = $('sectorHead'), body = $('sectorBody'),
      cap = $('sectorCount'), pager = $('sectorPager');
    if (!head || !body) return;
    if (curSector === 'all') {
      head.innerHTML = 'Every sector\u2019s top riser — ' +
        groups.length + ' sectors pushed stocks this window.';
      body.innerHTML = groups.map(function (gr, i) {
        return sectorRow(gr.top, i, true);
      }).join('');
      cap.textContent = groups.length + ' sectors · one top riser each · ' +
        'pick a sector card above to see all its pushed stocks.';
      if (pager) pager.innerHTML = '';
    } else {
      var gr = null;
      groups.forEach(function (g) { if (g.name === curSector) gr = g; });
      if (!gr) { body.innerHTML = ''; cap.textContent = ''; return; }
      head.innerHTML = esc(gr.name) + ' — ' + gr.count +
        ' pushed stocks · net buying ' + money(gr.net) +
        ' · top riser ' + gr.top.symbol + ' ' + pct(gr.top.return_pct);
      var rows = gr.rows.slice().sort(function (a, b) {
        return b.return_pct - a.return_pct;
      });
      var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
      if (secPage >= totalPages) secPage = totalPages - 1;
      if (secPage < 0) secPage = 0;
      var start = secPage * PER_PAGE;
      body.innerHTML = rows.slice(start, start + PER_PAGE).map(function (r, i) {
        return sectorRow(r, start + i, true);
      }).join('');
      var end = Math.min(rows.length, start + PER_PAGE);
      cap.textContent = 'Showing ' + (start + 1) + '–' + end + ' of ' +
        rows.length + ' risers in ' + gr.name + ' on the ' +
        P.window_days + '-day window.';
      if (pager) {
        pager.innerHTML = pagerHtml(secPage, totalPages);
        bindPager('sectorPager', function () { return secPage; },
          function (v) { secPage = v; },
          function () { renderSectorList(groups); });
      }
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('#sectorBody tr[data-sym]'),
      function (tr) {
        tr.addEventListener('click', function () {
          selectSymbol(tr.getAttribute('data-sym'));
        });
      });
  }

  function renderSortSeg() {
    var host = $('sortSeg');
    if (!host) return;
    host.innerHTML = SORTS.map(function (s) {
      var on = s.v === curSort;
      return '<button type="button" class="pp-sortbtn' + (on ? ' on' : '') +
        '" aria-pressed="' + on + '" data-sort="' + s.v + '">' +
        s.lbl + '</button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#sortSeg .pp-sortbtn'),
      function (b) {
        b.addEventListener('click', function () {
          curSort = b.getAttribute('data-sort');
          curPage = 0;
          renderSortSeg();
          renderBoard();
        });
      });
  }

  function boardRows() {
    var rows = P.board.filter(function (r) {
      if (curSector !== 'all' && r.sector !== curSector) return false;
      if (curSearch) {
        var q = curSearch.toLowerCase();
        if (r.symbol.toLowerCase().indexOf(q) < 0 &&
            (r.name || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = {
      'return': function (r) { return -r.return_pct; },
      'share': function (r) { return -(r.lead ? r.lead.share_pct : 0); },
      'net': function (r) { return -r.net_buying; },
      'turnover': function (r) { return -r.turnover; },
      'impact': function (r) {
        return -(r.impact_pp_per_crore === null ? -1e9 :
          r.impact_pp_per_crore);
      },
      'sym': function (r) { return r.symbol; }
    }[curSort];
    rows.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
    return rows;
  }

  function renderBoard() {
    var rows = boardRows();
    var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (curPage >= totalPages) curPage = totalPages - 1;
    if (curPage < 0) curPage = 0;
    var start = curPage * PER_PAGE;
    var pageRows = rows.slice(start, start + PER_PAGE);
    $('boardBody').innerHTML = pageRows.map(function (r, i) {
      var ld = r.lead;
      var ldTxt = ld ? esc(ld.name || ld.broker) + ' (' + ld.broker + ')' +
        skilledChip(ld) : '—';
      var ret = pct(r.return_pct) + (r.partial ?
        ' <span title="Measured from ' + r.base_date +
        ', the stock\'s first available close, not the window start">*</span>' : '');
      return '<tr class="pp-rowclick" data-sym="' + r.symbol + '">' +
        '<td class="num">' + (start + i + 1) + '</td>' +
        '<td><b>' + r.symbol + '</b></td>' +
        '<td>' + esc(r.sector || '—') + '</td>' +
        '<td class="num">' + ret + '</td>' +
        '<td class="num">' + num(r.close, 2) + '</td>' +
        '<td>' + ldTxt + '</td>' +
        '<td class="num">' + (ld ? shareBar(ld.share_pct) : '—') + '</td>' +
        '<td class="num">' + num(r.top3_share_pct, 1) + '%</td>' +
        '<td class="num">' + money(r.net_buying) + '</td>' +
        '<td class="num">' + money(r.turnover) + '</td>' +
        '<td class="num">' + (r.impact_pp_per_crore === null ? '—' :
          pp(r.impact_pp_per_crore) + '/cr') + '</td></tr>';
    }).join('') || '<tr><td colspan="11" class="pp-loading">' +
      'No risers match the filter.</td></tr>';
    var end = rows.length ? Math.min(rows.length, start + PER_PAGE) : 0;
    $('boardCount').textContent = 'Showing ' + (rows.length ? start + 1 : 0) +
      '–' + end + ' of ' + rows.length + ' risers' +
      (rows.length !== P.board.length ? ' (filtered from ' + P.board.length + ')' : '') +
      ' · * partial: return measured from the stock\'s first available ' +
      'close (see Methodology).';
    var pager = $('boardPager');
    if (pager) {
      pager.innerHTML = pagerHtml(curPage, totalPages);
      bindPager('boardPager', function () { return curPage; },
        function (v) { curPage = v; }, renderBoard);
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('#boardBody tr[data-sym]'),
      function (tr) {
        tr.addEventListener('click', function () {
          selectSymbol(tr.getAttribute('data-sym'));
        });
      });
  }

  /* Lead-share histogram: ten buckets over the window board's lead
     shares (display aggregation only; counts + bars from payload rows). */
  function renderLeadHist() {
    var host = $('leadHist');
    if (!host || !P) return;
    var buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    P.board.forEach(function (r) {
      var s = r.lead ? r.lead.share_pct : 0;
      buckets[Math.min(9, Math.floor(s / 10))] += 1;
    });
    var mx = Math.max.apply(null, buckets.concat([1]));
    host.innerHTML = buckets.map(function (c, i) {
      var lo = i * 10, hi = (i + 1) * 10;
      return '<div class="pp-leadhist-row"><span class="pp-leadhist-bucket">' +
        lo + '–' + hi + '%</span><span class="pp-leadhist-track"><i style="width:' +
        (c / mx * 100).toFixed(1) + '%"></i></span>' +
        '<span class="pp-leadhist-count">' + c + '</span></div>';
    }).join('');
  }

  function renderDetail() {
    if (!curSym || !P.symbols[curSym]) {
      $('detailHead').textContent = 'Select a stock from the board';
      $('detailStats').innerHTML = '';
      $('ladderList').innerHTML = '';
      $('pushBody').innerHTML = '<tr><td colspan="6" class="pp-loading">' +
        'Pick a stock above.</td></tr>';
      $('sellerNote').textContent = '';
      return;
    }
    var d = P.symbols[curSym];
    $('detailHead').textContent = curSym + (d.name ? ' — ' + d.name : '');
    $('detailStats').innerHTML =
      statCard(pct(d.return_pct), 'Return, ' + P.window_days + 'd',
        d.partial ? 'partial, from ' + d.base_date : 'window return') +
      statCard(num(d.close, 2), 'Close',
        d.base_close !== null ? 'from ' + num(d.base_close, 2) : '') +
      statCard(money(d.net_buying), 'Net buying',
        d.n_pushers + ' pushers') +
      statCard(money(d.turnover), 'Turnover', 'window') +
      statCard(d.lead ? d.lead.share_pct.toFixed(1) + '%' : '—',
        'Lead pusher share',
        d.lead ? (d.lead.name || d.lead.broker) : '') +
      statCard(d.impact_pp_per_crore === null ? '—' :
        pp(d.impact_pp_per_crore) + '/cr', 'Impact per crore',
        'return pp per Rs 1 crore net buying');
    $('ladderList').innerHTML = (d.ladder || []).map(function (L) {
      return '<li><span class="lbl">' + L.days + ' days</span>' +
        '<span class="val">' + (L.lead_name || L.lead_broker || '—') +
        '</span><br><span class="lbl">' +
        (L.lead_share_pct === null ? '—' :
          L.lead_share_pct.toFixed(1) + '% share') + ' · ' +
        pct(L.return_pct) + ' · ' + money(L.net_buying) +
        ' net buying</span></li>';
    }).join('');
    $('pushBody').innerHTML = d.pushers.map(function (r) {
      return '<tr><td>' + esc(r.name || r.broker) + ' (' + r.broker +
        ')' + skilledChip(r) + '</td>' +
        '<td class="num">' + qty(r.net_qty) + '</td>' +
        '<td class="num">' + money(r.net_amt) + '</td>' +
        '<td class="num">' + shareBar(r.share_pct) + '</td>' +
        '<td class="num">' + num(r.avg_buy, 2) + '</td>' +
        '<td>' + (r.in_skilled_cohort ? 'Skilled cohort' :
          (r.skill_board === null || r.skill_board === undefined ? '—' :
            'Skill ' + r.skill_board.toFixed(2))) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="pp-loading">' +
      'No net buyers in this window.</td></tr>';
    $('sellerNote').textContent = d.n_sellers + ' brokers net-sold this ' +
      'stock over the window; their selling is the mirror side of the ' +
      'push (every buy has a seller). The full net table lives on the ' +
      'Zero-Sum board.';
  }

  function renderForward() {
    if (!P30 || !P30.forward) {
      $('forwardSub').textContent = 'Forward study loads with the ' +
        '30-day board.';
      return;
    }
    var f = P30.forward;
    $('forwardSub').textContent = '30-day window at weekly snapshots ' +
      f.era_start + ' to ' + f.era_end + ' (' + f.snapshots +
      ' snapshots) — what each reading was followed by over the next ' +
      '10 sessions. Descriptive only.';
    function row(lbl, s) {
      return '<tr><td>' + lbl + '</td><td class="num">' + s.n +
        '</td><td class="num">' + pp(s.mean_fwd_pct) +
        '</td><td class="num">' + pp(s.median_fwd_pct) +
        '</td><td class="num">' + (s.share_up_pct === null ? '—' :
          s.share_up_pct.toFixed(1) + '%') + '</td></tr>';
    }
    $('forwardBody').innerHTML =
      row('Dominant push — lead pusher held ≥ 50% of net buying',
        f.dominant_push) +
      row('Other risers — lead pusher below 50%', f.other_risers);
    $('forwardNote').textContent = 'Spread (dominant minus other): ' +
      pp(f.spread_dom_minus_rest_pp) + '. ' + f.note +
      ' Dominant-push readings are few (n=' + f.dominant_push.n +
      '); treat the gap as measured description, not a signal.';
    var bars = $('forwardBars');
    if (bars) {
      var mx = Math.max(Math.abs(f.dominant_push.mean_fwd_pct || 0),
        Math.abs(f.other_risers.mean_fwd_pct || 0), 0.01);
      function fwdBar(lbl, s) {
        var v = s.mean_fwd_pct;
        var w = v === null ? 0 : Math.abs(v) / mx * 100;
        var cls = v === null ? '' : (v >= 0 ? ' up' : ' down');
        return '<div class="pp-fwd-row"><span class="pp-fwd-lbl">' + lbl +
          '</span><span class="pp-fwd-track"><i class="' +
          cls + '" style="width:' + w.toFixed(1) + '%"></i></span>' +
          '<span class="pp-fwd-val">mean ' + (v === null ? '—' : pp(v)) +
          ' · median ' + pp(s.median_fwd_pct) + ' · n=' + s.n +
          '</span></div>';
      }
      bars.innerHTML = fwdBar('Dominant push', f.dominant_push) +
        fwdBar('Other risers', f.other_risers);
    }
  }

  function renderHistory() {
    if (!HISTD) return;
    var entries = HISTD.entries.slice().reverse();
    var totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    if (histPage >= totalPages) histPage = totalPages - 1;
    if (histPage < 0) histPage = 0;
    var start = histPage * PER_PAGE;
    $('historyBody').innerHTML = entries.slice(start, start + PER_PAGE).map(
      function (e) {
        return '<tr><td>' + e.asof + '</td><td class="num">' + e.risers +
          '</td><td class="num">' + money(e.risers_turnover) +
          '</td><td class="num">' + money(e.risers_net_buying) +
          '</td><td>' + (e.top_riser || '—') +
          (e.top_riser_return_pct !== undefined ?
            ' (' + pct(e.top_riser_return_pct) + ')' : '') +
          '</td><td class="num">' + (e.median_lead_share_pct === null ?
            '—' : e.median_lead_share_pct.toFixed(1) + '%') + '</td></tr>';
      }).join('');
    var cap = $('historyCap');
    if (cap) cap.textContent = HISTD.note || '';
    var pager = $('historyPager');
    if (pager) {
      if (totalPages > 1) {
        pager.innerHTML = pagerHtml(histPage, totalPages);
        bindPager('historyPager', function () { return histPage; },
          function (v) { histPage = v; }, renderHistory);
      } else {
        pager.innerHTML = '';
      }
    }
    var bars = $('historyBars');
    if (bars) {
      var mx = 0;
      HISTD.entries.forEach(function (e) {
        mx = Math.max(mx, e.risers || 0);
      });
      bars.innerHTML = HISTD.entries.map(function (e) {
        var h = mx ? (e.risers || 0) / mx * 100 : 0;
        return '<div class="pp-hist-bar"><span class="pp-hist-n">' +
          (e.risers || 0) + '</span><span class="pp-hist-col"><i style="height:' +
          h.toFixed(1) + '%"></i></span><span class="pp-hist-d">' +
          e.asof.slice(5) + '</span></div>';
      }).join('');
    }
  }

  function renderMethod() {
    var m = P.method;
    $('methodBox').innerHTML =
      '<p><strong>The definition.</strong> A stock is "being pushed up" ' +
      'in a window when its adjusted-final close rose over that window. ' +
      'Its <em>pushers</em> are the brokers that net-bought it in the ' +
      'window, ranked by net amount, lead first. ' + m.pusher + '</p>' +
      '<p><strong>Push share.</strong> ' + m.push_share + ' The top-3 ' +
      'share is the combined share of the three largest pushers.</p>' +
      '<p><strong>Impact per crore.</strong> ' + m.impact + ' It is ' +
      'published alongside the attribution because the parked question ' +
      'behind this feature asked whether push means price-per-rupee; ' +
      'the commercial board\'s own schema text says push means ' +
      '<em>who</em> is driving the stock up, so the attribution is the ' +
      'feature and the impact figure is ours, labelled as such.</p>' +
      '<p><strong>Prices.</strong> ' + m.prices + ' A return marked ' +
      'partial is measured from the stock\'s first available close, ' +
      'not the window start (recent listings on long windows).</p>' +
      '<p><strong>Skilled flag.</strong> ' + m.skill_flag + '</p>' +
      '<p><strong>Gaps.</strong> ' + m.gaps + ' A window that reaches ' +
      'before the archive start is partial for the whole board; a ' +
      'window spanning 2026-10-07 understates flow for every name.</p>' +
      '<p><strong>Source.</strong> ' + esc(P.source) + '</p>' +
      '<p><strong>What this is not.</strong> Flow beside a rise does not ' +
      'prove the flow caused the rise. A lead pusher can be one large ' +
      'buyer, a broker acting for many clients, or both — the tape ' +
      'records brokers, not the investors behind them.</p>';
    var unscored = P.market.symbols_traded;
    $('unscoredText').textContent = 'Coverage: ' + unscored +
      ' symbols traded in the window; names with no adjusted close on ' +
      'the window-end session carry no return and cannot appear on a ' +
      'risers board. Nothing is interpolated.';
  }

  function renderTabs() {
    // .on AND aria-selected are set from the same state on every render,
    // so the lime pill and the selected flag can never disagree.
    $('winTabs').innerHTML = WINDOWS.map(function (w) {
      return '<button type="button" class="pp-wintab' +
        (w === curWin ? ' on' : '') + '" role="tab" aria-selected="' +
        (w === curWin) + '" data-w="' + w + '">' + w + 'D</button>';
    }).join('');
    Array.prototype.forEach.call(
      document.querySelectorAll('#winTabs button'), function (b) {
        b.addEventListener('click', function () {
          loadWindow(parseInt(b.getAttribute('data-w'), 10));
        });
      });
  }

  function selectSymbol(sym) {
    curSym = sym;
    var sel = $('symSel');
    if (sel.value !== sym) sel.value = sym;
    Array.prototype.forEach.call(
      document.querySelectorAll('#boardBody tr[data-sym]'),
      function (tr) {
        tr.classList.toggle('pp-active',
          tr.getAttribute('data-sym') === sym);
      });
    renderDetail();
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth' });
  }

  function renderAll() {
    renderMeta();
    renderHero();
    renderBoard();
    renderSectorBlock();
    renderLeadHist();
    renderForward();
    renderHistory();
    renderMethod();
    renderFresh();
  }

  function loadWindow(w) {
    curWin = w;
    return fetch(dataUrl(w)).then(function (r) { return r.json(); })
      .then(function (j) {
        P = j;
        curPage = 0;
        secPage = 0;
        renderTabs();
        renderMeta();
        renderHero();
        renderBoard();
        renderSectorBlock();
        renderLeadHist();
        var sel = $('symSel');
        var keep = curSym;
        sel.innerHTML = '<option value="">— pick a stock —</option>' +
          Object.keys(P.symbols).sort().map(function (s) {
            return '<option value="' + s + '">' + s +
              (P.symbols[s].name ? ' — ' + esc(P.symbols[s].name) : '') +
              '</option>';
          }).join('');
        if (keep && P.symbols[keep]) {
          sel.value = keep;
        } else {
          curSym = P.board.length ? P.board[0].symbol : null;
          sel.value = curSym || '';
        }
        renderDetail();
        renderMethod();
        renderFresh();
      });
  }

  /* ---- change-gated refresh ---- */
  function refreshSig() {
    if (!SHAS || !SHAS.windows) return null;
    return [SHAS.windows[curWin], SHAS.windows[30], SHAS.history].join('|');
  }
  function pollManifest() {
    // Hidden tabs skip the poll entirely; becoming visible re-polls at
    // once (see the visibilitychange handler in init).
    if (document.hidden) return Promise.resolve();
    var oldSig = refreshSig();
    return loadManifest().then(function () {
      lastCheck = new Date();
      if (!SHAS) { lastCheckOk = false; renderFresh(); return; }
      lastCheckOk = true;
      var newSig = refreshSig();
      if (oldSig !== null && newSig === oldSig) {
        // Unchanged payloads: no DOM re-render, only the clock moves.
        renderFresh();
        return;
      }
      return Promise.all([
        fetch(dataUrl(curWin)).then(function (r) { return r.json(); }),
        fetch(dataUrl(30)).then(function (r) { return r.json(); }),
        fetch(histUrl()).then(function (r) { return r.json(); })
      ]).then(function (parts) {
        P = parts[0];
        P30 = parts[1];
        HISTD = parts[2];
        // View state survives the refresh; only vanished selections
        // fall back (sector gone -> all, stock gone -> board top).
        if (curSector !== 'all' &&
            !P.board.some(function (r) { return r.sector === curSector; })) {
          curSector = 'all';
          secPage = 0;
        }
        if (curSym && !P.symbols[curSym]) {
          curSym = P.board.length ? P.board[0].symbol : null;
          $('symSel').value = curSym || '';
        }
        renderAll();
      }).catch(function () {
        // Failed refresh keeps the last-good board; the freshness line
        // says so plainly and the next cycle retries.
        lastCheckOk = false;
        renderFresh();
      });
    }).catch(function () {
      lastCheck = new Date();
      lastCheckOk = false;
      renderFresh();
    });
  }
  function startRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(pollManifest, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pollManifest();
    });
  }

  function init() {
    loadManifest().then(function () {
      lastCheck = new Date();
      renderTabs();
      renderSortSeg();
      var fwd = fetch(dataUrl(30)).then(function (r) { return r.json(); })
        .then(function (j) { P30 = j; renderForward(); });
      var hist = fetch(histUrl()).then(function (r) { return r.json(); })
        .then(function (j) { HISTD = j; renderHistory(); });
      $('symSearch').addEventListener('input', function (e) {
        curSearch = e.target.value.trim(); curPage = 0; renderBoard();
      });
      $('secReset').addEventListener('click', function () {
        curSector = 'all'; secPage = 0; curPage = 0;
        renderSectorBlock();
        renderBoard();
      });
      $('symSel').addEventListener('change', function (e) {
        if (e.target.value) selectSymbol(e.target.value);
      });
      loadWindow(30).then(function () {
        return Promise.all([fwd, hist]);
      }).then(function () {
        renderFresh();
        startRefresh();
      }).catch(function (err) {
        lastCheckOk = false;
        renderFresh();
        var el = $('ppFresh');
        if (el) el.textContent = 'Board freshness: failed to load the board: ' + err;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
