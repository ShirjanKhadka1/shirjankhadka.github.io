/* Market Regime page (P19) — rule-based regime from real NEPSE index history.
   Classic lens (this file): price vs its own 50-day and 200-day simple
   moving averages, a 2x2 mapping with no holes — every session with
   enough history classifies exactly once. (2026-10-26 fix: the previous
   classify() checked SMA50-vs-SMA200 first, which shadowed the
   correction/recovery branches entirely — they were dead code, and
   738 correction days + 471 recovery days were mislabelled bull/bear.
   The confirmed board state in the hero is rendered by
   nd-regime-board.js from /data/market-regime.json, not here.)
   This file keeps: the signals column, the rule cards, the classic-lens
   line, and the monthly timeline (now with year ticks). */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
  }
  function sma(vals, n, i) {
    if (i < n - 1) return null;
    var s = 0;
    for (var k = i - n + 1; k <= i; k++) s += vals[k];
    return s / n;
  }
  function rsi(vals, i, period) {
    period = period || 14;
    if (i < period) return null;
    var g = 0, l = 0;
    for (var k = i - period + 1; k <= i; k++) {
      var ch = vals[k] - vals[k - 1];
      if (ch > 0) g += ch; else l -= ch;
    }
    if (l === 0) return 100;
    var rs = g / l;
    return 100 - 100 / (1 + rs);
  }
  function parseDate(yyyymmdd) {
    var s = String(yyyymmdd);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  // 2x2: price vs SMA200 (long trend) x price vs SMA50 (short trend).
  // Ties fall to the "above" bucket so every session classifies once.
  function classify(close, s50, s200) {
    if (s50 == null || s200 == null) return 'unknown';
    if (close >= s200 && close >= s50) return 'bull';
    if (close >= s200) return 'correction';
    if (close >= s50) return 'recovery';
    return 'bear';
  }
  var REGIME_META = {
    bull: { name: 'Bull Market', cond: 'close above both averages', desc: 'Price holds above both the 50-day and 200-day averages — the trend is up on both horizons.' },
    bear: { name: 'Bear Market', cond: 'close below both averages', desc: 'Price sits below both the 50-day and 200-day averages — the trend is down on both horizons.' },
    correction: { name: 'Correction', cond: 'close below SMA50 but above SMA200', desc: 'Price has slipped below the 50-day average but remains above the 200-day — a pullback inside an uptrend.' },
    recovery: { name: 'Recovery', cond: 'close above SMA50 but below SMA200', desc: 'Price has climbed back above the 50-day average but is still below the 200-day — a bounce inside a downtrend.' },
    unknown: { name: 'Insufficient data', cond: 'not enough history', desc: 'Not enough history to classify the regime.' }
  };

  function render(r) {
    var meta = REGIME_META[r.regime] || REGIME_META.unknown;
    // Classic lens line (the hero name/gauge/session are the confirmed
    // board state, rendered by nd-regime-board.js).
    var lens = $('rgClassicLens');
    if (lens) lens.textContent = 'Classic lens: ' + meta.name + ' — ' + meta.cond + '.';

    // Signals
    var sig = $('rgSignals');
    if (sig) {
      var d200 = r.sma200 ? ((r.close - r.sma200) / r.sma200 * 100) : null;
      var d50 = r.sma50 ? ((r.close - r.sma50) / r.sma50 * 100) : null;
      var ath = r.ath ? ((r.close - r.ath) / r.ath * 100) : null;
      sig.innerHTML =
        signal('NEPSE close', r.close.toLocaleString('en-IN', { maximumFractionDigits: 2 }), 'as of ' + r.date) +
        signal('vs 200-day average', d200 == null ? '—' : (d200 >= 0 ? '+' : '') + d200.toFixed(2) + '%', r.sma200 ? 'SMA200 ' + r.sma200.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'insufficient history', pctBar(d200)) +
        signal('vs 50-day average', d50 == null ? '—' : (d50 >= 0 ? '+' : '') + d50.toFixed(2) + '%', r.sma50 ? 'SMA50 ' + r.sma50.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'insufficient history', pctBar(d50)) +
        signal('RSI (14)', r.rsi == null ? '—' : r.rsi.toFixed(1), rsiNote(r.rsi), rsiBar(r.rsi)) +
        signal('Drawdown from all-time high', ath == null ? '—' : ath.toFixed(2) + '%', r.ath ? 'ATH ' + r.ath.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '', drawBar(ath));
      // animate bars
      setTimeout(function () {
        sig.querySelectorAll('.rg-bar i').forEach(function (el) {
          el.style.width = el.getAttribute('data-w') + '%';
        });
      }, 60);
    }

    // Rules
    var rules = $('rgRules');
    if (rules) {
      rules.innerHTML =
        rule('bull', 'Bull Market', 'CLOSE &gt; SMA200 <b>and</b> CLOSE &gt; SMA50', 'Uptrend intact on both short and long horizons.') +
        rule('bear', 'Bear Market', 'CLOSE &lt; SMA200 <b>and</b> CLOSE &lt; SMA50', 'Downtrend on both horizons.') +
        rule('correction', 'Correction', 'CLOSE &lt; SMA50 <b>but</b> CLOSE &gt; SMA200', 'Short-term pullback inside a long-term uptrend.') +
        rule('recovery', 'Recovery', 'CLOSE &gt; SMA50 <b>but</b> CLOSE &lt; SMA200', 'Short-term bounce inside a long-term downtrend.');
    }
  }
  function signal(k, v, sub, bar) {
    return '<div class="rg-signal"><div><div class="sk">' + k + '</div>' +
      (bar ? '<div class="rg-bar"><i data-w="' + bar + '"></i></div>' : '') + '</div>' +
      '<div class="sv">' + v + (sub ? '<small>' + sub + '</small>' : '') + '</div></div>';
  }
  function pctBar(d) { return d == null ? 0 : Math.max(0, Math.min(100, 50 + d * 2)); }
  function rsiBar(v) { return v == null ? 0 : Math.max(0, Math.min(100, v)); }
  function drawBar(d) { return d == null ? 0 : Math.max(0, Math.min(100, 100 + d * 3)); }
  function rsiNote(v) {
    if (v == null) return '';
    if (v >= 70) return 'overbought zone';
    if (v <= 30) return 'oversold zone';
    return 'neutral zone';
  }
  function rule(cls, name, cond, desc) {
    return '<div class="rg-rule ' + cls + '"><h3>' + name + '</h3><span class="cond">' + cond + '</span><p>' + desc + '</p></div>';
  }

  function renderTimeline(dates, closes) {
    var host = $('rgTimeline');
    var note = $('rgHistNote');
    var ticks = $('rgTimelineTicks');
    if (!host) return;
    // Monthly sampling (last session of each month)
    var buckets = {};
    for (var i = 0; i < dates.length; i++) {
      var m = dates[i].slice(0, 7);
      buckets[m] = i; // last index of month
    }
    var months = Object.keys(buckets).sort();
    var segs = months.map(function (m) {
      var idx = buckets[m];
      var s50 = sma(closes, 50, idx), s200 = sma(closes, 200, idx);
      return { m: m, r: classify(closes[idx], s50, s200) };
    }).filter(function (s) { return s.r !== 'unknown'; });
    // Merge consecutive same-regime months
    var merged = [];
    segs.forEach(function (s) {
      var last = merged[merged.length - 1];
      if (last && last.r === s.r) last.n++;
      else merged.push({ r: s.r, n: 1, from: s.m });
    });
    host.innerHTML = merged.map(function (g) {
      return '<span class="' + g.r + '" style="flex-grow:' + g.n + '" title="' + g.from + ' · ' + g.r + ' (' + g.n + ' mo)"></span>';
    }).join('');
    if (ticks) {
      // Year ticks: first classified sample of every second year + last.
      var firstYear = parseInt(segs[0].m.slice(0, 4), 10);
      var lastYear = parseInt(segs[segs.length - 1].m.slice(0, 4), 10);
      var seen = {};
      var labels = [];
      segs.forEach(function (s, i) {
        var y = parseInt(s.m.slice(0, 4), 10);
        if (seen[y]) return;
        seen[y] = true;
        if ((y - firstYear) % 2 === 0 || y === lastYear) {
          labels.push('<span class="rg-tick" style="left:' + (i / segs.length * 100).toFixed(2) + '%"><i></i><em>' + y + '</em></span>');
        }
      });
      ticks.innerHTML = labels.join('');
    }
    if (note) {
      var counts = { bull: 0, bear: 0, correction: 0, recovery: 0 };
      segs.forEach(function (s) { counts[s.r] = (counts[s.r] || 0) + 1; });
      var tot = segs.length || 1;
      var best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      note.textContent = 'Monthly regime, ' + months[0] + ' → ' + months[months.length - 1] + ' (' + segs.length + ' classified months; ' +
        'first ' + (months.length - segs.length) + ' months excluded — SMA200 needs 200 sessions; 2020-04 had no session, market closed). ' +
        'Bull ' + Math.round(counts.bull / tot * 100) + '% · Bear ' + Math.round(counts.bear / tot * 100) + '% · ' +
        'Correction ' + Math.round(counts.correction / tot * 100) + '% · Recovery ' + Math.round(counts.recovery / tot * 100) + '%. ' +
        'Most common: ' + best + '.';
    }
  }

  function init() {
    if (!$('rgSignals')) return;
    Promise.all([
      fetchJSON('/data/index-history.json').catch(function () { return null; }),
      fetchJSON('/nepse-chart/data/index-spark.json').catch(function () { return null; }),
      // Board asof is the verified session cutoff: index-history carries
      // a spurious 2026-10-19 row (a confirmed market holiday — no broker
      // data exists for it), so signals + timeline must stop at the
      // board's session, never at the file's last row.
      fetchJSON('/data/market-regime.json').catch(function () { return null; })
    ]).then(function (res) {
      var hist = res[0], spark = res[1], board = res[2];
      var asof = board && board.asof ? board.asof : null;
      function onOrBefore(d) { return !asof || d <= asof; }
      var dates = [], closes = [], cov = [];
      if (hist && hist.rows) {
        hist.rows.forEach(function (r) {
          var d = parseDate(r[0]);
          if (onOrBefore(d)) { dates.push(d); closes.push(r[4]); }
        });
        cov.push('2003–' + String(hist.to).slice(0, 4));
      }
      if (spark && spark.closes) {
        spark.closes.forEach(function (c) {
          var d = parseDate(c[0]);
          if (onOrBefore(d) && dates.indexOf(d) === -1) { dates.push(d); closes.push(c[1]); }
        });
        cov.push('2026');
      }
      if (!closes.length) throw new Error('no-data');
      var i = closes.length - 1;
      var s50 = sma(closes, 50, i), s200 = sma(closes, 200, i);
      var r = {
        close: closes[i], date: dates[i],
        sma50: s50, sma200: s200,
        rsi: rsi(closes, i),
        ath: Math.max.apply(null, closes),
        regime: classify(closes[i], s50, s200),
        coverage: cov.join(' + ') + ' (' + closes.length + ' sessions)'
      };
      render(r);
      renderTimeline(dates, closes);
    }).catch(function () {
      var sig = $('rgSignals');
      if (sig) sig.innerHTML = '<div class="rg-signal"><div class="sk">Data unavailable</div></div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Auto-refresh with market calendar awareness:
  // - Mon-Fri 11:00-15:00 NPT (market hours): every 5 min
  // - Mon-Fri outside hours: every 30 min (catches post-close pipeline update)
  // - Sat/Sun (market holiday): every 2 hours (data is Friday's close, won't change)
  function refreshIntervalMs() {
    try {
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
      var day = now.getDay(); // 0=Sun, 6=Sat
      if (day === 0 || day === 6) return 2 * 60 * 60 * 1000;
      var mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= 660 && mins < 900) return 5 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }
  setInterval(function () {
    if (document.hidden) return; // don't poll in background tabs
    init();
  }, refreshIntervalMs());
})();
