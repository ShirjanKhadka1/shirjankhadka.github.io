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
  var freshLine = document.getElementById('wl-fresh-line');
  var distEl = document.getElementById('wl-dist');

  var universe = []; // [{s, n}]
  var verdicts = {}; // sym -> {v,p,ch,rsi,sec,asof}
  var dataAsof = '';
  var dataReady = false;
  var sessionsData = null; // {sessions: [[date, close]]} from watchlist-sessions.json
  var forwardData = {}; // sym -> {close, h5, h10, h20} from watchlist-forward.json
  var SNAP_KEY = 'nd_wl_snapshots_v1'; // browser-local session snapshots
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
      fetch('/nepse-chart/data/verdicts.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/data/watchlist-sessions.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/data/watchlist-forward.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var u = res[0], v = res[1];
      if (u && Array.isArray(u.symbols)) universe = u.symbols;
      if (v && v.verdicts) { verdicts = v.verdicts; dataAsof = v.asof || ''; }
      if (res[2] && Array.isArray(res[2].sessions)) sessionsData = res[2];
      if (res[3] && res[3].symbols) forwardData = res[3].symbols;
      /* Seed the tick gate: without this the first tick always rebuilds. */
      if (u && Array.isArray(u.symbols) && v && v.verdicts) lastWlSig = wlSig(u, v);
      dataReady = true;
      if (dataAsof && updatedEl) {
        updatedEl.innerHTML = 'Prices and signals as of ' + esc(dataAsof) + '. ' +
          (window.NepseFresh ? NepseFresh.badge(dataAsof) : '');
      }
      renderTabs();
      renderList();
      renderEngine();
      renderSector();
      maybeSnapshot();
      renderSessions();
      renderOutcomes();
      setFreshLine('fresh', 'Batch ' + (dataAsof || '—') + ' loaded');
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
      renderSector();
      renderSessions();
      renderOutcomes();
      setFreshLine('failed', 'Could not load market data — your saved symbols are safe in this browser.');
    });
  }

  /* Forward-outcome line on engine rows (from watchlist-forward.json).
     Absent file or absent symbol => no line, never a placeholder. */
  function fwdHtml(sym) {
    var f = forwardData[sym];
    if (!f || !f.h10) return '';
    return '<span class="d2-ewl-fwd">10-session beat ' + (f.h10.beat * 100).toFixed(0) +
      '% (n=' + f.h10.n + ') · mean ' + (f.h10.mean > 0 ? '+' : '') + f.h10.mean.toFixed(2) + 'pp vs NEPSE</span>';
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
      '<div class="d2-wl-sym"><a href="' + esc(stockUrl(sym)) + '">' + (window.NepseLogo?window.NepseLogo.html(sym,'',24):'') + esc(sym) + '</a>' +
      '<small>' + esc(meta ? meta.n : '') + '</small></div>' +
      '<div class="d2-wl-meta">' +
        '<span class="d2-wl-px d2-num">Rs ' + fmtNum(vd.p, 2) + '</span>' +
        '<span class="d2-wl-chg ' + chgCls + '">' + chgTxt + '</span>' +
        '<span class="wl-chgbar ' + (chg > 0 ? 'up' : chg < 0 ? 'dn' : 'flat') + '" role="img" aria-label="Day change ' + (isFinite(chg) ? chg.toFixed(2) : '0') + '%"><i style="--w:' + (isFinite(chg) ? Math.min(Math.abs(chg), 10) / 10 * 100 : 0).toFixed(1) + '%"></i></span>' +
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
      renderDist();
      return;
    }
    if (!n) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      renderDist();
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = list.syms.map(rowHtml).join('');
    renderDist();
    renderSessions();
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
(window.NepseLogo?window.NepseLogo.html(u.s,'',22):'') + '<span>' + esc(u.s) + '</span><small>' + esc(u.n) + '</small></button>';
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
          '<span class="d2-ewl-setup">' + esc(x.setup || '—') + fwdHtml(sym) + '</span>' +
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
      var ltpTxt = 'Rs ' + fmtNum(q.ltp, 2);
      if (ltpEl && ltpEl.textContent !== ltpTxt) ltpEl.textContent = ltpTxt;
      var chgEl = rows[i].querySelector('.d2-wl-chg');
      if (chgEl) {
        // P0-3 contract: full "rs (pct%)" via fmtChange — never percent-only.
        var chRs = (q.change != null && isFinite(Number(q.change))) ? Number(q.change) : null;
        var pct = (q.percent_change != null && isFinite(Number(q.percent_change))) ? Number(q.percent_change) : null;
        var chTxt = fmtChange(chRs, pct);
        var chCls = 'd2-wl-chg ' + (pct != null ? (pct > 0 ? 'up' : pct < 0 ? 'dn' : '') : '');
        if (chgEl.textContent !== chTxt) chgEl.textContent = chTxt;
        if (chgEl.className !== chCls) chgEl.className = chCls;
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
      var numHtml = 'Rs ' + fmtNum(q.ltp, 2) + ' · ' + chHtml;
      if (numEl && numEl.innerHTML !== numHtml) numEl.innerHTML = numHtml;
    }
  }

  /* -------- verdict distribution strip (active list, house pattern) -------- */
  var DIST_BUCKETS = [
    {k: 'sb', label: 'Strong Buy', match: 'Strong Buy'},
    {k: 'b', label: 'Buy', match: 'Buy'},
    {k: 'h', label: 'Hold', match: 'Hold'},
    {k: 'er', label: 'Exit / Reduce', match: 'Exit / Reduce'},
    {k: 'se', label: 'Strong Exit', match: 'Strong Exit'},
    {k: 'ih', label: 'Insufficient history', match: 'Insufficient history'}
  ];
  function renderDist() {
    if (!distEl) return;
    if (!dataReady) { distEl.innerHTML = ''; return; }
    var list = store.lists[store.active];
    var counts = {};
    var total = 0;
    var unscored = [];
    list.syms.forEach(function (sym) {
      var v = (verdicts[sym] || {}).v;
      if (!v) { unscored.push(sym); return; }
      counts[v] = (counts[v] || 0) + 1;
      total++;
    });
    if (!total) {
      distEl.innerHTML = '<p class="wl-dist-note">No verdicts on this list yet — add a symbol to see its mix.</p>';
      return;
    }
    var segs = '', legend = '';
    DIST_BUCKETS.forEach(function (b) {
      var c = counts[b.match] || 0;
      if (!c) return; // zero-count buckets render nothing
      segs += '<i data-b="' + b.k + '" style="width:' + (c / total * 100).toFixed(1) + '%"></i>';
      legend += '<li><i data-b="' + b.k + '"></i>' + esc(b.label) + ' ' + c + '</li>';
    });
    distEl.innerHTML = '<div class="wl-dist-track" role="img" aria-label="Verdict mix: ' +
      DIST_BUCKETS.filter(function (b) { return counts[b.match]; }).map(function (b) { return b.label + ' ' + counts[b.match]; }).join(', ') +
      '">' + segs + '</div><ul class="wl-dist-legend">' + legend + '</ul>' +
      '<p class="wl-dist-note">' + total + ' of ' + list.syms.length + ' symbols scored' +
      (unscored.length ? ' · no verdict: ' + esc(unscored.join(', ')) : '') + '.</p>';
  }

  /* -------- snapshots (browser-local, one per session) -------- */
  function loadSnapshots() {
    try {
      var j = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      return Array.isArray(j) ? j : [];
    } catch (e) { return []; }
  }
  function maybeSnapshot() {
    if (!dataReady || !dataAsof) return;
    var snaps = loadSnapshots();
    for (var i = 0; i < snaps.length; i++) if (snaps[i].asof === dataAsof) return;
    var lists = store.lists.map(function (l) {
      return {name: l.name, syms: l.syms.map(function (sym) {
        var vd = verdicts[sym] || {};
        return {s: sym, p: vd.p != null ? vd.p : null, ch: vd.ch != null ? vd.ch : null, v: vd.v || null};
      })};
    });
    snaps.push({asof: dataAsof, lists: lists});
    if (snaps.length > 90) snaps = snaps.slice(snaps.length - 90);
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snaps)); } catch (e) {}
  }

  /* -------- sector stocks block -------- */
  var secPage = 1, secFilter = '__all';
  function sectorOf(sym) { return (verdicts[sym] || {}).sec || ''; }
  function sectorCounts() {
    var counts = {}, total = 0;
    Object.keys(verdicts).forEach(function (sym) {
      var sec = sectorOf(sym);
      if (!sec) return;
      counts[sec] = (counts[sec] || 0) + 1;
      total++;
    });
    return {counts: counts, total: total};
  }
  function renderSector() {
    var sel = document.getElementById('wl-sec-select');
    var tbody = document.getElementById('wl-sec-tbody');
    var empty = document.getElementById('wl-sec-empty');
    var info = document.getElementById('wl-sec-pager-info');
    var prev = document.getElementById('wl-sec-prev');
    var next = document.getElementById('wl-sec-next');
    if (!sel || !tbody) return;
    if (!dataReady) {
      if (empty) { empty.hidden = false; empty.textContent = 'Market data unavailable — sector stocks will appear once the batch loads.'; }
      tbody.innerHTML = '';
      if (info) info.textContent = '';
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      return;
    }
    var cc = sectorCounts();
    var secs = Object.keys(cc.counts).sort();
    sel.innerHTML = '<option value="__all">All sectors (' + cc.total + ')</option>' + secs.map(function (sec) {
      return '<option value="' + esc(sec) + '"' + (sec === secFilter ? ' selected' : '') + '>' + esc(sec) + ' (' + cc.counts[sec] + ')</option>';
    }).join('');
    var rows = Object.keys(verdicts).filter(function (sym) {
      return secFilter === '__all' || sectorOf(sym) === secFilter;
    }).sort();
    var pageSize = 25;
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (secPage > pages) secPage = pages;
    var page = rows.slice((secPage - 1) * pageSize, secPage * pageSize);
    if (empty) empty.hidden = page.length > 0;
    tbody.innerHTML = page.map(function (sym) {
      var vd = verdicts[sym] || {};
      var meta = metaFor(sym);
      var ch = vd.ch;
      return '<tr><td><a href="' + esc(stockUrl(sym)) + '">' + esc(sym) + '</a></td>' +
        '<td>' + esc(meta ? meta.n : '') + '</td>' +
        '<td class="num">Rs ' + fmtNum(vd.p, 2) + '</td>' +
        '<td class="num ' + (ch > 0 ? 'up' : ch < 0 ? 'dn' : '') + '">' + fmtChange(rsOfPct(ch, vd.p), ch) + '</td>' +
        '<td><span class="d2-verdict ' + verdictClass(vd.v) + '">' + esc(vd.v || '—') + '</span></td>' +
        '<td class="num">' + (vd.rsi == null ? '—' : fmtNum(vd.rsi, 1)) + '</td>' +
        '<td><button type="button" class="wl-sec-add" data-sym="' + esc(sym) + '">Add</button></td></tr>';
    }).join('');
    if (info) info.textContent = rows.length ? ('Showing ' + ((secPage - 1) * pageSize + 1) + '–' + Math.min(secPage * pageSize, rows.length) + ' of ' + rows.length) : 'No stocks in this sector';
    if (prev) prev.disabled = secPage <= 1;
    if (next) next.disabled = secPage >= pages;
  }
  (function bindSector() {
    var sel = document.getElementById('wl-sec-select');
    if (sel) sel.addEventListener('change', function () { secFilter = sel.value; secPage = 1; renderSector(); });
    var prev = document.getElementById('wl-sec-prev');
    if (prev) prev.addEventListener('click', function () { if (secPage > 1) { secPage--; renderSector(); } });
    var next = document.getElementById('wl-sec-next');
    if (next) next.addEventListener('click', function () { secPage++; renderSector(); });
    var tbody = document.getElementById('wl-sec-tbody');
    if (tbody) tbody.addEventListener('click', function (e) {
      var b = e.target.closest('.wl-sec-add');
      if (!b) return;
      // Stop here: the document click handler closes the suggest box,
      // which would instantly hide the prefilled suggestions.
      e.stopPropagation();
      prefillAdd(b.getAttribute('data-sym'));
    });
  })();
  /* Prefill only — the symbol is never added without the user's confirm. */
  function prefillAdd(sym) {
    if (!addInput) return;
    addInput.value = sym || '';
    suggestIdx = -1;
    currentMatches = dataReady ? matches(addInput.value) : [];
    renderSuggest();
    addInput.focus();
    addInput.scrollIntoView({block: 'nearest'});
    showHint(sym + ' ready in the add box — press Enter or Add to confirm. It was not added automatically.');
  }

  /* -------- tracked sessions: line chart + outcomes -------- */
  function nepseSeries() {
    return (sessionsData && sessionsData.sessions) || [];
  }
  function nepseChangeOn(date) {
    var arr = nepseSeries();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i][0] === date) {
        if (i === 0) return null;
        var prev = arr[i - 1][1], cur = arr[i][1];
        return prev ? (cur / prev - 1) * 100 : null;
      }
    }
    return null;
  }
  function nepseCloseOn(date) {
    var arr = nepseSeries();
    for (var i = 0; i < arr.length; i++) if (arr[i][0] === date) return arr[i][1];
    return null;
  }
  function renderSessions() {
    var canvas = document.getElementById('wl-track-canvas');
    var cap = document.getElementById('wl-track-cap');
    var note = document.getElementById('wl-track-note');
    if (!canvas || !cap) return;
    var snaps = loadSnapshots();
    var active = store.lists[store.active];
    var pts = [];
    snaps.forEach(function (sn) {
      var list = null;
      for (var i = 0; i < sn.lists.length; i++) if (sn.lists[i].name === active.name) list = sn.lists[i];
      if (!list) return;
      var chs = list.syms.map(function (r) { return r.ch; }).filter(function (c) { return c != null && isFinite(c); });
      var mean = chs.length ? chs.reduce(function (a, b) { return a + b; }, 0) / chs.length : null;
      pts.push({asof: sn.asof, mean: mean, nep: nepseChangeOn(sn.asof)});
    });
    var ctx = canvas.getContext('2d');
    if (pts.length < 2) {
      if (note) { note.hidden = false; note.textContent = 'Collecting sessions — the line appears after two sessions are saved. Snapshots so far: ' + snaps.length + '.'; }
      cap.textContent = '';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (note) note.hidden = true;
    drawTrackChart(canvas, pts);
    var last = pts[pts.length - 1];
    cap.innerHTML = 'Latest session ' + esc(last.asof) + ': active list mean <strong>' +
      (last.mean != null ? (last.mean > 0 ? '+' : '') + last.mean.toFixed(2) + '%' : '—') + '</strong> · NEPSE <strong>' +
      (last.nep != null ? (last.nep > 0 ? '+' : '') + last.nep.toFixed(2) + '%' : '—') + '</strong> · ' + pts.length + ' sessions tracked.';
  }
  function drawTrackChart(canvas, pts) {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth || 800, ch = 220;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var vals = [];
    pts.forEach(function (p) { if (p.mean != null) vals.push(p.mean); if (p.nep != null) vals.push(p.nep); });
    if (!vals.length) return;
    var min = Math.min.apply(null, vals.concat([0]));
    var max = Math.max.apply(null, vals.concat([0]));
    if (max - min < 0.5) max = min + 0.5;
    var padL = 8, padR = 8, padT = 12, padB = 12;
    function X(i) { return padL + (pts.length === 1 ? 0.5 : i / (pts.length - 1)) * (cw - padL - padR); }
    function Y(v) { return padT + (1 - (v - min) / (max - min)) * (ch - padT - padB); }
    ctx.strokeStyle = 'rgba(154,163,178,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(cw - padR, Y(0)); ctx.stroke();
    function line(key, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      var started = false;
      pts.forEach(function (p, i) {
        if (p[key] == null) { started = false; return; }
        if (!started) { ctx.moveTo(X(i), Y(p[key])); started = true; }
        else ctx.lineTo(X(i), Y(p[key]));
      });
      ctx.stroke();
    }
    line('nep', '#9AA3B2', 2);
    line('mean', '#B8E62E', 3);
  }

  var outPage = 1;
  function computeOutcomes() {
    var snaps = loadSnapshots();
    var first = {};
    snaps.forEach(function (sn) {
      sn.lists.forEach(function (l) {
        l.syms.forEach(function (r) {
          if (!first[r.s] && r.p != null) first[r.s] = {asof: sn.asof, p: r.p};
        });
      });
    });
    var out = [];
    Object.keys(first).forEach(function (sym) {
      // No elapsed window yet: first seen in the current batch, so the
      // "latest price" is that same batch's price and the return would
      // be a trivial 0.00%. Such symbols are not outcomes — they join
      // the table once a later batch arrives.
      if (first[sym].asof === dataAsof) return;
      var vd = verdicts[sym] || {};
      var p1 = vd.p != null ? vd.p : (forwardData[sym] || {}).close;
      if (p1 == null) return;
      var ret = (p1 / first[sym].p - 1) * 100;
      var n0 = nepseCloseOn(first[sym].asof);
      // Same window on both sides: the NEPSE leg ends at the BATCH
      // asof (the verdicts prices' own session), never at the sessions
      // file's tail, which can run a session ahead of the batch.
      var n1 = nepseCloseOn(dataAsof);
      if (n1 == null && nepseSeries().length) n1 = nepseSeries()[nepseSeries().length - 1][1];
      var nepRet = (n0 && n1) ? (n1 / n0 - 1) * 100 : null;
      var spread = nepRet != null ? ret - nepRet : null;
      out.push({sym: sym, since: first[sym].asof, ret: ret, nep: nepRet, spread: spread});
    });
    out.sort(function (a, b) {
      var x = a.spread == null ? -1e9 : a.spread, y = b.spread == null ? -1e9 : b.spread;
      return y - x;
    });
    return out;
  }
  function renderOutcomes() {
    var tbody = document.getElementById('wl-out-tbody');
    var empty = document.getElementById('wl-out-empty');
    var info = document.getElementById('wl-out-pager-info');
    var prev = document.getElementById('wl-out-prev');
    var next = document.getElementById('wl-out-next');
    if (!tbody) return;
    var rows = computeOutcomes();
    var pageSize = 25;
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (outPage > pages) outPage = pages;
    var page = rows.slice((outPage - 1) * pageSize, outPage * pageSize);
    if (!rows.length) {
      if (empty) { empty.hidden = false; empty.textContent = 'No tracked outcomes yet — outcomes appear once a symbol has been seen in an earlier session and has a latest price.'; }
      tbody.innerHTML = '';
    } else {
      if (empty) empty.hidden = true;
      tbody.innerHTML = page.map(function (r) {
        var cls = r.spread == null ? 'flat' : r.spread > 0 ? 'beat' : r.spread < 0 ? 'trail' : 'flat';
        var lbl = r.spread == null ? '—' : r.spread > 0 ? 'Beat' : r.spread < 0 ? 'Trailed' : 'Flat';
        return '<tr><td><a href="' + esc(stockUrl(r.sym)) + '">' + esc(r.sym) + '</a></td>' +
          '<td>' + esc(r.since) + '</td>' +
          '<td class="num">' + (r.ret > 0 ? '+' : '') + r.ret.toFixed(2) + '%</td>' +
          '<td class="num">' + (r.nep != null ? (r.nep > 0 ? '+' : '') + r.nep.toFixed(2) + '%' : '—') + '</td>' +
          '<td class="num">' + (r.spread != null ? (r.spread > 0 ? '+' : '') + r.spread.toFixed(2) + 'pp' : '—') + '</td>' +
          '<td><span class="wl-chip ' + cls + '">' + lbl + '</span></td></tr>';
      }).join('');
    }
    if (info) info.textContent = rows.length ? ('Showing ' + ((outPage - 1) * pageSize + 1) + '–' + Math.min(outPage * pageSize, rows.length) + ' of ' + rows.length) : '';
    if (prev) prev.disabled = outPage <= 1;
    if (next) next.disabled = outPage >= pages;
  }
  (function bindOutcomes() {
    var prev = document.getElementById('wl-out-prev');
    if (prev) prev.addEventListener('click', function () { if (outPage > 1) { outPage--; renderOutcomes(); } });
    var next = document.getElementById('wl-out-next');
    if (next) next.addEventListener('click', function () { outPage++; renderOutcomes(); });
  })();

  loadData();

  /* ---- Auto-refresh: market-aware cadence, visible freshness line ---- */
  /* Tick change-gate (fading fix): the old code set changed=true on ANY
     successful universe fetch, so every tick rebuilt all rows even when
     the batch was identical. The signature below covers the full batch
     content, so an unchanged tick moves only the freshness line. */
  var lastWlSig = null;
  function wlSig(u, v){
    var a = (u && Array.isArray(u.symbols)) ? u.symbols.map(function(s){ return s.s; }).join(',') : '';
    var b = (v && v.verdicts) ? (v.asof || '') + '|' + JSON.stringify(v.verdicts) : '';
    return a + '||' + b;
  }
  var refreshTimer = null;
  var lastHidden = 0;
  function refreshMs() {
    var ms = 'CLOSED';
    try {
      if (window.NepseMarketConfig && window.NepseMarketConfig.marketState) ms = window.NepseMarketConfig.marketState();
    } catch (e) {}
    if (ms === 'OPEN' || ms === 'PRE-OPEN') return 15 * 60 * 1000;
    var day = new Date().getDay();
    if (day === 0 || day === 6) return 120 * 60 * 1000;
    return 30 * 60 * 1000;
  }
  function setFreshLine(state, msg) {
    if (!freshLine) return;
    freshLine.setAttribute('data-state', state);
    freshLine.textContent = msg;
  }
  function fmtClock(d) {
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { autoRefresh(); }, refreshMs());
  }
  function autoRefresh() {
    if (document.hidden) { scheduleRefresh(); return; } // hidden-tab skip
    Promise.all([
      fetch('/nepse-chart/data/universe.json', {cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/nepse-chart/data/verdicts.json', {cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/data/watchlist-sessions.json', {cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/data/watchlist-forward.json', {cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var u = res[0], v = res[1];
      /* Full-success ticks compare the whole batch signature. A partial
         tick (one feed missing) still renders when the verdicts asof
         advanced, exactly as before. */
      var prevAsof = dataAsof;
      if (u && Array.isArray(u.symbols)) universe = u.symbols;
      if (v && v.verdicts) { verdicts = v.verdicts; dataAsof = v.asof || ''; }
      if (res[2] && Array.isArray(res[2].sessions)) sessionsData = res[2];
      if (res[3] && res[3].symbols) forwardData = res[3].symbols;
      var full = !!(u && Array.isArray(u.symbols) && v && v.verdicts);
      var changed;
      if (full) {
        var sig = wlSig(u, v);
        changed = sig !== lastWlSig;
        lastWlSig = sig;
      } else {
        changed = !!(v && v.verdicts && v.asof !== prevAsof);
      }
      if (changed && dataReady) {
        if (dataAsof && updatedEl) {
          updatedEl.innerHTML = 'Prices and signals as of ' + esc(dataAsof) + '. ' +
            (window.NepseFresh ? NepseFresh.badge(dataAsof) : '');
        }
        renderTabs();
        renderList();
        renderEngine();
        renderSector();
        maybeSnapshot();
        renderSessions();
        renderOutcomes();
        setFreshLine('fresh', 'Batch ' + dataAsof + ' · refreshed ' + fmtClock(new Date()) + ' NPT');
      } else {
        setFreshLine('fresh', 'Checked ' + fmtClock(new Date()) + ' NPT · batch ' + (dataAsof || '—') + ' unchanged');
      }
      scheduleRefresh();
    }).catch(function () {
      // Never silent stale data: say the refresh failed and keep old rows.
      setFreshLine('failed', 'Refresh failed ' + fmtClock(new Date()) + ' NPT — showing batch ' + (dataAsof || '—') + '. Will retry.');
      scheduleRefresh();
    });
  }
  scheduleRefresh();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { lastHidden = Date.now(); return; }
    // refetch if the tab was hidden for more than 2 minutes
    if (Date.now() - lastHidden > 2 * 60 * 1000) autoRefresh();
  });
})();
