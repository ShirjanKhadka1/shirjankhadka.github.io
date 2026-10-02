/* ============================================================
   NEPSE INDEX CANDLES — homepage market-overview candlestick chart
   ------------------------------------------------------------
   Renders the NEPSE index as an interactive candlestick chart with
   timeframe pills (1D / 1W / 1M / 1Y / 5Y), a volume histogram, a
   close-price area overlay, and a live session candle that updates
   as new snapshots arrive. The chart is scrollable (drag / wheel /
   pinch) without trapping vertical page scroll on touch.

   Ranges are deliberately dense — every view shows a real,
   scrollable history, not a handful of candles:
     1D → daily candles, trailing 120 sessions  (~6 months)
     1W → daily candles, trailing 260 sessions  (~1 year)
     1M → daily candles, trailing 520 sessions  (~2 years)
     1Y → weekly candles (Mon–Fri), trailing 260 weeks (5 years)
     5Y → monthly candles, full available history
   No support/resistance lines, no annotations — pure price + volume.

   Data — real data only, nothing synthetic:
   - Daily OHLCV: window.NEPSE_DAILY from /js/nepse-daily.js
                   ([YYYYMMDD, open, high, low, close, volume]).
   - Deep history: /data/index-history.json (lazy-loaded on demand
                   for 1M / 1Y / 5Y).
   - Today:       live snapshot via NepseData.subscribe() — zero
                   extra network requests; updates ride the page's
                   existing 15-minute refresh. The index snapshot
                   carries no volume, so the forming session candle
                   plots no volume bar (never fabricated).
   There is no intraday index archive, so the finest resolution is
   the daily candle — 1D shows daily history like a real chart app.

   The charting library (/js/vendor/lightweight-charts) is lazy-
   loaded when the block nears the viewport. If it fails, a plain
   canvas fallback draws from index-spark.json — never a blank box.
   ============================================================ */
