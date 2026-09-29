/* NEPSE Alpha Lab - fundamentals snapshot page.
 * Shows ONLY real data from the daily batch (universe.json, verdicts.json,
 * news.json). No company financial statements exist in the dataset, so no
 * per-stock ratios (P/E, EPS, ROE, ...) are computed, estimated, or shown.
 * Sector comparisons are medians computed client-side from the batch.
 * Educational, not investment advice. */
(function () {
  'use strict';

  var UNI_URL = '/nepse-chart/data/universe.json';
  var VER_URL = '/nepse-chart/data/verdicts.json';
  var NEWS_URL = '/nepse-chart/data/news.json';
  var FUND_URL = '/nepse-chart/data/fundamentals.json';

  /* ---------- pure helpers (also exported for node tests) ---------- */
  function median(vals) {
    var a = vals.filter(function (v) { return typeof v === 'number' && isFinite(v); })
      .sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function num(v, d) {
    if (v == null || !isFinite(v)) return '–';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function signed(v, d) {
    if (v == null || !isFinite(v)) return '–';
    return (v >= 0 ? '+' : '') + num(v, d);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // sector median + the symbol's rank (1 = highest) for one metric key
  function sectorStats(verdicts, sector, sym, key) {
    var vals = [];
    Object.keys(verdicts).forEach(function (k) {
      var r = verdicts[k];
      if (r.sec === sector && typeof r[key] === 'number' && isFinite(r[key])) vals.push({ k: k, v: r[key] });
    });
    if (!vals.length) return null;
    vals.sort(function (a, b) { return b.v - a.v; });
    var rank = -1;
    for (var i = 0; i < vals.length; i++) if (vals[i].k === sym) { rank = i + 1; break; }
    return { med: median(vals.map(function (x) { return x.v; })), rank: rank, n: vals.length };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { median: median, num: num, signed: signed, sectorStats: sectorStats };
    return;
  }

  /* ---------- page ---------- */
  var uni = null, ver = null, news = null, cur = null, fundData = null;

  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  ['fd-sym', 'fd-suggest', 'fd-status', 'fd-profile', 'fd-compare', 'fd-news',
   'fd-empty', 'fd-asof'].forEach(function (id) { els[id] = $(id); });

  function symParam() {
    var m = /[?&]s=([A-Za-z0-9\/-]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]).toUpperCase() : null;
  }

  function badgeFor(v) {
    if (!v || !v.v) return '<span class="fd-verdict">–</span>';
    var cls = /Strong Buy/.test(v.v) ? 'up' : /Strong Exit/.test(v.v) ? 'down' : '';
    return '<span class="fd-verdict ' + cls + '">' + esc(v.v) + '</span>';
  }

  function metricRow(k, val, tip) {
    return '<div class="fd-m"><span class="fd-mk">' + esc(k) +
      (tip ? ' <span class="info-tip" aria-hidden="true">i</span>' : '') +
      '</span><span class="fd-mv">' + val + '</span></div>';
  }

  function renderProfile(sym) {
    var u = null, i;
    for (i = 0; i < uni.symbols.length; i++) if (uni.symbols[i].s === sym) { u = uni.symbols[i]; break; }
    var v = ver.verdicts[sym] || null;
    if (!u && !v) {
      els['fd-empty'].hidden = false;
      els['fd-empty'].innerHTML = '<b>' + esc(sym) + '</b> is not a listed security in our dataset. ' +
        'Search another symbol above.';
      els['fd-profile'].innerHTML = '';
      els['fd-compare'].innerHTML = '';
      els['fd-news'].innerHTML = '';
      return;
    }
    els['fd-empty'].hidden = true;
    var name = u ? u.n : sym;
    var sector = v && v.sec ? v.sec : 'Unclassified';
    var type = u ? u.t : '–';
    var ch = v ? v.ch : null;
    var chCls = ch == null ? '' : (ch >= 0 ? 'up' : 'down');
    var volRatio = (v && v.vol != null && v.volAvg) ? v.vol / v.volAvg : null;

    var h = '<div class="fd-head"><div><p class="fd-sym">' + esc(sym) + '</p>' +
      '<h2>' + esc(name) + '</h2>' +
      '<p class="fd-sub">' + esc(sector) + ' · ' + esc(type) + '</p></div>' +
      '<div class="fd-price"><span class="fd-px">' + (v ? 'Rs ' + num(v.p, 2) : '–') + '</span>' +
      '<span class="' + chCls + '">' + signed(ch, 2) + '% on the day</span>' +
      '<span class="fd-links"><a href="/nepse-chart/?s=' + esc(sym) + '">Chart →</a>' +
      ' <a href="/nepse-screener/">Screener →</a></span></div></div>';
    h += '<div class="fd-grid">' +
      metricRow('Engine verdict', badgeFor(v)) +
      metricRow('Verdict score', v ? signed(v.s, 1) + ' / ±10' : '–') +
      metricRow('RSI (14)', v ? num(v.rsi, 1) : '–') +
      metricRow('52-week high', v ? 'Rs ' + num(v.h52, 2) : '–') +
      metricRow('52-week low', v ? 'Rs ' + num(v.l52, 2) : '–') +
      metricRow('Position in 52w range', v && v.pos != null ? num(v.pos * 100, 0) + '%' : '–') +
      metricRow('Volume vs 20-day avg', volRatio != null ? num(volRatio, 2) + '×' : '–') +
      metricRow('Chart pattern', v && v.setup ? esc(v.setup) : '–') +
      '</div>';
    if (v && v.l) h += '<p class="fd-note">LTP-only history: this security has no full OHLC candles, so some derived fields (such as pattern or stop/target levels) may be unavailable.</p>';
    h += '<p class="asof">' + (window.NepseFresh ? window.NepseFresh.badge(v ? v.asof : ver.asof) : '') +
      ' <span class="fd-src">Source: Alpha Lab daily batch.</span></p>';
    els['fd-profile'].innerHTML = h;

    // sector comparison
    var ch2 = '';
    if (v && v.sec) {
      var defs = [
        { k: 'rsi', label: 'RSI (14)', d: 1, suffix: '' },
        { k: 'ch', label: 'Day change', d: 2, suffix: '%' },
        { k: 'pos', label: 'Position in 52w range', d: 0, suffix: '%', pct: true }
      ];
      var rows = defs.map(function (df) {
        var st = sectorStats(ver.verdicts, v.sec, sym, df.k);
        if (!st) return '';
        var mine = v[df.k];
        var mineTxt = mine == null ? '–' :
          df.k === 'rsi' ? num(mine, df.d) + df.suffix :
          df.k === 'ch' ? signed(mine, df.d) + df.suffix :
          num(mine * 100, df.d) + df.suffix;
        var medTxt = st.med == null ? '–' : (df.pct ? num(st.med * 100, df.d) : num(st.med, df.d)) + df.suffix;
        var rankTxt = st.rank > 0 ? 'Ranked ' + st.rank + ' of ' + st.n + ' in ' + esc(v.sec) + ' (1 = highest).' : 'Not ranked: no value for this metric.';
        return '<tr><td>' + esc(df.label) + '</td><td>' + mineTxt + '</td><td>' + medTxt + '</td><td>' + rankTxt + '</td></tr>';
      }).join('');
      ch2 = '<h3>Against its sector</h3>' +
        '<p class="fd-sub2">Sector medians computed from the latest batch over securities with data. Rank 1 is the highest value in ' + esc(v.sec) + '.</p>' +
        '<div class="fd-table-wrap"><table class="fd-table"><thead><tr><th>Metric</th><th>' + esc(sym) + '</th><th>Sector median</th><th>Rank</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>';
    } else {
      ch2 = '<h3>Against its sector</h3><p class="fd-sub2">No sector is recorded for this security, so no sector comparison is available.</p>';
    }
    els['fd-compare'].innerHTML = ch2;

    // news mentioning this symbol
    var items = news ? news.items.filter(function (it) { return it.sym === sym; }).slice(0, 5) : [];
    var nh = '<h3>Recent headlines</h3>';
    if (items.length) {
      nh += '<div class="fd-news-list">' + items.map(function (it) {
        return '<article class="fd-news-item"><a href="' + esc(it.link) + '" target="_blank" rel="noopener">' +
          esc(it.title) + '</a><p>' + esc(it.src) + ' · ' + esc(it.date) + '</p></article>';
      }).join('') + '</div><p class="fd-more"><a href="/nepse-news/">More NEPSE market news →</a></p>';
    } else {
      nh += '<p class="fd-sub2">No headlines in the last 7 days mention ' + esc(sym) + '. News is collected daily from Nepali business media.</p>';
    }
    els['fd-news'].innerHTML = nh;
  }

  /* ---------- autocomplete ---------- */
  var input = els['fd-sym'], sugg = els['fd-suggest'], activeIdx = -1, matches = [];
  function pick(sym) {
    input.value = sym;
    sugg.hidden = true;
    try { history.replaceState(null, '', '?s=' + encodeURIComponent(sym)); } catch (e) {}
    cur = sym;
    renderFundTable(fundData, sym);
    renderProfile(sym);
  }
  function renderSugg() {
    if (!matches.length) { sugg.hidden = true; return; }
    sugg.innerHTML = matches.slice(0, 8).map(function (m, i) {
      return '<li role="option" id="fd-opt-' + i + '" aria-selected="' + (i === activeIdx) + '">' +
        '<strong>' + esc(m.s) + '</strong><span>' + esc(m.n) + '</span></li>';
    }).join('');
    sugg.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', function () {
    var q = input.value.trim().toUpperCase();
    activeIdx = -1;
    if (!q || !uni) { sugg.hidden = true; return; }
    matches = uni.symbols.filter(function (x) {
      return x.s.indexOf(q) === 0 || x.n.toUpperCase().indexOf(q) !== -1;
    }).map(function (x) {
      // rank: exact symbol first, then symbol prefix, then name match
      var score = x.s === q ? 0 : (x.s.indexOf(q) === 0 ? 1 : 2);
      return { x: x, score: score };
    }).sort(function (a, b) {
      return a.score - b.score || (a.x.s < b.x.s ? -1 : a.x.s > b.x.s ? 1 : 0);
    }).map(function (o) { return o.x; }).slice(0, 20);
    renderSugg();
  });
  input.addEventListener('keydown', function (e) {
    if (sugg.hidden) { if (e.key === 'Enter') { var q = input.value.trim().toUpperCase(); if (q) pick(q); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, Math.min(matches.length, 8) - 1); renderSugg(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderSugg(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0 && matches[activeIdx]) pick(matches[activeIdx].s); }
    else if (e.key === 'Escape') { sugg.hidden = true; }
  });
  sugg.addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (!li) return;
    var idx = Array.prototype.indexOf.call(sugg.children, li);
    if (matches[idx]) pick(matches[idx].s);
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.fd-search-wrap')) sugg.hidden = true;
  });

  /* ---------- quarterly figures table (numbers first) ---------- */
  function renderFundTable(fund, firstSym) {
    var host = $('fd-table');
    if (!host) return;
    if (!fund || !fund.banks) { host.innerHTML = ''; return; }
    var syms = Object.keys(fund.banks).sort();
    if (!syms.length) { host.innerHTML = ''; return; }
    // the searched symbol's row goes first, the rest follow alphabetically
    if (firstSym && syms.indexOf(firstSym) >= 0) {
      syms = [firstSym].concat(syms.filter(function (s) { return s !== firstSym; }));
    }
    var rows = syms.map(function (s) {
      var f = fund.banks[s];
      var td = function (v) {
        return '<td>' + (v === null || v === undefined ? '<span class="fd-np">not published</span>' : esc(v)) + '</td>';
      };
      return '<tr><td><a href="/stocks/' + esc(s) + '/"><b>' + esc(s) + '</b></a></td>' +
        td(f.eps_ttm == null ? null : 'Rs ' + f.eps_ttm) +
        td(f.pe_ttm == null ? null : f.pe_ttm + 'x') +
        td(f.netprofit_b == null ? null : 'Rs ' + f.netprofit_b + 'b') +
        td(f.npl_pct == null ? null : f.npl_pct + '%') + '</tr>';
    }).join('');
    host.innerHTML =
      '<h3>Latest quarterly figures (published company figures)</h3>' +
      '<p class="fd-sub2">' + esc(fund.period || '') + ' · figures as published by the companies, not estimates · money in Rs billions</p>' +
      '<div class="fd-table-wrap"><table class="fd-table-t">' +
      '<thead><tr><th>Symbol</th><th>EPS (TTM)</th><th>P/E (TTM)</th><th>Net profit</th><th>NPL</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- boot ---------- */
  function setStatus(msg, err) {
    els['fd-status'].hidden = !msg;
    els['fd-status'].textContent = msg || '';
    els['fd-status'].classList.toggle('err', !!err);
  }
  Promise.all([
    fetch(UNI_URL).then(function (r) { return r.ok ? r.json() : null; }),
    fetch(VER_URL).then(function (r) { return r.ok ? r.json() : null; }),
    fetch(NEWS_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch(FUND_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    uni = res[0]; ver = res[1]; news = res[2]; fundData = res[3];
    if (!uni || !ver) { setStatus('Could not load the daily batch. Please reload the page.', true); return; }
    setStatus('');
    var sym = symParam();
    renderFundTable(fundData, sym);
    if (sym) { input.value = sym; cur = sym; renderProfile(sym); }
    else {
      els['fd-empty'].hidden = false;
      els['fd-empty'].innerHTML = 'Search a symbol above to see its snapshot, sector comparison, and recent headlines.';
    }
    if (els['fd-asof'] && window.NepseFresh) els['fd-asof'].innerHTML = window.NepseFresh.badge(ver.asof);
  }).catch(function () {
    setStatus('Could not load the daily batch. Please reload the page.', true);
  });
})();
