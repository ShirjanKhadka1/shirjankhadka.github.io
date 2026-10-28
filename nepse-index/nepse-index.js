/* nepse-index.js — family script for /nepse-index/.
   Client-side only, from published files: live.json (index block,
   sub-indices, quotes), index-history.json (daily closes 2003–),
   intraday-index.json (today's path), universe.json (listed count).
   Every number goes through NepseFormat; money-in-prose uses the
   suite's arab/crore pattern (see nepse-sectors.js). Missing data
   renders as an em dash, never 0. Open/volume are NOT shown: the
   index archive publishes no open (rows carry 0) and no volume.
   60s tick refetches live.json and repaints only when the
   fingerprint (index value + timestamp + quote count) changes. */
(function () {
  'use strict';

  var LIVE_URL = '/nepse-chart/data/live.json';
  var HIST_URL = '/data/index-history.json';
  var INTRA_URL = '/nepse-chart/data/intraday-index.json';
  var UNI_URL = '/nepse-chart/data/universe.json';

  var F = (typeof window !== 'undefined' && window.NepseFormat) || null;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(x) {
    if (x === null || x === undefined || x === '') return NaN;
    var n = Number(x);
    return isFinite(n) ? n : NaN;
  }
  function fmtPrice(x) { return F ? F.fmtPrice(x) : (isNaN(num(x)) || num(x) === 0 ? '—' : String(x)); }
  function fmtPct(x) { return F ? F.fmtPct(x) : (isNaN(num(x)) ? '—' : String(x) + '%'); }
  function fmtNum(x) { return F ? F.fmtNum(x) : (isNaN(num(x)) ? '—' : String(Math.round(num(x)))); }
  function fmtAge(ms) { return F ? F.fmtAge(ms) : ''; }
  function fmtDateTime(iso) { return F ? F.fmtDateTimeNPT(iso) : esc(iso); }
  /* Suite arab/crore pattern (nepse-sectors.js): prose money only. */
  function fmtRs(x) {
    var n = num(x);
    if (isNaN(n)) return '—';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e9) return sign + 'Rs ' + (a / 1e9).toFixed(2) + ' arab';
    if (a >= 1e7) return sign + 'Rs ' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return sign + 'Rs ' + (a / 1e5).toFixed(2) + ' L';
    return sign + 'Rs ' + fmtNum(a);
  }
  /* yyyymmdd int -> "28 Oct 2026" (parsed from parts, no TZ drift). */
  function fmtDay(yyyymmdd) {
    var s = String(yyyymmdd);
    if (!/^\d{8}$/.test(s)) return '—';
    return s.slice(6, 8).replace(/^0/, '') + ' ' + MONTHS[Number(s.slice(4, 6)) - 1] + ' ' + s.slice(0, 4);
  }
  /* "2026-10-28" -> "28 Oct 2026". */
  function fmtISODate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '—';
    return m[3].replace(/^0/, '') + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }
  function clsFor(ch) {
    var n = num(ch);
    if (isNaN(n)) return 'ix-flat';
    return n > 0 ? 'ix-up' : (n < 0 ? 'ix-down' : 'ix-flat');
  }
  function signedPct(p) {
    var n = num(p);
    if (isNaN(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------------- hero + breadth + movers + sub-indices ---------- */
  function renderLive(live, uniCount) {
    var idx = (live && live.index) || {};
    var quotes = (live && live.quotes) || [];
    var session = live.session_date || (live.asof ? String(live.asof).slice(0, 10) : '');
    var market = live.market || '';
    var lastUp = idx.last_updated || live.asof || '';

    var ch = num(idx.change), pc = num(idx.percent_change);
    var chEl = $('ixHeroChg');
    if (chEl) {
      chEl.textContent = (isNaN(ch) ? '—' : (ch > 0 ? '+' : '') + fmtPrice(ch)) +
        ' (' + (isNaN(pc) ? '—' : signedPct(pc)) + ')';
      chEl.className = 'ix-sub ' + clsFor(ch);
    }
    var set = function (id, txt, cls) {
      var el = $(id);
      if (el) { el.textContent = txt; if (cls) el.className = cls; }
    };
    set('ixHeroVal', fmtPrice(idx.value));
    set('ixHeroHigh', fmtPrice(idx.high));
    set('ixHeroLow', fmtPrice(idx.low));
    set('ixHeroPrev', fmtPrice(idx.previous_close));

    /* Market-state chip: LIVE only when the feed says OPEN; a closed
       session never repaints as live (stale-tape guard). */
    var chip = $('ixStateChip');
    if (chip) {
      if (market === 'OPEN') {
        chip.className = 'ix-chip live';
        chip.innerHTML = '<span class="dot"></span>LIVE';
      } else if (market === 'CLOSED') {
        chip.className = 'ix-chip closed';
        chip.innerHTML = '<span class="dot"></span>CLOSED';
      } else {
        chip.className = 'ix-chip unverified';
        chip.innerHTML = '<span class="dot"></span>STATE UNVERIFIED';
      }
    }
    var asof = $('ixAsof');
    if (asof) {
      asof.textContent = 'Session ' + fmtISODate(session) +
        (lastUp ? ' · data as of ' + fmtDateTime(lastUp) : '') +
        ' · Source: published NEPSE quotes via Nepse Decode snapshots.';
    }
    updateFreshline(lastUp, session);

    /* Breadth + turnover from the SAME quotes the daily page uses, so
       the figures match everywhere. Denominator = traded securities
       only (quotes exist only for traded names) — labeled as such. */
    var adv = 0, dec = 0, flat = 0, turn = 0;
    quotes.forEach(function (q) {
      var c = num(q.change);
      if (!isNaN(c)) { if (c > 0) adv++; else if (c < 0) dec++; else flat++; }
      turn += num(q.turnover) || 0;
    });
    var traded = quotes.length;
    set('ixStatTurn', fmtRs(turn));
    set('ixStatTurnSub', fmtNum(traded) + ' of ' + (uniCount ? fmtNum(uniCount) : '—') + ' listed securities traded');
    set('ixStatBreadth', adv + ' / ' + dec + ' / ' + flat);
    set('ixStatBreadthSub', 'Advancers / decliners / unchanged, among traded securities');
    var bar = $('ixBreadthBar');
    if (bar) {
      var tot = adv + dec + flat;
      var segs = [];
      /* Zero-count buckets render NO segment and NO legend row. */
      if (adv) segs.push('<i style="width:' + (adv / tot * 100) + '%;background:var(--nd-up)" title="Advancers ' + adv + '"></i>');
      if (dec) segs.push('<i style="width:' + (dec / tot * 100) + '%;background:var(--nd-down)" title="Decliners ' + dec + '"></i>');
      if (flat) segs.push('<i style="width:' + (flat / tot * 100) + '%;background:var(--nd-flat)" title="Unchanged ' + flat + '"></i>');
      bar.innerHTML = segs.join('');
      bar.setAttribute('aria-label', adv + ' advancers, ' + dec + ' decliners, ' + flat + ' unchanged');
    }
    var lg = $('ixBreadthLegend');
    if (lg) {
      var rows = [];
      if (adv) rows.push('<span><i class="sw" style="background:var(--nd-up)"></i>Advancers <b>' + adv + '</b></span>');
      if (dec) rows.push('<span><i class="sw" style="background:var(--nd-down)"></i>Decliners <b>' + dec + '</b></span>');
      if (flat) rows.push('<span><i class="sw" style="background:var(--nd-flat)"></i>Unchanged <b>' + flat + '</b></span>');
      lg.innerHTML = rows.join('');
    }

    /* Movers from published quotes (same contract as the daily page). */
    var withPct = quotes.filter(function (q) { return !isNaN(num(q.percent_change)); });
    var gainers = withPct.slice().sort(function (a, b) { return num(b.percent_change) - num(a.percent_change); }).slice(0, 5);
    var losers = withPct.slice().sort(function (a, b) { return num(a.percent_change) - num(b.percent_change); }).slice(0, 5);
    var byTurn = quotes.slice().sort(function (a, b) { return (num(b.turnover) || 0) - (num(a.turnover) || 0); }).slice(0, 5);
    var rowG = function (q) {
      return '<tr><td class="sym"><a href="/stocks/' + esc(q.symbol) + '/">' + esc(q.symbol) + '</a></td>' +
        '<td>' + esc(q.name || '') + '</td>' +
        '<td class="num">' + fmtPrice(q.ltp) + '</td>' +
        '<td class="num ' + clsFor(q.percent_change) + '">' + signedPct(q.percent_change) + '</td></tr>';
    };
    var rowT = function (q) {
      return '<tr><td class="sym"><a href="/stocks/' + esc(q.symbol) + '/">' + esc(q.symbol) + '</a></td>' +
        '<td>' + esc(q.name || '') + '</td>' +
        '<td class="num">' + fmtPrice(q.ltp) + '</td>' +
        '<td class="num">' + fmtRs(q.turnover) + '</td></tr>';
    };
    var tb = function (id, rows) { var el = $(id); if (el) el.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="4">Unavailable</td></tr>'; };
    tb('ixGainersBody', gainers.map(rowG));
    tb('ixLosersBody', losers.map(rowG));
    tb('ixTurnoverBody', byTurn.map(rowT));

    /* Sub-indices: every entry in the live indices block, in feed order. */
    var inds = (live && live.indices) || [];
    var maxAbs = 0;
    inds.forEach(function (i) { var a = Math.abs(num(i.percent_change)); if (!isNaN(a) && a > maxAbs) maxAbs = a; });
    var ib = $('ixIndicesBody');
    if (ib) {
      ib.innerHTML = inds.length ? inds.map(function (i) {
        var p = num(i.percent_change), w = (!isNaN(p) && maxAbs) ? (Math.abs(p) / maxAbs * 100) : 0;
        var col = isNaN(p) ? 'var(--nd-flat)' : (p > 0 ? 'var(--nd-up)' : (p < 0 ? 'var(--nd-down)' : 'var(--nd-flat)'));
        return '<tr><td>' + esc(i.name) + '</td>' +
          '<td class="num">' + fmtPrice(i.value) + '</td>' +
          '<td class="num ' + clsFor(i.change) + '">' + (isNaN(num(i.change)) ? '—' : (num(i.change) > 0 ? '+' : '') + fmtPrice(i.change)) + '</td>' +
          '<td class="num ' + clsFor(i.percent_change) + '">' + signedPct(i.percent_change) + '</td>' +
          '<td><div class="ix-pctbar"><span class="trk"><span class="fl" style="width:' + w.toFixed(1) + '%;background:' + col + '"></span></span></div></td></tr>';
      }).join('') : '<tr><td colspan="5">Unavailable</td></tr>';
    }
    var ic = $('ixIndicesCap');
    if (ic) ic.textContent = inds.length + ' published sub-indices · values as of ' + fmtISODate(session) +
      ' · bars scaled to the day\'s largest |% move| (' + (maxAbs ? maxAbs.toFixed(2) + '%' : '—') + ').';
  }

  function updateFreshline(lastUp, session) {
    var el = $('ixFreshline');
    if (!el) return;
    var age = '';
    if (lastUp) {
      var t = new Date(lastUp).getTime();
      if (isFinite(t)) age = ' · data age ' + fmtAge(Date.now() - t);
    }
    el.textContent = 'Session ' + fmtISODate(session) + age +
      ' · refreshes every 60 seconds during market hours; after close this page shows the last closed session.';
  }

  /* ---------------- history: chart + returns + sessions ------------ */
  var HIST = null;
  var PERIODS = [
    { id: '1M', label: '1M', n: 22 }, { id: '3M', label: '3M', n: 66 },
    { id: '6M', label: '6M', n: 132 }, { id: '1Y', label: '1Y', n: 250 },
    { id: '3Y', label: '3Y', n: 750 }, { id: '5Y', label: '5Y', n: 1250 },
    { id: 'Max', label: 'Max', n: 0 }
  ];
  var RETS = [
    { id: '1W', label: '1W', n: 5 }, { id: '1M', label: '1M', n: 22 },
    { id: '3M', label: '3M', n: 66 }, { id: '6M', label: '6M', n: 132 },
    { id: '1Y', label: '1Y', n: 250 }, { id: '3Y', label: '3Y', n: 750 },
    { id: '5Y', label: '5Y', n: 1250 }, { id: 'Max', label: 'Max', n: 0 }
  ];

  function closesOf(hist) {
    var out = [];
    (hist.rows || []).forEach(function (r) {
      var c = num(r[4]);
      if (!isNaN(c) && c > 0) out.push([r[0], c]);
    });
    return out;
  }

  function renderHistory(hist) {
    HIST = hist;
    var closes = closesOf(hist);
    if (!closes.length) {
      var cc = $('ixChartCap');
      if (cc) cc.textContent = 'Index history unavailable.';
      return;
    }
    /* Period returns: close vs the close N sessions back; reference
       date printed, never a bare percent. */
    var last = closes[closes.length - 1][1];
    var rb = $('ixReturns');
    if (rb) {
      rb.innerHTML = RETS.map(function (r) {
        var ref = r.n === 0 ? closes[0] : closes[Math.max(0, closes.length - 1 - r.n)];
        var ret = (last / ref[1] - 1) * 100;
        return '<span class="r"><b class="' + clsFor(ret) + '">' + signedPct(ret) + '</b>' +
          '<span>' + r.label + ' · vs ' + fmtDay(ref[0]) + ' close</span></span>';
      }).join('');
    }
    /* Recent sessions: last 10 closes with change vs prior close. */
    var sb = $('ixSessionsBody');
    if (sb) {
      var rows = [];
      for (var i = Math.max(1, closes.length - 10); i < closes.length; i++) {
        var d = closes[i][0], c = closes[i][1], p = closes[i - 1][1];
        var ch = c - p, pc = (c / p - 1) * 100;
        rows.unshift('<tr><td>' + fmtDay(d) + '</td><td class="num">' + fmtPrice(c) + '</td>' +
          '<td class="num ' + clsFor(ch) + '">' + (ch > 0 ? '+' : '') + fmtPrice(ch) + '</td>' +
          '<td class="num ' + clsFor(pc) + '">' + signedPct(pc) + '</td></tr>');
      }
      sb.innerHTML = rows.join('');
    }
    var sc = $('ixSessionsCap');
    if (sc) sc.textContent = 'Daily closes from the site index archive (' + fmtDay(closes[0][0]) + ' – ' + fmtDay(closes[closes.length - 1][0]) + '). Open and volume are not published in this archive, so this table shows closes only.';
    drawChart('1Y');
    /* Period pills. */
    var pills = $('ixPeriodPills');
    if (pills) {
      pills.innerHTML = PERIODS.map(function (p) {
        return '<button type="button" data-period="' + p.id + '" aria-pressed="' + (p.id === '1Y' ? 'true' : 'false') + '">' + p.label + '</button>';
      }).join('');
      pills.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-period]');
        if (!b) return;
        pills.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        drawChart(b.getAttribute('data-period'));
      });
    }
  }

  function themeIsLight() {
    return document.documentElement.getAttribute('data-theme') === 'light' ||
      document.documentElement.getAttribute('data-nd-ed') === 'light';
  }

  function drawChart(periodId) {
    var cv = $('ixChart');
    if (!cv || !HIST) return;
    var closes = closesOf(HIST);
    var p = PERIODS.filter(function (x) { return x.id === periodId; })[0] || PERIODS[3];
    var slice = p.n === 0 ? closes : closes.slice(Math.max(0, closes.length - p.n));
    if (slice.length < 2) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 800, h = cv.clientHeight || 300;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var vals = slice.map(function (x) { return x[1]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var pad = (max - min) * 0.05 || 1;
    min -= pad; max += pad;
    var L = 8, R = 8, T = 14, B = 22;
    var X = function (i) { return L + (i / (slice.length - 1)) * (w - L - R); };
    var Y = function (v) { return T + (1 - (v - min) / (max - min)) * (h - T - B); };
    var light = themeIsLight();
    var line = light ? '#4D7C0F' : '#B8E62E';
    var fill = light ? 'rgba(77,124,15,.12)' : 'rgba(184,230,46,.12)';
    var grid = light ? 'rgba(10,12,16,.10)' : 'rgba(255,255,255,.08)';
    var txt = light ? '#4B5563' : '#8E98A8';
    /* Area + line through consecutive closes (the series itself; gaps
       stay gaps because only published closes are plotted). */
    ctx.beginPath();
    ctx.moveTo(X(0), Y(slice[0][1]));
    for (var i = 1; i < slice.length; i++) ctx.lineTo(X(i), Y(slice[i][1]));
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(X(slice.length - 1), h - B); ctx.lineTo(X(0), h - B); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    /* Endpoint dots + labels (values printed, never colour alone). */
    ctx.fillStyle = line;
    ctx.beginPath(); ctx.arc(X(0), Y(slice[0][1]), 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(X(slice.length - 1), Y(slice[slice.length - 1][1]), 4, 0, 7); ctx.fill();
    ctx.font = '11px IBM Plex Mono, monospace'; ctx.fillStyle = txt;
    ctx.textAlign = 'left';
    ctx.fillText(fmtDay(slice[0][0]) + ' · ' + fmtPrice(slice[0][1]), L, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText(fmtDay(slice[slice.length - 1][0]) + ' · ' + fmtPrice(slice[slice.length - 1][1]), w - R, h - 6);
    ctx.textAlign = 'left';
    ctx.fillText('High ' + fmtPrice(max - pad), L, T + 2);
    var cap = $('ixChartCap');
    if (cap) cap.textContent = 'Daily closes · ' + slice.length + ' sessions · ' + fmtDay(slice[0][0]) + ' – ' + fmtDay(slice[slice.length - 1][0]) + '. Open and volume are not published in this archive.';
    cv.setAttribute('aria-label', 'NEPSE index closes from ' + fmtDay(slice[0][0]) + ' to ' + fmtDay(slice[slice.length - 1][0]));
  }

  function renderIntra(intra) {
    var box = $('ixIntraBox');
    if (!box) return;
    var obs = (intra && intra.obs) || [];
    if (obs.length <= 1) {
      box.innerHTML = '<p class="ix-cap">Only ' + obs.length + ' observation published for this session so far' +
        (obs.length === 1 ? ' (the close at ' + fmtPrice(obs[0].v) + ')' : '') +
        '. The intraday path appears during market hours as observations accumulate.</p>';
      return;
    }
    box.innerHTML = '<div class="ix-chartbed"><canvas id="ixIntraChart" role="img" aria-label="Intraday NEPSE index path"></canvas></div>' +
      '<p class="ix-cap">' + obs.length + ' observations · ' + esc(obs[0].t) + ' – ' + esc(obs[obs.length - 1].t) + ' NPT.</p>';
    var cv = $('ixIntraChart');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 800, h = cv.clientHeight || 300;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    var vals = obs.map(function (o) { return num(o.v); }).filter(function (v) { return !isNaN(v); });
    if (vals.length < 2) return;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var pad = (max - min) * 0.05 || 1;
    min -= pad; max += pad;
    var L = 8, R = 8, T = 10, B = 8;
    var X = function (i) { return L + (i / (vals.length - 1)) * (w - L - R); };
    var Y = function (v) { return T + (1 - (v - min) / (max - min)) * (h - T - B); };
    var light = themeIsLight();
    ctx.beginPath();
    ctx.moveTo(X(0), Y(vals[0]));
    for (var i = 1; i < vals.length; i++) ctx.lineTo(X(i), Y(vals[i]));
    ctx.strokeStyle = light ? '#4D7C0F' : '#B8E62E'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  }

  /* ---------------- boot + 60s value-gated tick --------------------- */
  var lastFp = null, lastLive = null, lastSession = '';

  function fingerprint(live) {
    var idx = (live && live.index) || {};
    return String(idx.value) + '|' + String(idx.last_updated) + '|' +
      String((live.quotes || []).length) + '|' + String(live.market || '');
  }

  function boot() {
    fetchJSON(LIVE_URL).then(function (live) {
      lastLive = live; lastFp = fingerprint(live); lastSession = live.session_date || '';
      return fetchJSON(UNI_URL).then(function (uni) {
        return { live: live, uniCount: (uni && uni.count) || null };
      }, function () { return { live: live, uniCount: null }; });
    }).then(function (res) {
      renderLive(res.live, res.uniCount);
    }, function () {
      var el = $('ixAsof');
      if (el) el.textContent = 'Live index data unavailable.';
    });
    fetchJSON(HIST_URL).then(renderHistory, function () {
      var cc = $('ixChartCap');
      if (cc) cc.textContent = 'Index history unavailable.';
    });
    fetchJSON(INTRA_URL).then(renderIntra, function () {
      var box = $('ixIntraBox');
      if (box) box.innerHTML = '<p class="ix-cap">Intraday path unavailable for this session.</p>';
    });
    /* Redraw canvas on theme flip (colors are theme-paired). */
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        var pills = $('ixPeriodPills');
        var cur = '1Y';
        if (pills) {
          var on = pills.querySelector('button[aria-pressed="true"]');
          if (on) cur = on.getAttribute('data-period');
        }
        drawChart(cur);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-nd-ed'] });
    }
    window.addEventListener('resize', function () {
      var pills = $('ixPeriodPills');
      var cur = '1Y';
      if (pills) {
        var on = pills.querySelector('button[aria-pressed="true"]');
        if (on) cur = on.getAttribute('data-period');
      }
      drawChart(cur);
    });
    setInterval(function () {
      fetchJSON(LIVE_URL).then(function (live) {
        var fp = fingerprint(live);
        if (fp !== lastFp) {
          lastFp = fp; lastLive = live;
          fetchJSON(UNI_URL).then(function (uni) {
            renderLive(live, (uni && uni.count) || null);
          }, function () { renderLive(live, null); });
        } else if (lastLive) {
          updateFreshline((lastLive.index || {}).last_updated || lastLive.asof || '', lastSession);
        }
      }, function () { /* keep last render; never paint wrong numbers */ });
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
