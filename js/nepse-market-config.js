/**
 * nepse-market-config.js — Canonical NEPSE market calendar & policy constants.
 *
 * Single source of truth for:
 *  - Trading days (Sunday–Thursday, per NEPSE schedule)
 *  - Market hours (11:00–15:00 NPT)
 *  - Circuit-breaker quarantine threshold (±10%)
 *  - Live-data age thresholds
 *  - Polling intervals and retry backoff
 *
 * All timestamps are Asia/Kathmandu (NPT, UTC+5:45).
 * Loaded before nepse-format.js and nepse-data.js.
 */
(function (global) {
  'use strict';

  var NPT_OFFSET_MINUTES = 5 * 60 + 45; // UTC+5:45

  var MarketConfig = {
    // ---- Trading calendar ----
    // NEPSE trades Sunday–Thursday. 0=Sunday … 6=Saturday (JS getDay convention).
    TRADING_DAYS: [0, 1, 2, 3, 4],

    // ---- Market hours (NPT, 24h) ----
    MARKET_OPEN_HOUR: 11,
    MARKET_OPEN_MINUTE: 0,
    MARKET_CLOSE_HOUR: 15,
    MARKET_CLOSE_MINUTE: 0,

    // ---- Data-quality gates ----
    // Moves beyond ±10% vs previous close are suspect → quarantine, never display.
    CIRCUIT_QUARANTINE_PCT: 10,

    // Live snapshot older than this is stale (ms). 24h covers overnight gaps.
    LIVE_MAX_AGE_MS: 24 * 60 * 60 * 1000,

    // ---- Polling ----
    POLL_OPEN_MS: 60 * 1000,        // during market hours
    POLL_CLOSED_MS: 5 * 60 * 1000,  // outside market hours

    // ---- Retry backoff (ms) ----
    RETRY_DELAYS_MS: [5000, 15000, 45000, 120000],
    MAX_FAILURES_BEFORE_STALE: 3,

    // ---- Helpers ----

    /**
     * Current time in NPT as a Date (shifted by the fixed offset).
     * NPT has no DST, so a fixed offset is correct.
     */
    nowNPT: function () {
      var now = new Date();
      var utc = now.getTime() + now.getTimezoneOffset() * 60000;
      return new Date(utc + NPT_OFFSET_MINUTES * 60000);
    },

    /**
     * True if the given NPT date falls on a NEPSE trading day (Sun–Thu).
     * Holiday handling (Phase 2) will extend this with a holiday list.
     */
    isTradingDay: function (nptDate) {
      var d = nptDate || MarketConfig.nowNPT();
      return MarketConfig.TRADING_DAYS.indexOf(d.getDay()) !== -1;
    },

    /**
     * True if NEPSE is within 11:00–15:00 NPT on a trading day.
     */
    isMarketOpen: function (nptDate) {
      var d = nptDate || MarketConfig.nowNPT();
      if (!MarketConfig.isTradingDay(d)) return false;
      var mins = d.getHours() * 60 + d.getMinutes();
      var open = MarketConfig.MARKET_OPEN_HOUR * 60 + MarketConfig.MARKET_OPEN_MINUTE;
      var close = MarketConfig.MARKET_CLOSE_HOUR * 60 + MarketConfig.MARKET_CLOSE_MINUTE;
      return mins >= open && mins < close;
    },

    /**
     * Market state: 'OPEN' | 'CLOSED'.
     */
    marketState: function (nptDate) {
      return MarketConfig.isMarketOpen(nptDate) ? 'OPEN' : 'CLOSED';
    }
  };

  // Freeze the constants (helpers remain callable).
  if (Object.freeze) {
    Object.freeze(MarketConfig.TRADING_DAYS);
    Object.freeze(MarketConfig.RETRY_DELAYS_MS);
  }

  global.NepseMarketConfig = MarketConfig;
})(typeof window !== 'undefined' ? window : this);
