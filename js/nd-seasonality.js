/* Seasonality page (P19) — historical monthly/quarterly NEPSE returns from real index history */
(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
  }
  function parseDate(n) {
    var s = String(n);
    return { y: +s.slice(0, 4), m: +s.slice(4, 6), d: +s.slice(6, 8), key: s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) };
  }
  function pct(x) { return (x >= 0 ? '+' : '') + x.toFixed(2) + '%'; }

  function compute(dates, closes) {
    // month-end closes
    var monthEnd = {};
    for (var i = 0; i < dates.length; i++) {
      var ym = dates[i].slice(0, 7);
      monthEnd[ym] = { close: closes[i], date: dates[i] };
    }
    var yms = Object.keys(monthEnd).sort();
    // monthly returns: need previous month-end
    var monthly = []; // {ym, y, m, ret}
    for (var j = 1; j < yms.length; j++) {
      var prev = monthEnd[yms[j - 1]], cur = monthEnd[yms[j]];
      var dPrev = parseDate(yms[j - 1].replace(/-/g, '') + '01');
      var dCur = parseDate(yms[j].replace(/-/g, '') + '01');
      // consecutive months?
      var expM = dPrev.m === 12 ? 1 : dPrev.m + 1;
      var expY = dPrev.m === 12 ? dPrev.y + 1 : dPrev.y;
      if (dCur.y !== expY || dCur.m !== expM) continue; // gap in data
      monthly.push({ ym: yms[j], y: dCur.y, m: dCur.m, ret: (cur.close / prev.close - 1) * 100 });
    }
    // per-month stats
    var stats = [];
    for (var m = 1; m <= 12; m++) {
      var rs = monthly.filter(function (x) { return x.m === m; });
      if (!rs.length) { stats.push(null); continue; }
      var sum = 0, pos = 0, best = rs[0], worst = rs[0];
      rs.forEach(function (x) {
        sum += x.ret;
        if (x.ret > 0) pos++;
        if (x.ret > best.ret) best = x;
        if (x.ret < worst.ret) worst = x;
      });
      stats.push({
        m: m, n: rs.length, avg: sum / rs.length, hit: pos / rs.length * 100,
        best: best, worst: worst
      });
    }
    // quarters
    var quarters = [];
    var qnames = [['Q1', 'Jan–Mar'], ['Q2', 'Apr–Jun'], ['Q3', 'Jul–Sep'], ['Q4', 'Oct–Dec']];
    for (var q = 0; q < 4; q++) {
      var qrs = monthly.filter(function (x) { return Math.ceil(x.m / 3) === q + 1; });
      if (!qrs.length) { quarters.push(null); continue; }
      var s = 0, p = 0;
      qrs.forEach(function (x) { s += x.ret; if (x.ret > 0) p++; });
      quarters.push({ name: qnames[q][0], range: qnames[q][1], avg: s / qrs.length, hit: p / qrs.length * 100, n: qrs.length });
    }
    return { stats: stats, quarters: quarters, years: yms.length ? [yms[0].slice(0, 4), yms[yms.length - 1].slice(0, 4)] : [] };
  }

  function render(res, coverage) {
    var stats = res.stats.filter(Boolean);
    if (!stats.length) return;
    var best = stats.slice().sort(function (a, b) { return b.avg - a.avg; })[0];
    var worst = stats.slice().sort(function (a, b) { return a.avg - b.avg; })[0];

    var cov = $('snCoverage');
    if (cov) cov.textContent = 'NEPSE index month-end closes · ' + coverage + ' · Source: NEPSE index history';

    // Verdict cards
    var bn = $('snBestName'), bd = $('snBestDetail');
    if (bn) bn.textContent = MONTHS[best.m - 1];
    if (bd) bd.innerHTML = 'Averages <strong>' + pct(best.avg) + '</strong> across ' + best.n + ' years · positive ' +
      best.hit.toFixed(0) + '% of the time · best ' + MONTHS[best.m - 1] + ' was ' + best.best.y + ' (' + pct(best.best.ret) + ').';
    var wn = $('snWorstName'), wd = $('snWorstDetail');
    if (wn) wn.textContent = MONTHS[worst.m - 1];
    if (wd) wd.innerHTML = 'Averages <strong>' + pct(worst.avg) + '</strong> across ' + worst.n + ' years · positive only ' +
      worst.hit.toFixed(0) + '% of the time · worst ' + MONTHS[worst.m - 1] + ' was ' + worst.worst.y + ' (' + pct(worst.worst.ret) + ').';

    // Bars
    var bars = $('snBars');
    if (bars) {
      var maxA = Math.max.apply(null, stats.map(function (s) { return Math.abs(s.avg); })) || 1;
      bars.innerHTML = res.stats.map(function (s, idx) {
        if (!s) return '';
        var cls = s.m === best.m ? 'best' : s.m === worst.m ? 'worst' : '';
        var w = Math.abs(s.avg) / maxA * 50; // half track
        var side = s.avg >= 0 ? 'pos' : 'neg';
        var style = s.avg >= 0
          ? 'left:50%;width:' + w + '%'
          : 'right:50%;width:' + w + '%';
        return '<div class="sn-bar-row"><span class="mn ' + cls + '">' + MONTHS[idx].slice(0, 3) + '</span>' +
          '<div class="sn-track"><div class="sn-fill ' + side + '" data-w="' + w + '" style="' + style.replace('width:' + w + '%', 'width:0') + '" data-target="' + w + '"></div></div>' +
          '<span class="sn-val">' + pct(s.avg) + '</span></div>';
      }).join('');
      setTimeout(function () {
        bars.querySelectorAll('.sn-fill').forEach(function (el) {
          var t = el.getAttribute('data-target');
          var st = el.getAttribute('style');
          el.setAttribute('style', st.replace('width:0', 'width:' + t + '%'));
        });
      }, 80);
    }

    // Table
    var body = $('snBody');
    if (body) {
      body.innerHTML = res.stats.map(function (s, idx) {
        if (!s) return '';
        var rowCls = s.m === best.m ? 'bestm' : s.m === worst.m ? 'worstm' : '';
        var ac = s.avg >= 0 ? 'pos' : 'neg';
        return '<tr class="' + rowCls + '"><td class="l"><strong>' + MONTHS[idx] + '</strong></td>' +
          '<td class="r ' + ac + '">' + pct(s.avg) + '</td>' +
          '<td class="r">' + s.hit.toFixed(0) + '%</td>' +
          '<td class="r">' + s.best.y + ' (' + pct(s.best.ret) + ')</td>' +
          '<td class="r">' + s.worst.y + ' (' + pct(s.worst.ret) + ')</td>' +
          '<td class="r">' + s.n + '</td></tr>';
      }).join('');
    }

    // Quarters
    var qhost = $('snQuarters');
    if (qhost) {
      qhost.innerHTML = res.quarters.map(function (q) {
        if (!q) return '';
        var c = q.avg >= 0 ? 'pos' : 'neg';
        return '<div class="sn-q"><div class="qk">' + esc(q.name) + ' · ' + esc(q.range) + '</div>' +
          '<div class="qv ' + c + '">' + pct(q.avg) + '</div>' +
          '<div class="qs">Avg monthly return · positive ' + q.hit.toFixed(0) + '% of ' + q.n + ' months</div></div>';
      }).join('');
    }
  }

  function init() {
    if (!$('snBody')) return;
    Promise.all([
      fetchJSON('/data/index-history.json').catch(function () { return null; }),
      fetchJSON('/nepse-chart/data/index-spark.json').catch(function () { return null; })
    ]).then(function (res) {
      var hist = res[0], spark = res[1];
      var dates = [], closes = [], cov = [];
      if (hist && hist.rows) {
        hist.rows.forEach(function (r) {
          var s = String(r[0]);
          dates.push(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
          closes.push(r[4]);
        });
        cov.push('2003–' + String(hist.to).slice(0, 4));
      }
      if (spark && spark.closes) {
        spark.closes.forEach(function (c) {
          var s = String(c[0]);
          var d = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
          if (dates.indexOf(d) === -1) { dates.push(d); closes.push(c[1]); }
        });
        cov.push('2026 (' + spark.closes.length + ' sessions)');
      }
      if (!closes.length) throw new Error('no-data');
      render(compute(dates, closes), cov.join(' + '));
    }).catch(function () {
      var body = $('snBody');
      if (body) body.innerHTML = '<tr><td colspan="6" class="sn-loading">Seasonality data unavailable.</td></tr>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
