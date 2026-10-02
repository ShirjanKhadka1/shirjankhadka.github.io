/* Nepse Decode valuation lab (S6 idiom) — shared canvas renderer.
   Reads #val-lab-data JSON embedded by tools/build-symbol-pages.js:
     { quarters:[labels], series:{SYM:{metricKey:[v|null...]}},
       pe:{SYM:num|null}, metrics:[{key,label,unit,kind,fmt,zeroBased}],
       focus, peerNames:{SYM:name}, fundPeriod, priceAsOf }
   Metric rows (.d2-metric-row[data-metric]) and peer chips
   (.d2-bank-chips button[data-sym]) drive one shared canvas (#valChart).
   HONESTY: P/E renders only as a point-in-time peer ranking bar chart —
   never as a historical trend (historical P/E priced at today's price would
   mislead). Every line drawn is a published quarterly filing figure:
   profit lines are implied standalone quarters. No animation, so
   reduced-motion is honored by construction. */
(function () {
  'use strict';
  var mount = document.getElementById('valLab');
  if (!mount) return;
  var dataEl = document.getElementById('val-lab-data');
  var canvas = document.getElementById('valChart');
  if (!dataEl || !canvas) return;
  var D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!D || !D.quarters || !D.series) return;

  var ctx = canvas.getContext('2d');
  var activeKey = (D.metrics && D.metrics[0] && D.metrics[0].key) || null;
  var focusSym = D.focus;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function cssVar(n, fb) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(n);
      if (v && v.trim()) return v.trim();
    } catch (e) {}
    return fb;
  }
  var C = {
    volt: cssVar('--d2-volt', '#c8f04b'),
    ink: cssVar('--d2-ink', '#e9eef5'),
    muted: cssVar('--d2-muted', '#7d8898'),
    faint: cssVar('--d2-faint', '#525c6c'),
    grid: cssVar('--d2-line-soft', '#1b2330'),
    bar: cssVar('--d2-surface3', '#1a2230')
  };

  function metricOf(key) {
    for (var i = 0; i < D.metrics.length; i++) if (D.metrics[i].key === key) return D.metrics[i];
    return null;
  }
  function syms() {
    var out = [focusSym];
    Object.keys(D.series).forEach(function (s) { if (s !== focusSym) out.push(s); });
    return out;
  }
  function fmtTick(m, v) {
    if (m.fmt === 'money') {
      var a = Math.abs(v);
      if (a >= 1) return v.toFixed(a >= 10 ? 0 : 1) + 'b';
      return (v * 1000).toFixed(0) + 'm';
    }
    if (m.fmt === 'pct') return v.toFixed(1) + '%';
    if (m.fmt === 'rs') return v.toFixed(0);
    return String(v);
  }
  function fmtVal(m, v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (m.fmt === 'money') {
      var a = Math.abs(v);
      return 'Rs ' + (a < 1 ? (v * 1000).toFixed(1) + 'm' : v.toFixed(2) + 'b');
    }
    if (m.fmt === 'pct') return v.toFixed(2) + '%';
    if (m.fmt === 'rs') return 'Rs ' + v.toFixed(2);
    return String(v);
  }

  function sizeCanvas() {
    var r = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(280, Math.round(r.width * dpr));
    var h = Math.max(200, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w: w, h: h, dpr: dpr };
  }

  function drawMessage(msg) {
    var s = sizeCanvas();
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = C.muted;
    ctx.font = (13 * s.dpr) + 'px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, s.w / 2, s.h / 2, s.w - 40 * s.dpr);
  }

  function setHead(title, sub, legendHtml, aria) {
    var t = document.getElementById('valChartTitle');
    var st = document.getElementById('valChartSub');
    var lg = document.getElementById('valLegend');
    if (t) t.textContent = title;
    if (st) st.textContent = sub;
    if (lg) lg.innerHTML = legendHtml;
    canvas.setAttribute('aria-label', aria);
  }
  function legendSwatch(color, label) {
    return '<span><i style="background:' + color + '"></i>' + label + '</span>';
  }

  function drawLines(m) {
    var labels = D.quarters;
    var list = syms();
    var all = [];
    list.forEach(function (s) {
      (D.series[s][m.key] || []).forEach(function (v) { if (v !== null && isFinite(v)) all.push(v); });
    });
    var peerN = list.length - 1;
    setHead(m.label,
      'quarterly, ' + m.unit + ' · ' + labels.length + ' quarters · ' + focusSym + ' vs ' + peerN + ' peers',
      legendSwatch(C.volt, focusSym) + legendSwatch(C.faint, peerN + ' peers'),
      m.label + ', quarterly ' + m.unit + ', last ' + labels.length + ' quarters: ' + focusSym +
      ' against ' + peerN + ' ' + (D.sector || 'sector') + ' peers. Published quarterly figures.');
    if (!all.length) {
      drawMessage('No published ' + m.label.toLowerCase() + ' figures for this peer set in the last ' + labels.length + ' quarters.');
      return;
    }
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (lo === hi) { lo -= 1; hi += 1; }
    if (m.zeroBased && lo > 0) lo = 0;
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;

    var s = sizeCanvas(), dpr = s.dpr;
    ctx.clearRect(0, 0, s.w, s.h);
    var padL = 52 * dpr, padR = 12 * dpr, padT = 14 * dpr, padB = 30 * dpr;
    var pw = s.w - padL - padR, ph = s.h - padT - padB;
    var n = labels.length;
    var X = function (i) { return padL + (n === 1 ? pw / 2 : i * pw / (n - 1)); };
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * ph; };

    ctx.font = (11 * dpr) + 'px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    // gridlines + y ticks
    for (var g = 0; g <= 4; g++) {
      var tv = lo + (hi - lo) * g / 4;
      var yy = Y(tv);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(s.w - padR, yy); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.textAlign = 'right';
      ctx.fillText(fmtTick(m, tv), padL - 8 * dpr, yy);
    }
    // x labels (skip to avoid collision)
    var step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / (64 * dpr)))));
    ctx.fillStyle = C.muted; ctx.textAlign = 'center';
    for (var i = 0; i < n; i += step) ctx.fillText(labels[i], X(i), s.h - padB / 2);
    // peers first (muted), focus last (volt)
    var order = list.filter(function (x) { return x !== focusSym; }).concat([focusSym]);
    order.forEach(function (symb) {
      var vals = D.series[symb][m.key] || [];
      var isFocus = symb === focusSym;
      ctx.strokeStyle = isFocus ? C.volt : C.faint;
      ctx.lineWidth = (isFocus ? 2.5 : 1.5) * dpr;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      var started = false;
      for (var k = 0; k < n; k++) {
        var v = vals[k];
        if (v === null || v === undefined || !isFinite(v)) { started = false; continue; }
        if (!started) { ctx.moveTo(X(k), Y(v)); started = true; }
        else ctx.lineTo(X(k), Y(v));
      }
      ctx.stroke();
      if (isFocus) {
        ctx.fillStyle = C.volt;
        for (var k2 = 0; k2 < n; k2++) {
          var v2 = vals[k2];
          if (v2 === null || v2 === undefined || !isFinite(v2)) continue;
          ctx.beginPath(); ctx.arc(X(k2), Y(v2), 3 * dpr, 0, 7); ctx.fill();
        }
      }
    });
  }

  function drawPe() {
    var rows = Object.keys(D.pe || {})
      .map(function (s) { return { s: s, pe: D.pe[s] }; })
      .filter(function (r) { return r.pe !== null && r.pe !== undefined && isFinite(r.pe) && r.pe > 0; })
      .sort(function (a, b) { return a.pe - b.pe; });
    setHead('P/E (TTM) peer ranking',
      'point-in-time · latest published quarter · lower is cheaper on earnings',
      legendSwatch(C.volt, focusSym + ' (this page)') + legendSwatch(C.bar, 'peers'),
      'P/E TTM peer ranking, point in time, latest published quarter: ' +
      rows.map(function (r) { return r.s + ' ' + r.pe.toFixed(1) + 'x'; }).join(', ') +
      '. Not a historical trend.');
    if (!rows.length) {
      drawMessage('P/E not published for this peer set.');
      return;
    }
    var s = sizeCanvas(), dpr = s.dpr;
    ctx.clearRect(0, 0, s.w, s.h);
    var max = Math.max.apply(null, rows.map(function (r) { return r.pe; }));
    var padL = 64 * dpr, padR = 52 * dpr, padT = 10 * dpr;
    var gap = 10 * dpr;
    var bh = Math.min(30 * dpr, (s.h - padT - 10 * dpr) / rows.length - gap);
    if (bh < 8 * dpr) bh = 8 * dpr;
    ctx.font = (12 * dpr) + 'px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    rows.forEach(function (r, i) {
      var y = padT + i * (bh + gap);
      var isFocus = r.s === focusSym;
      ctx.fillStyle = C.ink; ctx.textAlign = 'right';
      ctx.fillText(r.s, padL - 10 * dpr, y + bh / 2);
      var bw = (r.pe / max) * (s.w - padL - padR);
      ctx.fillStyle = isFocus ? C.volt : C.bar;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(padL, y, Math.max(2 * dpr, bw), bh, 4 * dpr); ctx.fill(); }
      else ctx.fillRect(padL, y, Math.max(2 * dpr, bw), bh);
      ctx.fillStyle = isFocus ? C.volt : C.muted; ctx.textAlign = 'left';
      ctx.fillText(r.pe.toFixed(1) + '×', padL + bw + 8 * dpr, y + bh / 2);
    });
  }

  function draw() {
    if (!activeKey) return;
    if (activeKey === '__pe') drawPe();
    else { var m = metricOf(activeKey); if (m) drawLines(m); }
  }

  // metric rows
  var rows = mount.querySelectorAll('.d2-metric-row[data-metric]');
  rows.forEach(function (r) {
    r.addEventListener('click', function () {
      activeKey = r.getAttribute('data-metric');
      rows.forEach(function (x) { x.setAttribute('aria-pressed', x === r ? 'true' : 'false'); });
      draw();
    });
  });
  // peer chips
  var chips = mount.querySelectorAll('.d2-bank-chips button[data-sym]');
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      focusSym = c.getAttribute('data-sym');
      chips.forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
      // refresh the metric row values to the newly focused company
      rows.forEach(function (r) {
        var key = r.getAttribute('data-metric');
        var valEl = r.querySelector('.m-val');
        if (!valEl) return;
        if (key === '__pe') {
          var pe = D.pe[focusSym];
          valEl.textContent = (pe !== null && pe !== undefined && isFinite(pe) && pe > 0) ? pe.toFixed(2) + '×' : '—';
        } else {
          var m = metricOf(key);
          var vals = (D.series[focusSym] && D.series[focusSym][key]) || [];
          var last = null;
          for (var i = vals.length - 1; i >= 0; i--) { if (vals[i] !== null && isFinite(vals[i])) { last = vals[i]; break; } }
          valEl.textContent = m ? fmtVal(m, last) : '—';
        }
      });
      var coSym = document.getElementById('valCoSym');
      var coName = document.getElementById('valCoName');
      if (coSym) coSym.textContent = focusSym;
      if (coName && D.peerNames) coName.textContent = D.peerNames[focusSym] || '';
      draw();
    });
  });

  var raf = null;
  function drawSoon() {
    if (reduced) { draw(); return; }
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }
  var rsT = null;
  window.addEventListener('resize', function () {
    if (rsT) clearTimeout(rsT);
    rsT = setTimeout(drawSoon, 150);
  });
  // the lab lives in a hidden tab panel until the Fundamentals tab opens —
  // redraw then so the canvas has a real size.
  document.querySelectorAll('.sp-tab[data-tab="fundamentals"]').forEach(function (t) {
    t.addEventListener('click', function () { setTimeout(drawSoon, 60); });
  });

  drawSoon();
})();
