/* Nepse Decode — NEPSE Calendar page logic.
 * Data: /data/calendar-events.json (built by tools/build-calendar-events.js).
 * BS math: /js/bs-calendar.js (window.BSCal, the site's verified converter).
 * Month switching is fully client-side; no page reloads. */
(function () {
  'use strict';

  var TYPES = {
    public_holiday: 'Public holiday',
    nepse_closed: 'NEPSE closed',
    issue_opens: 'Issue opens',
    issue_closes: 'Issue closes',
    lock_in_expiry: 'Lock-in expiry',
    book_close: 'Book close',
    agm: 'AGM',
    dividend: 'Dividend',
    other_event: 'Other event'
  };
  var AD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function adKey(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function fmtUnits(n) { return Number(n).toLocaleString('en-IN'); }

  var gridEl = document.getElementById('ncal-grid');
  var detailTitle = document.getElementById('ncal-detail-title');
  var detailBody = document.getElementById('ncal-detail-body');
  var monthBsEl = document.getElementById('ncal-month-bs');
  var monthAdEl = document.getElementById('ncal-month-ad');
  var metaEl = document.getElementById('ncal-meta');

  var byDate = {};       // date_ad -> [events]
  var allEvents = [];
  var minMonth = null, maxMonth = null; // {y, m} in BS
  var view = null;       // {y, m} currently displayed BS month
  var selected = null;   // date_ad string

  function todayBs() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var o = {};
      parts.forEach(function (p) { o[p.type] = p.value; });
      return window.BSCal.adToBs(+o.year, +o.month, +o.day);
    } catch (e) {
      var n = new Date();
      return window.BSCal.adToBs(n.getFullYear(), n.getMonth() + 1, n.getDate());
    }
  }
  function todayAdKey() {
    var t = todayBs();
    var ad = window.BSCal.bsToAd(t.y, t.m, t.d);
    return adKey(ad.y, ad.m, ad.d);
  }
  function monthIndex(y, m) { return y * 12 + (m - 1); }
  function cmpMonth(a, b) { return monthIndex(a.y, a.m) - monthIndex(b.y, b.m); }

  function renderLegend() {
    var el = document.getElementById('ncal-legend');
    el.innerHTML = Object.keys(TYPES).map(function (t) {
      return '<span class="ncal-legend-item ncal-cat-' + t + '"><span class="ncal-dot"></span>' + esc(TYPES[t]) + '</span>';
    }).join('');
  }

  function renderStats() {
    var ev = 0, hol = 0, clo = 0;
    Object.keys(byDate).forEach(function (k) {
      byDate[k].forEach(function (e) {
        var bs = e.date_bs.split('-');
        if (+bs[0] === view.y && +bs[1] === view.m) {
          ev++;
          if (e.type === 'public_holiday') hol++;
          if (e.type === 'nepse_closed') clo++;
        }
      });
    });
    document.getElementById('ncal-stat-events').textContent = ev;
    document.getElementById('ncal-stat-holidays').textContent = hol;
    document.getElementById('ncal-stat-closures').textContent = clo;
  }

  function renderUpcoming() {
    var el = document.getElementById('ncal-upcoming');
    var tKey = todayAdKey();
    var t = new Date(tKey + 'T00:00:00Z');
    var end = new Date(t.getTime() + 30 * 86400000);
    var endKey = end.toISOString().slice(0, 10);
    var ups = allEvents.filter(function (e) {
      return (e.type === 'public_holiday' || e.type === 'nepse_closed') && e.date_ad >= tKey && e.date_ad <= endKey;
    });
    if (!ups.length) { el.innerHTML = '<p class="ncal-muted">No exchange closures in the next 30 days.</p>'; return; }
    el.innerHTML = ups.map(function (e) {
      return '<button type="button" class="ncal-up-chip ncal-cat-' + e.type + '" data-goto="' + e.date_ad + '">' +
        '<span class="ncal-dot"></span>' +
        esc(e.title) + ' <span class="ncal-up-date">' + esc(e.date_bs) + ' BS &middot; ' + esc(e.date_ad) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { gotoDate(b.getAttribute('data-goto')); });
    });
  }

  function cellEvents(y, m, d) {
    var ad = window.BSCal.bsToAd(y, m, d);
    var key = adKey(ad.y, ad.m, ad.d);
    return { key: key, ad: ad, list: byDate[key] || [] };
  }

  function renderMonth() {
    var y = view.y, m = view.m;
    var days = window.BSCal.monthLen(y, m);
    var first = window.BSCal.bsToAd(y, m, 1);
    var last = window.BSCal.bsToAd(y, m, days);
    var firstDow = new Date(Date.UTC(first.y, first.m - 1, first.d)).getUTCDay();
    monthBsEl.textContent = window.BSCal.monthNames[m - 1] + ' ' + y + ' BS';
    monthAdEl.textContent = first.d + ' ' + AD_MONTHS[first.m - 1] + ' ' + first.y + ' – ' + last.d + ' ' + AD_MONTHS[last.m - 1] + ' ' + last.y;
    document.getElementById('ncal-prev').disabled = cmpMonth(view, minMonth) <= 0;
    document.getElementById('ncal-next').disabled = cmpMonth(view, maxMonth) >= 0;

    var html = '';
    for (var i = 0; i < firstDow; i++) html += '<div class="ncal-cell is-pad" aria-hidden="true"></div>';
    var tKey = todayAdKey();
    for (var d = 1; d <= days; d++) {
      var c = cellEvents(y, m, d);
      var dow = (firstDow + d - 1) % 7;
      var cls = 'ncal-cell';
      if (dow === 0 || dow === 6) cls += ' is-weekend';
      if (c.key === tKey) cls += ' is-today';
      if (c.key === selected) cls += ' is-selected';
      var chips = c.list.slice(0, 3).map(function (e) {
        var label = e.symbol ? (e.symbol + ' · ' + (TYPES[e.type] || e.type)) : e.title;
        return '<span class="ncal-chip ncal-cat-' + e.type + '">' + esc(label) + '</span>';
      }).join('');
      if (c.list.length > 3) chips += '<span class="ncal-more">+' + (c.list.length - 3) + ' more</span>';
      html += '<button type="button" class="' + cls + '" data-date="' + c.key + '" aria-label="' +
        esc(window.BSCal.monthNames[m - 1] + ' ' + d + ', ' + y + ' BS' + (c.list.length ? ' — ' + c.list.length + ' event' + (c.list.length > 1 ? 's' : '') : '')) + '">' +
        '<span class="ncal-dayline"><span class="ncal-bs">' + d + '</span><span class="ncal-ad">' + c.ad.d + ' ' + AD_MONTHS[c.ad.m - 1] + '</span></span>' +
        '<span class="ncal-chips">' + chips + '</span></button>';
    }
    gridEl.innerHTML = html;
    Array.prototype.forEach.call(gridEl.querySelectorAll('[data-date]'), function (b) {
      b.addEventListener('click', function () { selectDay(b.getAttribute('data-date'), false); });
    });
    renderStats();
  }

  function selectDay(dateAd, scroll) {
    selected = dateAd;
    var evs = byDate[dateAd] || [];
    var p = dateAd.split('-');
    var bs = window.BSCal.adToBs(+p[0], +p[1], +p[2]);
    var dow = new Date(dateAd + 'T00:00:00Z').getUTCDay();
    detailTitle.textContent = window.BSCal.monthNames[bs.m - 1] + ' ' + bs.d + ', ' + bs.y + ' BS · ' +
      (+p[2]) + ' ' + AD_MONTHS[+p[1] - 1] + ' ' + p[0] + ' · ' + WEEKDAYS[dow];
    if (!evs.length) {
      detailBody.innerHTML = '<p class="ncal-muted">No recorded events on this day.' +
        ((dow === 0 || dow === 6) ? ' It is a weekend — NEPSE is closed.' : '') + '</p>';
    } else {
      detailBody.innerHTML = evs.map(function (e) {
        var title = e.symbol
          ? '<a href="/stocks/' + esc(e.symbol) + '/">' + esc(e.title) + '</a>'
          : esc(e.title);
        var flags = '';
        if (e.type === 'lock_in_expiry' && !e.verified) flags += ' <span class="ncal-flag">Derived</span>';
        else if (!e.verified) flags += ' <span class="ncal-flag">Unverified</span>';
        var meta = [];
        if (e.units) meta.push(fmtUnits(e.units) + ' units');
        if (e.source) meta.push('Source: ' + e.source);
        return '<article class="ncal-event ncal-cat-' + e.type + '">' +
          '<div class="ncal-event-head"><span class="ncal-badge">' + esc(TYPES[e.type] || e.type) + '</span>' +
          '<span class="ncal-event-title">' + title + '</span>' + flags + '</div>' +
          (e.detail ? '<p class="ncal-event-detail">' + esc(e.detail) + '</p>' : '') +
          (meta.length ? '<p class="ncal-event-meta">' + esc(meta.join(' · ')) + '</p>' : '') +
          '</article>';
      }).join('');
    }
    Array.prototype.forEach.call(gridEl.querySelectorAll('.ncal-cell'), function (c) {
      c.classList.toggle('is-selected', c.getAttribute('data-date') === dateAd);
    });
    if (scroll) document.getElementById('ncal-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function gotoDate(dateAd) {
    var p = dateAd.split('-');
    var bs = window.BSCal.adToBs(+p[0], +p[1], +p[2]);
    view = { y: bs.y, m: bs.m };
    renderMonth();
    selectDay(dateAd, true);
  }

  function shiftMonth(delta) {
    var idx = monthIndex(view.y, view.m) + delta;
    var y = Math.floor(idx / 12), m = (idx % 12) + 1;
    var cand = { y: y, m: m };
    if (cmpMonth(cand, minMonth) < 0 || cmpMonth(cand, maxMonth) > 0) return;
    view = cand;
    renderMonth();
  }

  document.getElementById('ncal-prev').addEventListener('click', function () { shiftMonth(-1); });
  document.getElementById('ncal-next').addEventListener('click', function () { shiftMonth(1); });
  document.getElementById('ncal-today').addEventListener('click', function () { gotoDate(todayAdKey()); });

  fetch('/data/calendar-events.json', { credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (doc) {
      allEvents = doc.events || [];
      allEvents.forEach(function (e) { (byDate[e.date_ad] = byDate[e.date_ad] || []).push(e); });
      if (!allEvents.length) throw new Error('empty dataset');
      var first = allEvents[0].date_bs.split('-'), last = allEvents[allEvents.length - 1].date_bs.split('-');
      minMonth = { y: +first[0], m: +first[1] };
      maxMonth = { y: +last[0], m: +last[1] };
      var t = todayBs();
      view = { y: t.y, m: t.m };
      if (cmpMonth(view, minMonth) < 0) view = minMonth;
      if (cmpMonth(view, maxMonth) > 0) view = maxMonth;
      metaEl.textContent = allEvents.length + ' events · ' + doc.date_range[0] + ' to ' + doc.date_range[1] +
        ' · data built ' + String(doc.generated_at || '').slice(0, 10);
      renderLegend();
      renderMonth();
      renderUpcoming();
      selectDay(todayAdKey(), false);
    })
    .catch(function (err) {
      metaEl.textContent = 'Calendar data could not be loaded (' + err.message + '). Please reload the page.';
      document.getElementById('ncal-upcoming').innerHTML = '';
    });
})();
