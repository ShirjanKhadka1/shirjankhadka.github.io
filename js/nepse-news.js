/* js/nepse-news.js — NEPSE News page logic (migrated from the inline
   script, behavior preserved). Two feeds read from the published files
   owned by the news pipeline (never written here): announcements.json +
   news.json. Additions over the inline original, all read-path only:
   a visible freshness line with per-feed failure states, new-item
   counting, a session strip (click a date to filter both feeds), an
   announcement-kinds ranked strip, a sector-stocks block, and mix
   aria labelling. No prediction language anywhere: news states
   observed, sourced facts only. */
(function(){
  'use strict';
  var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); };
  // Decode HTML entities in source titles (e.g. &quot; from RSS feeds) before escaping,
  // otherwise they display literally as "&quot;" instead of quotes.
  var dec = function(s){ return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, function(m, n){ return String.fromCodePoint(parseInt(n, 10)); })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, function(m, n){ return String.fromCodePoint(parseInt(n, 16)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); };
  var escT = function(s){ return esc(dec(s)); };
  var MON3 = {'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'};
  var fmtDate = function(iso){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if(!m) return iso || ''; return (+m[3]) + ' ' + (MON3[m[2]] || m[2]) + ' ' + m[1]; };
  var MONO_COLORS = ['#1d4d3b','#8a6d2f','#334155','#7c2d3e','#2f5d62','#5b4a8a'];
  var monoColor = function(sym){ var h = 0, s = String(sym || '?'); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return MONO_COLORS[h % MONO_COLORS.length]; };
  var monoText = function(sym){ var s = String(sym || '?').replace(/[^A-Za-z0-9]/g, ''); return (s.slice(0, 2) || '?').toUpperCase(); };
  var symLink = function(sym){ if(!sym) return ''; return '<span class="nn-sym">' + esc(sym) + '</span>'; };

  function newsCategory(title, sym){
    var t = ((title || '') + ' ' + (sym || '')).toLowerCase();
    if (/nepse|stock market|share market|market (falls|rises|index)|index (falls|rises|gains)|turnover (tops|crosses)|bullish|bearish/.test(t)) return 'Markets';
    if (/nrb|nepal rastra|sebon|policy|policies|government|budget|interest rate|remittance|regulation|ministry|parliament|election|gdp|inflation|forex/.test(t)) return 'Economy & Policy';
    if (sym || /dividend|bonus|right|agm|sgm|book clos|lock[\s-]?in|promoter|merger|acquisition|ipo|fpo|auction|debenture|company|ltd|limited|bank|insurance|hydro|finance|bittiya|laghubitta/.test(t)) return 'Companies';
    return 'Markets';
  }
  var CAT_CLASS = { 'Markets': 'markets', 'Companies': 'companies', 'Economy & Policy': 'economy' };

  var KIND_RULES = [
    [/dividend/i, 'Dividend', true], [/bonus/i, 'Bonus', true],
    [/right[\s-]?share/i, 'Right', true], [/book[\s-]?clos/i, 'Book close', false],
    [/\bagm\b|\bsgm\b/i, 'Meeting', false], [/director/i, 'Board', false],
    [/auditor/i, 'Auditor', false], [/merger|acquisition/i, 'Merger', false],
    [/lock[\s-]?in/i, 'Lock-in', false], [/auction/i, 'Auction', false],
    [/sale of shares|intention of sale/i, 'Promoter', false]
  ];
  function annKind(title){
    title = title || '';
    for (var i = 0; i < KIND_RULES.length; i++) if (KIND_RULES[i][0].test(title)) return { label: KIND_RULES[i][1], hot: KIND_RULES[i][2] };
    return { label: 'Notice', hot: false };
  }

  /* Tabs */
  try {
    var tabs = document.querySelectorAll('.nn-tabs .nn-tab'),
        panels = document.querySelectorAll('[data-panel]');
    tabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        tabs.forEach(function(t){ t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        panels.forEach(function(p){ p.hidden = p.getAttribute('data-panel') !== tab.getAttribute('data-tab'); });
      });
    });
  } catch(e) {}

  /* ---- Freshness state (visible line, incl. failures) ---- */
  var fresh = { annOk: null, hlOk: null, annUpd: '', hlAsof: '', lastCheck: null, newCount: 0 };
  var prevKeys = null;
  /* ---- Refresh change-gate (fading fix): the 60s tick must not destroy
     and rebuild the feeds when the payload is unchanged. Each feed's
     signature is the exact joined key of every item (title+date+sym+url),
     so no real change can be missed; an unchanged tick updates only the
     freshness line's checked time, never the feed DOM. */
  var lastAnnSig = null, lastHlSig = null;
  function sigKey(it, src){ return src + '|' + (it.title || '') + '|' + (it.date || '') + '|' + (it.sym || '') + '|' + (it.url || ''); }
  function feedSig(items, src){
    var parts = [String(items.length)];
    for (var i = 0; i < items.length; i++) parts.push(sigKey(items[i], src));
    return parts.join('\u0001');
  }
  function nptClock(d){
    try { return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' }); }
    catch(e) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  }
  /* NPT calendar date (YYYY-MM-DD) for feed-staleness thresholds. */
  function nptDate(d){
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      var g = function(t){ var f = p.filter(function(x){ return x.type === t; }); return f.length ? f[0].value : ''; };
      return g('year') + '-' + g('month') + '-' + g('day');
    } catch(e) { return new Date(d.getTime() + 5.75 * 3600e3).toISOString().slice(0, 10); }
  }
  function dayBefore(iso){
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  function itemKey(it, src){ return src + '|' + (it.title || '') + '|' + (it.date || ''); }
  function renderFresh(){
    var line = document.getElementById('nnFreshLine'); if (!line) return;
    var badge = document.getElementById('nnFresh');
    var anyFailed = (fresh.annOk === false) || (fresh.hlOk === false);
    var anyLoaded = (fresh.annOk !== null) || (fresh.hlOk !== null);
    if (!anyLoaded) return; /* keep the honest static text until a check runs */
    var parts = [];
    parts.push(fresh.annOk ? ('Announcements updated ' + fmtDate(fresh.annUpd)) : 'Announcements refresh failed');
    parts.push(fresh.hlOk ? ('Headlines as of ' + fmtDate(fresh.hlAsof)) : 'Headlines refresh failed');
    /* Phase 0 item 1: a stamp alone lets a dead writer hide — a feed file's
       build date advances only while its writer runs, so a stamp older than
       yesterday means that feed stopped updating. Flag it explicitly instead
       of letting the "Live" badge imply freshness. */
    var staleLimit = dayBefore(nptDate(new Date()));
    var annStale = !!(fresh.annOk && fresh.annUpd && fresh.annUpd < staleLimit);
    var hlStale = !!(fresh.hlOk && fresh.hlAsof && fresh.hlAsof < staleLimit);
    if (annStale) parts.push('⚠ Announcements feed stale — last update ' + fmtDate(fresh.annUpd));
    if (hlStale) parts.push('⚠ Headlines feed stale — last update ' + fmtDate(fresh.hlAsof));
    if (fresh.lastCheck) parts.push('checked ' + nptClock(fresh.lastCheck) + ' NPT');
    if (fresh.newCount > 0) parts.push(fresh.newCount + ' new since last check');
    if (anyFailed) parts.push('showing last loaded feed · will retry');
    else parts.push('next check in 60 seconds');
    line.textContent = parts.join(' · ');
    var anyStale = annStale || hlStale;
    line.classList.toggle('failed', anyFailed || anyStale);
    if (badge) {
      badge.textContent = anyFailed ? 'Check failed — showing last feed' : (anyStale ? 'Feed stale — showing last data' : 'Live — auto-refreshes');
      /* #nnFresh is the inner text span; the .nn-badge.failed style lives
         on its parent (the outer badge span). */
      badge.parentNode.classList.toggle('failed', anyFailed || anyStale);
    }
  }
  function noteNewItems(){
    var keys = {};
    annItems.forEach(function(it){ keys[itemKey(it, 'ann')] = 1; });
    hlItems.forEach(function(it){ keys[itemKey(it, 'news')] = 1; });
    if (prevKeys) {
      var n = 0; for (var k in keys) if (!prevKeys[k]) n++;
      fresh.newCount = n;
    } else fresh.newCount = 0;
    prevKeys = keys;
  }

  /* ---- Session strip: one chip per feed date, filters both feeds ---- */
  var activeSession = null;
  function sessDate(it){ return String(it.date || '').slice(0, 10); }
  function renderSessions(){
    var host = document.getElementById('nnSessionChips'); if (!host) return;
    var map = {};
    annItems.forEach(function(it){ var d = sessDate(it); if (!d) return; (map[d] = map[d] || {ann: 0, hl: 0}).ann++; });
    hlItems.forEach(function(it){ var d = sessDate(it); if (!d) return; (map[d] = map[d] || {ann: 0, hl: 0}).hl++; });
    var dates = Object.keys(map).sort(function(a, b){ return b.localeCompare(a); });
    if (!dates.length) { host.innerHTML = ''; return; }
    var html = '<button type="button" class="nn-sess' + (activeSession === null ? ' active' : '') + '" data-sess="" aria-pressed="' + (activeSession === null ? 'true' : 'false') + '">All sessions</button>';
    dates.forEach(function(d){
      var m = map[d], tot = m.ann + m.hl;
      html += '<button type="button" class="nn-sess' + (activeSession === d ? ' active' : '') + '" data-sess="' + esc(d) + '" aria-pressed="' + (activeSession === d ? 'true' : 'false') + '" title="' + m.ann + ' announcements · ' + m.hl + ' headlines">' + esc(fmtDate(d)) + ' · ' + tot + '</button>';
    });
    host.innerHTML = html;
    host.querySelectorAll('.nn-sess').forEach(function(btn){
      btn.addEventListener('click', function(){
        var d = btn.getAttribute('data-sess');
        activeSession = d ? d : null;
        renderSessions(); renderAnn(); renderHl();
      });
    });
  }
  function matchSession(it){ return !activeSession || sessDate(it) === activeSession; }

  /* ---- Announcement kinds strip (ranked bars over all announcements) ---- */
  function renderKinds(){
    var host = document.getElementById('nnKindStrip'); if (!host) return;
    if (!annItems.length) { host.innerHTML = ''; return; }
    var counts = {};
    annItems.forEach(function(it){ var l = annKind(it.title).label; counts[l] = (counts[l] || 0) + 1; });
    var rows = Object.keys(counts).map(function(l){ return [l, counts[l]]; });
    rows.sort(function(a, b){ return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
    var max = rows.length ? rows[0][1] : 1;
    var html = '<h3 class="nn-sec-h">Announcement kinds</h3><div class="nn-kind-rows" role="img" aria-label="Announcement kinds: ' +
      rows.map(function(r){ return r[0] + ' ' + r[1]; }).join(', ') + ' of ' + annItems.length + '">';
    rows.forEach(function(r){
      html += '<div class="nn-kind-row"><span class="nn-kind-lab">' + esc(r[0]) + '</span>' +
        '<span class="nn-kind-track"><i style="width:' + (r[1] / max * 100).toFixed(1) + '%"></i></span>' +
        '<span class="nn-kind-n">' + r[1] + '</span></div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  /* Announcements */
  var annItems = [], annFilter, annLimit = 9;
  function logoHtml(sym, px){
    // Generic news (no verified company) gets a neutral icon — per data-honesty
    // rule, don't show a company logo next to news that isn't about that company.
    if (!sym) return '<span style="font-size:28px;line-height:1;flex:none">📰</span>';
    // Use company logo when available, fallback to monogram
    if (window.NepseLogo && window.NepseLogo.html) {
      return window.NepseLogo.html(sym, '', px || 40);
    }
    return '<span class="nn-mono" style="background:' + monoColor(sym) + '">' + esc(monoText(sym)) + '</span>';
  }
  /* Phase 0 item 2: story links use the stable item id when the feed
     carries one; index links (?i=) stay as fallback for old rows. */
  function storyHref(src, it, i){
    return '/nepse-news/story/?src=' + src + (it.id ? '&id=' + encodeURIComponent(it.id) : '&i=' + i);
  }
  function annCard(it, i){
    var k = annKind(it.title);
    var cat = newsCategory(it.title, it.sym);
    return '<a class="nn-card" href="' + storyHref('ann', it, i) + '">' +
      '<div class="nn-card-top">' + logoHtml(it.sym, 40) +
      '<div><p class="nn-cat ' + (CAT_CLASS[cat] || 'companies') + '">' + esc(cat) + '</p>' +
      '<span class="nn-kind' + (k.hot ? ' hot' : '') + '">' + esc(k.label) + '</span></div></div>' +
      '<h3>' + escT(it.title) + '</h3>' +
      '<div class="nn-foot">' + symLink(it.sym) + '<span>' + fmtDate(it.date) + '</span>' +
      (it.url ? '<span class="nn-src">' + esc(it.url.split('/')[2] || '') + '</span>' : '') + '</div></a>';
  }
  function annFeatured(it, i){
    var k = annKind(it.title);
    var cat = newsCategory(it.title, it.sym);
    return '<a class="nn-featured" href="' + storyHref('ann', it, i) + '">' +
      '<div class="nn-featured-art">' + logoHtml(it.sym, 72) + '</div>' +
      '<div class="nn-featured-body"><p class="nn-cat ' + (CAT_CLASS[cat] || 'companies') + '">' + esc(cat) + ' · ' + esc(k.label) + '</p>' +
      '<h2>' + escT(it.title) + '</h2>' +
      '<div class="nn-meta">' + symLink(it.sym) + '<span>' + fmtDate(it.date) + '</span><span>Official disclosure</span></div></div></a>';
  }
  function renderAnn(){
    var feed = document.getElementById('annFeed'); if (!feed) return;
    var q = (annFilter && annFilter.value || '').trim().toLowerCase();
    var items = annItems.filter(function(it){
      if (!matchSession(it)) return false;
      return !q || (it.sym || '').toLowerCase().indexOf(q) >= 0 || (it.title || '').toLowerCase().indexOf(q) >= 0;
    });
    var count = document.getElementById('annCount');
    if (count) count.textContent = items.length + ' of ' + annItems.length;
    if (!items.length) { feed.innerHTML = '<p class="nn-empty">No announcements match this filter.</p>'; return; }
    var idx = function(it){ return annItems.indexOf(it); };
    feed.innerHTML = annFeatured(items[0], idx(items[0])) +
      '<h2 class="nn-sec-h">More announcements</h2><div class="nn-grid">' +
      items.slice(1, 1 + annLimit).map(function(it){ return annCard(it, idx(it)); }).join('') + '</div>' +
      (items.length > 1 + annLimit ? '<button type="button" class="nn-more" id="annMore">Show more announcements</button>' : '');
    var ab = document.getElementById('annMore');
    if (ab) ab.addEventListener('click', function(){ annLimit += 12; renderAnn(); });
  }
  function loadAnn(){
    return fetch('/nepse-chart/data/announcements.json', { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d){
        var next = (d.items || []).slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
        var sig = feedSig(next, 'ann');
        var changed = sig !== lastAnnSig;
        annItems = next; lastAnnSig = sig;
        if (d.updated) fresh.annUpd = d.updated;
        fresh.annOk = true;
        if (changed) {
          var upd = document.getElementById('annUpdated');
          if (upd && d.updated) upd.textContent = 'Official company disclosures · updated ' + fmtDate(d.updated) + '. Open a story for details and chart links.';
          renderAnn(); renderKinds(); updateCounts();
        }
        return changed;
      })
      .catch(function(){ fresh.annOk = false; return false; });
  }

  /* Headlines */
  var hlItems = [], hlFilter, activeCat = 'All', hlLimit = 9;
  function hlFeatured(it, i){
    var cat = newsCategory(it.title, it.sym);
    return '<a class="nn-featured" href="' + storyHref('news', it, i) + '">' +
      '<div class="nn-featured-art"><span style="font-size:28px;line-height:1;flex:none">📰</span></div>' +
      '<div class="nn-featured-body"><p class="nn-cat ' + CAT_CLASS[cat] + '">' + esc(cat) + ' · ' + esc(it.src || 'Market') + '</p>' +
      '<h2>' + escT(it.title) + '</h2>' +
      '<div class="nn-meta"><span>' + fmtDate(it.date) + '</span><span>Attributed to publisher</span></div></div></a>';
  }
  function hlRow(it, i){
    var cat = newsCategory(it.title, it.sym);
    return '<a class="nn-row" href="' + storyHref('news', it, i) + '">' +
      '<span style="font-size:28px;line-height:1;flex:none">📰</span>' +
      '<div><p class="nn-row-kicker"><span class="nn-cat ' + CAT_CLASS[cat] + '">' + esc(cat) + '</span> · ' + esc(it.src || 'Market') + '</p>' +
      '<h3 class="nn-row-title">' + escT(it.title) + '</h3>' +
      '<div class="nn-meta"><span>' + fmtDate(it.date) + '</span></div></div></a>';
  }
  function renderHl(){
    var feed = document.getElementById('hlFeed'); if (!feed) return;
    var q = (hlFilter && hlFilter.value || '').trim().toLowerCase();
    var items = hlItems.filter(function(it){
      if (activeCat !== 'All' && newsCategory(it.title, it.sym) !== activeCat) return false;
      if (!matchSession(it)) return false;
      return !q || (it.sym || '').toLowerCase().indexOf(q) >= 0 || (it.title || '').toLowerCase().indexOf(q) >= 0;
    });
    var count = document.getElementById('hlCount');
    if (count) count.textContent = items.length + ' of ' + hlItems.length;
    if (!items.length) { feed.innerHTML = '<p class="nn-empty">No headlines match this filter.</p>'; return; }
    var idx = function(it){ return hlItems.indexOf(it); };
    feed.innerHTML = hlFeatured(items[0], idx(items[0])) +
      '<h2 class="nn-sec-h">More headlines</h2><div class="nn-rows">' +
      items.slice(1, 1 + hlLimit).map(function(it){ return hlRow(it, idx(it)); }).join('') + '</div>' +
      (items.length > 1 + hlLimit ? '<button type="button" class="nn-more" id="hlMore">Show more headlines</button>' : '');
    var hb = document.getElementById('hlMore');
    if (hb) hb.addEventListener('click', function(){ hlLimit += 15; renderHl(); });
  }
  function loadHl(){
    return fetch('/nepse-chart/data/news.json', { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d){
        var next = (d.items || []).slice().sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
        var sig = feedSig(next, 'news');
        var changed = sig !== lastHlSig;
        hlItems = next; lastHlSig = sig;
        if (d.asof || d.updated) fresh.hlAsof = d.asof || d.updated;
        fresh.hlOk = true;
        if (changed) {
          var upd = document.getElementById('hlUpdated');
          var asof = d.asof || d.updated;
          if (upd && asof) upd.textContent = 'Headlines, editorially reviewed · updated ' + fmtDate(asof) + '.';
          renderHl(); updateCounts(); renderMix();
        }
        return changed;
      })
      .catch(function(){ fresh.hlOk = false; return false; });
  }
  function renderMix(){
    var host = document.getElementById('hlMix'); if (!host || !hlItems.length) return;
    var counts = { mk: 0, co: 0, ec: 0 };
    hlItems.forEach(function(it){
      var c = newsCategory(it.title, it.sym);
      if (c === 'Markets') counts.mk++; else if (c === 'Companies') counts.co++; else counts.ec++;
    });
    var tot = hlItems.length;
    var seg = [['mk','Markets',counts.mk],['co','Companies',counts.co],['ec','Economy & Policy',counts.ec]];
    var track = '', legend = '';
    seg.forEach(function(s){
      if (!s[2]) return;
      track += '<i class="' + s[0] + '" style="width:' + (s[2] / tot * 100).toFixed(2) + '%"></i>';
      legend += '<span><b class="' + s[0] + '"></b>' + s[1] + ' ' + s[2] + '</span>';
    });
    document.getElementById('hlMixTrack').innerHTML = track;
    document.getElementById('hlMixLegend').innerHTML = legend;
    host.hidden = false;
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', 'Headline mix: ' + seg.filter(function(s){ return s[2]; }).map(function(s){ return s[1] + ' ' + s[2]; }).join(', ') + ' of ' + tot);
  }
  function updateCounts(){
    var c = document.getElementById('nnCounts');
    if (c) c.textContent = annItems.length + ' announcements · ' + hlItems.length + ' headlines';
  }

  /* ---- Sector stocks block (verdicts batch; universe carries no sector field) ---- */
  var secRows = [], secFilter = 'All', secPage = 1, secBatch = '';
  var SEC_PAGE = 25;
  function fmtCh(ch){
    if (ch === null || ch === undefined || isNaN(ch)) return '—';
    return (ch >= 0 ? '+' : '') + Number(ch).toFixed(2) + '%';
  }
  function fmtRs(p){
    if (p === null || p === undefined || isNaN(p)) return '—';
    return 'Rs ' + Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function renderSector(){
    var sel = document.getElementById('nnSecSelect'); if (!sel) return;
    var rows = secRows.filter(function(r){ return secFilter === 'All' || r.sec === secFilter; });
    var sum = document.getElementById('nnSecSummary');
    if (sum) sum.textContent = rows.length + ' stocks · batch ' + (secBatch || '—');
    var pages = Math.max(1, Math.ceil(rows.length / SEC_PAGE));
    if (secPage > pages) secPage = pages;
    var start = (secPage - 1) * SEC_PAGE, slice = rows.slice(start, start + SEC_PAGE);
    var tb = document.getElementById('nnSecBody');
    if (tb) tb.innerHTML = slice.map(function(r){
      return '<tr><td><a class="nn-sym" href="/stocks/' + encodeURIComponent(r.sym) + '/">' + esc(r.sym) + '</a></td>' +
        '<td>' + esc(r.name) + '</td><td class="num">' + fmtRs(r.close) + '</td>' +
        '<td class="num ' + (r.ch === null ? '' : (r.ch >= 0 ? 'up' : 'dn')) + '">' + fmtCh(r.ch) + '</td>' +
        '<td class="num">' + esc(secBatch || '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="nn-empty-cell">No stocks in this sector.</td></tr>';
    var pg = document.getElementById('nnSecPage');
    if (pg) pg.textContent = rows.length ? ('Showing ' + (start + 1) + '–' + Math.min(start + SEC_PAGE, rows.length) + ' of ' + rows.length) : 'Showing 0 of 0';
    var pv = document.getElementById('nnSecPrev'), nx = document.getElementById('nnSecNext');
    if (pv) pv.disabled = secPage <= 1;
    if (nx) nx.disabled = secPage >= pages;
  }
  function loadSector(){
    return Promise.all([
      fetch('/nepse-chart/data/universe.json', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
      fetch('/nepse-chart/data/verdicts.json', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    ]).then(function(parts){
      var uni = parts[0], ver = parts[1];
      var syms = (uni.symbols || []).slice();
      var vrows = ver.verdicts || {};
      secBatch = ver.asof || uni.asof || '';
      var counts = {};
      secRows = syms.map(function(s){
        var v = vrows[s.s];
        var sec = v && v.sec ? v.sec : 'Unscored';
        counts[sec] = (counts[sec] || 0) + 1;
        return { sym: s.s, name: s.n || s.s, sec: sec,
                 close: v && v.p !== undefined ? v.p : null,
                 ch: v && v.ch !== undefined ? v.ch : null };
      }).sort(function(a, b){ return a.sym.localeCompare(b.sym); });
      var sel = document.getElementById('nnSecSelect'); if (!sel) return;
      var opts = ['<option value="All">All sectors (' + secRows.length + ')</option>'];
      Object.keys(counts).sort().forEach(function(sec){
        opts.push('<option value="' + esc(sec) + '">' + esc(sec) + ' (' + counts[sec] + ')</option>');
      });
      sel.innerHTML = opts.join('');
      sel.value = 'All'; secFilter = 'All'; secPage = 1;
      renderSector();
    }).catch(function(){ /* sector block keeps its last good state; never blanks on failure */ });
  }

  /* ---- Boot + refresh ---- */
  try {
    annFilter = document.getElementById('annFilter');
    hlFilter = document.getElementById('hlFilter');
    if (annFilter) annFilter.addEventListener('input', function(){ annLimit = 9; renderAnn(); });
    if (hlFilter) hlFilter.addEventListener('input', function(){ hlLimit = 9; renderHl(); });
    document.querySelectorAll('#catPills .nn-pill').forEach(function(btn){
      btn.addEventListener('click', function(){
        activeCat = btn.getAttribute('data-cat');
        hlLimit = 9;
        document.querySelectorAll('#catPills .nn-pill').forEach(function(b){ b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
        renderHl();
      });
    });
    var secSel = document.getElementById('nnSecSelect');
    if (secSel) secSel.addEventListener('change', function(){ secFilter = secSel.value; secPage = 1; renderSector(); });
    var pv = document.getElementById('nnSecPrev'), nx = document.getElementById('nnSecNext');
    if (pv) pv.addEventListener('click', function(){ if (secPage > 1) { secPage--; renderSector(); } });
    if (nx) nx.addEventListener('click', function(){ secPage++; renderSector(); });
    function loadAll(){
      return Promise.all([loadAnn(), loadHl()]).then(function(changed){
        noteNewItems();
        fresh.lastCheck = new Date();
        /* Unchanged tick: feeds, kinds, counts, session chips and mix all
           stay exactly as rendered; only the freshness line moves. */
        if (changed[0] || changed[1]) renderSessions();
        renderFresh();
      });
    }
    loadAll();
    loadSector();
    /* News has no market-data delay and headlines publish daily including
       weekends (news.json carries Sat/Sun dates), so the 60s visible-tab
       cadence stays at all hours — no weekend slowdown. Returning to the
       tab re-checks immediately; hidden tabs never poll. */
    setInterval(function(){ if (!document.hidden) loadAll(); }, 60000);
    document.addEventListener('visibilitychange', function(){
      if (!document.hidden) { loadAll(); loadSector(); }
    });
  } catch(e) {}
})();
