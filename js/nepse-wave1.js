/* NEPSE Alpha Lab — Wave 1 market-intelligence renderer.
 *
 * Loads nepse-chart/data/wave1.json (built by tools/build-nepse-wave1.js)
 * and renders:
 *   - the "Market today" summary on /nepse-decode/ (#mktGrid, #mktCols)
 *   - the RSI-extremes / biggest-movers tab panel on /nepse-screener/
 * Auto-initializes on DOMContentLoaded when the containers exist.
 * All figures come from the JSON file; nothing is invented here.
 * Educational use only — not investment advice.
 */
(function () {
  'use strict';

  var W1 = {};

  function dataURL() {
    var s = document.querySelector('script[src*="nepse-wave1.js"]');
    var src = s ? s.getAttribute('src') : '/js/nepse-wave1.js';
    return src.replace(/[^/]*$/, '') + '../nepse-chart/data/wave1.json';
  }

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt2(n) {
    return (+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtMoney(n) {
    n = +n;
    if (n >= 1e9) return 'Rs ' + (n / 1e9).toFixed(2) + 'b';
    if (n >= 1e6) return 'Rs ' + (n / 1e6).toFixed(2) + 'm';
    if (n >= 1e3) return 'Rs ' + (n / 1e3).toFixed(1) + 'k';
    return 'Rs ' + n;
  }
  var MONTHS_L = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  var MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? { y: m[1], mo: +m[2], d: +m[3] } : null;
  }
  function fmtLong(iso) {
    var p = parts(iso); return p ? p.d + ' ' + MONTHS_L[p.mo - 1] + ' ' + p.y : (iso || '');
  }
  function fmtDayMon(iso) {
    var p = parts(iso); return p ? { day: String(p.d), my: MONTHS_S[p.mo - 1] + ' ' + p.y } : { day: '', my: '' };
  }
  function chgHTML(c) {
    if (c == null || !isFinite(c)) return '<span class="mkt-chg">—</span>';
    var cls = c >= 0 ? 'up' : 'dn';
    return '<span class="mkt-chg ' + cls + '">' + (c >= 0 ? '+' : '') + (+c).toFixed(2) + '%</span>';
  }
  function fresh(dateStr) {
    if (window.NepseFresh && dateStr) return ' ' + window.NepseFresh.badge(dateStr);
    return '';
  }
  function chartLink(sym) {
    return '/nepse-chart/?s=' + encodeURIComponent(sym);
  }

  /* Shared list rows (top gainers / losers / turnover leaders), used by the
   * daily batch render and by the in-session live tape. items: {s, p, ch, t}. */
  function mktRows(items, kind) {
    var Mono = window.NepseMono || null;
    if (!items || !items.length) return '<p class="mkt-empty">No data for this session.</p>';
    return items.map(function (it) {
      var right = kind === 'turnover'
        ? '<span class="mkt-price">' + fmtMoney(it.t) + '</span>'
        : '<span class="mkt-price">Rs ' + (it.p != null ? fmt2(it.p) : '—') + '</span>';
      return '<div class="mkt-row"><a class="mkt-sym" href="' + chartLink(it.s) + '">' +
        (Mono ? Mono.avatar(it.s) : '') + '<span>' + esc(it.s) + '</span></a>' + chgHTML(it.ch) + right + '</div>';
    }).join('');
  }

  /* ---------------- market summary (alpha) ---------------- */

  function mktCard(nk, nb, p) {
    return '<article class="note-card reveal in"><div class="nk">' + nk + '</div>' +
      '<div class="nb">' + nb + '</div><p>' + p + '</p></article>';
  }

  function renderMarket(d) {
    var grid = $('mktGrid'), cols = $('mktCols');
    if (!grid || !cols || !d || !d.market) return;
    var m = d.market;

    var idx = m.index || {};
    // Wave 7: the index card carries the live-badge mount (mkt-live) and ids
    // so the in-session value can be updated in place without a reload.
    var c1 = '<article class="note-card reveal in"><div class="nk">NEPSE index <span id="mkt-live"></span></div>' +
      '<div class="nb tnum" id="mkt-ixv"' + (idx.value != null ? ' data-count="' + esc(idx.value) + '" data-decimals="2"' : '') + '>' +
      (idx.value != null ? fmt2(idx.value) : '—') + '</div>' +
      '<p id="mkt-ixc">' + (idx.change != null
        ? '<b class="' + (idx.change >= 0 ? 'up' : 'dn') + '" style="color:' +
          (idx.change >= 0 ? 'var(--up)' : 'var(--down)') + '\">' +
          (idx.change >= 0 ? '+' : '') + fmt2(idx.change) + ' (' +
          (idx.change >= 0 ? '+' : '') + (+idx.pct).toFixed(2) + '%)</b> on the session'
        : 'Index data unavailable for this session.') + '</p></article>';
    var tot = (m.advancers || 0) + (m.decliners || 0) + (m.unchanged || 0);
    var upW = tot ? (m.advancers / tot * 100).toFixed(1) : 0;
    var dnW = tot ? (m.decliners / tot * 100).toFixed(1) : 0;
    // ids on the breadth/turnover/session cards so the in-session tape can
    // repaint every figure in place (see paintLiveTape below).
    var c2 = mktCard('Breadth',
      '<span id="mkt-adv" data-count="' + (m.advancers || 0) + '">' + (m.advancers || 0) + '</span> <small>up</small> · ' +
      '<span id="mkt-dec" data-count="' + (m.decliners || 0) + '">' + (m.decliners || 0) + '</span> <small>down</small>',
      '<span class="br-bar" role="img" aria-label="' + m.advancers + ' advancers, ' +
      m.decliners + ' decliners"><span class="br-up" id="mkt-brup" style="width:' + upW + '%"></span>' +
      '<span class="br-dn" id="mkt-brdn" style="width:' + dnW + '%"></span></span>' +
      '<span id="mkt-unc">' + m.unchanged + ' unchanged of ' + m.traded + ' securities with recorded trades.</span>');
    var c3 = mktCard('Session turnover',
      m.totalTurnover != null
        ? '<span id="mkt-turn" data-count="' + (m.totalTurnover / 1e9).toFixed(3) + '" data-decimals="2" data-prefix="Rs " data-suffix="b">' +
          fmtMoney(m.totalTurnover) + '</span>'
        : '—',
      'Total value traded across the session.');
    var dm = fmtDayMon(m.date);
    var c4 = mktCard('Session',
      '<span id="mkt-sessd">' + esc(dm.day) + '</span> <small id="mkt-sessm">' + esc(dm.my) + '</small>',
      '<span id="mkt-sessn">The last closed session' + fresh(m.date) + '.</span>');
    grid.innerHTML = c1 + c2 + c3 + c4 +
      '<p class="nlsnap-close" id="mkt-close" hidden></p>';
    var Motion = window.NepseMotion;
    if (Motion) { Motion.watchCounts(grid); }

    var asof = $('mkt-asof');
    if (asof && m.date) {
      asof.textContent = 'Session of ' + fmtLong(m.date) + ', measured from the session tape.';
      asof.insertAdjacentHTML('beforeend', fresh(m.date));
    }
    var traded = $('mkt-traded');
    if (traded) traded.textContent = m.traded;

    cols.innerHTML =
      '<div class="mkt-col"><h3>Top gainers</h3>' + mktRows(m.gainers, 'chg') + '</div>' +
      '<div class="mkt-col"><h3>Top losers</h3>' + mktRows(m.losers, 'chg') + '</div>' +
      '<div class="mkt-col"><h3>Turnover leaders</h3>' + mktRows(m.turnover, 'turnover') + '</div>';
  }

  /* ---------------- Wave 7: in-session live updates ----------------
   * During market hours every figure follows the 15-minute quote tape:
   * the index value, day change and badge update in place every minute,
   * and breadth, turnover, the session label and the top-5 lists are
   * recomputed from the tape whenever a fresh snapshot lands. Only the
   * current session's tape is ever used; after hours the daily batch
   * (rebuilt at 15:15 NPT) carries the closed session.
   * Figures come from NepseLive; when the feed is stale we say so. */
  var lastTapeAsOf = 0;
  function setTapeText(id, txt) {
    var el = $(id);
    if (el) { el.removeAttribute('data-count'); el.textContent = txt; }
  }
  function paintLiveTape(snap) {
    var NL = window.NepseLive;
    var lv = snap && snap.live;
    var lq = lv && lv.quotes;
    var keys = lq ? Object.keys(lq) : [];
    if (!NL || !keys.length || !lv.asof || lv.asof === lastTapeAsOf) return;
    // Never mix sessions: the tape must be from today's NPT date.
    var dayStr = null, todayStr = null;
    try {
      dayStr = new Date(lv.asof + 5.75 * 3600 * 1000).toISOString().slice(0, 10);
      todayStr = NL.nowNPT().toISOString().slice(0, 10);
    } catch (e) { /* keep nulls */ }
    if (!dayStr || dayStr !== todayStr) return;
    lastTapeAsOf = lv.asof;

    var adv = 0, dec = 0, unc = 0, turn = 0, arr = [];
    for (var i = 0; i < keys.length; i++) {
      var q = lq[keys[i]] || {};
      var c = q.pct;
      if (!(c >= 0) && !(c < 0)) { unc++; continue; }
      if (c > 0) adv++; else if (c < 0) dec++; else unc++;
      var tv = +q.turnover;
      if (q.turnover != null && isFinite(tv)) turn += tv;
      arr.push({ s: keys[i], p: q.ltp, ch: c, t: q.turnover });
    }
    var tot = adv + dec + unc;
    setTapeText('mkt-adv', String(adv));
    setTapeText('mkt-dec', String(dec));
    var bu = $('mkt-brup'), bd = $('mkt-brdn');
    if (bu) bu.style.width = (tot ? (adv / tot * 100).toFixed(1) : 0) + '%';
    if (bd) bd.style.width = (tot ? (dec / tot * 100).toFixed(1) : 0) + '%';
    setTapeText('mkt-unc', unc + ' unchanged of ' + tot + ' securities with recorded trades.');
    setTapeText('mkt-turn', fmtMoney(turn));
    var dm = fmtDayMon(todayStr);
    setTapeText('mkt-sessd', dm.day);
    setTapeText('mkt-sessm', dm.my);
    setTapeText('mkt-sessn', 'Live session · updating every 15 min.');
    setTapeText('mkt-asof', 'Live session of ' + fmtLong(todayStr) + ' · updating every 15 min.');
    setTapeText('mkt-traded', String(tot));
    var cols = $('mktCols');
    if (cols) {
      var byCh = arr.slice().sort(function (a, b) { return b.ch - a.ch; });
      var byTv = arr.filter(function (r) { return r.t != null && isFinite(+r.t); })
        .sort(function (a, b) { return b.t - a.t; });
      cols.innerHTML =
        '<div class="mkt-col"><h3>Top gainers</h3>' + mktRows(byCh.slice(0, 5), 'chg') + '</div>' +
        '<div class="mkt-col"><h3>Top losers</h3>' + mktRows(byCh.slice(-5).reverse(), 'chg') + '</div>' +
        '<div class="mkt-col"><h3>Turnover leaders</h3>' + mktRows(byTv.slice(0, 5), 'turnover') + '</div>';
    }
  }
  function updateMarketLive(snap) {
    var NL = window.NepseLive;
    if (!NL || !snap) return;
    var open = NL.isMarketHours();
    var li = snap.live && snap.live.index;

    var badge = $('mkt-live');
    if (badge) badge.innerHTML = NL.badgeHTML(NL.statusOf(snap.live));

    var ixv = $('mkt-ixv');
    if (ixv && open && li && li.value != null) {
      ixv.removeAttribute('data-count'); // a live figure, not a count-up target
      ixv.textContent = fmt2(li.value);
      var ixc = $('mkt-ixc');
      if (ixc && li.change != null && li.pct != null) {
        ixc.innerHTML = '<b style="color:' + (li.change >= 0 ? 'var(--up)' : 'var(--down)') + '">' +
          (li.change >= 0 ? '+' : '') + fmt2(li.change) + ' (' +
          (li.change >= 0 ? '+' : '') + (+li.pct).toFixed(2) + '%)</b> on the session';
      }
    }
    if (open) paintLiveTape(snap);

    var closeP = $('mkt-close');
    if (closeP) {
      var s = (!open && window.NepseSnapshot) ? window.NepseSnapshot.closeSentence(snap.batch) : '';
      if (s) { closeP.textContent = s; closeP.hidden = false; }
      else closeP.hidden = true;
    }
  }

  function startLiveUpdates(batch) {
    var NL = window.NepseLive;
    if (!NL || !$('mktGrid')) return;
    NL.start({
      onData: function (d) { updateMarketLive({ batch: batch, live: d }); }
    });
  }

  /* ---------------- RSI + movers tabs (screener) ---------------- */

  var TABS = [
    { id: 'os', label: 'Oversold', title: 'RSI below 30' },
    { id: 'ob', label: 'Overbought', title: 'RSI above 70' },
    { id: 'lo', label: 'Lowest RSI', title: 'Ten lowest RSI readings' },
    { id: 'hi', label: 'Highest RSI', title: 'Ten highest RSI readings' },
    { id: 'mv', label: 'Moves most', title: 'Biggest average daily range' },
  ];

  function rsiItem(it) {
    return '<li class="w1-item"><a class="sc-sym" href="' + chartLink(it.s) + '">' + esc(it.s) + '</a>' +
      '<span class="w1-sub">' + esc(it.n) + '</span>' +
      '<span class="w1-num">' + (+it.rsi).toFixed(1) + '</span>' +
      '<span class="w1-sub">Rs ' + (it.p != null ? fmt2(it.p) : '—') + ' · ' +
      (it.ch != null ? ((+it.ch >= 0 ? '+' : '') + (+it.ch).toFixed(2) + '%') : '—') + '</span></li>';
  }
  function mvItem(it) {
    return '<li class="w1-item"><a class="sc-sym" href="' + chartLink(it.s) + '">' + esc(it.s) + '</a>' +
      '<span class="w1-sub">' + esc(it.n) + '</span>' +
      '<span class="w1-num">' + (+it.rangePct).toFixed(2) + '%</span>' +
      '<span class="w1-sub">Rs ' + fmt2(it.avgRange) + ' avg range · ' + it.sessions + ' sessions</span></li>';
  }
  function emptyMsg(t) {
    return '<p class="mkt-empty">No securities ' + t + ' in the latest batch.</p>';
  }

  function renderLists(d) {
    if (!d || !d.rsi) return;
    var r = d.rsi, mv = d.movers || {};
    var lists = {
      os: r.oversold && r.oversold.length ? '<ul class="w1-list">' + r.oversold.map(rsiItem).join('') + '</ul>'
        : emptyMsg('are oversold right now'),
      ob: r.overbought && r.overbought.length ? '<ul class="w1-list">' + r.overbought.map(rsiItem).join('') + '</ul>'
        : emptyMsg('are overbought right now'),
      lo: r.lowest && r.lowest.length ? '<ul class="w1-list">' + r.lowest.map(rsiItem).join('') + '</ul>'
        : emptyMsg('have an RSI reading'),
      hi: r.highest && r.highest.length ? '<ul class="w1-list">' + r.highest.map(rsiItem).join('') + '</ul>'
        : emptyMsg('have an RSI reading'),
      mv: mv.top && mv.top.length ? '<ul class="w1-list">' + mv.top.map(mvItem).join('') + '</ul>'
        : emptyMsg('have enough history for a range ranking'),
    };
    TABS.forEach(function (t) {
      var p = $('w1p-' + t.id);
      if (p) p.innerHTML = lists[t.id];
    });
    var asof = $('w1-asof');
    if (asof && r.asof) {
      asof.textContent = '· RSI batch ' + r.asof;
      asof.insertAdjacentHTML('beforeend', fresh(r.asof));
    }
  }

  function bindTabs() {
    var tabs = TABS.map(function (t) { return $('w1tab-' + t.id); }).filter(Boolean);
    if (!tabs.length) return;
    function select(tab, focus) {
      tabs.forEach(function (tb) {
        var on = tb === tab;
        tb.setAttribute('aria-selected', on ? 'true' : 'false');
        tb.tabIndex = on ? 0 : -1;
        var panel = $(tb.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = tabs.length - 1;
        if (j != null) { e.preventDefault(); select(tabs[j], true); }
      });
    });
  }

  /* ---------------- boot ---------------- */

  var promise = null;
  function load() {
    if (!promise) {
      promise = fetch(dataURL(), { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      });
    }
    return promise;
  }

  function fail() {
    var g = $('mktGrid');
    if (g) g.innerHTML = '<p class="mkt-empty">Market summary is temporarily unavailable. Please retry in a moment.</p>';
    TABS.forEach(function (t) {
      var p = $('w1p-' + t.id);
      if (p) p.innerHTML = '<p class="mkt-empty">List unavailable. Please retry in a moment.</p>';
    });
  }

  function init() {
    var needMarket = !!$('mktGrid');
    var needLists = !!$('w1-os') || !!$('w1p-os');
    if (!needMarket && !needLists) return;
    if (needLists) bindTabs();
    load().then(function (d) {
      if (needMarket) {
        renderMarket(d);
        if (d && d.market) startLiveUpdates(d.market); // Wave 7: 60s in-place refresh
      }
      if (needLists) renderLists(d);
    }).catch(fail);
  }

  W1.load = load;
  W1.renderMarket = renderMarket;
  W1.renderLists = renderLists;
  window.NepseWave1 = W1;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
