/* Nepse Decode — lazy full index history (Track C perf).
 *
 * js/nepse-daily.js ships only the recent ~2 years of NEPSE daily OHLCV so
 * first paint stays light. The full 2003-07-17 history lives in the static
 * /data/index-history.json archive (immutable rows, long-cacheable).
 *
 * This deferred script fetches the archive after first paint (idle or window
 * load), prepends the older rows to window.NEPSE_DAILY (deduped by session
 * date, so a pipeline append landing mid-flight can never duplicate a row),
 * then dispatches 'nepse-daily:full' on window so charts can extend their
 * range. If the fetch fails, the inline recent slice keeps every chart
 * functional — the page never depends on the archive.
 *
 * No dependencies. Safe to include on any page that loads js/nepse-daily.js.
 */
(function () {
  'use strict';

  var ARCHIVE = '/data/index-history.json';

  function merge(rows) {
    var cur = window.NEPSE_DAILY || [];
    var seen = {}, i;
    for (i = 0; i < cur.length; i++) seen[cur[i][0]] = true;
    var older = [];
    for (i = 0; i < rows.length; i++) {
      if (!seen[rows[i][0]]) { older.push(rows[i]); seen[rows[i][0]] = true; }
    }
    if (older.length) window.NEPSE_DAILY = older.concat(cur);
    return older.length;
  }

  function done(added) {
    window.NEPSE_DAILY_FULL = true;
    try {
      window.dispatchEvent(new CustomEvent('nepse-daily:full', { detail: { added: added } }));
    } catch (e) { /* older browsers: charts keep the recent slice */ }
  }

  function load() {
    if (window.NEPSE_DAILY_FULL) return;
    // Archive rows are immutable history; the browser HTTP cache may keep it.
    fetch(ARCHIVE, { cache: 'default' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (doc) {
      var rows = (doc && doc.rows) || doc || [];
      done(merge(rows));
    }).catch(function () {
      /* Archive unavailable: the inline recent slice stays authoritative. */
      window.NEPSE_DAILY_FULL = true;
    });
  }

  // After first paint: idle callback when available, else window load.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(load, { timeout: 5000 });
  } else if (document.readyState === 'complete') {
    load();
  } else {
    window.addEventListener('load', load);
  }
})();
