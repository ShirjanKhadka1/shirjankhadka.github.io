/* Blog market pulse + headlines.
 * Renders the session-at-a-glance band from nepse-chart/data/wave1.json and
 * the latest market headlines from nepse-chart/data/news.json.
 * Everything is textContent-built; no innerHTML. Fails silent.
 */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtIN(n, d) {
    return Number(n).toLocaleString('en-IN',
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function nptDate(iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    var npt = new Date(t + (5 * 60 + 45) * 60000);
    return MONTHS[npt.getUTCMonth()] + ' ' + npt.getUTCDate();
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- Market pulse band ----------
  function renderPulse(market) {
    var band = document.getElementById('pulseBand');
    if (!band || !market || !market.index || market.index.value == null) return;
    var idx = market.index;
    var chg = +idx.change || 0;
    var pct = idx.pct == null ? null : +idx.pct;
    var dstr = nptDate(market.date + 'T15:00:00+05:45') || market.date;

    document.getElementById('pulseValue').textContent = fmtIN(idx.value, 2);
    var chEl = document.getElementById('pulseChange');
    var arrow = chg > 0 ? '\u25B2 ' : (chg < 0 ? '\u25BC ' : '');
    chEl.textContent = arrow + fmtIN(Math.abs(chg), 2) +
      (pct == null ? '' : ' (' + Math.abs(pct).toFixed(2) + '%)') + ' on the day';
    chEl.classList.add(chg < 0 ? 'down' : 'up');

    document.getElementById('pulseAdv').textContent = market.advancers != null ? market.advancers : '—';
    document.getElementById('pulseDec').textContent = market.decliners != null ? market.decliners : '—';
    var to = market.totalTurnover != null ? market.totalTurnover : market.turnover;
    document.getElementById('pulseTurn').textContent =
      to != null ? 'Rs ' + (to / 1e9).toFixed(2) + 'b' : '—';

    var note = market.close === true || market.close === undefined
      ? 'Market closed \u00B7 as of ' + dstr + ', 3:00 PM NPT'
      : 'Intraday snapshot \u00B7 ' + dstr;
    document.getElementById('pulseNote').textContent = note;
    band.hidden = false;
  }

  // ---------- Market news headlines ----------
  function renderNews(items) {
    var list = document.getElementById('blogNewsList');
    if (!list || !Array.isArray(items) || items.length === 0) return;
    var frag = document.createDocumentFragment();
    items.slice(0, 6).forEach(function (it) {
      if (!it || !it.title || !it.link) return;
      var a = el('a', 'mag-news-item');
      a.href = it.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.appendChild(el('h4', null, it.title));
      var meta = el('p', 'mag-news-meta');
      if (it.src) meta.appendChild(el('span', 'src', it.src + '  \u00B7  '));
      meta.appendChild(document.createTextNode(it.date || ''));
      a.appendChild(meta);
      frag.appendChild(a);
    });
    list.appendChild(frag);
    var sec = document.getElementById('blogNewsSection');
    if (sec && list.children.length > 0) sec.hidden = false;
  }

  fetch('/nepse-chart/data/wave1.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (d) { renderPulse(d.market); })
    .catch(function () {});

  fetch('/nepse-chart/data/news.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (d) { renderNews(d.items); })
    .catch(function () {});
})();
