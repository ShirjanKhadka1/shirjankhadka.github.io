/* Nepse Decode — 3D Market Landscape (Wave F, 2026-10-23)
 *
 * Hand-rolled raw-WebGL renderer. No library. Every listed security in the
 * universe file becomes one extruded block on a sector-grouped terrain:
 *   block height  = turnover (sqrt scale, labelled as such)
 *   face colour   = day-change band (same bands as the 2D market map)
 *   no-trade      = low hatched slab — NEVER silently absent (the audit's
 *                   heatmap hole is the anti-pattern this component fixes)
 *
 * Data honesty: built from the real files only —
 *   /nepse-chart/data/live.json     (session tape: ltp, % change, turnover)
 *   /nepse-chart/data/universe.json (the full listed universe + names)
 *   /nepse-chart/data/verdicts.json (daily batch: sector + last close)
 * A symbol with no tape quote renders as a no-data block and its tooltip
 * says so, with the daily-batch close shown and labelled as batch data.
 *
 * Performance contract (the owner's acceptance test):
 *   - lazy: nothing here runs until the host page mounts the component
 *   - renders on demand (interaction / intro / resize), never a free loop
 *   - pauses when the tab is hidden or the canvas is offscreen
 *   - FPS watchdog: sustained <28fps during motion -> static frame;
 *     <12fps or no WebGL -> text fallback (the data list stays available)
 *   - prefers-reduced-motion: static cinematic angle, no intro sweep
 *
 * API: window.NDLandscape3D.mount(canvas, opts) -> handle {destroy, focus}
 *   opts: { liveUrl, universeUrl, verdictsUrl, tipEl, statusEl, listEl,
 *           labelsEl, noteEl, onSelect(sym) }
 * Node export (verification only): buildData / layoutTerrain.
 */
