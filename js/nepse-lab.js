/* NEPSE Chart Lab — interactive candlestick chart engine.
   Data: window.NEPSE_DAILY = [YYYYMMDD, open, high, low, close, volume], daily sessions.
   Indicators (SMA20/50, RSI14) and SMA-crossover markers are computed client-side
   from the same daily series. Rule-based and educational — not AI, not advice. */
(function () {
  'use strict';
  var DAILY = window.NEPSE_DAILY || [];
  if (!DAILY.length) return;

  var UP = '#16a34a', DOWN = '#dc2626', GRID = '#e8edf3', TXT = '#64748b',
      SMA20C = '#2563eb', SMA50C = '#d97706', ATHC = '#c9a227';

  var state = { tf: '1Y', style: 'candles', sma: true, rsi: true, signals: true, hover: -1 };

  var TF_SESSIONS = { '1M': 22, '3M': 66, '6M': 132, '1Y': 252 };
  var WARM = 80; // extra sessions before the visible window for indicator warm-up

  function sma(vals, n) {
    var out = new Array(vals.length).fill(null), s = 0;
    for (var i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function rsi(closes, n) {
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
  function isoWeekKey(ymd) {
    var y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100;
    var dt = new Date(Date.UTC(y, m - 1, d));
    var day = (dt.getUTCDay() + 6) % 7; // Mon=0
    dt.setUTCDate(dt.getUTCDate() - day + 3); // Thursday of this week
    var firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    var fday = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
    var wk = 1 + Math.round((dt - firstThu) / (7 * 864e5));
    return dt.getUTCFullYear() * 100 + wk;
  }
  function toWeekly(rows) {
    var out = [], cur = null, key = -1;
    rows.forEach(function (r) {
      var k = isoWeekKey(r[0]);
      if (k !== key) { if (cur) out.push(cur); key = k; cur = [r[0], r[1], r[2], r[3], r[4], r[5]]; }
      else {
        cur[0] = r[0];
        if (r[2] > cur[2]) cur[2] = r[2];
        if (r[3] < cur[3]) cur[3] = r[3];
        cur[4] = r[4]; cur[5] += r[5];
      }
    });
    if (cur) out.push(cur);
    return out;
  }
  function fmtDate(ymd) {
    var s = String(ymd);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  function fmtTick(ymd, weekly) {
    var s = String(ymd), m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s.slice(4, 6) - 1];
    return weekly ? m + " '" + s.slice(2, 4) : m + ' ' + s.slice(6, 8);
  }
  function num(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d || 2, maximumFractionDigits: d || 2 }); }
  function bigVol(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(v);
  }

  /* ---- series for current timeframe (with warm-up history for indicators) ---- */
  function currentSeries() {
    var tf = state.tf, rows, weekly = false, viewLen;
    if (tf === '5Y' || tf === 'All') {
      weekly = true;
      var all = toWeekly(DAILY);
      viewLen = tf === '5Y' ? 262 : all.length;
      rows = all.slice(Math.max(0, all.length - viewLen - 70));
      return { rows: rows, warm: 70, weekly: true };
    }
    viewLen = TF_SESSIONS[tf];
    rows = DAILY.slice(Math.max(0, DAILY.length - viewLen - WARM));
    return { rows: rows, warm: WARM, weekly: false };
  }

  /* ---- canvases ---- */
  var mainC = document.getElementById('nl-chart'),
      rsiC = document.getElementById('nl-rsi'),
      tip = document.getElementById('nl-tip');
  if (!mainC) return;
  var mctx = mainC.getContext('2d'), rctx = rsiC.getContext('2d');
  var plot = { xs: [], view: null, geom: null, rsiGeom: null };

  function sizeCanvas(c, hCss) {
    var w = c.parentElement.clientWidth, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(hCss * dpr);
    c.style.width = w + 'px'; c.style.height = hCss + 'px';
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: hCss };
  }

  function render() {
    var ser = currentSeries(), rows = ser.rows, warm = ser.warm, weekly = ser.weekly;
    var n = Math.max(5, rows.length - warm);
    var view = rows.slice(rows.length - n);
    var closesAll = rows.map(function (r) { return r[4]; });
    var s20 = sma(closesAll, 20), s50 = sma(closesAll, 50), r14 = rsi(closesAll, 14);
    var vS20 = s20.slice(s20.length - n), vS50 = s50.slice(s50.length - n), vRsi = r14.slice(r14.length - n);

    var R = sizeCanvas(mainC, window.innerWidth < 640 ? 340 : 440);
    var padL = 8, padR = 64, padT = 14, padBv = 26;
    var volH = Math.round(R.h * 0.18), priceH = R.h - padT - volH - padBv - 8;
    var lo = Infinity, hi = -Infinity, vMax = 0, i;
    view.forEach(function (r) {
      if (r[3] < lo) lo = r[3]; if (r[2] > hi) hi = r[2];
      if (r[5] > vMax) vMax = r[5];
    });
    if (state.sma) {
      vS20.forEach(function (v) { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      vS50.forEach(function (v) { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    }
    var span = (hi - lo) || 1; lo -= span * 0.06; hi += span * 0.06;
    var pw = R.w - padL - padR;
    var step = pw / n, bw = Math.max(1, Math.min(14, step * 0.62));
    var X = function (idx) { return padL + step * idx + step / 2; };
    var Y = function (p) { return padT + priceH - (p - lo) / (hi - lo) * priceH; };

    mctx.clearRect(0, 0, R.w, R.h);
    mctx.font = '11px -apple-system, Inter, sans-serif';

    // gridlines + y labels
    mctx.strokeStyle = GRID; mctx.fillStyle = TXT; mctx.lineWidth = 1; mctx.textAlign = 'left';
    for (var gLine = 0; gLine <= 4; gLine++) {
      var pv = lo + (hi - lo) * gLine / 4, gy = Y(pv);
      mctx.beginPath(); mctx.moveTo(padL, gy); mctx.lineTo(R.w - padR + 8, gy); mctx.stroke();
      mctx.fillText(num(pv, 0), R.w - padR + 12, gy + 4);
    }
    // ATH line
    var ath = 3199.03;
    if (ath < hi && ath > lo) {
      var ay = Y(ath);
      mctx.strokeStyle = ATHC; mctx.setLineDash([5, 4]); mctx.lineWidth = 1.2;
      mctx.beginPath(); mctx.moveTo(padL, ay); mctx.lineTo(R.w - padR + 8, ay); mctx.stroke();
      mctx.setLineDash([]); mctx.fillStyle = ATHC;
      mctx.fillText('ATH ' + num(ath, 0), R.w - padR + 12, ay - 6);
    }
    // x labels
    mctx.fillStyle = TXT; mctx.textAlign = 'center';
    var ticks = 6;
    for (var t = 0; t < ticks; t++) {
      var ti = Math.round(t * (n - 1) / (ticks - 1));
      mctx.fillText(fmtTick(view[ti][0], weekly), X(ti), R.h - 8);
    }
    // volume bars
    if (vMax > 0) {
      var vy0 = padT + priceH + 8;
      view.forEach(function (r, idx) {
        var vh = r[5] / vMax * volH;
        mctx.fillStyle = r[4] >= r[1] ? 'rgba(22,163,74,.45)' : 'rgba(220,38,38,.45)';
        mctx.fillRect(X(idx) - bw / 2, vy0 + volH - vh, bw, vh);
      });
      mctx.fillStyle = TXT; mctx.textAlign = 'left';
      mctx.fillText('Vol ' + bigVol(vMax), padL + 2, vy0 + 10);
    }
    // candles / line
    plot.xs = [];
    if (state.style === 'candles') {
      view.forEach(function (r, idx) {
        var up = r[4] >= r[1], cx = X(idx);
        mctx.strokeStyle = up ? UP : DOWN; mctx.fillStyle = up ? UP : DOWN; mctx.lineWidth = 1;
        mctx.beginPath(); mctx.moveTo(cx, Y(r[2])); mctx.lineTo(cx, Y(r[3])); mctx.stroke();
        var bT = Y(Math.max(r[1], r[4])), bB = Y(Math.min(r[1], r[4]));
        mctx.fillRect(cx - bw / 2, bT, bw, Math.max(1, bB - bT));
        plot.xs.push(cx);
      });
    } else {
      mctx.strokeStyle = '#0f172a'; mctx.lineWidth = 1.8; mctx.beginPath();
      view.forEach(function (r, idx) { var cx = X(idx), cy = Y(r[4]); idx ? mctx.lineTo(cx, cy) : mctx.moveTo(cx, cy); plot.xs.push(cx); });
      mctx.stroke();
    }
    // SMA overlays
    function smaLine(vals, color) {
      mctx.strokeStyle = color; mctx.lineWidth = 1.4; mctx.beginPath();
      var started = false;
      vals.forEach(function (v, idx) {
        if (v == null) { started = false; return; }
        var cx = X(idx), cy = Y(v);
        started ? mctx.lineTo(cx, cy) : mctx.moveTo(cx, cy); started = true;
      });
      mctx.stroke();
    }
    if (state.sma) { smaLine(vS20, SMA20C); smaLine(vS50, SMA50C); }

    // crossover markers
    var markers = [];
    if (state.signals) {
      for (var mIdx = 1; mIdx < n; mIdx++) {
        var a0 = vS20[mIdx - 1], a1 = vS20[mIdx], b0 = vS50[mIdx - 1], b1 = vS50[mIdx];
        if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
        if (a0 <= b0 && a1 > b1) markers.push({ i: mIdx, type: 'buy' });
        else if (a0 >= b0 && a1 < b1) markers.push({ i: mIdx, type: 'sell' });
      }
      markers.forEach(function (mk) {
        var r = view[mk.i], cx = X(mk.i);
        mctx.fillStyle = mk.type === 'buy' ? UP : DOWN;
        if (mk.type === 'buy') {
          var by = Y(r[3]) + 12;
          mctx.beginPath(); mctx.moveTo(cx, by - 7); mctx.lineTo(cx - 5, by + 2); mctx.lineTo(cx + 5, by + 2); mctx.closePath(); mctx.fill();
        } else {
          var sy = Y(r[2]) - 12;
          mctx.beginPath(); mctx.moveTo(cx, sy + 7); mctx.lineTo(cx - 5, sy - 2); mctx.lineTo(cx + 5, sy - 2); mctx.closePath(); mctx.fill();
        }
      });
    }
    plot.view = view; plot.vS20 = vS20; plot.vS50 = vS50; plot.markers = markers;
    plot.geom = { padL: padL, padR: padR, padT: padT, priceH: priceH, lo: lo, hi: hi, n: n, X: X, Y: Y, R: R };

    // RSI pane
    var rWrap = document.getElementById('nl-rsi-wrap');
    if (state.rsi) {
      rWrap.style.display = '';
      var RR = sizeCanvas(rsiC, 110);
      var rpT = 8, rpH = RR.h - rpT - 20, rY = function (v) { return rpT + rpH - v / 100 * rpH; };
      rctx.clearRect(0, 0, RR.w, RR.h);
      rctx.font = '11px -apple-system, Inter, sans-serif';
      [70, 50, 30].forEach(function (lv) {
        rctx.strokeStyle = lv === 50 ? '#cbd5e1' : GRID; rctx.lineWidth = 1;
        if (lv !== 50) rctx.setLineDash([4, 4]);
        rctx.beginPath(); rctx.moveTo(padL, rY(lv)); rctx.lineTo(RR.w - padR + 8, rY(lv)); rctx.stroke();
        rctx.setLineDash([]); rctx.fillStyle = TXT; rctx.textAlign = 'left';
        rctx.fillText(String(lv), RR.w - padR + 12, rY(lv) + 4);
      });
      rctx.strokeStyle = '#7c3aed'; rctx.lineWidth = 1.6; rctx.beginPath();
      var rs = false;
      vRsi.forEach(function (v, idx) {
        if (v == null) { rs = false; return; }
        var cx = X(idx) * (RR.w / R.w), cy = rY(v);
        rs ? rctx.lineTo(cx, cy) : rctx.moveTo(cx, cy); rs = true;
      });
      rctx.stroke();
      rctx.fillStyle = TXT; rctx.textAlign = 'left';
      rctx.fillText('RSI (14)', padL + 2, rpT + 10);
      plot.rsiGeom = { X: X, wRatio: RR.w / R.w };
    } else { rWrap.style.display = 'none'; plot.rsiGeom = null; }

    renderStats(view, vRsi);
    drawHover();
  }

  function renderStats(view, vRsi) {
    var last = DAILY[DAILY.length - 1], prev = DAILY[DAILY.length - 2];
    var chg = last[4] - prev[4], pct = chg / prev[4] * 100;
    var win = DAILY.slice(-252), h52 = -Infinity, l52 = Infinity;
    win.forEach(function (r) { if (r[2] > h52) h52 = r[2]; if (r[3] < l52) l52 = r[3]; });
    var lastRsi = vRsi[vRsi.length - 1];
    var closes = DAILY.map(function (r) { return r[4]; });
    var s200 = sma(closes, 200), s200v = s200[s200.length - 1];
    var regime = last[4] >= s200v ? 'Above SMA 200 · uptrend regime' : 'Below SMA 200 · caution regime';
    function set(id, html, cls) {
      var el = document.getElementById(id); if (!el) return;
      el.innerHTML = html; el.className = 'nl-stat-v' + (cls ? ' ' + cls : '');
    }
    set('nl-last', num(last[4]));
    set('nl-chg', (chg >= 0 ? '+' : '') + num(chg) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)', chg >= 0 ? 'up' : 'down');
    set('nl-52h', num(h52, 0)); set('nl-52l', num(l52, 0));
    set('nl-rsi-v', lastRsi == null ? '—' : lastRsi.toFixed(1),
        lastRsi == null ? '' : (lastRsi >= 70 ? 'down' : lastRsi <= 30 ? 'up' : ''));
    set('nl-regime', regime, last[4] >= s200v ? 'up' : 'down');
    var ld = document.getElementById('nl-asof');
    if (ld) ld.textContent = 'Daily data through ' + fmtDate(last[0]) + ' · NEPSE index';
  }

  /* ---- crosshair ---- */
  function drawHover() {
    if (!plot.view || state.hover < 0 || state.hover >= plot.view.length) { tip.style.display = 'none'; return; }
    var g = plot.geom, idx = state.hover, r = plot.view[idx], cx = g.X(idx);
    mctx.save();
    mctx.strokeStyle = '#94a3b8'; mctx.setLineDash([4, 4]); mctx.lineWidth = 1;
    mctx.beginPath(); mctx.moveTo(cx, g.padT); mctx.lineTo(cx, g.padT + g.priceH); mctx.stroke();
    var cy = g.Y(r[4]);
    mctx.beginPath(); mctx.moveTo(g.padL, cy); mctx.lineTo(g.R.w - g.padR + 8, cy); mctx.stroke();
    mctx.setLineDash([]); mctx.restore();
    var chg = (r[4] - r[1]) / r[1] * 100;
    tip.innerHTML = '<b>' + fmtDate(r[0]) + '</b><span>O ' + num(r[1]) + ' · H ' + num(r[2]) +
      ' · L ' + num(r[3]) + ' · C ' + num(r[4]) + '</span><span class="' + (chg >= 0 ? 'up' : 'down') + '">' +
      (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>';
    tip.style.display = 'block';
    var tw = tip.offsetWidth, wrapW = mainC.parentElement.clientWidth;
    tip.style.left = Math.min(Math.max(8, cx - tw / 2), wrapW - tw - 8) + 'px';
    tip.style.top = '8px';
  }
  function nearestIdx(clientX) {
    var rect = mainC.getBoundingClientRect(), x = clientX - rect.left, best = -1, bd = 1e9;
    plot.xs.forEach(function (cx, i) { var d = Math.abs(cx - x); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  mainC.addEventListener('mousemove', function (e) { state.hover = nearestIdx(e.clientX); render(); });
  mainC.addEventListener('mouseleave', function () { state.hover = -1; render(); });
  mainC.addEventListener('touchmove', function (e) {
    if (e.touches.length) { state.hover = nearestIdx(e.touches[0].clientX); render(); }
  }, { passive: true });
  mainC.addEventListener('touchend', function () { state.hover = -1; render(); });

  /* ---- controls ---- */
  function segBtns(id, key, cb) {
    var wrap = document.getElementById(id); if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      wrap.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
      state[key] = b.dataset.v; state.hover = -1; render(); if (cb) cb();
    });
  }
  segBtns('nl-tf', 'tf');
  segBtns('nl-style', 'style');
  document.querySelectorAll('[data-tgl]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.tgl;
      state[k] = !state[k];
      b.classList.toggle('on', state[k]); b.setAttribute('aria-pressed', String(state[k]));
      state.hover = -1; render();
    });
  });

  var rT;
  window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(function () { state.hover = -1; render(); }, 120); });

  render();
})();
