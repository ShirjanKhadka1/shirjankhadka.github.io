/* accdist.js — Accumulation / Distribution page logic (design-master rebuild).
   Extracted from the old inline script; behavior preserved except where noted:
   - lists now show the FULL published top 200 per side (old code sliced to 50);
   - the 60s timer is CHANGE-GATED (old code re-rendered unconditionally,
     blanking both tables to "Loading…" on every tick — the fading pattern);
   - a freshness line + banners replace the bare "Data: …" meta line;
   - boot failures render an honest empty state (old code left an unhandled
     Promise.all rejection and the page stuck on "Loading…" forever).
   Data: our own DB only (period files + provisional + verdicts + universe).
   Net values are single-counted nets (buy minus sell from net-flow records);
   they are never halved — the ÷2 rule applies only to per-symbol value/qty
   totals, which this page never displays. */
(function(){
"use strict";
var BC = window.BrokerCommon;
var PER = 25;
var state = { period: 'latest', brokers: {}, acc: [], dist: [], accView: [], distView: [],
  accPage: 1, distPage: 1, q: '', sig: null, lastGood: null, data: null,
  secRows: [], secFilter: 'All', secPage: 1, sectorBatch: '', rangeFrom: null, rangeTo: null };
var $ = function(id){ return document.getElementById(id); };

function nptTime(){
  try { return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false }); }
  catch (e) { return ''; }
}
function bname(code){ return state.brokers[code] || ('Broker ' + code); }
function periodDate(d){ return (d && (d.to || d.from)) || ''; }
function provTime(p){
  if (!p || !p.asof) return '';
  var t = String(p.asof);
  return t.slice(11, 16);
}
function norm(list){
  return (list || []).map(function(x){
    return { symbol: x.symbol || '—', broker: x.broker, brokerName: bname(x.broker),
      netQty: x.net_qty || 0, netVal: x.net_value || 0 };
  });
}
function matchesQ(r){
  if (!state.q) return true;
  return r.symbol.toLowerCase().indexOf(state.q) !== -1 ||
    r.brokerName.toLowerCase().indexOf(state.q) !== -1;
}
function applySearch(){
  state.accView = state.acc.filter(matchesQ);
  state.distView = state.dist.filter(matchesQ);
  state.accPage = 1; state.distPage = 1;
}
function signature(d){
  if (!d) return state.period + '|none';
  return [state.period, d.to || '', d._provState || '', d._provAsOf || '',
    JSON.stringify(d.accumulation || []), JSON.stringify(d.distribution || [])].join('|');
}
function freshState(d){
  if (state.period === 'latest' && d && d._fallback) {
    if (d._provState === 'symbol-only') return { kind: 'prov', text: 'last final ' + periodDate(d) };
    return { kind: 'fallback', text: 'Live feed unavailable · last final ' + periodDate(d) };
  }
  if (state.period === 'latest') return { kind: 'live', text: 'Live · ' + periodDate(d) };
  return { kind: 'final', text: 'Final · ' + (d && d.from ? d.from + ' → ' + d.to : state.period) };
}
function setFresh(failed){
  var el = $('acFresh'); if (!el) return;
  var st = state.data ? freshState(state.data) : { kind: 'fail', text: 'Data unavailable' };
  var dot = failed ? '<span class="ac-dot fail"></span>' : '<span class="ac-dot"></span>';
  el.innerHTML = dot + 'Checked ' + nptTime() + ' NPT · next check in 60 seconds · ' + BC.esc(st.text);
}
function setBanner(){
  var el = $('acBanner'); if (!el) return;
  var d = state.data;
  if (!d) { el.innerHTML = ''; return; }
  if (state.period === 'latest' && d._fallback && d._provState === 'symbol-only') {
    el.innerHTML = '<p class="ac-banner prov">Intraday accumulation/distribution pairs are not published yet — the intraday feed is symbol-only today, so the lists below show the last final session (' + BC.esc(periodDate(d)) + '). Broker pairs publish after close.</p>';
  } else if (state.period === 'latest' && d._fallback) {
    el.innerHTML = '<p class="ac-banner fail">Live feed unavailable — showing the last final session (' + BC.esc(periodDate(d)) + ').</p>';
  } else {
    el.innerHTML = '';
  }
}
function renderViz(){
  function bars(rows, dir){
    var top = rows.slice(0, 10);
    var max = top.length ? Math.max.apply(null, top.map(function(r){ return Math.abs(r.netVal); })) : 0;
    return top.map(function(r){
      var w = max ? Math.round(Math.abs(r.netVal) / max * 100) : 0;
      return '<div class="ac-rank"><span class="lb">' + BC.esc(r.symbol) + ' · ' + BC.esc(r.brokerName) + '</span>' +
        '<span class="tr"><i data-dir="' + dir + '" style="width:' + w + '%"></i></span>' +
        '<span class="vl" data-dir="' + dir + '">' + BC.fmtV(r.netVal) + '</span></div>';
    }).join('') || '<p class="ac-cap">No pairs in this period.</p>';
  }
  var accSum = state.acc.reduce(function(a, r){ return a + r.netVal; }, 0);
  var distSum = state.dist.reduce(function(a, r){ return a + r.netVal; }, 0);
  var accCut = state.acc.length ? state.acc[state.acc.length - 1].netVal : 0;
  var distCut = state.dist.length ? state.dist[state.dist.length - 1].netVal : 0;
  return '<div class="ac-viz">' +
    '<div class="ac-viz-card"><h3>Top accumulating pairs</h3>' +
    '<p class="ac-cap">Largest net buys in this period. Measured flow, not a forecast.</p>' + bars(state.acc, 'up') + '</div>' +
    '<div class="ac-viz-card"><h3>Top distributing pairs</h3>' +
    '<p class="ac-cap">Largest net sells in this period. Measured flow, not a forecast.</p>' + bars(state.dist, 'down') + '</div>' +
    '<div class="ac-viz-card"><h3>Mix — top 200 per side</h3>' +
    '<p class="ac-cap">Sums cover only the published top 200 per side, not the whole market — pairs below the cut-off are not counted here.</p>' +
    '<div class="ac-mix-row"><span class="mk up">▲ ' + state.acc.length + ' accumulating</span><span class="vl">' + BC.fmtV(accSum) + '</span></div>' +
    '<div class="ac-mix-row"><span class="mk down">▼ ' + state.dist.length + ' distributing</span><span class="vl">' + BC.fmtV(distSum) + '</span></div>' +
    '<div class="ac-mix-row"><span>Cut-offs (200th pair)</span><span class="vl">' + BC.fmtV(accCut) + ' / ' + BC.fmtV(distCut) + '</span></div></div>' +
    '</div>';
}
function renderList(tbodyId, showingId, prevId, nextId, view, page, good){
  var pages = Math.max(1, Math.ceil(view.length / PER));
  var pg = Math.min(page, pages);
  var slice = view.slice((pg - 1) * PER, Math.min(pg * PER, view.length));
  $(tbodyId).innerHTML = slice.map(function(r){
    return '<tr><td><a href="/stocks/' + BC.esc(r.symbol) + '/"><strong>' + BC.esc(r.symbol) + '</strong></a></td>' +
      '<td>' + BC.esc(r.brokerName) + '</td>' +
      '<td>' + BC.fmtQ(r.netQty, Math.abs(r.netVal)) + '</td>' +
      '<td class="' + (good ? 'pos' : 'neg') + '">' + BC.fmtV(r.netVal) + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="bk-loading">No matches.</td></tr>';
  var prev = $(prevId), next = $(nextId), show = $(showingId);
  if (prev) prev.disabled = pg <= 1;
  if (next) next.disabled = pg >= pages;
  if (show) show.textContent = view.length
    ? 'Showing ' + ((pg - 1) * PER + 1) + '–' + Math.min(pg * PER, view.length) + ' of ' + view.length
    : 'No pairs in this period.';
  return pg;
}
function renderLists(){
  state.accPage = renderList('accBody', 'accShowing', 'accPrev', 'accNext', state.accView, state.accPage, true);
  state.distPage = renderList('distBody', 'distShowing', 'distPrev', 'distNext', state.distView, state.distPage, false);
}
function render(){
  var d = state.data;
  if (!d) return;
  var topAcc = state.acc[0], topDist = state.dist[0];
  var periodText = state.period === 'latest' ? (d && d.provisional === true && d.symbol_only === false ? 'Provisional session (' + periodDate(d) + ')' : 'Last final session (' + periodDate(d) + ')')
    : (d.from ? d.from + ' → ' + d.to : state.period);
  var clampNote = (d.from === '2026-07-15' && (d.to || '') > '2026-07-15')
    ? 'Window-clamped to history start (2026-07-15)' : '';
  var html = '<div class="bk-tiles">' +
    '<div class="bk-tile"><div class="k">Top accumulation</div><div class="v">' + (topAcc ? BC.fmtV(topAcc.netVal) : '—') + '</div>' +
    '<div class="s">' + (topAcc ? BC.esc(topAcc.symbol) + ' · ' + BC.esc(topAcc.brokerName) : 'No pairs') + '</div></div>' +
    '<div class="bk-tile"><div class="k">Top distribution</div><div class="v">' + (topDist ? BC.fmtV(topDist.netVal) : '—') + '</div>' +
    '<div class="s">' + (topDist ? BC.esc(topDist.symbol) + ' · ' + BC.esc(topDist.brokerName) : 'No pairs') + '</div></div>' +
    '<div class="bk-tile"><div class="k">Pairs listed</div><div class="v">' + (state.acc.length + state.dist.length) + '</div>' +
    '<div class="s">Top 200 per side</div></div>' +
    '<div class="bk-tile"><div class="k">Period</div><div class="v" style="font-size:1rem">' + BC.esc(periodText) + '</div>' +
    '<div class="s">' + BC.esc(clampNote) + '</div></div></div>';
  html += renderViz();
  html += '<div class="bk-grid-2col">' +
    '<div><h2 class="bk-col-head up">Accumulating <span class="bk-col-sub">— top net bought</span></h2>' +
    '<div class="bk-scroll"><table class="bk-table" id="accTable"><thead><tr>' +
    '<th data-sort="symbol">Stock</th><th data-sort="brokerName">Broker</th><th data-sort="netQty">Net qty</th><th data-sort="netVal">Net value</th>' +
    '</tr></thead><tbody id="accBody"></tbody></table></div>' +
    '<div class="ac-pager"><button type="button" id="accPrev">Prev</button><span class="ac-showing" id="accShowing"></span><button type="button" class="ac-next" id="accNext">Next</button></div></div>' +
    '<div><h2 class="bk-col-head down">Distributing <span class="bk-col-sub">— top net sold</span></h2>' +
    '<div class="bk-scroll"><table class="bk-table" id="distTable"><thead><tr>' +
    '<th data-sort="symbol">Stock</th><th data-sort="brokerName">Broker</th><th data-sort="netQty">Net qty</th><th data-sort="netVal">Net value</th>' +
    '</tr></thead><tbody id="distBody"></tbody></table></div>' +
    '<div class="ac-pager"><button type="button" id="distPrev">Prev</button><span class="ac-showing" id="distShowing"></span><button type="button" class="ac-next" id="distNext">Next</button></div></div>' +
    '</div>';
  $('bkResult').innerHTML = html;
  window.__acTiles = document.querySelector('.bk-tiles') || null;
  renderLists();
  BC.makeSortable($('accTable'), function(){ return state.accView; }, function(rs){ state.accView = rs; state.accPage = 1; renderLists(); });
  BC.makeSortable($('distTable'), function(){ return state.distView; }, function(rs){ state.distView = rs; state.distPage = 1; renderLists(); });
  var ap = $('accPrev'), an = $('accNext'), dp = $('distPrev'), dn = $('distNext');
  if (ap) ap.addEventListener('click', function(){ if (state.accPage > 1) { state.accPage--; renderLists(); } });
  if (an) an.addEventListener('click', function(){ state.accPage++; renderLists(); });
  if (dp) dp.addEventListener('click', function(){ if (state.distPage > 1) { state.distPage--; renderLists(); } });
  if (dn) dn.addEventListener('click', function(){ state.distPage++; renderLists(); });
  updateSectorMarks();
}

/* --- sector block: verdicts sec + universe names (symbols is a LIST) --- */
function initSector(){
  Promise.all([
    fetch('/nepse-chart/data/verdicts.json').then(function(r){ return r.json(); }),
    fetch('/nepse-chart/data/universe.json').then(function(r){ return r.json(); })
  ]).then(function(res){
    var verdicts = res[0].verdicts || res[0], uni = res[1];
    var names = {}, secs = {}, counts = {};
    (uni.symbols || []).forEach(function(e){ names[e.s] = e.n; });
    Object.keys(verdicts).forEach(function(sym){
      var sec = (verdicts[sym] && verdicts[sym].sec) || 'Others';
      secs[sym] = sec; counts[sec] = (counts[sec] || 0) + 1;
    });
    var rows = Object.keys(names).map(function(sym){
      return { s: sym, n: names[sym], sec: secs[sym] || 'Others' };
    }).sort(function(a, b){ return a.s < b.s ? -1 : 1; });
    state.secRows = rows;
    state.sectorBatch = (res[0].asof || '');
    var sel = $('acSecSelect');
    Object.keys(counts).sort().forEach(function(sec){
      var o = document.createElement('option');
      o.value = sec; o.textContent = sec + ' (' + counts[sec] + ')';
      sel.appendChild(o);
    });
    renderSector();
  }).catch(function(){
    $('acSecBody').innerHTML = '<tr><td colspan="4" class="bk-loading">Sector data unavailable right now — the accumulation lists above still render.</td></tr>';
  });
}
function sectorFlow(sym){
  var inAcc = state.acc.some(function(r){ return r.symbol === sym; });
  var inDist = state.dist.some(function(r){ return r.symbol === sym; });
  if (inAcc && inDist) return { t: 'Both lists', c: 'flow-acc' };
  if (inAcc) return { t: 'Accumulating', c: 'flow-acc' };
  if (inDist) return { t: 'Distributing', c: 'flow-dist' };
  return { t: '—', c: 'flow-none' };
}
function renderSector(){
  var list = state.secFilter === 'All' ? state.secRows
    : state.secRows.filter(function(r){ return r.sec === state.secFilter; });
  var pages = Math.max(1, Math.ceil(list.length / PER));
  if (state.secPage > pages) state.secPage = pages;
  var slice = list.slice((state.secPage - 1) * PER, Math.min(state.secPage * PER, list.length));
  $('acSecBody').innerHTML = slice.map(function(r){
    var fl = sectorFlow(r.s);
    var inList = fl.t !== '—';
    return '<tr><td><a href="/stocks/' + BC.esc(r.s) + '/"><strong>' + BC.esc(r.s) + '</strong></a>' +
      (inList ? ' <span class="mk">●</span>' : '') + '</td>' +
      '<td>' + BC.esc(r.n) + '</td><td>' + BC.esc(r.sec) + '</td>' +
      '<td class="' + fl.c + '">' + BC.esc(fl.t) + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="bk-loading">No stocks in this sector.</td></tr>';
  var prev = $('acSecPrev'), next = $('acSecNext'), sum = $('acSecSum'), show = $('acSecShowing');
  if (prev) prev.disabled = state.secPage <= 1;
  if (next) next.disabled = state.secPage >= pages;
  if (sum) sum.textContent = list.length + ' stocks · batch ' + state.sectorBatch;
  if (show) show.textContent = list.length
    ? 'Showing ' + ((state.secPage - 1) * PER + 1) + '–' + Math.min(state.secPage * PER, list.length) + ' of ' + list.length
    : 'No stocks in this sector.';
}
function updateSectorMarks(){ renderSector(); }

function emptyWithGoto(msg){
  $('bkResult').innerHTML = '<div class="bk-empty">' + msg + '<br>' +
    '<button type="button" class="bk-goto primary" data-goto="1D">See the latest session (1D)</button> ' +
    '<button type="button" class="bk-goto" data-goto="retry">Retry</button></div>';
  document.querySelectorAll('.bk-goto').forEach(function(b){
    b.addEventListener('click', function(){
      var go = b.getAttribute('data-goto');
      if (go && go !== 'retry') {
        state.period = go;
        document.querySelectorAll('#bkPeriods button').forEach(function(x){
          x.classList.toggle('active', x.dataset.p === go);
        });
      }
      load();
    });
  });
}
function rangeProgress(pr){
  var el = $('bkResult');
  if (el) el.innerHTML = '<p class="bk-loading">Building range… ' +
    (pr.stage === 'daily' ? 'fetching daily files (' + pr.done + '/' + pr.total + ')' : 'loading period data (' + pr.done + '/' + pr.total + ')') + '</p>';
}
function loadData(){
  if (state.period === 'range') return BC.loadRange(state.rangeFrom, state.rangeTo, rangeProgress);
  return BC.loadPeriod(state.period);
}
function load(opts){
  var silent = opts && opts.silent;
  if (!silent) $('bkResult').innerHTML = '<p class="bk-loading">Loading…</p>';
  loadData().then(function(d){
    state.data = d; state.lastGood = d;
    state.acc = norm(d.accumulation); state.dist = norm(d.distribution);
    applySearch();
    var sig = signature(d);
    var changed = state.sig !== null && sig !== state.sig;
    state.sig = sig;
    if (silent && !changed) {
      /* Unchanged tick: freshness line only, DOM untouched. */
    } else {
      render();
    }
    setFresh(false); setBanner();
    var n = $('acNotice');
    if (silent && changed) {
      if (n) n.textContent = 'Accumulation data updated · ' + nptTime() + ' NPT';
    } else if (n) {
      n.textContent = '';
    }
  }).catch(function(e){
    /* Range errors keep the goto actions (Retry re-runs the range build)
       but carry the range's own honest message. */
    if (state.period === 'range'){
      emptyWithGoto((e && e.message) ? e.message : 'Range could not be built.');
      setFresh(true);
      return;
    }
    if (state.lastGood) { setFresh(true); setBanner(); }
    else {
      emptyWithGoto('Data not available for this period yet. Broker history is still building — try the latest session instead. This page also retries automatically every minute.');
      setFresh(true);
    }
  });
}
function tick(){
  /* Period files are immutable once published: only the freshness line
     moves on non-latest ticks. Latest re-fetches and re-renders on change. */
  if (state.period !== 'latest') { setFresh(false); return; }
  load({ silent: true });
}

$('bkPeriods').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b || !b.dataset.p) return; /* Apply carries no data-p */
  document.querySelectorAll('#bkPeriods button').forEach(function(x){ x.classList.remove('active'); });
  b.classList.add('active'); state.period = b.dataset.p;
  if (b.dataset.p === 'range'){
    if (state.rangeFrom && state.rangeTo) load();
    else $('bkResult').innerHTML = '<div class="bk-empty">Pick a from and to date, then Apply.</div>';
    return;
  }
  /* Period change is a VIEW change that loads fresh data: load() sets the
     signature from the fetched payload, so the next silent tick compares
     correctly. The signature is never nulled here — nulling it (the old
     trade-pattern bug) made the next tick take the "unchanged" branch
     unconditionally and swallow real changes. */
  load();
});
var bkRangeApply = $('bkRangeApply');
if (bkRangeApply) bkRangeApply.addEventListener('click', function(){
  var f = $('bkRangeFrom').value, t = $('bkRangeTo').value;
  document.querySelectorAll('#bkPeriods button').forEach(function(x){ x.classList.toggle('active', x.dataset.p === 'range'); });
  state.period = 'range'; state.sig = null;
  if (!f || !t){ $('bkResult').innerHTML = '<div class="bk-empty">Pick a from and to date, then Apply.</div>'; return; }
  state.rangeFrom = f; state.rangeTo = t; load();
});

var searchEl = $('bkStockSearch');
if (searchEl) searchEl.addEventListener('input', function(){
  state.q = searchEl.value.trim().toLowerCase();
  /* Search is view-only: it filters the current order without touching
     the change signature, so the next tick still detects data changes. */
  applySearch(); renderLists();
});
var secSel = $('acSecSelect');
if (secSel) secSel.addEventListener('change', function(){ state.secFilter = secSel.value; state.secPage = 1; renderSector(); });
var secPrev = $('acSecPrev'), secNext = $('acSecNext');
if (secPrev) secPrev.addEventListener('click', function(){ if (state.secPage > 1) { state.secPage--; renderSector(); } });
if (secNext) secNext.addEventListener('click', function(){ state.secPage++; renderSector(); });

Promise.all([BC.loadMeta(), BC.loadBrokers()]).then(function(res){
  var bro = res[1];
  if (Array.isArray(bro)) {
    bro.forEach(function(e){ if (e && e.code) state.brokers[String(e.code)] = e.name || e.n || ('Broker ' + e.code); });
  } else {
    state.brokers = bro || {};
  }
  initSector();
  load();
}).catch(function(){
  /* Boot failure (meta/brokers unreachable): honest empty state with the
     same goto actions, instead of the old page's silent "Loading…" hang. */
  emptyWithGoto('Broker data could not be loaded. Check your connection and retry — this page also retries automatically every minute.');
  setFresh(true);
});
setInterval(function(){ if (!document.hidden) tick(); }, 60000);
})();
