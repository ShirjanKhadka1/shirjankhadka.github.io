/**
 * js/nd-home.js — Concept 03 editorial homepage sections.
 * Renders index strip, market wrap, and newsroom from REAL data only.
 * No mock figures. Every number comes from live.json or news.json.
 */
(function () {
  'use strict';

  var LIVE_URL = '/nepse-chart/data/live.json';
  var NEWS_URL = '/nepse-chart/data/news.json';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(v, dp) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------- Index strip ---------- */
  function renderStrip(indices) {
    var track = $('ndStripTrack');
    if (!track || !indices || !indices.length) return;
    // Order: NEPSE first, then sub-indices by absolute change
    var sorted = indices.slice().sort(function (a, b) {
      if (a.name === 'NEPSE') return -1;
      if (b.name === 'NEPSE') return 1;
      return Math.abs(b.percent_change || 0) - Math.abs(a.percent_change || 0);
    });
    track.innerHTML = sorted.map(function (ix) {
      var chg = Number(ix.percent_change) || 0;
      var cls = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
      var arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '·';
      var href = ix.name === 'NEPSE' ? '/nepse-chart/' : '/nepse-sectors/';
      return '<a class="nd-icard" href="' + href + '">' +
        '<div class="nm">' + esc(ix.name) + '</div>' +
        '<div class="vl">' + fmtNum(ix.value) + '</div>' +
        '<div class="ch ' + cls + '">' + arrow + ' ' + (chg > 0 ? '+' : '') + chg.toFixed(2) + '%</div>' +
        '</a>';
    }).join('');
    var prev = $('ndStripPrev'), next = $('ndStripNext');
    if (prev) prev.onclick = function () { track.scrollBy({ left: -320, behavior: 'smooth' }); };
    if (next) next.onclick = function () { track.scrollBy({ left: 320, behavior: 'smooth' }); };
  }

  /* ---------- Market Wrap (generated from real session data) ---------- */
  function renderWrap(live) {
    var host = $('ndWrap');
    if (!host || !live || !live.index) return;
    var ix = live.index;
    var chg = Number(ix.change) || 0;
    var pct = Number(ix.percent_change) || 0;
    var dir = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
    var sessDate = '';
    try {
      var d = new Date((live.data_asof || live.asof));
      sessDate = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
    } catch (e) {}
    // Leading/lagging sectors from indices
    var sectors = (live.indices || []).filter(function (x) {
      return x.name !== 'NEPSE' && x.name !== 'Sensitive' && x.name !== 'Float' && x.name !== 'Sensitive Float';
    });
    sectors.sort(function (a, b) { return (b.percent_change || 0) - (a.percent_change || 0); });
    var leaders = sectors.slice(0, 2).map(function (x) { return x.name; }).join(' and ');
    var laggards = sectors.slice(-2).map(function (x) { return x.name; }).join(' and ');

    var headline = 'NEPSE closes ' + dir;
    if (Math.abs(pct) >= 0.5) headline += ' sharply';
    headline += ' at ' + fmtNum(ix.value);
    if (leaders) headline += ' as ' + esc(leaders.toLowerCase()) + ' lead';

    var body1 = 'The NEPSE index closed at ' + fmtNum(ix.value) + ' (' +
      (chg > 0 ? '+' : '') + fmtNum(chg) + ' points, ' +
      (pct > 0 ? '+' : '') + pct.toFixed(2) + '%). ';
    if (leaders) {
      body1 += chg >= 0
        ? 'Strength came from ' + esc(leaders) + ' shares. '
        : esc(leaders) + ' shares declined the least. ';
    }
    if (laggards && laggards !== leaders) body1 += 'Weakness was concentrated in ' + esc(laggards) + '. ';
    body1 += 'Day range: ' + fmtNum(ix.low) + ' – ' + fmtNum(ix.high) + '.';

    host.innerHTML =
      '<div class="nd-badges">' +
        '<span class="nd-badge lime">Market Wrap</span>' +
        '<span class="nd-badge">' + esc(sessDate) + '</span>' +
        '<span class="nd-badge amber">Closing figures · ' + esc(sessDate.toUpperCase()) + '</span>' +
      '</div>' +
      '<h2 class="nd-wraphead">' + esc(headline) + '</h2>' +
      '<div class="nd-wrapbody"><p>' + body1 + '</p>' +
      '<p>All figures below are the official session close. Quotes refresh during market hours; ' +
      'outside hours the last close is shown.</p></div>' +
      '<div class="nd-wrapmeta"><strong>Nepse Decode Desk</strong> · Data as of ' + esc(sessDate) + ' · Source: NEPSE</div>' +
      '<a class="nd-btn-lime" href="/nepse-chart/">See today\'s market →</a>';
  }

  /* ---------- NEPSE index card ---------- */
  function renderIndexCard(live) {
    var host = $('ndIxCard');
    if (!host || !live || !live.index) return;
    var ix = live.index;
    var chg = Number(ix.change) || 0;
    var pct = Number(ix.percent_change) || 0;
    var cls = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
    var arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '·';
    host.innerHTML =
      '<div class="lbl"><span>NEPSE INDEX</span><span class="nd-badge amber">' + esc(live.market || '—') + '</span></div>' +
      '<div class="big">' + fmtNum(ix.value) + '</div>' +
      '<div class="chg ' + cls + '">' + arrow + ' ' + (chg > 0 ? '+' : '') + fmtNum(chg) +
        ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%) today</div>' +
      '<div class="nd-ixgrid">' +
        '<div class="cell"><div class="k">OPEN</div><div class="v">—</div></div>' +
        '<div class="cell"><div class="k">HIGH</div><div class="v">' + fmtNum(ix.high) + '</div></div>' +
        '<div class="cell"><div class="k">LOW</div><div class="v">' + fmtNum(ix.low) + '</div></div>' +
        '<div class="cell"><div class="k">PREV CLOSE</div><div class="v">' + fmtNum(ix.previous_close) + '</div></div>' +
      '</div>' +
      '<div class="nd-ixfoot"><span class="nd-badge amber">Source: NEPSE</span>' +
      '<span class="note">Figures are the official session close. Live quotes resume at the next market open.</span></div>';
  }

  /* ---------- Newsroom ---------- */
  function renderNewsroom(items) {
    var host = $('ndNewsGrid');
    if (!host || !items || !items.length) return;
    // Categorize: markets / companies / economy (simple keyword buckets)
    var cats = { Markets: [], Companies: [], 'Economy & Policy': [] };
    items.forEach(function (n) {
      var t = ((n.title || '') + ' ' + (n.summary || '')).toLowerCase();
      if (/nrb|sebon|policy|economy|remittance|ipo|government|budget/.test(t)) cats['Economy & Policy'].push(n);
      else if (/hydropower|bank|insurance|finance|company|ltd|dividend|bonus/.test(t)) cats.Companies.push(n);
      else cats.Markets.push(n);
    });
    host.innerHTML = Object.keys(cats).map(function (cat) {
      var list = cats[cat].slice(0, 4);
      if (!list.length) return '';
      return '<div class="nd-newscard"><div class="cat"><span class="dot"></span>' + esc(cat) + '</div>' +
        list.map(function (n) {
          var href = n.url || n.link || '/nepse-news/';
          var time = n.published || n.date || '';
          var tag = (n.tags && n.tags[0]) || (n.symbol || '');
          return '<div class="nd-newsitem"><a href="' + esc(href) + '">' +
            '<div class="t">' + esc(n.title || 'Untitled') + '</div>' +
            '<div class="m"><span>' + esc(time) + '</span>' +
            (tag ? '<span class="tag">' + esc(String(tag).toUpperCase()) + '</span>' : '') +
            '</div></a></div>';
        }).join('') + '</div>';
    }).join('');
  }

  /* ---------- Init ---------- */
  function init() {
    if (!$('ndStripTrack') && !$('ndWrap') && !$('ndNewsGrid')) return;
    fetchJSON(LIVE_URL).then(function (live) {
      renderStrip(live.indices);
      renderWrap(live);
      renderIndexCard(live);
    }).catch(function () {});
    fetchJSON(NEWS_URL).then(function (news) {
      var items = Array.isArray(news) ? news : (news.items || news.news || []);
      renderNewsroom(items);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
