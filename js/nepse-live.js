/* NEPSE Alpha Lab  -  shared live-data layer (Wave 7).
 *
 * One data path for the suite's live figures. The own 15-minute official
 * snapshot lives at /nepse-chart/data/live.json (refreshed by the
 * nepse-live-quotes workflow during trading). When it is missing or stale
 * Live quotes come from our own market snapshot (nepse-chart/data/live.json,
 * refreshed by the nepse-live-quotes workflow). When the snapshot is missing
 * or stale, the page shows an honest delayed/closed state instead of
 * borrowing another site's feed.
 * A market snapshot (daily batch + live overlay) is the single source the
 * alpha, dashboard, sectors and reports pages render from. Nothing here
 * invents a price; when data is stale or absent, we say so.
 *
 * Exposes window.NepseLive. No dependencies.
 */
(function () {
  'use strict';

  var OWN = '/nepse-chart/data/live.json';
  var WAVE1 = '/nepse-chart/data/wave1.json';
  var STALE_MIN = 20;      // in-session staleness threshold for the DELAYED badge
  var POLL_MS = 60000;     // same-origin poll cadence during market hours
  var FETCH_TIMEOUT = 15000;
  var NPT = 5.75 * 3600 * 1000;

  /* ---------------- time ---------------- */

  function nowNPT() { return new Date(Date.now() + NPT); }

  // NEPSE schedule (Nepal time), Monday to Friday:
  //   pre-open 10:45-11:00, regular session 11:00-15:00.
  // Yesterday's close is the reference through pre-open; live overlays
  // engage when the regular session starts.
  function marketState() {
    var t = nowNPT();
    var d = t.getUTCDay(); // 0 = Sunday
    var mins = t.getUTCHours() * 60 + t.getUTCMinutes();
    if (d < 1 || d > 5) return 'closed';
    if (mins >= 645 && mins < 660) return 'preopen';
    if (mins >= 660 && mins < 900) return 'open';
    return 'closed';
  }

  // Regular session only. Kept for overlay gating: pre-open keeps showing
  // the last close as the opening reference.
  function isMarketHours() { return marketState() === 'open'; }

  // Offsetless stamps are NPT (nepse-chart/data/live.json convention).
  function parseT(s) {
    var t = String(s || '').trim();
    if (!t) return NaN;
    if (!(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t))) t += '+05:45';
    return new Date(t).getTime();
  }

  function relAge(ageMin) {
    if (!(ageMin >= 0)) return '';
    if (ageMin < 1) return 'just now';
    if (ageMin < 60) return Math.floor(ageMin) + 'm ago';
    var h = Math.floor(ageMin / 60);
    if (h < 24) return h + 'h ' + (Math.floor(ageMin) % 60) + 'm ago';
    return Math.floor(h / 24) + 'd ago';
  }

  // Milliseconds until the next 15-minute refresh boundary (:00 :15 :30 :45 NPT).
  function msToNextRefresh() {
    var t = nowNPT();
    var mins = t.getUTCHours() * 60 + t.getUTCMinutes();
    var next = (Math.floor(mins / 15) + 1) * 15;
    var day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    var diff = day + next * 60000 - NPT - Date.now();
    return diff > 0 ? diff : 0;
  }

  function countdownText() {
    var s = Math.max(0, Math.round(msToNextRefresh() / 1000));
    var m = Math.floor(s / 60);
    return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }

  /* ---------------- fetch ---------------- */

  function fetchJSON(url) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('timeout')); }
      }, FETCH_TIMEOUT);
      fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!done) { done = true; clearTimeout(timer); resolve(j); }
      }).catch(function (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      });
    });
  }

  /* ---------------- normalization ---------------- */

  function num(v) { v = Number(v); return isFinite(v) ? v : null; }

  function fromOwn(j) {
    var quotes = {};
    ((j && j.quotes) || []).forEach(function (q) {
      if (!q || !q.symbol) return;
      quotes[q.symbol] = {
        ltp: num(q.ltp), change: num(q.change), pct: num(q.percent_change),
        high: num(q.high), low: num(q.low), volume: num(q.volume),
        turnover: num(q.turnover),
        prev: num(q.previous_close), updated: q.last_updated || null,
        name: q.name || null
      };
    });
    var ix = (j && j.index) || null;
    return {
      source: 'own',
      asof: parseT(j && j.asof),
      index: ix ? {
        value: num(ix.value), change: num(ix.change), pct: num(ix.percent_change),
        high: num(ix.high), low: num(ix.low), prev: num(ix.previous_close),
        updated: ix.last_updated || null
      } : null,
      quotes: quotes
    };
  }

  // Live quotes. Own snapshot only; when it is missing, empty, or stale
  // during market hours the page shows an honest delayed/closed state.
  function loadLive() {
    return fetchJSON(OWN).then(function (j) {
      var d = fromOwn(j);
      var n = Object.keys(d.quotes).length;
      if (!n || !(d.asof >= 0)) throw new Error('own feed unusable');
      var ageMin = (Date.now() - d.asof) / 60000;
      if (isMarketHours() && ageMin > STALE_MIN) throw new Error('own feed stale');
      return d;
    }).catch(function () { return null; });
  }

  function statusOf(d) {
    if (!d) return { state: 'unknown', ageMin: null, source: null };
    var ageMin = (Date.now() - d.asof) / 60000;
    var ms = marketState();
    if (ms === 'closed') return { state: 'closed', ageMin: ageMin, source: d.source };
    // Pre-open: the last closed snapshot is the valid opening reference,
    // never "stale".
    if (ms === 'preopen') return { state: 'preopen', ageMin: ageMin, source: d.source };
    if (d.source !== 'own' || !(ageMin >= 0) || ageMin > STALE_MIN) {
      return { state: 'delayed', ageMin: ageMin, source: d.source };
    }
    return { state: 'live', ageMin: ageMin, source: d.source };
  }

  function badgeHTML(st) {
    var state = (st && st.state) || 'unknown';
    var cls = state === 'live' ? 'live' : state === 'delayed' ? 'delayed' :
              state === 'preopen' ? 'preopen' : 'closed';
    var label = state === 'live' ? 'LIVE' : state === 'delayed' ? 'DELAYED' :
                state === 'preopen' ? 'PRE-OPEN' : 'CLOSED';
    var dot = state === 'live' ? '<span class="nlv-dot" aria-hidden="true"></span>' : '';
    var sub = '';
    if (state === 'closed') {
      sub = '<span class="nlv-sub">market closed</span>';
    } else if (state === 'preopen') {
      sub = '<span class="nlv-sub">opens 11:00 NPT · last close as reference</span>';
    } else if (state === 'live') {
      sub = '<span class="nlv-sub">updated ' + relAge(st.ageMin) +
            ' · refresh in <span data-nlv-cd>' + countdownText() + '</span></span>';
    } else if (state === 'delayed') {
      var age = st.ageMin != null && st.ageMin >= 0 ? 'updated ' + relAge(st.ageMin) + ' · ' : '';
      sub = '<span class="nlv-sub">' + age + 'refresh in <span data-nlv-cd>' +
            countdownText() + '</span></span>';
    } else {
      sub = '<span class="nlv-sub">feed unavailable</span>';
    }
    return '<span class="nlv-badge ' + cls + '" role="status">' + dot + label + '</span>' + sub;
  }

  function tickCountdowns() {
    var els = document.querySelectorAll('[data-nlv-cd]');
    for (var i = 0; i < els.length; i++) els[i].textContent = countdownText();
  }

  /* ---------------- snapshot data path ----------------
   * One combined payload: the daily batch (wave1.json) plus the live
   * overlay when fresh. Pages render from this, never from ad-hoc fetches.
   */
  function loadSnapshot() {
    return Promise.all([
      fetchJSON(WAVE1).catch(function () { return null; }),
      loadLive()
    ]).then(function (res) {
      var wave = res[0], live = res[1];
      var batch = (wave && wave.market) || null;
      var snap = {
        batch: batch,
        batchAsof: wave ? (wave.asof || (batch && batch.date) || null) : null,
        live: live
      };
      if (live && batch) {
        // Live in-session breadth from the quote tape (subset of the tape,
        // labeled as such wherever it is shown).
        var adv = 0, dec = 0, n = 0;
        var ks = Object.keys(live.quotes);
        for (var i = 0; i < ks.length; i++) {
          var q = live.quotes[ks[i]];
          var c = q.change;
          if (c == null && q.ltp != null && q.prev != null) c = q.ltp - q.prev;
          if (c > 0) adv++; else if (c < 0) dec++;
          n++;
        }
        snap.liveBreadth = { adv: adv, dec: dec, n: n };
      }
      return snap;
    });
  }

  /* ---------------- polling ---------------- */

  // opts: { el, onData(live, status), poll }
  // Polls the live feed every minute during market hours and repaints the
  // badge. Pages use onData to update figures in place (no reload).
  function start(opts) {
    opts = opts || {};
    var el = typeof opts.el === 'string' ? document.getElementById(opts.el) : (opts.el || null);
    var last = null;

    function paint(status) {
      if (el) el.innerHTML = badgeHTML(status);
      tickCountdowns();
    }

    function tick() {
      loadLive().then(function (d) {
        last = d;
        var st = statusOf(d);
        paint(st);
        if (typeof opts.onData === 'function') { try { opts.onData(d, st); } catch (e) {} }
      }).catch(function () {
        paint({ state: 'unknown', ageMin: null });
      });
    }

    tick();
    var timer = setInterval(function () {
      if (document.hidden) return;
      var ms = marketState();
      if (ms === 'open' || ms === 'preopen') tick();
      else paint(statusOf(last)); // keep the CLOSED badge honest outside hours
    }, opts.poll || POLL_MS);
    var cd = setInterval(tickCountdowns, 1000);

    return {
      refresh: tick,
      stop: function () { clearInterval(timer); clearInterval(cd); }
    };
  }

  window.NepseLive = {
    isMarketHours: isMarketHours,
    marketState: marketState,
    nowNPT: nowNPT,
    parseT: parseT,
    relAge: relAge,
    loadLive: loadLive,
    loadSnapshot: loadSnapshot,
    statusOf: statusOf,
    badgeHTML: badgeHTML,
    start: start
  };
})();
