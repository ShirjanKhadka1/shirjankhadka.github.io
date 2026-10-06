/* ============================================================
   NEPSE TECHNICAL — free chart workspace (vendored Lightweight Charts)
   /nepse-technical/

   A full technical chart for the NEPSE index and every listed stock,
   built on TradingView Lightweight Charts v4.2.3 (Apache 2.0,
   self-hosted at /js/vendor/ — no license key, no account needed).

   Data — real data only, nothing synthetic:
   - Stocks: daily OHLC from the open Nepse-All-Scraper dataset
     (https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/<SYM>.json)
     → rows [YYYYMMDD, open, high, low, close, volume].
   - LTP-only fallback: /nepse-chart/data/ltp/<SYM>.json for listed
     securities the scraper has no OHLC for (flagged honestly; overlays
     off — same rule as the Chart & signals lab).
   - NEPSE index: window.NEPSE_DAILY (inline, recent) merged with
     /data/index-history.json (2003 → 2024-08, lazy) → full history.
   - 15-minute intraday: our own snapshot archive
     (nepse-chart/data/intraday/quotes-YYYY-MM-DD.json for stocks,
     nepse-chart/data/intraday-index.json for the index), written every
     15 min during market hours by tools/build-intraday-quotes.js from the
     committed live.json — never polled faster (NEPSE rate-limit guard).
     Bars are built client-side: open = first ltp in the bucket,
     close = last, high/low = max/min of ltp, volume = last cumulative
     volume in the bucket minus the previous bucket's (session volume for
     the first bucket). Forward-only: before the archive starts, the 15m
     view shows an honest empty state.
   - Live session candle: NepseData snapshot (js/nepse-data.js), same
     staleness guards as the lab (quote older than 180 min is ignored;
     LIVE badge only while the market is actually open).
   - Symbol universe: /nepse-chart/data/universe.json.

   Session date: snapshot.session_date when available, else the last
   data row's date — never a fetch timestamp (see SESSION-DATE RULE).
   ============================================================ */
