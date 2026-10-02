/**
 * nepse-data.js — Canonical validated market-data snapshot for the NEPSE suite.
 *
 * THE ONLY module allowed to fetch live.json (or any raw quote feed).
 * Every page consumes data via NepseData.getSnapshot() / subscribe().
 *
 * Guarantees (Phase 1):
 *  1. Never renders unvalidated numbers — validateSnapshot() gates everything.
 *  2. Validation failure keeps the last-good snapshot and marks it STALE.
 *  3. Moves beyond ±10% vs previous close are quarantined, never displayed.
 *  4. Replacement is atomic — subscribers never see a half-written snapshot.
 *  5. ETag / 304 suppresses unchanged payloads; getStats() reports real bandwidth saved.
 *  6. Visibility pause/resume stops polling in background tabs; a >30-min
 *     hidden stretch forces one full refresh on return (skips 304 once).
 *  7. BroadcastChannel + localStorage scaffolding for cross-tab convergence (Phase 3).
 *
 * Load order: nepse-market-config.js → nepse-format.js → nepse-data.js
 */
(function (global) {
  'use strict';

  var CFG = global.NepseMarketConfig;
  var FEED_URL = '/nepse-chart/data/live.json';
  var STORAGE_KEY = 'nepse-data:last-good-v1';
  var BC_NAME = 'nepse-data-v1';

  // ---- internal state (never exposed directly) ----
  var state = {
    snapshot: null,      // current canonical snapshot (frozen)
    lastGood: null,      // last validated snapshot (frozen)
    status: 'loading',   // loading | live | stale | error
    failures: 0,
    etag: null,
    timer: null,
    subscribers: [],
    bc: null,
    started: false,
    // Phase 2: bandwidth + polling-health instrumentation
    bytesSaved: 0,       // estimated bytes not transferred thanks to 304s
    bytesTotal: 0,       // bytes actually transferred on 200s
    lastBytes: 0,        // payload size of the most recent 200 (304 estimate basis)
    requests304: 0,
    requests200: 0,
    lastPollMs: 0,       // Date.now() of the most recent poll attempt
    hiddenAt: null,      // Date.now() when the tab last became hidden
    skipEtagOnce: false  // force a full 200 after a long hidden stretch
  };

  // ---- validation ----

  function isFiniteNum(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function validQuote(q) {
    if (!q || typeof q.symbol !== 'string' || !q.symbol) return false;
    if (!isFiniteNum(q.ltp) || q.ltp <= 0) return false;
    if (!isFiniteNum(q.previous_close) || q.previous_close <= 0) return false;
    return true;
  }

  /**
   * Quarantine check: |ltp - prev| / prev > 10% → suspect, exclude from display.
   */
  function quarantined(q) {
    var pct = Math.abs((q.ltp - q.previous_close) / q.previous_close) * 100;
    return pct > CFG.CIRCUIT_QUARANTINE_PCT;
  }

  /**
   * Normalize one raw quote into canonical shape. Returns null if invalid.
   */
  function normalizeQuote(raw) {
    if (!validQuote(raw)) return null;
    var q = {
      symbol: String(raw.symbol).toUpperCase(),
      name: raw.name || raw.symbol,
      ltp: Number(raw.ltp),
      previous_close: Number(raw.previous_close),
      change: isFiniteNum(raw.change) ? Number(raw.change) : Number(raw.ltp) - Number(raw.previous_close),
      percent_change: isFiniteNum(raw.percent_change)
        ? Number(raw.percent_change)
        : ((Number(raw.ltp) - Number(raw.previous_close)) / Number(raw.previous_close)) * 100,
      high: isFiniteNum(raw.high) ? Number(raw.high) : null,
      low: isFiniteNum(raw.low) ? Number(raw.low) : null,
      open: isFiniteNum(raw.open) ? Number(raw.open) : null,
      volume: isFiniteNum(raw.volume) ? Number(raw.volume) : null,
      turnover: isFiniteNum(raw.turnover) ? Number(raw.turnover) : null,
      trades: isFiniteNum(raw.trades) ? Number(raw.trades) : null
    };
    q.quarantined = quarantined(q);
    return q;
  }

  /**
   * Validate a raw feed payload. Returns { ok, snapshot?, errors[] }.
   * Rules: payload object, finite asof, finite index value, non-empty quotes.
   * Future asof → invalid. Individual bad quotes are dropped (not fatal);
   * quarantined quotes are kept but flagged.
   */
  function validateSnapshot(raw) {
    var errors = [];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, errors: ['payload is not an object'] };
    }

    var asof = new Date(raw.asof);
    if (isNaN(asof.getTime())) {
      errors.push('asof is not a valid timestamp');
    } else if (asof.getTime() > Date.now() + 5 * 60 * 1000) {
      errors.push('asof is in the future');
    }

    var idx = raw.index || {};
    var indexValue = Number(idx.value);
    if (!isFiniteNum(indexValue) || indexValue <= 0) {
      errors.push('index.value is not a positive finite number');
    }

    // Optional index session fields (validated, null when absent/invalid).
    // Additive: preserves existing consumers of {value, change, percent_change}.
    function optNum(v) {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }

    // Optional sub-index tape (validated; invalid entries dropped, never fatal).
    var indices = [];
    if (Array.isArray(raw.indices)) {
      for (var ii = 0; ii < raw.indices.length; ii++) {
        var it = raw.indices[ii];
        if (!it || typeof it.name !== 'string' || !it.name) continue;
        var iv = Number(it.value);
        if (!isFinite(iv)) continue;
        indices.push({
          name: String(it.name),
          value: iv,
          change: isFiniteNum(Number(it.change)) ? Number(it.change) : 0,
          percent_change: isFiniteNum(Number(it.percent_change)) ? Number(it.percent_change) : 0
        });
      }
    }

    var rawQuotes = raw.quotes;
    if (!Array.isArray(rawQuotes) || rawQuotes.length === 0) {
      errors.push('quotes is empty or not an array');
    }

    if (errors.length) return { ok: false, errors: errors };

    var quotes = [];
    var dropped = 0;
    var quarantinedCount = 0;
    for (var i = 0; i < rawQuotes.length; i++) {
      var q = normalizeQuote(rawQuotes[i]);
      if (!q) { dropped++; continue; }
      if (q.quarantined) quarantinedCount++;
      quotes.push(q);
    }
    if (!quotes.length) {
      return { ok: false, errors: ['no valid quotes after normalization'] };
    }

    var snapshot = {
      asof: asof.toISOString(),
      asofMs: asof.getTime(),
      market: raw.market || CFG.marketState(),
      session_date: raw.session_date || null,
      index: {
        value: indexValue,
        change: isFiniteNum(Number(idx.change)) ? Number(idx.change) : 0,
        percent_change: isFiniteNum(Number(idx.percent_change)) ? Number(idx.percent_change) : 0,
        high: optNum(idx.high),
        low: optNum(idx.low),
        open: optNum(idx.open),
        previous_close: optNum(idx.previous_close)
      },
      indices: indices,
      quotes: quotes,
      quoteCount: quotes.length,
      dropped: dropped,
      quarantinedCount: quarantinedCount,
      receivedAt: Date.now()
    };

    // Deep-freeze the canonical snapshot so consumers cannot mutate it.
    if (Object.freeze) {
      snapshot.quotes.forEach(function (q) { Object.freeze(q); });
      snapshot.indices.forEach(function (it) { Object.freeze(it); });
      Object.freeze(snapshot.quotes);
      Object.freeze(snapshot.indices);
      Object.freeze(snapshot.index);
      Object.freeze(snapshot);
    }

    return { ok: true, snapshot: snapshot, errors: [] };
  }

  // ---- persistence (last-good) ----

  function persistLastGood(snap) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        snapshot: snap,
        savedAt: Date.now()
      }));
    } catch (e) { /* storage unavailable — in-memory lastGood still works */ }
  }

  function restoreLastGood() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.snapshot) return null;
      return parsed.snapshot;
    } catch (e) { return null; }
  }

  // ---- cross-tab scaffolding (Phase 3 converges on this) ----

  function setupBroadcast() {
    try {
      if (!('BroadcastChannel' in global)) return;
      state.bc = new BroadcastChannel(BC_NAME);
      state.bc.onmessage = function (ev) {
        var msg = ev && ev.data;
        if (!msg || msg.type !== 'nepse-data:update') return;
        // Phase 3: adopt newer snapshot from another tab.
        if (msg.snapshot && msg.snapshot.asofMs > (state.snapshot ? state.snapshot.asofMs : 0)) {
          var v = validateSnapshot(msg.snapshot);
          if (v.ok) applySnapshot(v.snapshot, 'live');
        }
      };
    } catch (e) { /* ignore */ }
  }

  function broadcast(snapshot) {
    try {
      if (state.bc) state.bc.postMessage({ type: 'nepse-data:update', snapshot: snapshot });
    } catch (e) { /* ignore */ }
  }

  // ---- core: atomic apply ----

  function setStatus(s) {
    state.status = s;
    notify();
  }

  function applySnapshot(snapshot, status) {
    state.snapshot = snapshot;   // atomic swap — subscribers never see partial
    state.lastGood = snapshot;
    persistLastGood(snapshot);
    broadcast(snapshot);
    setStatus(status || 'live');
  }

  function markStale() {
    // Keep serving lastGood, but label it STALE. Never blank the screen.
    if (state.lastGood) {
      state.snapshot = state.lastGood;
      setStatus('stale');
    } else {
      setStatus('error');
    }
  }

  function notify() {
    var subs = state.subscribers.slice();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](state.snapshot, state.status); } catch (e) { /* subscriber error */ }
    }
  }

  // ---- fetch with retry backoff ----

  function fetchOnce() {
    var headers = {};
    // Skip the 304 optimization once after a long hidden stretch so we
    // always come back with a guaranteed-fresh payload.
    if (state.etag && !state.skipEtagOnce) headers['If-None-Match'] = state.etag;
    state.skipEtagOnce = false;

    return fetch(FEED_URL, { headers: headers, cache: 'no-store' }).then(function (resp) {
      if (resp.status === 304) {
        state.requests304++;
        // We didn't transfer the payload: credit the size of the last 200
        // (fall back to a 50KB live.json estimate before the first one).
        state.bytesSaved += state.lastBytes || 51200;
        return { unchanged: true };
      }
      var etag = resp.headers.get('ETag');
      if (etag) state.etag = etag;
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json().then(function (json) {
        state.requests200++;
        var bytes = 0;
        var cl = resp.headers.get('Content-Length');
        if (cl && isFinite(+cl)) {
          bytes = +cl;
        } else {
          try { bytes = JSON.stringify(json).length; } catch (e) { bytes = 0; }
        }
        state.bytesTotal += bytes;
        state.lastBytes = bytes;
        return { unchanged: false, json: json };
      });
    });
  }

  function poll() {
    state.lastPollMs = Date.now(); // polling-health watermark
    if (document.hidden) { schedule(); return; } // visibility pause
    fetchOnce().then(function (res) {
      if (res.unchanged) { state.failures = 0; schedule(); return; }
      var v = validateSnapshot(res.json);
      if (v.ok) {
        state.failures = 0;
        // Skip no-op updates: same asof → no notify storm.
        if (!state.snapshot || v.snapshot.asofMs !== state.snapshot.asofMs) {
          applySnapshot(v.snapshot, 'live');
        } else {
          schedule();
        }
      } else {
        onFailure(v.errors);
      }
    }).catch(function () {
      onFailure(['fetch failed']);
    });
  }

  function onFailure(errors) {
    state.failures++;
    if (state.failures >= CFG.MAX_FAILURES_BEFORE_STALE) {
      markStale();
      // Warn (not error) once when the feed dies during market hours —
      // pages keep showing last-good marked STALE, this is the debug trail.
      if (state.failures === CFG.MAX_FAILURES_BEFORE_STALE && CFG.isMarketOpen()) {
        try {
          console.warn('[NepseData] live feed unreachable during market hours (' +
            state.failures + ' failures) — serving last-good snapshot marked STALE');
        } catch (e) { /* console unavailable */ }
      }
    }
    var delays = CFG.RETRY_DELAYS_MS;
    var delay = delays[Math.min(state.failures - 1, delays.length - 1)];
    clearTimeout(state.timer);
    state.timer = setTimeout(poll, delay);
  }

  function schedule() {
    clearTimeout(state.timer);
    var interval = CFG.isMarketOpen() ? CFG.POLL_OPEN_MS : CFG.POLL_CLOSED_MS;
    state.timer = setTimeout(poll, interval);
  }

  function onVisibility() {
    if (document.hidden) {
      // Tab went to background: record when, so the return path can
      // decide whether a freshness-forcing refresh is warranted.
      state.hiddenAt = Date.now();
    } else {
      // Returning to tab: refresh soon, then resume schedule.
      clearTimeout(state.timer);
      if (state.hiddenAt && Date.now() - state.hiddenAt > 30 * 60 * 1000) {
        // Hidden > 30 min: skip the 304 optimization once so we land on
        // a guaranteed-fresh payload, not a possibly-stale ETag match.
        state.skipEtagOnce = true;
      }
      state.hiddenAt = null;
      state.timer = setTimeout(poll, 2000);
    }
  }

  // ---- public API ----

  var NepseData = {
    FEED_URL: FEED_URL,

    /** Start polling. Safe to call once; restores last-good synchronously. */
    start: function () {
      if (state.started) return;
      state.started = true;
      var lg = restoreLastGood();
      if (lg) {
        var v = validateSnapshot(lg);
        if (v.ok) {
          state.snapshot = v.snapshot;
          state.lastGood = v.snapshot;
          setStatus('stale'); // restored cache is stale until a fresh fetch lands
        }
      }
      setupBroadcast();
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', onVisibility);
      }
      poll();
    },

    /** Current canonical snapshot (frozen) or null. */
    getSnapshot: function () {
      return state.snapshot;
    },

    /** loading | live | stale | error */
    getStatus: function () {
      return state.status;
    },

    /**
     * Bandwidth + request instrumentation (Phase 2).
     * { bytesSaved, bytesTotal, requests304, requests200, savingsPct }
     * savingsPct = share of payload bytes avoided via 304s (0–100, 1 decimal).
     */
    getStats: function () {
      var total = state.bytesSaved + state.bytesTotal;
      return {
        bytesSaved: state.bytesSaved,
        bytesTotal: state.bytesTotal,
        requests304: state.requests304,
        requests200: state.requests200,
        savingsPct: total > 0 ? Math.round((state.bytesSaved / total) * 1000) / 10 : 0
      };
    },

    /** Visible (non-quarantined) quotes only. */
    getQuotes: function () {
      var s = state.snapshot;
      if (!s) return [];
      return s.quotes.filter(function (q) { return !q.quarantined; });
    },

    /** Find one symbol (case-insensitive), null if missing/quarantined. */
    getQuote: function (symbol) {
      if (!symbol) return null;
      var up = String(symbol).toUpperCase();
      var qs = NepseData.getQuotes();
      for (var i = 0; i < qs.length; i++) {
        if (qs[i].symbol === up) return qs[i];
      }
      return null;
    },

    /**
     * Subscribe(fn(snapshot, status)). Called immediately with current state,
     * then on every change. Returns an unsubscribe function.
     */
    subscribe: function (fn) {
      state.subscribers.push(fn);
      try { fn(state.snapshot, state.status); } catch (e) { /* ignore */ }
      return function () {
        var i = state.subscribers.indexOf(fn);
        if (i !== -1) state.subscribers.splice(i, 1);
      };
    },

    // Exposed for tests and Phase 2+:
    _validate: validateSnapshot,
    _normalizeQuote: normalizeQuote
  };

  global.NepseData = NepseData;
})(typeof window !== 'undefined' ? window : this);
