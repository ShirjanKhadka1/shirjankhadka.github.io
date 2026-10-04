/* Nepse Decode — per-stock live price hydration (Phase 1: NepseData).
 * Stock pages are static HTML; this script subscribes to the canonical
 * validated market snapshot (js/nepse-data.js) and repaints the price
 * snapshot in the visitor's browser. Polling, validation, quarantine and
 * last-good retention all live in NepseData — this script only renders.
 * Silent on failure: the baked-in snapshot stays as the fallback.
 *
 * Self-loads its dependencies (nepse-market-config.js, nepse-format.js,
 * nepse-data.js) if the page didn't include them — so stock pages work
 * without HTML changes.
 */
(function () {
  'use strict';
  var snap = document.querySelector('[data-live-symbol]');
  if (!snap) return;
  var SYM = snap.getAttribute('data-live-symbol');

  // Self-load Phase 1 modules if not already present.
  function ensureDeps(cb) {
    if (window.NepseData && window.NepseFormat && window.NepseMarketConfig) return cb();
    var deps = ['/js/nepse-market-config.js', '/js/nepse-format.js', '/js/nepse-data.js'];
    var i = 0;
    function next() {
      if (i >= deps.length) return cb();
      var scripts = document.getElementsByTagName('script');
      var found = false;
      for (var s = 0; s < scripts.length; s++) {
        if (scripts[s].src && scripts[s].src.indexOf(deps[i].split('/').pop()) !== -1) { found = true; break; }
      }
      if (found) { i++; return next(); }
      var el = document.createElement('script');
      el.src = deps[i];
      el.onload = function () { i++; next(); };
      el.onerror = function () { i++; next(); };
      document.head.appendChild(el);
    }
    next();
  }

  function boot() {
    if (!window.NepseData || !window.NepseFormat) return; // modules missing: keep baked snapshot

    var F = window.NepseFormat;

  function paint(q, snapshot, status) {
    if (!q || !isFinite(+q.ltp)) return false; // getQuote() already excludes quarantined
    var priceEl = snap.querySelector('.sp-price');
    if (priceEl) priceEl.textContent = 'Rs ' + F.fmtPrice(q.ltp);
    var chgEl = snap.querySelector('.sp-chg');
    if (chgEl && isFinite(+q.percent_change)) {
      var pc = +q.percent_change;
      chgEl.textContent = F.fmtPct(pc) + ' on the session';
      chgEl.className = 'sp-chg ' + (pc < 0 ? 'neg' : (pc > 0 ? 'pos' : ''));
    }
    var volEl = snap.querySelector('[data-live-vol]');
    if (volEl && isFinite(+q.volume)) volEl.textContent = F.fmtNum(q.volume);
    var turnEl = snap.querySelector('[data-live-turnover]');
    if (turnEl && isFinite(+q.turnover)) turnEl.textContent = 'Rs ' + F.fmtNum(q.turnover);
    var asofEl = document.querySelector('.hero .asof');
    if (asofEl && snapshot && snapshot.asof) {
      // V2 honesty: never imply real-time — the quote feed is delayed.
      var state = snapshot.market === 'OPEN' ? 'market open' : 'market closed';
      var ageMs = Date.now() - new Date(snapshot.asof).getTime();
      var ageBit = isFinite(ageMs) && ageMs >= 0 ? ' · delayed ' + F.fmtAge(ageMs) : '';
      var txt = 'Delayed' + ageBit + ' · as of ' + F.fmtDateTimeNPT(snapshot.asof) + ' · ' + state;
      if (status === 'stale') txt += ' · STALE';
      asofEl.textContent = txt;
    }
    var badge = snap.querySelector('[data-live-badge]');
    if (badge && snapshot) {
      // V2 honesty: the quote feed is delayed, never real-time.
      if (status === 'stale') {
        badge.textContent = 'STALE';
        badge.style.display = '';
      } else if (snapshot.market === 'OPEN') {
        badge.textContent = 'DELAYED';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
    return true;
  }

  function onData(snapshot, status) {
    if (!snapshot) return; // loading / error with no data: keep baked snapshot, stay silent
    var q = window.NepseData.getQuote(SYM); // null when missing or quarantined
    if (q) paint(q, snapshot, status);
  }

    window.NepseData.start(); // idempotent: safe if another script already started it
    window.NepseData.subscribe(onData);
  }

  ensureDeps(boot);
})();
