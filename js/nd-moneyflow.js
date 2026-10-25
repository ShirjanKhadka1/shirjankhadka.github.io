/* Money Flow page — full rebuild (2026-10-26, page 5 of the sweep).
   Data: /nepse-money-flow/data/money-flow.json (the 1-day payload,
   built by tools/build-money-flow.py) + the broker pipeline's published
   period aggregates for longer windows + brokers.json for names.
   Refreshes itself on a market-aware cadence and ALWAYS re-fetches
   (the old page cached the 1D promise, so its "auto-refresh" re-rendered
   the same stale data forever — that defect is gone). */
(function () {
  'use strict';
  var BASE = '/nepse-brokers/data/';
  var PAYLOAD = '/nepse-money-flow/data/money-flow.json';
  var PER_PAGE = 25;
  var WINDOWS = ['1D', '1W', '2W', '1M', '3M', '6M', '1Y'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtRs(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    var n = Number(v), a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e7) return sign + 'Rs ' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return sign + 'Rs ' + (a / 1e5).toFixed(2) + ' L';
    return sign + 'Rs ' + a.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function fmtNum(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function fmtPp(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + 'pp';
  }
  function fmtPct(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }
  function fetchJSON(url, fresh) {
    var opt = fresh ? { cache: 'no-store' } : {};
    return fetch(url, opt).then(function (r) {
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
  }
  function brokerName(code) {
    return brokerNames[String(code)] || ('Broker ' + code);
  }

  var brokerNames = {};
  var payload = null;      // money-flow.json (1D + tracking + sectors)
  var windowData = null;   // current view: {brokers, accum, dist, from, to, trading_days}
  var state = { window: '1D', sector: '', sort: 'net-desc', page: 0, trackH: 10, q: '' };

  function readURL() {
    try {
      var p = new URLSearchParams(location.search);
      if (WINDOWS.indexOf(p.get('w')) >= 0) state.window = p.get('w');
      if (p.get('sec')) state.sector = p.get('sec');
      if (['net-desc', 'net-asc', 'buy-desc', 'sell-desc'].indexOf(p.get('sort')) >= 0) state.sort = p.get('sort');
      var pg = parseInt(p.get('pg'), 10);
      if (!isNaN(pg) && pg >= 0) state.page = pg;
      if (['5', '10', '20'].indexOf(p.get('h')) >= 0) state.trackH = parseInt(p.get('h'), 10);
    } catch (e) {}
  }
  function writeURL() {
    try {
      var p = new URLSearchParams();
      if (state.window !== '1D') p.set('w', state.window);
      if (state.sector) p.set('sec', state.sector);
      if (state.sort !== 'net-desc') p.set('sort', state.sort);
      if (state.page > 0) p.set('pg', state.page);
      if (state.trackH !== 10) p.set('h', state.trackH);
      var qs = p.toString();
      history.replaceState(null, '', qs ? location.pathname + '?' + qs : location.pathname);
    } catch (e) {}
  }

  function normBrokers(rows) {
    return (rows || []).map(function (b) {
      var buy = Number(b.buy_value != null ? b.buy_value : b.b || 0);
      var sell = Number(b.sell_value != null ? b.sell_value : b.s || 0);
      var net = b.net != null ? Number(b.net) : (b.n != null ? Number(b.n) : buy - sell);
      return { code: String(b.code != null ? b.code : b.c),
               buy: buy, sell: sell, net: net,
               qty: Number(b.total_qty != null ? b.total_qty : b.q || 0) };
    });
  }
  function normPairs(rows) {
    return (rows || []).map(function (x) {
      return { symbol: x.symbol || x.s, broker: String(x.broker != null ? x.broker : x.b),
               net: Number(x.net_value != null ? x.net_value : x.nv || 0) };
    }).filter(function (x) { return x.symbol; });
  }
  function sectorOf(sym) {
    return (payload && payload.sectors && payload.sectors[sym]) || 'Unclassified';
  }
  function sectorFlowFromPairs(accum, dist) {
    var agg = {};
    accum.concat(dist).forEach(function (x) {
      var sec = sectorOf(x.symbol);
      var a = agg[sec] || (agg[sec] = { net: 0, pairs: 0 });
      a.net += x.net; a.pairs += 1;
    });
    return Object.keys(agg).map(function (s) {
      return { sector: s, net: agg[s].net, pairs: agg[s].pairs };
    }).sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); });
  }

  function currentView() { return windowData; }

  function renderSession() {
    var sess = $('mfSession');
    if (!sess || !payload) return;
    var v = currentView();
    var range = v ? (v.from + (v.to !== v.from ? ' → ' + v.to : '')) : payload.asof;
    var days = v ? v.trading_days : 1;
    sess.textContent = 'Session of ' + range + ' · ' + days + ' trading day(s) · Source: NEPSE floorsheet records';
  }

  function renderTiles() {
    var host = $('mfTiles');
    if (!host || !payload) return;
    var v = currentView();
    if (!v) return;
    var brokers = v.brokers;
    var totBuy = 0, totSell = 0;
    brokers.forEach(function (b) { totBuy += b.buy; totSell += b.sell; });
    var byNet = brokers.slice().sort(function (a, b) { return b.net - a.net; });
    var topBuyer = byNet[0], topSeller = byNet[byNet.length - 1];
    var topPair = (v.accum && v.accum[0]) || null;
    function tile(k, val, sub) {
      return '<div class="mf-tile"><div class="k">' + k + '</div><div class="v">' + val + '</div><div class="s">' + sub + '</div></div>';
    }
    host.innerHTML =
      tile('Total bought', fmtRs(totBuy), 'across all brokers') +
      tile('Total sold', fmtRs(totSell), 'across all brokers') +
      tile('Top net buyer', topBuyer ? esc(brokerName(topBuyer.code)) : '—', topBuyer ? '+' + fmtRs(topBuyer.net) : '') +
      tile('Top net seller', topSeller ? esc(brokerName(topSeller.code)) : '—', topSeller ? fmtRs(topSeller.net) : '') +
      tile('Brokers active', fmtNum(brokers.length), 'with trades in the window') +
      tile('Largest single pair', topPair ? esc(topPair.symbol) + ' · ' + esc(brokerName(topPair.broker)) : '—', topPair ? '+' + fmtRs(topPair.net) : '');
  }

  function renderAuto() {
    var host = $('mfAuto');
    if (!host || !payload) return;
    var t = payload.tracking || {};
    var built = payload.built_at ? payload.built_at.replace('T', ' ').slice(0, 16) : '—';
    var next = 'next trading day after close (~17:40 NPT, once broker data finalizes)';
    function fact(k, val) {
      return '<div class="mf-fact"><div class="k">' + k + '</div><div class="v">' + val + '</div></div>';
    }
    host.innerHTML =
      fact('Latest final session', esc(payload.asof)) +
      fact('Data built', esc(built) + ' NPT') +
      fact('Next update', next) +
      fact('Sessions archived', fmtNum(t.sessions_tracked || 0) + ' · ' + fmtNum(t.resolved_outcomes || 0) + ' tracked outcomes');
  }

  function renderWindowNote() {
    var note = $('mfWindowNote');
    if (!note) return;
    var v = currentView();
    if (!v) return;
    note.textContent = state.window === '1D'
      ? 'Single final session · ' + v.brokers.length + ' brokers'
      : v.from + ' → ' + v.to + ' · ' + v.trading_days + ' trading days · ' + v.brokers.length + ' brokers';
  }

  function renderSectors() {
    var host = $('mfSectors');
    if (!host || !payload) return;
    var rows = state.window === '1D' ? (payload.sector_flow || [])
      : sectorFlowFromPairs(currentView().accum, currentView().dist);
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, Math.abs(r.net)); });
    var cards = rows.map(function (r) {
      var on = state.sector === r.sector ? ' on' : '';
      var cls = r.net >= 0 ? 'pos' : 'neg';
      var pct = max ? Math.round(Math.abs(r.net) / max * 100) : 0;
      return '<button class="mf-sector' + on + '" data-sector="' + esc(r.sector) + '">' +
        '<span class="mf-sector-name">' + esc(r.sector) + '</span>' +
        '<span class="mf-sector-net ' + cls + '">' + (r.net >= 0 ? '+' : '') + fmtRs(r.net) + '</span>' +
        '<span class="mf-sector-bar"><span style="width:' + pct + '%"></span></span>' +
        '<span class="mf-sector-meta">' + r.pairs + ' pairs</span></button>';
    }).join('');
    var allOn = !state.sector ? ' on' : '';
    host.innerHTML = '<button class="mf-sector' + allOn + '" data-sector="">All sectors</button>' + cards;
    host.querySelectorAll('.mf-sector').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sector = btn.getAttribute('data-sector') || '';
        state.page = 0;
        writeURL();
        renderSectors();
        renderFlowLists();
      });
    });
  }

  function sortBrokers(list) {
    var arr = list.slice();
    switch (state.sort) {
      case 'net-desc': arr.sort(function (a, b) { return b.net - a.net; }); break;
      case 'net-asc': arr.sort(function (a, b) { return a.net - b.net; }); break;
      case 'buy-desc': arr.sort(function (a, b) { return b.buy - a.buy; }); break;
      case 'sell-desc': arr.sort(function (a, b) { return b.sell - a.sell; }); break;
    }
    return arr;
  }

  function renderTable() {
    var body = $('mfBody');
    if (!body || !currentView()) return;
    var q = state.q.trim().toLowerCase();
    var all = sortBrokers(currentView().brokers).filter(function (b) {
      if (!q) return true;
      return brokerName(b.code).toLowerCase().indexOf(q) >= 0 ||
        String(b.code).toLowerCase().indexOf(q) >= 0;
    });
    var totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    if (state.page >= totalPages) state.page = totalPages - 1;
    if (state.page < 0) state.page = 0;
    var start = state.page * PER_PAGE;
    var rows = all.slice(start, start + PER_PAGE);
    body.innerHTML = rows.length ? rows.map(function (b) {
      var cls = b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : '';
      return '<tr>' +
        '<td class="l sticky"><span class="bname">' + esc(brokerName(b.code)) + '</span><span class="bcode">Broker ' + esc(b.code) + '</span></td>' +
        '<td class="r">' + fmtRs(b.buy) + '</td>' +
        '<td class="r">' + fmtRs(b.sell) + '</td>' +
        '<td class="r ' + cls + '">' + (b.net > 0 ? '+' : '') + fmtRs(b.net) + '</td>' +
        '<td class="r">' + fmtNum(b.qty) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="mf-loading">No brokers match the search.</td></tr>';
    var note = $('mfTableNote');
    if (note) {
      var v = currentView();
      note.textContent = v.from + ' → ' + v.to + ' · ' + v.brokers.length + ' brokers';
    }
    var showing = $('mfShowing');
    if (showing) {
      showing.textContent = all.length
        ? 'Showing ' + (start + 1) + '–' + Math.min(start + PER_PAGE, all.length) + ' of ' + all.length + ' brokers'
        : 'Showing 0 brokers';
    }
    var pager = $('mfPager');
    if (pager) {
      pager.innerHTML = '<button class="mfPrevBtn"' + (state.page === 0 ? ' disabled' : '') + '>← Prev</button>' +
        '<span>Page ' + (state.page + 1) + ' of ' + totalPages + '</span>' +
        '<button class="mfNextBtn"' + (state.page >= totalPages - 1 ? ' disabled' : '') + '>Next →</button>';
      pager.querySelector('.mfPrevBtn').addEventListener('click', function () {
        if (state.page > 0) { state.page--; writeURL(); renderTable(); }
      });
      pager.querySelector('.mfNextBtn').addEventListener('click', function () {
        if (state.page < totalPages - 1) { state.page++; writeURL(); renderTable(); }
      });
    }
  }

  function renderFlowLists() {
    var v = currentView();
    if (!v) return;
    function list(hostId, noteId, pairs, positive) {
      var host = $(hostId), note = $(noteId);
      if (!host) return;
      var filtered = state.sector
        ? pairs.filter(function (x) { return sectorOf(x.symbol) === state.sector; })
        : pairs;
      var shown = filtered.slice(0, 20);
      var max = 0;
      shown.forEach(function (x) { max = Math.max(max, Math.abs(x.net)); });
      if (note) {
        note.textContent = state.sector
          ? shown.length + ' of ' + pairs.length + ' in ' + state.sector
          : 'Top ' + shown.length + ' of ' + pairs.length;
      }
      host.innerHTML = shown.length ? shown.map(function (x) {
        var pct = max ? Math.round(Math.abs(x.net) / max * 100) : 0;
        var cls = positive ? 'pos' : 'neg';
        return '<div class="mf-flowitem"><div class="mf-flowmain"><span class="sym"><a href="/stocks/' + esc(x.symbol) + '/">' + esc(x.symbol) + '</a></span>' +
          '<span class="dt">via ' + esc(brokerName(x.broker)) + ' · ' + esc(sectorOf(x.symbol)) + '</span>' +
          '<span class="mf-flowbar"><span class="' + cls + '" style="width:' + pct + '%"></span></span></div>' +
          '<span class="amt ' + cls + '">' + (x.net > 0 ? '+' : '') + fmtRs(x.net) + '</span></div>';
      }).join('') : '<p class="mf-loading">No stocks in this sector for the window.</p>';
    }
    list('mfAccum', 'mfAccumNote', v.accum, true);
    list('mfDist', 'mfDistNote', v.dist, false);
  }

  function renderTrack() {
    var host = $('mfTrack');
    var verdict = $('mfTrackVerdict');
    if (!host || !payload || !payload.tracking) return;
    var agg = payload.tracking.aggregate || {};
    var h = 'h' + state.trackH;
    function card(group, label) {
      var d = (agg[group] || {})[h];
      if (!d) return '<div class="mf-trackcard"><h3>' + label + '</h3><p class="mf-loading">No resolved sessions yet.</p></div>';
      var cls = d.mean >= 0 ? 'pos' : 'neg';
      return '<div class="mf-trackcard"><h3>' + label + '</h3>' +
        '<div class="mf-tracknum ' + cls + '">' + fmtPp(d.mean) + '</div>' +
        '<div class="mf-tracksub">average excess vs the market · ' + fmtPct(d.beat) + ' of sessions beat · ' + d.sessions + ' sessions</div>' +
        '<div class="mf-beatbar"><span style="width:' + Math.round(d.beat * 100) + '%"></span></div></div>';
    }
    host.innerHTML = card('ACCUM', 'Accumulated stocks') + card('DIST', 'Distributed stocks');
    var pers = payload.top_buyer_persistence;
    var persTxt = pers
      ? ' Top buyers churn: across ' + pers.sessions + ' sessions, on average only ' + Math.round(pers.mean_overlap * 10) + ' of the top 10 net buyers repeat the next session.'
      : '';
    var latest = payload.tracking.latest;
    var pendTxt = latest && latest.pending && latest.pending.length
      ? ' Session ' + latest.session + ' is still pending for ' + latest.pending.join(' / ') + '-session outcomes — they resolve only after those sessions trade.'
      : '';
    if (verdict) {
      verdict.innerHTML = '<strong>Honest verdict:</strong> following the day\'s biggest broker accumulation did <strong>not</strong> beat the average stock — accumulated stocks averaged ' +
        fmtPp((agg.ACCUM || {})[h] ? agg.ACCUM[h].mean : null) + ' over ' + state.trackH + ' sessions, distributed stocks ' +
        fmtPp((agg.DIST || {})[h] ? agg.DIST[h].mean : null) + '. Both sit within noise of zero.' + persTxt + pendTxt;
    }
  }

  function renderAll() {
    renderSession();
    renderTiles();
    renderAuto();
    renderWindowNote();
    renderSectors();
    renderTable();
    renderFlowLists();
    renderTrack();
  }

  function loadWindow(fresh) {
    if (state.window === '1D') {
      windowData = {
        brokers: normBrokers(payload.brokers),
        accum: normPairs(payload.accum),
        dist: normPairs(payload.dist),
        from: payload.asof, to: payload.asof, trading_days: 1
      };
      return Promise.resolve();
    }
    return fetchJSON(BASE + 'periods/' + state.window + '.json', fresh).then(function (fd) {
      windowData = {
        brokers: normBrokers(fd.brokers),
        accum: normPairs(fd.accumulation),
        dist: normPairs(fd.distribution),
        from: fd.from, to: fd.to, trading_days: fd.trading_days
      };
    });
  }

  function load(fresh) {
    return fetchJSON(PAYLOAD, fresh).then(function (p) {
      payload = p;
      return fetchJSON(BASE + 'brokers.json', fresh).then(function (bn) {
        brokerNames = bn || {};
      }).catch(function () {}).then(function () {
        return loadWindow(fresh);
      });
    }).then(function () {
      renderAll();
    }).catch(function () {
      var body = $('mfBody');
      if (body) body.innerHTML = '<tr><td colspan="5" class="mf-loading">Broker flow data unavailable. Please try again later.</td></tr>';
    });
  }

  function bindControls() {
    document.querySelectorAll('#mfWindow button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#mfWindow button').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        state.window = btn.getAttribute('data-window');
        state.sector = '';
        state.page = 0;
        writeURL();
        load(false).catch(function () {});
      });
    });
    document.querySelectorAll('.mf-tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.mf-tabs button').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        state.sort = btn.getAttribute('data-sort');
        state.page = 0;
        writeURL();
        renderTable();
      });
    });
    document.querySelectorAll('#mfTrackTabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#mfTrackTabs button').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        state.trackH = parseInt(btn.getAttribute('data-h'), 10);
        writeURL();
        renderTrack();
      });
    });
    var search = $('mfBrokerSearch');
    if (search) {
      search.addEventListener('input', function () {
        state.q = search.value;
        state.page = 0;
        renderTable();
      });
    }
    // Reflect URL state in the controls.
    document.querySelectorAll('#mfWindow button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-window') === state.window);
    });
    document.querySelectorAll('.mf-tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-sort') === state.sort);
    });
    document.querySelectorAll('#mfTrackTabs button').forEach(function (b) {
      b.classList.toggle('on', parseInt(b.getAttribute('data-h'), 10) === state.trackH);
    });
  }

  function init() {
    if (!$('mfBody')) return;
    readURL();
    bindControls();
    load(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Auto-refresh with market calendar awareness (always a fresh fetch):
  // - Mon-Fri 11:00-15:00 NPT: every 5 min
  // - Mon-Fri outside hours: every 30 min (catches the post-close publish)
  // - Sat/Sun: every 2 hours
  function refreshIntervalMs() {
    try {
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
      var day = now.getDay();
      if (day === 0 || day === 6) return 2 * 60 * 60 * 1000;
      var mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= 660 && mins < 900) return 5 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }
  setInterval(function () {
    if (document.hidden) return;
    load(true);
  }, refreshIntervalMs());
})();
