/* NEPSE Alpha Lab: sector dashboard.
   Loads /nepse-chart/data/verdicts.json (via version.json cache-bust) and
   aggregates it into a size-weighted heatmap, per-sector breadth cards, and
   a sortable comparison table. Everything is computed client-side from the
   latest daily batch; no figures are invented. */
(function () {
  'use strict';
  var FALLBACK_V = '20260924g';
  var VER = 'v=20261002a';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(x, d) {
    if (x == null || isNaN(x)) return null;
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function signPct(x) {
    if (x == null || isNaN(x)) return '<span class="sx-dash">-</span>';
    var cls = x > 0 ? 'sx-pos' : (x < 0 ? 'sx-neg' : '');
    var s = (x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
    return cls ? '<span class="' + cls + '">' + esc(s) + '</span>' : esc(s);
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
      return r.json();
    });
  }

  function load() {
    return getJSON('/nepse-chart/data/version.json')
      .then(function (j) { return (j && j.v) ? j.v : FALLBACK_V; })
      .catch(function () { return FALLBACK_V; })
      .then(function (v) {
        return getJSON('/nepse-chart/data/verdicts.json?v=' + encodeURIComponent(v));
      });
  }

  function secName(e) {
    var s = e && e.sec;
    if (!s || s === 'Unknown') return 'Unclassified';
    return s;
  }

  function aggregate(vj) {
    var v = vj.verdicts || {};
    var sectors = {};
    var totalTurn = 0;
    Object.keys(v).forEach(function (sym) {
      var e = v[sym] || {};
      var sec = secName(e);
      if (!sectors[sec]) sectors[sec] = {
        name: sec, count: 0, chs: [], adv: 0, dec: 0, flat: 0,
        turn: 0, rsis: [], rows: []
      };
      var g = sectors[sec];
      g.count++;
      var ch = (e.ch == null) ? null : Number(e.ch);
      var p = (e.p == null) ? null : Number(e.p);
      var vol = (e.vol == null) ? null : Number(e.vol);
      if (ch != null && !isNaN(ch)) {
        g.chs.push(ch);
        if (ch > 0) g.adv++; else if (ch < 0) g.dec++; else g.flat++;
        g.rows.push({ sym: sym, p: p, ch: ch });
      }
      if (vol != null && p != null && !isNaN(vol) && !isNaN(p) && vol > 0) {
        var t = vol * p;
        g.turn += t;
        totalTurn += t;
      }
      if (e.rsi != null && !isNaN(Number(e.rsi))) g.rsis.push(Number(e.rsi));
    });
    var list = Object.keys(sectors).map(function (k) {
      var g = sectors[k];
      var n = g.chs.length;
      var avgCh = n ? g.chs.reduce(function (a, b) { return a + b; }, 0) / n : null;
      var pctUp = n ? (g.adv / n) * 100 : null;
      var avgRsi = g.rsis.length
        ? g.rsis.reduce(function (a, b) { return a + b; }, 0) / g.rsis.length : null;
      var gainers = g.rows.slice().sort(function (a, b) { return b.ch - a.ch; }).slice(0, 3);
      var losers = g.rows.slice().sort(function (a, b) { return a.ch - b.ch; }).slice(0, 3);
      return {
        name: g.name, count: g.count, adv: g.adv, dec: g.dec, flat: g.flat, nCh: n,
        avgCh: avgCh, pctUp: pctUp, avgRsi: avgRsi,
        turnShare: totalTurn > 0 ? (g.turn / totalTurn) * 100 : null,
        gainers: gainers, losers: losers
      };
    });
    // canonical order: named sectors by count desc, Unclassified last
    list.sort(function (a, b) {
      if (a.name === 'Unclassified') return 1;
      if (b.name === 'Unclassified') return -1;
      return b.count - a.count;
    });
    return { sectors: list, asof: vj.asof || '', total: Object.keys(v).length };
  }

  function heatClass(avgCh) {
    if (avgCh == null) return 'sx-none';
    if (avgCh >= 1.5) return 'sx-up2';
    if (avgCh >= 0.25) return 'sx-up1';
    if (avgCh > -0.25) return 'sx-n';
    if (avgCh > -1.5) return 'sx-dn1';
    return 'sx-dn2';
  }

  function tileLink(sec) {
    if (sec === 'Unclassified') return '/nepse-screener/';
    return '/nepse-screener/?sector=' + encodeURIComponent(sec);
  }

  function renderHeat(sectors) {
    var h = sectors.map(function (g) {
      var ch = g.avgCh == null ? '<span class="sx-tile-ch">-</span>'
        : '<span class="sx-tile-ch">' + signPct(g.avgCh) + '</span>';
      return '<a class="sx-tile ' + heatClass(g.avgCh) + '" role="listitem" ' +
        'style="flex-grow:' + g.count + '" href="' + esc(tileLink(g.name)) + '">' +
        '<span class="sx-tile-name">' + esc(g.name) + '</span>' +
        '<span class="sx-tile-count">' + g.count + (g.count === 1 ? ' security' : ' securities') + '</span>' +
        ch + '</a>';
    }).join('');
    $('sx-heat').innerHTML = h;
  }

  function leaderList(rows, sec, emptyMsg) {
    if (!rows.length) return '<p class="sx-empty-lead">' + esc(emptyMsg) + '</p>';
    var Mono = window.NepseMono || null;
    return '<ul>' + rows.map(function (r) {
      var price = r.p == null ? '-' : num(r.p, 2);
      return '<li><a class="sx-sym" href="/nepse-chart/?s=' + esc(r.sym) + '">' +
        (Mono ? Mono.avatar(r.sym, sec, 26) : '') + '<span>' + esc(r.sym) + '</span></a>' +
        '<span class="sx-p tnum">' + esc(price) + '</span>' +
        '<span class="sx-ch tnum">' + signPct(r.ch) + '</span></li>';
    }).join('') + '</ul>';
  }

  function renderCards(sectors) {
    var h = sectors.map(function (g) {
      var t = g.adv + g.dec + g.flat;
      var wUp = t ? (g.adv / t) * 100 : 0;
      var wDn = t ? (g.dec / t) * 100 : 0;
      var wFlat = t ? (g.flat / t) * 100 : 0;
      return '<article class="sx-card">' +
        '<div class="sx-card-head"><h3><a href="' + esc(tileLink(g.name)) + '">' + esc(g.name) + '</a></h3>' +
        '<span class="sx-avg">' + signPct(g.avgCh) + '</span></div>' +
        '<div class="sx-breadth" role="img" aria-label="' + esc(g.name) + ': ' + g.adv +
          ' advancers, ' + g.dec + ' decliners, ' + g.flat + ' unchanged">' +
          '<i class="sx-b-up" data-w="' + wUp.toFixed(1) + '" style="width:0"></i>' +
          '<i class="sx-b-dn" data-w="' + wDn.toFixed(1) + '" style="width:0"></i>' +
          '<i class="sx-b-flat" data-w="' + wFlat.toFixed(1) + '" style="width:0"></i></div>' +
        '<p class="sx-breadth-cap"><span data-count="' + g.adv + '">' + g.adv + '</span> up · ' +
          '<span data-count="' + g.dec + '">' + g.dec + '</span> down · ' +
          '<span data-count="' + g.flat + '">' + g.flat + '</span> flat' +
          (g.count - t ? ' · ' + (g.count - t) + ' no change data' : '') + '</p>' +
        '<details><summary>Leaders and laggards</summary>' +
          '<div class="sx-lead">' +
            '<div><h4>Top gainers</h4>' + leaderList(g.gainers, g.name, 'No change data in this sector.') + '</div>' +
            '<div><h4>Top losers</h4>' + leaderList(g.losers, g.name, 'No change data in this sector.') + '</div>' +
          '</div></details></article>';
    }).join('');
    $('sx-cards').innerHTML = h;
  }

  function renderTable(sectors, mode) {
    var rows = sectors.slice();
    if (mode === 'change') {
      rows.sort(function (a, b) { return (b.avgCh == null ? -999 : b.avgCh) - (a.avgCh == null ? -999 : a.avgCh); });
    } else if (mode === 'count') {
      rows.sort(function (a, b) { return b.count - a.count; });
    } else {
      rows.sort(function (a, b) { return (b.turnShare || 0) - (a.turnShare || 0); });
    }
    $('sx-body').innerHTML = rows.map(function (g) {
      return '<tr><td><a href="' + esc(tileLink(g.name)) + '">' + esc(g.name) + '</a></td>' +
        '<td class="num">' + g.count + '</td>' +
        '<td class="num">' + signPct(g.avgCh) + '</td>' +
        '<td class="num">' + (g.pctUp == null ? '<span class="sx-dash">-</span>' : esc(g.pctUp.toFixed(1) + '%')) + '</td>' +
        '<td class="num">' + (g.turnShare == null ? '<span class="sx-dash">-</span>' : esc(g.turnShare.toFixed(1) + '%')) + '</td>' +
        '<td class="num">' + (g.avgRsi == null ? '<span class="sx-dash">-</span>' : esc(g.avgRsi.toFixed(1))) + '</td></tr>';
    }).join('');
  }

  function showError() {
    $('sx-asof').textContent = 'Data unavailable. Please try again later.';
    $('sx-heat').innerHTML = '<p class="sx-empty">Heatmap data unavailable.</p>';
    $('sx-cards').innerHTML = '<p class="sx-empty">Sector cards unavailable.</p>';
    $('sx-body').innerHTML = '<tr><td colspan="6" class="sx-empty">Table data unavailable.</td></tr>';
  }

  // Wave 7: breadth bars animate from zero to their real widths; entrance
  // and count-ups run only when the shared motion layer is available.
  function animateSectors() {
    var bars = document.querySelectorAll('#sx-cards .sx-breadth i');
    function set() {
      for (var i = 0; i < bars.length; i++) {
        bars[i].style.width = bars[i].getAttribute('data-w') + '%';
      }
    }
    var M = window.NepseMotion || null;
    if (M && M.reduced) { set(); }
    else requestAnimationFrame(function () { requestAnimationFrame(set); });
    if (M) {
      var els = document.querySelectorAll('#sx-heat .sx-tile, #sx-cards .sx-card');
      for (var j = 0; j < els.length; j++) els[j].classList.add('rv');
      M.reveal(document);
      M.watchCounts(document);
    }
  }

  function init() {
    load().then(function (vj) {
      var agg = aggregate(vj);
      var sectors = agg.sectors;
      renderHeat(sectors);
      renderCards(sectors);
      var sel = $('sx-sort');
      function draw() { renderTable(sectors, sel.value); }
      sel.addEventListener('change', draw);
      draw();
      animateSectors();
      // Wave 7: live feed status next to the batch date (sector data itself
      // is the daily batch; the badge reports the quote feed honestly).
      var NL = window.NepseLive || null;
      if (NL && $('sx-live')) NL.start({ el: $('sx-live') });
      var sxAsof = $('sx-asof');
      sxAsof.textContent = agg.asof
        ? 'Aggregated from the batch as of ' + agg.asof + ' · ' + agg.total + ' securities'
        : agg.total + ' securities aggregated';
      if (window.NepseFresh && agg.asof && !sxAsof.querySelector('.fresh'))
        sxAsof.insertAdjacentHTML('beforeend', ' ' + window.NepseFresh.badge(agg.asof));
    }).catch(showError);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
