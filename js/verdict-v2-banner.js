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

  function vPlain(v) {
    return {
      'EXHAUSTION_RISK': 'This stock ran up very fast and looks tired — late buyers often get stuck here.',
      'DISTRIBUTION_WARNING': 'Danger signs: big players look like they are selling into excited buyers. Be careful.',
      'ELEVATED_RISK': 'Early warning signs are forming. Worth watching, not a full pattern yet.',
      'IGNITION': 'Fresh upward energy is building. Momentum is starting, not a danger flag.',
      'BOUNCE_SETUP': 'After a fall, the setup for a short rebound is forming. Still risky.',
      'NEUTRAL': 'No danger signs right now. Nothing alarming in the price action.',
      'UNRELIABLE': 'The price data looks broken, so no verdict can be trusted here.',
      'EXCLUDED_NON_EQUITY': 'This is not a regular company share, so the engine skips it.',
      'INSUFFICIENT_DATA': 'Not enough price history yet to form any verdict.'
    }[v] || '';
  }
  function render(mount, r) {
    if (!r) { mount.style.display = 'none'; return; }
    var cls = vClass(r.label);
    var conf = typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '%' : '—';
    var h = '<section class="v2b v2b-' + cls + '" aria-label="Verdict Engine v2">' +
      '<div class="v2b-kicker">Verdict Engine v2</div>' +
      '<div class="v2b-headline"><span class="v2b-pill">' + esc(vLabel(r.label)) + '</span></div>' +
      '<p class="v2b-plain">' + esc(vPlain(r.label)) + '</p>' +
      '<span class="v2b-meta">' + esc(conf) + ' confidence' +
      (r.pump_score != null ? ' · pump score ' + Number(r.pump_score).toFixed(2) : '') + '</span>' +
      '<a class="v2b-link" href="/nepse-verdicts-v2/">Open the warning radar →</a>' +
      '</section>';
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
