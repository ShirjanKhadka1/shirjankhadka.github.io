/* NEPSE Alpha Lab  -  shared presentation layer (Wave 7).
 *
 * NepseMotion: count-up figures, inline SVG sparklines (real data only),
 *              subtle reveal-on-scroll. All respect prefers-reduced-motion.
 * NepseMono:   symbol monogram avatars  -  small letter tiles with muted
 *              sector-tinted backgrounds. Pure CSS, no images, no fake logos.
 * NepseSnapshot: the one shared market-snapshot component. Renders the
 *              daily batch (wave1.json) with a live overlay when the market
 *              is open, a plain-words "official close" sentence after hours,
 *              and honest as-of labels. Used by the dashboard and reports
 *              pages so the same figures are never rendered twice by hand.
 *
 * Exposes window.NepseMotion, window.NepseMono, window.NepseSnapshot.
 * Depends on window.NepseLive (js/nepse-live.js) for time/status helpers.
 */
(function () {
  'use strict';

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt2(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtInt(n) { return Number(n).toLocaleString('en-US'); }
  function fmtMoney(n) {
    n = Number(n);
    if (!isFinite(n)) return '–';
    if (n >= 1e9) return 'Rs ' + (n / 1e9).toFixed(2) + 'b';
    if (n >= 1e6) return 'Rs ' + (n / 1e6).toFixed(2) + 'm';
    return 'Rs ' + fmtInt(Math.round(n));
  }
  function fmtDateLong(ymd) {
    var s = String(ymd || '');
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return parseInt(m[3], 10) + ' ' + months[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  /* ================= NepseMotion ================= */

  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (!isFinite(target)) return;
    var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var pre = el.getAttribute('data-prefix') || '';
    var suf = el.getAttribute('data-suffix') || '';
    function fmt(v) {
      return pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    }
    el.textContent = fmt(target);
    if (reduced) return;
    var dur = 900, t0 = null;
    function frame(t) {
      if (t0 == null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function watchCounts(root) {
    var els = (root || document).querySelectorAll('[data-count]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) countUp(els[i]);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { countUp(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  // Inline SVG sparkline from a real number series. Returns '' when there is
  // nothing honest to draw (fewer than 2 points).
  function sparkline(values, o) {
    o = o || {};
    var vals = (values || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (vals.length < 2) return '';
    var w = o.w || 132, h = o.h || 40, pad = 3;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) max = min + 1;
    var pts = vals.map(function (v, i) {
      var x = pad + (w - pad * 2) * i / (vals.length - 1);
      var y = pad + (h - pad * 2) * (1 - (v - min) / (max - min));
      return [x.toFixed(1), y.toFixed(1)];
    });
    var up = vals[vals.length - 1] >= vals[0];
    var stroke = o.stroke || (up ? '#1E7A44' : '#B23A2E');
    var line = pts.map(function (p) { return p.join(','); }).join(' ');
    var area = 'M' + pts[0][0] + ',' + (h - pad) +
      ' L' + pts.map(function (p) { return p.join(','); }).join(' L') +
      ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' Z';
    var last = pts[pts.length - 1];
    return '<svg class="nlspark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
      '<path d="' + area + '" fill="' + stroke + '" opacity="0.10"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6" fill="' + stroke + '"/></svg>';
  }

  function reveal(root) {
    var els = (root || document).querySelectorAll('.rv');
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || reduced) {
      for (var i = 0; i < els.length; i++) els[i].classList.add('in');
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  window.NepseMotion = {
    reduced: reduced,
    countUp: countUp,
    watchCounts: watchCounts,
    sparkline: sparkline,
    reveal: reveal
  };

  /* ================= NepseMono ================= */

  // Muted, ledger-compatible tints: [background, ink]. Sector-tinted, never a logo.
  var TINTS = [
    ['#E3EAE1', '#1E5A3C'], // sage
    ['#F0E7D0', '#7A5B23'], // sand
    ['#E9DED4', '#7C3F2C'], // clay
    ['#DDE3E6', '#2F4A5A'], // slate
    ['#E6E2D2', '#5C5A2E'], // moss
    ['#E7E0EC', '#4A3560'], // plum grey
    ['#DAE7E2', '#14524A'], // teal
    ['#EFE5D8', '#6B4A2F']  // bark
  ];

  function hashStr(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(sym) {
    var s = String(sym || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return s.slice(0, 2) || '?';
  }

  // avatar('ADBL', 'Development Bank') -> <span class="mono" ...>AD</span>
  // Optional third arg: tile size in px (keeps dense lists compact).
  function avatar(sym, sector, px) {
    var t = TINTS[hashStr(sector || sym || '?') % TINTS.length];
    var st = 'background:' + t[0] + ';color:' + t[1];
    if (px) {
      st += ';width:' + px + 'px;height:' + px + 'px' +
        ';font-size:' + Math.max(9, Math.round(px * 0.36)) + 'px' +
        ';border-radius:' + Math.round(px * 0.3) + 'px';
    }
    return '<span class="mono" aria-hidden="true" style="' + st + '">' +
      esc(initials(sym)) + '</span>';
  }

  window.NepseMono = { avatar: avatar, initials: initials };

  /* ================= NepseSnapshot ================= */

  var NL = null;
  function live() {
    if (!NL) NL = window.NepseLive || null;
    return NL;
  }

  // The shared snapshot block. snap: NepseLive.loadSnapshot() result.
  // opts: { spark: true } draws the index sparkline mount (needs index-spark.json).
  //
  // liveTapeAgg: market aggregates recomputed from the 15-minute quote tape.
  // Returns null unless the tape is from today's NPT session, so callers
  // never mix sessions. Used to keep every figure (not just the index)
  // current during trading hours and after the close.
  function liveTapeAgg(tape) {
    var L = live();
    if (!L || !tape || !tape.quotes || !tape.asof) return null;
    var keys = Object.keys(tape.quotes);
    if (!keys.length) return null;
    var dayStr = null, todayStr = null;
    try {
      dayStr = new Date(tape.asof + 5.75 * 3600 * 1000).toISOString().slice(0, 10);
      todayStr = L.nowNPT().toISOString().slice(0, 10);
    } catch (e) { return null; }
    if (dayStr !== todayStr) return null;
    var adv = 0, dec = 0, unc = 0, turn = 0, arr = [];
    for (var i = 0; i < keys.length; i++) {
      var q = tape.quotes[keys[i]] || {};
      var c = q.pct;
      if (!(c >= 0) && !(c < 0)) { unc++; continue; }
      if (c > 0) adv++; else if (c < 0) dec++; else unc++;
      var tv = +q.turnover;
      if (q.turnover != null && isFinite(tv)) turn += tv;
      arr.push({ s: keys[i], p: q.ltp, ch: c, t: q.turnover });
    }
    var byCh = arr.slice().sort(function (a, b) { return b.ch - a.ch; });
    var byTv = arr.filter(function (r) { return r.t != null && isFinite(+r.t); })
      .sort(function (a, b) { return b.t - a.t; });
    return {
      asof: tape.asof, day: todayStr,
      traded: adv + dec + unc, adv: adv, dec: dec, unc: unc, turnover: turn,
      gainers: byCh.slice(0, 5), losers: byCh.slice(-5).reverse(), leaders: byTv.slice(0, 5)
    };
  }
  function statsHTML(snap, opts) {
    opts = opts || {};
    var m = (snap && snap.batch) || {};
    var ix = m.index || {};
    var L = live();
    var open = L ? L.isMarketHours() : false;
    var li = snap && snap.live && snap.live.index;

    var val = (open && li && li.value != null) ? li.value : ix.value;
    var chg = (open && li && li.change != null) ? li.change : ix.change;
    var pct = (open && li && li.pct != null) ? li.pct : ix.pct;
    var liveTag = open && li && li.value != null;

    var chgTxt = '–', chgCls = '';
    if (chg != null && pct != null) {
      chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      var arrow = chg > 0 ? '+' : '';
      chgTxt = arrow + fmt2(chg) + ' (' + arrow + Number(pct).toFixed(2) + '%)';
    }

    var adv = m.advancers, dec = m.decliners;
    var bNote = (m.date ? 'Session of ' + m.date + '. ' : '') + 'Daily tape, official batch.';
    var bBar = '';
    if (adv != null && dec != null && (adv + dec) > 0) {
      var ap = Math.round(adv / (adv + dec) * 1000) / 10;
      bBar = '<span class="nlsnap-bar" role="img" aria-label="' + adv + ' advancers, ' + dec + ' decliners">' +
        '<span class="nlsnap-bar-a" data-nlsnap-bar style="width:' + ap + '%"></span></span>';
    }

    var closeSent = (!open) ? closeSentence(m) : '';

    return '<div class="nlsnap">' +
      '<div class="nlsnap-stats">' +
        '<div class="nlsnap-stat">' +
          '<span class="nlsnap-k">NEPSE index</span>' +
          '<span class="nlsnap-v tnum" data-count="' + (val != null ? val : '') + '" data-decimals="2" data-nlsnap-ixv>' +
            (val != null ? fmt2(val) : '–') + '</span>' +
          '<span class="nlsnap-s tnum ' + chgCls + '" data-nlsnap-ixc>' + esc(chgTxt) + '</span>' +
          (opts.spark ? '<span class="nlsnap-spark" data-nlsnap-spark></span>' : '') +
        '</div>' +
        '<div class="nlsnap-stat">' +
          '<span class="nlsnap-k">Traded securities</span>' +
          '<span class="nlsnap-v tnum" data-nlsnap-traded data-count="' + (m.traded != null ? m.traded : '') + '">' +
            (m.traded != null ? fmtInt(m.traded) : '–') + '</span>' +
          '<span class="nlsnap-s">securities with at least one trade</span>' +
        '</div>' +
        '<div class="nlsnap-stat">' +
          '<span class="nlsnap-k">Advancers / decliners</span>' +
          '<span class="nlsnap-v tnum"><span class="up" data-nlsnap-adv data-count="' + (adv != null ? adv : '') + '">' +
            (adv != null ? fmtInt(adv) : '–') + '</span><span class="nlsnap-sep"> / </span>' +
            '<span class="down" data-nlsnap-dec data-count="' + (dec != null ? dec : '') + '">' +
            (dec != null ? fmtInt(dec) : '–') + '</span></span>' +
          bBar +
          '<span class="nlsnap-s" data-nlsnap-bnote>' + esc(bNote) + '</span>' +
        '</div>' +
        '<div class="nlsnap-stat">' +
          '<span class="nlsnap-k">Turnover</span>' +
          '<span class="nlsnap-v tnum" data-nlsnap-turn data-count="' + (m.totalTurnover != null ? (m.totalTurnover / 1e9).toFixed(3) : '') +
            '" data-decimals="2" data-prefix="Rs " data-suffix="b">' +
            (m.totalTurnover != null ? fmtMoney(m.totalTurnover) : '–') + '</span>' +
          '<span class="nlsnap-s">total value traded</span>' +
        '</div>' +
      '</div>' +
      '<div class="nlsnap-foot">' +
        '<span class="nlsnap-live" data-nlsnap-live></span>' +
        (liveTag ? '<span class="nlsnap-tag">index shown live</span>' : '') +
      '</div>' +
      (closeSent ? '<p class="nlsnap-close">' + esc(closeSent) + '</p>' : '<p class="nlsnap-close" data-nlsnap-close hidden></p>') +
    '</div>';
  }

  // Plain-words session summary, from real batch figures only. Shown after hours.
  function closeSentence(m) {
    if (!m || !m.index || m.index.value == null) return '';
    var ix = m.index;
    var chgTxt;
    if (ix.change == null || ix.change === 0) chgTxt = 'unchanged on the day';
    else {
      var dir = ix.change > 0 ? 'up ' : 'down ';
      chgTxt = dir + fmt2(Math.abs(ix.change)) + ' points (' +
        Math.abs(Number(ix.pct) || 0).toFixed(2) + ' percent)';
    }
    var s = 'NEPSE closed at ' + fmt2(ix.value) + ', ' + chgTxt +
      (m.date ? ', in the session of ' + fmtDateLong(m.date) : '') + '. ';
    if (m.advancers != null && m.decliners != null) {
      s += fmtInt(m.advancers) + ' securities advanced and ' + fmtInt(m.decliners) + ' declined';
      if (m.unchanged != null) s += ', with ' + fmtInt(m.unchanged) + ' unchanged';
      s += '. ';
    }
    if (m.totalTurnover != null) s += 'Turnover was ' + fmtMoney(m.totalTurnover) + '.';
    return s;
  }

  // Update an already-rendered statsHTML block in place from a fresh snapshot.
  function updateLive(root, snap) {
    if (!root || !snap) return;
    var L = live();
    if (!L) return;
    var open = L.isMarketHours();
    var li = snap.live && snap.live.index;

    var vEl = root.querySelector('[data-nlsnap-ixv]');
    var cEl = root.querySelector('[data-nlsnap-ixc]');
    if (vEl && open && li && li.value != null) {
      vEl.removeAttribute('data-count');
      vEl.textContent = fmt2(li.value);
      if (cEl && li.change != null && li.pct != null) {
        cEl.removeAttribute('data-count');
        var arrow = li.change > 0 ? '+' : '';
        cEl.textContent = arrow + fmt2(li.change) + ' (' + arrow + Number(li.pct).toFixed(2) + '%)';
        cEl.className = 'nlsnap-s tnum ' + (li.change > 0 ? 'up' : li.change < 0 ? 'down' : '');
      }
    }
    var liveEl = root.querySelector('[data-nlsnap-live]');
    if (liveEl) liveEl.innerHTML = L.badgeHTML(L.statusOf(snap.live));

    // The tape aggregates come first: after hours a stale batch must not
    // leak yesterday's figures into the close sentence or the stat cards.
    var agg = liveTapeAgg(snap.live);

    var closeEl = root.querySelector('[data-nlsnap-close]');
    if (closeEl) {
      var s = open ? '' : (agg ? tapeCloseSentence(snap.live, agg) : closeSentence(snap.batch));
      if (s) { closeEl.textContent = s; closeEl.hidden = false; }
      else { closeEl.hidden = true; }
    }

    // Every other figure follows the 15-minute tape whenever it is today's:
    // index, traded count, advancers/decliners, the breadth bar + note,
    // turnover. Repaints only when a fresh tape lands; the batch stays as
    // fallback.
    if (agg && root._nlsnapTape !== agg.asof) {
      root._nlsnapTape = agg.asof;
      var li2 = snap.live && snap.live.index;
      var vEl2 = root.querySelector('[data-nlsnap-ixv]');
      if (vEl2 && li2 && li2.value != null) {
        vEl2.removeAttribute('data-count');
        vEl2.textContent = fmt2(li2.value);
        var cEl2 = root.querySelector('[data-nlsnap-ixc]');
        if (cEl2 && li2.change != null && li2.pct != null) {
          cEl2.removeAttribute('data-count');
          var arrow2 = li2.change > 0 ? '+' : '';
          cEl2.textContent = arrow2 + fmt2(li2.change) + ' (' + arrow2 + Number(li2.pct).toFixed(2) + '%)';
          cEl2.className = 'nlsnap-s tnum ' + (li2.change > 0 ? 'up' : li2.change < 0 ? 'down' : '');
        }
      }
      setTapeNum(root, '[data-nlsnap-traded]', agg.traded, fmtInt);
      setTapeNum(root, '[data-nlsnap-adv]', agg.adv, fmtInt);
      setTapeNum(root, '[data-nlsnap-dec]', agg.dec, fmtInt);
      var barEl = root.querySelector('[data-nlsnap-bar]');
      if (barEl && (agg.adv + agg.dec) > 0) {
        barEl.style.width = (Math.round(agg.adv / (agg.adv + agg.dec) * 1000) / 10) + '%';
      }
      var noteEl = root.querySelector('[data-nlsnap-bnote]');
      if (noteEl) noteEl.textContent = 'Live session of ' + agg.day + '. 15-minute tape.';
      setTapeNum(root, '[data-nlsnap-turn]', agg.turnover, fmtMoney);
    }
  }
  function setTapeNum(root, sel, val, fmt) {
    var el = root.querySelector(sel);
    if (el && val != null) { el.removeAttribute('data-count'); el.textContent = fmt(val); }
  }
  // Plain-words close summary built from the tape (today's session) rather
  // than the batch, so a stale batch can never show yesterday's close.
  function tapeCloseSentence(live, agg) {
    var li = live && live.index;
    if (!li || li.value == null) return '';
    var chgTxt;
    if (li.change == null || li.change === 0) chgTxt = 'unchanged on the day';
    else {
      var dir = li.change > 0 ? 'up ' : 'down ';
      chgTxt = dir + fmt2(Math.abs(li.change)) + ' points (' +
        Math.abs(Number(li.pct) || 0).toFixed(2) + ' percent)';
    }
    var s = 'NEPSE closed at ' + fmt2(li.value) + ', ' + chgTxt +
      ', in the session of ' + fmtDateLong(agg.day) + '. ';
    s += fmtInt(agg.adv) + ' securities advanced and ' + fmtInt(agg.dec) +
      ' declined, with ' + fmtInt(agg.unc) + ' unchanged. ';
    s += 'Turnover was ' + fmtMoney(agg.turnover) + '.';
    return s;
  }

  // Convenience: load the snapshot, render statsHTML into root, wire the
  // live badge + in-place updates. opts: { spark, poll, onReady }.
  function mount(root, opts) {
    opts = opts || {};
    var L = live();
    if (!root || !L) return Promise.resolve(null);
    return L.loadSnapshot().then(function (snap) {
      root.innerHTML = statsHTML(snap, { spark: !!opts.spark });
      if (opts.spark) fillSpark(root);
      var Motion = window.NepseMotion;
      if (Motion) { Motion.watchCounts(root); Motion.reveal(root); }
      var liveEl = root.querySelector('[data-nlsnap-live]');
      if (opts.poll !== false) {
        L.start({
          el: liveEl,
          onData: function (d) {
            updateLive(root, { batch: snap.batch, live: d });
          }
        });
      } else if (liveEl) {
        liveEl.innerHTML = L.badgeHTML(L.statusOf(snap.live));
      }
      if (typeof opts.onReady === 'function') { try { opts.onReady(snap); } catch (e) {} }
      return snap;
    });
  }

  var sparkCache = null;
  function fillSpark(root) {
    var els = root.querySelectorAll('[data-nlsnap-spark]');
    if (!els.length) return;
    function paint(j) {
      var vals = (j.closes || []).map(function (c) { return c[1]; });
      var svg = sparkline(vals);
      if (!svg) return;
      var cap = (j.from && j.to) ? '<span class="nlspark-cap">Index trend, 90 sessions to ' + esc(fmtDateLong(j.to)) + '.</span>' : '';
      for (var i = 0; i < els.length; i++) els[i].innerHTML = svg + cap;
    }
    if (sparkCache) { paint(sparkCache); return; }
    fetch('/nepse-chart/data/index-spark.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) { sparkCache = j; paint(j); }).catch(function () {});
  }

  window.NepseSnapshot = {
    statsHTML: statsHTML,
    closeSentence: closeSentence,
    updateLive: updateLive,
    liveTapeAgg: liveTapeAgg,
    mount: mount,
    fillSpark: fillSpark,
    fmtMoney: fmtMoney,
    fmtInt: fmtInt,
    fmt2: fmt2
  };
})();
