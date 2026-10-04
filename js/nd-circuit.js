/**
 * js/nd-circuit.js — Circuit Watch page.
 * Reads /nepse-chart/data/live.json and lists securities at or near
 * NEPSE's ±10% circuit limit. REAL data only — no mock figures.
 *
 * Bands:
 *   hit   : |%chg| >= 10%
 *   near  : 9% <= |%chg| < 10%
 *   watch : 8% <= |%chg| < 9%
 *
 * Polls every 30s during market hours (Mon–Fri 11:00–15:00 NPT),
 * every 5 minutes outside hours. All timestamps are the DATA's own
 * timestamp (NPT), never the fetch time presented as market time.
 */
(function () {
  'use strict';

  var LIVE_URL = '/nepse-chart/data/live.json';
  var CIRCUIT_PCT = 10;
  var NEAR_PCT = 9;
  var WATCH_PCT = 8;
  var POLL_OPEN_MS = 30 * 1000;
  var POLL_CLOSED_MS = 5 * 60 * 1000;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // True trading session date: derived from market-data timestamps, NOT the fetch time.
  function getSessionDate(live) {
    if (live && live.data_asof) return new Date(live.data_asof);
    var ts = null;
    if (live) {
      var idx = live.indices || [];
      for (var i = 0; i < idx.length; i++) {
        if (idx[i] && idx[i].last_updated) {
          var t = new Date(idx[i].last_updated).getTime();
          if (isFinite(t) && (ts == null || t > ts)) ts = t;
        }
      }
      if (ts == null) {
        var qs = live.quotes || [];
        for (var j = 0; j < qs.length; j++) {
          if (qs[j] && qs[j].last_updated) {
            var t2 = new Date(qs[j].last_updated).getTime();
            if (isFinite(t2) && (ts == null || t2 > ts)) ts = t2;
          }
        }
      }
    }
    if (ts != null) return new Date(ts);
    return live && live.asof ? new Date(live.asof) : new Date();
  }
  function fmtNum(v, dp) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* NPT "now": minutes since midnight in Asia/Kathmandu */
  function nptNow() {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit',
        weekday: 'short', hour12: false
      }).formatToParts(new Date());
      var h = 0, m = 0, wd = '';
      parts.forEach(function (p) {
        if (p.type === 'hour') h = Number(p.value);
        if (p.type === 'minute') m = Number(p.value);
        if (p.type === 'weekday') wd = p.value;
      });
      return { mins: h * 60 + m, weekday: wd };
    } catch (e) { return { mins: -1, weekday: '' }; }
  }

  function marketOpen() {
    var n = nptNow();
    var tradingDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(n.weekday) !== -1;
    return tradingDay && n.mins >= 660 && n.mins < 900; /* 11:00–15:00 NPT */
  }

  function sessLabel(live) {
    try {
      var raw = getSessionDate(live).toISOString();
      if (!raw) return 'session date unavailable';
      var d = new Date(raw);
      return 'Session of ' + d.toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kathmandu'
      });
    } catch (e) { return 'session date unavailable'; }
  }

  function dataAge(live) {
    try {
      var raw = live.data_asof || live.asof;
      if (!raw) return 'unknown age';
      var ms = Date.now() - new Date(raw).getTime();
      if (ms < 0) return 'just now';
      var min = Math.floor(ms / 60000);
      if (min < 1) return 'under a minute old';
      if (min < 60) return min + ' min old';
      var h = Math.floor(min / 60);
      return h + 'h ' + (min % 60) + 'm old';
    } catch (e) { return 'unknown age'; }
  }

  function row(q, dir) {
    var pct = Number(q.percent_change);
    var dist = (CIRCUIT_PCT - Math.abs(pct)).toFixed(2);
    var abs = Math.abs(pct);
    var status, cls;
    if (abs >= CIRCUIT_PCT) {
      status = dir === 'up' ? 'Circuit hit' : 'Circuit hit';
      cls = dir === 'up' ? 'hit-up' : 'hit-dn';
    } else if (abs >= NEAR_PCT) {
      status = 'Approaching';
      cls = dir === 'up' ? 'near-up' : 'near-dn';
    } else {
      status = 'On watch';
      cls = dir === 'up' ? 'near-up' : 'near-dn';
    }
    var chgCls = pct > 0 ? 'cw-up' : pct < 0 ? 'cw-dn' : '';
    var arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '·';
    return '<tr>' +
      '<td class="cw-sym"><a href="/stocks/' + esc(q.symbol) + '/">' + esc(q.symbol) + '</a>' +
        '<span class="cw-name">' + esc(q.name || '') + '</span></td>' +
      '<td class="num">' + fmtNum(q.ltp) + '</td>' +
      '<td class="num ' + chgCls + '">' + arrow + ' ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</td>' +
      '<td class="num">' + dist + ' pts</td>' +
      '<td><span class="cw-status ' + cls + '">' + status + '</span></td>' +
      '<td class="cw-sess">' + esc(sessLabel(window.__cwLive || {})) + '</td>' +
      '</tr>';
  }

  function emptyRow(msg) {
    return '<tr><td colspan="6" class="cw-empty">' + esc(msg) + '</td></tr>';
  }

  function render(live) {
    window.__cwLive = live;
    var quotes = (live && live.quotes) || [];
    var up = [], dn = [];

    quotes.forEach(function (q) {
      var pct = Number(q.percent_change);
      if (!isFinite(pct)) return;
      if (pct >= WATCH_PCT) up.push(q);
      else if (pct <= -WATCH_PCT) dn.push(q);
    });

    up.sort(function (a, b) { return b.percent_change - a.percent_change; });
    dn.sort(function (a, b) { return a.percent_change - b.percent_change; });

    var upBody = $('cwUpBody'), dnBody = $('cwDnBody');
    if (upBody) upBody.innerHTML = up.length ? up.map(function (q) { return row(q, 'up'); }).join('') : emptyRow('No stocks near the upper circuit.');
    if (dnBody) dnBody.innerHTML = dn.length ? dn.map(function (q) { return row(q, 'dn'); }).join('') : emptyRow('No stocks near the lower circuit.');

    var upCount = $('cwUpCount'), dnCount = $('cwDnCount');
    if (upCount) upCount.textContent = up.length + ' in zone';
    if (dnCount) dnCount.textContent = dn.length + ' in zone';

    /* Calm state: nothing within 2 pts of a circuit */
    var calm = $('cwCalm');
    if (calm) calm.hidden = (up.length + dn.length) > 0;

    /* Alert banner when any circuit is hit */
    var alert = $('cwAlert');
    var hitsUp = up.filter(function (q) { return Math.abs(Number(q.percent_change)) >= CIRCUIT_PCT; });
    var hitsDn = dn.filter(function (q) { return Math.abs(Number(q.percent_change)) >= CIRCUIT_PCT; });
    if (alert) {
      if (hitsUp.length || hitsDn.length) {
        alert.hidden = false;
        alert.className = 'cw-alert cw-alert-hit';
        var bits = [];
        if (hitsUp.length) bits.push('<strong>' + hitsUp.length + '</strong> at the upper circuit (' + hitsUp.map(function (q) { return esc(q.symbol); }).join(', ') + ')');
        if (hitsDn.length) bits.push('<strong>' + hitsDn.length + '</strong> at the lower circuit (' + hitsDn.map(function (q) { return esc(q.symbol); }).join(', ') + ')');
        alert.innerHTML = '⚠ Circuit activity: ' + bits.join(' · ') + ' in the latest snapshot.';
      } else if (up.length || dn.length) {
        alert.hidden = false;
        alert.className = 'cw-alert';
        alert.innerHTML = 'Eye on the band: <strong>' + (up.length + dn.length) + '</strong> ' +
          (up.length + dn.length === 1 ? 'stock is' : 'stocks are') +
          ' within 2 points of a circuit limit. No circuit hit in the latest snapshot.';
      } else {
        alert.hidden = true;
      }
    }

    /* Meta line */
    var sess = $('cwSession'), poll = $('cwPoll');
    if (sess) sess.textContent = sessLabel(live) + ' · data ' + dataAge(live) + ' (delayed public feed)';
    if (poll) {
      poll.textContent = marketOpen()
        ? 'Auto-refresh every 30s (market open)'
        : 'Auto-refresh every 5 min (market closed)';
    }
  }

  function fail(err) {
    var msg = 'Could not load circuit data. ' + (err && err.message ? esc(err.message) : '');
    ['cwUpBody', 'cwDnBody'].forEach(function (id) {
      var el = $(id);
      if (el) el.innerHTML = '<tr><td colspan="6" class="cw-empty">' + msg + ' Will retry automatically.</td></tr>';
    });
  }

  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, marketOpen() ? POLL_OPEN_MS : POLL_CLOSED_MS);
  }
  function tick() {
    fetchJSON(LIVE_URL).then(function (live) {
      render(live);
      schedule();
    }).catch(function (err) {
      fail(err);
      schedule();
    });
  }

  function init() {
    if (!$('cwUpBody') && !$('cwDnBody')) return;
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
