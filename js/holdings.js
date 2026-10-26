/* Stockwise Holdings — page logic (holdings teardown, 2026-10-26).
   Extracted from the old inline script, plus: CORRECTED traded totals
   (period-file s.value/s.qty are double-counted — see derive()), change-gated
   60s refresh, freshness line with provisional/final/fallback states, net
   viz + accum/dist mix, a full paginated broker net-positions table, and
   the sector block. The page reads our own DB (period files + provisional),
   never proxies.
   HOLDINGS MEANING (stated on the page, never softened): a broker's "net
   position" here is measured transaction flow over the selected period —
   total bought minus total sold, from the period's broker net-flow records.
   It is NOT verified shareholding and NOT beneficial ownership: clients
   trade through a broker, so a net position does not mean the broker owns
   those shares. Never present it as ownership, never forecast from it.
   PROVISIONAL DESIGN (decided from the data, not assumed): the provisional
   file carries per-symbol {trades, qty, amount} totals but NO broker splits.
   So for a selected stock, latest shows those totals labeled PROVISIONAL
   while broker net positions always come from the last final session —
   never provisional presented as final, never fabricated broker splits.
   NETFLOW AUTHORITY (proven in the verifier): per-broker netflow is the
   authoritative broker aggregation — it matches broker_symbols inverted
   exactly and balances (buy == sell) on every symbol. The per-symbol
   buyers/sellers dicts are INCOMPLETE (ADBL: 25 buyer brokers vs 56 netflow
   brokers), so they are only a fallback when netflow is absent — which no
   sampled period exhibits. Tile totals never come from netflow sums:
   netflow undercounts s.value/2 on 12/341 1D symbols (total gap
   Rs 6,386,933), so tiles use the corrected s.value/2 and s.qty/2. */
