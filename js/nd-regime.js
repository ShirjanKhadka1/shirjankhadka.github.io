/* Market Regime page (P19) — rule-based regime from real NEPSE index history */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
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
  function classify(close, s50, s200) {
    if (s50 == null || s200 == null) return 'unknown';
    if (close > s200 && s50 > s200) return 'bull';
    if (close < s200 && s50 < s200) return 'bear';
    if (close < s50 && close > s200) return 'correction';
    if (close > s50 && close < s200) return 'recovery';
    return 'unknown';
  }
  var REGIME_META = {
    bull: { name: 'Bull Market', desc: 'Price holds above the 200-day average and the 50-day average sits above the 200-day — the long-term trend is up.', score: 85 },
    bear: { name: 'Bear Market', desc: 'Price sits below the 200-day average with the 50-day below the 200-day — the long-term trend is down.', score: 15 },
    correction: { name: 'Correction', desc: 'Price has slipped below the 50-day average but remains above the 200-day — a pullback inside an uptrend.', score: 60 },
    recovery: { name: 'Recovery', desc: 'Price has climbed back above the 50-day average but is still below the 200-day — a bounce inside a downtrend.', score: 40 },
    unknown: { name: 'Insufficient data', desc: 'Not enough history to classify the regime.', score: 50 }
  };

  function render(r) {
    var meta = REGIME_META[r.regime] || REGIME_META.unknown;
    // Gauge
    var arc = $('rgGaugeArc');
    var label = $('rgGaugeLabel');
    var total = 267; // dasharray length
    var target = total - (meta.score / 100) * total;
    if (arc) {
      arc.style.stroke = r.regime === 'bull' ? '#16a34a' : r.regime === 'bear' ? '#dc2626' : r.regime === 'correction' ? '#d97706' : '#2563eb';
      requestAnimationFrame(function () { arc.style.strokeDashoffset = target; });
    }
    if (label) label.textContent = r.close.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    var nm = $('rgRegimeName');
    if (nm) { nm.textContent = meta.name; nm.className = 'rg-regime-name ' + r.regime; }
    var ds = $('rgRegimeDesc');
    if (ds) ds.textContent = meta.desc;

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
        rule('bull', 'Bull Market', 'CLOSE &gt; SMA200 <b>and</b> SMA50 &gt; SMA200', 'Uptrend intact on both short and long horizons.') +
        rule('bear', 'Bear Market', 'CLOSE &lt; SMA200 <b>and</b> SMA50 &lt; SMA200', 'Downtrend on both horizons.') +
        rule('correction', 'Correction', 'CLOSE &lt; SMA50 <b>but</b> CLOSE &gt; SMA200', 'Short-term pullback inside a long-term uptrend.') +
        rule('recovery', 'Recovery', 'CLOSE &gt; SMA50 <b>but</b> CLOSE &lt; SMA200', 'Short-term bounce inside a long-term downtrend.');
    }

    // Session
    var sess = $('rgSession');
    if (sess) sess.textContent = 'Index close ' + r.close.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' · ' + r.date + ' · ' + r.coverage + ' · Source: NEPSE index history';
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
    if (!host) return;
    // Monthly sampling
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
    if (note) {
      var counts = { bull: 0, bear: 0, correction: 0, recovery: 0 };
      segs.forEach(function (s) { counts[s.r] = (counts[s.r] || 0) + 1; });
      var tot = segs.length || 1;
      var best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      note.textContent = 'Monthly regime, ' + months[0] + ' → ' + months[months.length - 1] + ' (' + segs.length + ' months). ' +
        'Bull ' + Math.round(counts.bull / tot * 100) + '% · Bear ' + Math.round(counts.bear / tot * 100) + '% · ' +
        'Correction ' + Math.round(counts.correction / tot * 100) + '% · Recovery ' + Math.round(counts.recovery / tot * 100) + '%. ' +
        'Most common: ' + best + '.';
    }
  }

  function init() {
    if (!$('rgRegimeName')) return;
    Promise.all([
      fetchJSON('/data/index-history.json').catch(function () { return null; }),
      fetchJSON('/nepse-chart/data/index-spark.json').catch(function () { return null; })
    ]).then(function (res) {
      var hist = res[0], spark = res[1];
      var dates = [], closes = [], cov = [];
      if (hist && hist.rows) {
        hist.rows.forEach(function (r) { dates.push(parseDate(r[0])); closes.push(r[4]); });
        cov.push('2003–' + String(hist.to).slice(0, 4));
      }
      if (spark && spark.closes) {
        spark.closes.forEach(function (c) {
          var d = parseDate(c[0]);
          if (dates.indexOf(d) === -1) { dates.push(d); closes.push(c[1]); }
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
      var nm = $('rgRegimeName');
      if (nm) nm.textContent = 'Data unavailable';
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
