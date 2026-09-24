/* Nepali Date Converter — Convert / Difference / Age tabs.
   Requires window.BSCal (js/bs-calendar.js). Vanilla JS, no dependencies. */
(function () {
  'use strict';

  if (!window.BSCal) {
    document.querySelector('.tool .wrap').innerHTML =
      '<p style="text-align:center;padding:60px 0">Sorry — the calendar data failed to load. Please refresh the page.</p>';
    return;
  }
  var B = window.BSCal;
  var AD_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */
  function todayNPT() {
    var o = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day };
  }
  function adMonthLen(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function monthLen(mode, y, m) { return mode === 'BS' ? B.monthLen(y, m) : adMonthLen(y, m); }
  function weekdayOfDayNum(n) { return B.weekdays[new Date(Date.UTC(1943, 3, 14) + n * 86400000).getUTCDay()]; }
  function dayNumOf(mode, y, m, d) { return mode === 'BS' ? B.bsToDayNum(y, m, d) : B.adToDayNum(y, m, d); }
  function fmtBS(y, m, d) { return B.monthNames[m - 1] + ' ' + d + ', ' + y; }
  function fmtAD(y, m, d) { return AD_MONTHS[m - 1] + ' ' + d + ', ' + y; }
  function flash(el) {
    if (reduceMotion || !el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  // Exact calendar difference between two AD dates (a <= b)
  function ymdDiff(a, b) {
    var y = b.y - a.y, m = b.m - a.m, d = b.d - a.d;
    if (d < 0) { m--; var pm = b.m - 1 || 12, py = pm === 12 ? b.y - 1 : b.y; d += adMonthLen(py, pm); }
    if (m < 0) { y--; m += 12; }
    return { y: y, m: m, d: d };
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var thumb = document.getElementById('tabsThumb');
  function placeThumb(btn) {
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + (btn.offsetLeft - 6) + 'px)';
  }
  function activateTab(btn, focus) {
    tabs.forEach(function (t) {
      var on = t === btn;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      panel.classList.toggle('is-active', on);
    });
    placeThumb(btn);
    if (focus) btn.focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { activateTab(t, false); });
    t.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (j !== null) { e.preventDefault(); activateTab(tabs[j], true); }
    });
  });
  window.addEventListener('resize', function () {
    placeThumb(document.querySelector('.tab.is-active'));
  });
  window.addEventListener('load', function () {
    placeThumb(document.querySelector('.tab.is-active'));
  });
  placeThumb(tabs[0]);

  /* ---------- date picker factory ---------- */
  var uid = 0;
  function createPicker(containerId, onChange) {
    var root = document.getElementById(containerId);
    uid++;
    var yId = 'dpY' + uid, mId = 'dpM' + uid, dId = 'dpD' + uid;
    root.innerHTML =
      '<div class="select-wrap"><label for="' + yId + '">Year</label><select id="' + yId + '"></select></div>' +
      '<div class="select-wrap"><label for="' + mId + '">Month</label><select id="' + mId + '"></select></div>' +
      '<div class="select-wrap"><label for="' + dId + '">Day</label><select id="' + dId + '"></select></div>';
    var ySel = root.querySelector('#' + yId),
        mSel = root.querySelector('#' + mId),
        dSel = root.querySelector('#' + dId);
    var picker = { mode: 'BS', ySel: ySel, mSel: mSel, dSel: dSel, root: root };

    function fillYears() {
      var from = picker.mode === 'BS' ? B.start : 1943,
          to = picker.mode === 'BS' ? B.end : 2034;
      ySel.innerHTML = '';
      for (var y = to; y >= from; y--) {
        var o = document.createElement('option'); o.value = y; o.textContent = y; ySel.appendChild(o);
      }
    }
    function fillMonths() {
      var names = picker.mode === 'BS' ? B.monthNames : AD_MONTHS;
      mSel.innerHTML = '';
      names.forEach(function (n, i) {
        var o = document.createElement('option'); o.value = i + 1; o.textContent = n; mSel.appendChild(o);
      });
    }
    function fillDays(keep) {
      var y = +ySel.value || (picker.mode === 'BS' ? B.start : 1943),
          m = +mSel.value || 1,
          len = monthLen(picker.mode, y, m),
          cur = keep ? +dSel.value : 1;
      dSel.innerHTML = '';
      for (var d = 1; d <= len; d++) {
        var o = document.createElement('option'); o.value = d; o.textContent = d; dSel.appendChild(o);
      }
      dSel.value = Math.min(cur || 1, len);
    }
    picker.setMode = function (mode) {
      if (picker.mode === mode) return;
      picker.mode = mode;
      var cur = picker.get();
      fillYears(); fillMonths();
      ySel.value = mode === 'BS' ? Math.min(Math.max(cur.y, B.start), B.end) : 2026;
      mSel.value = cur.m; fillDays(true);
      onChange();
    };
    picker.get = function () { return { mode: picker.mode, y: +ySel.value, m: +mSel.value, d: +dSel.value }; };
    picker.set = function (y, m, d) {
      ySel.value = y; mSel.value = m; fillDays(false);
      dSel.value = Math.min(d, +dSel.options[dSel.options.length - 1].value);
    };
    ySel.addEventListener('change', function () { fillDays(true); onChange(); });
    mSel.addEventListener('change', function () { fillDays(true); onChange(); });
    dSel.addEventListener('change', onChange);
    fillYears(); fillMonths();
    return picker;
  }

  /* ---------- CONVERT ---------- */
  var cY = document.getElementById('cYear'), cM = document.getElementById('cMonth'), cD = document.getElementById('cDay');
  var convertMode = 'BS';
  function fillConvertYears() {
    var from = convertMode === 'BS' ? B.start : 1943, to = convertMode === 'BS' ? B.end : 2034;
    cY.innerHTML = '';
    for (var y = to; y >= from; y--) { var o = document.createElement('option'); o.value = y; o.textContent = y; cY.appendChild(o); }
  }
  function fillConvertMonths() {
    var names = convertMode === 'BS' ? B.monthNames : AD_MONTHS;
    cM.innerHTML = '';
    names.forEach(function (n, i) { var o = document.createElement('option'); o.value = i + 1; o.textContent = n; cM.appendChild(o); });
  }
  function fillConvertDays(keep) {
    var y = +cY.value || (convertMode === 'BS' ? B.start : 1943), m = +cM.value || 1;
    var len = monthLen(convertMode, y, m), cur = keep ? +cD.value : 1;
    cD.innerHTML = '';
    for (var d = 1; d <= len; d++) { var o = document.createElement('option'); o.value = d; o.textContent = d; cD.appendChild(o); }
    cD.value = Math.min(cur || 1, len);
  }
  var resBs = document.getElementById('resBs'), resAd = document.getElementById('resAd');
  function doConvert() {
    var y = +cY.value, m = +cM.value, d = +cD.value;
    var bs, ad;
    if (convertMode === 'BS') { bs = { y: y, m: m, d: d }; ad = B.bsToAd(y, m, d); }
    else { ad = { y: y, m: m, d: d }; bs = B.adToBs(y, m, d); }
    var n = dayNumOf(convertMode, y, m, d), wd = weekdayOfDayNum(n);
    var bsDate = document.getElementById('resBsDate'), bsDay = document.getElementById('resBsDay');
    var adDate = document.getElementById('resAdDate'), adDay = document.getElementById('resAdDay');
    bsDate.textContent = fmtBS(bs.y, bs.m, bs.d); bsDay.textContent = wd;
    adDate.textContent = fmtAD(ad.y, ad.m, ad.d); adDay.textContent = wd;
    resBs.classList.toggle('is-result', convertMode === 'AD');
    resAd.classList.toggle('is-result', convertMode === 'BS');
    [bsDate, bsDay, adDate, adDay].forEach(flash);
  }
  document.querySelectorAll('#panel-convert .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.mode === convertMode) return;
      document.querySelectorAll('#panel-convert .seg-btn').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // carry the converted date across the switch
      var y = +cY.value, m = +cM.value, d = +cD.value, t;
      if (convertMode === 'BS') t = B.bsToAd(y, m, d); else t = B.adToBs(y, m, d);
      convertMode = b.dataset.mode;
      fillConvertYears(); fillConvertMonths();
      cY.value = t.y; cM.value = t.m; fillConvertDays(false);
      cD.value = Math.min(t.d, +cD.options[cD.options.length - 1].value);
      doConvert();
    });
  });
  cY.addEventListener('change', function () { fillConvertDays(true); doConvert(); });
  cM.addEventListener('change', function () { fillConvertDays(true); doConvert(); });
  cD.addEventListener('change', doConvert);
  document.getElementById('btnToday').addEventListener('click', function () {
    var t = todayNPT();
    if (convertMode === 'BS') { var bs = B.adToBs(t.y, t.m, t.d); cY.value = bs.y; cM.value = bs.m; fillConvertDays(false); cD.value = bs.d; }
    else { cY.value = t.y; cM.value = t.m; fillConvertDays(false); cD.value = t.d; }
    doConvert();
  });
  document.getElementById('btnSwap').addEventListener('click', function () {
    var other = convertMode === 'BS' ? 'AD' : 'BS';
    document.querySelector('#panel-convert .seg-btn[data-mode="' + other + '"]').click();
  });
  // copy buttons
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = document.getElementById(btn.getAttribute('data-copy'));
      var text = card.querySelector('.result-date').textContent + ' (' + card.querySelector('.result-sub').textContent + ')';
      function done() {
        btn.textContent = 'Copied'; btn.classList.add('copied');
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); }
    });
  });
  fillConvertYears(); fillConvertMonths();
  (function initConvert() {
    var t = todayNPT(), bs = B.adToBs(t.y, t.m, t.d);
    cY.value = bs.y; cM.value = bs.m; fillConvertDays(false); cD.value = bs.d;
    doConvert();
  })();

  /* ---------- DIFFERENCE ---------- */
  var diffOut = document.getElementById('diffOut'), diffChips = document.getElementById('diffChips');
  function doDiff() {
    var a = dpA.get(), b = dpB.get();
    var adA = a.mode === 'BS' ? B.bsToAd(a.y, a.m, a.d) : { y: a.y, m: a.m, d: a.d };
    var adB = b.mode === 'BS' ? B.bsToAd(b.y, b.m, b.d) : { y: b.y, m: b.m, d: b.d };
    var n1 = B.adToDayNum(adA.y, adA.m, adA.d), n2 = B.adToDayNum(adB.y, adB.m, adB.d);
    if (n1 > n2) { var t = n1; n1 = n2; n2 = t; var ta = adA; adA = adB; adB = ta; }
    var total = n2 - n1, p = ymdDiff(adA, adB);
    diffOut.textContent = plural(p.y, 'year') + ', ' + plural(p.m, 'month') + ', ' + plural(p.d, 'day');
    diffChips.innerHTML =
      chip('<strong>' + total.toLocaleString('en-US') + '</strong> total days') +
      chip('<strong>' + Math.floor(total / 7).toLocaleString('en-US') + '</strong> weeks') +
      chip('<strong>' + (p.y * 12 + p.m).toLocaleString('en-US') + '</strong> total months');
    flash(diffOut);
  }
  function chip(html) { return '<span class="chip">' + html + '</span>'; }
  var dpA = createPicker('dpA', doDiff), dpB = createPicker('dpB', doDiff);
  (function initDiff() {
    var t = todayNPT(), bs = B.adToBs(t.y, t.m, t.d);
    dpA.set(2083, 1, 1); dpB.set(bs.y, bs.m, bs.d);
    doDiff();
  })();

  /* ---------- AGE ---------- */
  var ageOut = document.getElementById('ageOut'), ageChips = document.getElementById('ageChips');
  function doAge() {
    var v = dpDob.get();
    var ad = v.mode === 'BS' ? B.bsToAd(v.y, v.m, v.d) : { y: v.y, m: v.m, d: v.d };
    var t = todayNPT();
    var nDob = B.adToDayNum(ad.y, ad.m, ad.d), nToday = B.adToDayNum(t.y, t.m, t.d);
    if (nDob > nToday) {
      ageOut.textContent = 'Date of birth is in the future';
      ageChips.innerHTML = '';
      return;
    }
    var p = ymdDiff(ad, t), lived = nToday - nDob;
    // next birthday
    var ny = t.y, nd = Math.min(ad.d, adMonthLen(ny, ad.m));
    if (ny * 10000 + ad.m * 100 + nd <= t.y * 10000 + t.m * 100 + t.d) { ny++; nd = Math.min(ad.d, adMonthLen(ny, ad.m)); }
    var inDays = B.adToDayNum(ny, ad.m, nd) - nToday;
    ageOut.textContent = plural(p.y, 'year') + ', ' + plural(p.m, 'month') + ', ' + plural(p.d, 'day');
    ageChips.innerHTML =
      chip('Born on <strong>' + weekdayOfDayNum(nDob) + '</strong>') +
      chip('<strong>' + lived.toLocaleString('en-US') + '</strong> days lived') +
      chip('Next birthday in <strong>' + inDays.toLocaleString('en-US') + '</strong> days · ' + fmtAD(ny, ad.m, nd));
    flash(ageOut);
  }
  var dpDob = createPicker('dpDob', doAge);
  dpDob.set(2060, 1, 1);
  doAge();

  /* ---------- picker calendar toggles ---------- */
  var pickers = { dpA: dpA, dpB: dpB, dpDob: dpDob };
  document.querySelectorAll('.seg-btn[data-dp]').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-dp'), pk = pickers[id];
      if (b.dataset.mode === pk.mode) return;
      document.querySelectorAll('.seg-btn[data-dp="' + id + '"]').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // convert current value to the other calendar before switching lists
      var cur = pk.get(), t;
      if (pk.mode === 'BS') t = B.bsToAd(cur.y, cur.m, cur.d); else t = B.adToBs(cur.y, cur.m, cur.d);
      pk.setMode(b.dataset.mode);
      pk.set(t.y, t.m, t.d);
      if (id === 'dpA' || id === 'dpB') doDiff(); else doAge();
    });
  });
})();
