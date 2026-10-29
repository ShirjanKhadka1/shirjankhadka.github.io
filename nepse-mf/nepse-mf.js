/* Nepse Decode — Mutual Funds page engine. Renders published snapshot files
   only (nepse-mf/data/window.json + latest.json); never calls any source live.
   All injected values go through esc(); URL params are validated against the
   snapshot before use. A missing snapshot renders an honest empty state. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num2(v) { return v == null ? '–' : v.toFixed(2); }
  function pct(v) { return v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function pctCls(v) { return v == null ? '' : (v > 0 ? 'up' : (v < 0 ? 'down' : '')); }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(m[3], 10) + ' ' + mon[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  var S = { snap: null, win: null, sortKey: 'symbol', sortDir: 1, query: '', type: 'all', fund: null };

  function setErr(msg) { $('mfErr').textContent = msg || ''; }

  function emptyState() {
    $('mfFreshline').textContent = 'No mutual-fund snapshot published yet — the first daily snapshot will appear here.';
    $('mfTableBody').innerHTML = '<tr><td colspan="5" class="mf-cap">No snapshot published yet.</td></tr>';
    $('mfRowCount').textContent = '';
    $('mfSectorNote').textContent = 'No sector allocation published yet.';
    $('mfSectorAvgNote').textContent = '';
  }

  function renderFreshline() {
    var c = S.snap.coverage;
    $('mfFreshline').textContent =
      'Snapshot captured ' + fmtDate(S.snap.snapshot_date) +
      ' · Market prices ' + fmtDate(c.market_price_date) +
      ' · Monthly NAV ' + c.monthly_nav_date +
      ' · Weekly NAV ' + c.weekly_nav_dates + ' (varies by fund)';
  }

  function renderStats() {
    var f = S.snap.funds;
    var priced = f.filter(function (x) { return x.market_price != null; }).length;
    var oef = f.filter(function (x) { return x.oef; }).length;
    $('mfStatFunds').textContent = f.length;
    $('mfStatPriced').textContent = priced;
    $('mfStatOef').textContent = oef;
    $('mfStatAvgPrem').textContent = pct(S.snap.average.premium_discount_pct);
    $('mfStatAvgPrem').className = 'val ' + pctCls(S.snap.average.premium_discount_pct);
    $('mfStatAvgNav').textContent = num2(S.snap.average.weekly_nav);
  }

  function renderMix() {
    var f = S.snap.funds;
    var pos = 0, neg = 0, none = 0;
    f.forEach(function (x) {
      if (x.premium_discount_pct == null) none++;
      else if (x.premium_discount_pct > 0) pos++;
      else neg++;
    });
    var tot = f.length || 1;
    var segs = '';
    if (pos) segs += '<i class="up" style="width:' + (pos / tot * 100) + '%"></i>';
    if (neg) segs += '<i class="down" style="width:' + (neg / tot * 100) + '%"></i>';
    if (none) segs += '<i class="none" style="width:' + (none / tot * 100) + '%"></i>';
    $('mfMixBar').innerHTML = segs;
    $('mfMixBar').setAttribute('aria-label',
      'Premium and discount mix: ' + pos + ' at a premium, ' + neg + ' at a discount, ' + none + ' with no premium figure');
    var leg = '';
    if (pos) leg += '<span><i class="up"></i>Premium · ' + pos + '</span>';
    if (neg) leg += '<span><i class="down"></i>Discount · ' + neg + '</span>';
    if (none) leg += '<span><i class="none"></i>No premium figure · ' + none + '</span>';
    $('mfMixLegend').innerHTML = leg;
  }

  function filtered() {
    var q = S.query.toLowerCase();
    return S.snap.funds.filter(function (x) {
      if (q && x.symbol.toLowerCase().indexOf(q) === -1) return false;
      if (S.type === 'priced') return x.market_price != null;
      if (S.type === 'oef') return x.oef;
      if (S.type === 'noprice') return x.market_price == null && !x.oef;
      return true;
    });
  }

  function cmpVal(a, b) {
    return (typeof a === 'string') ? (a < b ? -1 : (a > b ? 1 : 0)) : a - b;
  }

  function renderTable() {
    var rows = filtered().slice();
    var k = S.sortKey, d = S.sortDir;
    rows.sort(function (a, b) {
      // Nulls always sort last, in either direction (a bare direction flip
      // would otherwise float all-dash rows to the top on descending sorts).
      var av = a[k], bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return cmpVal(av, bv) * d;
    });
    var html = rows.map(function (x) {
      return '<tr><td class="sym"><a href="#" data-fund="' + esc(x.symbol) + '">' + esc(x.symbol) +
        (x.oef ? ' [OEF]' : '') + '</a></td>' +
        '<td class="num">' + num2(x.weekly_nav) + '</td>' +
        '<td class="num">' + num2(x.monthly_nav) + '</td>' +
        '<td class="num">' + num2(x.market_price) + '</td>' +
        '<td class="num ' + pctCls(x.premium_discount_pct) + '">' + pct(x.premium_discount_pct) + '</td></tr>';
    }).join('');
    $('mfTableBody').innerHTML = html || '<tr><td colspan="5" class="mf-cap">No funds match this filter.</td></tr>';
    $('mfRowCount').textContent = 'Showing ' + rows.length + ' of ' + S.snap.funds.length + ' funds.';
    var ths = document.querySelectorAll('.mf-table thead th[data-sort]');
    ths.forEach(function (th) {
      var dir = th.querySelector('.dir');
      dir.textContent = (th.getAttribute('data-sort') === k) ? (d === 1 ? ' ▲' : ' ▼') : '';
    });
    $('mfTableBody').querySelectorAll('a[data-fund]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        selectFund(a.getAttribute('data-fund'), true);
        $('mf-sec-h').scrollIntoView();
      });
    });
  }

  function renderAverage() {
    var a = S.snap.average;
    $('mfAvgWeekly').textContent = num2(a.weekly_nav);
    $('mfAvgMonthly').textContent = num2(a.monthly_nav);
    $('mfAvgPrice').textContent = num2(a.market_price);
    $('mfAvgPrem').textContent = pct(a.premium_discount_pct);
    $('mfAvgPrem').className = 'val ' + pctCls(a.premium_discount_pct);
  }

  function sectorFunds() {
    return Object.keys(S.snap.sector_allocation || {}).sort();
  }

  function selectFund(sym, pushUrl) {
    var list = sectorFunds();
    if (list.indexOf(sym) === -1) {
      if (sym && S.snap.funds.some(function (x) { return x.symbol === sym; })) {
        $('mfSectorNote').textContent = 'No sector allocation published for ' + sym + ' in this snapshot.';
      } else if (sym) {
        $('mfSectorNote').textContent = 'Unknown fund “' + sym + '” — showing ' + (list[0] || '—') + ' instead.';
      }
      sym = list[0] || null;
    }
    S.fund = sym;
    var sel = $('mfFundSel');
    sel.value = sym || '';
    renderSectors();
    if (pushUrl && sym) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('fund', sym);
        window.history.replaceState(null, '', u.toString());
      } catch (e) { /* share link is a nicety, never a failure */ }
    }
  }

  function renderSectors() {
    var secs = (S.snap.sector_allocation || {})[S.fund] || [];
    var tot = secs.reduce(function (a, s) { return a + s.pct; }, 0);
    $('mfSectorNote').textContent = S.fund
      ? S.fund + ' — ' + secs.length + ' sectors, summing to ' + tot.toFixed(2) + '%.'
      : 'No sector allocation published yet.';
    $('mfSectorList').innerHTML = secs.map(function (s) {
      return '<div class="mf-rank"><div class="nm">' + esc(s.sector) + '</div>' +
        '<div class="pct">' + s.pct.toFixed(2) + '%</div>' +
        '<div class="track"><i style="width:' + Math.min(100, Math.max(0, s.pct)) + '%"></i></div></div>';
    }).join('');
    var avg = S.snap.sector_average || [];
    var avgTot = avg.reduce(function (a, s) { return a + s.pct; }, 0);
    $('mfSectorAvg').innerHTML = avg.map(function (s) {
      return '<div class="mf-rank"><div class="nm">' + esc(s.sector) + '</div>' +
        '<div class="pct">' + s.pct.toFixed(2) + '%</div>' +
        '<div class="track"><i style="width:' + Math.min(100, Math.max(0, s.pct)) + '%"></i></div></div>';
    }).join('');
    $('mfSectorAvgNote').textContent =
      'The source\u2019s average sector mix sums to ' + avgTot.toFixed(2) +
      '% — it is an aggregate across funds, not a single fund\u2019s allocation, and is shown exactly as published.';
  }

  function renderFundSelect() {
    var list = sectorFunds();
    $('mfFundSel').innerHTML = list.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
    var param = null;
    try { param = new URLSearchParams(window.location.search).get('fund'); } catch (e) {}
    selectFund(param || list[0], false);
  }

  function renderAll() {
    renderFreshline();
    renderStats();
    renderMix();
    renderTable();
    renderAverage();
    renderFundSelect();
  }

  function tick() {
    if (!S.snap) return;
    fetch('data/window.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (w) {
        if (w.latest && w.latest !== S.snap.snapshot_date) {
          $('mfTickNote').textContent = 'New snapshot ' + w.latest +
            ' published — reload to view it. Your current view is unchanged.';
        }
      }).catch(function () { /* tick failure is silent; the page keeps working */ });
  }

  function init() {
    fetch('data/window.json').then(function (r) {
      if (!r.ok) throw new Error('window');
      return r.json();
    }).then(function (w) {
      S.win = w;
      if (!w.latest) throw new Error('empty');
      return fetch('data/latest.json');
    }).then(function (r) {
      if (!r.ok) throw new Error('latest');
      return r.json();
    }).then(function (snap) {
      S.snap = snap;
      renderAll();
      setInterval(tick, 60000);
    }).catch(function () {
      setErr('');
      emptyState();
    });

    $('mfSearch').addEventListener('input', function (e) { S.query = e.target.value.trim(); renderTable(); });
    $('mfType').addEventListener('change', function (e) { S.type = e.target.value; renderTable(); });
    $('mfFundSel').addEventListener('change', function (e) { selectFund(e.target.value, true); });
    document.querySelectorAll('.mf-table thead th[data-sort]').forEach(function (th) {
      function toggle() {
        var k = th.getAttribute('data-sort');
        if (S.sortKey === k) S.sortDir = -S.sortDir;
        else { S.sortKey = k; S.sortDir = 1; }
        renderTable();
      }
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
