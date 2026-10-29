/* Value screen — teardown build (page 5 of the verdict-engine series).
   Fetches nepse-chart/data/value.json + live.json (cache: no-store).
   60s change-gated refresh: the tick builds the new state and compares
   its signature BEFORE touching the table — on unchanged payloads only
   the freshness clock advances; on change it re-renders preserving the
   view. View-change handlers RE-BASELINE the signature, never null it.
   LTP repaint: live tape LTP replaces the screen LTP ONLY when the tape
   session >= the value asof; ratios, medians and scores NEVER repaint. */
(function(){
"use strict";
var BASE = '/nepse-chart/data/';
var state = { sector: '', sort: 'value_score', dir: -1, search: '', rows: [], page: 1, perPage: 25,
  valueAsOf: '', tapeSession: '', repainted: 0, uiInit: false, sig: '' };
var $ = function(id){ return document.getElementById(id); };

function fmt(n, d){ d = d===undefined?2:d; if(n===null||n===undefined||!isFinite(n)) return '–';
  return Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
/* Date part of an asof that may be an ISO string ("2026-10-27T15:00…") or
   epoch ms (screener lesson: live overlays once .slice()d a number). */
function datePart(a){
  if (a===null||a===undefined) return '';
  if (typeof a === 'number') { var d = new Date(a); return isNaN(d) ? '' : d.toISOString().slice(0,10); }
  return String(a).slice(0,10);
}
function cmpNum(a, b){ /* nulls LAST on every column, either direction */
  var an = (a===null||a===undefined||!isFinite(a)), bn = (b===null||b===undefined||!isFinite(b));
  if (an && bn) return 0; if (an) return 1; if (bn) return -1; return a - b;
}

function sectorCountsOf(rows){
  var c = {};
  rows.forEach(function(s){ c[s.sector] = (c[s.sector] || 0) + 1; });
  return c;
}
function sigOf(valueAsOf, rows, tapeSession){
  var counts = sectorCountsOf(rows);
  var top = rows.slice(0, 3).map(function(s){ return s.symbol + ':' + s.value_score; }).join(',');
  return [valueAsOf, rows.length, top, JSON.stringify(counts), tapeSession].join('|');
}
function rebaseline(){ state.sig = sigOf(state.valueAsOf, state.rows, state.tapeSession); }
function clockHM(d){ d = d || new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
function renderFresh(){
  var el = $('va-fresh'); if (!el) return;
  var next = new Date(Date.now() + 60000);
  el.innerHTML = '<span class="va-dot"></span>Value screen as of ' + esc(state.valueAsOf || '–') +
    ' · tape ' + esc(state.tapeSession || 'unavailable') + ' · checked ' + clockHM() +
    ' · next check ' + clockHM(next) + ' · refreshes every 60s when the data changes';
}

function filtered(){
  var q = state.search.trim().toLowerCase();
  var r = state.rows.filter(function(s){
    if (state.sector && s.sector !== state.sector) return false;
    if (q && (String(s.symbol).toLowerCase().indexOf(q) < 0) && (String(s.name||'').toLowerCase().indexOf(q) < 0)) return false;
    return true;
  });
  var k = state.sort, d = state.dir;
  r.sort(function(a, b){
    if (k === 'symbol') return (String(a.symbol).localeCompare(String(b.symbol))) * d;
    return cmpNum(a[k], b[k]) * d;
  });
  return r;
}

function renderStats(){
  var rows = state.rows, n = rows.length;
  var wrap = $('va-stats'); if (!wrap) return;
  var scores = rows.map(function(s){ return s.value_score; }).filter(isFinite).sort(function(a,b){ return a-b; });
  var med = scores.length ? scores[Math.floor(scores.length/2)] : null;
  var top = rows[0] || null;
  var nsec = Object.keys(sectorCountsOf(rows)).length;
  wrap.innerHTML =
    '<button type="button" class="va-stat" data-stat="all"><span class="va-statnum">' + n + '</span><span class="va-statlab">Companies scored</span><span class="va-statsub">of 197 in source filings</span></button>' +
    '<button type="button" class="va-stat" data-stat="sectors"><span class="va-statnum">' + nsec + '</span><span class="va-statlab">Sectors scored</span><span class="va-statsub">within-sector ranks only</span></button>' +
    '<button type="button" class="va-stat" data-stat="top"><span class="va-statnum">' + fmt(top ? top.value_score : null, 1) + '</span><span class="va-statlab">Top score</span><span class="va-statsub">' + esc(top ? top.symbol : '–') + '</span></button>' +
    '<button type="button" class="va-stat" data-stat="med"><span class="va-statnum">' + fmt(med, 1) + '</span><span class="va-statlab">Median score</span><span class="va-statsub">across ' + n + ' scored</span></button>';
  wrap.querySelectorAll('[data-stat]').forEach(function(b){
    b.addEventListener('click', function(){
      var st = b.getAttribute('data-stat');
      var si = $('va-search');
      if (st === 'top' && top) { state.search = top.symbol; if (si) si.value = top.symbol; }
      else { state.search = ''; if (si) si.value = ''; }
      state.page = 1; render(); rebaseline();
      var t = $('valueTable'); if (t) t.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
}

function renderHist(){
  var el = $('va-hist'); if (!el) return;
  var buckets = [[0,20],[20,40],[40,60],[60,80],[80,101]];
  var counts = buckets.map(function(){ return 0; });
  state.rows.forEach(function(s){
    for (var i = 0; i < buckets.length; i++){
      if (s.value_score >= buckets[i][0] && s.value_score < buckets[i][1]) { counts[i]++; break; }
    }
  });
  var max = Math.max.apply(null, counts.concat([1]));
  var total = state.rows.length || 1;
  el.innerHTML = buckets.map(function(b, i){
    var pct = (counts[i] / total * 100).toFixed(1);
    return '<div class="va-hist-row"><span class="va-hist-lab">' + b[0] + '–' + (b[1] === 101 ? '100' : b[1]) +
      '</span><span class="va-hist-track"><i style="width:' + (counts[i]/max*100).toFixed(1) + '%"></i></span>' +
      '<span class="va-hist-num">' + counts[i] + ' (' + pct + '%)</span></div>';
  }).join('');
}

function renderSectors(){
  var el = $('va-sectors'); if (!el) return;
  var counts = sectorCountsOf(state.rows);
  var secs = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a]; });
  el.innerHTML = secs.map(function(sec){
    var mem = state.rows.filter(function(s){ return s.sector === sec; });
    var top3 = mem.slice(0, 3);
    var med = mem[0] || {};
    return '<div class="va-sector' + (state.sector === sec ? ' is-pressed' : '') + '" data-sec="' + esc(sec) + '">' +
      '<button type="button" class="va-sector-btn" aria-pressed="' + (state.sector === sec) + '">' +
      '<span class="va-secname">' + esc(sec) + '</span>' +
      '<span class="va-secmeta" style="display:block">' + counts[sec] + ' companies scored</span>' +
      '<span class="va-secmed" style="display:block">Median P/E ' + fmt(med.sector_median_pe, 1) + ' · median P/BV ' + fmt(med.sector_median_pbv, 2) + '</span></button>' +
      '<span class="va-sectop" style="display:block">' + top3.map(function(s){
        return '<a href="/stocks/' + esc(s.symbol) + '/">' + esc(s.symbol) + '</a> ' + fmt(s.value_score, 1);
      }).join(' · ') + '</span></div>';
  }).join('');
  el.querySelectorAll('[data-sec]').forEach(function(b){
    /* A11y 2026-10-29: card is a div; top-3 stock links are siblings of
       the toggle button, not nested in it (the old stopPropagation is
       gone because there is nothing left to stop). Link clicks navigate
       only; every other card click — including button keyboard activation
       bubbling here — toggles exactly as before. */
    b.addEventListener('click', function(ev){
      if (ev.target.closest && ev.target.closest('a')) return;
      var sec = b.getAttribute('data-sec');
      state.sector = (state.sector === sec) ? '' : sec;
      var sel = $('sectorSel'); if (sel) sel.value = state.sector;
      state.page = 1; render(); rebaseline();
      var t = $('valueTable'); if (t) t.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
}

function render(){
  var rows = filtered();
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / state.perPage));
  if (state.page > pages) state.page = pages;
  var start = (state.page - 1) * state.perPage;
  var pageRows = rows.slice(start, start + state.perPage);
  var html = '';
  pageRows.forEach(function(s){
    var research = (s.symbol === 'NBL')
      ? ' <a href="/blog/nepal-bank-nbl-company-analysis/" style="font-size:.72rem;font-weight:700;color:var(--nd-lime,#B8E62E);text-decoration:none;border:1px solid var(--nd-lime,#B8E62E);border-radius:999px;padding:1px 8px;white-space:nowrap" title="Full equity research report on Nepal Bank">Research</a>' : '';
    var liveMark = s._repainted ? ' <span class="va-live-dot" title="Live tape, ' + esc(state.tapeSession) + '">●</span>' : '';
    html += '<tr>'
      + '<td><span class="scorebar"><i style="width:'+Math.round(s.value_score)+'%"></i></span> '+fmt(s.value_score,1)+'</td>'
      + '<td><a class="symlink" href="/nepse-chart/?s='+esc(s.symbol)+'">'+esc(s.symbol)+'</a>'+research+'<span class="sname">'+esc(s.name)+'</span></td>'
      + '<td>'+esc(s.sector)+'</td>'
      + '<td class="num">'+fmt(s.ltp)+liveMark+'</td>'
      + '<td class="num">'+fmt(s.pe_ttm)+'<span class="submed">sector '+fmt(s.sector_median_pe,1)+'</span></td>'
      + '<td class="num">'+fmt(s.pbv)+'<span class="submed">sector '+fmt(s.sector_median_pbv,2)+'</span></td>'
      + '<td class="num">'+fmt(s.ey_pct)+'%</td>'
      + '<td class="num">'+fmt(s.roe_ttm_pct)+'%</td>'
      + '<td class="num">'+fmt(s.eps_ttm)+'</td>'
      + '<td class="num">'+fmt(s.bvps)+'</td>'
      + '<td>'+esc(s.period||'–')+'</td>'
      + '</tr>';
  });
  if(!pageRows.length) html = '<tr><td colspan="11" style="text-align:center;color:var(--nd-dim,#6B7280)">No companies match this filter.</td></tr>';
  $('valueBody').innerHTML = html;
  var ths = document.querySelectorAll('#valueTable th.sortable');
  ths.forEach(function(th){
    var k = th.getAttribute('data-k');
    var base = th.textContent.replace(/ [▲▼]/,'');
    th.classList.toggle('sorted', k===state.sort);
    th.innerHTML = esc(base) + (k===state.sort ? ' <span class="arr">'+(state.dir===-1?'▼':'▲')+'</span>' : '');
  });
  var range = $('valueRange');
  if (range) range.textContent = total ? ('Showing ' + (start + 1) + '–' + Math.min(start + state.perPage, total) + ' of ' + total + ' companies · page ' + state.page + '/' + pages) : '';
  var prev = $('valuePrev'), next = $('valueNext');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
  var pg = $('valuePages');
  if (pg){
    var btns = '';
    for (var p = 1; p <= pages; p++){
      btns += '<button type="button" class="va-page' + (p === state.page ? ' active' : '') + '" data-pg="' + p + '">' + p + '</button>';
    }
    pg.innerHTML = btns;
    pg.querySelectorAll('[data-pg]').forEach(function(b){
      b.addEventListener('click', function(){ state.page = parseInt(b.getAttribute('data-pg'), 10); render(); rebaseline(); window.scrollTo({top: $('valueTable').offsetTop - 80, behavior: 'smooth'}); });
    });
  }
  var rn = $('va-repaint-note');
  if (rn) rn.textContent = state.tapeSession ? ('● Live tape (' + state.tapeSession + '): ' + state.repainted + ' LTPs confirmed by the tape. Ratios, sector medians and scores are filing-based and never repainted.') : '';
  renderStats(); renderHist(); renderSectors();
}

/* Build the next state WITHOUT touching the DOM, so the tick can compare
   signatures before deciding to re-render. */
function buildState(d, live){
  var ltpMap = {};
  var tapeSession = '';
  if (live && live.quotes){
    tapeSession = datePart(live.session_date || live.asof);
    live.quotes.forEach(function(q){ if (q.ltp > 0) ltpMap[q.symbol] = q.ltp; });
  }
  var valueAsOf = d.asof || '';
  var rows = (d.stocks || []).map(function(s){ var c = {}; for (var k in s) c[k] = s[k]; return c; });
  var repainted = 0;
  /* Repaint guard (screener precedent): tape session must be >= value asof.
     Value LTPs already come from this tape, so repaint confirms rather than
     moves prices — the ● marks tape confirmation, not a new price. */
  var ok = tapeSession && valueAsOf && tapeSession >= valueAsOf;
  rows.forEach(function(s){
    s._repainted = false;
    if (ok && ltpMap[s.symbol]) { s.ltp = ltpMap[s.symbol]; s._repainted = true; repainted++; }
  });
  return { valueAsOf: valueAsOf, tapeSession: tapeSession, rows: rows, repainted: repainted,
    sig: sigOf(valueAsOf, rows, tapeSession), d: d };
}
function commitState(ns){
  state.valueAsOf = ns.valueAsOf; state.tapeSession = ns.tapeSession;
  state.rows = ns.rows; state.repainted = ns.repainted;
  var d = ns.d;
  if (!state.uiInit) {
    var sectors = sectorCountsOf(state.rows);
    var sel = $('sectorSel');
    Object.keys(sectors).sort().forEach(function(sc){
      var o = document.createElement('option'); o.value = sc; o.textContent = sc + ' (' + sectors[sc] + ')'; sel.appendChild(o);
    });
    sel.addEventListener('change', function(){ state.sector = sel.value; state.page = 1; render(); rebaseline(); });
    document.querySelectorAll('#valueTable th.sortable').forEach(function(th){
      th.addEventListener('click', function(){
        var k = th.getAttribute('data-k');
        if(state.sort===k){ state.dir = -state.dir; } else { state.sort=k; state.dir = (k === 'symbol') ? 1 : -1; }
        state.page = 1; render(); rebaseline(); syncSortSel();
      });
    });
    var sortSel = $('sortSel');
    if (sortSel) sortSel.addEventListener('change', function(){
      var v = sortSel.value;
      if (v === 'symbol'){ state.sort = 'symbol'; state.dir = 1; }
      else { state.sort = v; state.dir = -1; }
      state.page = 1; render(); rebaseline();
    });
    var search = $('va-search');
    if (search) search.addEventListener('input', function(){ state.search = search.value; state.page = 1; render(); rebaseline(); });
    var ppSel = $('perPageSel');
    if (ppSel) ppSel.addEventListener('change', function(){
      state.perPage = parseInt(ppSel.value, 10) || 25;
      state.page = 1; render(); rebaseline();
    });
    var prev = $('valuePrev'), next = $('valueNext');
    if (prev) prev.addEventListener('click', function(){ if (state.page > 1) { state.page--; render(); rebaseline(); window.scrollTo({top: $('valueTable').offsetTop - 80, behavior: 'smooth'}); } });
    if (next) next.addEventListener('click', function(){ state.page++; render(); rebaseline(); window.scrollTo({top: $('valueTable').offsetTop - 80, behavior: 'smooth'}); });
    state.uiInit = true;
  }
  var cov = $('coverage');
  if (cov){
    var nsec = Object.keys(sectorCountsOf(state.rows)).length;
    cov.innerHTML = '<strong>Data as of ' + esc(d.asof) + '.</strong> ' + state.rows.length +
      ' companies scored across ' + nsec + ' sectors (' +
      (d.coverage && d.coverage.companies || '?') + ' companies in source filings; the gap is the quality gate — positive TTM EPS and positive net worth, sectors with fewer than 4 members not scored). Rebuilt automatically each trading day after market close. Source: ' + esc(d.source) + '.';
  }
  var mb = $('methodBox'); if (mb) mb.textContent = d.method || '';
  render(); renderFresh(); syncSortSel(); rebaseline();
}
function syncSortSel(){
  var sortSel = $('sortSel'); if (!sortSel) return;
  var v = (state.sort === 'symbol') ? 'symbol' : state.sort;
  if (sortSel.querySelector('option[value="' + v + '"]')) sortSel.value = v;
}

function fetchPair(){
  var liveP = fetch(BASE+'live.json', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  var valP = fetch(BASE+'value.json', { cache: 'no-store' })
    .then(function(r){ if(!r.ok) throw 0; return r.json(); });
  return valP.then(function(d){ return liveP.then(function(live){ return { d: d, live: live }; }); });
}
function load(){
  fetchPair().then(function(p){
    commitState(buildState(p.d, p.live));
  }).catch(function(){
    $('coverage').textContent = 'Could not load value data. Please try again later.';
    $('valueBody').innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--nd-dim,#6B7280)">Data unavailable.</td></tr>';
  });
}
function refreshTick(){
  fetchPair().then(function(p){
    var ns = buildState(p.d, p.live);
    if (ns.sig === state.sig) { renderFresh(); return; }
    commitState(ns);
  }).catch(function(){ renderFresh(); });
}
load();
setInterval(function(){ if(!document.hidden) refreshTick(); }, 60*1000);
})();
