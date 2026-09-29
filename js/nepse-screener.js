/* NEPSE Stock Screener — client-side ranking table.
 *
 * Data: ../nepse-chart/data/verdicts.json (daily rule-based signals, built by
 * tools/build-nepse-universe.js) + ../nepse-chart/data/universe.json (names).
 * Everything rendered here comes from those files; no fabricated values.
 * Educational use only — not investment advice.
 */
(function () {
  'use strict';

  var RANK = { 'Strong Buy': 0, 'Buy': 1, 'Hold': 2, 'Exit / Reduce': 3, 'Strong Exit': 4, 'Insufficient history': 5 };
  var CLS = { 'Strong Buy': 'sbuy', 'Buy': 'buy', 'Hold': 'hold', 'Exit / Reduce': 'exit', 'Strong Exit': 'sexit', 'Insufficient history': 'insufficient' };
  var DISP = { 'Strong Buy': 'Strong Buy', 'Buy': 'Buy', 'Hold': 'Hold', 'Exit / Reduce': 'Sell', 'Strong Exit': 'Strong Sell', 'Insufficient history': 'No signal' };

  var state = { rows: [], q: '', sector: '', verdict: '', rsi: '', pmin: null, pmax: null, vmin: null,
    sortK: 'sig', sortD: 1, page: 1, perPage: 25 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num2(x) {
    return x == null ? '–' : (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtVol(x) { return x == null ? '–' : Math.round(+x).toLocaleString('en-US'); }
  function rvolBadge(r) {
    if (r.vol == null || r.volAvg == null || !r.volAvg) return '';
    var x = r.vol / r.volAvg;
    if (x < 1.5) return '';
    return '<span class="sc-rvol' + (x >= 3 ? ' hot' : '') + '" title="Volume vs 20-session average">' +
      x.toFixed(1) + 'x</span>';
  }
  function pct(x) { return (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }

  function slCell(r) {
    if (r.sl == null || r.p == null || !r.p) return '<span class="sc-dash">–</span>';
    var d = (r.sl - r.p) / r.p * 100;
    return '<b class="sc-sl">' + num2(r.sl) + '</b> <span class="sc-dist dn">(' + pct(d) + ')</span>';
  }
  function tpCell(r) {
    if (r.tp == null || r.p == null || !r.p) return '<span class="sc-dash">–</span>';
    var d = (r.tp - r.p) / r.p * 100;
    return '<b class="sc-tp">' + num2(r.tp) + '</b> <span class="sc-dist up">(' + pct(d) + ')</span>';
  }
  function hitCell(r) {
    if (!r.tr || r.tr.n == null || r.tr.w == null) return '<span class="sc-dash">–</span>';
    var w = Math.round(r.tr.w * 100);
    return '<b class="sc-hit">' + w + '%</b> <span class="sc-sub">' + r.tr.n + ' calls</span>';
  }

  function rsiCell(r) {
    if (r.rsi == null) return '<span class="sc-dash">–</span>';
    var cls = r.rsi < 30 ? ' sc-rsi-os' : (r.rsi > 70 ? ' sc-rsi-ob' : '');
    return '<b class="sc-rsi' + cls + '">' + r.rsi.toFixed(1) + '</b>';
  }

  function badge(v) {
    return '<span class="ms-v ' + (CLS[v] || 'insufficient') + '">' + esc(DISP[v] || v) + '</span>';
  }

  function filtered() {
    var q = state.q.trim().toUpperCase();
    var out = state.rows.filter(function (r) {
      if (state.verdict && r.v !== state.verdict) return false;
      if (state.sector && r.sec !== state.sector) return false;
      if (state.rsi) {
        if (r.rsi == null) return false;
        if (state.rsi === 'os' && !(r.rsi < 30)) return false;
        if (state.rsi === 'ob' && !(r.rsi > 70)) return false;
        if (state.rsi === 'mid' && !(r.rsi >= 30 && r.rsi <= 70)) return false;
      }
      if (state.pmin != null && (r.p == null || r.p < state.pmin)) return false;
      if (state.pmax != null && (r.p == null || r.p > state.pmax)) return false;
      if (state.vmin != null && (r.vol == null || r.vol < state.vmin)) return false;
      if (q && r.sym.indexOf(q) < 0 && (r.name || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = state.sortK, d = state.sortD;
    out.sort(function (a, b) {
      var x, y;
      switch (k) {
        case 'sn': return 0; // S.N. follows the ranking order
        case 'sec': x = a.sec || ''; y = b.sec || ''; return (x < y ? -1 : x > y ? 1 : 0) * d || rankCmp(a, b);
        case 'sym': x = a.sym; y = b.sym; return (x < y ? -1 : x > y ? 1 : 0) * d || rankCmp(a, b);
        case 'p': x = a.p || -1; y = b.p || -1; return (x - y) * d || rankCmp(a, b);
        case 'vol': x = a.vol || -1; y = b.vol || -1; return (x - y) * d || rankCmp(a, b);
        case 'rsi':
          if (a.rsi == null && b.rsi == null) return rankCmp(a, b);
          if (a.rsi == null) return 1;
          if (b.rsi == null) return -1;
          return (a.rsi - b.rsi) * d || rankCmp(a, b);
        case 'sig': return rankCmp(a, b) * d;
        case 'tr': x = a.tr ? a.tr.w : -1; y = b.tr ? b.tr.w : -1; return (x - y) * d || rankCmp(a, b);
        case 'sl': x = a.sl == null ? -1 : a.sl; y = b.sl == null ? -1 : b.sl; return (x - y) * d || rankCmp(a, b);
        case 'tp': x = a.tp == null ? -1 : a.tp; y = b.tp == null ? -1 : b.tp; return (x - y) * d || rankCmp(a, b);
        default: return 0;
      }
    });
    return out;
  }

  function rankCmp(a, b) {
    var ra = RANK[a.v] == null ? 9 : RANK[a.v], rb = RANK[b.v] == null ? 9 : RANK[b.v];
    if (ra !== rb) return ra - rb;
    var sa = a.s == null ? -999 : a.s, sb = b.s == null ? -999 : b.s;
    return sb - sa || (a.sym < b.sym ? -1 : 1);
  }

  function render() {
    var rows = filtered();
    var perPage = state.perPage;
    var pages = Math.max(1, Math.ceil(rows.length / perPage));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * perPage;
    var slice = rows.slice(start, start + perPage);

    var html = slice.map(function (r, i) {
      var sn = start + i + 1;
      return '<tr>' +
        '<td class="num sc-sn">' + sn + '</td>' +
        '<td>' + (r.sec ? '<span class="sc-sector">' + esc(r.sec) + '</span>' : '<span class="sc-dash">–</span>') + '</td>' +
        '<td><a class="sc-sym" href="/nepse-chart/?s=' + esc(r.sym) + '">' + esc(r.sym) + '</a>' +
          (r.l ? ' <span class="sc-ltp" title="LTP-only history">LTP</span>' : '') + '</td>' +
        '<td class="num"><b>' + num2(r.p) + '</b></td>' +
        '<td class="num">' + fmtVol(r.vol) + rvolBadge(r) + '</td>' +
        '<td class="num">' + rsiCell(r) + '</td>' +
        '<td>' + badge(r.v) + (r.setup ? ' <span class="sc-setup-chip">' + esc(r.setup) + '</span>' : '') + '</td>' +
        '<td class="num">' + hitCell(r) + '</td>' +
        '<td class="num">' + slCell(r) + '</td>' +
        '<td class="num">' + tpCell(r) + '</td>' +
        '</tr>';
    }).join('');
    $('sc-body').innerHTML = html || '<tr><td colspan="10" class="sc-empty">Nothing matches those filters. Try widening or resetting the filters.</td></tr>';

    // sort indicators
    var ths = document.querySelectorAll('#sc-table th[data-k]');
    ths.forEach(function (th) {
      var k = th.getAttribute('data-k');
      var on = k === state.sortK;
      th.classList.toggle('sorted', on);
      var label = th.getAttribute('data-label') || th.textContent.replace(/[▴▾]/g, '').trim();
      th.setAttribute('data-label', label);
      th.innerHTML = esc(label) + (on ? ' <span class="arr">' + (state.sortD > 0 ? '▴' : '▾') + '</span>' : '');
      th.setAttribute('aria-sort', on ? (state.sortD > 0 ? 'ascending' : 'descending') : 'none');
    });

    // "Showing x to y of z entries"
    var from = rows.length ? start + 1 : 0, to = Math.min(start + perPage, rows.length);
    $('sc-range').textContent = 'Showing ' + from + ' to ' + to + ' of ' + rows.length + ' entries';

    renderPager(rows.length, pages);
  }

  function renderPager(total, pages) {
    var el = $('sc-pager');
    if (pages <= 1) { el.innerHTML = ''; return; }
    var h = '<button class="sc-pg" data-pg="prev"' + (state.page <= 1 ? ' disabled' : '') + '>‹ Prev</button>';
    var win = pageWindow(state.page, pages);
    win.forEach(function (p) {
      if (p === '…') h += '<span class="sc-gap">…</span>';
      else h += '<button class="sc-pg' + (p === state.page ? ' is-on' : '') + '" data-pg="' + p + '">' + p + '</button>';
    });
    h += '<button class="sc-pg" data-pg="next"' + (state.page >= pages ? ' disabled' : '') + '>Next ›</button>';
    el.innerHTML = h;
    el.querySelectorAll('.sc-pg').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-pg');
        if (v === 'prev') state.page = Math.max(1, state.page - 1);
        else if (v === 'next') state.page = Math.min(pages, state.page + 1);
        else state.page = +v;
        render();
        document.getElementById('sc-table').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  function pageWindow(cur, total) {
    var set = [1, total, cur - 1, cur, cur + 1];
    var nums = set.filter(function (p) { return p >= 1 && p <= total; })
      .sort(function (a, b) { return a - b; })
      .filter(function (p, i, a) { return a.indexOf(p) === i; });
    var out = [], prev = 0;
    nums.forEach(function (p) { if (p - prev > 1) out.push('…'); out.push(p); prev = p; });
    return out;
  }

  function bindControls() {
    var q = $('sc-q'), deb = null;
    q.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () { state.q = q.value; state.page = 1; render(); }, 160);
    });
    $('sc-sector').addEventListener('change', function (e) { state.sector = e.target.value; state.page = 1; render(); });
    var sigSel = $('sc-signal');
    if (sigSel) sigSel.addEventListener('change', function (e) {
      state.verdict = e.target.value;
      syncCards();
      state.page = 1; render();
    });
    var rsiSel = $('sc-rsi');
    if (rsiSel) rsiSel.addEventListener('change', function (e) { state.rsi = e.target.value; state.page = 1; render(); });
    function numInput(id, set) {
      var el = $(id);
      if (!el) return;
      var deb = null;
      el.addEventListener('input', function () {
        clearTimeout(deb);
        deb = setTimeout(function () {
          var v = parseFloat(el.value);
          set(isFinite(v) && v >= 0 ? v : null);
          state.page = 1; render();
        }, 220);
      });
    }
    numInput('sc-pmin', function (v) { state.pmin = v; });
    numInput('sc-pmax', function (v) { state.pmax = v; });
    numInput('sc-vmin', function (v) { state.vmin = v; });
    var resetBtn = $('sc-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);
    $('sc-perpage').addEventListener('change', function (e) {
      state.perPage = Math.max(1, parseInt(e.target.value, 10) || 25);
      state.page = 1; render();
    });
    // summary cards double as signal filters
    function syncCards() {
      document.querySelectorAll('.sc-card[data-v]').forEach(function (x) {
        x.classList.toggle('is-on', !!state.verdict && x.getAttribute('data-v') === state.verdict);
      });
      var sigSel = $('sc-signal');
      if (sigSel && sigSel.value !== state.verdict) sigSel.value = state.verdict;
    }
    function cardFilter(card) {
      var v = card.getAttribute('data-v') || '';
      state.verdict = (state.verdict === v) ? '' : v;
      syncCards();
      state.page = 1; render();
      // the results table sits below the fold on phones: bring it into view
      // so the filter result is visible the moment a card is tapped
      var tbl = document.getElementById('sc-table');
      if (tbl && tbl.scrollIntoView) tbl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    function resetFilters() {
      state.q = ''; state.sector = ''; state.verdict = '';
      state.rsi = ''; state.pmin = null; state.pmax = null; state.vmin = null;
      state.page = 1;
      var q = $('sc-q'); if (q) q.value = '';
      var sec = $('sc-sector'); if (sec) sec.value = '';
      var sig = $('sc-signal'); if (sig) sig.value = '';
      var rs = $('sc-rsi'); if (rs) rs.value = '';
      ['sc-pmin', 'sc-pmax', 'sc-vmin'].forEach(function (id) {
        var el = $(id); if (el) el.value = '';
      });
      syncCards();
      render();
    }
    document.querySelectorAll('.sc-card[data-v]').forEach(function (c) {
      c.addEventListener('click', function () { cardFilter(c); });
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cardFilter(c); }
      });
    });
    document.querySelectorAll('#sc-table th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (k === 'sn') return; // S.N. always follows the ranking
        if (state.sortK === k) state.sortD = -state.sortD;
        else { state.sortK = k; state.sortD = (k === 'sym' || k === 'sec' || k === 'rsi') ? 1 : -1; }
        state.page = 1; render();
      });
    });
  }

  function load() {
    function get(url) {
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
        return r.json();
      });
    }
    // skeleton rows: hold the table's footprint while the ranking loads
    (function () {
      var rows = '';
      for (var i = 0; i < 10; i++) {
        rows += '<tr><td colspan="10" aria-hidden="true"><span class="skl skl-row"></span></td></tr>';
      }
      $('sc-body').innerHTML = rows;
    })();
    return Promise.all([
      get('../nepse-chart/data/verdicts.json'),
      get('../nepse-chart/data/universe.json').catch(function () { return null; })
    ]).then(function (res) {
      var vj = res[0], uj = res[1];
      var names = {};
      if (uj && uj.symbols) uj.symbols.forEach(function (it) { if (it.s) names[it.s] = it.n || it.s; });
      var v = vj.verdicts || {};
      state.rows = Object.keys(v).map(function (sym) {
        var e = v[sym];
        return {
          sym: sym, name: names[sym] || sym, v: e.v, s: e.s, p: e.p,
          vol: e.vol, volAvg: e.volAvg || null, sec: e.sec || null, sl: e.sl, tp: e.tp,
          setup: e.setup || null, l: e.l || 0, tr: e.tr || null, rsi: e.rsi
        };
      });
      var asof = vj.asof || '';
      var scAsof = $('sc-asof');
      scAsof.textContent = asof
        ? 'Signals as of ' + asof + ' · ' + state.rows.length + ' securities ranked'
        : state.rows.length + ' securities ranked';
      if (window.NepseFresh && asof && !scAsof.querySelector('.fresh'))
        scAsof.insertAdjacentHTML('beforeend', ' ' + window.NepseFresh.badge(asof));
      $('sc-asof2').textContent = asof || 'the last close';
      // keep the static snapshot heading in sync with the live data
      var snapAsof = document.querySelector('.sc-top10 .sc-asof-inline');
      if (snapAsof && asof) snapAsof.textContent = '· ' + asof;

      // summary cards
      var c = { 'Strong Buy': 0, 'Buy': 0, 'Hold': 0, 'Exit / Reduce': 0, 'Strong Exit': 0 };
      state.rows.forEach(function (r) { if (c[r.v] != null) c[r.v]++; });
      $('sc-n-sbuy').textContent = c['Strong Buy'];
      $('sc-n-buy').textContent = c['Buy'];
      $('sc-n-hold').textContent = c['Hold'];
      $('sc-n-exit').textContent = c['Exit / Reduce'];
      $('sc-n-sexit').textContent = c['Strong Exit'];
      $('sc-n-total').textContent = state.rows.length;

      // sector dropdown
      var secs = {};
      state.rows.forEach(function (r) { if (r.sec) secs[r.sec] = 1; });
      var sel = $('sc-sector');
      Object.keys(secs).sort().forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        sel.appendChild(o);
      });

      bindControls();
      render();
    }).catch(function (e) {
      $('sc-body').innerHTML = '<tr><td colspan="10" class="sc-empty">Could not load the ranking data. Please retry in a moment.</td></tr>';
      $('sc-asof').textContent = 'Data unavailable';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
