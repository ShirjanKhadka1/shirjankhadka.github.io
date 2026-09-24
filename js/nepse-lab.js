/* NEPSE Alpha Lab — chart + pattern/divergence scanner + rules-based verdict engine.
   Index data: window.NEPSE_DAILY = [YYYYMMDD, o, h, l, c, turnoverNPR], daily sessions.
   Stock data: fetched live from free community APIs (samirwagle/Nepse-All-Scraper
   per-symbol OHLC JSON + shubhamnpk/yonepse live quotes). All analysis is computed
   client-side, rule-based and educational — not AI predictions, not advice. */
(function () {
  'use strict';

  var UP = '#16a34a', DOWN = '#dc2626', GRID = '#e8edf3', TXT = '#64748b',
      SMA20C = '#2563eb', SMA50C = '#d97706', ATHC = '#c9a227',
      BULLC = '#16a34a', BEARC = '#dc2626';

  var SRC = {
    companies: 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/companies.json',
    prices: function (s) { return 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' + s.replace('/', '-') + '.json'; },
    latest: 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/latest.json',
    live: 'https://shubhamnpk.github.io/yonepse/data/market/live.json',
    liveOwn: 'data/live.json', // our own 15-min official-API snapshot (Actions job)
    status: 'https://shubhamnpk.github.io/yonepse/data/market/status.json',
    universe: 'data/universe.json',
    verdicts: 'data/verdicts.json',
    ltp: function (s) { return 'data/ltp/' + s.replace('/', '-') + '.json?v=' + UNIVERSE_V; }
  };
  var UNIVERSE_V = '20260924g'; // bump when data/universe.json is rebuilt

  /* ================= pure math / indicators ================= */
  function smaArr(vals, n) {
    var out = new Array(vals.length).fill(null), s = 0, i;
    for (i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function emaArr(vals, n) {
    var out = new Array(vals.length).fill(null);
    if (!vals.length) return out;
    var k = 2 / (n + 1), e = vals[0], i;
    for (i = 0; i < vals.length; i++) {
      e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k);
      if (i >= n - 1) out[i] = e;
    }
    return out;
  }
  function rsiArr(closes, n) {
    var out = new Array(closes.length).fill(null);
    if (closes.length < n + 1) return out;
    var g = 0, l = 0, i;
    for (i = 1; i <= n; i++) { var d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (i = n + 1; i < closes.length; i++) {
      var dd = closes[i] - closes[i - 1], gg = dd > 0 ? dd : 0, ll = dd < 0 ? -dd : 0;
      g = (g * (n - 1) + gg) / n; l = (l * (n - 1) + ll) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function macd(closes) {
    var e12 = emaArr(closes, 12), e26 = emaArr(closes, 26), n = closes.length;
    var line = new Array(n).fill(null), i;
    for (i = 0; i < n; i++) line[i] = (e12[i] == null || e26[i] == null) ? null : e12[i] - e26[i];
    var lv = line.filter(function (v) { return v != null; });
    var se = emaArr(lv, 9), signal = new Array(n).fill(null), hist = new Array(n).fill(null), k = 0;
    for (i = 0; i < n; i++) {
      if (line[i] == null) continue;
      signal[i] = se[k]; hist[i] = se[k] == null ? null : line[i] - se[k]; k++;
    }
    return { line: line, signal: signal, hist: hist };
  }
  function atrArr(rows, n) {
    var out = new Array(rows.length).fill(null), trs = [], i;
    for (i = 1; i < rows.length; i++) {
      var h = rows[i][2], l = rows[i][3], pc = rows[i - 1][4];
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    var a = 0;
    for (i = 0; i < trs.length; i++) {
      a = i < n ? a + trs[i] / Math.min(n, i + 1) : (a * (n - 1) + trs[i]) / n;
      if (i >= n - 1) out[i + 1] = a;
    }
    return out;
  }
  function linfit(pts) { // pts: [{i,p}] -> {slope (per bar, relative), r2}
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += pts[i].i; sy += pts[i].p; sxx += pts[i].i * pts[i].i; sxy += pts[i].i * pts[i].p; }
    var den = n * sxx - sx * sx;
    if (!den) return { slope: 0, r2: 0 };
    var slope = (n * sxy - sx * sy) / den, mean = sy / n, ss = 0, sr = 0;
    for (i = 0; i < n; i++) { ss += (pts[i].p - mean) * (pts[i].p - mean); var f = slope * (pts[i].i - sx / n) + mean; sr += (pts[i].p - f) * (pts[i].p - f); }
    var p0 = mean || 1;
    return { slope: slope / p0, r2: ss ? 1 - sr / ss : 0 };
  }

  /* fractal pivots, then alternation + min-move filter => swing pivots */
  function fractalPivots(rows, k) {
    var out = [], n = rows.length, i, j;
    for (i = k; i < n - k; i++) {
      var hi = true, lo = true;
      for (j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        if (rows[j][2] >= rows[i][2]) hi = false;
        if (rows[j][3] <= rows[i][3]) lo = false;
      }
      if (hi) out.push({ i: i, t: 'H', p: rows[i][2] });
      else if (lo) out.push({ i: i, t: 'L', p: rows[i][3] });
    }
    return out;
  }
  function swingPivots(rows, k, minMoveRel) {
    var fr = fractalPivots(rows, k), out = [], i, p, last;
    for (i = 0; i < fr.length; i++) {
      p = fr[i]; last = out[out.length - 1];
      if (!last || last.t !== p.t) out.push(p);
      else if (p.t === 'H' && p.p > last.p) out[out.length - 1] = p;
      else if (p.t === 'L' && p.p < last.p) out[out.length - 1] = p;
    }
    var f2 = [];
    for (i = 0; i < out.length; i++) {
      p = out[i]; last = f2[f2.length - 1];
      if (!last) { f2.push(p); continue; }
      var mv = Math.abs(p.p - last.p) / last.p;
      if (mv >= minMoveRel) f2.push(p);
      else if ((p.t === 'H' && p.p > last.p) || (p.t === 'L' && p.p < last.p)) f2[f2.length - 1] = p;
    }
    return f2;
  }
  function recentATR(rows) {
    var a = atrArr(rows, 14), vals = [];
    for (var i = Math.max(0, a.length - 60); i < a.length; i++) if (a[i] != null) vals.push(a[i]);
    if (!vals.length) return 0;
    vals.sort(function (x, y) { return x - y; });
    return vals[Math.floor(vals.length / 2)];
  }

  /* ================= divergence scanner =================
     Regular + hidden divergences on RSI(14) and MACD histogram. */
  function detectDivergences(rows) {
    var out = [], n = rows.length;
    if (n < 80) return out;
    var from = Math.max(0, n - 340);
    var closes = rows.map(function (r) { return r[4]; });
    var rsiA = rsiArr(closes, 14), mR = macd(closes);
    var piv = fractalPivots(rows, 3).filter(function (p) { return p.i >= from + 3; });
    var hAbs = 0, i;
    for (i = Math.max(0, n - 120); i < n; i++) if (mR.hist[i] != null) hAbs = Math.max(hAbs, Math.abs(mR.hist[i]));
    function mk(bias, sub, ind, a, b) {
      return {
        kind: 'divergence', bias: bias, sub: sub, ind: ind,
        i1: a.i, i2: b.i, d1: rows[a.i][0], d2: rows[b.i][0], p1: a.p, p2: b.p,
        label: (bias === 'bullish' ? 'Bullish' : 'Bearish') + ' divergence (' + ind + ', ' + sub + ')',
        note: bias === 'bullish'
          ? 'Price made a lower low while ' + ind + ' made a higher low — selling pressure may be fading.'
          : 'Price made a higher high while ' + ind + ' made a lower high — buying pressure may be fading.'
      };
    }
    function scan(ind, name, thr) {
      var highs = piv.filter(function (p) { return p.t === 'H'; });
      var lows = piv.filter(function (p) { return p.t === 'L'; });
      function pairs(list, isHigh) {
        for (var k = Math.max(0, list.length - 5); k < list.length - 1; k++) {
          var a = list[k], b = list[k + 1];
          if (b.i - a.i < 6) continue;
          var va = ind[a.i], vb = ind[b.i];
          if (va == null || vb == null) continue;
          if (isHigh) {
            if (b.p > a.p * 1.004 && vb < va - thr) out.push(mk('bearish', 'regular', name, a, b));
            else if (b.p < a.p * 0.996 && vb > va + thr) out.push(mk('bullish', 'hidden', name, a, b));
          } else {
            if (b.p < a.p * 0.996 && vb > va + thr) out.push(mk('bullish', 'regular', name, a, b));
            else if (b.p > a.p * 1.004 && vb < va - thr) out.push(mk('bearish', 'hidden', name, a, b));
          }
        }
      }
      pairs(highs, true); pairs(lows, false);
    }
    scan(rsiA, 'RSI', 0.8);
    if (hAbs > 0) scan(mR.hist, 'MACD', Math.max(hAbs * 0.12, 1e-9));
    // dedupe overlapping same-bias detections, keep most recent; cap at 4
    out.sort(function (a, b) { return b.i2 - a.i2; });
    var kept = [];
    out.forEach(function (d) {
      var clash = kept.some(function (k) {
        return k.bias === d.bias && k.ind === d.ind && Math.abs(k.i2 - d.i2) < 25;
      });
      if (!clash) kept.push(d);
    });
    return kept.slice(0, 4);
  }

  /* ================= chart-pattern scanner =================
     Double top/bottom, head & shoulders (and inverse), triangles, wedges. */
  function detectPatterns(rows) {
    var out = [], n = rows.length;
    if (n < 120) return out;
    var atrV = recentATR(rows), refP = rows[n - 1][4] || 1;
    var minMove = Math.max(0.02, (atrV * 1.6) / refP);
    var sw = swingPivots(rows, 5, minMove).filter(function (p) { return p.i > n - 520; });
    var closes = rows.map(function (r) { return r[4]; });
    function brokeLevel(level, afterI, dirn, look) {
      // dirn -1: broke below; +1: broke above
      for (var i = afterI + 1; i < Math.min(n, afterI + 1 + look); i++) {
        if (dirn < 0 && closes[i] < level * 0.995) return i;
        if (dirn > 0 && closes[i] > level * 1.005) return i;
      }
      return -1;
    }
    function base(kind, label, bias, i1, i2, d1, d2, note, conf) {
      return { kind: 'pattern', pkind: kind, label: label, bias: bias, i1: i1, i2: i2, d1: d1, d2: d2, note: note, conf: conf || 'medium' };
    }
    var i, a, b, c, d, e;
    // --- double tops / bottoms: H,L,H and L,H,L triples ---
    for (i = 0; i + 2 < sw.length; i++) {
      a = sw[i]; b = sw[i + 1]; c = sw[i + 2];
      if (a.t === 'H' && b.t === 'L' && c.t === 'H' && c.i - a.i >= 10) {
        if (Math.abs(a.p - c.p) / a.p <= 0.025) {
          var lvl = b.p, brk = brokeLevel(lvl, c.i, -1, 45);
          out.push(base('double-top', 'Double Top', 'bearish', a.i, c.i, rows[a.i][0], rows[c.i][0],
            brk > 0 ? 'Confirmed: closed below the neckline ' + fmtD(rows[brk][0]) + '. Measured target ≈ ' + num(lvl - (Math.max(a.p, c.p) - lvl), 0) + '.'
                    : 'Forming: two similar highs with a neckline at ' + num(lvl, 0) + '. A close below the neckline would confirm.',
            brk > 0 ? 'high' : 'medium'));
          out[out.length - 1].draw = { hline: (a.p + c.p) / 2, nline: lvl, iEnd: brk > 0 ? brk : c.i };
        }
      }
      if (a.t === 'L' && b.t === 'H' && c.t === 'L' && c.i - a.i >= 10) {
        if (Math.abs(a.p - c.p) / a.p <= 0.025) {
          var lvl2 = b.p, brk2 = brokeLevel(lvl2, c.i, 1, 45);
          out.push(base('double-bottom', 'Double Bottom', 'bullish', a.i, c.i, rows[a.i][0], rows[c.i][0],
            brk2 > 0 ? 'Confirmed: closed above the neckline ' + fmtD(rows[brk2][0]) + '. Measured target ≈ ' + num(lvl2 + (lvl2 - Math.min(a.p, c.p)), 0) + '.'
                     : 'Forming: two similar lows with a neckline at ' + num(lvl2, 0) + '. A close above the neckline would confirm.',
            brk2 > 0 ? 'high' : 'medium'));
          out[out.length - 1].draw = { hline: (a.p + c.p) / 2, nline: lvl2, iEnd: brk2 > 0 ? brk2 : c.i };
        }
      }
    }
    // --- head & shoulders / inverse: 5-pivot windows ---
    for (i = 0; i + 4 < sw.length; i++) {
      var w = sw.slice(i, i + 5);
      if (w[0].t === 'H' && w[1].t === 'L' && w[2].t === 'H' && w[3].t === 'L' && w[4].t === 'H' && w[4].i - w[0].i >= 20) {
        var s1 = w[0].p, head = w[2].p, s2 = w[4].p;
        if (head > s1 * 1.015 && head > s2 * 1.015 && Math.abs(s1 - s2) / s1 <= 0.05) {
          var nl = (w[1].p + w[3].p) / 2, brk3 = brokeLevel(nl, w[4].i, -1, 45);
          out.push(base('head-shoulders', 'Head & Shoulders', 'bearish', w[0].i, w[4].i, rows[w[0].i][0], rows[w[4].i][0],
            brk3 > 0 ? 'Confirmed: neckline broke ' + fmtD(rows[brk3][0]) + ' — classic reversal lower.'
                     : 'Forming: left shoulder, head, right shoulder with neckline near ' + num(nl, 0) + '.',
            brk3 > 0 ? 'high' : 'medium'));
          out[out.length - 1].draw = { nline: nl, iEnd: brk3 > 0 ? brk3 : w[4].i, neck: [{ i: w[1].i, p: w[1].p }, { i: w[3].i, p: w[3].p }] };
        }
      }
      if (w[0].t === 'L' && w[1].t === 'H' && w[2].t === 'L' && w[3].t === 'H' && w[4].t === 'L' && w[4].i - w[0].i >= 20) {
        var s1b = w[0].p, headb = w[2].p, s2b = w[4].p;
        if (headb < s1b * 0.985 && headb < s2b * 0.985 && Math.abs(s1b - s2b) / s1b <= 0.05) {
          var nlb = (w[1].p + w[3].p) / 2, brk4 = brokeLevel(nlb, w[4].i, 1, 45);
          out.push(base('inv-head-shoulders', 'Inverse Head & Shoulders', 'bullish', w[0].i, w[4].i, rows[w[0].i][0], rows[w[4].i][0],
            brk4 > 0 ? 'Confirmed: neckline broke ' + fmtD(rows[brk4][0]) + ' — classic reversal higher.'
                     : 'Forming: inverse head & shoulders with neckline near ' + num(nlb, 0) + '.',
            brk4 > 0 ? 'high' : 'medium'));
          out[out.length - 1].draw = { nline: nlb, iEnd: brk4 > 0 ? brk4 : w[4].i, neck: [{ i: w[1].i, p: w[1].p }, { i: w[3].i, p: w[3].p }] };
        }
      }
    }
    // --- triangles & wedges: converging boundary lines through recent swings ---
    (function () {
      var wsw = sw.filter(function (p) { return p.i > n - 260; });
      var highs = wsw.filter(function (p) { return p.t === 'H'; }).slice(-4);
      var lows = wsw.filter(function (p) { return p.t === 'L'; }).slice(-4);
      if (highs.length < 2 || lows.length < 2) return;
      var fU = linfit(highs), fL = linfit(lows);
      var span = Math.max(highs[highs.length - 1].i, lows[lows.length - 1].i) - Math.min(highs[0].i, lows[0].i);
      if (span < 30) return;
      var firstW = Math.max(highs[0].p, lows[0].p) - Math.min(highs[0].p, lows[0].p);
      var lastW = highs[highs.length - 1].p - lows[lows.length - 1].p;
      if (!(lastW < firstW * 0.8)) return; // not contracting
      var sU = fU.slope, sL = fL.slope, T = 0.0006, kind = null, bias = 'neutral', label = '';
      // goodness: fitted boundary lines must hug the pivots (R² is meaningless for flat lines)
      function maxDev(pts, f) {
        var m = meanP(pts), aS = f.slope * m, p0 = pts[0], md = 0;
        pts.forEach(function (pt) { md = Math.max(md, Math.abs(pt.p - (p0.p + aS * (pt.i - p0.i)))); });
        return md / m;
      }
      if (maxDev(highs, fU) > 0.022 || maxDev(lows, fL) > 0.022) return;
      if (Math.abs(sU) < T && sL > T) { kind = 'triangle-asc'; bias = 'bullish'; label = 'Ascending Triangle'; }
      else if (sU < -T && Math.abs(sL) < T) { kind = 'triangle-desc'; bias = 'bearish'; label = 'Descending Triangle'; }
      else if (sU < -T && sL > T) { kind = 'triangle-sym'; bias = 'neutral'; label = 'Symmetrical Triangle'; }
      else if (sU > T && sL > sU + T * 0.5) { kind = 'wedge-rising'; bias = 'bearish'; label = 'Rising Wedge'; }
      else if (sL < -T && sU < sL - T * 0.5) { kind = 'wedge-falling'; bias = 'bullish'; label = 'Falling Wedge'; }
      if (!kind) return;
      var i1 = Math.min(highs[0].i, lows[0].i), i2 = Math.max(highs[highs.length - 1].i, lows[lows.length - 1].i);
      var notes = {
        'triangle-asc': 'Flat resistance above, rising support below — buyers pressing higher. Bullish on an upside break.',
        'triangle-desc': 'Flat support below, falling resistance above — sellers pressing lower. Bearish on a downside break.',
        'triangle-sym': 'Coiling range — a sharp expansion move usually follows the break, either way.',
        'wedge-rising': 'Rising but converging — momentum is tiring. Often resolves downward.',
        'wedge-falling': 'Falling but converging — selling is tiring. Often resolves upward.'
      };
      var it = base(kind, label, bias, i1, i2, rows[i1][0], rows[i2][0], notes[kind], 'medium');
      it.draw = { upper: highs, lower: lows, iEnd: i2 };
      out.push(it);
    })();
    out.sort(function (x, y) { return y.i2 - x.i2; });
    return out.slice(0, 6);
  }

  /* ================= verdict engine =================
     Transparent multi-factor score. Positive = constructive, negative = weak.
     Rule-based and educational — not financial advice. */
  function computeVerdict(pack) {
    var rows = pack.rows, n = rows.length, factors = [];
    function F(name, pts, note) { factors.push({ name: name, pts: pts, note: note }); }
    if (n < 60) return { score: null, label: 'Insufficient history', cls: 'insufficient', factors: factors, sessions: n, note: 'Only ' + n + ' sessions on record — not enough history to score reliably.' };
    var closes = rows.map(function (r) { return r[4]; });
    var s20 = smaArr(closes, 20), s50 = smaArr(closes, 50), s200 = smaArr(closes, 200);
    var rsiA = rsiArr(closes, 14), mR = macd(closes);
    var last = rows[n - 1], c = last[4], i, score = 0;
    function add(pts, name, note) { score += pts; F(name, pts, note); }

    // 1. trend vs SMA50 / SMA200
    var v50 = s50[n - 1], v200 = s200[n - 1];
    if (v50 != null) add(c >= v50 ? 1.5 : -1.5, 'Trend vs SMA 50', c >= v50 ? 'Price above the 50-day average — uptrend.' : 'Price below the 50-day average — downtrend.');
    if (v200 != null) add(c >= v200 ? 1.5 : -1.5, 'Trend vs SMA 200', c >= v200 ? 'Above the 200-day average — long-term uptrend.' : 'Below the 200-day average — long-term downtrend.');

    // 2. recent SMA20/50 cross
    var cross = 0;
    for (i = Math.max(1, n - 20); i < n; i++) {
      var a0 = s20[i - 1], a1 = s20[i], b0 = s50[i - 1], b1 = s50[i];
      if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
      if (a0 <= b0 && a1 > b1) cross = 2;
      else if (a0 >= b0 && a1 < b1) cross = -2;
    }
    if (cross !== 0) add(cross, 'SMA 20/50 crossover', cross > 0 ? 'Golden cross in the last 20 sessions — momentum turning up.' : 'Death cross in the last 20 sessions — momentum turning down.');

    // 3. RSI zone
    var r = rsiA[n - 1];
    if (r != null) {
      if (r >= 70) add(-1, 'RSI ' + r.toFixed(0), 'Overbought zone — upside may be stretched.');
      else if (r <= 30) add(1.5, 'RSI ' + r.toFixed(0), 'Oversold zone — selling may be exhausted.');
      else if (r >= 55) add(0.5, 'RSI ' + r.toFixed(0), 'Firm momentum above 55.');
      else if (r <= 45) add(-0.5, 'RSI ' + r.toFixed(0), 'Soft momentum below 45.');
      else add(0, 'RSI ' + r.toFixed(0), 'Neutral momentum.');
    }

    // 4. MACD histogram
    var h0 = mR.hist[n - 1], h1 = mR.hist[n - 2];
    if (h0 != null && h1 != null) {
      if (h0 > 0 && h0 >= h1) add(1, 'MACD momentum', 'Positive and rising — buyers in control.');
      else if (h0 > 0) add(0.5, 'MACD momentum', 'Positive but fading.');
      else if (h0 < h1) add(-1, 'MACD momentum', 'Negative and falling — sellers in control.');
      else add(-0.5, 'MACD momentum', 'Negative but improving.');
    }

    // 5. volume / turnover participation
    var vols = rows.map(function (x) { return x[6] || 0; });
    var v5 = avg(vols.slice(-5)), v20 = avg(vols.slice(-20));
    if (v20 > 0) {
      if (v5 > v20 * 1.5 && c >= rows[n - 5][4]) add(1, 'Turnover surge', 'Turnover running hot on rising prices — participation confirms the move.');
      else if (v5 < v20 * 0.6) add(-0.5, 'Turnover drought', 'Turnover well below average — moves lack conviction.');
    }

    // 6. 52-week position
    var win = rows.slice(-252), h52 = -Infinity, l52 = Infinity;
    win.forEach(function (x) { if (x[2] > h52) h52 = x[2]; if (x[3] < l52) l52 = x[3]; });
    if (h52 > 0) {
      if (c >= h52 * 0.95) add(1, 'Near 52-week high', 'Trading within 5% of the yearly high — strong.');
      else if (c <= l52 * 1.1) add(-1, 'Near 52-week low', 'Trading within 10% of the yearly low — weak.');
    }

    // 7. divergences
    var bullD = pack.divs.filter(function (d) { return d.bias === 'bullish'; })[0];
    var bearD = pack.divs.filter(function (d) { return d.bias === 'bearish'; })[0];
    if (bullD && (!bearD || bullD.i2 >= bearD.i2)) add(bullD.sub === 'regular' ? 1.5 : 1, 'Bullish divergence', bullD.label + ' ending ' + fmtD(bullD.d2) + '.');
    else if (bearD) add(bearD.sub === 'regular' ? -1.5 : -1, 'Bearish divergence', bearD.label + ' ending ' + fmtD(bearD.d2) + '.');

    // 8. chart patterns (most recent completed)
    var done = pack.pats.filter(function (p) { return /Confirmed/.test(p.note); })[0] || pack.pats[0];
    if (done) add(done.bias === 'bullish' ? 1.5 : done.bias === 'bearish' ? -1.5 : 0, done.label, done.note);

    // 9. market regime (stocks only)
    if (!pack.isIndex && pack.idxRegime) add(pack.idxRegime === 'up' ? 0.5 : -0.5, 'Market backdrop', pack.idxRegime === 'up' ? 'NEPSE index above its 200-day average — tailwind.' : 'NEPSE index below its 200-day average — headwind.');

    // 10. support / resistance proximity
    var piv = fractalPivots(rows, 4).slice(-8);
    var sup = null, res = null;
    piv.forEach(function (p) {
      if (p.t === 'L' && p.p < c && (sup == null || p.p > sup)) sup = p.p;
      if (p.t === 'H' && p.p > c && (res == null || p.p < res)) res = p.p;
    });
    if (sup != null && c < sup * 1.03) add(0.5, 'Holding support', 'Price sitting just above support near ' + num(sup, 0) + '.');
    if (res != null && c > res * 0.97) add(-0.5, 'Under resistance', 'Overhead resistance near ' + num(res, 0) + '.');

    score = Math.round(score * 10) / 10;
    var label, cls;
    if (score >= 5) { label = 'Strong Buy'; cls = 'sbuy'; }
    else if (score >= 2) { label = 'Buy'; cls = 'buy'; }
    else if (score > -2) { label = 'Hold'; cls = 'hold'; }
    else if (score > -5) { label = 'Exit / Reduce'; cls = 'exit'; }
    else { label = 'Strong Exit'; cls = 'sexit'; }
    return { score: score, label: label, cls: cls, factors: factors };
  }
  function avg(a) { var s = 0, k = 0; for (var i = 0; i < a.length; i++) if (a[i] > 0) { s += a[i]; k++; } return k ? s / k : 0; }

  /* ================= formatting ================= */
  function fmtD(ymd) { var s = String(ymd); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  function fmtTick(ymd, weekly) {
    var s = String(ymd), m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s.slice(4, 6) - 1];
    return weekly ? m + " '" + s.slice(2, 4) : m + ' ' + s.slice(6, 8);
  }
  function num(n, d) { return (+n).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function bigMoney(v) {
    v = +v || 0;
    if (v >= 1e9) return 'Rs ' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e7) return 'Rs ' + (v / 1e7).toFixed(2) + ' Cr';
    if (v >= 1e5) return 'Rs ' + (v / 1e5).toFixed(1) + ' L';
    return 'Rs ' + Math.round(v).toLocaleString('en-US');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ================= state & data ================= */
  var state = {
    mode: 'index', sym: 'NEPSE', symName: 'NEPSE Index',
    tf: '1Y', style: 'candles', sma: true, rsi: true, signals: true,
    hover: -1, rows: [], live: null, liveAt: 0, liveBadge: 'eod',
    companies: [], universe: [], universeAsof: '', typeMap: {}, names: {}, loading: false, err: '',
    ltpOnly: false, styleForced: false
  };
  var TF_SESSIONS = { '1M': 22, '3M': 66, '6M': 132, '1Y': 252, '2Y': 504 };
  var histCache = {}, liveCache = { at: 0, map: {} };
  /* memoized detections + shell: hover re-renders must not recompute or rebuild DOM */
  var detCache = { key: '', divs: [], pats: [] };
  var shellCache = { key: '' };
  function getDetections(view) {
    // weekly views scan the daily series so scanner indices map back to daily rows
    var rows = view.isWeekly ? view.daily : view.rows;
    var last = rows[rows.length - 1];
    var key = state.sym + '|' + rows.length + '|' + (last ? last[0] : 0) + '|' +
      state.tf + '|' + state.signals + '|' + (state.ltpOnly ? 'ltp' : 'ohlc');
    if (detCache.key === key) return detCache;
    if (typeof API !== 'undefined' && API._testHooks) API._testHooks.detRecomputes++;
    var divs = [], pats = [];
    if (state.signals && !state.ltpOnly && rows.length) {
      divs = detectDivergences(rows);
      pats = detectPatterns(rows);
    }
    detCache = { key: key, divs: divs, pats: pats };
    return detCache;
  }

  function indexRows() {
    return (window.NEPSE_DAILY || []).map(function (r) { return [r[0], r[1], r[2], r[3], r[4], 0, r[5]]; });
  }
  function ymdNum(dstr) { return +dstr.replace(/-/g, ''); }
  function todayNPT() {
    // Kathmandu wall-clock exposed via the UTC getters: NPT = UTC + 5:45
    return new Date(Date.now() + 5.75 * 3600e3);
  }
  function marketOpenNPT() {
    var t = todayNPT(), d = t.getUTCDay(), mins = t.getUTCHours() * 60 + t.getUTCMinutes();
    return d >= 0 && d <= 4 && mins >= 645 && mins < 900; // Sun–Thu 10:45–15:00 (pre-open 10:45, regular 11:00–15:00)
  }
  function fetchJSON(url, timeout) {
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { rej(new Error('timeout')); }, timeout || 15000);
      fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) { clearTimeout(to); res(j); })
        .catch(function (e) { clearTimeout(to); rej(e); });
    });
  }
  // Fetch the current data-build version (never cached) so automated daily
  // rebuilds invalidate the cached universe/verdicts/LTP snapshots.
  function resolveDataVersion() {
    return fetch('data/version.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no version'); return r.json();
    }).then(function (j) {
      if (j && j.v) UNIVERSE_V = String(j.v);
    }).catch(function () { /* keep built-in fallback version */ });
  }
  function loadUniverse() {
    function apply(u) {
      state.universe = (u && u.symbols) || [];
      state.universeAsof = (u && u.asof) || '';
      state.companies = state.universe.map(function (it) { return it.s; });
      state.typeMap = {};
      state.universe.forEach(function (it) {
        if (it.s && !state.names[it.s]) state.names[it.s] = it.n || it.s;
        if (it.s) state.typeMap[it.s] = it.t || '';
      });
    }
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('nl-universe') || 'null'); } catch (e) {}
    if (cached && cached.v === UNIVERSE_V && cached.u) { apply(cached.u); return Promise.resolve(); }
    return fetchJSON(SRC.universe + '?v=' + UNIVERSE_V).then(function (u) {
      apply(u);
      try { localStorage.setItem('nl-universe', JSON.stringify({ v: UNIVERSE_V, u: u })); } catch (e) {}
    }).catch(function () {
      if (cached && cached.u) { apply(cached.u); return; }
      state.universe = [];
      state.companies = ['NABIL', 'NICA', 'HIDCL', 'UPPER', 'NIFRA', 'NTC', 'CIT', 'CHCL'];
    });
  }
  function loadLive() {
    var now = Date.now();
    if (now - liveCache.at < 60000 && Object.keys(liveCache.map).length) return Promise.resolve(liveCache.map);
    // Prefer our own 15-min official-API snapshot (same origin, no CORS issues,
    // refreshed by the nepse-live-quotes workflow); fall back to yonepse.
    return fetch(SRC.liveOwn, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no own feed'); return r.json();
    }).then(function (j) {
      var arr = (j && j.quotes) || [];
      if (!arr.length) throw new Error('empty own feed');
      return arr;
    }).catch(function () { return fetchJSON(SRC.live); }).then(function (arr) {
      var map = {};
      (arr || []).forEach(function (q) { if (q && q.symbol) { map[q.symbol] = q; if (q.name) state.names[q.symbol] = q.name; } });
      liveCache = { at: now, map: map };
      return map;
    }).catch(function () { return liveCache.map; });
  }
  function loadStock(sym) {
    if (histCache[sym]) return Promise.resolve(histCache[sym]);
    return fetchJSON(SRC.prices(sym)).then(function (j) {
      var rows = (j.data || []).map(function (d) {
        return [ymdNum(d.date), +d.open || 0, +d.high || 0, +d.low || 0, +d.ltp || 0, +d.qty || 0, +d.turnover || 0];
      }).filter(function (r) { return r[4] > 0; });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      histCache[sym] = rows;
      return rows;
    });
  }
  function loadLTP(sym) {
    // LTP-only fallback for listed securities the scraper has no OHLC for.
    // File holds compact [ymd, ltp, volume, turnover, trades]; open/high/low are
    // never fabricated — o=h=l=c=ltp and the UI flags the series as LTP-only.
    var ck = 'ltp:' + sym;
    if (histCache[ck]) return Promise.resolve(histCache[ck]);
    return fetchJSON(SRC.ltp(sym)).then(function (j) {
      var rows = (j.rows || []).map(function (d) {
        return [d[0], d[1], d[1], d[1], d[1], d[2] || 0, d[3] || 0];
      }).filter(function (r) { return r[4] > 0; });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      histCache[ck] = rows;
      return rows;
    });
  }
  function applyLiveCandle(rows, sym) {
    var q = liveCache.map[sym];
    if (!q || !q.last_updated) return { rows: rows, live: false };
    var t = todayNPT();
    var ymd = t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
    var ageMin = (Date.now() - new Date(q.last_updated).getTime()) / 60000;
    if (ageMin > 180) return { rows: rows, live: false }; // stale quote
    var last = rows[rows.length - 1];
    var candle = [ymd, q.previous_close || q.ltp, q.high || q.ltp, q.low || q.ltp, q.ltp, q.volume || 0, q.turnover || 0];
    var out = rows.slice();
    if (last && last[0] === ymd) out[out.length - 1] = candle;
    else if (!last || ymd > last[0]) out.push(candle);
    else return { rows: rows, live: false };
    return { rows: out, live: marketOpenNPT() && ageMin < 45, quote: q, provisional: !last || ymd >= last[0] };
  }

  function setSymbol(sym, name) {
    sym = String(sym || '').trim().toUpperCase();
    if (!sym) return;
    state.loading = true; state.err = ''; renderShell();
    if (sym === 'NEPSE' || sym === 'NEPSE INDEX') {
      state.mode = 'index'; state.sym = 'NEPSE'; state.symName = 'NEPSE Index'; state.ltpOnly = false;
      state.rows = indexRows(); state.loading = false;
      afterData();
      return;
    }
    state.mode = 'stock'; state.sym = sym; state.ltpOnly = false;
    state.symName = state.names[sym] || sym;
    loadStock(sym).catch(function () { return null; }).then(function (rows) {
      if (rows && rows.length) return { rows: rows, ltpOnly: false };
      return loadLTP(sym).then(function (lr) {
        if (lr && lr.length) return { rows: lr, ltpOnly: true };
        throw new Error('empty');
      });
    }).then(function (got) {
      return loadLive().then(function () { return got; }); // live quotes lazy: only for stock views
    }).then(function (got) {
      var rows = got.rows;
      if (!rows.length) throw new Error('empty');
      state.ltpOnly = got.ltpOnly;
      if (state.ltpOnly && state.style === 'candles') { state.style = 'line'; state.styleForced = true; syncSeg('nl-style', 'line'); }
      else if (!state.ltpOnly && state.styleForced) { state.style = 'candles'; state.styleForced = false; syncSeg('nl-style', 'candles'); }
      var merged = applyLiveCandle(rows, sym);
      state.rows = merged.rows;
      state.live = merged.quote || liveCache.map[sym] || null;
      state.liveBadge = merged.live ? 'live' : 'eod';
      state.symName = state.names[sym] || sym;
      state.loading = false;
      afterData();
    }).catch(function () {
      state.loading = false; state.err = 'Could not load data for ' + esc(sym) + '. Check the symbol and retry.';
      renderShell();
    });
  }
  function afterData() {
    try { history.replaceState(null, '', state.mode === 'stock' ? '?s=' + state.sym : location.pathname); } catch (e) {}
    render();
  }

  /* ================= series ================= */
  function toWeekly(rows) {
    // group by actual calendar weeks (Sunday-start; NEPSE trades Sun–Thu).
    // The old numeric `r[0] - cur.w0 > 6` on YYYYMMDD integers broke across
    // month/year boundaries (e.g. 20260101 - 20251231 = 8870).
    var out = [], cur = null, wk = -1;
    rows.forEach(function (r) {
      var s = String(r[0]);
      var dayNum = Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000);
      var w = dayNum - ((dayNum + 4) % 7); // 0 = Sunday
      if (w !== wk) {
        if (cur) out.push([cur.d0, cur.o, cur.h, cur.l, cur.c, cur.q, cur.t]);
        wk = w;
        cur = { d0: r[0], o: r[1], h: r[2], l: r[3], c: r[4], q: r[5], t: r[6] };
      } else { cur.h = Math.max(cur.h, r[2]); cur.l = Math.min(cur.l, r[3]); cur.c = r[4]; cur.q += r[5]; cur.t += r[6]; }
    });
    if (cur) out.push([cur.d0, cur.o, cur.h, cur.l, cur.c, cur.q, cur.t]);
    return out;
  }
  function currentSeries() {
    var rows = state.rows, n = rows.length, view;
    var want = TF_SESSIONS[state.tf];
    if (state.tf === 'All' || state.tf === '5Y') {
      view = state.tf === '5Y' ? rows.slice(-1260) : rows.slice();
      return { rows: toWeekly(view), weekly: true, daily: rows, viewStart: 0, isWeekly: true };
    }
    var start = Math.max(0, n - (want || 252));
    view = rows.slice(start);
    if (view.length > 420) return { rows: toWeekly(view), weekly: true, daily: rows, viewStart: 0, isWeekly: true };
    return { rows: view, weekly: false, daily: rows, viewStart: start, isWeekly: false };
  }

  /* ================= chart ================= */
  var cv, cx, rcv, rcx, tip;
  function fitCanvas(c) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, w: w, h: h };
  }
  function pill(g, x, y, text, fg, bg) {
    g.font = '600 10px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    var w = g.measureText(text).width + 12;
    x = Math.max(4, Math.min(x - w / 2, (g.canvas.clientWidth || 800) - w - 4));
    g.fillStyle = bg; g.strokeStyle = fg; g.lineWidth = 1;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y - 9, w, 18, 9); else g.rect(x, y - 9, w, 18);
    g.fill(); g.stroke();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x + w / 2, y + 0.5);
  }
  function drawAnnotations(g, X, Y, H, W, view, divs, pats) {
    if (!state.signals) return;
    var vs = view.viewStart;
    function inView(i) { return view.isWeekly ? true : (i >= vs && i < vs + view.rows.length); }
    function VX(i) { return view.isWeekly ? null : X(i - vs); }
    // divergences
    divs.forEach(function (d) {
      if (view.isWeekly || !inView(d.i1) || !inView(d.i2)) return;
      var x1 = VX(d.i1), x2 = VX(d.i2), col = d.bias === 'bullish' ? BULLC : BEARC;
      g.save(); g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(x1, Y(d.p1)); g.lineTo(x2, Y(d.p2)); g.stroke(); g.restore();
      [d.i1, d.i2].forEach(function (ii, k) {
        var x = VX(ii), y = Y(k ? d.p2 : d.p1);
        g.fillStyle = col; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill();
      });
      pill(g, x2, Y(d.p2) + (d.bias === 'bullish' ? 16 : -16),
        (d.bias === 'bullish' ? '▲ ' : '▼ ') + d.ind + ' div', col, '#fff');
    });
    // patterns
    pats.forEach(function (p) {
      if (view.isWeekly || !inView(p.i1) || !inView(p.i2)) return;
      var col = p.bias === 'bullish' ? BULLC : p.bias === 'bearish' ? BEARC : '#7c3aed';
      var x1 = VX(p.i1), x2 = VX(Math.min(p.draw && p.draw.iEnd != null ? p.draw.iEnd : p.i2, vs + view.rows.length - 1));
      g.save(); g.strokeStyle = col; g.lineWidth = 1.4;
      function hline(y, dash) {
        g.setLineDash(dash || []); g.beginPath(); g.moveTo(x1, Y(y)); g.lineTo(x2, Y(y)); g.stroke(); g.setLineDash([]);
      }
      function segline(a, b) {
        var xe = Math.min(b.i, vs + view.rows.length - 1);
        g.setLineDash([]); g.beginPath(); g.moveTo(VX(a.i), Y(a.p)); g.lineTo(VX(xe), Y(b.p)); g.stroke();
      }
      var dr = p.draw || {};
      if (p.pkind === 'double-top' || p.pkind === 'double-bottom') {
        hline(dr.hline, [6, 4]); hline(dr.nline, []);
      } else if (dr.neck) {
        g.setLineDash([]); g.beginPath();
        g.moveTo(VX(dr.neck[0].i), Y(dr.neck[0].p)); g.lineTo(x2, Y(dr.nline)); g.stroke();
      } else if (dr.upper) {
        var fU = linfit(dr.upper), fL = linfit(dr.lower);
        var viewEnd = vs + view.rows.length - 1;
        var iA = Math.min(dr.upper[0].i, dr.lower[0].i);
        var iB = Math.min((p.draw.iEnd || p.i2) + 10, viewEnd);
        function bline(pts, f, dash) {
          var p0 = pts[0], aS = f.slope * meanP(pts);
          g.setLineDash(dash); g.beginPath();
          g.moveTo(VX(Math.max(iA, vs)), Y(p0.p + aS * (Math.max(iA, vs) - p0.i)));
          g.lineTo(VX(iB), Y(p0.p + aS * (iB - p0.i)));
          g.stroke(); g.setLineDash([]);
        }
        bline(dr.upper, fU, [6, 4]); bline(dr.lower, fL, [6, 4]);
      }
      g.restore();
      pill(g, VX(p.i2), 14, p.label, col, '#fff');
    });
  }
  function meanP(pts) { var s = 0; pts.forEach(function (p) { s += p.p; }); return s / pts.length; }

  function render() {
    if (!cv) return;
    var S = currentSeries(), rows = S.rows, n = rows.length;
    if (!n) return;
    var box = fitCanvas(cv); if (!box) return;
    var g = box.g, W = box.w, H = box.h;
    var padL = 8, padR = 64, padT = 14, padB = 30;
    var pw = W - padL - padR, ph = H - padT - padB - 46;
    var closes = rows.map(function (r) { return r[4]; });
    var sma20 = smaArr(closes, 20), sma50 = smaArr(closes, 50);
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < n; i++) { lo = Math.min(lo, rows[i][3]); hi = Math.max(hi, rows[i][2]); }
    var span = (hi - lo) || 1; lo -= span * 0.08; hi += span * 0.08;
    function X(i) { return padL + (n === 1 ? pw / 2 : i / (n - 1) * pw); }
    function Y(p) { return padT + (1 - (p - lo) / (hi - lo)) * ph; }
    g.clearRect(0, 0, W, H);
    // grid + y labels
    g.strokeStyle = GRID; g.fillStyle = TXT; g.lineWidth = 1;
    g.font = '11px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    var step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    var v0 = Math.ceil(lo / step) * step;
    for (var v = v0; v < hi; v += step) {
      g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke();
      g.fillText(num(v, v >= 100 ? 0 : 1), W - padR + 8, Y(v));
    }
    // x ticks
    g.textAlign = 'center';
    var tickN = Math.max(2, Math.floor(pw / 90));
    for (i = 0; i < tickN; i++) {
      var idx = Math.round(i * (n - 1) / (tickN - 1));
      g.fillText(fmtTick(rows[idx][0], S.weekly), X(idx), H - 46 - 12);
    }
    // turnover bars
    var vmax = 0;
    for (i = 0; i < n; i++) vmax = Math.max(vmax, rows[i][6] || 0);
    var vbT = H - 46, vbH = 40;
    if (vmax > 0) for (i = 0; i < n; i++) {
      var bv = (rows[i][6] || 0) / vmax * vbH;
      g.fillStyle = rows[i][4] >= rows[i][1] ? 'rgba(22,163,74,.45)' : 'rgba(220,38,38,.45)';
      var bw = Math.max(1, pw / n * 0.7);
      g.fillRect(X(i) - bw / 2, vbT - bv, bw, bv);
    }
    g.fillStyle = TXT; g.textAlign = 'left';
    g.fillText('Turnover', padL, vbT - vbH - 6);
    // candles / line
    if (state.style === 'candles') {
      var cw = Math.max(2, Math.min(14, pw / n * 0.7));
      for (i = 0; i < n; i++) {
        var r = rows[i], up = r[4] >= r[1], col = up ? UP : DOWN;
        g.strokeStyle = col; g.fillStyle = up ? '#fff' : col; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(i), Y(r[2])); g.lineTo(X(i), Y(r[3])); g.stroke();
        var yO = Y(r[1]), yC = Y(r[4]);
        g.fillRect(X(i) - cw / 2, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));
        g.strokeRect(X(i) - cw / 2, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));
      }
    } else {
      g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.beginPath();
      for (i = 0; i < n; i++) { var xx = X(i), yy = Y(closes[i]); i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }
      g.stroke();
      var grd = g.createLinearGradient(0, padT, 0, padT + ph);
      grd.addColorStop(0, 'rgba(37,99,235,.18)'); grd.addColorStop(1, 'rgba(37,99,235,0)');
      g.lineTo(X(n - 1), padT + ph); g.lineTo(X(0), padT + ph); g.closePath(); g.fillStyle = grd; g.fill();
    }
    // SMA overlays
    function smaLine(arr, col) {
      g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); var st = false;
      for (var k = 0; k < n; k++) {
        if (arr[k] == null) { st = false; continue; }
        st ? g.lineTo(X(k), Y(arr[k])) : g.moveTo(X(k), Y(arr[k])); st = true;
      }
      g.stroke();
    }
    if (state.sma) { smaLine(sma20, SMA20C); smaLine(sma50, SMA50C); }
    // ATH line (index only)
    if (state.mode === 'index') {
      var ATH = 3199.03;
      if (ATH > lo && ATH < hi) {
        g.save(); g.strokeStyle = ATHC; g.setLineDash([6, 4]); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(padL, Y(ATH)); g.lineTo(W - padR, Y(ATH)); g.stroke(); g.setLineDash([]);
        g.fillStyle = ATHC; g.font = '600 10px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
        g.textAlign = 'right'; g.textBaseline = 'bottom';
        g.fillText('ATH 3,199', W - padR - 4, Y(ATH) - 4); g.restore();
      }
    }
    // SMA 20/50 crossover markers
    if (state.sma) {
      for (i = 21; i < n; i++) {
        var a0 = sma20[i - 1], a1 = sma20[i], b0 = sma50[i - 1], b1 = sma50[i];
        if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
        var golden = a0 <= b0 && a1 > b1, death = a0 >= b0 && a1 < b1;
        if (!golden && !death) continue;
        var xx = X(i), yy = Y(closes[i]) + (golden ? 12 : -12);
        g.fillStyle = golden ? UP : DOWN; g.beginPath();
        if (golden) { g.moveTo(xx, yy - 5); g.lineTo(xx - 4.5, yy + 3.5); g.lineTo(xx + 4.5, yy + 3.5); }
        else { g.moveTo(xx, yy + 5); g.lineTo(xx - 4.5, yy - 3.5); g.lineTo(xx + 4.5, yy - 3.5); }
        g.closePath(); g.fill();
      }
    }
    // analysis overlays — memoized: hover re-renders must NOT recompute detections
    var det = getDetections(S), divs = det.divs, pats = det.pats;
    drawAnnotations(g, X, Y, H, W, { rows: rows, viewStart: S.viewStart, isWeekly: S.isWeekly }, divs, pats);
    // hover crosshair
    if (state.hover >= 0 && state.hover < n) {
      var hx = X(state.hover);
      g.strokeStyle = '#94a3b8'; g.setLineDash([4, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(hx, padT); g.lineTo(hx, padT + ph); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#0f172a';
      g.beginPath(); g.arc(hx, Y(closes[state.hover]), 4, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(hx, Y(closes[state.hover]), 1.8, 0, 7); g.fill();
    }
    drawRSI(closes);
    maybeRenderShell(S, divs, pats);
    // stash for pointer handlers
    cv._geom = { X: X, Y: Y, n: n, rows: rows, padT: padT, ph: ph };
  }
  function maybeRenderShell(S, divs, pats) {
    // the verdict/scanner/stats DOM is rebuilt only when the underlying data
    // changes — hover crosshair moves must not rebuild it (jank). The verdict
    // always renders in a single pass: loading, error, insufficient-history or
    // the final stable score — never staged partial states.
    var last = state.rows[state.rows.length - 1];
    var key = state.sym + '|' + state.rows.length + '|' + (last ? last[0] : 0) + '|' +
      state.tf + '|' + state.signals + '|' + state.loading + '|' + state.err + '|' +
      (state.ltpOnly ? 'ltp' : 'ohlc') + '|' + state.liveBadge + '|' +
      (state.live && state.live.last_updated ? state.live.last_updated : '');
    if (shellCache.key === key) return;
    shellCache.key = key;
    renderShell(S, divs, pats);
  }
  function drawRSI(closes) {
    var wrap = document.getElementById('nl-rsi-wrap');
    if (!wrap || !state.rsi) { if (wrap) wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    var box = fitCanvas(rcv); if (!box) return;
    var g = box.g, W = box.w, H = box.h, n = closes.length;
    var rsi = rsiArr(closes, 14);
    function X(i) { return 8 + (n === 1 ? (W - 72) / 2 : i / (n - 1) * (W - 80)); }
    function Y(v) { return 8 + (1 - v / 100) * (H - 16); }
    g.clearRect(0, 0, W, H);
    g.strokeStyle = GRID; g.lineWidth = 1;
    [70, 50, 30].forEach(function (z) {
      g.setLineDash(z === 50 ? [] : [4, 4]); g.strokeStyle = z === 50 ? '#cbd5e1' : '#f1c40f';
      g.beginPath(); g.moveTo(8, Y(z)); g.lineTo(W - 64, Y(z)); g.stroke(); g.setLineDash([]);
    });
    g.fillStyle = TXT; g.font = '10px system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('70', W - 58, Y(70)); g.fillText('30', W - 58, Y(30));
    g.strokeStyle = '#7c3aed'; g.lineWidth = 1.6; g.beginPath();
    var st = false;
    for (var i = 0; i < n; i++) {
      if (rsi[i] == null) { st = false; continue; }
      st ? g.lineTo(X(i), Y(rsi[i])) : g.moveTo(X(i), Y(rsi[i])); st = true;
    }
    g.stroke();
    if (state.hover >= 0 && state.hover < n && rsi[state.hover] != null) {
      g.fillStyle = '#0f172a'; g.beginPath(); g.arc(X(state.hover), Y(rsi[state.hover]), 3.5, 0, 7); g.fill();
    }
  }

  /* ================= verdict card + scanner + stats ================= */
  function idxRegime() {
    var rows = indexRows();
    var c = rows.map(function (r) { return r[4]; }), s200 = smaArr(c, 200);
    return c[c.length - 1] >= s200[s200.length - 1] ? 'up' : 'down';
  }
  function renderShell(S, divs, pats) {
    var wrap = document.getElementById('nl-lab'); if (!wrap) return;
    var rows = state.rows, n = rows.length;
    // live bar + verdict
    var lb = document.getElementById('nl-livebar');
    if (lb) {
      if (state.loading) { lb.innerHTML = '<div class="nl-lb-sym"><b>Loading…</b><span>Fetching market data</span></div>'; }
      else if (state.err) { lb.innerHTML = '<div class="nl-lb-sym"><b>' + esc(state.sym) + '</b><span>' + state.err + '</span></div>'; }
      else {
      var q = state.live, px = q ? q.ltp : (n ? rows[n - 1][4] : 0);
      var chg = q ? q.change : (n > 1 ? rows[n - 1][4] - rows[n - 2][4] : 0);
      var pct = q && q.percent_change != null ? q.percent_change : (n > 1 && rows[n - 2][4] ? chg / rows[n - 2][4] * 100 : 0);
      var badge = state.liveBadge === 'live'
        ? '<span class="nl-badge live"><span class="nl-pulse"></span>LIVE</span>'
        : '<span class="nl-badge eod">END OF DAY</span>';
      lb.innerHTML =
        '<div class="nl-lb-sym"><b>' + esc(state.sym) + '</b><span>' + esc(state.symName) + '</span></div>' +
        '<div class="nl-lb-px"><b class="' + (chg >= 0 ? 'up' : 'dn') + '">' + num(px, 2) + '</b>' +
        '<span class="' + (chg >= 0 ? 'up' : 'dn') + '">' + (chg >= 0 ? '+' : '') + num(chg, 2) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)</span></div>' +
        '<div class="nl-lb-badge">' + badge + '<small>' + (q && q.last_updated ? 'as of ' + esc(String(q.last_updated).slice(11, 16)) + ' NPT' : fmtD(n ? rows[n - 1][0] : 0)) + '</small></div>';
      }
    }
    // verdict
    var vc = document.getElementById('nl-verdict');
    if (vc) {
      if (state.loading) { vc.innerHTML = '<div class="nl-v-loading">Loading market data…</div>'; }
      else if (state.err) { vc.innerHTML = '<div class="nl-v-err">' + state.err + '</div>'; }
      else if (n >= 60) {
        var v = computeVerdict({ rows: state.rows, divs: divs || [], pats: pats || [], isIndex: state.mode === 'index', idxRegime: state.mode === 'stock' ? idxRegime() : null });
        var pctW = Math.min(100, Math.abs(v.score) / 8 * 100);
        var frows = v.factors.map(function (f) {
          return '<tr><td>' + esc(f.name) + '<small>' + esc(f.note) + '</small></td>' +
            '<td class="nl-fpts ' + (f.pts > 0 ? 'up' : f.pts < 0 ? 'dn' : '') + '">' + (f.pts > 0 ? '+' : '') + f.pts + '</td></tr>';
        }).join('');
        vc.innerHTML =
          '<div class="nl-v-top"><div><div class="nl-v-k">Signal engine verdict</div>' +
          '<div class="nl-v-label ' + v.cls + '">' + v.label + '</div></div>' +
          '<div class="nl-v-meterwrap"><div class="nl-v-meter"><div class="nl-v-fill ' + v.cls + '" style="width:' + pctW + '%"></div></div>' +
          '<div class="nl-v-score">score ' + (v.score > 0 ? '+' : '') + v.score + ' / ±10</div></div></div>' +
          '<table class="nl-v-factors"><tbody>' + frows + '</tbody></table>' +
          '<div class="nl-v-foot">' +
          (state.ltpOnly ? '<span class="nl-ltp-note">LTP-only history — intraday candles and pattern/divergence detection are unavailable for this security.</span> ' : '') +
          'Rule-based model on daily data — educational only, not financial advice. ' +
          (state.liveBadge === 'live' ? 'Includes the live session in progress.' : 'Based on the last closed session.') + '</div>';
      }
      else if (n > 0) {
        var v0 = computeVerdict({ rows: state.rows, divs: [], pats: [], isIndex: state.mode === 'index', idxRegime: null });
        vc.innerHTML =
          '<div class="nl-v-top"><div><div class="nl-v-k">Signal engine verdict</div>' +
          '<div class="nl-v-label ' + v0.cls + '">' + v0.label + '</div></div>' +
          '<div class="nl-v-meterwrap"><div class="nl-v-score">' + esc(v0.note) + '</div></div></div>' +
          (state.ltpOnly ? '<div class="nl-v-foot"><span class="nl-ltp-note">LTP-only history — intraday candles and pattern/divergence detection are unavailable for this security.</span></div>' : '') +
          '<div class="nl-v-foot">Rule-based model on daily data — educational only, not financial advice.</div>';
      }
    }
    // scanner
    var sc = document.getElementById('nl-scan-list');
    if (sc) {
      var items = [];
      (divs || []).forEach(function (d) {
        items.push({ bias: d.bias, title: d.label, dates: fmtD(d.d1) + ' → ' + fmtD(d.d2), note: d.note, i2: d.i2, kind: 'div' });
      });
      (pats || []).forEach(function (p) {
        items.push({ bias: p.bias, title: p.label + (p.conf === 'high' ? ' ✓' : ''), dates: fmtD(p.d1) + ' → ' + fmtD(p.d2), note: p.note, i2: p.i2, kind: 'pat' });
      });
      items.sort(function (a, b) { return b.i2 - a.i2; });
      sc.innerHTML = items.length ? items.map(function (it, k) {
        return '<div class="nl-scan-item"><span class="nl-dot ' + it.bias + '"></span>' +
          '<div class="nl-scan-body"><b>' + esc(it.title) + '</b><span class="nl-scan-dates">' + it.dates + '</span>' +
          '<p>' + esc(it.note) + '</p></div>' +
          '<button class="nl-scan-go" data-k="' + k + '" data-i2="' + it.i2 + '">Locate</button></div>';
      }).join('') : '<div class="nl-scan-empty">No clear divergences or chart patterns in this view. Try the 1Y or All timeframe.</div>';
      sc.querySelectorAll('.nl-scan-go').forEach(function (btn) {
        btn.addEventListener('click', function () { locate(+btn.getAttribute('data-i2')); });
      });
    }
    // stats bar
    if (n) {
      var last = rows[n - 1], prev = rows[n - 2] || last;
      setT('nl-last', num(last[4], 2));
      var ch = last[4] - prev[4], pc = prev[4] ? ch / prev[4] * 100 : 0;
      var ce = document.getElementById('nl-chg');
      if (ce) { ce.textContent = (ch >= 0 ? '+' : '') + num(ch, 2) + ' (' + (pc >= 0 ? '+' : '') + pc.toFixed(2) + '%)'; ce.className = 'nl-stat-v ' + (ch >= 0 ? 'up' : 'dn'); }
      var win = rows.slice(-252), h52 = -Infinity, l52 = Infinity;
      win.forEach(function (x) { h52 = Math.max(h52, x[2]); l52 = Math.min(l52, x[3]); });
      setT('nl-52h', num(h52, 2)); setT('nl-52l', num(l52, 2));
      var rsiA = rsiArr(rows.map(function (r) { return r[4]; }), 14);
      var rv = rsiA[n - 1];
      setT('nl-rsi-v', rv == null ? '–' : rv.toFixed(1));
      var s200 = smaArr(rows.map(function (r) { return r[4]; }), 200);
      var rg = document.getElementById('nl-regime');
      if (rg) {
        var above = s200[n - 1] != null && last[4] >= s200[n - 1];
        rg.textContent = s200[n - 1] == null ? '–' : (above ? 'Above SMA 200' : 'Below SMA 200');
        rg.className = 'nl-stat-v small ' + (above ? 'up' : 'dn');
      }
      setT('nl-asof', fmtD(last[0]) + (state.liveBadge === 'live' ? ' · live' : ''));
    }
  }
  function setT(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function locate(i2) {
    var n = state.rows.length;
    var tf = (n - 1 - i2) < 260 ? '1Y' : 'All';
    if (state.tf !== tf) { state.tf = tf; syncSeg('nl-tf', tf); }
    state.hover = -1;
    render();
    // scroll chart into view
    var el = document.getElementById('nl-chart');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ================= market scan (every listed stock) =================
     verdicts.json is lazy-loaded: on scroll into view (IntersectionObserver)
     or on first filter interaction — never on initial page load. Cached in
     localStorage keyed by the snapshot date. */
  var ms = { data: null, asof: '', filter: 'all', q: '', sortK: 's', sortD: 1, loaded: false, loading: false };
  var VCLS = { 'Strong Buy': 'sbuy', 'Buy': 'buy', 'Hold': 'hold', 'Exit / Reduce': 'exit', 'Strong Exit': 'sexit', 'Insufficient history': 'insufficient' };
  function loadVerdicts() {
    if (ms.loaded) return Promise.resolve(ms.data);
    if (ms.loading) return ms.loading;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('nl-verdicts') || 'null'); } catch (e) {}
    ms.loading = fetchJSON(SRC.verdicts + '?v=' + UNIVERSE_V).then(function (j) {
      if (cached && cached.asof === j.asof && cached.data && Date.now() - cached.at < 24 * 3600e3) {
        ms.data = cached.data;
      } else {
        ms.data = j.verdicts || {};
        try { localStorage.setItem('nl-verdicts', JSON.stringify({ asof: j.asof, at: Date.now(), data: ms.data })); } catch (e) {}
      }
      ms.asof = j.asof || (cached && cached.asof) || '';
      ms.loaded = true; ms.loading = false;
      return ms.data;
    }).catch(function () {
      ms.loading = false;
      if (cached && cached.data) { ms.data = cached.data; ms.asof = cached.asof || ''; ms.loaded = true; return ms.data; }
      throw new Error('scan unavailable');
    });
    return ms.loading;
  }
  function renderMS() {
    var wrap = document.getElementById('nl-ms-wrap');
    if (!wrap || !ms.data) return;
    var syms = Object.keys(ms.data);
    var q = ms.q.trim().toUpperCase();
    var rows = syms.filter(function (s) {
      var v = ms.data[s];
      if (ms.filter !== 'all' && v.v !== ms.filter) return false;
      if (q && s.indexOf(q) < 0 && String(state.names[s] || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var K = ms.sortK, D = ms.sortD;
    function val(s, k) {
      var v = ms.data[s];
      if (k === 's') return s;
      if (k === 'n') return String(state.names[s] || s).toLowerCase();
      if (k === 't') return state.typeMap[s] || '';
      if (k === 'v') return v.v || '';
      if (k === 'score') return v.s == null ? -Infinity : v.s;
      if (k === 'rsi') return v.rsi == null ? -Infinity : v.rsi;
      if (k === 'p') return v.p == null ? -Infinity : v.p;
      if (k === 'ch') return v.ch == null ? -Infinity : v.ch;
      return -Infinity;
    }
    rows.sort(function (a, b) {
      var va = val(a, K), vb = val(b, K);
      return (va < vb ? -1 : va > vb ? 1 : 0) * D;
    });
    setT('nl-ms-asof', ms.asof || '');
    setT('nl-ms-count', rows.length + ' of ' + syms.length + ' securities');
    if (!rows.length) { wrap.innerHTML = '<div class="nl-ms-empty">No securities match this filter.</div>'; return; }
    function th(k, label) {
      var arrow = K === k ? (D > 0 ? ' ▲' : ' ▼') : '';
      return '<th data-k="' + k + '" class="' + (K === k ? 'sorted' : '') + '">' + label + arrow + '</th>';
    }
    var html = '<div class="nl-ms-tablewrap"><table class="nl-ms-table"><thead><tr>' +
      th('s', 'Symbol') + th('n', 'Name') + th('t', 'Type') + th('p', 'Price') +
      th('ch', 'Day chg%') + th('v', 'Verdict') + th('score', 'Score') + th('rsi', 'RSI') +
      '</tr></thead><tbody>';
    rows.forEach(function (s) {
      var v = ms.data[s];
      var chg = v.ch == null ? '–' : (v.ch >= 0 ? '+' : '') + v.ch.toFixed(2) + '%';
      var chgCls = v.ch == null ? '' : (v.ch >= 0 ? 'up' : 'dn');
      var score = v.s == null ? '–' : (v.s > 0 ? '+' : '') + v.s;
      html += '<tr data-s="' + s + '"><td class="ms-sym">' + s + '</td>' +
        '<td class="ms-name">' + esc(state.names[s] || s) + '</td>' +
        '<td class="ms-type">' + esc(state.typeMap[s] || '') + '</td>' +
        '<td class="num">' + (v.p == null ? '–' : num(v.p, 2)) + '</td>' +
        '<td class="num ' + chgCls + '">' + chg + '</td>' +
        '<td><span class="ms-v ' + (VCLS[v.v] || 'hold') + '">' + esc(v.v) + '</span></td>' +
        '<td class="num">' + score + '</td>' +
        '<td class="num">' + (v.rsi == null ? '–' : v.rsi.toFixed(1)) + '</td></tr>';
    });
    wrap.innerHTML = html + '</tbody></table></div>';
    wrap.querySelectorAll('th[data-k]').forEach(function (h) {
      h.addEventListener('click', function () {
        var k = h.getAttribute('data-k');
        if (ms.sortK === k) ms.sortD = -ms.sortD; else { ms.sortK = k; ms.sortD = 1; }
        renderMS();
      });
    });
    var input = document.getElementById('nl-sym');
    wrap.querySelectorAll('tr[data-s]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var s = tr.getAttribute('data-s');
        if (input) input.value = s;
        setSymbol(s);
        var lab = document.getElementById('nl-lab');
        if (lab && lab.scrollIntoView) lab.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
  function initMarketScan() {
    var sec = document.getElementById('nl-mscan');
    if (!sec) return;
    var started = false;
    function start() {
      if (started) return; started = true;
      var wrap = document.getElementById('nl-ms-wrap');
      if (wrap) wrap.innerHTML = '<div class="nl-ms-loading">Loading market scan…</div>';
      loadVerdicts().then(function () { renderMS(); }).catch(function () {
        if (wrap) wrap.innerHTML = '<div class="nl-ms-empty">Market scan is unavailable right now — try the symbol search above.</div>';
      });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { start(); io.disconnect(); }
      }, { rootMargin: '500px' });
      io.observe(sec);
    } else start();
    var chips = document.getElementById('nl-ms-chips');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      start();
      chips.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
      ms.filter = b.getAttribute('data-f');
      loadVerdicts().then(function () { renderMS(); }).catch(function () {});
    });
    var qi = document.getElementById('nl-ms-q');
    if (qi) {
      qi.addEventListener('focus', start);
      var deb;
      qi.addEventListener('input', function () {
        start(); clearTimeout(deb);
        deb = setTimeout(function () { ms.q = qi.value; loadVerdicts().then(function () { renderMS(); }).catch(function () {}); }, 160);
      });
    }
  }

  /* ================= pointer ================= */
  function bindPointer() {
    if (!cv) return;
    function pos(e) {
      var r = cv.getBoundingClientRect(), g = cv._geom;
      if (!g) return -1;
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var i = Math.round((x - 8) / ((r.width - 72) / Math.max(1, g.n - 1)));
      return Math.max(0, Math.min(g.n - 1, i));
    }
    function show(e) {
      var i = pos(e); if (i < 0) return;
      state.hover = i; render();
      var g = cv._geom, r = g.rows[i];
      tip.style.display = 'block';
      tip.innerHTML = '<b>' + fmtD(r[0]) + '</b><br>O ' + num(r[1], 2) + ' · H ' + num(r[2], 2) + '<br>L ' + num(r[3], 2) + ' · C ' + num(r[4], 2) + '<br>Turnover ' + bigMoney(r[6]);
      var cr = cv.getBoundingClientRect();
      var cxp = (e.touches ? e.touches[0].clientX : e.clientX) - cr.left;
      tip.style.left = Math.min(cxp + 14, cr.width - 150) + 'px';
      tip.style.top = '12px';
    }
    function hide() { state.hover = -1; tip.style.display = 'none'; render(); }
    cv.addEventListener('mousemove', show);
    cv.addEventListener('mouseleave', hide);
    cv.addEventListener('touchstart', show, { passive: true });
    cv.addEventListener('touchmove', show, { passive: true });
    cv.addEventListener('touchend', hide);
  }

  /* ================= UI ================= */
  function syncSeg(id, val) {
    var el = document.getElementById(id);
    if (el) el.querySelectorAll('button').forEach(function (b) {
      var on = b.dataset.v === val;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function seg(id, cur, fn) {
    var el = document.getElementById(id);
    if (!el) return cur;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); fn(b.dataset.v);
    });
    return cur;
  }
  function tgl(sel, cur, fn) {
    var el = document.querySelector(sel);
    if (!el) return cur;
    el.addEventListener('click', function () {
      var on = el.classList.toggle('on');
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      fn(on);
    });
    return cur;
  }
  function init() {
    cv = document.getElementById('nl-chart'); rcv = document.getElementById('nl-rsi');
    tip = document.getElementById('nl-tip');
    if (!cv || !window.NEPSE_DAILY) return;
    // search — full listed universe from local data/universe.json (built by tools/build-nepse-universe.js)
    var input = document.getElementById('nl-sym'), dl = document.getElementById('nl-syms');
    function fillDL() {
      if (!dl) return;
      dl.innerHTML = '<option value="NEPSE">NEPSE Index</option>' + state.universe.map(function (it) {
        return '<option value="' + it.s + '">' + esc((state.names[it.s] || it.s) + (it.t ? ' · ' + it.t : '')) + '</option>';
      }).join('');
    }
    // live quotes are fetched lazily (stock views / market-open refresh only),
    // so the initial critical path is: nepse-daily.js + universe.json + render.
    resolveDataVersion().then(loadUniverse).then(function () { fillDL(); initMarketScan(); });
    function go() { var v = input.value.trim().toUpperCase(); if (v) setSymbol(v === 'NEPSE INDEX' ? 'NEPSE' : v); }
    if (input) {
      document.getElementById('nl-go').addEventListener('click', go);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    }
    document.querySelectorAll('[data-chip]').forEach(function (ch) {
      ch.addEventListener('click', function () { setSymbol(ch.getAttribute('data-chip')); if (input) input.value = ch.getAttribute('data-chip'); });
    });
    // controls
    seg('nl-tf', state.tf, function (v) { state.tf = v; state.hover = -1; render(); });
    seg('nl-style', state.style, function (v) { state.style = v; render(); });
    tgl('[data-tgl="sma"]', state.sma, function (v) { state.sma = v; render(); });
    tgl('[data-tgl="rsi"]', state.rsi, function (v) { state.rsi = v; render(); });
    tgl('[data-tgl="signals"]', state.signals, function (v) { state.signals = v; render(); });
    bindPointer();
    var rsz; window.addEventListener('resize', function () { clearTimeout(rsz); rsz = setTimeout(render, 150); });
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('rm');
    }
    // deep link ?s=SYMBOL
    var m = /[?&]s=([A-Za-z0-9/-]+)/.exec(location.search);
    var start = m ? m[1].toUpperCase() : 'NEPSE';
    if (input) input.value = start;
    setSymbol(start);
    // live auto-refresh during market hours (skipped when tab is hidden)
    setInterval(function () {
      if (document.hidden || !marketOpenNPT() || state.mode !== 'stock') return;
      loadLive().then(function () {
        var rows = histCache[state.sym] || [];
        if (!rows.length) return;
        var merged = applyLiveCandle(rows, state.sym);
        state.rows = merged.rows;
        state.live = merged.quote || liveCache.map[state.sym] || null;
        state.liveBadge = merged.live ? 'live' : 'eod';
        render();
      });
    }, 60000);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  /* node test exports */
  var API = {
    smaArr: smaArr, emaArr: emaArr, rsiArr: rsiArr, macd: macd, atrArr: atrArr,
    fractalPivots: fractalPivots, swingPivots: swingPivots, toWeekly: toWeekly,
    detectDivergences: detectDivergences, detectPatterns: detectPatterns,
    computeVerdict: computeVerdict, setSymbol: setSymbol, SRC: SRC,
    _testHooks: { detRecomputes: 0 }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else window.NL_ANALYTICS = API;
})();
