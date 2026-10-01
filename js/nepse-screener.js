/* NEPSE Stock Screener - client-side ranking table.
 *
 * Data: ../nepse-chart/data/verdicts.json (daily rule-based signals, built by
 * tools/build-nepse-universe.js) + ../nepse-chart/data/universe.json (names).
 * Everything rendered here comes from those files; no fabricated values.
 * Educational use only - not investment advice.
 */
(function () {
  'use strict';

  var RANK = { 'Strong Buy': 0, 'Buy': 1, 'Hold': 2, 'Exit / Reduce': 3, 'Strong Exit': 4, 'Insufficient history': 5 };
  var CLS = { 'Strong Buy': 'sbuy', 'Buy': 'buy', 'Hold': 'hold', 'Exit / Reduce': 'exit', 'Strong Exit': 'sexit', 'Insufficient history': 'insufficient' };
  var DISP = { 'Strong Buy': 'Strong Buy', 'Buy': 'Buy', 'Hold': 'Hold', 'Exit / Reduce': 'Sell', 'Strong Exit': 'Strong Sell', 'Insufficient history': 'No signal' };

  /* Honest sector/instrument grouping.
   * The repo ships no per-symbol sector field (tools/sector-map.json is
   * absent, so verdicts.json sec is null for all 410 symbols). Groups below
   * are derived ONLY from real repo data in nepse-chart/data/universe.json:
   *  - the instrument-type field `t` (Debenture / Mutual fund /
   *    Promoter share), plus NEPSE's own debenture symbol suffixes
   *    (D + maturity year) and the words "bond"/"rinpatra", "fund"/"kosh"
   *    in the official company name; these are instrument types, NOT sectors;
   *  - explicit business words in the official company name for equities
   *    (bank, finance, laghubitta, hydropower/power/hydro/urja,
   *    insurance/beema, hotel/tourism, investment, trading, cement and other
   *    manufacturing words); these map to the NEPSE sub-index names.
   * Anything left over falls into "Others" (the NEPSE Others sub-index bucket). Kept identical in js/nepse-sectors.js. */
  var DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
  /* Verified symbol -> sector overrides (2026-09-30, official NEPSE/company
     notices and market sources). Checked before keyword matching. */
  var SECTOR_OVERRIDES = {
    GVL: 'Hydropower', SNORL: 'Hydropower',
    BNL: 'Manufacturing And Processing', UNL: 'Manufacturing And Processing',
    SAIL: 'Manufacturing And Processing',
    CGH: 'Hotels And Tourism', KDL: 'Hotels And Tourism',
    SAGF: 'Mutual Funds', H8020: 'Mutual Funds', NMB50: 'Mutual Funds',
    CMF2: 'Mutual Funds', NICBF: 'Mutual Funds', LSH12: 'Mutual Funds',
    RBBF40: 'Mutual Funds',
    JBLBP: 'Promoter Shares', KBLPO: 'Promoter Shares', MLBLPO: 'Promoter Shares',
    SCBD: 'Debentures', SHINED: 'Debentures',
    SFCL: 'Finance',
    WNLB: 'Microfinance',
    NTC: 'Others', NRM: 'Others', NWCL: 'Others', TTL: 'Others', MKCL: 'Others'
  };
  /* NEPSE-official sector overrides, checked before keyword matching.
     Investment sub-index (NEPSE): CIT, HIDCL, NIFRA, NRN, CEDB/CHDC, plus
     newer listings ENL and HATHY; HIDCLP is HIDCL's promoter share and
     trades with the investment group. NIFRA must precede the 'bank'
     keyword; HIDCLP must precede the Promoter-share instrument check.
     Trading (NEPSE): BBC and STC. */
  var INVESTMENT_SYMBOLS = { CIT:1, HIDCL:1, HIDCLP:1, NIFRA:1, NRN:1, CHDC:1, ENL:1, HATHY:1 };
  var TRADING_SYMBOLS = { BBC:1, STC:1 };
  function classifySymbol(sym, name, type) {
    var symU = String(sym || '').toUpperCase();
    if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
    if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
    if (TRADING_SYMBOLS[symU]) return 'Trading';
    var n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
    if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
        n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
    if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
    if (type === 'Promoter share') return 'Promoter Shares';
    if (type && type !== 'Equity') return 'Others';
    function has() {
      for (var i = 0; i < arguments.length; i++) if (n.indexOf(arguments[i]) >= 0) return true;
      return false;
    }
    if (has('laghu', 'microfinance')) return 'Microfinance';
    if (has('hydropower', 'hydro', 'power', 'urja', 'dhyut', 'dyut', 'energy')) return 'Hydropower';
    if (has('development bank')) return 'Development Bank';
    if (has('bank')) return 'Banking';
    if (has('life insurance')) return 'Life Insurance';
    if (has('reinsurance', 'insurance', 'beema')) return 'Non Life Insurance';
    if (has('finance')) return 'Finance';
    if (has('hotel', 'tourism', 'cablecar')) return 'Hotels And Tourism';
    if (has('investment')) return 'Investment';
    if (has('trading')) return 'Trading';
    if (has('manufacturing', 'cement', 'bottler', 'distiller', 'spinning', 'pharmaceut',
      'paints', 'colour', 'panel', 'mineral', 'lube')) return 'Manufacturing And Processing';
    return 'Others';
  }

  var state = { rows: [], q: '', sector: '', verdict: '', rsi: '', pmin: null, pmax: null, vmin: null,
    sortK: 'sig', sortD: 1, page: 1, perPage: 25, tf: 'd' };
  var TF_LABEL = { d: 'Daily', w: 'Weekly', m: 'Monthly' };
  var TF_HINT = {
    d: "Today's signal from the latest session.",
    w: 'One verdict per security from weekly candles. Needs 40+ weeks of history.',
    m: 'One verdict per security from monthly candles. Needs 36+ months of history.'
  };

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

  function chCell(r) {
    var ch = Number(r.ch);
    if (r.ch == null || !isFinite(ch)) return '<span class="sc-dash">–</span>';
    var cls = ch > 0 ? 'sc-chg-up' : (ch < 0 ? 'sc-chg-dn' : 'sc-chg-flat');
    return '<b class="' + cls + '">' + (ch > 0 ? '+' : '') + ch.toFixed(2) + '%</b>';
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
        case 'ch':
          if (a.ch == null && b.ch == null) return rankCmp(a, b);
          if (a.ch == null) return 1;
          if (b.ch == null) return -1;
          return (a.ch - b.ch) * d || rankCmp(a, b);
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

  // Timeframe switch: remap each row's signal fields from the daily (d),
  // weekly (w) or monthly (m) verdict. Price, change and volume stay on the
  // latest daily session as price context; hit rate is daily-only.
  function applyTf() {
    var tf = state.tf;
    state.rows.forEach(function (r) {
      var e = r.raw || {}, src = tf === 'd' ? e : (e[tf] || null);
      if (src && src.v) {
        r.v = src.v; r.s = src.s; r.rsi = src.rsi; r.sl = src.sl; r.tp = src.tp;
        r.setup = src.setup || null; r.tfasof = src.asof || null;
        r.tr = tf === 'd' ? (e.tr || null) : null;
      } else {
        r.v = 'Insufficient history'; r.s = null; r.rsi = null; r.sl = null; r.tp = null;
        r.setup = null; r.tr = null; r.tfasof = null;
      }
    });
  }

  function tfRankedCount() {
    var n = 0;
    state.rows.forEach(function (r) { if (r.v !== 'Insufficient history') n++; });
    return n;
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
      var Mono = window.NepseMono || null;
      return '<tr>' +
        '<td class="num sc-sn" data-label="S.N.">' + sn + '</td>' +
        '<td data-label="Sector">' + (r.sec ? '<span class="sc-sector">' + esc(r.sec) + '</span>' : '<span class="sc-dash">–</span>') + '</td>' +
        '<td data-label="Symbol"><a class="sc-sym" href="/stocks/' + esc(String(r.sym).replace(/\//g, "-")) + '/">' +
          (Mono ? Mono.avatar(r.sym, r.sec, 28) : '') + '<span>' + esc(r.sym) + '</span></a>' +
          (r.l ? ' <span class="sc-ltp" title="LTP-only history">LTP</span>' : '') + '</td>' +
        '<td class="num" data-label="Price"><b>' + num2(r.p) + '</b></td>' +
        '<td class="num" data-label="Change">' + chCell(r) + '</td>' +
        '<td class="num" data-label="Volume">' + fmtVol(r.vol) + rvolBadge(r) + '</td>' +
        '<td class="num" data-label="RSI">' + rsiCell(r) + '</td>' +
        '<td data-label="Signal &amp; setup">' + badge(r.v) + (r.setup ? ' <span class="sc-setup-chip">' + esc(r.setup) + '</span>' : '') + '</td>' +
        '<td class="num" data-label="Hit rate">' + hitCell(r) + '</td>' +
        '<td class="num" data-label="Stop loss">' + slCell(r) + '</td>' +
        '<td class="num" data-label="Target">' + tpCell(r) + '</td>' +
        '</tr>';
    }).join('');
    $('sc-body').innerHTML = html || '<tr><td colspan="11" class="sc-empty">Nothing matches those filters. Try widening or resetting the filters.</td></tr>';

    // compact summary bar: "X of 410 shown"
    var sumEl = $('sc-summary');
    if (sumEl) {
      sumEl.innerHTML = '<span class="sc-sum-tf">' + esc(TF_LABEL[state.tf] || '') + '</span>' +
        '<span><b>' + rows.length + '</b>&nbsp;of&nbsp;<b>' + state.rows.length + '</b>&nbsp;shown</span>' +
        (state.batchAsof ? '<span class="sc-sum-dot">·</span><span>as of ' + esc(state.batchAsof) + '</span>' : '');
    }

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
      renderCardResults();
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
    // Timeframe switch: Daily / Weekly / Monthly signal ranking.
    var tfSel = $('sc-tf');
    if (tfSel) tfSel.addEventListener('change', function (e) {
      state.tf = e.target.value || 'd';
      applyTf();
      var tf = state.tf;
      var c = { 'Strong Buy': 0, 'Buy': 0, 'Hold': 0, 'Exit / Reduce': 0, 'Strong Exit': 0 };
      state.rows.forEach(function (r) { if (c[r.v] != null) c[r.v]++; });
      $('sc-n-sbuy').textContent = c['Strong Buy'];
      $('sc-n-buy').textContent = c['Buy'];
      $('sc-n-hold').textContent = c['Hold'];
      $('sc-n-exit').textContent = c['Exit / Reduce'];
      $('sc-n-sexit').textContent = c['Strong Exit'];
      $('sc-n-total').textContent = state.rows.length;
      var votes = {};
      state.rows.forEach(function (r) { if (r.tfasof) votes[r.tfasof] = (votes[r.tfasof] || 0) + 1; });
      var best = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0]
        || state.batchAsof || '';
      var n = tfRankedCount();
      var scAsof = $('sc-asof');
      scAsof.textContent = tf === 'd'
        ? 'Signals as of ' + best + ' · ' + state.rows.length + ' securities ranked'
        : TF_LABEL[tf] + ' signals as of ' + best + ' · ' + n + ' of ' + state.rows.length + ' securities ranked';
      if (window.NepseFresh && best && !scAsof.querySelector('.fresh'))
        scAsof.insertAdjacentHTML('beforeend', ' ' + window.NepseFresh.badge(best));
      var hint = $('sc-tf-hint');
      if (hint) hint.textContent = TF_HINT[tf] || '';
      var asof2 = $('sc-asof2');
      if (asof2) asof2.textContent = best
        ? (tf === 'd' ? best : best + ' (' + TF_LABEL[tf].toLowerCase() + ' candles)')
        : 'the last close';
      state.page = 1;
      syncCards();
      render();
      renderCardResults();
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
      // Wave 8: the top matches render directly beneath the cards, so the
      // result is visible the moment a card is tapped (the full table below
      // keeps working as the complete filtered view)
      renderCardResults();
      if (state.verdict) {
        var box = document.getElementById('sc-card-results');
        if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
    // Wave 8: inline top-10 for the tapped signal card. Rows carry symbol,
    // price, day change, verdict, stop loss, target and a chart link.
    function renderCardResults() {
      var box = document.getElementById('sc-card-results');
      if (!box) return;
      if (!state.verdict) { box.innerHTML = ''; box.hidden = true; return; }
      var matched = state.rows.filter(function (r) { return r.v === state.verdict; })
        .sort(rankCmp);
      var rows = matched.slice(0, 10);
      var total = matched.length;
      if (!rows.length) {
        box.innerHTML = '<p class="sc-cr-empty">No ' + esc(DISP[state.verdict] || state.verdict) +
          ' verdicts in the latest batch.</p>';
        box.hidden = false;
        return;
      }
      var Mono = window.NepseMono || null;
      var h = '<h3 class="sc-cr-head">Top ' + rows.length + ' ' +
        esc(DISP[state.verdict] || state.verdict) + ' matches</h3>';
      h += '<div class="sc-cr-list">' + rows.map(function (r) {
        var ch = Number(r.ch);
        var chHtml = isFinite(ch)
          ? '<span class="sc-dist ' + (ch > 0 ? 'up' : ch < 0 ? 'dn' : '') + '">' +
            (ch > 0 ? '+' : '') + ch.toFixed(2) + '%</span>'
          : '<span class="sc-dash">–</span>';
        return '<div class="sc-cr-row">' +
          '<a class="sc-cr-sym" href="/stocks/' + esc(String(r.sym).replace(/\//g, "-")) + '/">' +
            (Mono ? Mono.avatar(r.sym, r.sec, 26) : '') + '<span>' + esc(r.sym) + '</span></a>' +
          '<span class="sc-cr-num tnum">Rs ' + num2(r.p) + '</span>' +
          '<span class="sc-cr-num tnum">' + chHtml + '</span>' +
          '<span>' + badge(r.v) + '</span>' +
          '<span class="sc-cr-num tnum">SL ' + num2(r.sl) + '</span>' +
          '<span class="sc-cr-num tnum">TP ' + num2(r.tp) + '</span>' +
          '<a class="sc-cr-link" href="/nepse-chart/?s=' + esc(r.sym) + '">Chart</a>' +
        '</div>';
      }).join('') + '</div>';
      if (total > rows.length) {
        h += '<p class="sc-cr-more"><a href="#sc-table" id="sc-cr-all">See all ' + total +
          ' in the full table below</a></p>';
      }
      box.innerHTML = h;
      box.hidden = false;
      var all = document.getElementById('sc-cr-all');
      if (all) all.addEventListener('click', function (e) {
        e.preventDefault();
        var tbl = document.getElementById('sc-table');
        if (tbl && tbl.scrollIntoView) tbl.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
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
      renderCardResults();
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
        rows += '<tr><td colspan="11" aria-hidden="true"><span class="skl skl-row"></span></td></tr>';
      }
      $('sc-body').innerHTML = rows;
    })();
    return Promise.all([
      get('../nepse-chart/data/verdicts.json'),
      get('../nepse-chart/data/universe.json').catch(function () { return null; })
    ]).then(function (res) {
      var vj = res[0], uj = res[1];
      var names = {}, groups = {};
      if (uj && uj.symbols) uj.symbols.forEach(function (it) {
        if (it.s) {
          names[it.s] = it.n || it.s;
          groups[it.s] = classifySymbol(it.s, it.n, it.t);
        }
      });
      var v = vj.verdicts || {};
      state.rows = Object.keys(v).map(function (sym) {
        var e = v[sym];
        // Authoritative verdicts.json sec (written by the universe builder
        // from tools/sector-map.json) wins; the local classifier is the
        // fallback. Every security lands in exactly one real category.
        var sec = (e.sec && e.sec !== 'Unknown') ? e.sec : (groups[sym] || 'Others');
        return {
          sym: sym, name: names[sym] || sym, v: e.v, s: e.s, p: e.p, ch: e.ch,
          vol: e.vol, volAvg: e.volAvg || null, sec: sec, sl: e.sl, tp: e.tp,
          setup: e.setup || null, l: e.l || 0, tr: e.tr || null, rsi: e.rsi,
          raw: e
        };
      });
      var asof = vj.asof || '';
      state.batchAsof = asof;
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
      Object.keys(secs).sort(function (a, b) {
        return a < b ? -1 : a > b ? 1 : 0;
      }).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        sel.appendChild(o);
      });

      bindControls();

      // sector deep link (used by the /nepse-sectors/ dashboard tiles): ?sector=Banking
      try {
        var qsec = new URLSearchParams(location.search).get('sector');
        if (qsec) {
          var match = Object.keys(secs).filter(function (s) { return s.toLowerCase() === qsec.toLowerCase(); })[0];
          if (match) { state.sector = match; sel.value = match; }
        }
      } catch (e) {}
      render();
      startLiveOverlay();
    }).catch(function (e) {
      $('sc-body').innerHTML = '<tr><td colspan="11" class="sc-empty">Could not load the ranking data. Please retry in a moment.</td></tr>';
      $('sc-asof').textContent = 'Data unavailable';
    });
  }

  /* Live overlay: when the 15-minute tape is fresh, repaint the Price and
     Change cells in place. Signals, SL/TP and hit rates stay daily-batch. */
  function startLiveOverlay() {
    var NL = window.NepseLive || null;
    if (!NL || !document.getElementById('sc-live')) return;
    NL.start({
      el: 'sc-live',
      onData: function (d) {
        if (!d || !d.quotes) return;
        var quotes = d.quotes;
        var body = $('sc-body');
        if (!body) return;
        var rows = body.querySelectorAll('tr');
        for (var i = 0; i < rows.length; i++) {
          var link = rows[i].querySelector('.sc-sym');
          if (!link) continue;
          var m = link.getAttribute('href').match(/\/stocks\/([^\/]+)\//);
          var sym = m && m[1];
          var q = sym && quotes[sym];
          if (!q || q.ltp == null || !isFinite(Number(q.ltp))) continue;
          var cells = rows[i].querySelectorAll('td');
          // Price is the 4th cell (index 3), Change the 5th (index 4).
          if (cells[3]) {
            var b = cells[3].querySelector('b');
            if (b) b.textContent = num2(q.ltp);
          }
          if (cells[4]) {
            var pct = (q.pct != null && isFinite(Number(q.pct))) ? Number(q.pct) : null;
            if (pct != null) {
              var cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
              cells[4].innerHTML = '<span class="' + cls + '">' +
                (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</span>';
            }
          }
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
