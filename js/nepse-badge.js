/**
 * nepse-badge.js — Shared freshness badge for the NEPSE suite.
 *
 * ONE component every page uses. Pages mount it with:
 *
 *   NepseBadge.mount(document.getElementById('freshness-badge'));
 *
 * The badge auto-subscribes to NepseData and shows:
 *   dot (green = LIVE, amber = STALE/DELAYED, grey = CLOSED, blue pulse = LOADING)
 *   + label ("LIVE", "STALE", "CLOSED", "LOADING", "OFFLINE")
 *   + NPT timestamp ("as of 14:35 NPT") or age ("12 min old" when stale)
 *
 * Never claims "real-time". Tooltip carries the approved wording:
 * "Quotes refresh during market hours from a free community feed (LIVE badge);
 *  outside hours you see the last closed session."
 *
 * Minimal CSS is injected by this module (no external stylesheet dependency).
 * All classes use the `nlv-` prefix to avoid clashing with page styles.
 *
 * Load order: nepse-market-config.js → nepse-format.js → nepse-data.js → nepse-badge.js
 */
(function (global) {
  'use strict';

  var TOOLTIP = 'Quotes refresh during market hours from a free community feed ' +
    '(LIVE badge); outside hours you see the last closed session.';

  var CSS_ID = 'nlv-badge-css';
  var mounted = []; // { el, dot, label, time, options }

  function injectCss() {
    if (typeof document === 'undefined' || !document.createElement) return;
    if (document.getElementById && document.getElementById(CSS_ID)) return;
    var css =
      '.nlv-freshness{display:inline-flex;align-items:center;gap:6px;' +
      'padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;' +
      'letter-spacing:.04em;background:#f1f5f9;color:#334155;' +
      'border:1px solid #e2e8f0;white-space:nowrap;line-height:1.6;' +
      'font-family:inherit;vertical-align:middle}' +
      '.nlv-freshness-dot{width:8px;height:8px;border-radius:50%;' +
      'background:#94a3b8;flex:none}' +
      '.nlv-freshness[data-tone="live"] .nlv-freshness-dot{background:#16a34a;' +
      'box-shadow:0 0 0 3px rgba(22,163,74,.18)}' +
      '.nlv-freshness[data-tone="stale"]{background:#fffbeb;border-color:#fde68a;color:#92400e}' +
      '.nlv-freshness[data-tone="stale"] .nlv-freshness-dot{background:#d97706;' +
      'box-shadow:0 0 0 3px rgba(217,119,6,.18)}' +
      '.nlv-freshness[data-tone="closed"]{background:#f8fafc;color:#475569}' +
      '.nlv-freshness[data-tone="closed"] .nlv-freshness-dot{background:#64748b}' +
      '.nlv-freshness[data-tone="loading"] .nlv-freshness-dot{background:#0ea5e9;' +
      'animation:nlv-dot-pulse 1.2s ease-in-out infinite}' +
      '.nlv-freshness[data-tone="error"]{background:#fef2f2;border-color:#fecaca;color:#991b1b}' +
      '.nlv-freshness[data-tone="error"] .nlv-freshness-dot{background:#dc2626}' +
      '.nlv-freshness-time{font-weight:400;opacity:.85;letter-spacing:0}' +
      '@keyframes nlv-dot-pulse{0%,100%{opacity:1}50%{opacity:.3}}';
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = css;
    var head = document.head || document.getElementsByTagName('head')[0];
    if (head) head.appendChild(style);
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      if (global.NepseFormat && global.NepseFormat.fmtTimeNPT) {
        return global.NepseFormat.fmtTimeNPT(iso);
      }
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' NPT';
    } catch (e) { return ''; }
  }

  function lastGoodAge() {
    try {
      if (global.NepseData && global.NepseData.getLastGoodAge) {
        return global.NepseData.getLastGoodAge();
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Map (status, snapshot) → { tone, label, detail }.
   * tone: live | stale | closed | loading | error
   */
  function badgeState(status, snapshot) {
    if (status === 'error') {
      var age0 = lastGoodAge();
      return { tone: 'error', label: 'OFFLINE', detail: age0 ? '· ' + age0 : '' };
    }
    if (status === 'loading' || !snapshot) {
      return { tone: 'loading', label: 'LOADING', detail: '' };
    }
    if (status === 'stale') {
      var sage = lastGoodAge();
      var detail = '';
      if (sage) detail = (sage === 'just now') ? '· reconnecting…' : '· ' + sage + ' old';
      return { tone: 'stale', label: 'STALE', detail: detail };
    }
    var market = snapshot.market;
    var t = fmtTime(snapshot.asof);
    if (market === 'OPEN') {
      // V2 honesty: never a hardcoded delay figure — the badge shows the
      // measured age ("updated X ago") from the data's own timestamp.
      return { tone: 'live', label: 'LIVE', detail: (t ? '· as of ' + t : '') };
    }
    return { tone: 'closed', label: 'CLOSED', detail: t ? '· as of ' + t : '' };
  }

  function render(entry, status, snapshot) {
    var s = badgeState(status, snapshot);
    entry.el.setAttribute('data-tone', s.tone);
    entry.el.setAttribute('title', TOOLTIP);
    entry.dot.className = 'nlv-freshness-dot';
    entry.label.textContent = s.label;
    if (entry.options.showTime === false) {
      entry.time.textContent = '';
      entry.time.style.display = 'none';
    } else {
      entry.time.style.display = '';
      entry.time.textContent = s.detail;
    }
  }

  function autoSubscribe() {
    try {
      if (global.NepseData && typeof global.NepseData.subscribe === 'function') {
        global.NepseData.subscribe(function (snapshot, status) {
          NepseBadge.update(status, snapshot);
        });
      }
    } catch (e) { /* NepseData unavailable — badge stays in LOADING */ }
  }

  var NepseBadge = {
    /**
     * Mount a freshness badge into element `el`.
     * options: { showTime: true } — set false to hide the timestamp/age detail.
     * Safe to call before NepseData.start(); the badge updates on subscribe.
     */
    mount: function (el, options) {
      if (!el || typeof document === 'undefined') return null;
      injectCss();
      var opts = options || {};
      // Build: <span class="nlv-freshness" data-tone="loading" title="…">
      //          <span class="nlv-freshness-dot"></span>
      //          <span class="nlv-freshness-label">LOADING</span>
      //          <span class="nlv-freshness-time"></span>
      //        </span>
      el.className = (el.className ? el.className + ' ' : '') + 'nlv-freshness';
      el.setAttribute('data-tone', 'loading');
      el.setAttribute('title', TOOLTIP);
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      var dot = document.createElement('span');
      dot.className = 'nlv-freshness-dot';
      var label = document.createElement('span');
      label.className = 'nlv-freshness-label';
      label.textContent = 'LOADING';
      var time = document.createElement('span');
      time.className = 'nlv-freshness-time';
      el.appendChild(dot);
      el.appendChild(label);
      el.appendChild(time);
      var entry = { el: el, dot: dot, label: label, time: time, options: opts };
      mounted.push(entry);
      // Paint current state immediately if NepseData already has one.
      try {
        if (global.NepseData && typeof global.NepseData.getSnapshot === 'function') {
          render(entry, global.NepseData.getStatus(), global.NepseData.getSnapshot());
        }
      } catch (e) { /* ignore */ }
      return entry;
    },

    /** Update every mounted badge. Called automatically via NepseData.subscribe. */
    update: function (status, snapshot) {
      for (var i = 0; i < mounted.length; i++) {
        try { render(mounted[i], status, snapshot); } catch (e) { /* ignore */ }
      }
    },

    /** Number of mounted badges (useful for tests). */
    count: function () { return mounted.length; },

    // Exposed for tests:
    _badgeState: badgeState,
    _tooltip: TOOLTIP
  };

  // Auto-subscribe once the DOM is ready (or immediately if already ready).
  // Deferred so load order is forgiving: badge.js may load before start() runs.
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoSubscribe);
      } else {
        autoSubscribe();
      }
    }
  } catch (e) { /* non-DOM environment */ }

  global.NepseBadge = NepseBadge;
})(typeof window !== 'undefined' ? window : this);
