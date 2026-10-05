/* js/verdict-v2-banner.js — Verdict Engine v2 banner for per-stock pages.
 * Mount: <div data-verdict-v2-banner data-sym="SYM"></div>.
 * Fetches /data/verdicts-v2-summary.json once (cached), renders the compact
 * warning banner with a link to the full evidence on the radar page.
 * Educational framing; never a buy/sell call. All output escaped. */
(function () {
  'use strict';
  var URL = '/data/verdicts-v2-summary.json';
  var cache = null, loading = false, queued = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function vLabel(v) {
    return { 'EXHAUSTION_RISK': 'Exhaustion risk', 'DISTRIBUTION_WARNING': 'Distribution warning',
      'ELEVATED_RISK': 'Elevated risk', 'IGNITION': 'Ignition', 'BOUNCE_SETUP': 'Bounce setup',
      'NEUTRAL': 'Neutral', 'UNRELIABLE': 'Unreliable data', 'EXCLUDED_NON_EQUITY': 'Non-equity',
      'INSUFFICIENT_DATA': 'Too little data' }[v] || v;
  }
  function vClass(v) {
    return { 'EXHAUSTION_RISK': 'warn', 'DISTRIBUTION_WARNING': 'warn',
      'ELEVATED_RISK': 'elev', 'IGNITION': 'opp', 'BOUNCE_SETUP': 'opp',
      'NEUTRAL': 'neu', 'UNRELIABLE': 'unr', 'EXCLUDED_NON_EQUITY': 'exc',
      'INSUFFICIENT_DATA': 'unr' }[v] || 'neu';
  }

  function render(mount, r) {
    if (!r) { mount.style.display = 'none'; return; }
    var cls = vClass(r.label);
    var conf = typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '%' : '—';
    var h = '<div class="v2b v2b-' + cls + '">' +
      '<span class="v2b-pill">' + esc(vLabel(r.label)) + '</span>' +
      '<span class="v2b-meta">Warning radar · ' + esc(conf) + ' confidence' +
      (r.pump_score != null ? ' · pump score ' + Number(r.pump_score).toFixed(2) : '') + '</span>' +
      '<a class="v2b-link" href="/nepse-verdicts-v2/">Why? See the evidence →</a>' +
      '</div>';
    mount.innerHTML = h;
  }

  function get(sym, cb) {
    if (cache) { cb((cache.verdicts || {})[sym] || null); return; }
    queued.push([sym, cb]);
    if (loading) return;
    loading = true;
    fetch(URL, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        cache = j; loading = false;
        queued.forEach(function (q) { q[1]((cache.verdicts || {})[q[0]] || null); });
        queued = [];
      })
      .catch(function () {
        loading = false;
        queued.forEach(function (q) { q[1](null); });
        queued = [];
      });
  }

  function init() {
    var mounts = document.querySelectorAll('[data-verdict-v2-banner]');
    if (!mounts.length) return;
    mounts.forEach(function (m) {
      var sym = m.getAttribute('data-sym');
      if (!sym) { m.style.display = 'none'; return; }
      get(sym, function (r) { render(m, r); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
