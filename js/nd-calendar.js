/* js/nd-calendar.js — NEPSE Calendar.
   One merged event feed built client-side from the site's own canonical files:
     /data/lockin.json            promoter lock-in ends (Capital Max transcription)
     /tools/nepse-holidays.json   market holidays (each entry carries its own status)
     /data/ipo.json               issue opening / closing / book-closure dates
   Nothing is duplicated or re-typed: when a source file changes, the calendar follows.
   Dates are handled as YYYY-MM-DD strings end to end (no timezone drift). */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function todayKey() { var t = new Date(); return key(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
  function parseK(k) { var p = k.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function weekday(k) { var p = parseK(k); return new Date(p.y, p.m - 1, p.d).getDay(); }
  function fmtNPT(iso) {
    var t = new Date(iso).getTime(); if (!isFinite(t)) return '';
    var n = new Date(t + 5.75 * 3600 * 1000);
    var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function p(x) { return ('0' + x).slice(-2); }
    return n.getUTCDate() + ' ' + M[n.getUTCMonth()] + ', ' + p(n.getUTCHours()) + ':' + p(n.getUTCMinutes()) + ' NPT';
  }
  function fmtDate(k) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = parseK(k); return p.d + ' ' + months[p.m - 1] + ' ' + p.y;
  }
  function fmtShares(n) {
    if (n == null || !isFinite(Number(n))) return '';
    n = Number(n);
    if (n >= 1e7) return (Math.round(n / 1e5) / 100) + ' crore';
    if (n >= 1e5) return (Math.round(n / 1e3) / 100) + ' lakh';
    return n.toLocaleString('en-IN');
  }
  function daysUntil(k) {
    var a = parseK(todayKey()), b = parseK(k);
    var ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
    return Math.round(ms / 86400000);
  }

  function bsOf(k) {
    if (!window.BSCal) return null;
    var p = parseK(k);
    try { return BSCal.adToBs(p.y, p.m, p.d); } catch (e) { return null; }
  }
  function bsFull(k) {
    var b = bsOf(k);
    if (!b || !window.BSCal) return '';
    return b.d + ' ' + BSCal.monthNames[b.m - 1] + ' ' + b.y + ' BS';
  }
  var CAT = {
    holiday: { label: 'Market holidays', color: '#D97706' },
    unlock: { label: 'Promoter unlocks', color: '#65A30D' },
    mfunlock: { label: 'MF & QII unlocks', color: '#8B5CF6' },
    issue: { label: 'IPO & issues', color: '#2563EB' },
    bookclose: { label: 'Book closes', color: '#0D9488' },
    dividend: { label: 'Dividends', color: '#DB2777' },
    other: { label: 'AGMs & other', color: '#64748B' }
  };
  var TYPE_MAP = {
    'public_holiday': ['holiday', 'Market holiday'],
    'lock_in_expiry': ['unlock', 'Promoter lock-in expires'],
    'issue_opens': ['issue', 'Issue opens'],
    'issue_closes': ['issue', 'Issue closes'],
    'book_close': ['bookclose', 'Book close'],
    'dividend': ['dividend', 'Dividend'],
    'agm': ['other', 'AGM'],
    'other_event': ['other', 'Event']
  };
  function bsLabel(iso) {
    if (!iso || !window.BSCal) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return (+p[2]) + ' ' + (BSCal.monthNames[+p[1] - 1] || '') + ' ' + p[0] + ' BS';
  }
  var CAT_KEYS = Object.keys(CAT);
  var ISSUE_LABEL = {
    'ipo': 'IPO', 'local-ipo': 'Local IPO', 'foreign-ipo': 'Foreign Employment IPO',
    'fpo': 'FPO', 'right-share': 'Right Share', 'auction': 'Auction', 'mutual-ipo': 'Mutual Fund IPO'
  };

  var events = [];            // {date, cat, type, title, symbol, bs, status, source, lines:[[k,v]..]}
  var byDate = {};            // date -> [events]
  var active = { holiday: true, unlock: true, mfunlock: true, issue: true, bookclose: true, dividend: true, other: true };
  var view = 'grid';
  var cursor = (function () { var t = parseK(todayKey()); return { y: t.y, m: t.m }; })();
  var selected = todayKey();
  var lockinRows = [];
  var meta = { lockinAsof: '', dbGenerated: '', dbCount: 0, lockinDated: 0, lockinTotal: 0 };

  function addEvent(e) {
    events.push(e);
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }

  function buildFrom(data) {
    var lockin = data.lockin;
    if (lockin && lockin.rows) {
      meta.lockinAsof = (lockin._meta && lockin._meta.captured) || lockin.asof || '';
      Object.keys(lockin.rows).forEach(function (sym) {
        var r = lockin.rows[sym];
        lockinRows.push(r);
        if (r.lockin_end_ad) meta.lockinDated++;
      });
      meta.lockinTotal = lockinRows.length;
    }
    var db = data.db;
    if (db && db.events) {
      meta.dbGenerated = db.generated_at || '';
      meta.dbCount = db.events.length;
      db.events.forEach(function (e) {
        var m = TYPE_MAP[e.type];
        if (!m || !e.date_ad) return;
        addEvent({
          date: e.date_ad, cat: m[0], type: m[1],
          title: e.title || (e.symbol || m[1]), symbol: e.symbol || '', bs: bsLabel(e.date_bs),
          status: e.verified === true ? 'Verified' : (e.verified === false ? 'Unverified' : ''),
          source: e.source || 'Nepse Decode calendar database',
          detail: e.detail || '',
          lines: [
            ['Units', e.units ? fmtShares(e.units) + ' units' : ''],
            ['Date (BS)', bsLabel(e.date_bs)]
          ]
        });
      });
    }
    if (data.mf && data.mf.rows) {
      Object.keys(data.mf.rows).forEach(function (sym) {
        var r = data.mf.rows[sym];
        if (!r.mf_lockin_end_ad) return;
        addEvent({
          date: r.mf_lockin_end_ad, cat: 'mfunlock', type: 'MF & QII lock-in ends',
          title: sym + ' MF / QII shares unlock', symbol: sym, bs: '',
          status: '', source: 'Nepse Alpha lock-in tracker (retrieved 2026-10-23)',
          lines: [
            ['Lock-in ends', fmtDate(r.mf_lockin_end_ad)],
            ['Listed on NEPSE', r.listed_date || ''],
            ['Promoter lock-in ends', r.promoter_lockin_end_ad ? fmtDate(r.promoter_lockin_end_ad) : '']
          ]
        });
      });
    }
    events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /* ---------------- rendering ---------------- */

  function visible(e) { return active[e.cat]; }
  function monthEvents(y, m) {
    return events.filter(function (e) { var p = parseK(e.date); return p.y === y && p.m === m && visible(e); });
  }

  function renderFilters() {
    var host = $('calFilters');
    if (!host) return;
    host.innerHTML = CAT_KEYS.map(function (ck) {
      var n = events.filter(function (e) { return e.cat === ck; }).length;
      return '<button type="button" class="cx-chip cal-fchip' + (active[ck] ? ' on' : '') + '" data-cat="' + ck + '" aria-pressed="' + active[ck] + '">' +
        '<span class="cal-dot" style="background:' + CAT[ck].color + '"></span>' + CAT[ck].label +
        ' <span class="cal-fcount">' + n + '</span></button>';
    }).join('');
    host.querySelectorAll('.cal-fchip').forEach(function (b) {
      b.addEventListener('click', function () {
        var ck = b.getAttribute('data-cat');
        active[ck] = !active[ck];
        renderAll();
      });
    });
  }

  function renderStats() {
    var host = $('calStats');
    if (!host) return;
    var y = cursor.y, m = cursor.m;
    var daysIn = new Date(y, m, 0).getDate();
    var trading = 0, i, k, wd;
    var holDates = {};
    events.forEach(function (e) { if (e.cat === 'holiday') holDates[e.date] = true; });
    for (i = 1; i <= daysIn; i++) {
      k = key(y, m, i); wd = weekday(k);
      if (wd >= 1 && wd <= 5 && !holDates[k]) trading++;
    }
    var me = monthEvents(y, m);
    var c = { holiday: 0, unlock: 0, mfunlock: 0, issue: 0, bookclose: 0, dividend: 0, other: 0 };
    me.forEach(function (e) { c[e.cat]++; });
    var cells = [
      ['Trading days', trading], ['Market holidays', c.holiday],
      ['Promoter unlocks', c.unlock],
      ['MF & QII unlocks', c.mfunlock], ['IPO & issue events', c.issue],
      ['Book closes & dividends', c.bookclose + c.dividend]
    ];
    host.innerHTML = cells.map(function (s) {
      return '<div class="cx-stat"><span class="cx-stat-v">' + s[1] + '</span><span class="cx-stat-l">' + s[0] + ' · this month</span></div>';
    }).join('');
  }

  function renderGrid() {
    var host = $('calGrid');
    if (!host) return;
    var y = cursor.y, m = cursor.m;
    var first = weekday(key(y, m, 1));
    var daysIn = new Date(y, m, 0).getDate();
    var prevDays = new Date(y, m - 1, 0).getDate();
    var html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) {
      return '<div class="cal-wd' + (d === 'Sat' || d === 'Sun' ? ' we' : '') + '">' + d + '</div>';
    }).join('');
    var cells = [];
    var i, d, k, wd;
    for (i = 0; i < first; i++) cells.push({ d: prevDays - first + 1 + i, out: true });
    for (d = 1; d <= daysIn; d++) cells.push({ d: d, out: false });
    while (cells.length % 7) cells.push({ d: cells.length - (first + daysIn) + 1, out: true });
    html += cells.map(function (c) {
      if (c.out) return '<div class="cal-cell out"><span class="cal-d">' + c.d + '</span></div>';
      k = key(y, m, c.d); wd = weekday(k);
      var evs = (byDate[k] || []).filter(visible);
      var isHol = evs.some(function (e) { return e.cat === 'holiday'; });
      var cls = 'cal-cell' + (wd === 0 || wd === 6 ? ' we' : '') + (isHol ? ' hol' : '') +
        (k === todayKey() ? ' today' : '') + (k === selected ? ' sel' : '');
      var marks = evs.slice(0, 2).map(function (e) {
        var lbl = e.cat === 'holiday' ? 'Holiday' : (e.symbol || e.type);
        return '<span class="cal-ev" style="--c:' + CAT[e.cat].color + '">' + esc(lbl) + '</span>';
      }).join('');
      if (evs.length > 2) marks += '<span class="cal-more">+' + (evs.length - 2) + ' more</span>';
      var bsd = bsOf(k);
      return '<button type="button" class="' + cls + '" data-date="' + k + '" aria-label="' + fmtDate(k) + (evs.length ? ', ' + evs.length + ' events' : '') + '">' +
        '<span class="cal-drow"><span class="cal-d">' + c.d + '</span>' + (bsd ? '<span class="cal-bsd">' + bsd.d + '</span>' : '') + '</span>' + marks + '</button>';
    }).join('');
    host.innerHTML = html;
    host.querySelectorAll('.cal-cell[data-date]').forEach(function (b) {
      b.addEventListener('click', function () {
        selected = b.getAttribute('data-date');
        renderGrid(); renderAgenda();
        var a = $('calAgenda'); if (a) a.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
  }

  function eventCard(e) {
    var du = daysUntil(e.date);
    var when = du === 0 ? 'Today' : du === 1 ? 'Tomorrow' : du > 1 ? 'In ' + du + ' days' : (-du) + ' days ago';
    var lines = e.lines.filter(function (l) { return l[1]; }).map(function (l) {
      return '<div class="cal-kv"><span>' + esc(l[0]) + '</span><strong>' + esc(l[1]) + '</strong></div>';
    }).join('');
    var sym = e.symbol ? ' · <a href="/stocks/' + esc(e.symbol) + '/">' + esc(e.symbol) + '</a>' : '';
    return '<article class="cx-card cal-card">' +
      '<div class="cal-card-top"><span class="cx-chip" style="--c:' + CAT[e.cat].color + '">' + esc(e.type) + '</span>' +
      '<span class="cal-when">' + when + '</span></div>' +
            '<h3>' + esc(e.title) + sym + '</h3>' +
      (e.detail ? '<p class="cal-detail">' + esc(e.detail) + '</p>' : '') + lines +
      '<p class="cal-src">Source: ' + esc(e.source) + (e.status ? ' · Status: ' + esc(e.status) : '') + '</p></article>';
  }

  function renderAgenda() {
    var host = $('calAgenda');
    if (!host) return;
    var evs = (byDate[selected] || []).filter(visible);
    var wd = weekday(selected);
    var head = '<div class="cx-cat-head">' + fmtDate(selected) + (bsFull(selected) ? ' · ' + bsFull(selected) : '') + (selected === todayKey() ? ' · Today' : '') + '</div>';
    var body;
    if (evs.length) body = evs.map(eventCard).join('');
    else if (wd === 0 || wd === 6) body = '<p class="cal-none">Market closed — weekend (Saturday–Sunday). No events on this day.</p>';
    else body = '<p class="cal-none">No calendar events — a regular trading day, unless a holiday notice says otherwise.</p>';
    host.innerHTML = head + body;

    var list = $('calList');
    if (list) {
      var me = monthEvents(cursor.y, cursor.m);
      list.innerHTML = '<div class="cx-cat-head">This month · agenda</div>' + (me.length
        ? me.map(function (e) {
            return '<button type="button" class="cal-ag-row" data-date="' + e.date + '">' +
              '<span class="cal-ag-d">' + esc(fmtDate(e.date)) + '</span>' +
              '<span class="cal-dot" style="background:' + CAT[e.cat].color + '"></span>' +
              '<span class="cal-ag-t">' + esc(e.title) + '</span></button>';
          }).join('')
        : '<p class="cal-none">No events this month in the selected categories.</p>');
      list.querySelectorAll('.cal-ag-row').forEach(function (b) {
        b.addEventListener('click', function () {
          selected = b.getAttribute('data-date');
          var p = parseK(selected); cursor = { y: p.y, m: p.m };
          renderAll();
        });
      });
    }
  }

  function renderComingUp() {
    var host = $('calUpcoming');
    if (!host) return;
    var t = todayKey();
    var next = events.filter(function (e) { return e.date >= t; }).slice(0, 6);
    host.innerHTML = '<div class="cx-cat-head">Coming up</div>' + (next.length
      ? next.map(function (e) {
          var du = daysUntil(e.date);
          return '<div class="cal-up-row"><span class="cal-dot" style="background:' + CAT[e.cat].color + '"></span>' +
            '<span class="cal-up-t">' + esc(e.title) + '</span>' +
            '<span class="cal-up-d">' + esc(fmtDate(e.date)) + (du === 0 ? ' · today' : du === 1 ? ' · tomorrow' : ' · in ' + du + 'd') + '</span></div>';
        }).join('')
      : '<p class="cal-none">Nothing scheduled in the current data.</p>');
  }

  function renderLockins() {
    var host = $('calLockinBody');
    if (!host) return;
    var rows = lockinRows.slice().sort(function (a, b) {
      return (a.lockin_end_ad || '9999') < (b.lockin_end_ad || '9999') ? -1 : 1;
    });
    host.innerHTML = rows.map(function (r) {
      var ends = r.lockin_end_ad
        ? '<button type="button" class="cal-jump" data-date="' + r.lockin_end_ad + '">' + fmtDate(r.lockin_end_ad) + '</button>' + (r.lockin_end_bs ? ' <span class="cal-bs">' + esc(r.lockin_end_bs) + ' BS</span>' : '')
        : '<span class="cal-bs">not published in source</span>';
      return '<tr><td><a class="symlink" href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a></td>' +
        '<td>' + esc(r.allotment_ad || '—') + '</td><td>' + ends + '</td>' +
        '<td class="num">' + esc(fmtShares(r.promoter_shares)) + '</td>' +
        '<td>' + esc(r.status || '—') + '</td></tr>';
    }).join('');
    host.querySelectorAll('.cal-jump').forEach(function (b) {
      b.addEventListener('click', function () {
        selected = b.getAttribute('data-date');
        var p = parseK(selected); cursor = { y: p.y, m: p.m };
        renderAll();
        var g = $('calGrid'); if (g) g.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
    var note = $('calLockinNote');
    if (note) note.textContent = meta.lockinDated + ' of ' + meta.lockinTotal +
      ' tracked companies have a published lock-in end date in the source file (Capital Max, transcribed ' +
      (meta.lockinAsof || '2026-10-05') + '). The rest are shown as “not published in source” — never guessed.';
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function renderTitle() {
    var t = $('calMonthTitle');
    if (t) t.textContent = MONTHS[cursor.m - 1] + ' ' + cursor.y;
  }
  function renderAll() { renderTitle(); renderFilters(); renderStats(); renderGrid(); renderAgenda(); }

  function wire() {
    var prev = $('calPrev'), next = $('calNext'), today = $('calToday');
    if (prev) prev.addEventListener('click', function () { cursor.m--; if (cursor.m < 1) { cursor.m = 12; cursor.y--; } renderAll(); });
    if (next) next.addEventListener('click', function () { cursor.m++; if (cursor.m > 12) { cursor.m = 1; cursor.y++; } renderAll(); });
    if (today) today.addEventListener('click', function () { var t = parseK(todayKey()); cursor = { y: t.y, m: t.m }; selected = todayKey(); renderAll(); });
    var seg = $('calViewSeg');
    if (seg) seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        view = b.getAttribute('data-view');
        seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        $('calGridWrap').style.display = view === 'grid' ? '' : 'none';
        $('calList').style.display = view === 'list' ? '' : 'none';
      });
    });
  }

  function get(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    Promise.all([get('/data/calendar-events.json'), get('/data/lockin-mf.json'), get('/data/lockin.json')])
      .then(function (res) {
        buildFrom({ db: res[0], mf: res[1], lockin: res[2] });
        renderAll(); renderComingUp(); renderLockins();
        var asof = $('calAsof');
        if (asof) asof.textContent = 'Events: ' + events.length + ' · calendar database generated ' + (meta.dbGenerated ? fmtNPT(meta.dbGenerated) : '—') +
          ' · MF & QII supplement retrieved 2026-10-23 · every event carries its own source and verified status';
      });
  });
})();
