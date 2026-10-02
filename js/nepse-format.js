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

  function num(x) {
    var n = Number(x);
    return isFinite(n) ? n : NaN;
  }

  var NepseFormat = {
    /** Price / index value → "2,599.15". NaN → "—". */
    fmtPrice: function (x) {
      var n = num(x);
      return isNaN(n) ? '—' : PRICE_FMT.format(n);
    },

    /** Percent → "+0.45%", "-1.20%". NaN → "—". */
    fmtPct: function (x) {
      var n = num(x);
      return isNaN(n) ? '—' : PCT_FMT.format(n) + '%';
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
