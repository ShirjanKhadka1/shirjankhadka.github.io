/* Broker Trade Pattern — page logic (trade-pattern teardown, 2026-10-26).
   Extracted from the old inline script, plus: change-gated 60s refresh,
   freshness line with provisional/final/fallback states, buy/sell viz,
   25/page pager on the per-stock table, and the sector block.
   The page reads our own DB (period files + provisional), never proxies.
   Provisional data is symbol-only, so broker views always render the last
   final 1D data when latest resolves through provisional — never
   fabricated broker splits, never provisional presented as final. */
(function(){
"use strict";
var BC = window.BrokerCommon;
var $ = function(id){ return document.getElementById(id); };
var PER = 25;
var state = { period: 'latest', brokers: {}, data: null, broker: null,
  sig: null, lastGood: null, page: 1, rows: [], sectorRows: [], secFilter: 'All', secPage: 1, rangeFrom: null, rangeTo: null };

function nptTime(){
  try {
    return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) { return ''; }
}
function bname(code){ return state.brokers[code] || ('Broker ' + code); }
function periodDate(d){ return (d && (d.to || d.from)) || ''; }

/* Freshness state for the loaded payload. */
function freshState(d){
  if (!d) return { kind: 'fail', text: 'No data loaded yet' };
  if (state.period !== 'latest') {
    return { kind: 'final', text: 'Final · ' + (d.from || '?') + ' → ' + (d.to || '?') +
      (d.trading_days ? ' (' + d.trading_days + ' sessions)' : '') };
  }
  if (d._provState === 'symbol-only') {
    var asof = d._provAsOf ? ' (as of ' + d._provAsOf.slice(11, 16) + ' NPT)' : '';
    return { kind: 'prov', text: 'last final ' + periodDate(d) };
  }
  if (d._fallback) {
    return { kind: 'fallback', text: 'Live feed unavailable · last final ' + periodDate(d) };
  }
  return { kind: 'live', text: 'Live · ' + periodDate(d) };
}
function setFresh(failed){
  var el = $('tpFresh'); if (!el) return;
  var st = failed ? { kind: 'fail', text: 'Refresh failed — showing last good data' }
                  : freshState(state.lastGood);
  var dot = failed ? 'fail' : '';
  el.innerHTML = '<span class="tp-dot ' + dot + '"></span>Checked ' + nptTime() +
    ' NPT · next check in 60 seconds · ' + BC.esc(st.text);
}
function setBanner(){
  var el = $('tpBanner'); if (!el) return;
  var d = state.lastGood;
  if (state.period === 'latest' && d && d._provState === 'symbol-only') {
    el.className = 'tp-banner';
    el.textContent = 'Live broker splits aren\u2019t available yet — intraday data is symbol-only today, so this view shows the last final session (' + periodDate(d) + '). Broker splits publish after close.';
    el.style.display = '';
  } else if (state.period === 'latest' && d && d._fallback) {
    el.className = 'tp-banner fail';
    el.textContent = 'Live feed unavailable — showing the last final session (' + periodDate(d) + ').';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}
function signature(d){
  if (!d || !state.broker) return state.period + '|none';
  var t = (d.brokers || []).filter(function(b){ return b.code === state.broker; })[0] || {};
  var syms = (d.broker_symbols && d.broker_symbols[state.broker]) || [];
  return [state.period, state.broker, t.buy_value || 0, t.sell_value || 0,
    d.to || '', d._provState || '', d._provAsOf || '',
    syms.map(function(s){ return s.symbol + ':' + (s.buy_value || 0) + ':' + (s.sell_value || 0); }).join(',')].join('|');
}

function renderTable(){
  var body = $('bkBody'); if (!body) return;
  var rows = state.rows, pages = Math.max(1, Math.ceil(rows.length / PER));
  if (state.page > pages) state.page = pages;
  var slice = rows.slice((state.page - 1) * PER, state.page * PER);
  body.innerHTML = slice.map(function(r){
    return '<tr><td><a href="/stocks/' + BC.esc(r.symbol) + '/"><strong>' + BC.esc(r.symbol) + '</strong></a></td>' +
      '<td>' + BC.fmtV(r.buyVal) + '</td><td>' + BC.fmtV(r.sellVal) + '</td>' +
      '<td class="' + BC.cls(r.net) + '">' + BC.fmtV(r.net) + '</td>' +
      '<td>' + BC.fmtQ(r.buyQty, r.buyVal) + '</td><td>' + BC.fmtQ(r.sellQty, r.sellVal) + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="bk-loading">No trades in this period.</td></tr>';
  var prev = $('tpPrev'), next = $('tpNext'), show = $('tpShowing');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
  if (show) show.textContent = rows.length
    ? 'Showing ' + ((state.page - 1) * PER + 1) + '–' + Math.min(state.page * PER, rows.length) + ' of ' + rows.length
    : 'No trades in this period.';
}

function renderViz(code, t, rows){
  var buy = t.buy_value || 0, sell = t.sell_value || 0, tot = buy + sell;
  var splitHtml;
  if (tot > 0) {
    var bp = Math.round(buy / tot * 100);
    splitHtml = '<div class="tp-split" role="img" aria-label="Buy ' + bp + ' percent, sell ' + (100 - bp) + ' percent">' +
      '<i class="buy" style="width:' + bp + '%"></i><i class="sell" style="width:' + (100 - bp) + '%"></i></div>' +
      '<div class="tp-legend"><span><i class="sw" style="background:var(--nd-up)"></i>Buy ' + BC.fmtV(buy) + '</span>' +
      '<span><i class="sw" style="background:var(--nd-down)"></i>Sell ' + BC.fmtV(sell) + '</span></div>';
  } else {
    splitHtml = '<p class="tp-cap">No buy/sell value in this period.</p>';
  }
  var top = rows.slice().sort(function(a, b){ return Math.abs(b.net) - Math.abs(a.net); }).slice(0, 10);
  var max = top.length ? Math.max.apply(null, top.map(function(r){ return Math.abs(r.net); })) : 0;
  var rankHtml = top.length ? top.map(function(r){
    var w = max ? Math.round(Math.abs(r.net) / max * 100) : 0;
    var cls = r.net > 0 ? 'up' : (r.net < 0 ? 'down' : '');
    return '<div class="tp-rank"><span class="lb">' + BC.esc(r.symbol) + '</span>' +
      '<span class="tr"><i class="' + cls + '" style="width:' + w + '%"></i></span>' +
      '<span class="vl ' + cls + '">' + (r.net > 0 ? '+' : '') + BC.fmtV(r.net) + '</span></div>';
  }).join('') : '<p class="tp-cap">No stocks traded in this period.</p>';
  return '<div class="tp-viz">' +
    '<div class="tp-viz-card"><h3>Buy / sell split</h3>' +
    '<p class="tp-cap">Share of this broker\u2019s traded value in the period. Measured flow, not a forecast.</p>' +
    splitHtml + '</div>' +
    '<div class="tp-viz-card"><h3>Largest net moves by stock</h3>' +
    '<p class="tp-cap">Top 10 stocks by absolute net value for this broker. Measured flow, not a forecast.</p>' +
    rankHtml + '</div></div>';
}

function render(){
  var d = state.data, code = state.broker;
  if (!d || !code) return;
  var syms = (d.broker_symbols && d.broker_symbols[code]) || [];
  var t = (d.brokers || []).filter(function(b){ return b.code === code; })[0] || {};
  var net = (t.buy_value || 0) - (t.sell_value || 0);
  var sub = state.period === 'latest'
    ? (d && d.provisional === true && d.symbol_only === false ? 'provisional session (' + periodDate(d) + ')' : 'last final session (' + periodDate(d) + ')')
    : (d.from || '?') + ' → ' + (d.to || '?');
  state.rows = syms.map(function(s){
    return { symbol: s.symbol, buyQty: s.buy_qty || 0, buyVal: s.buy_value || 0,
      sellQty: s.sell_qty || 0, sellVal: s.sell_value || 0, net: (s.buy_value || 0) - (s.sell_value || 0) };
  });
  state.page = 1;
  var html = '<div class="bk-tiles">' +
    '<div class="bk-tile"><div class="k">Buy value</div><div class="v">' + BC.fmtV(t.buy_value || 0) + '</div></div>' +
    '<div class="bk-tile"><div class="k">Sell value</div><div class="v">' + BC.fmtV(t.sell_value || 0) + '</div></div>' +
    '<div class="bk-tile"><div class="k">Net value</div><div class="v ' + BC.cls(net) + '">' + BC.fmtV(net) + '</div></div>' +
    '<div class="bk-tile"><div class="k">Stocks traded</div><div class="v">' + syms.length + '</div><div class="s">' + BC.esc(sub) + '</div></div></div>';
  html += renderViz(code, t, state.rows);
  html += '<h2 class="bk-h2">' + BC.esc(bname(code)) + ' — per-stock pattern</h2>';
  html += '<div class="bk-scroll"><table class="bk-table nd-table" id="bkTable"><thead><tr>' +
    '<th data-sort="symbol">Symbol</th><th data-sort="buyVal">Buy value</th><th data-sort="sellVal">Sell value</th>' +
    '<th data-sort="net">Net value</th><th data-sort="buyQty">Buy qty</th><th data-sort="sellQty">Sell qty</th>' +
    '</tr></thead><tbody id="bkBody"></tbody></table></div>';
  html += '<div class="tp-pager"><button type="button" id="tpPrev">Prev</button>' +
    '<span class="tp-showing" id="tpShowing"></span>' +
    '<button type="button" class="tp-next" id="tpNext">Next</button></div>';
  $('bkResult').innerHTML = html;
  renderTable();
  BC.makeSortable($('bkTable'), function(){ return state.rows; }, function(rs){
    state.rows = rs; state.page = 1; renderTable();
  });
  var prev = $('tpPrev'), next = $('tpNext');
  if (prev) prev.addEventListener('click', function(){ if (state.page > 1) { state.page--; renderTable(); } });
  if (next) next.addEventListener('click', function(){ var pages = Math.max(1, Math.ceil(state.rows.length / PER)); if (state.page < pages) { state.page++; renderTable(); } });
  updateSectorMarks();
}

/* Sector block: verdicts sec + universe names (symbols is a LIST, not a dict). */
function initSector(){
  var sel = $('tpSecSelect'); if (!sel) return;
  Promise.all([
    fetch('/nepse-chart/data/verdicts.json').then(function(r){ return r.json(); }),
    fetch('/nepse-chart/data/universe.json').then(function(r){ return r.json(); })
  ]).then(function(res){
    var vd = res[0].verdicts || {}, uni = res[1].symbols || [];
    var secOf = {};
    Object.keys(vd).forEach(function(k){ secOf[k] = vd[k].sec || 'Others'; });
    state.sectorRows = uni.map(function(u){
      return { s: u.s, n: u.n || u.s, sec: secOf[u.s] || 'Others' };
    }).sort(function(a, b){ return a.s < b.s ? -1 : 1; });
    var counts = {};
    state.sectorRows.forEach(function(r){ counts[r.sec] = (counts[r.sec] || 0) + 1; });
    var opts = ['<option value="All">All sectors (' + state.sectorRows.length + ')</option>'];
    Object.keys(counts).sort().forEach(function(sec){
      opts.push('<option value="' + BC.esc(sec) + '">' + BC.esc(sec) + ' (' + counts[sec] + ')</option>');
    });
    sel.innerHTML = opts.join('');
    renderSector();
  }).catch(function(){
    var sum = $('tpSecSum'); if (sum) sum.textContent = 'Sector list unavailable right now.';
  });
}
function renderSector(){
  var body = $('tpSecBody'); if (!body) return;
  var list = state.secFilter === 'All' ? state.sectorRows
    : state.sectorRows.filter(function(r){ return r.sec === state.secFilter; });
  var pages = Math.max(1, Math.ceil(list.length / PER));
  if (state.secPage > pages) state.secPage = pages;
  var slice = list.slice((state.secPage - 1) * PER, state.secPage * PER);
  var traded = tradedSet();
  body.innerHTML = slice.map(function(r){
    var mk = traded.has(r.s) ? ' <span class="mk" title="Traded by the selected broker in this period">●</span>' : '';
    return '<tr><td><a href="/stocks/' + BC.esc(r.s) + '/">' + BC.esc(r.s) + '</a>' + mk + '</td>' +
      '<td>' + BC.esc(r.n) + '</td><td>' + BC.esc(r.sec) + '</td></tr>';
  }).join('');
  var sum = $('tpSecSum');
  if (sum) sum.textContent = list.length + ' stocks · batch ' + (state.sectorBatch || '');
  var show = $('tpSecShowing');
  if (show) show.textContent = list.length
    ? 'Showing ' + ((state.secPage - 1) * PER + 1) + '–' + Math.min(state.secPage * PER, list.length) + ' of ' + list.length
    : 'No stocks in this sector';
  var prev = $('tpSecPrev'), next = $('tpSecNext');
  if (prev) prev.disabled = state.secPage <= 1;
  if (next) next.disabled = state.secPage >= pages;
}
function tradedSet(){
  var set = {};
  if (!state.broker || !state.data) return { has: function(){ return false; } };
  var syms = (state.data.broker_symbols && state.data.broker_symbols[state.broker]) || [];
  syms.forEach(function(s){ set[s.symbol] = true; });
  return { has: function(sym){ return !!set[sym]; } };
}
function updateSectorMarks(){ renderSector(); }

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
    var sig = signature(d);
    var changed = state.sig !== null && sig !== state.sig;
    state.sig = sig;
    if (silent && !changed) {
      /* Unchanged tick: freshness line only, DOM untouched. */
    } else if (state.broker) { render(); }
    else $('bkResult').innerHTML = '<div class="bk-empty">Pick a broker above to see its trade pattern.</div>';
    setFresh(false); setBanner();
    var n = $('tpNotice');
    if (silent && changed) {
      if (n) n.textContent = 'Broker data updated · ' + nptTime() + ' NPT';
    } else if (n) {
      n.textContent = '';
    }
  }).catch(function(e){
    /* Range errors replace the view with their honest message — never
       leave a stale period on screen behind a "refresh failed" line. */
    if (state.period === 'range'){
      $('bkResult').innerHTML = '<div class="bk-empty">' + BC.esc((e && e.message) ? e.message : 'Range could not be built.') + '</div>';
      setFresh(true); setBanner();
      return;
    }
    if (state.lastGood) { setFresh(true); setBanner(); }
    else {
      $('bkResult').innerHTML = '<div class="bk-empty">Data not available for this period yet.</div>';
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

$('brokerSel').addEventListener('change', function(){
  state.broker = this.value || null;
  if (state.broker && state.data) {
    render();
    /* Selection is a VIEW change, not a data change: re-baseline the
       signature here. Nulling it (the original bug, caught by the
       stock-pattern teardown's re-check 2026-10-26) made the next silent
       tick take the "unchanged" branch unconditionally, so a real data
       change arriving in the first tick window after a selection was
       never displayed. */
    state.sig = signature(state.data);
    setFresh(false); setBanner();
  }
  else if (!state.broker) { state.sig = null; $('bkResult').innerHTML = '<div class="bk-empty">Pick a broker above to see its trade pattern.</div>'; }
});
$('bkPeriods').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b || !b.dataset.p) return; /* Apply carries no data-p */;
  document.querySelectorAll('#bkPeriods button').forEach(function(x){ x.classList.remove('active'); });
  b.classList.add('active'); state.period = b.dataset.p; state.sig = null;
  if (b.dataset.p === 'range'){
    /* Range needs dates + Apply: re-show a previously applied range if
       one exists, else prompt for dates instead of loading blindly. */
    if (state.rangeFrom && state.rangeTo) load();
    else $('bkResult').innerHTML = '<div class="bk-empty">Pick a from and to date, then Apply.</div>';
    return;
  }
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

var secSel = $('tpSecSelect');
if (secSel) secSel.addEventListener('change', function(){ state.secFilter = secSel.value; state.secPage = 1; renderSector(); });
var secPrev = $('tpSecPrev'), secNext = $('tpSecNext');
if (secPrev) secPrev.addEventListener('click', function(){ if (state.secPage > 1) { state.secPage--; renderSector(); } });
if (secNext) secNext.addEventListener('click', function(){
  var list = state.secFilter === 'All' ? state.sectorRows : state.sectorRows.filter(function(r){ return r.sec === state.secFilter; });
  var pages = Math.max(1, Math.ceil(list.length / PER));
  if (state.secPage < pages) { state.secPage++; renderSector(); }
});

Promise.all([BC.loadMeta(), BC.loadBrokers()]).then(function(res){
  state.brokers = res[1];
  var sel = $('brokerSel');
  Object.keys(state.brokers).filter(function(c){ return /^\d+$/.test(c); }).sort(function(a, b){ return a - b; }).forEach(function(c){
    var o = document.createElement('option'); o.value = c; o.textContent = c + ' — ' + state.brokers[c]; sel.appendChild(o);
  });
  /* Sector counts come from the verdict batch; keep its date visible. */
  fetch('/nepse-chart/data/verdicts.json').then(function(r){ return r.json(); }).then(function(v){
    state.sectorBatch = v.asof || '';
    var sum = $('tpSecSum'); if (sum && state.sectorRows.length) sum.textContent = state.sectorRows.length + ' stocks · batch ' + state.sectorBatch;
  }).catch(function(){});
  initSector();
  load();
}).catch(function(){
  $('bkResult').innerHTML = '<div class="bk-empty">Broker data could not be loaded. Please retry.</div>';
  setFresh(true);
});
setInterval(tick, 60000);
})();
