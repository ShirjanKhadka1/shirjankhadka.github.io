/* ============================================================
   NEPSE INDEX CHART — candlestick module (vendored Lightweight Charts)
   Placed after #nl-livebar, before #nl-verdict on /nepse-chart/.

   Timeframes:
     1D        intraday line from nepse-chart/data/intraday-index.json
               (real 15-min observations, 10:45-15:00 NPT; never invented)
     1W/1M/1Y/5Y  daily candlesticks from window.NEPSE_DAILY (real OHLC)

   Stats (Open, High, Low, Prev. close, Turnover, Transactions) bind to
   real data only — live.json's index snapshot and the daily archive.
   Anything missing renders as an em dash, never 0.00.
   ============================================================ */
(function () {
  'use strict';

  var MOUNT_ID = 'nl-index-chart';
  var TF_KEY = 'nl-index-tf';

  var TFS = [
    { id: '1D', label: '1D' },
    { id: '1W', label: '1W' },
    { id: '1M', label: '1M' },
    { id: '1Y', label: '1Y' },
    { id: '5Y', label: '5Y' },
  ];
  var TF_DAYS = { '1W': 5, '1M': 22, '1Y': 250, '5Y': 1250 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function dash(v) { return v == null || v === '' || !isFinite(Number(v)); }
  function fmtNum(v, dp) {
    if (dash(v)) return '—';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp,
    });
  }
  function fmtInt(v) {
    if (dash(v)) return '—';
    return Math.round(Number(v)).toLocaleString('en-US');
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function themeColors() {
    if (isDark()) {
      return {
        bg: '#141310', text: '#E9E4D6', grid: '#2B2922', border: '#3A372C',
        up: '#3DDC84', down: '#FF6B5E', line: '#C9A86F',
        cross: '#8A8474',
      };
    }
    return {
      bg: '#FBF9F4', text: '#1C1A15', grid: '#EAE3D2', border: '#E0D6BE',
      up: '#0E6B3A', down: '#B23A2E', line: '#8A6D3B',
      cross: '#8A8474',
    };
  }

  /* ---------- data ---------- */

  // Daily rows: [YYYYMMDD, open, high, low, close, volume]
  function dailyRows() {
    var rows = window.NEPSE_DAILY || [];
    return rows.filter(function (r) {
      return r && r.length >= 5 && isFinite(r[3]) && isFinite(r[4]);
    });
  }

  function candlesFor(tf) {
    var rows = dailyRows();
    var n = TF_DAYS[tf] || 22;
    var slice = rows.slice(-n);
    return slice.map(function (r) {
      var ymd = String(r[0]);
      var iso = ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
      return { time: iso, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
    });
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /* ---------- stats ---------- */

  // All stats from real data only. live.json's index has no open/turnover/
  // transactions — those render as em dashes until the feed supplies them.
  function statsHTML(liveIdx, dailyRowsArr) {
    var last = dailyRowsArr.length ? dailyRowsArr[dailyRowsArr.length - 1] : null;
    // Open: live.json carries no open — renders as em dash until the feed
    // supplies real intraday data. Never borrow a different session's open.
    var open = null;
    var high = liveIdx && liveIdx.high != null ? liveIdx.high : null;
    var low = liveIdx && liveIdx.low != null ? liveIdx.low : null;
    var prevClose = liveIdx && liveIdx.previous_close != null ? liveIdx.previous_close
      : (dailyRowsArr.length > 1 ? dailyRowsArr[dailyRowsArr.length - 2][4] : null);
    var turnover = liveIdx && liveIdx.turnover != null ? liveIdx.turnover : null;
    var txns = liveIdx && liveIdx.transactions != null ? liveIdx.transactions : null;
    function stat(k, v) {
      return '<div class="nl-ix-stat"><span class="nl-ix-k">' + k + '</span>' +
        '<span class="nl-ix-v tnum">' + esc(v) + '</span></div>';
    }
    return stat('Open', fmtNum(open)) +
      stat('High', fmtNum(high)) +
      stat('Low', fmtNum(low)) +
      stat('Prev. close', fmtNum(prevClose)) +
      stat('Turnover', turnover == null ? '—' : 'Rs ' + fmtInt(turnover)) +
      stat('Transactions', fmtInt(txns));
  }

  /* ---------- chart ---------- */

  var chart = null, series = null, currentTf = null;

  function mountHTML() {
    var tabs = TFS.map(function (t) {
      return '<button type="button" data-tf="' + t.id + '" role="tab" aria-selected="false">' +
        t.label + '</button>';
    }).join('');
    return '<div class="nl-ix-head">' +
      '<div><p class="d2-kicker">Benchmark</p><h2>NEPSE Index</h2></div>' +
      '<div class="nl-ix-tabs" role="tablist" aria-label="Index timeframe">' + tabs + '</div>' +
      '</div>' +
      '<div class="nl-ix-stats" id="nl-ix-stats" aria-label="Session statistics"></div>' +
      '<div class="nl-ix-chart" id="nl-ix-chart" role="img" aria-label="NEPSE index price chart"></div>' +
      '<p class="nl-ix-note" id="nl-ix-note" hidden></p>' +
      '<p class="nl-ix-foot">Source: NEPSE · Market data delayed 15 minutes</p>';
  }

  function makeChart() {
    var el = $('nl-ix-chart');
    if (!el || !window.LightweightCharts) return false;
    var c = themeColors();
    if (chart) { try { chart.remove(); } catch (e) {} chart = null; series = null; }
    chart = window.LightweightCharts.createChart(el, {
      width: el.clientWidth || 800,
      height: 340,
      layout: {
        background: { type: 'solid', color: c.bg },
        textColor: c.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: c.grid },
        horzLines: { color: c.grid },
      },
      crosshair: {
        vertLine: { color: c.cross, labelBackgroundColor: c.cross },
        horzLine: { color: c.cross, labelBackgroundColor: c.cross },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false },
    });
    function onResize() {
      if (chart && el) chart.applyOptions({ width: el.clientWidth || 800 });
    }
    window.addEventListener('resize', onResize);
    return true;
  }

  function applyTheme() {
    if (!chart) return;
    var c = themeColors();
    chart.applyOptions({
      layout: { background: { type: 'solid', color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
    });
    if (series) {
      if (currentTf === '1D') {
        series.applyOptions({ color: c.line, lineWidth: 2 });
      } else {
        series.applyOptions({
          upColor: c.up, downColor: c.down,
          wickUpColor: c.up, wickDownColor: c.down,
          borderVisible: false,
        });
      }
    }
  }

  function setNote(msg) {
    var n = $('nl-ix-note');
    if (!n) return;
    if (msg) { n.textContent = msg; n.hidden = false; }
    else { n.hidden = true; n.textContent = ''; }
  }

  function markTab(tf) {
    var btns = document.querySelectorAll('#' + MOUNT_ID + ' [data-tf]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-tf') === tf;
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  function toUTCTime(iso) {
    var ms = Date.parse(iso);
    return isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  function render1D() {
    currentTf = '1D';
    setNote(null);
    fetchJSON('/nepse-chart/data/intraday-index.json').then(function (d) {
      var obs = (d && d.obs) || [];
      var c = themeColors();
      series = chart.addLineSeries({ color: c.line, lineWidth: 2, priceLineVisible: true });
      var pts = [];
      obs.forEach(function (o) {
        var t = toUTCTime(o.t);
        if (t != null && o.v != null && isFinite(Number(o.v))) {
          pts.push({ time: t, value: Number(o.v) });
        }
      });
      if (!pts.length) {
        setNote('Intraday observations build through the session (10:45–15:00 NPT). Check back during market hours.');
      }
      series.setData(pts);
      chart.timeScale().fitContent();
    }).catch(function () {
      setNote('Intraday data is not available yet — it builds through the trading session (10:45–15:00 NPT).');
    });
  }

  function renderDaily(tf) {
    currentTf = tf;
    setNote(null);
    var data = candlesFor(tf);
    var c = themeColors();
    series = chart.addCandlestickSeries({
      upColor: c.up, downColor: c.down,
      wickUpColor: c.up, wickDownColor: c.down,
      borderVisible: false,
    });
    series.setData(data);
    if (!data.length) {
      setNote('Daily history is unavailable right now.');
    }
    chart.timeScale().fitContent();
  }

  function render(tf) {
    if (!chart && !makeChart()) {
      setNote('Chart library failed to load.');
      return;
    }
    try { chart.remove(); } catch (e) {}
    chart = null; series = null;
    makeChart();
    markTab(tf);
    try { localStorage.setItem(TF_KEY, tf); } catch (e) {}
    if (tf === '1D') render1D();
    else renderDaily(tf);
  }

  function paintStats() {
    var host = $('nl-ix-stats');
    if (!host) return;
    var rows = dailyRows();
    fetchJSON('/nepse-chart/data/live.json').then(function (live) {
      host.innerHTML = statsHTML(live && live.index, rows);
    }).catch(function () {
      host.innerHTML = statsHTML(null, rows);
    });
  }

  function init() {
    var mount = $(MOUNT_ID);
    if (!mount || !window.LightweightCharts) return;
    mount.innerHTML = mountHTML();
    var btns = mount.querySelectorAll('[data-tf]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { render(this.getAttribute('data-tf')); });
    }
    var tf = '1D';
    try { tf = localStorage.getItem(TF_KEY) || '1D'; } catch (e) {}
    if (!TF_DAYS[tf] && tf !== '1D') tf = '1D';
    paintStats();
    // NEPSE_DAILY may still be loading (deferred); wait briefly.
    var tries = 0;
    (function waitDaily() {
      if ((window.NEPSE_DAILY && window.NEPSE_DAILY.length) || tries++ > 40) render(tf);
      else setTimeout(waitDaily, 100);
    })();
    // Re-theme when the user toggles light/dark.
    new MutationObserver(function () { applyTheme(); }).observe(
      document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
