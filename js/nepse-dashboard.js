/* NEPSE Alpha Lab: personal market dashboard.
   Widgets are selectable and reorderable; the layout persists in this browser
   under the 'nl_dashboard_v1' localStorage key. Requires window.NLWatch
   (js/nepse-watchlist.js) for the watchlist widget. */
(function () {
  'use strict';

  var root = document.getElementById('dash-widgets');
  var picker = document.getElementById('dash-picker');
  if (!root || !picker) return;

  var KEY = 'nl_dashboard_v1';
  var WIDGETS = [
    { id: 'market',    label: 'Market today' },
    { id: 'watchlist', label: 'My watchlist' },
    { id: 'rsi',       label: 'RSI extremes' },
    { id: 'news',      label: 'Market news' }
  ];
  var DEFAULTS = { order: ['market', 'watchlist', 'rsi', 'news'], hidden: [] };

  function loadCfg() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      var c = JSON.parse(raw);
      if (!c || !Array.isArray(c.order)) return JSON.parse(JSON.stringify(DEFAULTS));
      var valid = WIDGETS.map(function (w) { return w.id; });
      var order = c.order.filter(function (id) { return valid.indexOf(id) > -1; });
      valid.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });
      var hidden = Array.isArray(c.hidden) ? c.hidden.filter(function (id) { return valid.indexOf(id) > -1; }) : [];
      return { order: order, hidden: hidden };
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }

  function saveCfg(cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  var cfg = loadCfg();
  var cache = { wave1: null, news: null, verdicts: null };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(x, d) {
    if (x === null || x === undefined || isNaN(x)) return '–';
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function pillClass(v) {
    if (v === 'Strong Buy') return 'v-sb';
    if (v === 'Buy') return 'v-b';
    if (v === 'Hold') return 'v-h';
    if (v === 'Exit / Reduce') return 'v-e';
    if (v === 'Strong Exit') return 'v-se';
    return 'v-h';
  }
  function fresh(asof) {
    return (window.NepseFresh && asof) ? ' ' + NepseFresh.badge(asof) : '';
  }

  /* ---------- widget renderers ---------- */
  function renderMarket(w) {
    var m = w && w.market;
    if (!m) return '<p class="wg-note">Market data is temporarily unavailable.</p>';
    var ix = m.index || {};
    var chgCls = ix.change > 0 ? 'up' : ix.change < 0 ? 'down' : '';
    var gainers = (m.gainers || []).slice(0, 5).map(function (g) {
      return '<li><a href="/nepse-chart/?s=' + esc(g.s) + '">' + esc(g.s) + '</a>' +
        '<span class="tnum">' + fmtNum(g.p, 2) + '</span>' +
        '<span class="tnum up">+' + fmtNum(g.ch, 2) + '%</span></li>';
    }).join('');
    var losers = (m.losers || []).slice(0, 5).map(function (g) {
      return '<li><a href="/nepse-chart/?s=' + esc(g.s) + '">' + esc(g.s) + '</a>' +
        '<span class="tnum">' + fmtNum(g.p, 2) + '</span>' +
        '<span class="tnum down">' + fmtNum(g.ch, 2) + '%</span></li>';
    }).join('');
    return '<div class="wg-stats">' +
      '<div class="wg-stat"><span class="wg-lab">NEPSE index</span>' +
      '<span class="wg-big tnum">' + fmtNum(ix.value, 2) + '</span>' +
      '<span class="tnum ' + chgCls + '">' + (ix.change > 0 ? '+' : '') + fmtNum(ix.change, 2) +
      ' (' + (ix.pct > 0 ? '+' : '') + fmtNum(ix.pct, 2) + '%)</span></div>' +
      '<div class="wg-stat"><span class="wg-lab">Traded securities</span>' +
      '<span class="wg-big tnum">' + fmtNum(m.traded, 0) + '</span></div>' +
      '<div class="wg-stat"><span class="wg-lab">Advancers / decliners</span>' +
      '<span class="wg-big tnum"><span class="up">' + fmtNum(m.advancers, 0) + '</span> / <span class="down">' + fmtNum(m.decliners, 0) + '</span></span></div>' +
      '<div class="wg-stat"><span class="wg-lab">Turnover</span>' +
      '<span class="wg-big tnum">Rs ' + fmtNum(Math.round((m.totalTurnover || 0) / 1e7) / 100, 2) + 'B</span></div>' +
      '</div>' +
      '<div class="wg-cols"><div><h3 class="wg-sub">Top gainers</h3><ul class="wg-list">' + gainers + '</ul></div>' +
      '<div><h3 class="wg-sub">Top losers</h3><ul class="wg-list">' + losers + '</ul></div></div>' +
      '<p class="wg-note">Market data for ' + esc(m.date || '') + '.' + fresh(m.date) + '</p>';
  }

  function renderWatchlist() {
    var list = (window.NLWatch ? NLWatch.get() : []);
    if (!list.length) {
      return '<p class="wg-note">Your watchlist is empty. <a href="/nepse-watchlist/">Add the securities you follow</a> and they will appear here.</p>';
    }
    var vd = cache.verdicts || {};
    var rows = list.slice(0, 8).map(function (sym) {
      var v = vd[sym] || {};
      var chg = v.ch;
      var chgHtml = chg === null || chg === undefined ? '–' :
        '<span class="tnum ' + (chg > 0 ? 'up' : chg < 0 ? 'down' : '') + '">' +
        (chg > 0 ? '+' : '') + fmtNum(chg, 2) + '%</span>';
      return '<li><a href="/nepse-chart/?s=' + esc(sym) + '">' + esc(sym) + '</a>' +
        '<span class="tnum">' + fmtNum(v.p, 2) + '</span>' + chgHtml +
        '<span class="verdict sm ' + pillClass(v.v) + '">' + esc(v.v || '–') + '</span></li>';
    }).join('');
    var more = list.length > 8 ? '<p class="wg-note">Showing 8 of ' + list.length + ' tracked. <a href="/nepse-watchlist/">Manage the full list</a></p>' : '';
    return '<ul class="wg-list wg-compact">' + rows + '</ul>' + more +
      '<p class="wg-note"><a href="/nepse-watchlist/">Open the watchlist</a></p>';
  }

  function renderRsi(w) {
    var r = w && w.rsi;
    if (!r) return '<p class="wg-note">RSI data is temporarily unavailable.</p>';
    function items(arr) {
      return (arr || []).slice(0, 5).map(function (x) {
        return '<li><a href="/nepse-chart/?s=' + esc(x.s) + '">' + esc(x.s) + '</a>' +
          '<span class="tnum">' + fmtNum(x.rsi, 1) + '</span>' +
          '<span class="tnum ' + (x.ch > 0 ? 'up' : x.ch < 0 ? 'down' : '') + '">' +
          (x.ch > 0 ? '+' : '') + fmtNum(x.ch, 2) + '%</span></li>';
      }).join('');
    }
    return '<div class="wg-cols"><div><h3 class="wg-sub">Lowest RSI(14)</h3><ul class="wg-list">' + items(r.lowest) + '</ul></div>' +
      '<div><h3 class="wg-sub">Highest RSI(14)</h3><ul class="wg-list">' + items(r.highest) + '</ul></div></div>' +
      '<p class="wg-note">RSI(14) as of ' + esc(r.asof || '') + '.' + fresh(r.asof) +
      ' Momentum readings, not calls to buy or sell. <a href="/nepse-screener/">See the full screener</a></p>';
  }

  function renderNews(n) {
    var items = (n && n.items) || [];
    if (!items.length) return '<p class="wg-note">The news feed is temporarily unavailable.</p>';
    var lis = items.slice(0, 5).map(function (x) {
      return '<li><a class="wg-nsym" href="/nepse-chart/?s=' + esc(x.sym) + '">' + esc(x.sym) + '</a>' +
        '<a class="wg-ntitle" href="' + esc(x.link) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' +
        '<span class="wg-nmeta">' + esc(x.src) + ' · ' + esc(x.date) + '</span></li>';
    }).join('');
    return '<ul class="wg-news">' + lis + '</ul>' +
      '<p class="wg-note">Latest headlines.' + fresh(n.asof) + ' <a href="/nepse-news/">Open the news feed</a></p>';
  }

  var TITLES = { market: 'Market today', watchlist: 'My watchlist', rsi: 'RSI extremes', news: 'Market news' };
  var DESCS = {
    market: 'Index, breadth and turnover from the latest session.',
    watchlist: 'Your saved securities at a glance.',
    rsi: 'Momentum extremes across the listed universe.',
    news: 'The latest market-moving headlines.'
  };

  function buildWidgets() {
    root.innerHTML = '';
    cfg.order.forEach(function (id, pos) {
      if (cfg.hidden.indexOf(id) > -1) return;
      var sec = document.createElement('section');
      sec.className = 'wg-card';
      sec.setAttribute('aria-label', TITLES[id]);
      sec.innerHTML = '<div class="wg-head"><div><h2>' + TITLES[id] + '</h2>' +
        '<p>' + DESCS[id] + '</p></div>' +
        '<div class="wg-move">' +
        '<button type="button" data-move="up" data-id="' + id + '" aria-label="Move ' + TITLES[id] + ' up"' + (pos === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" data-move="down" data-id="' + id + '" aria-label="Move ' + TITLES[id] + ' down">↓</button>' +
        '</div></div>' +
        '<div class="wg-body" id="wg-' + id + '"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
      root.appendChild(sec);
    });
    paintWidgets();
  }

  function paintWidgets() {
    var body;
    body = document.getElementById('wg-market');
    if (body) body.innerHTML = renderMarket(cache.wave1);
    body = document.getElementById('wg-watchlist');
    if (body) body.innerHTML = renderWatchlist();
    body = document.getElementById('wg-rsi');
    if (body) body.innerHTML = renderRsi(cache.wave1);
    body = document.getElementById('wg-news');
    if (body) body.innerHTML = renderNews(cache.news);
  }

  function buildPicker() {
    picker.innerHTML = WIDGETS.map(function (w) {
      var on = cfg.hidden.indexOf(w.id) === -1;
      return '<label class="wg-toggle"><input type="checkbox" data-wg="' + w.id + '"' + (on ? ' checked' : '') + '>' +
        '<span>' + w.label + '</span></label>';
    }).join('');
  }

  picker.addEventListener('change', function (e) {
    var cb = e.target.closest('input[data-wg]');
    if (!cb) return;
    var id = cb.getAttribute('data-wg');
    var i = cfg.hidden.indexOf(id);
    if (cb.checked && i > -1) cfg.hidden.splice(i, 1);
    if (!cb.checked && i === -1) cfg.hidden.push(id);
    saveCfg(cfg);
    buildWidgets();
  });

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-move]');
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute('data-id');
    var dir = btn.getAttribute('data-move');
    var visible = cfg.order.filter(function (x) { return cfg.hidden.indexOf(x) === -1; });
    var vi = visible.indexOf(id);
    var swapWith = dir === 'up' ? vi - 1 : vi + 1;
    if (vi < 0 || swapWith < 0 || swapWith >= visible.length) return;
    var a = cfg.order.indexOf(visible[vi]);
    var b = cfg.order.indexOf(visible[swapWith]);
    var tmp = cfg.order[a]; cfg.order[a] = cfg.order[b]; cfg.order[b] = tmp;
    saveCfg(cfg);
    buildWidgets();
  });

  function loadData() {
    return Promise.all([
      fetch('/nepse-chart/data/wave1.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/nepse-chart/data/news.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/nepse-chart/data/verdicts.json').then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (res) {
      cache.wave1 = res[0];
      cache.news = res[1];
      cache.verdicts = (res[2] && res[2].verdicts) || {};
      paintWidgets();
    }).catch(function () { paintWidgets(); });
  }

  if (window.NLWatch) NLWatch.onChange(function () { paintWidgets(); });

  buildPicker();
  buildWidgets();
  loadData();
})();