(function(){
"use strict";
var BC = window.BrokerCommon;
var $ = function(id){ return document.getElementById(id); };
var PER = 25;
var PERIODS = ['latest', '1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y'];
var state = { period: 'latest', brokers: {}, names: {}, data: null, prov: null,
  symbol: null, allSyms: [], sig: null, lastGood: null,
  rows: [], page: 1,
  sectorRows: [], secFilter: 'All', secPage: 1, sectorBatch: '' };

function nptTime(){
  try {
    return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) { return ''; }
}
function bname(code){ return state.brokers[code] || ('Broker ' + code); }
function periodDate(d){ return (d && (d.to || d.from)) || ''; }
function provTime(p){
  if (!p || !p.asof) return '';
  return String(p.asof).slice(11, 16) || '';
}

/* --- symbol record: CORRECTED traded totals + authoritative netflow ---
   PROVEN DATA BUG (2026-10-26, verified against official turnover): the
   period files' per-symbol `value`/`qty` fields are DOUBLE-COUNTED (buy
   side + sell side summed). Proof: sum of s.value over 1D = Rs
   8,004,842,336.14 = exactly 2.0000x the official 2026-10-26 turnover
   Rs 4,002,421,168.07, while sum of s.value/2 and sum of broker buy_value
   both equal official exactly. The OLD holdings page never showed these
   totals, but any tile that did would show 2x: ADBL Rs 5.59 Cr / 167,488
   shown; true Rs 2.80 Cr / 83,744 shares. This rebuild CORRECTS that:
   traded value = s.value/2, traded qty = s.qty/2. Avg rate is unaffected
   (the ratio is identical either way). */
function derive(sym){
  if (!sym) return null;
  var qty, value;
  if (sym.qty != null && sym.value != null){
    qty = sym.qty / 2; value = sym.value / 2;
  } else if (sym.netflow && Object.keys(sym.netflow).length){
    qty = 0; value = 0;
    Object.keys(sym.netflow).forEach(function(c){
      var v = sym.netflow[c] || [];
      qty += (v[2] || 0); value += (v[3] || 0);
    });
  } else {
    qty = 0; value = 0;
  }
  var avg = qty ? value / qty : (sym.avg_rate || 0);
  var fromFallback = false, nf = sym.netflow || {};
  if (!nf || !Object.keys(nf).length){
    /* Fallback only: derive net positions from the buyer/seller lists.
       Proven incomplete (ADBL: 25 brokers vs 56 in netflow), so this path
       understates — it exists so a netflow-less record still renders. */
    fromFallback = true;
    nf = {};
    Object.keys(sym.buyers || {}).forEach(function(c){
      var v = sym.buyers[c] || [];
      var e = nf[c] = nf[c] || [0, 0, 0, 0, 0, 0];
      e[2] += (v[0] || 0); e[3] += (v[1] || 0); e[0] += (v[0] || 0); e[1] += (v[1] || 0);
    });
    Object.keys(sym.sellers || {}).forEach(function(c){
      var v = sym.sellers[c] || [];
      var e = nf[c] = nf[c] || [0, 0, 0, 0, 0, 0];
      e[4] += (v[0] || 0); e[5] += (v[1] || 0); e[0] -= (v[0] || 0); e[1] -= (v[1] || 0);
    });
  }
  return { qty: qty || 0, value: value || 0, avg: avg || 0,
    netflow: nf, fromFallback: fromFallback };
}
function netRows(nf){
  return Object.keys(nf).map(function(c){
    var v = nf[c] || [];
    return { code: c, name: bname(c), netQty: v[0] || 0, netVal: v[1] || 0,
      buyQty: v[2] || 0, buyVal: v[3] || 0, sellQty: v[4] || 0, sellVal: v[5] || 0 };
  }).sort(function(a, b){ return Math.abs(b.netVal) - Math.abs(a.netVal); });
}

/* --- freshness + banner --- */
function freshState(d){
  if (!d) return { kind: 'fail', text: 'No data loaded yet' };
  if (state.period !== 'latest') {
    return { kind: 'final', text: 'Final · ' + (d.from || '?') + ' → ' + (d.to || '?') +
      (d.trading_days ? ' (' + d.trading_days + ' sessions)' : '') };
  }
  var prov = usableProv(d);
  if (prov) {
    return { kind: 'prov', text: 'Provisional (as of ' + provTime(state.prov) + ' NPT) → last final ' + periodDate(d) };
  }
  if (d._fallback) {
    return { kind: 'fallback', text: 'Live feed unavailable · last final ' + periodDate(d) };
  }
  return { kind: 'live', text: 'Live · ' + periodDate(d) };
}
function usableProv(d){
  /* Provisional strip only when the provisional file is from the final
     session or newer. Older provisional data is stale and ignored. */
  if (!state.prov || !state.prov.symbols || !state.symbol) return null;
  var rec = state.prov.symbols[state.symbol];
  if (!rec) return null;
  var pd = state.prov.date || '';
  var fd = periodDate(d);
  if (pd && fd && pd < fd) return null;
  return rec;
}
function setFresh(failed){
  var el = $('hdFresh'); if (!el) return;
  var st = failed ? { kind: 'fail', text: 'Refresh failed — showing last good data' }
                  : freshState(state.lastGood);
  el.innerHTML = '<span class="hd-dot ' + (failed ? 'fail' : '') + '"></span>Checked ' + nptTime() +
    ' NPT · next check in 60 seconds · ' + BC.esc(st.text);
}
function setBanner(){
  var el = $('hdBanner'); if (!el) return;
  var d = state.lastGood;
  if (state.period === 'latest' && d && usableProv(d)) {
    var pd = state.prov.date || '', fd = periodDate(d);
    el.className = 'hd-banner prov';
    el.textContent = pd === fd
      ? 'Provisional totals above are today\u2019s pre-close snapshot (as of ' + provTime(state.prov) + ' NPT). Broker splits publish after close, so the broker net positions below show the last final session (' + fd + ').'
      : 'Live totals above are today\u2019s provisional snapshot (as of ' + provTime(state.prov) + ' NPT). The broker net positions below are the last final session (' + fd + ').';
    el.style.display = '';
  } else if (state.period === 'latest' && d && d._fallback) {
    el.className = 'hd-banner fail';
    el.textContent = 'Live feed unavailable — showing the last final session (' + periodDate(d) + ').';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}
function signature(d){
  if (!d || !state.symbol) return state.period + '|none';
  var rec = (d.symbols || {})[state.symbol] || null;
  var prec = (state.prov && state.prov.symbols && state.prov.symbols[state.symbol]) || null;
  return [state.period, state.symbol, d.to || '', JSON.stringify(rec),
    (state.prov && state.prov.asof) || '', JSON.stringify(prec)].join('|');
}

/* --- symbol select (labels + search across symbol AND name) --- */
function fillSymbols(){
  var d = state.data, sel = $('symSel');
  if (!d || !sel) return;
  state.allSyms = Object.keys(d.symbols || {}).sort();
  applySymbolFilter();
  if (state.symbol && state.allSyms.indexOf(state.symbol) >= 0) sel.value = state.symbol;
  else if (state.symbol) { state.symbol = null; }
}
function applySymbolFilter(){
  var sel = $('symSel'); if (!sel) return;
  var q = ($('symSearch').value || '').trim().toUpperCase();
  var opts = ['<option value="">Select stock…</option>'];
  state.allSyms.forEach(function(s){
    var label = s + (state.names[s] ? ' — ' + state.names[s] : '');
    if (q && s.indexOf(q) < 0 && label.toUpperCase().indexOf(q) < 0) return;
    opts.push('<option value="' + BC.esc(s) + '">' + BC.esc(label) + '</option>');
  });
  sel.innerHTML = opts.join('');
  if (state.symbol && state.allSyms.indexOf(state.symbol) >= 0) sel.value = state.symbol;
}

/* --- viz: top net bars + accum/dist mix --- */
function renderViz(rows){
  var top = rows.slice(0, 10);
  var max = top.length ? Math.max.apply(null, top.map(function(r){ return Math.abs(r.netVal); })) : 0;
  var rankHtml = top.length ? top.map(function(r){
    var w = max ? Math.round(Math.abs(r.netVal) / max * 100) : 0;
    var barCls = r.netVal > 0 ? 'up' : (r.netVal < 0 ? 'down' : '');
    return '<div class="hd-rank"><span class="lb">' + BC.esc(r.code) + ' · ' + BC.esc(r.name) + '</span>' +
      '<span class="tr"><i data-dir="' + barCls + '" style="width:' + w + '%"></i></span>' +
      '<span class="vl" data-dir="' + barCls + '">' + (r.netVal > 0 ? '+' : '') + BC.fmtV(r.netVal) + '</span></div>';
  }).join('') : '<p class="hd-cap">No net flow in this period.</p>';
  var acc = rows.filter(function(r){ return r.netVal > 0; });
  var dist = rows.filter(function(r){ return r.netVal < 0; });
  var flat = rows.filter(function(r){ return r.netVal === 0; });
  var accVal = acc.reduce(function(a, r){ return a + r.netVal; }, 0);
  var distVal = dist.reduce(function(a, r){ return a + r.netVal; }, 0);
  var mixHtml = '<div class="hd-mix-row"><span class="mk up">▲ ' + acc.length + ' accumulating</span>' +
    '<span class="vl">' + BC.fmtV(accVal) + '</span></div>' +
    '<div class="hd-mix-row"><span class="mk down">▼ ' + dist.length + ' distributing</span>' +
    '<span class="vl">' + BC.fmtV(distVal) + '</span></div>' +
    '<div class="hd-mix-row"><span class="mk">■ ' + flat.length + ' flat</span>' +
    '<span class="vl">Rs 0</span></div>' +
    '<p class="hd-cap">Nets balance by construction: total buys equal total sells for the stock, so accumulating and distributing totals are equal in magnitude. Measured flow, not a forecast.</p>';
  return '<div class="hd-viz">' +
    '<div class="hd-viz-card"><h3>Largest net moves by broker</h3>' +
    '<p class="hd-cap">Top 10 brokers by absolute net value for this stock. Measured flow, not a forecast.</p>' +
    rankHtml + '</div>' +
    '<div class="hd-viz-card"><h3>Accumulating vs distributing</h3>' +
    '<p class="hd-cap">Every broker with a net position in this stock, grouped by the sign of its net value.</p>' +
    mixHtml + '</div></div>';
}

/* --- paginated holdings table --- */
function renderTable(){
  var body = $('hdBody'); if (!body) return;
  var rows = state.rows;
  var pages = Math.max(1, Math.ceil(rows.length / PER));
  if (state.page > pages) state.page = pages;
  var slice = rows.slice((state.page - 1) * PER, state.page * PER);
  body.innerHTML = slice.map(function(r){
    var flow = r.netVal > 0 ? '<span class="pos">accumulating</span>'
      : (r.netVal < 0 ? '<span class="neg">distributing</span>' : '<span class="flat">flat</span>');
    return '<tr><td><strong>' + BC.esc(r.name) + '</strong> <span style="color:var(--nd-dim)">' + BC.esc(r.code) + '</span></td>' +
      '<td>' + BC.fmtV(r.buyVal) + '</td><td>' + BC.fmtV(r.sellVal) + '</td>' +
      '<td class="' + BC.cls(r.netVal) + '">' + BC.fmtV(r.netVal) + '</td>' +
      '<td>' + BC.fmtQ(r.netQty, Math.abs(r.netVal)) + '</td><td>' + flow + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="bk-loading">No trades in this period.</td></tr>';
  var prev = $('hdPrev'), next = $('hdNext'), show = $('hdShowing');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
  if (show) show.textContent = rows.length
    ? 'Showing ' + ((state.page - 1) * PER + 1) + '–' + Math.min(state.page * PER, rows.length) + ' of ' + rows.length
    : 'No trades in this period.';
}

function render(){
  var d = state.data, sym = state.symbol;
  if (!d || !sym) return;
  var rec = (d.symbols || {})[sym];
  if (!rec){
    $('bkResult').innerHTML = '<div class="bk-empty">No trades for ' + BC.esc(sym) + ' in this period.</div>';
    return;
  }
  var dv = derive(rec);
  state.rows = netRows(dv.netflow);
  state.page = 1;
  /* Period tile, de-duplicated: BC.label('latest', d) returns
     "last session (last session)" when the period file carries no asof
     field, so latest gets its own one-line form. */
  var periodText = state.period === 'latest' ? 'Last final session (' + periodDate(d) + ')'
    : BC.label(state.period, d);
  var html = '<div class="bk-tiles">' +
    '<div class="bk-tile"><div class="k">Traded value</div><div class="v">' + BC.fmtV(dv.value) + '</div>' +
    '<div class="s">Corrected total (period value ÷ 2)</div></div>' +
    '<div class="bk-tile"><div class="k">Traded quantity</div><div class="v">' + BC.fmtN(dv.qty, 0) + '</div>' +
    '<div class="s">Shares (period qty ÷ 2)</div></div>' +
    '<div class="bk-tile"><div class="k">Avg rate</div><div class="v">Rs ' + BC.fmtN(dv.avg) + '</div>' +
    '<div class="s">Value ÷ quantity</div></div>' +
    '<div class="bk-tile"><div class="k">Brokers</div><div class="v">' + BC.fmtN(state.rows.length, 0) + '</div>' +
    '<div class="s">' + BC.esc(periodText) + '</div></div></div>';
  var prec = usableProv(d);
  if (prec) {
    var pavg = prec.qty ? prec.amount / prec.qty : 0;
    html += '<div class="hd-prov"><p class="hd-prov-head">Provisional — ' + BC.esc(state.symbol) + ' (as of ' + BC.esc(provTime(state.prov)) + ' NPT, not final)</p>' +
      '<div class="bk-tiles">' +
      '<div class="bk-tile"><div class="k">Provisional value</div><div class="v">' + BC.fmtV(prec.amount) + '</div></div>' +
      '<div class="bk-tile"><div class="k">Provisional quantity</div><div class="v">' + BC.fmtN(prec.qty, 0) + '</div></div>' +
      '<div class="bk-tile"><div class="k">Provisional avg rate</div><div class="v">Rs ' + BC.fmtN(pavg) + '</div></div>' +
      '<div class="bk-tile"><div class="k">Provisional trades</div><div class="v">' + BC.fmtN(prec.trades, 0) + '</div></div></div></div>';
  }
  if (dv.fromFallback) {
    html += '<p class="hd-note">Broker detail below is derived from the buyer/seller lists because this record carries no netflow — those lists are incomplete, so the detail understates the full flow.</p>';
  }
  html += '<h2 class="bk-h2">' + BC.esc(sym) + (state.names[sym] ? ' — ' + BC.esc(state.names[sym]) : '') + ' — broker net positions</h2>';
  html += renderViz(state.rows);
  html += '<div class="bk-scroll"><table class="bk-table" id="hdTable"><thead><tr>' +
    '<th data-sort="name">Broker</th><th data-sort="buyVal">Buy value</th><th data-sort="sellVal">Sell value</th>' +
    '<th data-sort="netVal">Net value</th><th data-sort="netQty">Net qty</th><th>Flow</th>' +
    '</tr></thead><tbody id="hdBody"></tbody></table></div>' +
    '<div class="hd-pager"><button type="button" id="hdPrev">Prev</button>' +
    '<span class="hd-showing" id="hdShowing"></span>' +
    '<button type="button" class="hd-next" id="hdNext">Next</button></div>';
  $('bkResult').innerHTML = html;
  window.__hdTile = document.querySelector('.bk-tile') || null;
  renderTable();
  BC.makeSortable($('hdTable'), function(){ return state.rows; }, function(rs){ state.rows = rs; state.page = 1; renderTable(); });
  updateSectorMarks();
}

/* --- sector block: verdicts sec + universe names (symbols is a LIST) --- */
function initSector(){
  Promise.all([
    fetch('/nepse-chart/data/verdicts.json').then(function(r){ return r.json(); }),
    fetch('/nepse-chart/data/universe.json').then(function(r){ return r.json(); })
  ]).then(function(res){
    var vd = res[0].verdicts || {}, uni = res[1].symbols || [];
    var secOf = {};
    Object.keys(vd).forEach(function(k){ secOf[k] = vd[k].sec || 'Others'; });
    state.sectorBatch = res[0].asof || '';
    state.names = {};
    uni.forEach(function(u){ state.names[u.s] = u.n || u.s; });
    state.sectorRows = uni.map(function(u){
      return { s: u.s, n: u.n || u.s, sec: secOf[u.s] || 'Others' };
    }).sort(function(a, b){ return a.s < b.s ? -1 : 1; });
    var counts = {};
    state.sectorRows.forEach(function(r){ counts[r.sec] = (counts[r.sec] || 0) + 1; });
    var sel = $('hdSecSelect');
    if (sel) {
      var opts = ['<option value="All">All sectors (' + state.sectorRows.length + ')</option>'];
      Object.keys(counts).sort().forEach(function(sec){
        opts.push('<option value="' + BC.esc(sec) + '">' + BC.esc(sec) + ' (' + counts[sec] + ')</option>');
      });
      sel.innerHTML = opts.join('');
    }
    renderSector();
    if (state.data) applySymbolFilter();
  }).catch(function(){
    var sum = $('hdSecSum'); if (sum) sum.textContent = 'Sector list unavailable right now.';
  });
}
function renderSector(){
  var body = $('hdSecBody'); if (!body) return;
  var list = state.secFilter === 'All' ? state.sectorRows
    : state.sectorRows.filter(function(r){ return r.sec === state.secFilter; });
  var pages = Math.max(1, Math.ceil(list.length / PER));
  if (state.secPage > pages) state.secPage = pages;
  var slice = list.slice((state.secPage - 1) * PER, state.secPage * PER);
  body.innerHTML = slice.map(function(r){
    var sel = (r.s === state.symbol);
    return '<tr' + (sel ? ' class="is-selected"' : '') + '><td><a href="/stocks/' + BC.esc(r.s) + '/">' + BC.esc(r.s) + '</a>' +
      (sel ? ' <span class="mk" title="Selected stock">●</span>' : '') + '</td>' +
      '<td>' + BC.esc(r.n) + '</td><td>' + BC.esc(r.sec) + '</td></tr>';
  }).join('');
  var sum = $('hdSecSum');
  if (sum) sum.textContent = list.length + ' stocks · batch ' + (state.sectorBatch || '');
  var show = $('hdSecShowing');
  if (show) show.textContent = list.length
    ? 'Showing ' + ((state.secPage - 1) * PER + 1) + '–' + Math.min(state.secPage * PER, list.length) + ' of ' + list.length
    : 'No stocks in this sector';
  var prev = $('hdSecPrev'), next = $('hdSecNext');
  if (prev) prev.disabled = state.secPage <= 1;
  if (next) next.disabled = state.secPage >= pages;
}
function updateSectorMarks(){ renderSector(); }

/* --- load + gated refresh --- */
function fetchProv(){
  return fetch('/nepse-brokers/data/intraday-provisional.json', { cache: 'no-store' })
    .then(function(r){ if (!r.ok) throw new Error('no-prov'); return r.json(); })
    .catch(function(){ return null; });
}
function load(opts){
  var silent = opts && opts.silent;
  if (!silent) $('bkResult').innerHTML = '<p class="bk-loading">Loading…</p>';
  var provP = (state.period === 'latest') ? fetchProv() : Promise.resolve(null);
  Promise.all([BC.loadPeriod(state.period), provP]).then(function(res){
    var d = res[0];
    state.data = d; state.lastGood = d; state.prov = res[1];
    fillSymbols();
    var sig = signature(d);
    var changed = state.sig !== null && sig !== state.sig;
    state.sig = sig;
    if (silent && !changed) {
      /* Unchanged tick: freshness line only, DOM untouched. */
    } else if (state.symbol) { render(); }
    else $('bkResult').innerHTML = '<div class="bk-empty">Pick a stock above to see broker net positions.</div>';
    setFresh(false); setBanner();
    var n = $('hdNotice');
    if (silent && changed) {
      if (n) n.textContent = 'Holdings data updated · ' + nptTime() + ' NPT';
    } else if (n) {
      n.textContent = '';
    }
  }).catch(function(){
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

$('symSel').addEventListener('change', function(){
  state.symbol = this.value || null;
  if (state.symbol && state.data) {
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
  else if (!state.symbol) { state.sig = null; $('bkResult').innerHTML = '<div class="bk-empty">Pick a stock above to see broker net positions.</div>'; }
});
$('symSearch').addEventListener('input', function(){ applySymbolFilter(); });
$('bkPeriods').addEventListener('click', function(e){
  var b = e.target.closest('button'); if(!b) return;
  document.querySelectorAll('#bkPeriods button').forEach(function(x){ x.classList.remove('active'); });
  b.classList.add('active'); state.period = b.dataset.p; state.sig = null; load();
});
var secSel = $('hdSecSelect');
if (secSel) secSel.addEventListener('change', function(){ state.secFilter = secSel.value; state.secPage = 1; renderSector(); });
var secPrev = $('hdSecPrev'), secNext = $('hdSecNext');
if (secPrev) secPrev.addEventListener('click', function(){ if (state.secPage > 1) { state.secPage--; renderSector(); } });
if (secNext) secNext.addEventListener('click', function(){
  var list = state.secFilter === 'All' ? state.sectorRows : state.sectorRows.filter(function(r){ return r.sec === state.secFilter; });
  var pages = Math.max(1, Math.ceil(list.length / PER));
  if (state.secPage < pages) { state.secPage++; renderSector(); }
});
/* Holdings pager buttons are re-created on every render; wire them by delegation. */
$('bkResult').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b) return;
  if (b.id === 'hdPrev' && state.page > 1) { state.page--; renderTable(); }
  if (b.id === 'hdNext') {
    var pages = Math.max(1, Math.ceil(state.rows.length / PER));
    if (state.page < pages) { state.page++; renderTable(); }
  }
});

Promise.all([BC.loadMeta(), BC.loadBrokers()]).then(function(res){
  state.brokers = res[1];
  initSector();
  load();
}).catch(function(){
  $('bkResult').innerHTML = '<div class="bk-empty">Broker data could not be loaded. Please retry.</div>';
  setFresh(true);
});
setInterval(tick, 60000);
})();
