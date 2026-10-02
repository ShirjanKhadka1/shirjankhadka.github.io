/**
 * js/freshness-badge.js — the ONE freshness line for every NEPSE suite page.
 *
 * Reads /nepse-chart/data/live.json FIRST (the same file the quotes come
 * from), so the badge can never say "session closed" while the page's own
 * figures are from a live session:
 *   "Data as of 2026-10-02 · Session open · delayed ~15 min · updated 4 min ago"
 *   "Data as of 2026-10-02 · Pre-open · delayed ~15 min · updated 14 h ago"
 *   "Data as of 2026-10-02 · Session closed"
 * Falls back to /data/manifest.json (overnight batch) when the live feed is
 * unreachable. Sessions more than one trading day old render amber.
 *
 * Session state comes from the canonical NepseMarketConfig (Mon–Fri trading
 * days, pre-open 10:45:00–10:59:59 NPT, open 11:00–15:00 NPT).
 *
 * Usage: <div data-freshness-badge></div> + <script src="/js/freshness-badge.js" defer></script>
 * Works from any path depth (resolves data relative to site root).
 */
(function () {
  'use strict';
  function mounts() { return document.querySelectorAll('[data-freshness-badge]'); }
  if (!mounts().length) return;

  var LIVE_URL = '/nepse-chart/data/live.json';
  var MANIFEST_URL = '/data/manifest.json';
  var NPT_MS = 5.75 * 3600 * 1000; // UTC+5:45

  var CFG = (typeof window !== 'undefined' && window.NepseMarketConfig) || null;

  function pad(n) { return ('0' + n).slice(-2); }

  // Canonical session state: 'PRE-OPEN' | 'OPEN' | 'CLOSED'.
  // The calendar lives in NepseMarketConfig — no duplicated logic here.
  function sessionState() {
    if (CFG && typeof CFG.marketState === 'function') return CFG.marketState();
    return 'CLOSED';
  }

  // ISO instant -> 'YYYY-MM-DD' in NPT.
  function nptDate(iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    var n = new Date(t + NPT_MS);
    return n.getUTCFullYear() + '-' + pad(n.getUTCMonth() + 1) + '-' + pad(n.getUTCDate());
  }

  function todayNpt() { return nptDate(new Date().toISOString()); }

  function ageText(asofIso) {
    var t = new Date(asofIso).getTime();
    if (!isFinite(t)) return '';
    var m = (Date.now() - t) / 60000;
    if (m < 0) return '';
    if (m < 1) return 'just now';
    if (m < 60) return Math.floor(m) + ' min ago';
    if (m < 60 * 24) return Math.floor(m / 60) + ' h ago';
    return Math.floor(m / 1440) + ' d ago';
  }

  // Trading days strictly between fromYMD and toYMD (canonical calendar —
  // NepseMarketConfig only, no duplicated day-of-week logic).
  function tradingDaysBetween(fromYMD, toYMD) {
    if (!CFG || typeof CFG.isTradingDay !== 'function') return 0;
    var from = new Date(fromYMD + 'T00:00:00Z'), to = new Date(toYMD + 'T00:00:00Z');
    var n = 0, d = new Date(from);
    d.setUTCDate(d.getUTCDate() + 1);
    while (d <= to) {
      var ymd = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      if (CFG.isTradingDay(ymd)) n++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return n;
  }

  function render(text, cls) {
    var ms = mounts();
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var dot = cls === 'fb-live' ? '#16a34a' : cls === 'fb-stale' ? '#d97706' :
        cls === 'fb-unknown' ? '#9ca3af' : '#16a34a';
      m.innerHTML =
        '<span class="fb-dot" style="background:' + dot + '"></span>' +
        '<span class="fb-text"></span>';
      m.querySelector('.fb-text').textContent = text;
      m.className = (m.className + ' freshness-badge ' + cls).trim();
      m.setAttribute('role', 'status');
    }
  }

  function paint() {
    render('Checking data freshness…', 'fb-unknown');
  }

  function ensureCSS() {
    if (document.getElementById('freshness-badge-css')) return;
    var s = document.createElement('style');
    s.id = 'freshness-badge-css';
    s.textContent =
      '.freshness-badge{display:inline-flex;align-items:center;gap:8px;font-size:13px;' +
      'padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.7);' +
      'border:1px solid #e5e7eb;color:#374151;font-variant-numeric:tabular-nums}' +
      '.freshness-badge .fb-dot{width:8px;height:8px;border-radius:50%;flex:none}' +
      '.freshness-badge.fb-live .fb-dot{animation:fb-pulse 1.6s infinite}' +
      '@keyframes fb-pulse{0%,100%{opacity:1}50%{opacity:.35}}' +
      '.freshness-badge.fb-stale{background:#fffbeb;border-color:#fcd34d;color:#92400e}';
    document.head.appendChild(s);
  }

  // Primary path: the live quote feed.
  function fromLive(live) {
    var asof = live && live.asof;
    var sessDate = asof ? nptDate(asof) : null;
    if (!sessDate) return false;
    var st = sessionState();
    var today = todayNpt();
    var stale = tradingDaysBetween(sessDate, today);
    if (stale > 1) {
      render('Data as of ' + sessDate + ' · ' + stale + ' sessions old — refresh delayed', 'fb-stale');
      return true;
    }
    var age = ageText(asof);
    var ageBit = age ? ' · updated ' + age : '';
    if (st === 'OPEN') {
      render('Data as of ' + sessDate + ' · Session open · delayed ~15 min' + ageBit, 'fb-live');
    } else if (st === 'PRE-OPEN') {
      render('Data as of ' + sessDate + ' · Pre-open · delayed ~15 min' + ageBit, 'fb-live');
    } else {
      render('Data as of ' + sessDate + ' · Session closed', 'fb-ok');
    }
    return true;
  }

  // Fallback path: the overnight manifest (no quote feed available).
  function fromManifest(m) {
    var sessDate = (m && m.session_date) || null;
    if (!sessDate) { render('Freshness unavailable', 'fb-unknown'); return; }
    var st = sessionState();
    var today = (m && m.today_npt) || todayNpt();
    var stale = tradingDaysBetween(sessDate, today);
    if (stale > 1) {
      render('Data as of ' + sessDate + ' · ' + stale + ' sessions old — refresh delayed', 'fb-stale');
    } else if (st === 'OPEN') {
      render('Data as of ' + sessDate + ' · Session open · delayed ~15 min', 'fb-live');
    } else if (st === 'PRE-OPEN') {
      render('Data as of ' + sessDate + ' · Pre-open · delayed ~15 min', 'fb-live');
    } else {
      render('Data as of ' + sessDate + ' · Session closed', 'fb-ok');
    }
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  ensureCSS();
  paint();
  fetchJSON(LIVE_URL).then(function (live) {
    if (!fromLive(live)) throw new Error('no usable live snapshot');
  }).catch(function () {
    // Live feed unreachable — fall back to the overnight batch manifest.
    return fetchJSON(MANIFEST_URL).then(fromManifest, function () {
      render('Freshness unavailable', 'fb-unknown');
    });
  });
})();
