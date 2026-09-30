/* Nepse Decode — per-stock live price hydration.
 * Stock pages are static HTML; this script fetches the canonical live.json
 * feed (same feed as the dashboard) and repaints the price snapshot in the
 * visitor's browser, every 60 seconds. No extra load on NEPSE's API —
 * it only reads our own GitHub-hosted JSON. Silent on failure: the baked-in
 * snapshot stays as the fallback. */
(function () {
  'use strict';
  var snap = document.querySelector('[data-live-symbol]');
  if (!snap) return;
  var SYM = snap.getAttribute('data-live-symbol');
  var FEED = '/nepse-chart/data/live.json';
  var NPT_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

  function num2(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function int(n) {
    return Math.round(Number(n)).toLocaleString('en-US');
  }
  function nptStamp(iso) {
    try {
      var d = new Date(new Date(iso).getTime() + NPT_OFFSET_MS);
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var hh = d.getUTCHours(), mm = d.getUTCMinutes();
      return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
        ', ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ' NPT';
    } catch (e) { return ''; }
  }

  function paint(q, feed) {
    if (!q || !isFinite(+q.ltp)) return false;
    var priceEl = snap.querySelector('.sp-price');
    if (priceEl) priceEl.textContent = 'Rs ' + num2(+q.ltp);
    var chgEl = snap.querySelector('.sp-chg');
    if (chgEl && isFinite(+q.percent_change)) {
      var pc = +q.percent_change;
      chgEl.textContent = (pc > 0 ? '+' : '') + pc.toFixed(2) + '% on the session';
      chgEl.className = 'sp-chg ' + (pc < 0 ? 'neg' : (pc > 0 ? 'pos' : ''));
    }
    var volEl = snap.querySelector('[data-live-vol]');
    if (volEl && isFinite(+q.volume)) volEl.textContent = int(+q.volume);
    var turnEl = snap.querySelector('[data-live-turnover]');
    if (turnEl && isFinite(+q.turnover)) turnEl.textContent = 'Rs ' + int(+q.turnover);
    var asofEl = document.querySelector('.hero .asof');
    if (asofEl && feed && feed.asof) {
      var state = feed.market === 'OPEN' ? 'market open' : 'market closed';
      asofEl.textContent = 'Live · ' + nptStamp(feed.asof) + ' · ' + state;
    }
    var badge = snap.querySelector('[data-live-badge]');
    if (badge && feed) {
      if (feed.market === 'OPEN') {
        badge.textContent = 'LIVE';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
    return true;
  }

  function tick() {
    fetch(FEED, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (feed) {
        if (!feed || !feed.quotes) return;
        for (var i = 0; i < feed.quotes.length; i++) {
          if (feed.quotes[i].symbol === SYM) { paint(feed.quotes[i], feed); break; }
        }
      })
      .catch(function () { /* keep the baked-in snapshot */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
  setInterval(tick, 60000);
})();
