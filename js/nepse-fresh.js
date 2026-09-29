/* NEPSE Alpha Lab: relative-time freshness labels.
   NepseFresh.label('2026-09-28') -> 'updated yesterday'
   NepseFresh.badge(iso) -> '<span class="fresh">updated 3h ago</span>' (or '')
   Date-only asof values are read as the START of that day in NPT, so the
   label never claims the data is fresher than it is. */
(function () {
  'use strict';
  function parseT(s) {
    if (!s) return 0;
    s = String(s).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+05:45');
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }
  function label(s) {
    var t = parseT(s);
    if (!t) return '';
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'updated just now';
    if (mins < 60) return 'updated ' + mins + 'm ago';
    var h = Math.floor(mins / 60);
    if (h < 24) return 'updated ' + h + 'h ago';
    var d = Math.floor(h / 24);
    if (d === 1) return 'updated yesterday';
    return 'updated ' + d + ' days ago';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function badge(s) {
    var l = label(s);
    return l ? '<span class="fresh">' + esc(l) + '</span>' : '';
  }
  window.NepseFresh = { label: label, badge: badge, parse: parseT };
})();
