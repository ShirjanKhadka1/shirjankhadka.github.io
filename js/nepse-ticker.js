/* NEPSE index ticker for the blog page.
 *
 * Primary source: the same-origin snapshot written every ~15 min by
 * tools/fetch-nepse-live.js (nepse-chart/data/live.json). Renders an
 * infinite marquee of NEPSE + sub-index closing values, in the same motion
 * language as the site's expertise ticker.
 *
 * Real-time layer (opportunistic): after the 15-min baseline renders, a
 * websocket to the free nepseapi-unofficial host is tried during NEPSE
 * trading hours (Mon-Fri 11:00-15:00 NPT). The host carries explicit
 * no-uptime guarantees and was unreachable when last checked, so it is
 * strictly a bonus: on a valid index push the chips update and the label
 * switches to LIVE; on error/timeout/close/invalid data the ticker keeps
 * the 15-min snapshot silently. The label always reflects reality.
 *
 * Fails silent: if the snapshot is missing, stale, or unparseable, the
 * ticker stays hidden. It never breaks the page and never shows zeros
 * or placeholders as real data. Client-side code must NEVER call
 * nepalstock.com directly (CORS + aggressive rate limits); the
 * same-origin snapshot is the only guaranteed data source.
 */
(function () {
  'use strict';

  var WRAP_ID = 'indexTickerWrap';
  var TRACK_ID = 'indexTickerTrack';
  var NOTE_ID = 'indexTickerNote';
  var LIVE_URL = '/nepse-chart/data/live.json';
  var REFRESH_MS = 15 * 60 * 1000;
  var STALE_MS = 72 * 60 * 60 * 1000; // hide if snapshot older than 72h
  var UP = '▲';
  var DOWN = '▼';
  var SEP = '·';

  // --- Real-time websocket (opportunistic, never required) ---
  var WS_URL = 'wss://nepseapiws.surajrimal.dev/';
  var WS_CONNECT_TIMEOUT_MS = 8000; // give up if no valid push this long
  var WS_POLL_MS = 60 * 1000;       // re-request while the socket is open
  var WS_STALE_MS = 3 * 60 * 1000;  // no push this long -> back to snapshot
  var WS_WATCHDOG_MS = 60 * 1000;
  var WS_BASE_BACKOFF_MS = 5000;
  var WS_MAX_BACKOFF_MS = 5 * 60 * 1000;
  var TRADING_START_MIN = 10 * 60 + 45;  // NPT minutes: pre-open 10:45, regular 11:00
  var TRADING_END_MIN = 15 * 60;

  // Official index name -> short display label, mirroring
  // tools/fetch-nepse-live.js so websocket chips match the baseline.
  var WS_NAME_ALIASES = {
    'nepse index': 'NEPSE',
    'sensitive index': 'Sensitive',
    'float index': 'Float',
    'sensitive float index': 'Sensitive Float',
    'banking subindex': 'Banking',
    'development bank index': 'Development Bank',
    'hotels and tourism index': 'Hotels & Tourism',
    'finance index': 'Finance',
    'microfinance index': 'Microfinance',
    'life insurance': 'Life Insurance',
    'non life insurance': 'Non-Life Insurance',
    'non-life insurance': 'Non-Life Insurance',
    'hydropower index': 'Hydropower',
    'hydro power index': 'Hydropower',
    'investment index': 'Investment',
    'manufacturing and processing': 'Manufacturing',
    'trading index': 'Trading',
    'others index': 'Others',
    'mutual fund': 'Mutual Fund'
  };

  var baselineOk = false;
  var ws = null;
  var wsPollTimer = null;
  var wsConnectTimer = null;
  var lastPushAt = 0;
  var lastAttemptAt = 0;
  var backoffMs = WS_BASE_BACKOFF_MS;

  // Indian-style digit grouping: 2613.33 -> "2,613.33"
  function fmt(n) {
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Snapshot stamps are UTC ISO (asof). Only used for the "as of" label.
  function nptClock(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var npt = new Date(d.getTime() + (5 * 60 + 45) * 60000);
    var hh = String(npt.getUTCHours());
    var mm = String(npt.getUTCMinutes());
    return (hh.length < 2 ? '0' + hh : hh) + ':' + (mm.length < 2 ? '0' + mm : mm);
  }

  function nptClockNow() {
    return nptClock(new Date(Date.now()).toISOString());
  }

  function validItem(it) {
    return it && typeof it.name === 'string' && it.name.length > 0 &&
      typeof it.value === 'number' && isFinite(it.value) &&
      typeof it.change === 'number' && isFinite(it.change);
  }

  // All untrusted strings go through textContent only; no innerHTML anywhere.
  function chipEl(it) {
    var span = document.createElement('span');
    span.className = 'tick-item';
    var strong = document.createElement('strong');
    strong.textContent = it.name;
    span.appendChild(strong);
    span.appendChild(document.createTextNode(' ' + fmt(it.value) + ' '));
    var b = document.createElement('b');
    b.className = it.change > 0 ? 'tick-up' : (it.change < 0 ? 'tick-down' : 'tick-flat');
    var glyph = it.change > 0 ? UP + ' ' : (it.change < 0 ? DOWN + ' ' : '');
    var pct = (typeof it.percent_change === 'number' && isFinite(it.percent_change))
      ? ' (' + Math.abs(it.percent_change).toFixed(2) + '%)' : '';
    b.textContent = glyph + fmt(Math.abs(it.change)) + pct;
    span.appendChild(b);
    return span;
  }

  function sepEl() {
    var sep = document.createElement('span');
    sep.className = 'tick-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = SEP;
    return sep;
  }

  // One render pass, one source. `note` is the honest source label.
  function render(items, note) {
    items = items.filter(validItem);
    if (items.length === 0) return false;
    var track = document.getElementById(TRACK_ID);
    var wrap = document.getElementById(WRAP_ID);
    var noteEl = document.getElementById(NOTE_ID);
    if (!track || !wrap) return false;
    while (track.firstChild) track.removeChild(track.firstChild);
    var g1 = document.createElement('div');
    g1.className = 'ticker-group';
    var g2 = document.createElement('div');
    g2.className = 'ticker-group';
    g2.setAttribute('aria-hidden', 'true');
    items.forEach(function (it) {
      g1.appendChild(chipEl(it));
      g1.appendChild(sepEl());
      g2.appendChild(chipEl(it));
      g2.appendChild(sepEl());
    });
    track.appendChild(g1);
    track.appendChild(g2);
    if (noteEl && note) noteEl.textContent = note;
    wrap.hidden = false;
    return true;
  }

  function sessionDateLabel(iso) {
    // "2026-09-29T15:00:00+05:45" -> "Sep 29" (NPT calendar date)
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var npt = new Date(d.getTime() + (5 * 60 + 45) * 60000);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[npt.getUTCMonth()] + ' ' + npt.getUTCDate();
  }

  function renderSnapshot(data) {
    if (!data || !Array.isArray(data.indices) || data.indices.length === 0) return false;
    if (typeof data.asof === 'string') {
      var age = Date.now() - new Date(data.asof).getTime();
      if (!isFinite(age) || age < 0 || age > STALE_MS) return false;
    }
    // When the market is closed the snapshot is the last session's close:
    // label it as the 3:00 PM close, never as a stale intraday time.
    var closed = data.market === 'CLOSED' || data.close === true || !inTradingHours();
    var note;
    if (closed) {
      var dstr = typeof data.asof === 'string' ? sessionDateLabel(data.asof) : null;
      note = 'Market closed' + SEP + ' as of ' + (dstr ? dstr + ', ' : '') + '3:00 PM NPT';
    } else {
      var clock = typeof data.asof === 'string' ? nptClock(data.asof) : null;
      note = 'As of ' + (clock || '--:--') + ' NPT ' + SEP + ' 15-min delayed';
    }
    return render(data.indices, note);
  }

  function renderLive(items) {
    var clock = nptClockNow();
    return render(items, 'LIVE ' + SEP + ' as of ' + (clock || '--:--') + ' NPT');
  }

  function load() {
    // Live pushes are fresher than the snapshot: never let the 15-min
    // poll clobber them or flip the label back while they are fresh.
    if (Date.now() - lastPushAt < WS_STALE_MS) return;
    var slot = Math.floor(Date.now() / REFRESH_MS); // cache-bust per 15-min slot
    fetch(LIVE_URL + '?t=' + slot, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (renderSnapshot(data)) {
          baselineOk = true;
        } else {
          // Stale/unparseable: hide only if no live data is on screen.
          var wrap = document.getElementById(WRAP_ID);
          if (wrap && Date.now() - lastPushAt >= WS_STALE_MS) wrap.hidden = true;
        }
      })
      .catch(function () { /* network error: keep last good state, stay silent */ });
  }

  // ---------- Trading-hours gate (NEPSE: Mon-Fri 11:00-15:00 NPT) ----------
  function inTradingHours() {
    var npt = new Date(Date.now() + (5 * 60 + 45) * 60000);
    var day = npt.getUTCDay(); // 0 = Sunday
    if (day === 0 || day === 6) return false;
    var mins = npt.getUTCHours() * 60 + npt.getUTCMinutes();
    return mins >= TRADING_START_MIN && mins < TRADING_END_MIN;
  }

  // ---------- Defensive websocket payload parsing ----------
  function numOrNull(v) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  function pickNum(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (o[keys[i]] !== undefined && o[keys[i]] !== null) {
        var n = numOrNull(o[keys[i]]);
        if (n !== null) return n;
      }
    }
    return null;
  }

  function cleanName(s) {
    if (typeof s !== 'string') return '';
    var t = s.replace(/:\s*$/, '').replace(/\s+/g, ' ').trim();
    if (t.length === 0 || t.length > 80) return '';
    var low = t.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(WS_NAME_ALIASES, low)) {
      return WS_NAME_ALIASES[low];
    }
    return t;
  }

  // Accepts the documented {"route":"NepseIndex"} response in several
  // plausible shapes; returns null for anything unexpected.
  function parseWsIndices(raw) {
    var src = raw;
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      if (src.data && typeof src.data === 'object') src = src.data;
      else if (src.result && typeof src.result === 'object') src = src.result;
    }
    var entries = [];
    if (Array.isArray(src)) {
      src.forEach(function (e) {
        if (e && typeof e === 'object' && !Array.isArray(e)) entries.push(e);
      });
    } else if (src && typeof src === 'object') {
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          var e = {};
          for (var p in v) {
            if (Object.prototype.hasOwnProperty.call(v, p)) e[p] = v[p];
          }
          if (typeof e.name !== 'string' && typeof e.index !== 'string') e.name = k;
          entries.push(e);
        }
      });
    } else {
      return null;
    }
    var items = [];
    entries.forEach(function (e) {
      var name = cleanName(typeof e.name === 'string' ? e.name : e.index);
      if (!name) return;
      var value = pickNum(e, ['currentValue', 'current_value', 'value', 'lastValue', 'last_value']);
      var prev = pickNum(e, ['previousClose', 'previous_close', 'prevClose', 'prev_close']);
      var change = pickNum(e, ['change', 'changeValue', 'change_value']);
      var pct = pickNum(e, ['perChange', 'per_change', 'percentChange', 'percent_change', 'changePercent']);
      if (value === null) return;
      if (change === null && prev !== null) change = Math.round((value - prev) * 100) / 100;
      if (pct === null && prev) pct = Math.round((change / prev) * 10000) / 100;
      if (change === null) return;
      items.push({
        name: name,
        value: value,
        previous_close: prev === null ? 0 : prev,
        change: change,
        percent_change: pct === null ? 0 : pct
      });
    });
    return items.length ? items : null;
  }

  // ---------- Websocket lifecycle ----------
  function dropWs() {
    if (wsConnectTimer) { clearTimeout(wsConnectTimer); wsConnectTimer = null; }
    if (wsPollTimer) { clearInterval(wsPollTimer); wsPollTimer = null; }
    if (ws) {
      try { ws.close(); } catch (e) { /* already gone */ }
      ws = null;
    }
  }

  function scheduleBackoff() {
    backoffMs = Math.min(backoffMs * 2, WS_MAX_BACKOFF_MS);
  }

  function onWsMessage(ev) {
    var items = null;
    try {
      items = parseWsIndices(JSON.parse(ev.data));
    } catch (e) {
      items = null;
    }
    if (!items) return; // unexpected shape: ignore silently, keep baseline
    lastPushAt = Date.now();
    backoffMs = WS_BASE_BACKOFF_MS; // a good push resets the backoff
    if (wsConnectTimer) { clearTimeout(wsConnectTimer); wsConnectTimer = null; }
    renderLive(items);
    // Keep the stream warm with a gentle re-request; the host is
    // request/response oriented, so this is what makes it "live".
    var sock = ws;
    if (wsPollTimer) clearInterval(wsPollTimer);
    wsPollTimer = setInterval(function () {
      var openState = (typeof WebSocket !== 'undefined' && WebSocket.OPEN) || 1;
      if (sock && sock.readyState === openState) {
        try { sock.send(JSON.stringify({ route: 'NepseIndex', params: {} })); } catch (e) { /* socket dying; onclose handles it */ }
      }
    }, WS_POLL_MS);
  }

  function connectWs() {
    if (!baselineOk || !inTradingHours()) return;
    if (ws || typeof WebSocket === 'undefined') return;
    if (document.hidden) return; // watchdog retries when the tab is visible
    lastAttemptAt = Date.now();
    var sock;
    try {
      sock = new WebSocket(WS_URL);
    } catch (e) {
      scheduleBackoff();
      return;
    }
    ws = sock;
    var settled = false;
    wsConnectTimer = setTimeout(function () {
      // 8s with no valid push: give up quietly, keep the 15-min data.
      if (!settled) {
        settled = true;
        dropWs();
        scheduleBackoff();
      }
    }, WS_CONNECT_TIMEOUT_MS);
    sock.onopen = function () {
      try {
        sock.send(JSON.stringify({ route: 'NepseIndex', params: {} }));
      } catch (e) { /* send failed; the timeout handles it */ }
    };
    sock.onmessage = onWsMessage;
    sock.onerror = function () { /* onclose follows; handled there */ };
    sock.onclose = function () {
      if (ws === sock) ws = null;
      if (!settled) {
        settled = true;
        if (wsConnectTimer) { clearTimeout(wsConnectTimer); wsConnectTimer = null; }
      }
      if (wsPollTimer) { clearInterval(wsPollTimer); wsPollTimer = null; }
      scheduleBackoff();
      // Chips stay as-is; the watchdog falls back to the snapshot
      // if pushes stop arriving.
    };
  }

  function watchdog() {
    var now = Date.now();
    if (lastPushAt && now - lastPushAt > WS_STALE_MS) {
      // Live stream went quiet: fall back to the 15-min snapshot now.
      lastPushAt = 0;
      dropWs();
      load();
    }
    if (!ws && baselineOk && inTradingHours() && !document.hidden &&
        now - lastAttemptAt >= backoffMs) {
      connectWs();
    }
  }

  function init() {
    if (!document.getElementById(TRACK_ID)) return;
    load();
    setInterval(load, REFRESH_MS);
    setInterval(watchdog, WS_WATCHDOG_MS);
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          dropWs(); // save battery/data; watchdog reconnects when visible
        } else {
          watchdog();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
