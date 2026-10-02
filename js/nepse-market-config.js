/**
 * nepse-market-config.js — Canonical NEPSE market calendar & policy constants.
 *
 * Single source of truth for:
 *  - Trading days (Sunday–Thursday, per NEPSE schedule)
 *  - NEPSE public holidays (approximate 2026 list — the market calendar is authority)
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

    // ---- NEPSE public holidays (approximate, 2026) ----
    // The market calendar is the authority — this list is a client-side
    // approximation so pages can label holiday closures honestly.
    // Format: 'YYYY-MM-DD' (NPT dates).
    HOLIDAYS_2026: [
      '2026-01-01', // New Year
      '2026-01-15', // Maghe Sankranti
      '2026-01-23', // Saraswati Puja
      '2026-02-15', // Maha Shivaratri
      '2026-02-19', // Prajatantra Diwas
      '2026-03-04', // Fagu Purnima
      '2026-03-19', // Ghode Jatra
      '2026-03-26', // Ram Nawami
      '2026-03-27', // Chaite Dashain
      '2026-04-14', // Bisket Jatra (Nepali New Year)
      '2026-05-01', // Labour Day / Buddha Jayanti
      '2026-08-28', // Gai Jatra
      '2026-09-06', // Haritalika Teej
      '2026-09-19', // Constitution Day
      '2026-09-26', // Indra Jatra
      '2026-10-21', // Dashain
      '2026-10-22', // Dashain
      '2026-10-23', // Dashain
      '2026-10-26', // Dashain
      '2026-10-27', // Dashain
      '2026-10-28', // Chhath
      '2026-11-08', // Tihar
      '2026-11-09', // Tihar
      '2026-11-10', // Tihar
      '2026-11-11', // Tihar
      '2026-11-21', // Balachaturdashi
      '2026-12-25'  // Christmas
    ],

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
     * True if the given NPT date (or 'YYYY-MM-DD' string) is a NEPSE holiday.
     */
    isHoliday: function (nptDate) {
      var key;
      if (typeof nptDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nptDate)) {
        key = nptDate;
      } else {
        var d0 = nptDate || MarketConfig.nowNPT();
        var y = d0.getFullYear();
        var m = ('0' + (d0.getMonth() + 1)).slice(-2);
        var day = ('0' + d0.getDate()).slice(-2);
        key = y + '-' + m + '-' + day;
      }
      return MarketConfig.HOLIDAYS_2026.indexOf(key) !== -1;
    },

    /**
     * True if the given NPT date falls on a NEPSE trading day:
     * Sunday–Thursday AND not a public holiday.
     */
    isTradingDay: function (nptDate) {
      var d = nptDate || MarketConfig.nowNPT();
      if (typeof d === 'string') {
        if (MarketConfig.isHoliday(d)) return false;
        var parts = d.split('-');
        d = new Date(+parts[0], +parts[1] - 1, +parts[2], 12, 0, 0); // noon avoids DST edges
      } else if (MarketConfig.isHoliday(d)) {
        return false;
      }
      return MarketConfig.TRADING_DAYS.indexOf(d.getDay()) !== -1;
    },

    /**
     * True if NEPSE is within 11:00–15:00 NPT on a trading day
     * (weekday Sun–Thu that is not a public holiday).
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
    Object.freeze(MarketConfig.HOLIDAYS_2026);
    Object.freeze(MarketConfig.RETRY_DELAYS_MS);
  }

  global.NepseMarketConfig = MarketConfig;
})(typeof window !== 'undefined' ? window : this);
