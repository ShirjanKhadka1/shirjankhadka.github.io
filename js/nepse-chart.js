/* Interactive NEPSE 23-year chart — canvas line chart with scroll-triggered
   draw animation, hover crosshair + tooltip, and key event annotations.
   Data: window.NEPSE_MONTHLY = [[isoDate, close], ...] (monthly closes). */
(function () {
  'use strict';

  var canvas = document.getElementById('nepseChart');
  if (!canvas || !window.NEPSE_MONTHLY || !window.NEPSE_MONTHLY.length) return;

  var DATA = window.NEPSE_MONTHLY;
  var tip = document.getElementById('nepseTip');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(iso) {
    var p = iso.split('-');
    return MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function fmtNum(n) {
    return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 });
  }

  // Key annotations on the monthly-close line
  var NOTES = [
    { date: '2008-08-31', label: '2008 peak · 1,175' },
    { date: '2020-05-13', label: 'COVID crash · 1,202' }
  ];

  // True all-time high: 3,199.03 daily close (Sep 2021). Plotted as its own
  // marker above the monthly-close line, since monthly closes never print it.
  var ATH = { date: '2021-09-02', value: 3199.03, label: 'All-time high · 3,199' };

  var W = 0, H = 0, dpr = 1;
  var padL = 52, padR = 14, padT = 26, padB = 34;
  var minV, maxV, pts = [];

  function compute() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(280, rect.width);
    H = canvas.classList.contains('chart-tall') ? 380 : 320;
    if (window.innerWidth < 560) H = 260;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';

    minV = Infinity; maxV = -Infinity;
    DATA.forEach(function (d) {
      if (d[1] < minV) minV = d[1];
      if (d[1] > maxV) maxV = d[1];
    });
    var span = maxV - minV;
    minV = Math.max(0, minV - span * 0.08);
    maxV = Math.max(maxV + span * 0.10, ATH.value + span * 0.06);

    pts = DATA.map(function (d, i) {
      return {
        x: padL + (W - padL - padR) * (i / (DATA.length - 1)),
        y: padT + (H - padT - padB) * (1 - (d[1] - minV) / (maxV - minV)),
        v: d[1],
        date: d[0]
      };
    });
  }

  function xForDate(iso) {
    for (var i = 0; i < DATA.length; i++) {
      if (DATA[i][0] >= iso) return pts[i];
    }
    return pts[pts.length - 1];
  }

  var ACCENT = '#3ddc84';
  var GRID = 'rgba(255,255,255,0.08)';
  var TEXT = 'rgba(255,255,255,0.45)';

  function draw(progress, hoverIdx) {
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Gridlines + y labels
    ctx.font = '11px -apple-system, "SF Pro Text", Inter, sans-serif';
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var step = 500;
    for (var g = Math.ceil(minV / step) * step; g <= maxV; g += step) {
      var gy = padT + (H - padT - padB) * (1 - (g - minV) / (maxV - minV));
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
      ctx.fillText(g.toLocaleString('en-US'), padL - 8, gy);
    }
    // X labels: every ~4 years
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var seen = {};
    pts.forEach(function (p, i) {
      var yr = p.date.slice(0, 4);
      if (i === 0 || (parseInt(yr, 10) % 4 === 0 && p.date.slice(5, 7) === '01' && !seen[yr])) {
        seen[yr] = true;
        ctx.fillText(yr, p.x, H - padB + 10);
      }
    });

    var n = Math.max(2, Math.floor(pts.length * progress));

    // Area fill under the drawn portion
    if (n > 1) {
      var grad = ctx.createLinearGradient(0, padT, 0, H - padB);
      grad.addColorStop(0, 'rgba(61,220,132,0.28)');
      grad.addColorStop(1, 'rgba(61,220,132,0)');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, H - padB);
      for (var i = 0; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[n - 1].x, H - padB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.globalAlpha = Math.min(1, progress * 1.4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The line itself
    ctx.beginPath();
    for (var j = 0; j < n; j++) {
      if (j === 0) ctx.moveTo(pts[j].x, pts[j].y);
      else ctx.lineTo(pts[j].x, pts[j].y);
    }
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Annotations (fade in near the end)
    if (progress > 0.75) {
      ctx.globalAlpha = Math.min(1, (progress - 0.75) / 0.25);
      NOTES.forEach(function (nt) {
        var p = xForDate(nt.date);
        if (!p) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0b0d10';
        ctx.fill();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '11px -apple-system, "SF Pro Text", Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(nt.label, p.x, p.date === '2020-05-13' ? p.y + 16 : p.y - 12);
      });
      // All-time high marker: gold diamond above the monthly line
      var ap = xForDate(ATH.date);
      if (ap) {
        var ay = padT + (H - padT - padB) * (1 - (ATH.value - minV) / (maxV - minV));
        ctx.beginPath();
        ctx.arc(ap.x, ay, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212,175,55,0.22)';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(ap.x, ay - 6);
        ctx.lineTo(ap.x + 6, ay);
        ctx.lineTo(ap.x, ay + 6);
        ctx.lineTo(ap.x - 6, ay);
        ctx.closePath();
        ctx.fillStyle = '#d4af37';
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '600 11px -apple-system, "SF Pro Text", Inter, sans-serif';
        ctx.textAlign = 'center';
        var alx = Math.max(ap.x, padL + 70);
        ctx.fillText(ATH.label, alx, ay - 15);
      }
      ctx.globalAlpha = 1;
    }

    // Hover crosshair
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < pts.length) {
      var hp = pts[hoverIdx];
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hp.x, padT); ctx.lineTo(hp.x, H - padB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 8.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(61,220,132,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Draw-on-scroll animation
  var progress = 0, animating = false, rafId = null;
  function animate() {
    if (animating) return;
    animating = true;
    var start = null, DUR = 2200;
    function frame(t) {
      if (!start) start = t;
      var p = Math.min(1, (t - start) / DUR);
      progress = 1 - Math.pow(1 - p, 3); // easeOutCubic
      draw(progress, hoverIdx);
      if (p < 1) rafId = requestAnimationFrame(frame);
      else { animating = false; rafId = null; }
    }
    rafId = requestAnimationFrame(frame);
  }

  var hoverIdx = null;
  function nearestIdx(clientX) {
    var r = canvas.getBoundingClientRect();
    var x = clientX - r.left;
    var best = 0, bd = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.abs(pts[i].x - x);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function showTip(i) {
    if (!tip) return;
    var p = pts[i];
    tip.innerHTML = '<strong>' + fmtNum(p.v) + '</strong><span>' + fmtDate(p.date) + '</span>';
    tip.hidden = false;
    var r = canvas.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = p.x - tw / 2;
    x = Math.max(4, Math.min(r.width - tw - 4, x));
    var y = p.y - th - 14;
    if (y < 4) y = p.y + 14;
    tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }
  function hideTip() { if (tip) tip.hidden = true; hoverIdx = null; draw(progress, null); }

  canvas.addEventListener('pointermove', function (e) {
    hoverIdx = nearestIdx(e.clientX);
    draw(progress, hoverIdx);
    showTip(hoverIdx);
  });
  canvas.addEventListener('pointerleave', hideTip);
  // Touch: tap to inspect
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') {
      hoverIdx = nearestIdx(e.clientX);
      draw(progress, hoverIdx);
      showTip(hoverIdx);
    }
  });

  function render() { compute(); draw(progress, hoverIdx); }

  var ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(function () { render(); });
    ro.observe(canvas);
  }
  window.addEventListener('orientationchange', render);

  if (reduceMotion) {
    progress = 1;
    render();
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { animate(); io.disconnect(); }
      });
    }, { threshold: 0.3 });
    compute();
    draw(0, null);
    io.observe(canvas);
  } else {
    progress = 1;
    render();
  }
})();
