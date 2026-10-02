/**
 * js/freshness-badge.js — honest data-freshness badge for NEPSE suite pages.
 *
 * Reads /data/manifest.json (single source of truth) and renders:
 *   "Data as of 2026-09-30 · session closed"  (green)
 *   "Data as of 2026-09-29 · 2 sessions old — refresh delayed" (amber, stale)
 *   "Market LIVE — updating" (pulsing green during 11:00-15:00 NPT Mon-Fri)
 *
 * Usage: <div data-freshness-badge></div> + <script src="/js/freshness-badge.js" defer></script>
 * Works from any path depth (resolves manifest relative to site root).
 */
(function () {
  'use strict';
  function el() { return document.querySelectorAll('[data-freshness-badge]'); }
  if (!el().length) return;

  var MANIFEST_URL = '/data/manifest.json';

  function tradingDaysBetween(fromYMD, toYMD) {
    // crude session-age: count Mon-Fri days between (excludes weekends only;
    // holidays make this conservative, which is fine for a stale warning)
    var from = new Date(fromYMD + 'T00:00:00Z'), to = new Date(toYMD + 'T00:00:00Z');
    var n = 0, d = new Date(from);
    d.setUTCDate(d.getUTCDate() + 1);
    while (d <= to) {
      var dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) n++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return n;
  }

  function render(state, sessionDate, staleSessions) {
    var mounts = el();
    for (var i = 0; i < mounts.length; i++) {
      var m = mounts[i];
      var dot, text, cls;
      if (state === 'LIVE') {
        dot = '#16a34a'; text = 'Market LIVE · updating'; cls = 'fb-live';
      } else if (staleSessions > 1) {
        dot = '#d97706'; text = 'Data as of ' + sessionDate + ' · ' + staleSessions + ' sessions old — refresh delayed'; cls = 'fb-stale';
      } else {
        dot = '#16a34a'; text = 'Data as of ' + sessionDate + ' · session closed'; cls = 'fb-ok';
      }
      m.innerHTML =
        '<span class="fb-dot" style="background:' + dot + '"></span>' +
        '<span class="fb-text"></span>';
      m.querySelector('.fb-text').textContent = text;
      m.className = (m.className + ' freshness-badge ' + cls).trim();
      m.setAttribute('role', 'status');
    }
  }

  function paint() {
    var mounts = el();
    for (var i = 0; i < mounts.length; i++) {
      mounts[i].innerHTML = '<span class="fb-dot" style="background:#9ca3af"></span><span class="fb-text">Checking data freshness…</span>';
    }
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

  ensureCSS();
  paint();
  fetch(MANIFEST_URL, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (m) {
    var session = m.session_date || 'unknown';
    var stale = tradingDaysBetween(session, (m.today_npt || session));
    // Live override: the manifest only refreshes at market close, so during
    // the session it still says CLOSED/yesterday. If the intraday feed shows
    // today's session OPEN, the market is live right now.
    return fetch('/nepse-chart/data/live.json', { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; }).then(function (live) {
      var state = m.market_state;
      if (live && live.market === 'OPEN' && live.asof && m.today_npt &&
          String(live.asof).slice(0, 10) === m.today_npt) {
        state = 'LIVE'; session = m.today_npt; stale = 0;
      }
      render(state, session, stale);
    });
  }).catch(function () {
    var mounts = el();
    for (var i = 0; i < mounts.length; i++) {
      mounts[i].querySelector('.fb-text').textContent = 'Freshness unavailable';
    }
  });
})();
