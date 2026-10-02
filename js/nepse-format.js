/**
 * nepse-format.js — Single en-IN formatter for the whole NEPSE suite.
 *
 * RULE: no page may call .toFixed() or .toLocaleString() directly for market
 * numbers. Every price, percent, volume and timestamp goes through here so
 * formatting is identical on every page.
 *
 *  - prices / index : 2 decimals, lakh/crore grouping (en-IN)
 *  - percentages    : signed, 2 decimals (e.g. +0.45%, -1.20%)
 *  - volumes        : grouped integers
 *  - timestamps     : Asia/Kathmandu, always labelled NPT
 *
 * Loaded after nepse-market-config.js, before nepse-data.js.
 */
(function (global) {
  'use strict';

  var PRICE_FMT = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var PCT_FMT = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always'
  });
  // Percent without forced sign — for the parenthesised leg of fmtChange,
  // where zero must read "(0.00%)", not "(+0.00%)".
  var PCT_PAREN_FMT = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var INT_FMT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var TIME_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  var DATE_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    day: '2-digit', month: 'short', year: 'numeric'
  });
  var DATETIME_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  // null / undefined / '' are MISSING — never 0. Number(null) === 0 would
  // turn missing data into "0.00", so they map to NaN here.
  function num(x) {
    if (x === null || x === undefined || x === '') return NaN;
    var n = Number(x);
    return isFinite(n) ? n : NaN;
  }

  var NepseFormat = {
    /** Price / index value → "2,599.15". NaN → "—".
     *  0 is never a valid NEPSE price level — missing data arrives as 0/"" —
     *  so 0 renders as "—" too, never "0.00". (Zero CHANGE is real and stays
     *  "0.00" via fmtPct / the signed formatters.) */
    fmtPrice: function (x) {
      var n = num(x);
      return (isNaN(n) || n === 0) ? '—' : PRICE_FMT.format(n);
    },

    /** Percent → "+0.45%", "-1.20%". NaN → "—". */
    fmtPct: function (x) {
      var n = num(x);
      return isNaN(n) ? '—' : PCT_FMT.format(n) + '%';
    },

    /** Day change → "-277.70 (-5.00%)", "+12.30 (+1.20%)", "0.00 (0.00%)".
     *  The rupee leg NEVER carries a % suffix. pct may be null (rupee only).
     *  NaN change → "—". Zero change is real: "0.00 (0.00%)". */
    fmtChange: function (chRs, pct) {
      var ch = num(chRs);
      if (isNaN(ch)) return '—';
      var rsTxt = (ch > 0 ? '+' : '') + PRICE_FMT.format(ch);
      var p = num(pct);
      if (isNaN(p)) return rsTxt;
      return rsTxt + ' (' + (p > 0 ? '+' : '') + PCT_PAREN_FMT.format(p) + '%)';
    },

    /** Percent change derived from rupee change + last price
     *  (prev close = price − change). Null when not computable. */
    pctOfChange: function (chRs, price) {
      var ch = num(chRs), p = num(price);
      if (isNaN(ch) || isNaN(p)) return null;
      var prev = p - ch;
      if (!prev) return null;
      return ch / prev * 100;
    },

    /** Rupee change derived from percent change + last price
     *  (prev close = price / (1 + pct/100)). Null when not computable.
     *  Exact arithmetic from the feed's own two fields — never invented. */
    rsOfPct: function (pct, price) {
      var pc = num(pct), p = num(price);
      if (isNaN(pc) || isNaN(p) || !p) return null;
      var prev = p / (1 + pc / 100);
      if (!isFinite(prev)) return null;
      return p - prev;
    },

    /** Generic grouped number → "12,34,567". NaN → "—". */
    fmtNum: function (x) {
      var n = num(x);
      return isNaN(n) ? '—' : INT_FMT.format(n);
    },

    /** Volume → grouped integer, compact for huge values. */
    fmtVol: function (x) {
      var n = num(x);
      if (isNaN(n)) return '—';
      if (n >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
      if (n >= 1e5) return (n / 1e5).toFixed(2) + ' L';
      return INT_FMT.format(n);
    },

    /** Date → "02 Oct 2026" in NPT. */
    fmtDateNPT: function (d) {
      var dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? '—' : DATE_FMT.format(dt);
    },

    /** Time → "14:35 NPT". */
    fmtTimeNPT: function (d) {
      var dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? '—' : TIME_FMT.format(dt) + ' NPT';
    },

    /** Date+time → "02 Oct 2026, 14:35 NPT". */
    fmtDateTimeNPT: function (d) {
      var dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? '—' : DATETIME_FMT.format(dt) + ' NPT';
    }
  };

  global.NepseFormat = NepseFormat;
})(typeof window !== 'undefined' ? window : this);
