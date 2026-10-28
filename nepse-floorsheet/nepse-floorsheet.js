/* nepse-floorsheet.js — family script for /nepse-floorsheet/ (.fs- prefix).
   Renders the published closed-session trade tape: session picker, 100-row
   pages from 1000-row chunk files, symbol/broker filters (which load the
   session's chunks once, then filter in memory). Pages render published
   files only — no live source calls. URL state: ?d=DATE&p=N&s=SYM&b=CODE,
   all values validated and escaped before injection. */
(function () {
  'use strict';
  var DATA = 'data/';
  var BROKERS_URL = '/nepse-brokers/data/brokers.json';
  var UNI_URL = '/nepse-chart/data/universe.json';
  var CHUNK_ROWS = 1000, PAGE_ROWS = 100;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var S = {
    win: null, sessions: [], brokers: {}, uniList: [],
    date: null, manifest: null, chunks: {},
    view: 'all', filterSym: '', filterBroker: '',
    filteredRows: null, page: 1, totalPages: 1, loading: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function fmtDate(d) {
    var p = String(d).split('-');
    if (p.length !== 3) return esc(d);
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function fmtMoney(x) {
    var n = Number(x);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtInt(x) {
    var n = Number(x);
    if (!isFinite(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtRs(x) {
    // Money in prose: Nepali grouping pattern (arab / crore / lakh).
    var n = Number(x);
    if (!isFinite(n)) return '—';
    if (n >= 1e7) return 'Rs ' + (n / 1e7).toFixed(2) + ' arab';
    if (n >= 1e5) return 'Rs ' + (n / 1e5).toFixed(2) + ' Cr';
    if (n >= 1e3) return 'Rs ' + (n / 1e3).toFixed(2) + ' L';
    return 'Rs ' + fmtMoney(n);
  }
  function brokerLabel(code) {
    var name = S.brokers[code];
    return name ? esc(code) + ' · ' + esc(name) : esc(code);
  }
  function brokerName(code) {
    return S.brokers[code] || '';
  }

  /* ---- URL state ---- */
  function readUrl() {
    var q = {};
    try {
      var sp = new URLSearchParams(window.location.search);
      ['d', 'p', 's', 'b'].forEach(function (k) { q[k] = sp.get(k); });
    } catch (e) { /* no URLSearchParams: defaults */ }
    return q;
  }
  function writeUrl() {
    try {
      var sp = new URLSearchParams();
      if (S.date) sp.set('d', S.date);
      if (S.page > 1) sp.set('p', String(S.page));
      if (S.filterSym) sp.set('s', S.filterSym);
      if (S.filterBroker) sp.set('b', S.filterBroker);
      var qs = sp.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    } catch (e) { /* URL update is cosmetic */ }
  }

  /* ---- rendering ---- */
  function setErr(msg) {
    var el = $('fsErr');
    if (el) el.textContent = msg || '';
  }
  function setFreshline() {
    var el = $('fsFreshline');
    if (!el || !S.manifest) return;
    var m = S.manifest;
    var scope = S.view === 'filtered'
      ? ('Filtered to ' + (S.filterSym ? 'symbol ' + esc(S.filterSym) : '') +
        (S.filterSym && S.filterBroker ? ' + ' : '') +
        (S.filterBroker ? 'broker ' + esc(S.filterBroker) + (brokerName(S.filterBroker) ? ' (' + esc(brokerName(S.filterBroker)) + ')' : '') : '') +
        ' — ' + fmtInt(S.filteredRows.length) + ' trades')
      : (fmtInt(m.trades) + ' trades');
    el.innerHTML = 'Showing the ' + fmtDate(S.date) + ' tape — ' + scope +
      ' · turnover ' + fmtRs(m.turnover) +
      ' · page ' + S.page + ' of ' + S.totalPages +
      ' · rows ' + fmtInt((S.page - 1) * PAGE_ROWS + 1) + '–' +
      fmtInt(Math.min(S.page * PAGE_ROWS, totalRows())) +
      ' · full tape retained for the last ' + (S.win && S.win.window ? S.win.window : 5) + ' trading sessions.';
  }
  function totalRows() {
    return S.view === 'filtered' ? S.filteredRows.length : (S.manifest ? S.manifest.trades : 0);
  }
  function renderStats() {
    var m = S.manifest;
    if (!m) return;
    var top = m.top_symbol;
    $('fsStatTrades').textContent = fmtInt(m.trades);
    $('fsStatTurnover').textContent = fmtRs(m.turnover);
    $('fsStatSymbols').textContent = fmtInt(m.symbols);
    $('fsStatTop').textContent = top ? top.symbol : '—';
    $('fsStatTopSub').textContent = top
      ? fmtRs(top.turnover) + ' · ' + fmtInt(top.trades) + ' trades' : '';
  }
  function rowHTML(r, idx) {
    // r = [symbol, buyer, seller, qty, rate, amount, tx]
    return '<tr><td class="idx">' + fmtInt(idx) + '</td>' +
      '<td class="sym"><a href="/stocks/' + esc(r[0]) + '/">' + esc(r[0]) + '</a></td>' +
      '<td class="brk">' + brokerLabel(r[1]) + '</td>' +
      '<td class="brk">' + brokerLabel(r[2]) + '</td>' +
      '<td class="num">' + fmtInt(r[3]) + '</td>' +
      '<td class="num">' + fmtMoney(r[4]) + '</td>' +
      '<td class="num">' + fmtMoney(r[5]) + '</td>' +
      '<td class="tx">' + esc(r[6]) + '</td></tr>';
  }
  function renderTable(rows, baseIdx) {
    var body = $('fsTableBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="fs-cap">No trades match this filter on the ' +
        fmtDate(S.date) + ' tape.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) html += rowHTML(rows[i], baseIdx + i);
    body.innerHTML = html;
  }
  function renderPager() {
    var pg = $('fsPagerInfo');
    if (pg) pg.textContent = 'Page ' + S.page + ' of ' + S.totalPages;
    var pg2 = $('fsPagerInfo2');
    if (pg2) pg2.textContent = 'Page ' + S.page + ' of ' + S.totalPages;
    var prev = $('fsPrev'), next = $('fsNext'), inp = $('fsPageIn');
    if (prev) prev.disabled = S.page <= 1 || S.loading;
    if (next) next.disabled = S.page >= S.totalPages || S.loading;
    var prev2 = $('fsPrev2'), next2 = $('fsNext2');
    if (prev2) prev2.disabled = S.page <= 1 || S.loading;
    if (next2) next2.disabled = S.page >= S.totalPages || S.loading;
    if (inp) inp.value = S.page;
  }
  function renderAll() {
    renderStats();
    setFreshline();
    renderPager();
  }

  /* ---- data loading ---- */
  function chunkFile(n) {
    return DATA + S.date + '/c' + ('00' + n).slice(-3) + '.json';
  }
  function loadChunk(n) {
    if (S.chunks[n]) return Promise.resolve(S.chunks[n]);
    return fetchJSON(chunkFile(n)).then(function (c) {
      S.chunks[n] = c.rows || [];
      return S.chunks[n];
    });
  }
  function showPage(p) {
    if (!S.manifest) return;
    if (S.view === 'filtered') {
      S.totalPages = Math.max(1, Math.ceil(S.filteredRows.length / PAGE_ROWS));
      S.page = Math.max(1, Math.min(p, S.totalPages));
      var start = (S.page - 1) * PAGE_ROWS;
      renderTable(S.filteredRows.slice(start, start + PAGE_ROWS), start + 1);
      renderAll();
      writeUrl();
      return;
    }
    S.totalPages = S.manifest.pages;
    S.page = Math.max(1, Math.min(p, S.totalPages));
    var chunkIdx = Math.floor((S.page - 1) * PAGE_ROWS / CHUNK_ROWS) + 1;
    var off = (S.page - 1) * PAGE_ROWS - (chunkIdx - 1) * CHUNK_ROWS;
    S.loading = true;
    renderPager();
    loadChunk(chunkIdx).then(function (rows) {
      S.loading = false;
      renderTable(rows.slice(off, off + PAGE_ROWS), (S.page - 1) * PAGE_ROWS + 1);
      renderAll();
      writeUrl();
    }).catch(function () {
      S.loading = false;
      renderPager();
      setErr('Could not load this page of the tape. Please retry.');
    });
  }
  function loadAllChunks(progress) {
    var n = S.manifest.chunks, done = 0, all = [];
    var seq = Promise.resolve();
    for (var i = 1; i <= n; i++) {
      (function (ci) {
        seq = seq.then(function () {
          return loadChunk(ci).then(function (rows) {
            all = all.concat(rows);
            done++;
            if (progress) progress(done, n);
          });
        });
      })(i);
    }
    return seq.then(function () { return all; });
  }
  function applyFilters() {
    if (!S.manifest) return;
    var sym = ($('fsSym').value || '').trim().toUpperCase();
    var brkRaw = ($('fsBroker').value || '').trim();
    var brk = brkRaw.split(' ')[0].split('—')[0].trim();
    setErr('');
    if (sym && S.uniList.indexOf(sym) === -1) {
      setErr('Unknown symbol “' + sym + '” — not a listed security. Filter ignored for symbol.');
      sym = '';
    }
    if (brk && !/^\d+$/.test(brk)) {
      setErr('Broker filter must be a broker code (e.g. 58). Filter ignored for broker.');
      brk = '';
    } else if (brk && !S.brokers[brk]) {
      setErr('Unknown broker code “' + brk + '”. Filter ignored for broker.');
      brk = '';
    }
    S.filterSym = sym;
    S.filterBroker = brk;
    if (!sym && !brk) {
      S.view = 'all';
      S.filteredRows = null;
      showPage(1);
      return;
    }
    S.view = 'filtered';
    S.loading = true;
    renderPager();
    var note = $('fsLoadNote');
    loadAllChunks(function (d, n) {
      if (note) note.textContent = 'Loading session tape… ' + d + ' of ' + n + ' chunks.';
    }).then(function (all) {
      S.loading = false;
      if (note) note.textContent = '';
      S.filteredRows = all.filter(function (r) {
        if (sym && r[0] !== sym) return false;
        if (brk && r[1] !== brk && r[2] !== brk) return false;
        return true;
      });
      showPage(1);
    }).catch(function () {
      S.loading = false;
      if (note) note.textContent = '';
      setErr('Could not load the session tape for filtering. Please retry.');
      renderPager();
    });
  }
  function clearFilters() {
    $('fsSym').value = '';
    $('fsBroker').value = '';
    S.filterSym = '';
    S.filterBroker = '';
    S.view = 'all';
    S.filteredRows = null;
    setErr('');
    showPage(1);
  }
  function loadSession(date, page, sym, brk) {
    S.date = date;
    S.chunks = {};
    S.view = 'all';
    S.filteredRows = null;
    S.filterSym = '';
    S.filterBroker = '';
    $('fsSym').value = '';
    $('fsBroker').value = '';
    setErr('');
    fetchJSON(DATA + date + '/manifest.json').then(function (m) {
      S.manifest = m;
      var sel = $('fsSession');
      if (sel) sel.value = date;
      renderStats();
      if (sym || brk) {
        $('fsSym').value = sym || '';
        if (brk) $('fsBroker').value = brk + (S.brokers[brk] ? ' — ' + S.brokers[brk] : '');
        applyFilters();
        // applyFilters resets to page 1; honour a deep-linked page after load.
        if (page > 1) {
          var t = setInterval(function () {
            if (!S.loading) {
              clearInterval(t);
              if (S.filteredRows) showPage(page);
            }
          }, 100);
        }
      } else {
        showPage(page || 1);
      }
    }).catch(function () {
      setErr('Could not load the ' + fmtDate(date) + ' tape. Please retry.');
    });
  }

  /* ---- boot ---- */
  function boot() {
    Promise.all([
      fetchJSON(DATA + 'window.json').catch(function () { return null; }),
      fetchJSON(BROKERS_URL).catch(function () { return null; }),
      fetchJSON(UNI_URL).catch(function () { return null; })
    ]).then(function (res) {
      var win = res[0], brokers = res[1], uni = res[2];
      if (!win || !Array.isArray(win.sessions) || !win.sessions.length) {
        $('fsTableBody').innerHTML = '<tr><td colspan="8" class="fs-cap">Could not load floorsheet data. Please retry.</td></tr>';
        return;
      }
      S.win = win;
      S.sessions = win.sessions;
      if (brokers) {
        Object.keys(brokers).forEach(function (k) {
          if (/^\d+$/.test(k)) S.brokers[k] = brokers[k];
        });
      }
      if (uni && Array.isArray(uni.symbols)) {
        S.uniList = uni.symbols.map(function (u) { return u.s; }).filter(Boolean).sort();
      }
      var sel = $('fsSession');
      S.sessions.forEach(function (d) {
        var o = document.createElement('option');
        o.value = d;
        o.textContent = fmtDate(d);
        sel.appendChild(o);
      });
      var dl = $('fsSyms');
      S.uniList.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s;
        dl.appendChild(o);
      });
      var bd = $('fsBrokers');
      Object.keys(S.brokers).sort(function (a, b) { return +a - +b; }).forEach(function (c) {
        var o = document.createElement('option');
        o.value = c + ' — ' + S.brokers[c];
        bd.appendChild(o);
      });
      var q = readUrl();
      var date = q.d;
      if (!date || S.sessions.indexOf(date) === -1) {
        if (date) setErr('Session ' + esc(date) + ' is not in the retained window (last ' +
          (win.window || 5) + ' trading sessions). Showing the latest tape instead.');
        date = S.sessions[0];
      }
      var page = parseInt(q.p, 10);
      if (!isFinite(page) || page < 1) page = 1;
      var sym = (q.s || '').toUpperCase();
      var brk = (q.b || '').replace(/[^0-9]/g, '');
      sel.addEventListener('change', function () {
        loadSession(sel.value, 1, '', '');
      });
      $('fsApply').addEventListener('click', applyFilters);
      $('fsClear').addEventListener('click', clearFilters);
      $('fsPrev').addEventListener('click', function () { showPage(S.page - 1); });
      $('fsNext').addEventListener('click', function () { showPage(S.page + 1); });
      $('fsPrev2').addEventListener('click', function () { showPage(S.page - 1); });
      $('fsNext2').addEventListener('click', function () { showPage(S.page + 1); });
      $('fsPageGo').addEventListener('click', function () {
        var p = parseInt($('fsPageIn').value, 10);
        if (isFinite(p)) showPage(p);
      });
      $('fsPageIn').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var p = parseInt(e.target.value, 10);
          if (isFinite(p)) showPage(p);
        }
      });
      loadSession(date, page, sym, brk);
      // 60s tick: only the window manifest re-checks. A new session adds
      // itself to the picker with a note — the current view is never yanked.
      setInterval(function () {
        fetchJSON(DATA + 'window.json').catch(function () { return null; }).then(function (w) {
          if (!w || !Array.isArray(w.sessions)) return;
          var before = S.sessions.join(',');
          if (w.sessions.join(',') !== before) {
            S.win = w;
            S.sessions = w.sessions;
            sel.innerHTML = '';
            S.sessions.forEach(function (d) {
              var o = document.createElement('option');
              o.value = d;
              o.textContent = fmtDate(d);
              sel.appendChild(o);
            });
            sel.value = S.date;
            var newest = S.sessions[0];
            if (newest !== S.date) {
              setErr('New session available: ' + fmtDate(newest) + ' — select it above to view its tape.');
            }
          }
        });
      }, 60000);
    }).catch(function () {
      $('fsTableBody').innerHTML = '<tr><td colspan="8" class="fs-cap">Could not load floorsheet data. Please retry.</td></tr>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
