/* NEPSE Decode: multi-list watchlist deck (D2 / S7 idiom).
   Four numbered lists, keyboard-first. Everything stays in this browser:
   storage key 'nd_watchlists_v2' -> { lists: [{name, syms}], active }.
   MIGRATION: the legacy single list under 'nl_watchlist_v1' is moved into
   List 1 on first load; no symbol is dropped and the legacy key is kept
   as a backup. window.NLWatch keeps its old single-list API (backed by
   List 1) so other suite pages keep working. The engine-watchlist
   timeframe key 'nd_ewl_tf' is unchanged.
   Page UI below only initializes when the watchlist page markup exists. */
(function () {
  'use strict';

  var KEY = 'nd_watchlists_v2';
  var OLD_KEY = 'nl_watchlist_v1';
  var EWL_TF_KEY = 'nd_ewl_tf';
  var MAX_SYMBOLS = 500;
  var LIST_COUNT = 4;

  // Shared formatters (js/nepse-format.js). Day-change rendering goes through
  // NepseFormat.fmtChange so a rupee amount NEVER carries a % suffix.
  var NF = (typeof window !== 'undefined' && window.NepseFormat) || null;
  function fmtChange(chRs, pct) {
    if (NF && typeof NF.fmtChange === 'function') return NF.fmtChange(chRs, pct);
    var ch = Number(chRs);
    if (!isFinite(ch)) return '—';
    var p = Number(pct);
    var pctTxt = isFinite(p) ? ' (' + (p > 0 ? '+' : '') + p.toFixed(2) + '%)' : '';
    return (ch > 0 ? '+' : '') + ch.toFixed(2) + pctTxt;
  }
  function pctOfChange(chRs, price) {
    if (NF && typeof NF.pctOfChange === 'function') return NF.pctOfChange(chRs, price);
    var ch = Number(chRs), p = Number(price);
    if (!isFinite(ch) || !isFinite(p)) return null;
    var prev = p - ch;
    return prev ? ch / prev * 100 : null;
  }
  // Rupee change derived from a PERCENT change + last price
  // (verdicts.json ch is percent; live quotes carry rupees directly).
  function rsOfPct(pct, price) {
    if (NF && typeof NF.rsOfPct === 'function') return NF.rsOfPct(pct, price);
    var pc = Number(pct), p = Number(price);
    if (!isFinite(pc) || !isFinite(p) || !p) return null;
    var prev = p / (1 + pc / 100);
    return isFinite(prev) ? p - prev : null;
  }

  function clean(sym) {
    sym = String(sym || '').trim().toUpperCase();
    return /^[A-Z0-9]{1,12}$/.test(sym) ? sym : null;
  }

  function cleanList(arr) {
    var out = [];
    (arr || []).forEach(function (s) {
      var c = clean(s);
      if (c && out.indexOf(c) === -1) out.push(c);
    });
    return out;
  }

  function readLegacy() {
    try {
      var raw = localStorage.getItem(OLD_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? cleanList(arr) : [];
    } catch (e) { return []; }
  }

  function blankStore() {
    var lists = [];
    for (var i = 0; i < LIST_COUNT; i++) lists.push({ name: 'List ' + (i + 1), syms: [] });
    return { lists: lists, active: 0 };
  }

  function persist(store) {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage blocked */ }
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function ensureMigrated() {
    try {
      if (localStorage.getItem(KEY)) return;
    } catch (e) { return; }
    var store = blankStore();
    var legacy = readLegacy();
    if (legacy.length) store.lists[0].syms = legacy.slice(0, MAX_SYMBOLS);
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
      /* keep the legacy key as a backup; it is never read again */
    } catch (e) {}
  }

  function loadStore() {
    ensureMigrated();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var j = JSON.parse(raw);
        if (j && Array.isArray(j.lists) && j.lists.length) {
          var store = blankStore();
          for (var i = 0; i < LIST_COUNT; i++) {
            var l = j.lists[i] || {};
            store.lists[i].name = typeof l.name === 'string' && l.name ? l.name : 'List ' + (i + 1);
            store.lists[i].syms = cleanList(l.syms).slice(0, MAX_SYMBOLS);
          }
          store.active = Math.min(Math.max(0, j.active | 0), LIST_COUNT - 1);
          return store;
        }
      }
    } catch (e) {}
    return blankStore();
  }

  var store = loadStore();

  var listeners = [];
  function onChange(fn) {
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); };
  }

  /* Legacy single-list API (other suite pages). Backed by List 1. */
  window.NLWatch = {
    key: OLD_KEY,
    get: function () { return store.lists[0].syms.slice(); },
    has: function (sym) { sym = clean(sym); return !!sym && store.lists[0].syms.indexOf(sym) > -1; },
    add: function (sym) { return addToList(sym, 0); },
    remove: function (sym) { return removeFromList(sym, 0); },
    onChange: onChange
  };

  /* Multi-list API used by the deck UI. */
  window.NDWatchlists = {
    lists: function () { return store.lists.map(function (l) { return { name: l.name, syms: l.syms.slice() }; }); },
    active: function () { return store.active; },
    setActive: function (i) {
      i = i | 0;
      if (i < 0 || i >= LIST_COUNT || i === store.active) return false;
      store.active = i;
      persist(store);
      return true;
    },
    add: addToList,
    remove: removeFromList,
    onChange: onChange
  };

  function addToList(sym, idx) {
    sym = clean(sym);
    idx = idx === undefined ? store.active : idx;
    if (!sym || idx < 0 || idx >= LIST_COUNT) return false;
    var list = store.lists[idx].syms;
    if (list.indexOf(sym) > -1) return true;
    if (list.length >= MAX_SYMBOLS) return false;
    list.push(sym);
    persist(store);
    return true;
  }

  function removeFromList(sym, idx) {
    sym = clean(sym);
    idx = idx === undefined ? store.active : idx;
    if (!sym || idx < 0 || idx >= LIST_COUNT) return false;
    var list = store.lists[idx].syms;
    var i = list.indexOf(sym);
    if (i === -1) return false;
    list.splice(i, 1);
    persist(store);
    return true;
  }

  /* ---------------- watchlist page UI ---------------- */
  var tabsEl = document.getElementById('wl-tabs');
  if (!tabsEl) return; // not the watchlist page; other pages only need the APIs

  var addInput = document.getElementById('wl-add-input');
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
  var suggestIdx = -1;
  var currentMatches = [];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtNum(x, d) {
    if (x === null || x === undefined || isNaN(x)) return '—';
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }

  function stockUrl(sym) {
    return '/stocks/' + encodeURIComponent(String(sym).replace(/\//g, '-')) + '/';
  }

  /* verdict pill class (D2 .d2-verdict.buy/.hold/.exit) */
  function verdictClass(v) {
    if (v === 'Strong Buy' || v === 'Buy') return 'buy';
    if (v === 'Exit / Reduce' || v === 'Strong Exit') return 'exit';
    return 'hold';
  }

  function metaFor(sym) {
    for (var i = 0; i < universe.length; i++) { if (universe[i].s === sym) return universe[i]; }
    return null;
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
      renderTabs();
      renderList();
      renderEngine();
      var NL = window.NepseLive || null;
      if (NL && document.getElementById('wl-live')) {
        NL.start({
          el: 'wl-live',
          onData: function (d) {
            if (!d || !d.quotes) return;
            // Never repaint rows with a stale tape: on closed days the feed
            // holds yesterday's session. Overlay only when the tape is from
            // today's NPT session and the market is open/pre-open.
            if (!isTapeToday(d)) return;
            var ms = window.NepseMarketConfig && window.NepseMarketConfig.marketState
              ? window.NepseMarketConfig.marketState() : 'CLOSED';
            if (ms !== 'OPEN' && ms !== 'PRE-OPEN') return;
            overlayWatchlistLive(d.quotes);
            overlayEngineLive(d.quotes);
          }
        });
      }

  // True if the live tape's asof falls in today's NPT calendar day.
  function isTapeToday(d) {
    if (!d || !(d.asof >= 0)) return false;
    var NPT_MS = 5.75 * 3600 * 1000;
    var tapeDay = new Date(d.asof + NPT_MS).toISOString().slice(0, 10);
    var today = new Date(Date.now() + NPT_MS).toISOString().slice(0, 10);
    return tapeDay === today;
  }
    }).catch(function () {
      dataReady = false;
      renderTabs();
      renderList();
      renderEngine();
    });
  }

  function renderTabs() {
    tabsEl.innerHTML = store.lists.map(function (l, i) {
      return '<button type="button" class="d2-wl-tab" role="tab" data-i="' + i + '"' +
        ' aria-selected="' + (i === store.active) + '"' +
        ' aria-label="Watchlist ' + (i + 1) + ': ' + esc(l.name) + ', ' + l.syms.length + ' symbols">' +
        '<span class="n">' + (i + 1) + '</span>' + esc(l.name) +
        '<span class="n">' + l.syms.length + '</span><kbd>' + (i + 1) + '</kbd></button>';
    }).join('');
    var tabs = tabsEl.querySelectorAll('.d2-wl-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        if (window.NDWatchlists.setActive(Number(this.getAttribute('data-i')))) {
          renderTabs();
          renderList();
        }
      });
    }
  }

  function rowHtml(sym) {
    var vd = verdicts[sym] || {};
    var meta = metaFor(sym);
    var chg = vd.ch;
    var chgCls = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
    // verdicts.json ch is PERCENT — derive the rupee leg so every row reads
    // "Rs p · rs (pct%)" with the rupee amount never carrying a % suffix.
    var chgTxt = fmtChange(rsOfPct(chg, vd.p), chg);
    var rsi = vd.rsi;
    var rsiTxt = (rsi === null || rsi === undefined) ? 'RSI –' : 'RSI ' + fmtNum(rsi, 1);
    return '<div class="d2-wl-row" role="listitem" tabindex="0" data-sym="' + esc(sym) + '">' +
      '<div class="d2-wl-sym"><a href="' + esc(stockUrl(sym)) + '">' + esc(sym) + '</a>' +
      '<small>' + esc(meta ? meta.n : '') + '</small></div>' +
      '<div class="d2-wl-meta">' +
        '<span class="d2-wl-px d2-num">Rs ' + fmtNum(vd.p, 2) + '</span>' +
        '<span class="d2-wl-chg ' + chgCls + '">' + chgTxt + '</span>' +
        '<span class="d2-verdict ' + verdictClass(vd.v) + '">' + esc(vd.v || '—') + '</span>' +
        '<span class="d2-wl-rsi">' + esc(rsiTxt) + '</span>' +
      '</div>' +
      '<div class="d2-wl-acts">' +
        '<button type="button" class="d2-wl-act" data-act="quote" title="Open quote (Enter)" aria-label="Open ' + esc(sym) + ' quote">Quote</button>' +
        '<button type="button" class="d2-wl-x" data-act="del" title="Remove from list (Delete)" aria-label="Remove ' + esc(sym) + ' from list">×</button>' +
      '</div></div>';
  }

  function renderList() {
    var list = store.lists[store.active];
    var n = list.syms.length;
    if (countEl) {
      countEl.textContent = (n === 1 ? '1 security' : n + ' securities') +
        ' in ' + list.name + ' — press 1–4 to switch lists';
    }
    if (!dataReady) {
      listEl.innerHTML = '<div class="d2-wl-empty">Could not load market data. Your saved symbols are safe in this browser; please try again later.</div>';
      if (emptyEl) emptyEl.hidden = true;
      return;
    }
    if (!n) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = list.syms.map(rowHtml).join('');
  }

  function focusRow(sym, dir) {
    var rows = listEl.querySelectorAll('.d2-wl-row');
    var idx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-sym') === sym) { idx = i; break; }
    }
    var next = rows[idx + dir];
    if (next) next.focus();
    else if (addInput) addInput.focus();
  }

  function openQuote(sym) {
    window.location.href = stockUrl(sym);
  }

  function removeRow(sym) {
    if (removeFromList(sym, store.active)) {
      renderTabs();
      renderList();
      showHint(sym + ' removed from ' + store.lists[store.active].name + '.');
      focusRow(sym, 1);
    }
  }

  /* row interactions: hover actions + keyboard */
  listEl.addEventListener('click', function (e) {
    var actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    var row = e.target.closest('.d2-wl-row');
    if (!row) return;
    var sym = row.getAttribute('data-sym');
    e.preventDefault();
    if (actBtn.getAttribute('data-act') === 'del') removeRow(sym);
    else openQuote(sym);
  });

  listEl.addEventListener('keydown', function (e) {
    var row = e.target.closest('.d2-wl-row');
    if (!row) return;
    var sym = row.getAttribute('data-sym');
    if (e.key === 'Enter') { e.preventDefault(); openQuote(sym); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeRow(sym); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(sym, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(sym, -1); }
  });

  onChange(function () { renderTabs(); renderList(); });

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
    if (!currentMatches.length) { closeSuggest(); return; }
    suggestBox.innerHTML = currentMatches.map(function (u, i) {
      return '<button type="button" role="option" id="wl-opt-' + i + '" data-i="' + i + '"' +
        (i === suggestIdx ? ' class="active"' : '') + '>' +
        '<span>' + esc(u.s) + '</span><small>' + esc(u.n) + '</small></button>';
    }).join('');
    suggestBox.hidden = false;
  }

  function closeSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = '';
    suggestIdx = -1;
    currentMatches = [];
  }

  addInput.addEventListener('input', function () {
    suggestIdx = -1;
    currentMatches = dataReady ? matches(addInput.value) : [];
    renderSuggest();
  });

  addInput.addEventListener('keydown', function (e) {
    if (suggestBox.hidden) {
      if (e.key === 'Enter') { e.preventDefault(); tryAdd(addInput.value); }
      else if (e.key === 'Escape') { addInput.blur(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); suggestIdx = Math.min(suggestIdx + 1, currentMatches.length - 1); renderSuggest(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); suggestIdx = Math.max(suggestIdx - 1, -1); renderSuggest(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestIdx > -1 ? currentMatches[suggestIdx].s : addInput.value); }
    else if (e.key === 'Escape') { closeSuggest(); }
  });

  suggestBox.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (b) choose(currentMatches[Number(b.getAttribute('data-i'))].s);
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.d2-wl-add')) closeSuggest();
  });

  document.getElementById('wl-add-btn').addEventListener('click', function () {
    tryAdd(addInput.value);
  });

  function choose(sym) {
    if (tryAdd(sym)) { addInput.value = ''; closeSuggest(); addInput.focus(); }
  }

  function tryAdd(sym) {
    var c = clean(sym);
    if (!c) return false;
    var known = metaFor(c) !== null;
    if (!known) { showHint('No listed security matches "' + sym + '". Check the symbol and try again.'); return false; }
    var list = store.lists[store.active];
    if (list.syms.indexOf(c) > -1) { showHint(c + ' is already in ' + list.name + '.'); return true; }
    if (addToList(c, store.active)) { showHint(c + ' added to ' + list.name + '.'); return true; }
    showHint('This list is full.');
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

  /* -------- global keyboard: 1–4 switch lists, / focuses add -------- */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (typing) return;
    if (e.key === '/') {
      e.preventDefault();
      if (addInput) { addInput.focus(); addInput.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= LIST_COUNT) {
      if (window.NDWatchlists.setActive(n - 1)) { renderTabs(); renderList(); }
    }
  });

  /* -------- engine watchlist (mechanical picks, multi-timeframe) --------
     Unchanged data logic from the previous build: Strong Buy / Buy rows
     from verdicts.json, ranked per selected candle timeframe. The user's
     own lists above are untouched. */
  var TF_LABEL = { d: 'Daily', w: 'Weekly', m: 'Monthly' };
  function ewlTf() {
    var t = 'd';
    try { t = localStorage.getItem(EWL_TF_KEY) || 'd'; } catch (e) {}
    return TF_LABEL[t] ? t : 'd';
  }
  function tfVerdictOf(e, tf) {
    if (!e) return null;
    if (tf === 'd') return e;
    return e[tf] || null;
  }
  function renderEngine() {
    var box = document.getElementById('wl-engine-list');
    if (!box) return;
    var tf = ewlTf();
    var sel = document.getElementById('ewl-tf');
    if (sel && sel.value !== tf) sel.value = tf;
    if (!dataReady || !Object.keys(verdicts).length) {
      box.innerHTML = '<div class="d2-wl-empty">Engine picks are temporarily unavailable.</div>';
      return;
    }
    function sgn(x) { return (x > 0 ? '+' : '') + x.toFixed(1); }
    var picks = Object.keys(verdicts).map(function (sym) { return [sym, tfVerdictOf(verdicts[sym], tf)]; })
      .filter(function (it) { return it[1] && (it[1].v === 'Strong Buy' || it[1].v === 'Buy'); })
      .sort(function (a, b) { return (b[1].s || 0) - (a[1].s || 0); })
      .slice(0, 12);
    if (!picks.length) {
      box.innerHTML = '<div class="d2-wl-empty">No Strong Buy or Buy verdicts on ' +
        TF_LABEL[tf].toLowerCase() + ' candles in the latest batch.</div>';
    } else {
      box.innerHTML = picks.map(function (it) {
        var sym = it[0], x = it[1] || {}, e = verdicts[sym] || {};
        var ch = Number(e.ch);
        // verdicts.json ch is PERCENT — derive the rupee leg:
        // "-69.18 (-1.23%)", never "-69.18%".
        var chHtml = '<span class="' + (ch > 0 ? 'up' : ch < 0 ? 'dn' : '') + '">' +
            esc(fmtChange(rsOfPct(e.ch, e.p), e.ch)) + '</span>';
        var sltp = 'SL/TP unavailable for this security.';
        if (x.sl != null && x.tp != null && e.p) {
          sltp = 'SL ' + fmtNum(x.sl, 2) + ' (' + sgn((x.sl - e.p) / e.p * 100) + '%)' +
            ' · TP ' + fmtNum(x.tp, 2) + ' (' + sgn((x.tp - e.p) / e.p * 100) + '%)';
        }
        return '<div class="d2-ewl-row">' +
          '<a class="d2-ewl-sym" href="' + esc(stockUrl(sym)) + '">' + esc(sym) +
            '<span class="d2-verdict ' + (x.v === 'Strong Buy' ? 'buy' : 'buy') + '">' + esc(x.v) +
            (tf === 'd' ? '' : ' · ' + TF_LABEL[tf]) + '</span></a>' +
          '<span class="d2-ewl-num d2-num">Rs ' + fmtNum(e.p, 2) + ' · ' + chHtml + '</span>' +
          '<span class="d2-ewl-setup">' + esc(x.setup || '—') + '</span>' +
          '<span class="d2-ewl-sl d2-num">' + esc(sltp) + '</span>' +
        '</div>';
      }).join('');
    }
    var sub = document.getElementById('wl-engine-sub');
    if (sub) {
      var candleWord = TF_LABEL[tf].toLowerCase();
      sub.textContent = 'Mechanical picks ranked on ' + candleWord + ' candles' +
        (dataAsof ? ', data through ' + dataAsof : '') +
        '. Rebuilt with each batch.' +
        (tf === 'd' ? '' : ' A daily Buy can be weak while the ' + candleWord + ' read is stronger.') +
        ' Educational, not investment advice.';
    }
  }

  var tfSel = document.getElementById('ewl-tf');
  if (tfSel) {
    tfSel.value = ewlTf();
    tfSel.addEventListener('change', function () {
      try { localStorage.setItem(EWL_TF_KEY, tfSel.value); } catch (e) {}
      renderEngine();
    });
  }

  /* Live/daily prices: when the quote feed is fresh, overlay live LTP and
     day change onto the user's rows and the engine rows. */
  function overlayWatchlistLive(quotes) {
    if (!listEl || !quotes) return;
    var rows = listEl.querySelectorAll('.d2-wl-row');
    for (var i = 0; i < rows.length; i++) {
      var sym = rows[i].getAttribute('data-sym');
      var q = sym && quotes[sym];
      if (!q || q.ltp == null || !isFinite(Number(q.ltp))) continue;
      var ltpEl = rows[i].querySelector('.d2-wl-px');
      if (ltpEl) ltpEl.textContent = 'Rs ' + fmtNum(q.ltp, 2);
      var chgEl = rows[i].querySelector('.d2-wl-chg');
      if (chgEl) {
        // P0-3 contract: full "rs (pct%)" via fmtChange — never percent-only.
        var chRs = (q.change != null && isFinite(Number(q.change))) ? Number(q.change) : null;
        var pct = (q.percent_change != null && isFinite(Number(q.percent_change))) ? Number(q.percent_change) : null;
        chgEl.textContent = fmtChange(chRs, pct);
        chgEl.className = 'd2-wl-chg ' + (pct != null ? (pct > 0 ? 'up' : pct < 0 ? 'dn' : '') : '');
      }
    }
  }

  function overlayEngineLive(quotes) {
    var box = document.getElementById('wl-engine-list');
    if (!box || !quotes) return;
    var rows = box.querySelectorAll('.d2-ewl-row');
    for (var i = 0; i < rows.length; i++) {
      var link = rows[i].querySelector('.d2-ewl-sym');
      if (!link) continue;
      var m = link.getAttribute('href').match(/\/stocks\/([^\/]+)\//);
      var sym = m && m[1];
      var q = sym && quotes[sym];
      if (!q || q.ltp == null || !isFinite(Number(q.ltp))) continue;
      var ch = Number(q.change);
      // Shared formatter: live quote carries percent_change directly.
      var chHtml = '<span class="' + (ch > 0 ? 'up' : ch < 0 ? 'dn' : '') + '">' +
        esc(fmtChange(ch, q.percent_change)) + '</span>';
      var numEl = rows[i].querySelector('.d2-ewl-num');
      if (numEl) numEl.innerHTML = 'Rs ' + fmtNum(q.ltp, 2) + ' · ' + chHtml;
    }
  }

  loadData();
})();
