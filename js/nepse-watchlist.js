/* NEPSE Alpha Lab: browser-local watchlist.
   Unlimited, free, no login: symbols are stored in this browser only,
   under the 'nl_watchlist_v1' localStorage key.
   Exposes window.NLWatch for other suite pages (e.g. the dashboard).
   The page UI below only initializes when the watchlist page markup exists. */
(function () {
  'use strict';

  var KEY = 'nl_watchlist_v1';
  var MAX_SYMBOLS = 500;

  function clean(sym) {
    sym = String(sym || '').trim().toUpperCase();
    return /^[A-Z0-9]{1,12}$/.test(sym) ? sym : null;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      var out = [];
      arr.forEach(function (s) { var c = clean(s); if (c && out.indexOf(c) === -1) out.push(c); });
      return out;
    } catch (e) { return []; }
  }

  function persist(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage full or blocked */ }
    listeners.forEach(function (fn) { try { fn(list.slice()); } catch (e) {} });
  }

  var listeners = [];
  function onChange(fn) {
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); };
  }

  window.NLWatch = {
    key: KEY,
    get: load,
    has: function (sym) { sym = clean(sym); return !!sym && load().indexOf(sym) > -1; },
    add: function (sym) {
      sym = clean(sym);
      if (!sym) return false;
      var list = load();
      if (list.indexOf(sym) > -1) return true;
      if (list.length >= MAX_SYMBOLS) return false;
      list.push(sym);
      persist(list);
      return true;
    },
    remove: function (sym) {
      sym = clean(sym);
      if (!sym) return false;
      var list = load();
      var i = list.indexOf(sym);
      if (i === -1) return false;
      list.splice(i, 1);
      persist(list);
      return true;
    },
    onChange: onChange
  };

  /* ---------------- watchlist page UI ---------------- */
  var searchInput = document.getElementById('wl-search');
  if (!searchInput) return; // not the watchlist page; dashboard pages only need NLWatch

  var suggestBox = document.getElementById('wl-suggest');
  var listEl = document.getElementById('wl-list');
  var emptyEl = document.getElementById('wl-empty');
  var countEl = document.getElementById('wl-count');
  var updatedEl = document.getElementById('wl-updated');
  var addHint = document.getElementById('wl-add-hint');

  var universe = []; // [{s, n}]
  var verdicts = {}; // sym -> {v,p,ch,rsi,sec,asof}
  var dataAsof = '';
  var dataReady = false;
  var activeIdx = -1;
  var currentMatches = [];

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

  function loadData() {
    return Promise.all([
      fetch('/nepse-chart/data/universe.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/nepse-chart/data/verdicts.json').then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (res) {
      var u = res[0], v = res[1];
      if (u && Array.isArray(u.symbols)) universe = u.symbols;
      if (v && v.verdicts) { verdicts = v.verdicts; dataAsof = v.asof || ''; }
      dataReady = true;
      if (dataAsof && updatedEl) {
        updatedEl.innerHTML = 'Prices and signals as of ' + esc(dataAsof) + '. ' +
          (window.NepseFresh ? NepseFresh.badge(dataAsof) : '');
      }
      renderList();
    }).catch(function () {
      dataReady = false;
      renderList();
    });
  }

  function renderList() {
    var list = NLWatch.get();
    if (countEl) countEl.textContent = list.length === 1 ? '1 security tracked' : list.length + ' securities tracked';
    if (!dataReady) {
      listEl.innerHTML = '<p class="wl-note">Could not load market data. Your saved symbols are safe in this browser; please try again later.</p>';
      return;
    }
    if (list.length === 0) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    var rows = list.map(function (sym) {
      var vd = verdicts[sym] || {};
      var meta = null;
      for (var i = 0; i < universe.length; i++) { if (universe[i].s === sym) { meta = universe[i]; break; } }
      var chg = vd.ch;
      var chgHtml = '<span class="tnum ' + (chg > 0 ? 'up' : chg < 0 ? 'down' : '') + '">' +
        (chg === null || chg === undefined ? '–' : (chg > 0 ? '+' : '') + fmtNum(chg, 2) + '%') + '</span>';
      return '<article class="wl-row">' +
        '<div class="wl-sym"><a href="/nepse-chart/?s=' + esc(sym) + '">' + esc(sym) + '</a>' +
        '<span class="wl-name">' + esc(meta ? meta.n : '') + '</span></div>' +
        '<div class="wl-meta"><span class="wl-sec">' + esc(vd.sec || '–') + '</span></div>' +
        '<div class="wl-num"><span class="wl-lab">Price</span><span class="tnum">' + fmtNum(vd.p, 2) + '</span></div>' +
        '<div class="wl-num"><span class="wl-lab">Day</span>' + chgHtml + '</div>' +
        '<div class="wl-num"><span class="wl-lab">Signal</span><span class="verdict sm ' + pillClass(vd.v) + '">' + esc(vd.v || '–') + '</span></div>' +
        '<div class="wl-num"><span class="wl-lab">RSI(14)</span><span class="tnum">' + (vd.rsi === null || vd.rsi === undefined ? '–' : fmtNum(vd.rsi, 1)) + '</span></div>' +
        '<button type="button" class="wl-rm" data-sym="' + esc(sym) + '" aria-label="Remove ' + esc(sym) + ' from watchlist">×</button>' +
        '</article>';
    }).join('');
    listEl.innerHTML = rows;
  }

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-sym]');
    if (!btn) return;
    NLWatch.remove(btn.getAttribute('data-sym'));
    renderList();
  });

  NLWatch.onChange(renderList);

  /* -------- autocomplete -------- */
  function matches(q) {
    q = q.trim().toUpperCase();
    if (!q || q.length < 1) return [];
    var starts = [], contains = [];
    for (var i = 0; i < universe.length; i++) {
      var u = universe[i];
      if (u.s.indexOf(q) === 0) starts.push(u);
      else if (u.s.indexOf(q) > -1 || u.n.toUpperCase().indexOf(q) > -1) contains.push(u);
      if (starts.length >= 8) break;
    }
    return starts.concat(contains).slice(0, 8);
  }

  function renderSuggest() {
    if (!currentMatches.length) { suggestBox.hidden = true; suggestBox.innerHTML = ''; activeIdx = -1; return; }
    suggestBox.innerHTML = currentMatches.map(function (u, i) {
      return '<li role="option" id="wl-opt-' + i + '" aria-selected="' + (i === activeIdx) + '">' +
        '<strong>' + esc(u.s) + '</strong><span>' + esc(u.n) + '</span></li>';
    }).join('');
    suggestBox.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    if (activeIdx > -1) searchInput.setAttribute('aria-activedescendant', 'wl-opt-' + activeIdx);
    else searchInput.removeAttribute('aria-activedescendant');
  }

  function closeSuggest() {
    suggestBox.hidden = true; suggestBox.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIdx = -1; currentMatches = [];
  }

  searchInput.addEventListener('input', function () {
    activeIdx = -1;
    currentMatches = dataReady ? matches(searchInput.value) : [];
    renderSuggest();
  });

  searchInput.addEventListener('keydown', function (e) {
    if (suggestBox.hidden) { if (e.key === 'Enter') { tryAdd(searchInput.value); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, currentMatches.length - 1); renderSuggest(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, -1); renderSuggest(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(activeIdx > -1 ? currentMatches[activeIdx].s : searchInput.value); }
    else if (e.key === 'Escape') { closeSuggest(); }
  });

  suggestBox.addEventListener('click', function (e) {
    var li = e.target.closest('li[role="option"]');
    if (li) choose(currentMatches[Number(li.id.replace('wl-opt-', ''))].s);
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.wl-search-wrap')) closeSuggest();
  });

  function choose(sym) {
    if (tryAdd(sym)) { searchInput.value = ''; closeSuggest(); searchInput.focus(); }
  }

  function tryAdd(sym) {
    var c = clean(sym);
    if (!c) return false;
    var known = false;
    for (var i = 0; i < universe.length; i++) { if (universe[i].s === c) { known = true; break; } }
    if (!known) { showHint('No listed security matches "' + sym + '". Check the symbol and try again.'); return false; }
    if (NLWatch.has(c)) { showHint(c + ' is already on your watchlist.'); return true; }
    if (NLWatch.add(c)) { showHint(c + ' added to your watchlist.'); return true; }
    showHint('Your watchlist is full.');
    return false;
  }

  var hintTimer = null;
  function showHint(msg) {
    if (!addHint) return;
    addHint.textContent = msg;
    addHint.hidden = false;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { addHint.hidden = true; }, 4000);
  }

  loadData();
})();
