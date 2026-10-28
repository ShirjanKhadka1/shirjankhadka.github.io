/**
 * js/freshness-badge.js — the ONE freshness line for every NEPSE suite page.
 *
 * Reads /nepse-chart/data/live.json FIRST (the same file the quotes come
 * from), so the badge can never say "session closed" while the page's own
 * figures are from a live session:
 *   "Data as of 2026-10-02 · Session open · delayed 12 min (measured) · updated 4 min ago"
 *   "Data as of 2026-10-02 · Pre-open · delay unverified · updated 14 h ago"
 *   "Data as of 2026-10-02 · Session closed"
 * The delay is MEASURED from the feed's own timestamps (live.asof minus
 * live.data_asof) — never a hardcoded figure. When the data carries no
 * timestamp of its own, the badge says "delay unverified" instead.
 * Falls back to /data/manifest.json (overnight batch) when the live feed is
 * unreachable; the manifest carries no data timestamp, so that path always
 * reports "delay unverified". Sessions more than one trading day old render amber.
 *
 * Session state comes from the canonical NepseMarketConfig (Mon–Fri trading
 * days, pre-open 10:45:00–10:59:59 NPT, open 11:00–15:00 NPT) when the page
 * loads it. Pages that DON'T load the config (14 badged pages) used to get
 * a permanent "Session closed" from the null-config fallback — the badge now
 * trusts the tape's own market field there instead of lying.
 *
 * Tick-following (2026-10-28): the badge used to freeze at its load-time
 * state — a page loaded before the open kept saying "Session closed" at
 * 11:02 even after the page's own hero went LIVE, because the badge never
 * saw the page's 60s ticks. The badge now watches the page's OWN live.json
 * responses (fetch wrapper, response cloned so the page is untouched) and
 * re-renders whenever the tape changes. No extra requests, no page changes,
 * and pages without ticks keep exactly the old load + day-transition behavior.
 *
 * Pre-open snapshot (2026-10-28): a tape whose session is today, whose
 * market field is CLOSED, and whose asof falls in the pre-open window (or
 * the clock is inside it) is labeled "Pre-open snapshot" — clearly distinct
 * from "Session closed" and from "Session open", so a lagging tape at 11:02
 * can never read as a live session or a closed market.
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

  // Lazy config lookup: the config may load AFTER this script on pages that
  // self-load dependencies, so every use re-reads window instead of trusting
  // the single eval-time capture.
  function cfg() {
    return (typeof window !== 'undefined' && window.NepseMarketConfig) || CFG || null;
  }

  function pad(n) { return ('0' + n).slice(-2); }

  // Canonical session state: 'PRE-OPEN' | 'OPEN' | 'CLOSED'.
  // The calendar lives in NepseMarketConfig — no duplicated logic here.
  // Without a config on the page, the tape's own market field is the only
  // honest signal: OPEN means open, anything else means closed. Defaulting
  // to CLOSED (the old behavior) lied on every config-less page at noon.
  function sessionState(live) {
    var c = cfg();
    if (c && typeof c.marketState === 'function') return c.marketState();
    if (live && live.market === 'OPEN') return 'OPEN';
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

  // Measured feed delay: the snapshot instant (live.asof, tz-aware) minus
  // the data's own timestamp (live.data_asof, naive NPT). Returns minutes,
  // or null when either timestamp is missing/unparseable — the badge then
  // says "delay unverified" rather than inventing a number.
  function measuredDelayMin(live) {
    if (!live || !live.asof || !live.data_asof) return null;
    var a = new Date(live.asof).getTime();
    var raw = String(live.data_asof);
    var d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw + '+05:45').getTime();
    if (!isFinite(a) || !isFinite(d)) return null;
    var m = (a - d) / 60000;
    return m < 0 ? 0 : m;
  }
  function delayBit(live) {
    var m = measuredDelayMin(live);
    if (m == null) return ' · delay unverified';
    if (m < 1) return ' · delay under 1 min (measured)';
    return ' · delayed ' + Math.round(m) + ' min (measured)';
  }

  // Trading days strictly between fromYMD and toYMD (canonical calendar —
  // NepseMarketConfig only, no duplicated day-of-week logic).
  function tradingDaysBetween(fromYMD, toYMD) {
    var c = cfg();
    if (!c || typeof c.isTradingDay !== 'function') return 0;
    var from = new Date(fromYMD + 'T00:00:00Z'), to = new Date(toYMD + 'T00:00:00Z');
    var n = 0, d = new Date(from);
    d.setUTCDate(d.getUTCDate() + 1);
    while (d <= to) {
      var ymd = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      if (c.isTradingDay(ymd)) n++;
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
      // Replace (never accumulate) the state class: tick re-renders change
      // state (LIVE -> CLOSED, ...), and stacked fb-* classes would fight.
      // Page-owned classes on the mount are preserved.
      var kept = m.className.split(/\s+/).filter(function (c) {
        return c && c !== 'freshness-badge' && !/^fb-(live|ok|stale|unknown)$/.test(c);
      });
      kept.push('freshness-badge', cls);
      m.className = kept.join(' ');
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
      '.freshness-badge.fb-stale{background:#fffbeb;border-color:#fcd34d;color:#92400e}' +
      '[data-theme="dark"] .freshness-badge{background:rgba(20,22,28,.85);' +
      'border-color:#2a2e38;color:#d1d5db}' +
      '[data-theme="dark"] .freshness-badge.fb-stale{background:#3a2f12;' +
      'border-color:#a16207;color:#fcd34d}';
    document.head.appendChild(s);
  }

  // Most recent trading day on or before ymd (YYYY-MM-DD). The session
  // date is never a weekend or holiday — a snapshot refreshed on a Sunday
  // still carries Friday's session, never a phantom weekend "session".
  function lastTradingDay(ymd) {
    var c = cfg();
    if (!c || typeof c.isTradingDay !== 'function') return ymd;
    var d = new Date(ymd + 'T00:00:00Z');
    for (var i = 0; i < 10; i++) {
      var key = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      if (c.isTradingDay(key)) return key;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return ymd;
  }

  // NPT minutes-since-midnight of an ISO instant, or null when unparseable.
  function nptMinutesOfDay(iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    var n = new Date(t + NPT_MS);
    return n.getUTCHours() * 60 + n.getUTCMinutes();
  }

  // True when the TAPE itself is a pre-open snapshot: today's session,
  // market field CLOSED, and the snapshot was taken inside the pre-open
  // window (10:45–10:59:59 NPT) — or the clock is inside it. This is a
  // property of the tape, not the clock: at 11:02 with a lagging tape the
  // clock says OPEN while the figures are still yesterday's closes, and
  // neither "Session open" nor "Session closed" tells the truth.
  function isPreOpenSnapshot(live, sessDate) {
    if (!live || live.market !== 'CLOSED') return false;
    if (sessDate !== todayNpt()) return false;
    var mins = nptMinutesOfDay(live.asof);
    if (mins != null && mins >= 645 && mins < 660) return true;
    var c = cfg();
    if (c && typeof c.isPreOpen === 'function') {
      try { if (c.isPreOpen()) return true; } catch (e) {}
    }
    return false;
  }

  // Tape signature: everything the badge's rendering depends on. Unchanged
  // ticks leave the DOM byte-identical (never a re-render storm).
  var lastSig = null;
  function tapeSig(live) {
    if (!live) return '';
    var q = Array.isArray(live.quotes) ? live.quotes.length : -1;
    return [live.asof || '', live.session_date || '', live.market || '',
      live.partial ? '1' : '0', q].join('|');
  }

  // Tick entry point: re-render from a tape the PAGE itself just fetched.
  // Called by the fetch wrapper below; never fetches anything itself.
  function onTickPayload(live) {
    try {
      if (!live || typeof live !== 'object') return;
      if (tapeSig(live) === lastSig) return;
      fromLive(live);
    } catch (e) { /* never break the page on a tick */ }
  }

  // Primary path: the live quote feed.
  function fromLive(live) {
    var asof = live && live.asof;
    var sessDate = (live && live.session_date) || (asof ? nptDate(asof) : null);
    if (!sessDate) return false;
    sessDate = lastTradingDay(sessDate);
    lastSig = tapeSig(live);
    var st = sessionState(live);
    var today = todayNpt();
    var stale = tradingDaysBetween(sessDate, today);
    // Labeled partial tape (2026-10-27): the live tape carries partial=true
    // with its traded-so-far quotes array. When the flag is absent/falsy the
    // bit is empty, so rendering is byte-identical to before.
    var partialBit = (live && live.partial === true && Array.isArray(live.quotes))
      ? ' · Partial tape — ' + live.quotes.length + ' symbols traded so far' : '';
    if (stale > 1) {
      render('Data as of ' + sessDate + ' · ' + stale + ' sessions old — refresh delayed' + partialBit, 'fb-stale');
      return true;
    }
    var age = ageText(asof);
    var ageBit = age ? ' · updated ' + age : '';
    if (isPreOpenSnapshot(live, sessDate)) {
      // Steady dot, never the pulsing live dot: nothing is trading yet.
      render('Data as of ' + sessDate + ' · Pre-open snapshot' + delayBit(live) + ageBit + partialBit, 'fb-ok');
    } else if (st === 'OPEN') {
      render('Data as of ' + sessDate + ' · Session open' + delayBit(live) + ageBit + partialBit, 'fb-live');
    } else if (st === 'PRE-OPEN') {
      render('Data as of ' + sessDate + ' · Pre-open' + delayBit(live) + ageBit + partialBit, 'fb-live');
    } else {
      render('Data as of ' + sessDate + ' · Session closed' + partialBit, 'fb-ok');
    }
    return true;
  }

  // Fallback path: the overnight manifest (no quote feed available).
  function fromManifest(m) {
    var sessDate = (m && m.session_date) || null;
    if (!sessDate) { render('Freshness unavailable', 'fb-unknown'); return; }
    var st = sessionState();
    // "Today" always comes from the live browser clock — the manifest's
    // baked today_npt goes stale after midnight until the next rebuild.
    var today = todayNpt();
    var stale = tradingDaysBetween(sessDate, today);
    if (stale > 1) {
      render('Data as of ' + sessDate + ' · ' + stale + ' sessions old — refresh delayed', 'fb-stale');
    } else if (st === 'OPEN') {
      render('Data as of ' + sessDate + ' · Session open · delay unverified', 'fb-live');
    } else if (st === 'PRE-OPEN') {
      render('Data as of ' + sessDate + ' · Pre-open · delay unverified', 'fb-live');
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

  // Tick-following: watch the page's OWN live-feed responses. Every script
  // on the page fetches /nepse-chart/data/live.json through window.fetch
  // (nepse-data.js, nd-home, nd-daily, sectors, ... — the codebase is
  // fetch-only, no XHR). The wrapper clones the response, parses the
  // clone, and hands the tape to onTickPayload; the page receives its
  // original response untouched. Non-feed requests pass through unmodified.
  // Installed before the badge's own load fetch, so the load fetch is
  // sig-gated like any other tick. Guarded so a double-loaded badge never
  // double-wraps.
  try {
    if (typeof window !== 'undefined' && typeof window.fetch === 'function' &&
        !window.fetch.__ndBadgeWrapped) {
      var origFetch = window.fetch;
      var LIVE_TAIL = 'nepse-chart/data/live.json';
      var wrappedFetch = function () {
        var args = arguments;
        var url = null;
        try {
          var first = args[0];
          if (typeof first === 'string') url = first;
          else if (first && typeof first.url === 'string') url = first.url;
        } catch (e) {}
        var isLive = false;
        if (url) {
          try {
            var path = url.split('?')[0].split('#')[0];
            isLive = path === '/' + LIVE_TAIL || path === LIVE_TAIL ||
              path.slice(-LIVE_TAIL.length - 1) === '/' + LIVE_TAIL;
          } catch (e) {}
        }
        var p = origFetch.apply(this, args);
        if (!isLive) return p;
        try {
          return p.then(function (resp) {
            try {
              if (resp && typeof resp.clone === 'function') {
                resp.clone().json().then(onTickPayload, function () {});
              }
            } catch (e) {}
            return resp;
          });
        } catch (e) { return p; }
      };
      wrappedFetch.__ndBadgeWrapped = true;
      window.fetch = wrappedFetch;
    }
  } catch (e) { /* badge still works from its own fetches */ }

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

  // Midnight rollover + market-state transitions (user request 2026-10-04):
  // Re-check every minute. If the NPT date rolled over (00:00) or the market
  // state changed (CLOSED → PRE-OPEN at 10:45, PRE-OPEN → OPEN at 11:00,
  // OPEN → CLOSED at 15:00), re-paint the badge so the page stays truthful
  // without a manual reload. Skipped when tab is hidden.
  var lastDateKey = null, lastState = null;
  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  try {
    var c0 = cfg();
    var initNPT = (c0 && typeof c0.nowNPT === 'function') ? c0.nowNPT() : new Date(Date.now() + NPT_MS);
    lastDateKey = dateKey(initNPT);
    lastState = sessionState();
  } catch (e) { /* keep nulls, first tick will set */ }
  setInterval(function () {
    if (document.hidden) return;
    try {
      var cT = cfg();
      var npt = (cT && typeof cT.nowNPT === 'function') ? cT.nowNPT() : new Date(Date.now() + NPT_MS);
      var dk = dateKey(npt);
      var st = sessionState();
      if (dk !== lastDateKey || st !== lastState) {
        lastDateKey = dk;
        lastState = st;
        paint();
        // Re-fetch fresh data after a transition so the badge reflects the new session
        fetchJSON(LIVE_URL).then(function (live) {
          if (!fromLive(live)) throw new Error('no usable live snapshot');
        }).catch(function () {
          return fetchJSON(MANIFEST_URL).then(fromManifest, function () {
            render('Freshness unavailable', 'fb-unknown');
          });
        });
      }
    } catch (e) { /* never break the page on a timer error */ }
  }, 60000);
})();