(function () {
  'use strict';

  var MOUNT_ID = 'nicChart';
  var FALLBACK_ID = 'nicFallback';
  var VENDOR_SRC = '/js/vendor/lightweight-charts.standalone.production.js';
  var DAILY_SRC = '/js/nepse-daily.js?v=51f68f5d';
  var HIST_SRC = '/data/index-history.json';
  var SPARK_SRC = '/nepse-chart/data/index-spark.json';

  // key → candle resolution + trailing depth (all real sessions).
  var RANGES = [
    { key: '1D', res: '1D', depth: 120, hist: false },
    { key: '1W', res: '1D', depth: 260, hist: false },
    { key: '1M', res: '1D', depth: 520, hist: true },
    { key: '1Y', res: '1W', depth: 260, hist: true },
    { key: '5Y', res: '1M', depth: 120, hist: true }
  ];
  var DEFAULT_RANGE = '1D';

  var UP = '#2ebd85', DOWN = '#f23645';
  var VOL_UP = 'rgba(46,189,133,0.45)', VOL_DOWN = 'rgba(242,54,69,0.45)';

  var scriptCache = {};
  var chart = null, candleSeries = null, areaSeries = null, volumeSeries = null, priceLine = null;
  var allCandles = [];      // merged daily history + live candle, ascending
  var currentRange = DEFAULT_RANGE, lastBarTime = null;
  var histLoaded = false, histLoading = false;
  var started = false;

  function $(id) { return document.getElementById(id); }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function rangeDef(key) {
    for (var i = 0; i < RANGES.length; i++) if (RANGES[i].key === key) return RANGES[i];
    return RANGES[0];
  }

  /* ---------- tiny helpers ---------- */

  function loadScriptOnce(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script failed: ' + src)); };
      document.head.appendChild(s);
    });
    return scriptCache[src];
  }

  // ISO timestamp -> NPT calendar date 'YYYY-MM-DD' (NPT = UTC+5:45).
  function nptDateStr(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var npt = new Date(t + (5 * 60 + 45) * 60000);
    return npt.getUTCFullYear() + '-' + pad(npt.getUTCMonth() + 1) + '-' + pad(npt.getUTCDate());
  }

  // Compact volume axis labels: 1.87B / 42.10M / 900.5K (display only).
  function fmtVol(v) {
    v = +v;
    if (!isFinite(v)) return '';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function rowToCandle(r) {
    var d = String(r[0]);
    var o = +r[1], h = +r[2], l = +r[3], c = +r[4], v = +r[5];
    if (!/^\d{8}$/.test(d)) return null;
    if (![o, h, l, c].every(isFinite) || h < l || o <= 0 || c <= 0) return null;
    return {
      time: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8),
      open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c,
      volume: isFinite(v) && v > 0 ? v : 0
    };
  }

  // Today's session as one OHLC candle from the live snapshot.
  // NEPSE opens at/near the previous close, so open falls back to it.
  // The snapshot carries no index volume — volume stays 0 (never faked).
  function liveCandle(snapshot) {
    if (!snapshot || !snapshot.index) return null;
    var ix = snapshot.index;
    var date = nptDateStr(snapshot.asof);
    var prev = +ix.previous_close;
    var open = (isFinite(+ix.open) && +ix.open > 0) ? +ix.open : prev;
    var close = +ix.value, high = +ix.high, low = +ix.low;
    if (!date || ![open, high, low, close, prev].every(isFinite)) return null;
    if (high < low || open <= 0 || close <= 0) return null;
    return {
      time: date, open: open,
      high: Math.max(high, open, close), low: Math.min(low, open, close),
      close: close, volume: 0, live: true
    };
  }

  function mergeCandles(dailyRows, live) {
    var byTime = {}, out = [];
    dailyRows.forEach(function (r) {
      var c = rowToCandle(r);
      if (c && !byTime[c.time]) { byTime[c.time] = true; out.push(c); }
    });
    out.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
    if (live) {
      var last = out[out.length - 1];
      if (!last || live.time > last.time) out.push(live);
      else if (live.time === last.time) {
        // Keep the archived volume when the live snapshot has none.
        if (!live.volume && last.volume) live.volume = last.volume;
        out[out.length - 1] = live;
      }
    }
    return out;
  }

  // Monday (NPT calendar) of the week containing dateStr — NEPSE is Mon–Fri.
  function mondayOf(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Daily candles → weekly ('1W') or monthly ('1M') aggregates, ascending.
  function aggregate(candles, res) {
    if (res === '1D') return candles.slice();
    var out = [], cur = null, curKey = null;
    candles.forEach(function (c) {
      var key = res === '1W' ? mondayOf(c.time) : c.time.slice(0, 7) + '-01';
      if (key !== curKey) {
        cur = {
          time: key, open: c.open, high: c.high, low: c.low, close: c.close,
          volume: c.volume || 0, live: !!c.live
        };
        curKey = key;
        out.push(cur);
      } else {
        cur.high = Math.max(cur.high, c.high);
        cur.low = Math.min(cur.low, c.low);
        cur.close = c.close;
        cur.volume = (cur.volume || 0) + (c.volume || 0);
        if (c.live) cur.live = true;
      }
    });
    return out;
  }

  /* ---------- chart chrome (theme-aware) ---------- */

  function chrome() {
    var dark = isDark();
    return {
      text: dark ? '#d8d3c3' : '#57534a',
      grid: dark ? 'rgba(255,255,255,0.055)' : 'rgba(60,50,30,0.07)',
      border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(60,50,30,0.10)',
      cross: dark ? 'rgba(255,255,255,0.35)' : 'rgba(60,50,30,0.35)'
    };
  }

  function areaColors(up) {
    return up
      ? { line: 'rgba(46,189,133,0.9)', top: 'rgba(46,189,133,0.28)', bottom: 'rgba(46,189,133,0.0)' }
      : { line: 'rgba(242,54,69,0.9)', top: 'rgba(242,54,69,0.30)', bottom: 'rgba(242,54,69,0.0)' };
  }

  function buildChart(mount) {
    var p = chrome();
    chart = window.LightweightCharts.createChart(mount, {
      width: mount.clientWidth || 600,
      height: mount.clientHeight || 340,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: p.text, fontSize: 11,
        fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border, timeVisible: false, rightOffset: 5, barSpacing: 9 },
      crosshair: {
        vertLine: { color: p.cross, labelBackgroundColor: DOWN },
        horzLine: { color: p.cross, labelBackgroundColor: DOWN }
      },
      // Scrollable/zoomable time axis; vertical touch drag stays with the page.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
    });
    candleSeries = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
      priceLineVisible: false, lastValueVisible: false
    });
    areaSeries = chart.addAreaSeries({
      lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    });
    volumeSeries = chart.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'custom', formatter: fmtVol },
      lastValueVisible: false, priceLineVisible: false
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    new ResizeObserver(function () {
      if (chart) chart.applyOptions({ width: mount.clientWidth, height: mount.clientHeight });
    }).observe(mount);

    new MutationObserver(function (muts) {
      var hit = muts.some(function (m) { return m.attributeName === 'data-theme'; });
      if (hit && chart) {
        var q = chrome();
        chart.applyOptions({
          layout: { textColor: q.text },
          grid: { vertLines: { color: q.grid }, horzLines: { color: q.grid } },
          rightPriceScale: { borderColor: q.border },
          timeScale: { borderColor: q.border },
          crosshair: { vertLine: { color: q.cross }, horzLine: { color: q.cross } }
        });
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ---------- ranges ---------- */

  function seriesFor(rangeKey) {
    var def = rangeDef(rangeKey);
    return aggregate(allCandles, def.res).slice(-def.depth);
  }

  function resName(res) {
    return res === '1D' ? 'daily' : (res === '1W' ? 'weekly' : 'monthly');
  }

  function setPriceLine(bar) {
    if (priceLine) { try { candleSeries.removePriceLine(priceLine); } catch (e) {} priceLine = null; }
    priceLine = candleSeries.createPriceLine({
      price: bar.close,
      color: bar.close >= bar.open ? UP : DOWN,
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: ''
    });
  }

  function paintRange(key) {
    var data = seriesFor(key);
    if (!data.length || !candleSeries) return;
    var def = rangeDef(key);
    currentRange = key;
    var up = data[data.length - 1].close >= data[0].open;
    var ac = areaColors(up);
    candleSeries.setData(data.map(function (c) {
      return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
    }));
    areaSeries.setData(data.map(function (c) { return { time: c.time, value: c.close }; }));
    areaSeries.applyOptions({ lineColor: ac.line, topColor: ac.top, bottomColor: ac.bottom });
    volumeSeries.setData(data.map(function (c) {
      return { time: c.time, value: c.volume || 0, color: c.close >= c.open ? VOL_UP : VOL_DOWN };
    }));
    setPriceLine(data[data.length - 1]);
    lastBarTime = data[data.length - 1].time;
    chart.timeScale().fitContent();
    var mount = $(MOUNT_ID);
    var first = data[0], last = data[data.length - 1];
    if (mount) mount.setAttribute('aria-label',
      'NEPSE index candlestick chart with volume, range ' + key + ' (' + resName(def.res) + '): ' +
      data.length + ' bars, ' + first.time + ' to ' + last.time +
      ', last close ' + last.close.toFixed(2));
    document.querySelectorAll('.nic-pills button').forEach(function (b) {
      var on = b.getAttribute('data-range') === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Update only the forming bar in place (keeps the user's scroll position).
  function updateLastBar(bar) {
    var up = bar.close >= bar.open;
    candleSeries.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    volumeSeries.update({ time: bar.time, value: bar.volume || 0, color: up ? VOL_UP : VOL_DOWN });
    areaSeries.update({ time: bar.time, value: bar.close });
    setPriceLine(bar);
    lastBarTime = bar.time;
  }

  function ensureHistoryThen(key) {
    var def = rangeDef(key);
    if (!def.hist || histLoaded || histLoading) { paintRange(key); return; }
    histLoading = true;
    var btn = document.querySelector('.nic-pills button[data-range="' + key + '"]');
    var orig = btn ? btn.textContent : key;
    if (btn) { btn.disabled = true; btn.textContent = key + '…'; }
    fetch(HIST_SRC, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('history ' + r.status);
      return r.json();
    }).then(function (j) {
      var rows = (j && j.rows) || [];
      var have = {};
      allCandles.forEach(function (c) { have[c.time] = true; });
      var extra = [];
      rows.forEach(function (r) {
        var c = rowToCandle(r);
        if (c && !have[c.time]) { have[c.time] = true; extra.push(c); }
      });
      allCandles = extra.concat(allCandles).sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      histLoaded = true;
      paintRange(key);
    }).catch(function () { paintRange(currentRange); })
    .then(function () {
      histLoading = false;
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    });
  }

  /* ---------- data wiring ---------- */

  function refreshFromSnapshot(snapshot) {
    var live = liveCandle(snapshot);
    if (!live) return;
    var rows = window.NEPSE_DAILY || [];
    allCandles = mergeCandles(rows, live);
    if (!chart) return;
    var data = seriesFor(currentRange);
    var last = data[data.length - 1];
    if (last && last.time === lastBarTime) {
      updateLastBar(last);   // same session: nudge the forming bar, keep scroll
    } else {
      paintRange(currentRange); // new session rolled over: repaint
    }
  }

  /* ---------- fallback (no library) ---------- */

  function showFallback() {
    var mount = $(MOUNT_ID), fb = $(FALLBACK_ID);
    if (mount) mount.hidden = true;
    if (!fb) return;
    fb.hidden = false;
    fb.innerHTML = '<canvas id="nicFbCanvas" role="img" aria-label="NEPSE closing levels, recent sessions"></canvas>' +
      '<p class="nic-fb-note">Interactive chart unavailable — showing recent closes.</p>';
    fetch(SPARK_SRC, { cache: 'force-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      var arr = j.closes || j.series || j.data || [];
      var pts = arr.map(function (r) { return +r[1]; }).filter(isFinite);
      if (!pts.length) return;
      var cv = $('nicFbCanvas');
      if (!cv) return;
      var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = 220;
      cv.width = W * dpr; cv.height = H * dpr;
      var c = cv.getContext('2d'); c.scale(dpr, dpr);
      var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), rg = (mx - mn) || 1;
      var up = pts[pts.length - 1] >= pts[0];
      var X = function (i) { return 4 + i * (W - 8) / (pts.length - 1); };
      var Y = function (v) { return 8 + (1 - (v - mn) / rg) * (H - 16); };
      c.beginPath();
      pts.forEach(function (v, i) { if (i === 0) c.moveTo(X(i), Y(v)); else c.lineTo(X(i), Y(v)); });
      c.strokeStyle = up ? UP : DOWN; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
      c.lineTo(X(pts.length - 1), H); c.lineTo(X(0), H); c.closePath();
      var g = c.createLinearGradient(0, 0, 0, H);
      var ac = areaColors(up);
      g.addColorStop(0, ac.top); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fill();
    }).catch(function () { /* leave the note */ });
  }

  /* ---------- boot ---------- */

  function init() {
    if (started) return;
    started = true;
    var mount = $(MOUNT_ID);
    if (!mount || !window.NepseData) { showFallback(); return; }
    var loading = mount.querySelector('.nic-loading');
    Promise.all([
      loadScriptOnce(VENDOR_SRC),
      window.NEPSE_DAILY ? Promise.resolve() : loadScriptOnce(DAILY_SRC)
    ]).then(function () {
      if (!window.LightweightCharts || !window.NEPSE_DAILY || !window.NEPSE_DAILY.length) throw new Error('deps');
      if (loading) loading.remove();
      buildChart(mount);
      // Pills
      document.querySelectorAll('.nic-pills button').forEach(function (b) {
        b.addEventListener('click', function () { ensureHistoryThen(b.getAttribute('data-range')); });
      });
      // Seed + live updates ride the page's existing snapshot flow (no extra requests).
      var seed = window.NepseData.getSnapshot ? window.NepseData.getSnapshot() : null;
      refreshFromSnapshot(seed);
      if (!allCandles.length) throw new Error('no data');
      paintRange(DEFAULT_RANGE);
      window.NepseData.subscribe(function (snapshot) { refreshFromSnapshot(snapshot); });
    }).catch(function () { showFallback(); });
  }

  function boot() {
    var mount = $(MOUNT_ID);
    if (!mount) return;
    var kicked = false;
    function kick() { if (!kicked) { kicked = true; init(); } }
    try {
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (es) {
          if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); kick(); }
        }, { rootMargin: '400px' });
        io.observe(mount);
        setTimeout(kick, 6000); // safety: never leave the block uninitialized
      } else { kick(); }
    } catch (e) { kick(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();