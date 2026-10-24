/* Price Push — renders /data/price-push-{window}.json (+ history ledger).
   All numbers come from the payload; nothing is computed client-side
   except ordering, filtering and display formatting. Payload shape is
   nd-price-push/v1 (see tools/build-price-push.py). */
(function () {
  'use strict';
  var WINDOWS = [1, 7, 15, 30, 90, 180, 365];
  var VT = '?v=20261024b';
  function dataUrl(w) { return '/data/price-push-' + w + '.json' + VT; }
  var HIST = '/data/price-push-history.json' + VT;
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

  var P = null, P30 = null, HISTD = null;
  var curWin = 30, curSector = 'all', curSort = 'return', curSearch = '';
  var curSym = null;

  function renderMeta() {
    var m = P.market;
    $('ppSession').textContent = 'Session ' + P.asof + ' · ' +
      P.window_days + '-day window (' + P.window_start + ' to ' +
      P.window_end + ')' + (P.partial ? ' · partial window' : '') +
      (P.gap_dates && P.gap_dates.length ?
        ' · flow gap: ' + P.gap_dates.join(', ') : '') + ' · FINAL';
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
      (P.partial ? '; the window reaches before the floorsheet archive ' +
        'starts (' + P.archive_start + '), so long-window returns are ' +
        'measured from each stock\'s first available close and marked ' +
        'partial' : '') +
      (P.gap_dates && P.gap_dates.length ?
        '; 2026-10-07 has broker totals only, so windows spanning it ' +
        'understate flow.' : '');
    var secs = {};
    P.board.forEach(function (r) { if (r.sector) secs[r.sector] = 1; });
    var sel = $('sectorSel');
    var keep = sel.value;
    sel.innerHTML = '<option value="all">All sectors</option>' +
      Object.keys(secs).sort().map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
    if (keep && secs[keep]) sel.value = keep; else curSector = 'all';
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
    $('boardBody').innerHTML = rows.map(function (r, i) {
      var ld = r.lead;
      var ldTxt = ld ? esc(ld.name || ld.broker) + ' (' + ld.broker + ')' +
        skilledChip(ld) : '—';
      var ret = pct(r.return_pct) + (r.partial ?
        ' <span title="Measured from ' + r.base_date +
        ', the stock\'s first available close, not the window start">*</span>' : '');
      return '<tr class="pp-rowclick" data-sym="' + r.symbol + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
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
    $('boardCount').textContent = rows.length + ' risers shown of ' +
      P.board.length + ' on the ' + P.window_days + '-day window' +
      ' · * partial: return measured from the stock\'s first available ' +
      'close (see Methodology).';
    Array.prototype.forEach.call(
      document.querySelectorAll('#boardBody tr[data-sym]'),
      function (tr) {
        tr.addEventListener('click', function () {
          selectSymbol(tr.getAttribute('data-sym'));
        });
      });
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
  }

  function renderHistory() {
    if (!HISTD) return;
    $('historyBody').innerHTML = HISTD.entries.slice().reverse().map(
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
    $('winTabs').innerHTML = WINDOWS.map(function (w) {
      return '<button type="button" role="tab" aria-selected="' +
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

  function loadWindow(w) {
    curWin = w;
    return fetch(dataUrl(w)).then(function (r) { return r.json(); })
      .then(function (j) {
        P = j;
        renderTabs();
        renderMeta();
        renderBoard();
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
      });
  }

  function init() {
    renderTabs();
    var fwd = fetch(dataUrl(30)).then(function (r) { return r.json(); })
      .then(function (j) { P30 = j; renderForward(); });
    var hist = fetch(HIST).then(function (r) { return r.json(); })
      .then(function (j) { HISTD = j; renderHistory(); });
    $('sectorSel').addEventListener('change', function (e) {
      curSector = e.target.value; renderBoard();
    });
    $('sortSel').addEventListener('change', function (e) {
      curSort = e.target.value; renderBoard();
    });
    $('symSearch').addEventListener('input', function (e) {
      curSearch = e.target.value.trim(); renderBoard();
    });
    $('symSel').addEventListener('change', function (e) {
      if (e.target.value) selectSymbol(e.target.value);
    });
    loadWindow(30).then(function () { return Promise.all([fwd, hist]); })
      .catch(function (err) {
        $('ppSession').textContent = 'Failed to load the board: ' + err;
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