(function () {
  'use strict';

  /* ---------- constants ---------- */

  var MOUNT_ID = 'nt-chart';
  var LEGEND_ID = 'nt-legend';
  var VENDOR_OK = typeof window !== 'undefined' && !!window.LightweightCharts;

  var SRC = {
    universe: '/nepse-chart/data/universe.json',
    prices: function (s) { return 'https://samirwagle.github.io/Nepse-All-Scraper/docs/api/prices/' + s.replace('/', '-') + '.json'; },
    ltp: function (s) { return '/nepse-chart/data/ltp/' + s.replace('/', '-') + '.json'; },
    indexHistory: '/data/index-history.json',
    intraDir: '/nepse-chart/data/intraday/',
    intraIndex: '/nepse-chart/data/intraday-index.json'
  };
  var UNIVERSE_V = '20261002b'; // bump when universe.json is rebuilt
  var FUND_URL = '/nepse-chart/data/fundamentals.json';

  var fundCache = null; // {symbol: {eps_ttm, pe_ttm}} — loaded once, shared across symbols

  /* Timeframes: `slice` = how many daily sessions of history to show,
     `agg` = how many daily sessions form one candle (1 = daily candles).
     15m is the intraday timeframe — bars built client-side from our own
     15-minute snapshot archive (no backfill; honest empty state until the
     archive accumulates). 1D..1M are candle-period timeframes (resampled
     client-side from the same daily OHLCV — volume sums, never invented);
     3M..All keep the original daily-candle windows. */
  var TFS = [
    { id: '15m', intra: true },
    { id: '1D', slice: 66, agg: 1 },
    { id: '2D', slice: 132, agg: 2 },
    { id: '3D', slice: 132, agg: 3 },
    { id: '1W', slice: 500, agg: 5 },
    { id: '2W', slice: 500, agg: 10 },
    { id: '3W', slice: 1250, agg: 15 },
    { id: '1M', slice: 1250, agg: 22 },
    { id: '3M', slice: 66, agg: 1 },
    { id: '6M', slice: 132, agg: 1 },
    { id: '1Y', slice: 250, agg: 1 },
    { id: '2Y', slice: 500, agg: 1 },
    { id: '5Y', slice: 1250, agg: 1 },
    { id: 'All', slice: Infinity, agg: 1 }
  ];
  var TYPES = ['candles', 'line', 'area'];
  var OVERLAYS = [
    { id: 'vol', label: 'Volume', on: true },
    { id: 'sma20', label: 'SMA 20', on: true },
    { id: 'sma50', label: 'SMA 50', on: true },
    { id: 'sma200', label: 'SMA 200', on: false },
    { id: 'ema20', label: 'EMA 20', on: false }
  ];

  var LS = { sym: 'nt-sym', tf: 'nt-tf', type: 'nt-type', ov: 'nt-ov' };

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function missing(v) { return v == null || v === '' || !isFinite(Number(v)); }
  function fmtNum(v, dp) {
    if (missing(v)) return '—';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp
    });
  }
  function fmtInt(v) {
    if (missing(v)) return '—';
    return Math.round(Number(v)).toLocaleString('en-US');
  }
  function fmtSigned(v, dp) {
    if (missing(v)) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toLocaleString('en-US', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp
    });
  }
  function isoOf(ymd) {
    var s = String(ymd);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  function ymdOf(iso) { // 'YYYY-MM-DD' -> YYYYMMDD number
    return Number(String(iso).replace(/-/g, ''));
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) { // 'YYYY-MM-DD' -> '2 Oct 2026' (no weekday — never guessed)
    var p = String(iso || '').split('-');
    if (p.length !== 3) return '—';
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }
  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }
  function themeColors() {
    if (isDark()) {
      return {
        bg: '#151310', text: '#E9E4D6', grid: '#2B2922', border: '#3A372C',
        up: '#3DDC84', down: '#FF6B5E', line: '#C9A86F', cross: '#8A8474',
        volUp: 'rgba(61,220,132,0.45)', volDown: 'rgba(255,107,94,0.40)',
        sma20: '#4C9AFF', sma50: '#FFAB00', sma200: '#C377E0', ema20: '#36D1DC'
      };
    }
    return {
      bg: '#FFFFFF', text: '#1C1A15', grid: '#ECE5D3', border: '#DCD2B8',
      up: '#0E6B3A', down: '#B23A2E', line: '#8A6D3B', cross: '#8A8474',
      volUp: 'rgba(14,107,58,0.45)', volDown: 'rgba(178,58,46,0.35)',
      sma20: '#1D6FD1', sma50: '#C77E00', sma200: '#8E44AD', ema20: '#0E9AA7'
    };
  }
  function todayNPT() { // Kathmandu wall-clock via the UTC getters (UTC+5:45)
    return new Date(Date.now() + 5.75 * 3600e3);
  }
  function marketOpenNPT() {
    if (typeof window !== 'undefined' && window.NepseMarketConfig) {
      return window.NepseMarketConfig.isMarketOpen();
    }
    return false;
  }
  function parseMarketTime(s) {
    var t = String(s || '');
    if (!t) return NaN;
    if (!(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t))) t += '+05:45';
    return new Date(t).getTime();
  }
  function fetchJSON(url, timeout) {
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { rej(new Error('timeout')); }, timeout || 20000);
      fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) { clearTimeout(to); res(j); })
        .catch(function (e) { clearTimeout(to); rej(e); });
    });
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- state ---------- */

  var state = {
    sym: 'NEPSE', symName: 'NEPSE Index',
    tf: '1Y', type: 'candles',
    ov: { vol: true, sma20: true, sma50: true, sma200: false, ema20: false },
    rows: [],            // full [ymd, o, h, l, c, vol] sorted asc
    ltpOnly: false,
    names: {},           // sym -> company name
    live: null,          // latest quote (stocks) or index snapshot
    liveBadge: false,
    sessionDate: null,
    loading: false, err: '',
    intra: null,         // 15m cache: {sym, rows:[[epochSec,o,h,l,c,vol|null]], baseVol, empty}
    fund: null           // fundamentals row for the symbol (eps_ttm, pe_ttm), null if unavailable
  };

  var chart = null;
  var S = {};            // series handles: candles, line, area, vol, sma20, sma50, sma200, ema20
  var unsubLive = null;

  /* ---------- data ---------- */

  function loadUniverse() {
    return fetchJSON(SRC.universe + '?v=' + UNIVERSE_V).then(function (u) {
      var list = (u && u.symbols) || [];
      list.forEach(function (e) { if (e && e.s) state.names[e.s] = e.n || e.s; });
      return list;
    }).catch(function () { return []; });
  }

  function loadFundamentals() {
    // Cached for the page lifetime — one fetch, shared across symbol switches.
    if (fundCache) return Promise.resolve(fundCache);
    return fetchJSON(FUND_URL).then(function (d) {
      fundCache = (d && d.companies) || {};
      return fundCache;
    }).catch(function () {
      fundCache = {};
      return fundCache;
    });
  }

  /* Format a datetime like Merolagani: "2026/10/06 12:15:50" (NPT wall clock). */
  function fmtDateTimeNPT(ms) {
    if (!isFinite(ms) || ms <= 0) return '—';
    var d = new Date(ms + 5.75 * 3600e3); // shift to NPT, read via UTC getters
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  function setFund(id, text, cls) {
    var e = $(id);
    if (!e) return;
    e.textContent = text;
    e.classList.remove('up', 'down', 'strong');
    if (cls) e.classList.add(cls);
  }

  function paintFundamentals() {
    // Merolagani-style left panel. Fields we cannot source reliably stay "—".
    var rows = state.rows;
    var sym = state.sym;
    var isIndex = sym === 'NEPSE';
    setFund('nt-fund-name', state.symName || sym);
    if (!rows.length) return;
    var last = rows[rows.length - 1];
    var prev = rows.length > 1 ? rows[rows.length - 2] : null;
    var chg = prev ? last[4] - prev[4] : null;
    var pct = prev && prev[4] ? (chg / prev[4]) * 100 : null;

    setFund('nt-f-sector', '—');
    setFund('nt-f-shares', '—');
    setFund('nt-f-price', fmtNum(last[4]), chg == null ? '' : (chg > 0 ? 'up' : (chg < 0 ? 'down' : '')));
    setFund('nt-f-chg', (chg == null ? '—' : fmtSigned(pct, 2) + ' %'), chg == null ? '' : (chg > 0 ? 'up' : (chg < 0 ? 'down' : '')));

    // Last traded: live quote timestamp when fresh, else the session date.
    var traded = '—';
    var q = state.live;
    if (q && q.last_updated) {
      var ms = parseMarketTime(q.last_updated);
      if (isFinite(ms)) traded = fmtDateTimeNPT(ms);
    }
    if (traded === '—') {
      var sd = state.sessionDate || isoOf(last[0]);
      traded = sd ? String(sd).replace(/-/g, '/') : '—';
    }
    setFund('nt-f-traded', traded);

    // 52-week high/low from the last ~250 sessions of real chart data.
    var hi = null, lo = null;
    var from = Math.max(0, rows.length - 250);
    for (var i = from; i < rows.length; i++) {
      hi = hi == null ? rows[i][2] : Math.max(hi, rows[i][2]);
      lo = lo == null ? rows[i][3] : Math.min(lo, rows[i][3]);
    }
    setFund('nt-f-52w', fmtNum(hi) + '–' + fmtNum(lo));

    // 120-day average of closes.
    var n120 = Math.min(120, rows.length), s120 = 0;
    for (var j = rows.length - n120; j < rows.length; j++) s120 += rows[j][4];
    setFund('nt-f-avg120', rows.length ? fmtNum(s120 / n120) : '—');

    // 1-year yield: last close vs the close ~250 sessions ago.
    var y1 = null;
    if (rows.length > 250 && rows[rows.length - 251][4] > 0) {
      y1 = (last[4] / rows[rows.length - 251][4] - 1) * 100;
    }
    setFund('nt-f-yield1y', y1 == null ? '—' : fmtSigned(y1, 2) + '%',
      y1 == null ? '' : (y1 > 0 ? 'up' : (y1 < 0 ? 'down' : '')));

    // Fundamentals (quarterly archive) — honest "—" when the symbol is absent.
    var f = !isIndex && fundCache ? fundCache[sym] : null;
    setFund('nt-f-eps', f && isFinite(+f.eps_ttm) ? fmtNum(+f.eps_ttm) : '—');
    setFund('nt-f-pe', f && isFinite(+f.pe_ttm) ? fmtNum(+f.pe_ttm) : '—');
    setFund('nt-f-bv', '—');
    setFund('nt-f-pbv', '—');
    setFund('nt-f-div', '—');
    setFund('nt-f-bonus', '—');
    setFund('nt-f-right', '—');
  }

  function loadStock(sym) {
    return fetchJSON(SRC.prices(sym)).then(function (j) {
      var rows = (j.data || []).map(function (d) {
        return [ymdOf(d.date), +d.open || 0, +d.high || 0, +d.low || 0, +d.ltp || 0, +d.qty || 0];
      }).filter(function (r) { return r[4] > 0; });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      return { rows: rows, ltpOnly: false };
    }).catch(function () {
      // LTP-only fallback — open/high/low are never fabricated.
      return fetchJSON(SRC.ltp(sym)).then(function (j) {
        var rows = (j.rows || []).map(function (d) {
          return [d[0], d[1], d[1], d[1], d[1], d[2] || 0];
        }).filter(function (r) { return r[4] > 0; });
        rows.sort(function (a, b) { return a[0] - b[0]; });
        if (!rows.length) throw new Error('empty');
        return { rows: rows, ltpOnly: true };
      });
    });
  }

  function indexRows() {
    var rows = (window.NEPSE_DAILY || []).filter(function (r) {
      return r && r.length >= 5 && isFinite(r[4]) && r[4] > 0;
    }).map(function (r) { return [r[0], r[1], r[2], r[3], r[4], r[5] || 0]; });
    return fetchJSON(SRC.indexHistory).then(function (h) {
      var seen = {};
      rows.forEach(function (r) { seen[r[0]] = 1; });
      (h.rows || []).forEach(function (r) {
        if (r && r.length >= 5 && !seen[r[0]] && isFinite(r[4]) && r[4] > 0) {
          rows.push([r[0], r[1], r[2], r[3], r[4], r[5] || 0]);
        }
      });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      return rows;
    }).catch(function () {
      rows.sort(function (a, b) { return a[0] - b[0]; });
      return rows; // inline daily only — still real data
    });
  }

  function applyLiveToRows(rows, isIndex) {
    // Mirrors the lab's honesty guards: stale quotes are ignored, the live
    // candle is replaced (never duplicated) for today's session.
    var snap = null;
    try { snap = window.NepseData && window.NepseData.getSnapshot ? window.NepseData.getSnapshot() : null; } catch (e) {}
    if (snap && snap.session_date) state.sessionDate = snap.session_date;
    var q = isIndex ? (snap && snap.index) : (snap && snap.map && snap.map[state.sym]);
    state.live = q || null;
    state.liveBadge = false;
    if (!q) return { rows: rows, live: false };
    var ltp = isIndex ? q.value : q.ltp;
    var upd = q.last_updated;
    if (!ltp || !upd) return { rows: rows, live: false };
    var ageMin = (Date.now() - parseMarketTime(upd)) / 60000;
    if (!(ageMin >= 0) || ageMin > 180) return { rows: rows, live: false };
    var t = todayNPT();
    var ymd = t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
    var prev = isIndex ? q.previous_close : q.previous_close;
    var candle = [ymd, prev || ltp, q.high || ltp, q.low || ltp, ltp, q.volume || 0];
    var out = rows.slice();
    var last = out[out.length - 1];
    if (last && last[0] === ymd) out[out.length - 1] = candle;
    else if (!last || ymd > last[0]) out.push(candle);
    else return { rows: rows, live: false };
    state.liveBadge = marketOpenNPT() && ageMin < 45;
    return { rows: out, live: true };
  }

  /* ---------- indicators (client-side, transparent) ---------- */

  function closes(rows) { return rows.map(function (r) { return r[4]; }); }
  function sma(vals, n) {
    var out = new Array(vals.length), sum = 0;
    for (var i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= n) sum -= vals[i - n];
      out[i] = i >= n - 1 ? sum / n : null;
    }
    return out;
  }
  function ema(vals, n) {
    var out = new Array(vals.length), k = 2 / (n + 1), prev = null;
    for (var i = 0; i < vals.length; i++) {
      prev = prev == null ? vals[i] : vals[i] * k + prev * (1 - k);
      out[i] = i >= n - 1 ? prev : null;
    }
    return out;
  }
  /* ---------- chart ---------- */

  function tfDef() {
    for (var i = 0; i < TFS.length; i++) if (TFS[i].id === state.tf) return TFS[i];
    for (var j = 0; j < TFS.length; j++) if (TFS[j].id === '1Y') return TFS[j];
    return TFS[0];
  }

  function resample(rows, n) {
    // Aggregate every n daily sessions into one candle: open = first open,
    // high/low = extremes, close = last close, volume = sum. Real data only.
    if (n <= 1 || !rows.length) return rows;
    var out = [];
    for (var i = 0; i < rows.length; i += n) {
      var chunk = rows.slice(i, i + n);
      var o = chunk[0][1], h = -Infinity, l = Infinity, v = 0, j;
      for (j = 0; j < chunk.length; j++) {
        if (chunk[j][2] > h) h = chunk[j][2];
        if (chunk[j][3] < l) l = chunk[j][3];
        v += chunk[j][5] || 0;
      }
      out.push([chunk[chunk.length - 1][0], o, h, l, chunk[chunk.length - 1][4], v]);
    }
    return out;
  }

  function viewRows() {
    // Daily rows sliced to the timeframe window, resampled to the candle period.
    var d = tfDef(), full = state.rows;
    var sliced = d.slice === Infinity ? full : full.slice(-d.slice);
    return resample(sliced, d.agg);
  }

  /* ---------- 15-minute intraday (own snapshot archive) ---------- */

  function epochOf(iso) { return Math.floor(new Date(iso).getTime() / 1000); }

  function fmtTimeNPT(sec) {
    // '2 Oct 2026, 11:45 NPT' — wall clock via the UTC getters (UTC+5:45).
    var d = new Date(sec * 1000);
    var hh = d.getUTCHours(), mm = d.getUTCMinutes();
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
      ', ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ' NPT';
  }

  // NPT midnight sits exactly on an epoch 15-minute boundary (UTC+5:45 =
  // 345 min = 23 x 15 min), so Math.floor(t/900) buckets align to NPT wall
  // clock with no offset math.
  function buildIntraBars(pts) {
    // pts: [{t: epochSec, ltp, vol|null}] ascending. 15-minute NPT buckets:
    // open = first ltp, close = last, high/low = max/min of ltp (the honest
    // extremes at 15-minute sampling), volume = last cumulative volume in
    // the bucket minus the previous bucket's (session volume for the first).
    var bars = [], cur = null, prevVol = null;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.ltp == null || !isFinite(p.ltp)) continue;
      var b = Math.floor(p.t / 900);
      if (!cur || cur.b !== b) {
        if (cur) bars.push(cur.row);
        var v0 = (p.vol != null && prevVol != null) ? Math.max(0, p.vol - prevVol) : (p.vol != null ? p.vol : null);
        cur = { b: b, row: [p.t - (p.t % 900), p.ltp, p.ltp, p.ltp, p.ltp, v0] };
      } else {
        if (p.ltp > cur.row[2]) cur.row[2] = p.ltp;
        if (p.ltp < cur.row[3]) cur.row[3] = p.ltp;
        cur.row[4] = p.ltp;
        if (p.vol != null && prevVol != null) cur.row[5] = Math.max(0, p.vol - prevVol);
        else if (p.vol != null && cur.row[5] == null) cur.row[5] = p.vol;
      }
      if (p.vol != null) prevVol = p.vol;
    }
    if (cur) bars.push(cur.row);
    return bars;
  }

  function loadIntraday(sym) {
    // Resolve 15m bars for the symbol. Never invents data: no archive (or
    // no snapshots for this symbol) -> {rows: [], note} honest empty state.
    var isIndex = sym === 'NEPSE';
    function emptyNote() {
      return 'No 15-minute history yet — the intraday archive starts ' +
        'accumulating from today, Mon–Fri 10:45–15:00 NPT. ' +
        (isIndex ? 'The NEPSE index archive keeps today\u2019s session only.' :
          'Check back during market hours once snapshots for ' + sym + ' land.');
    }
    if (isIndex) {
      return fetchJSON(SRC.intraIndex).then(function (d) {
        var obs = (d && d.obs) || [];
        var pts = obs.map(function (o) {
          return { t: epochOf(o.t), ltp: Number(o.v), vol: null };
        }).filter(function (p) { return p.t > 0 && isFinite(p.ltp); });
        pts.sort(function (a, b) { return a.t - b.t; });
        return { rows: buildIntraBars(pts), baseVol: null, note: emptyNote() };
      }).catch(function () { return { rows: [], baseVol: null, note: emptyNote() }; });
    }
    return fetchJSON(SRC.intraDir + 'manifest.json').then(function (m) {
      var days = (m && m.days) || [];
      if (!days.length) return { rows: [], baseVol: null, note: emptyNote() };
      return Promise.all(days.map(function (day) {
        return fetchJSON(SRC.intraDir + 'quotes-' + day + '.json')
          .catch(function () { return null; });
      })).then(function (files) {
        var pts = [];
        files.forEach(function (f) {
          if (!f || !Array.isArray(f.obs)) return;
          f.obs.forEach(function (o) {
            var s = o && o.q && o.q[sym];
            if (!s) return;
            pts.push({ t: epochOf(o.t), ltp: Number(s[0]), vol: s[3] != null ? Number(s[3]) : null });
          });
        });
        pts = pts.filter(function (p) { return p.t > 0 && isFinite(p.ltp); });
        pts.sort(function (a, b) { return a.t - b.t; });
        var baseVol = null;
        for (var i = pts.length - 1; i >= 0; i--) {
          if (pts[i].vol != null) { baseVol = pts[i].vol; break; }
        }
        return { rows: buildIntraBars(pts), baseVol: baseVol, note: emptyNote() };
      });
    }).catch(function () { return { rows: [], baseVol: null, note: emptyNote() }; });
  }

  function curRows() {
    // Rows for the active timeframe: 15m bars or the daily slice.
    if (tfDef().intra) return (state.intra && state.intra.rows) || [];
    return viewRows();
  }

  function timeOf(r) { // library `time` for a row: epoch seconds for 15m, ISO day otherwise
    return tfDef().intra ? r[0] : isoOf(r[0]);
  }

  function fmtBarDate(bar) {
    return tfDef().intra ? fmtTimeNPT(bar[0]) : fmtDate(isoOf(bar[0]));
  }

  function candleData(rows) { // rows: already sliced to the timeframe
    return rows.map(function (r) {
      return { time: timeOf(r), open: r[1], high: r[2], low: r[3], close: r[4] };
    });
  }
  function volumeData(rows) { // rows: already sliced to the timeframe
    return rows.map(function (r) {
      return {
        time: timeOf(r), value: r[5] || 0,
        color: r[4] >= r[1] ? themeColors().volUp : themeColors().volDown
      };
    });
  }
  function lineData(rows) { // rows: already sliced to the timeframe
    return rows.map(function (r) {
      return { time: timeOf(r), value: r[4] };
    });
  }

  function buildChart() {
    var el = $(MOUNT_ID);
    if (!el || !VENDOR_OK) return false;
    if (chart) { try { chart.remove(); } catch (e) {} chart = null; S = {}; }
    var c = themeColors();
    chart = window.LightweightCharts.createChart(el, {
      width: el.clientWidth || 800,
      height: el.clientHeight || 480,
      layout: {
        background: { type: 'solid', color: c.bg },
        textColor: c.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: c.cross, labelBackgroundColor: c.cross },
        horzLine: { color: c.cross, labelBackgroundColor: c.cross }
      },
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false },
      // Interaction, spelled out (these match the v4.2.3 defaults, verified
      // against the vendored bundle): wheel zooms the time axis, drag pans,
      // pinch zooms on touch, touch scroll has momentum; double-clicking an
      // axis resets that scale (axisDoubleClickReset).
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: {
        mouseWheel: true, pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true }
      },
      kineticScroll: { mouse: false, touch: true }
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    S.candles = chart.addCandlestickSeries({
      upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
      borderVisible: false, priceLineVisible: true, lastValueVisible: true
    });
    S.line = chart.addLineSeries({ color: c.line, lineWidth: 2, priceLineVisible: true, visible: false });
    S.area = chart.addAreaSeries({
      topColor: 'rgba(138,109,59,0.28)', bottomColor: 'rgba(138,109,59,0.0)',
      lineColor: c.line, lineWidth: 2, priceLineVisible: true, visible: false
    });
    S.vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    var maColors = { sma20: c.sma20, sma50: c.sma50, sma200: c.sma200, ema20: c.ema20 };
    ['sma20', 'sma50', 'sma200', 'ema20'].forEach(function (id) {
      S[id] = chart.addLineSeries({ color: maColors[id], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    });

    chart.subscribeCrosshairMove(onCrosshair);
    // Double-click anywhere on the pane resets the zoom (fitContent) — the
    // library's idiomatic pane-level reset; axis double-clicks are already
    // handled by axisDoubleClickReset above.
    if (chart.subscribeDblClick) {
      chart.subscribeDblClick(function () { chart.timeScale().fitContent(); });
    }
    new ResizeObserver(function () {
      if (chart && el) chart.applyOptions({ width: el.clientWidth || 800, height: el.clientHeight || 480 });
    }).observe(el);
    return true;
  }

  function applyTheme() {
    if (!chart) return;
    var c = themeColors();
    chart.applyOptions({
      layout: { background: { type: 'solid', color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border }
    });
    S.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    S.line.applyOptions({ color: c.line });
    S.area.applyOptions({ lineColor: c.line });
    S.sma20.applyOptions({ color: c.sma20 }); S.sma50.applyOptions({ color: c.sma50 });
    S.sma200.applyOptions({ color: c.sma200 }); S.ema20.applyOptions({ color: c.ema20 });
    paintData(); // re-color volume bars
  }

  function setSeriesData(rows, noVol) {
    S.candles.setData(candleData(rows));
    S.line.setData(lineData(rows));
    S.area.setData(lineData(rows));
    S.vol.setData(noVol ? [] : volumeData(rows));
    // Moving averages follow the displayed candles (e.g. SMA 20 on a weekly
    // chart = 20 weeks), computed from the same real closes.
    var cl = closes(rows);
    var defs = { sma20: 20, sma50: 50, sma200: 200 };
    ['sma20', 'sma50', 'sma200', 'ema20'].forEach(function (id) {
      var arr = id === 'ema20' ? ema(cl, 20) : sma(cl, defs[id]);
      var pts = [];
      for (var i = 0; i < rows.length; i++) {
        if (arr[i] != null) pts.push({ time: timeOf(rows[i]), value: arr[i] });
      }
      S[id].setData(pts);
    });
    applyVisibility();
  }

  function paintData(fit) {
    if (!chart) return;
    if (tfDef().intra) { paintIntraday(fit); return; }
    if (!state.rows.length) return;
    var rows = viewRows(); // timeframe window, resampled to the candle period
    if (!rows.length) return;
    setSeriesData(rows, false);
    if (fit !== false) chart.timeScale().fitContent();
    paintLegend(rows[rows.length - 1]);
    paintStats();
  }

  function paintIntraday(fit) {
    // 15m: bars from our own snapshot archive (async). Cached per symbol so
    // re-selecting the timeframe or toggling theme doesn't refetch.
    var sym = state.sym;
    var done = function (r) {
      if (state.sym !== sym || !tfDef().intra) return; // user moved on
      setLoading(false);
      if (!r.rows.length) {
        state.intra = { sym: sym, rows: [], baseVol: null, empty: true };
        ['candles', 'line', 'area', 'vol', 'sma20', 'sma50', 'sma200', 'ema20']
          .forEach(function (id) { S[id].setData([]); });
        setNote(r.note);
        return;
      }
      state.intra = { sym: sym, rows: r.rows, baseVol: r.baseVol, empty: false };
      setSeriesData(r.rows, sym === 'NEPSE'); // the index archive carries no volume
      if (fit !== false) chart.timeScale().fitContent();
      paintLegend(r.rows[r.rows.length - 1]);
      paintStats();
    };
    if (state.intra && state.intra.sym === sym && !state.intra.empty) {
      done({ rows: state.intra.rows, baseVol: state.intra.baseVol, note: '' });
      return;
    }
    setLoading(true); setNote(null);
    loadIntraday(sym).then(done).catch(function () {
      done({ rows: [], baseVol: null, note: 'Could not load the 15-minute archive right now — try again in a bit.' });
    });
  }

  function applyVisibility() {
    if (!chart) return;
    var t = state.type;
    S.candles.applyOptions({ visible: t === 'candles' });
    S.line.applyOptions({ visible: t === 'line' });
    S.area.applyOptions({ visible: t === 'area' });
    S.vol.applyOptions({ visible: state.ov.vol });
    var maOn = !state.ltpOnly;
    ['sma20', 'sma50', 'sma200', 'ema20'].forEach(function (id) {
      S[id].applyOptions({ visible: maOn && !!state.ov[id] });
    });
  }

  function onCrosshair(param) {
    if (!chart) return;
    var rows = curRows();
    if (!rows.length) return;
    var bar = rows[rows.length - 1];
    if (param && param.time != null) {
      if (typeof param.time === 'number') {
        for (var i = rows.length - 1; i >= 0; i--) {
          if (rows[i][0] === param.time) { bar = rows[i]; break; }
        }
      } else {
        var ymd = ymdOf(param.time);
        for (var j = rows.length - 1; j >= 0; j--) {
          if (rows[j][0] <= ymd) { bar = rows[j]; break; }
        }
      }
    }
    paintLegend(bar);
  }

  function paintLegend(bar) {
    var el = $(LEGEND_ID);
    if (!el || !bar) return;
    var chg = bar[4] - bar[1];
    var pct = bar[1] ? (chg / bar[1]) * 100 : null;
    var cls = chg > 0 ? 'up' : (chg < 0 ? 'down' : 'flat');
    // Merolagani-style two-line legend:
    // line 1: "Company Name · 1D" (+ date, LIVE badge)
    // line 2: "Oxxx.xx Hxxx.xx Lxxx.xx Cxxx.xx +x.xx (+x.xx%)"
    el.innerHTML =
      '<span class="nt-lg-line1">' +
        '<span class="nt-lg-sym">' + esc(state.symName) + '</span>' +
        '<span class="nt-lg-tf">· ' + esc(state.tf) + '</span>' +
        '<span class="nt-lg-date">' + esc(fmtBarDate(bar)) + '</span>' +
        (state.liveBadge ? '<span class="nt-live">LIVE</span>' : '') +
      '</span>' +
      '<span class="nt-lg-line2">' +
        '<span class="nt-lg-ohlc">O <b>' + fmtNum(bar[1]) + '</b> ' +
        'H <b>' + fmtNum(bar[2]) + '</b> ' +
        'L <b>' + fmtNum(bar[3]) + '</b> ' +
        'C <b>' + fmtNum(bar[4]) + '</b></span>' +
        '<span class="nt-lg-chg ' + cls + '">' + fmtSigned(chg) + ' (' + fmtSigned(pct, 2) + '%)</span>' +
      '</span>';
  }

  function paintStats() {
    var rows = state.rows;
    if (!rows.length) return;
    paintFundamentals();
    function set(id, v) { var e = $(id); if (e) e.textContent = v; }
    var cl = closes(rows);
    var s20 = sma(cl, 20), s50 = sma(cl, 50), s200 = sma(cl, 200);
    var intra = tfDef().intra;
    var na = state.ltpOnly || intra; // daily SMAs are meaningless on the 15m view
    set('nt-sma20', na ? '—' : fmtNum(s20[s20.length - 1]));
    set('nt-sma50', na ? '—' : fmtNum(s50[s50.length - 1]));
    set('nt-sma200', na ? '—' : fmtNum(s200[s200.length - 1]));
    var sd = state.sessionDate || (rows.length ? isoOf(rows[rows.length - 1][0]) : null);
    set('nt-session', intra
      ? 'Intraday 15m · our 15-min snapshots · delayed ~15 min'
      : 'Session ' + fmtDate(sd) + ' · data delayed ~15 min');
  }

  /* ---------- symbol loading ---------- */

  function setNote(msg) {
    var n = $('nt-note');
    if (!n) return;
    if (msg) { n.textContent = msg; n.hidden = false; } else { n.hidden = true; n.textContent = ''; }
  }
  function setLoading(on) {
    var el = $(MOUNT_ID);
    if (el) el.classList.toggle('loading', !!on);
    var sp = $('nt-spinner');
    if (sp) sp.hidden = !on;
  }

  function loadSymbol(sym, opts) {
    opts = opts || {};
    sym = String(sym || '').trim().toUpperCase();
    if (!sym) return;
    var isIndex = sym === 'NEPSE';
    if (!isIndex && !state.names[sym]) {
      setNote('No data source lists ' + sym + ' yet. Check the spelling, or try one of the symbols above.');
      return;
    }
    state.loading = true; state.err = '';
    setLoading(true); setNote(null);
    state.sym = sym; state.symName = isIndex ? 'NEPSE Index' : (state.names[sym] || sym);
    state.intra = null; // drop the cached 15m bars — rebuilt for the new symbol
    store(LS.sym, sym);
    var inp = $('nt-sym'); if (inp && document.activeElement !== inp) inp.value = sym;
    var chips = document.querySelectorAll('[data-chip]');
    for (var ci = 0; ci < chips.length; ci++) {
      chips[ci].classList.toggle('on', chips[ci].getAttribute('data-chip') === sym);
    }

    var p = isIndex ? indexRows().then(function (r) { return { rows: r, ltpOnly: false }; }) : loadStock(sym);
    p.then(function (r) {
      state.rows = r.rows;
      state.ltpOnly = !!r.ltpOnly;
      var merged = applyLiveToRows(state.rows, isIndex);
      state.rows = merged.rows;
      if (!state.rows.length) throw new Error('empty');
      if (!state.sessionDate && state.rows.length) {
        state.sessionDate = isoOf(state.rows[state.rows.length - 1][0]);
      }
      if (!chart && !buildChart()) throw new Error('lib');
      paintData(true);
      syncOverlayUI();
      setLtpNote();
      state.loading = false; setLoading(false);
      refreshLive(); // sync in case the live snapshot landed mid-load
    }).catch(function (e) {
      state.loading = false; setLoading(false);
      setNote(e && e.message === 'lib'
        ? 'The chart library failed to load. Check your connection and reload.'
        : 'Could not load ' + sym + ' right now. The data source may be down — try again in a bit.');
    });
  }

  function setLtpNote() {
    var n = $('nt-ltponly');
    if (!n) return;
    n.hidden = !state.ltpOnly;
  }

  function syncOverlayUI() {
    var btns = document.querySelectorAll('#nt-ov [data-ov]');
    for (var i = 0; i < btns.length; i++) {
      var id = btns[i].getAttribute('data-ov');
      var isMA = id !== 'vol';
      var dis = state.ltpOnly && isMA;
      btns[i].disabled = dis;
      btns[i].setAttribute('aria-pressed', (!dis && state.ov[id]) ? 'true' : 'false');
    }
  }

  function refreshIntraLive() {
    // 15m: fold the latest live quote into the forming 15-minute bar —
    // no refetch. Gated on the LIVE badge (market open, quote < 45 min),
    // so a stale quote can never fabricate a bar. When the wall clock
    // rolls into a new bucket, start the forming bar from the live quote
    // (volume accumulates from there); the archive takes over on reload.
    var c = state.intra;
    if (!c || !c.rows.length || !state.live || !state.liveBadge) return;
    var q = state.live;
    var ltp = Number(state.sym === 'NEPSE' ? q.value : q.ltp);
    if (!isFinite(ltp) || ltp <= 0) return;
    var vol = Number(q.volume);
    vol = isFinite(vol) ? vol : null;
    var nowBucket = Math.floor(Date.now() / 1000 / 900);
    var last = c.rows[c.rows.length - 1];
    if (Math.floor(last[0] / 900) < nowBucket) {
      last = [nowBucket * 900, ltp, ltp, ltp, ltp, 0];
      c.rows.push(last);
      if (vol != null) c.baseVol = vol;
    }
    last[4] = ltp;
    if (ltp > last[2]) last[2] = ltp;
    if (ltp < last[3]) last[3] = ltp;
    if (vol != null && c.baseVol != null) last[5] = Math.max(0, vol - c.baseVol);
    var t = last[0];
    try {
      S.candles.update({ time: t, open: last[1], high: last[2], low: last[3], close: last[4] });
      S.line.update({ time: t, value: last[4] });
      S.area.update({ time: t, value: last[4] });
      if (state.sym !== 'NEPSE') {
        S.vol.update({ time: t, value: last[5] || 0, color: last[4] >= last[1] ? themeColors().volUp : themeColors().volDown });
      }
      if (!state.ltpOnly) {
        var cl = closes(c.rows);
        var defs = { sma20: 20, sma50: 50, sma200: 200 };
        ['sma20', 'sma50', 'sma200'].forEach(function (id) {
          var arr = sma(cl, defs[id]);
          var v = arr[arr.length - 1];
          if (v != null) S[id].update({ time: t, value: v });
        });
        var e = ema(cl, 20), ev = e[e.length - 1];
        if (ev != null) S.ema20.update({ time: t, value: ev });
      }
    } catch (err) { /* series not ready yet */ }
    paintLegend(last);
    paintStats();
  }

  function refreshLive() {
    // Re-apply the live session candle on every NepseData tick.
    if (state.loading || !state.rows.length || !chart) return;
    var isIndex = state.sym === 'NEPSE';
    var merged = applyLiveToRows(state.rows, isIndex);
    if (tfDef().intra) { refreshIntraLive(); return; }
    if (merged.rows.length !== state.rows.length) {
      // A new session opened — re-slice the timeframe window and repaint.
      state.rows = merged.rows;
      paintData(true);
      return;
    }
    if (tfDef().agg > 1) {
      // Aggregated timeframe: the live session sits inside the last
      // multi-session candle — repaint data without resetting the zoom.
      state.rows = merged.rows;
      paintData(false);
      return;
    }
    var last = merged.rows[merged.rows.length - 1];
    if (!last) return;
    var prevClose = state.rows[state.rows.length - 1][4];
    state.rows = merged.rows;
    if (prevClose === last[4] && !state.liveBadge) { paintLegend(last); return; }
    var iso = isoOf(last[0]);
    var data = { time: iso, open: last[1], high: last[2], low: last[3], close: last[4] };
    try {
      S.candles.update(data);
      S.line.update({ time: iso, value: last[4] });
      S.area.update({ time: iso, value: last[4] });
      S.vol.update({ time: iso, value: last[5] || 0, color: last[4] >= last[1] ? themeColors().volUp : themeColors().volDown });
      if (!state.ltpOnly) {
        var cl = closes(state.rows);
        var defs = { sma20: 20, sma50: 50, sma200: 200 };
        ['sma20', 'sma50', 'sma200'].forEach(function (id) {
          var arr = sma(cl, defs[id]);
          var v = arr[arr.length - 1];
          if (v != null) S[id].update({ time: iso, value: v });
        });
        var e = ema(cl, 20), ev = e[e.length - 1];
        if (ev != null) S.ema20.update({ time: iso, value: ev });
      }
    } catch (err) { /* series not ready yet */ }
    paintLegend(last);
    paintStats();
  }

  /* ---------- UI wiring ---------- */

  function markSeg(id, val, attr) {
    var btns = document.querySelectorAll('#' + id + ' [data-' + attr + ']');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-' + attr) === val;
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function initUI() {
    // Timeframes
    var tfHost = $('nt-tf');
    tfHost.innerHTML = TFS.map(function (t) {
      return '<button type="button" data-tf="' + t.id + '">' + t.id + '</button>';
    }).join('');
    markSeg('nt-tf', state.tf, 'tf');
    tfHost.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tf]');
      if (!b) return;
      state.tf = b.getAttribute('data-tf');
      store(LS.tf, state.tf);
      markSeg('nt-tf', state.tf, 'tf');
      paintData(true);
    });

    // Chart type
    markSeg('nt-type', state.type, 'type');
    $('nt-type').addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]');
      if (!b) return;
      state.type = b.getAttribute('data-type');
      store(LS.type, state.type);
      markSeg('nt-type', state.type, 'type');
      applyVisibility();
    });

    // Overlays — pill toggle buttons (same language as the tracker's pills)
    var ovHost = $('nt-ov');
    ovHost.innerHTML = '<span class="nt-ov-title">Overlays</span>' + OVERLAYS.map(function (o) {
      return '<button type="button" class="nt-ovl" data-ov="' + o.id + '"' +
        ' aria-pressed="' + (state.ov[o.id] ? 'true' : 'false') + '">' + esc(o.label) + '</button>';
    }).join('');
    ovHost.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ov]');
      if (!b || b.disabled) return;
      var id = b.getAttribute('data-ov');
      state.ov[id] = !state.ov[id];
      store(LS.ov, JSON.stringify(state.ov));
      syncOverlayUI();
      applyVisibility();
    });

    // Search
    var go = function () {
      var v = $('nt-sym').value;
      if (v && v.trim()) loadSymbol(v);
    };
    $('nt-go').addEventListener('click', go);
    $('nt-sym').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
    document.querySelectorAll('[data-chip]').forEach(function (c) {
      c.addEventListener('click', function () { loadSymbol(c.getAttribute('data-chip')); });
    });

    // Theme toggle re-theme
    new MutationObserver(function () { applyTheme(); }).observe(
      document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function fillDatalist() {
    var dl = $('nt-syms');
    if (!dl) return;
    var html = '<option value="NEPSE">NEPSE — Nepal Stock Exchange Index</option>';
    Object.keys(state.names).sort().forEach(function (s) {
      html += '<option value="' + esc(s) + '">' + esc(s + ' — ' + state.names[s]) + '</option>';
    });
    dl.innerHTML = html;
  }

  /* ---------- init ---------- */

  function init() {
    if (!$(MOUNT_ID)) return;
    if (!VENDOR_OK) {
      setNote('The chart library failed to load. Check your connection and reload the page.');
      return;
    }
    // Restore preferences
    var rsym = read(LS.sym), rtf = read(LS.tf), rtype = read(LS.type), rov = read(LS.ov);
    if (rsym) state.sym = rsym.toUpperCase();
    if (rtf && TFS.some(function (t) { return t.id === rtf; })) state.tf = rtf;
    if (rtype && TYPES.indexOf(rtype) !== -1) state.type = rtype;
    try {
      var o = rov ? JSON.parse(rov) : null;
      if (o) Object.keys(state.ov).forEach(function (k) { if (typeof o[k] === 'boolean') state.ov[k] = o[k]; });
    } catch (e) {}
    initUI();
    var inp = $('nt-sym');
    if (inp) inp.value = state.sym;

    // Start the live-data layer FIRST (idempotent) so the snapshot can
    // arrive while we wait for the deferred data scripts below.
    if (window.NepseData) {
      if (typeof window.NepseData.start === 'function') {
        try { window.NepseData.start(); } catch (e) {}
      }
      if (window.NepseData.subscribe && !unsubLive) {
        unsubLive = window.NepseData.subscribe(function () { refreshLive(); });
      }
    }

    loadUniverse().then(function () {
      fillDatalist();
      // Fundamentals (EPS/P/E) load in parallel — repaint the panel when they
      // land in case the chart beat them.
      loadFundamentals().then(function () {
        if (state.rows.length) paintFundamentals();
      });
      // Wait for the deferred data scripts (nepse-daily.js) and the first
      // live snapshot — getSnapshot() existing is not enough, the first
      // live.json fetch resolves asynchronously.
      var tries = 0;
      (function waitDeps() {
        var dailyReady = state.sym === 'NEPSE'
          ? (window.NEPSE_DAILY && window.NEPSE_DAILY.length)
          : true;
        var snap = null;
        try { snap = window.NepseData && window.NepseData.getSnapshot ? window.NepseData.getSnapshot() : null; } catch (e) {}
        if ((dailyReady && snap) || tries++ > 80) {
          loadSymbol(state.sym);
        } else {
          setTimeout(waitDeps, 150);
        }
      })();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