(function (global) {
  'use strict';

  /* ---------------- formatting (house style: en-IN, lakh/crore words) --- */
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e7) return 'Rs ' + (v / 1e7).toFixed(2) + ' crore';
    if (a >= 1e5) return 'Rs ' + (v / 1e5).toFixed(2) + ' lakh';
    return 'Rs ' + Math.round(v).toLocaleString('en-IN');
  }
  function num2(v) {
    return (v == null || !isFinite(v)) ? '—'
      : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }
  function stockUrl(sym) {
    return '/stocks/' + encodeURIComponent(String(sym).replace(/\//g, '-')) + '/';
  }

  /* ---------------- day-change bands (kept in sync with the 2D map) --- */
  function bandOf(ch) {
    if (ch == null || isNaN(ch)) return 'none';
    if (ch >= 1.5) return 'up2';
    if (ch >= 0.25) return 'up1';
    if (ch > -0.25) return 'n';
    if (ch > -1.5) return 'dn1';
    return 'dn2';
  }
  var BAND_RGB = {
    dark: {
      up2: [0.24, 0.86, 0.52], up1: [0.18, 0.56, 0.34], n: [0.20, 0.25, 0.34],
      dn1: [0.76, 0.33, 0.30], dn2: [1.00, 0.36, 0.36], none: [0.10, 0.13, 0.19],
      plate: [0.07, 0.09, 0.13], ground: [0.05, 0.06, 0.09]
    },
    light: {
      up2: [0.12, 0.48, 0.27], up1: [0.55, 0.78, 0.55], n: [0.85, 0.83, 0.78],
      dn1: [0.85, 0.55, 0.48], dn2: [0.70, 0.23, 0.18], none: [0.80, 0.76, 0.66],
      plate: [0.90, 0.88, 0.82], ground: [0.93, 0.92, 0.88]
    }
  };

  /* ---------------- data build (pure; node-verifiable) ----------------- */
  function buildData(live, uni, verd) {
    var tape = {};
    ((live && live.quotes) || []).forEach(function (q) { tape[q.symbol] = q; });
    var vv = (verd && verd.verdicts) || {};
    var bySec = {};
    var total = 0, traded = 0, maxTurn = 0;
    ((uni && uni.symbols) || []).forEach(function (s) {
      var e = vv[s.s] || {};
      var sec = (e.sec && e.sec !== 'Unknown') ? e.sec : 'Others';
      var q = tape[s.s] || null;
      var turn = q ? (Number(q.turnover) || 0) : 0;
      if (q) { traded++; if (turn > maxTurn) maxTurn = turn; }
      var row = {
        sym: s.s, name: s.n || s.s, sector: sec, traded: !!q,
        ltp: q ? q.ltp : null,
        pct: q ? q.percent_change : null,
        turn: turn, vol: q ? q.volume : null,
        batchP: (e.p != null ? Number(e.p) : null),
        batchCh: (e.ch != null ? Number(e.ch) : null),
        batchAsof: e.asof || (verd && verd.asof) || ''
      };
      (bySec[sec] = bySec[sec] || []).push(row);
      total++;
    });
    var sectors = Object.keys(bySec).map(function (k) {
      var rows = bySec[k].slice().sort(function (a, b) { return (b.turn || 0) - (a.turn || 0); });
      return { name: k, rows: rows };
    }).sort(function (a, b) { return b.rows.length - a.rows.length; });
    return {
      sectors: sectors, total: total, traded: traded, noData: total - traded,
      maxTurn: maxTurn,
      asof: (live && live.asof) || '', session: (live && live.session_date) || '',
      source: (live && live.source) || 'NEPSE'
    };
  }

  /* ---------------- terrain layout (pure; node-verifiable) ------------- */
  var CELL = 1.0, GAP = 0.22, PLATE_PAD = 0.55, SHELF_GAP = 1.5, MAX_ROW_W = 52;
  function layoutTerrain(data) {
    var blocks = [], plates = [];
    var x = 0, z = 0, shelfDepth = 0;
    data.sectors.forEach(function (sec) {
      var n = sec.rows.length;
      var cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.5)));
      var rowsN = Math.ceil(n / cols);
      var w = cols * (CELL + GAP) - GAP + PLATE_PAD * 2;
      var d = rowsN * (CELL + GAP) - GAP + PLATE_PAD * 2;
      if (x > 0 && x + w > MAX_ROW_W) { x = 0; z += shelfDepth + SHELF_GAP; shelfDepth = 0; }
      var plate = { name: sec.name, x: x, z: z, w: w, d: d, cx: x + w / 2, cz: z + d / 2 };
      plates.push(plate);
      sec.rows.forEach(function (r, i) {
        var c = i % cols, rr = Math.floor(i / cols);
        var bx = x + PLATE_PAD + c * (CELL + GAP);
        var bz = z + PLATE_PAD + rr * (CELL + GAP);
        var h = r.traded
          ? 0.6 + Math.sqrt(Math.max(0, r.turn) / (data.maxTurn || 1)) * 6.4
          : 0.3;
        blocks.push({
          row: r, x: bx, z: bz, w: CELL, d: CELL, h: h,
          cx: bx + CELL / 2, cz: bz + CELL / 2, sector: sec.name
        });
      });
      x += w + SHELF_GAP;
      if (d > shelfDepth) shelfDepth = d;
    });
    var depth = z + shelfDepth;
    // centre the terrain on the origin
    blocks.forEach(function (b) { b.x -= MAX_ROW_W / 2; b.cx -= MAX_ROW_W / 2; b.z -= depth / 2; b.cz -= depth / 2; });
    plates.forEach(function (p) { p.x -= MAX_ROW_W / 2; p.cx -= MAX_ROW_W / 2; p.z -= depth / 2; p.cz -= depth / 2; });
    var radius = Math.sqrt(Math.pow(MAX_ROW_W / 2, 2) + Math.pow(depth / 2, 2));
    return { blocks: blocks, plates: plates, width: MAX_ROW_W, depth: depth, radius: radius };
  }

  /* ---------------- tiny mat4 (column-major) --------------------------- */
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, ctr, up) {
    var zx = eye[0] - ctr[0], zy = eye[1] - ctr[1], zz = eye[2] - ctr[2];
    var zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
  }
  function multiply(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function project(m, p, w, h) {
    var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    var y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    var z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    var ww = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (!ww) return null;
    return [ (x / ww * 0.5 + 0.5) * w, (0.5 - y / ww * 0.5) * h, z / ww ];
  }

  /* ---------------- shaders -------------------------------------------- */
  var VSH = [
    'attribute vec3 aPos; attribute vec3 aNorm; attribute vec3 aCol; attribute float aFlag;',
    'uniform mat4 uMVP; uniform mat4 uView;',
    'varying vec3 vCol; varying vec3 vNorm; varying float vFlag; varying vec2 vXZ;',
    'void main(){ vCol=aCol; vFlag=aFlag; vXZ=aPos.xz;',
    ' vNorm = normalize(mat3(uView[0].xyz, uView[1].xyz, uView[2].xyz) * aNorm);',
    ' gl_Position = uMVP * vec4(aPos, 1.0); }'
  ].join('\n');
  var FSH = [
    'precision mediump float;',
    'varying vec3 vCol; varying vec3 vNorm; varying float vFlag; varying vec2 vXZ;',
    'void main(){',
    ' vec3 L = normalize(vec3(0.35, 0.85, 0.4));',
    ' float dif = max(dot(normalize(vNorm), L), 0.0);',
    ' vec3 c = vCol * (0.42 + 0.62 * dif);',
    ' if (vFlag < 0.5) {',                       /* no-data: hatched slab */
    '   float s = step(0.55, fract((vXZ.x + vXZ.y) * 2.4));',
    '   c = mix(c, c * 1.9 + vec3(0.05), s * 0.55);',
    ' }',
    ' if (vFlag > 2.5 && vFlag < 3.5) {',        /* ground: faint grid */
    '   vec2 g = abs(fract(vXZ) - 0.5);',
    '   float line = smoothstep(0.48, 0.5, max(g.x, g.y));',
    '   c = mix(c, c + vec3(0.05, 0.06, 0.05), line);',
    ' }',
    ' gl_FragColor = vec4(c, 1.0); }'
  ].join('\n');

  /* face table for a box: [dx,dy,dz, nx,ny,nz] per face, CCW triangles */
  var FACES = [
    [0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 0],
    [0, 0, -1, 0, 0, -1], [-1, 0, 0, -1, 0, 0], [0, -1, 0, 0, -1, 0]
  ];
  function boxVerts(out, x, y, z, w, h, d, col, flag) {
    var x0 = x, x1 = x + w, y0 = y, y1 = y + h, z0 = z, z1 = z + d;
    var c = {
      '0,1,0': [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
      '0,0,1': [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]],
      '1,0,0': [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]],
      '0,0,-1': [[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]],
      '-1,0,0': [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
      '0,-1,0': [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]
    };
    FACES.forEach(function (f) {
      var key = f[3] + ',' + f[4] + ',' + f[5];
      var q = c[key], idx = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var p = q[idx[i]];
        out.push(p[0], p[1], p[2], f[3], f[4], f[5], col[0], col[1], col[2], flag);
      }
    });
  }

  /* ---------------- the component -------------------------------------- */
  function mount(canvas, opts) {
    opts = opts || {};
    var tip = opts.tipEl || null, statusEl = opts.statusEl || null,
        listEl = opts.listEl || null, labelsEl = opts.labelsEl || null,
        noteEl = opts.noteEl || null;
    var destroyed = false, gl = null, prog = null, buf = null, lineBuf = null;
    var data = null, layout = null, vertCount = 0;
    var cam = { az: -0.65, pol: 1.0, dist: 60, tx: 0, ty: 0, tz: 0 };
    var home = null;
    var hover = -1, focused = -1, focusMode = false;
    var running = false, rafId = 0, inView = true, intro = null;
    var fpsSamples = [], staticMode = false, fellBack = false;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function setNote(msg) { if (noteEl) { noteEl.hidden = !msg; noteEl.textContent = msg || ''; } }
    function fallback(msg) {
      if (fellBack) return; fellBack = true;
      stopLoop();
      canvas.style.display = 'none';
      if (canvas.parentElement) canvas.parentElement.classList.add('nd3d-dead');
      setNote(msg + ' The full data list below carries every value.');
      if (statusEl) statusEl.textContent = msg;
    }

    /* ---- GL setup ---- */
    function initGL() {
      gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
           canvas.getContext('experimental-webgl');
      if (!gl) return false;
      function sh(type, src) {
        var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
        return s;
      }
      var vs = sh(gl.VERTEX_SHADER, VSH), fs = sh(gl.FRAGMENT_SHADER, FSH);
      if (!vs || !fs) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      gl.enable(gl.DEPTH_TEST);
      buf = gl.createBuffer(); lineBuf = gl.createBuffer();
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault(); fallback('3D view unavailable (graphics context lost).');
      });
      return true;
    }
    function bindAttrs(buffer, dataArr) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (dataArr) gl.bufferData(gl.ARRAY_BUFFER, dataArr, gl.STATIC_DRAW);
      var stride = 10 * 4;
      [['aPos', 3, 0], ['aNorm', 3, 3], ['aCol', 3, 6], ['aFlag', 1, 9]].forEach(function (a) {
        var loc = gl.getAttribLocation(prog, a[0]);
        if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, a[1], gl.FLOAT, false, stride, a[2] * 4); }
      });
    }
    function theme() {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }
    function buildGeometry() {
      var pal = BAND_RGB[theme()];
      var arr = [];
      // ground
      boxVerts(arr, -layout.width / 2 - 6, -0.14, -layout.depth / 2 - 6,
        layout.width + 12, 0.12, layout.depth + 12, pal.ground, 3);
      // sector plates
      layout.plates.forEach(function (p) {
        boxVerts(arr, p.x, -0.02, p.z, p.w, 0.14, p.d, pal.plate, 2);
      });
      // blocks
      layout.blocks.forEach(function (b) {
        var col = b.row.traded ? pal[bandOf(b.row.pct)] : pal.none;
        boxVerts(arr, b.x, 0.12, b.z, b.w, b.h, b.d, col, b.row.traded ? 1 : 0);
      });
      vertCount = arr.length / 10;
      bindAttrs(buf, new Float32Array(arr));
    }

    /* ---- camera / render ---- */
    function viewProj() {
      var w = canvas.width, h = canvas.height;
      var proj = perspective(0.72, w / h, 0.1, 500);
      var sp = Math.sin(cam.pol), eye = [
        cam.tx + cam.dist * sp * Math.sin(cam.az),
        cam.ty + cam.dist * Math.cos(cam.pol),
        cam.tz + cam.dist * sp * Math.cos(cam.az)
      ];
      var view = lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
      return { mvp: multiply(proj, view), view: view, eye: eye };
    }
    function draw() {
      if (!gl || fellBack) return;
      var vp = viewProj();
      var bg = theme() === 'light' ? [0.93, 0.92, 0.88] : [0.035, 0.04, 0.055];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, vp.mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uView'), false, vp.view);
      bindAttrs(buf, null); // re-point attribs at main buffer (data already uploaded)
      gl.drawArrays(gl.TRIANGLES, 0, vertCount);
      drawHighlight(vp);
      placeLabels(vp);
    }
    function drawHighlight(vp) {
      var i = hover >= 0 ? hover : (focusMode ? focused : -1);
      if (i < 0 || !layout) return;
      var b = layout.blocks[i];
      var lime = [0.722, 0.902, 0.180]; /* #B8E62E */
      var pts = [];
      var x0 = b.x - 0.05, x1 = b.x + b.w + 0.05, y0 = 0.1, y1 = 0.12 + b.h + 0.05, z0 = b.z - 0.05, z1 = b.z + b.d + 0.05;
      var corners = [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
      var edges = [0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7];
      var arr = [];
      edges.forEach(function (ci) {
        var p = corners[ci];
        arr.push(p[0], p[1], p[2], 0, 1, 0, lime[0], lime[1], lime[2], 1);
      });
      bindAttrs(lineBuf, new Float32Array(arr));
      gl.drawArrays(gl.LINES, 0, 24);
      bindAttrs(buf, null);
      void vp;
    }
    function placeLabels(vp) {
      if (!labelsEl || !layout) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      layout.plates.forEach(function (p, i) {
        var el = labelsEl.children[i]; if (!el) return;
        var s = project(vp.mvp, [p.cx, 0.2, p.z + p.d - 0.4], w, h);
        if (!s || s[2] > 1) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.style.transform = 'translate(-50%,0) translate(' + s[0].toFixed(1) + 'px,' + s[1].toFixed(1) + 'px)';
      });
    }

    /* ---- render loop: on demand only ---- */
    function requestFrame() { if (!running && !destroyed && !fellBack) { running = true; rafId = requestAnimationFrame(tick); } }
    function stopLoop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
    var lastT = 0;
    function tick(t) {
      rafId = 0;
      if (destroyed || fellBack) { running = false; return; }
      if (document.hidden || !inView) { running = false; return; }
      var dt = lastT ? t - lastT : 16; lastT = t;
      if (intro) {
        var k = Math.min(1, (t - intro.t0) / intro.dur);
        var e = 1 - Math.pow(1 - k, 3);
        cam.az = intro.from + (intro.to - intro.from) * e;
        if (k >= 1) intro = null;
      }
      draw();
      // FPS watchdog — only judges while animating (intro or drag)
      if (intro || dragging) {
        fpsSamples.push(dt);
        if (fpsSamples.length >= 45) {
          var avg = fpsSamples.reduce(function (a, b) { return a + b; }, 0) / fpsSamples.length;
          var fps = 1000 / Math.max(avg, 0.01);
          if (fps < 12) { fallback('3D view paused — this device is too slow for it.'); return; }
          if (fps < 28 && !staticMode) {
            staticMode = true; intro = null;
            setNote('Static 3D view — animation paused to keep this page fast on your device. Drag still works, one frame at a time.');
          }
          fpsSamples = [];
        }
      }
      if (intro || dragging) rafId = requestAnimationFrame(tick);
      else running = false;
    }

    /* ---- picking ---- */
    function pick(cx, cy) {
      if (!layout) return -1;
      var rect = canvas.getBoundingClientRect();
      var ndcX = ((cx - rect.left) / rect.width) * 2 - 1;
      var ndcY = 1 - ((cy - rect.top) / rect.height) * 2;
      var vp = viewProj();
      var eye = vp.eye, vw = vp.view;
      // camera basis straight from the view matrix (right/up/forward rows)
      var right = [vw[0], vw[4], vw[8]];
      var up = [vw[1], vw[5], vw[9]];
      var fwd = [-vw[2], -vw[6], -vw[10]];
      var tanF = Math.tan(0.72 / 2), aspect = rect.width / rect.height;
      var dir = [
        fwd[0] + ndcX * tanF * aspect * right[0] + ndcY * tanF * up[0],
        fwd[1] + ndcX * tanF * aspect * right[1] + ndcY * tanF * up[1],
        fwd[2] + ndcX * tanF * aspect * right[2] + ndcY * tanF * up[2]
      ];
      var dl = Math.hypot(dir[0], dir[1], dir[2]); dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      var best = -1, bestT = Infinity;
      for (var i = 0; i < layout.blocks.length; i++) {
        var b = layout.blocks[i];
        var mn = [b.x, 0.12, b.z], mx = [b.x + b.w, 0.12 + b.h, b.z + b.d];
        var tmin = 0, tmax = Infinity, ok = true;
        for (var a = 0; a < 3; a++) {
          if (Math.abs(dir[a]) < 1e-8) { if (eye[a] < mn[a] || eye[a] > mx[a]) { ok = false; break; } }
          else {
            var t1 = (mn[a] - eye[a]) / dir[a], t2 = (mx[a] - eye[a]) / dir[a];
            if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
            if (tmin > tmax) { ok = false; break; }
          }
        }
        if (ok && tmin < bestT) { bestT = tmin; best = i; }
      }
      return best;
    }

    /* ---- tooltip / status / list ---- */
    function tipHTML(b) {
      var r = b.row;
      var head = '<div class="t-sym">' + r.sym + '</div><div class="t-name">' + r.name + ' · ' + r.sector + '</div>';
      if (r.traded) {
        return head +
          '<div class="t-row"><span>Last price</span><b>Rs ' + num2(r.ltp) + '</b></div>' +
          '<div class="t-row"><span>Day change</span><b>' + pct(r.pct) + '</b></div>' +
          '<div class="t-row"><span>Turnover</span><b>' + money(r.turn) + '</b></div>' +
          '<div class="t-row"><span>Session</span><b>' + (data.session || '—') + '</b></div>';
      }
      var batch = (r.batchP != null)
        ? '<div class="t-row"><span>Daily-batch close</span><b>Rs ' + num2(r.batchP) + (r.batchCh != null ? ' (' + pct(r.batchCh) + ')' : '') + '</b></div>' +
          '<div class="t-row"><span>Batch date</span><b>' + (r.batchAsof || '—') + '</b></div>'
        : '';
      return head + '<div class="t-none">No trades recorded in the ' + (data.session || 'latest') + ' session tape.</div>' + batch;
    }
    function showTip(i, x, y) {
      if (!tip) return;
      if (i < 0) { tip.style.display = 'none'; return; }
      tip.innerHTML = tipHTML(layout.blocks[i]);
      tip.style.display = 'block';
      if (x != null) { tip.style.left = Math.min(window.innerWidth - 280, x + 14) + 'px'; tip.style.top = (y + 14) + 'px'; }
    }
    function paintStatus() {
      if (!statusEl || !data) return;
      statusEl.textContent =
        data.total + ' listed securities · ' + data.traded + ' traded · ' + data.noData +
        ' no trades recorded · Session ' + (data.session || '—') +
        ' · Source: ' + data.source + ' session tape · Block height = turnover (square-root scale)';
    }
    function paintList() {
      if (!listEl || !layout) return;
      var frag = document.createDocumentFragment();
      layout.blocks.forEach(function (b) {
        var r = b.row, li = document.createElement('li');
        var a = document.createElement('a');
        a.href = stockUrl(r.sym); a.textContent = r.sym;
        li.appendChild(a);
        li.appendChild(document.createTextNode(r.traded
          ? ' — Rs ' + num2(r.ltp) + ' · ' + pct(r.pct) + ' · ' + money(r.turn) + ' turnover · ' + r.sector
          : ' — no trades recorded this session' + (r.batchP != null ? ' · daily-batch close Rs ' + num2(r.batchP) : '') + ' · ' + r.sector));
        frag.appendChild(li);
      });
      listEl.innerHTML = ''; listEl.appendChild(frag);
    }
    function paintLabels() {
      if (!labelsEl || !layout) return;
      labelsEl.innerHTML = '';
      layout.plates.forEach(function (p) {
        var el = document.createElement('span');
        el.className = 'nd3d-sector-label'; el.textContent = p.name;
        labelsEl.appendChild(el);
      });
    }

    /* ---- interaction ---- */
    var dragging = false, dragMoved = 0, lastPX = 0, lastPY = 0, pointers = {}, pinchD = 0;
    canvas.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = [e.clientX, e.clientY];
      if (Object.keys(pointers).length === 2) {
        var ps = Object.values(pointers);
        pinchD = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]);
      }
      dragging = true; dragMoved = 0; lastPX = e.clientX; lastPY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      requestFrame();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = [e.clientX, e.clientY];
      if (dragging && Object.keys(pointers).length === 2) {
        var ps = Object.values(pointers);
        var nd = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]);
        if (pinchD > 0) cam.dist = clampDist(cam.dist * (pinchD / nd));
        pinchD = nd; dragMoved += 3; requestFrame(); return;
      }
      if (dragging) {
        var dx = e.clientX - lastPX, dy = e.clientY - lastPY;
        dragMoved += Math.abs(dx) + Math.abs(dy);
        cam.az -= dx * 0.005;
        cam.pol = Math.min(1.35, Math.max(0.18, cam.pol - dy * 0.005));
        lastPX = e.clientX; lastPY = e.clientY;
        requestFrame();
      } else if (e.pointerType === 'mouse') {
        var i = pick(e.clientX, e.clientY);
        if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : 'grab'; showTip(i, e.clientX, e.clientY); requestFrame(); }
        else if (i >= 0) showTip(i, e.clientX, e.clientY);
      }
    });
    function endPointer(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length === 0) {
        if (dragging && dragMoved < 6 && hover >= 0) select(hover);
        dragging = false;
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () { if (!dragging) { hover = -1; showTip(-1); requestFrame(); } });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.dist = clampDist(cam.dist * (1 + Math.sign(e.deltaY) * 0.09));
      requestFrame();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { resetView(); });
    function clampDist(d) { var r = layout ? layout.radius : 40; return Math.min(r * 2.8, Math.max(r * 0.55, d)); }
    function resetView() { if (home) { cam.az = home.az; cam.pol = home.pol; cam.dist = home.dist; } requestFrame(); }
    function select(i) {
      if (i < 0 || !layout) return;
      var sym = layout.blocks[i].row.sym;
      if (opts.onSelect) opts.onSelect(sym); else window.location.href = stockUrl(sym);
    }
    /* keyboard: arrows orbit, +/- zoom, [ ] step through blocks, Enter opens */
    canvas.addEventListener('keydown', function (e) {
      var used = true;
      if (e.key === 'ArrowLeft') cam.az += 0.12;
      else if (e.key === 'ArrowRight') cam.az -= 0.12;
      else if (e.key === 'ArrowUp') cam.pol = Math.max(0.18, cam.pol - 0.08);
      else if (e.key === 'ArrowDown') cam.pol = Math.min(1.35, cam.pol + 0.08);
      else if (e.key === '+' || e.key === '=') cam.dist = clampDist(cam.dist * 0.9);
      else if (e.key === '-' || e.key === '_') cam.dist = clampDist(cam.dist * 1.1);
      else if (e.key === '[' || e.key === ']') {
        focusMode = true;
        focused = ((focused + (e.key === ']' ? 1 : -1)) + layout.blocks.length) % layout.blocks.length;
        showTip(focused, null, null);
        if (tip) { tip.style.left = '14px'; tip.style.top = '14px'; }
      }
      else if (e.key === 'Enter') { if (focusMode && focused >= 0) select(focused); }
      else if (e.key === 'Home') resetView();
      else used = false;
      if (used) { e.preventDefault(); requestFrame(); }
    });
    /* control buttons (host page wires these by class, or we expose API) */
    var api = {
      rotate: function (dir) { cam.az += dir * 0.3; requestFrame(); },
      zoom: function (f) { cam.dist = clampDist(cam.dist * f); requestFrame(); },
      reset: resetView,
      destroy: function () { destroyed = true; stopLoop(); if (io) io.disconnect(); }
    };
    ['nd3d-rot-l', 'nd3d-rot-r', 'nd3d-zin', 'nd3d-zout', 'nd3d-reset'].forEach(function (cls) {
      var host = canvas.parentElement && canvas.parentElement.querySelector('.' + cls);
      if (host) host.addEventListener('click', function () {
        if (cls === 'nd3d-rot-l') api.rotate(1);
        else if (cls === 'nd3d-rot-r') api.rotate(-1);
        else if (cls === 'nd3d-zin') api.zoom(0.82);
        else if (cls === 'nd3d-zout') api.zoom(1.22);
        else api.reset();
      });
    });

    /* ---- visibility guards ---- */
    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting;
        if (inView) requestFrame();
      }, { threshold: 0.05 });
      io.observe(canvas);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) requestFrame(); });
    var themeObs = null;
    if ('MutationObserver' in window) {
      themeObs = new MutationObserver(function () { if (gl && layout) { buildGeometry(); requestFrame(); } });
      themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    /* ---- resize ---- */
    function sizeCanvas() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    if ('ResizeObserver' in window) new ResizeObserver(function () { sizeCanvas(); requestFrame(); }).observe(canvas);
    window.addEventListener('resize', function () { sizeCanvas(); requestFrame(); });

    /* ---- boot: data first (so the text list survives any GL failure) ---- */
    function boot() {
      sizeCanvas();
      var urls = [opts.liveUrl, opts.universeUrl, opts.verdictsUrl];
      Promise.all(urls.map(function (u) {
        return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
      })).then(function (res) {
        data = buildData(res[0], res[1], res[2]);
        layout = layoutTerrain(data);
        paintStatus(); paintList();
        if (!initGL()) { fallback('3D view unavailable — WebGL is not supported on this device/browser.'); return; }
        cam.dist = clampDist(layout.radius * 1.9);
        home = { az: cam.az, pol: cam.pol, dist: cam.dist };
        buildGeometry();
        paintLabels();
        sizeCanvas();
        if (!reduced && !staticMode) intro = { t0: performance.now(), dur: 1100, from: cam.az - 0.55, to: cam.az };
        requestFrame();
      }).catch(function () {
        fallback('3D view could not load the market data files.');
      });
    }
    boot();
    return api;
  }

  var api = { mount: mount, buildData: buildData, layoutTerrain: layoutTerrain, bandOf: bandOf,
    _mat4: { perspective: perspective, lookAt: lookAt, multiply: multiply, project: project } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NDLandscape3D = api;
})(typeof window !== 'undefined' ? window : this);
