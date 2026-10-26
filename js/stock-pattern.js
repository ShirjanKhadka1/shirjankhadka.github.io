/* Stock Trade Pattern — page logic (stock-pattern teardown, 2026-10-26).
   Extracted from the old inline script, plus: CORRECTED traded totals
   (period-file s.value/s.qty are double-counted — see derive()), change-gated 60s refresh,
   freshness line with provisional/final/fallback states, net + concentration
   viz, full paginated buyer/seller tables, and the sector block.
   The page reads our own DB (period files + provisional), never proxies.
   PROVISIONAL DESIGN (decided from the data, not assumed): the provisional
   file carries per-symbol {trades, qty, amount} totals but NO broker splits.
   So for a selected stock, latest shows those totals labeled PROVISIONAL
   while broker detail always comes from the last final session — never
   provisional presented as final, never fabricated broker splits.
   DELIBERATE OMISSION: no buy/sell split bar. Total buy value equals total
   sell value by construction (netflow sums match exactly), so a split bar
   would be a constant 50/50 — vacuous viz. Net bars and buyer concentration
   carry the real variation instead. */
(function(){
"use strict";
var BC = window.BrokerCommon;
var $ = function(id){ return document.getElementById(id); };
var PER = 25;
var PERIODS = ['latest', '1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y'];
var state = { period: 'latest', brokers: {}, names: {}, data: null, prov: null,
  symbol: null, allSyms: [], sig: null, lastGood: null,
  buyers: [], sellers: [], buyPage: 1, sellPage: 1,
  sectorRows: [], secFilter: 'All', secPage: 1, sectorBatch: '' };

function nptTime(){
  try {
    return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) { return ''; }
}
function bname(code){ return state.brokers[code] || ('Broker ' + code); }
function symName(s){ return state.names[s] || s; }
function periodDate(d){ return (d && (d.to || d.from)) || ''; }
function provTime(p){
  if (!p || !p.asof) return '';
  var t = String(p.asof).slice(11, 16);
  return t || '';
}

/* --- symbol record: CORRECTED traded totals ---
   PROVEN DATA BUG (2026-10-26, verified against official turnover): the
   period files' per-symbol `value`/`qty` fields are DOUBLE-COUNTED (buy
   side + sell side summed). Proof: sum of s.value over 1D = Rs
   8,004,842,336.14 = exactly 2.0000x the official 2026-10-26 turnover
   Rs 4,002,421,168.07, while sum of s.value/2 and sum of broker buy_value
   both equal official exactly. The OLD page displayed s.value/s.qty, so
   it showed 2x the true traded value for every stock (ADBL: Rs 5.59 Cr /
   167,488 shares shown; true Rs 2.80 Cr / 83,744 shares). This rebuild
   CORRECTS that: traded value = s.value/2, traded qty = s.qty/2.
   Avg rate is unaffected (the ratio is identical either way).
   Netflow buy sums equal s.value/2 except on 12/341 1D symbols with
   incomplete netflow (total gap Rs 6,386,933, largest NABBC Rs 3,353,300)
   — so netflow is used for per-broker detail, never for the tile totals.
   broker_symbols (used by trade-pattern) is single-counted and
   official-exact, so the deployed trade-pattern page is NOT affected. */
function derive(sym){
  if (!sym) return null;
  var buyers = sym.buyers, sellers = sym.sellers;
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
  if (sym.netflow && Object.keys(sym.netflow).length){
    if ((!buyers || !Object.keys(buyers).length) && (!sellers || !Object.keys(sellers).length)){
      buyers = {}; sellers = {};
      Object.keys(sym.netflow).forEach(function(c){
        var v = sym.netflow[c] || [];
        if ((v[3] || 0) > 0) buyers[c] = [v[2] || 0, v[3] || 0];
        if ((v[5] || 0) > 0) sellers[c] = [v[4] || 0, v[5] || 0];
      });
    }
  }
  return { qty: qty || 0, value: value || 0, avg: avg || 0,
    buyers: buyers || {}, sellers: sellers || {}, netflow: sym.netflow || {} };
}
function netTotals(nf){
  var b = 0, s = 0;
  Object.keys(nf).forEach(function(c){
    var v = nf[c] || [];
    b += (v[3] || 0); s += (v[5] || 0);
  });
  return { buy: b, sell: s };
}
function netRows(nf){
  return Object.keys(nf).map(function(c){
    var v = nf[c] || [];
    return { code: c, netQty: v[0] || 0, netVal: v[1] || 0,
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
  var el = $('spFresh'); if (!el) return;
  var st = failed ? { kind: 'fail', text: 'Refresh failed — showing last good data' }
                  : freshState(state.lastGood);
  el.innerHTML = '<span class="sp-dot ' + (failed ? 'fail' : '') + '"></span>Checked ' + nptTime() +
    ' NPT · next check in 60 seconds · ' + BC.esc(st.text);
}
function setBanner(){
  var el = $('spBanner'); if (!el) return;
  var d = state.lastGood;
  if (state.period === 'latest' && d && usableProv(d)) {
    var pd = state.prov.date || '', fd = periodDate(d);
    el.className = 'sp-banner prov';
    el.textContent = pd === fd
      ? 'Provisional totals above are today\u2019s pre-close snapshot (as of ' + provTime(state.prov) + ' NPT). Broker splits publish after close, so the broker tables below show the last final session (' + fd + ').'
      : 'Live totals above are today\u2019s provisional snapshot (as of ' + provTime(state.prov) + ' NPT). The broker tables below are the last final session (' + fd + ').';
    el.style.display = '';
  } else if (state.period === 'latest' && d && d._fallback) {
    el.className = 'sp-banner fail';
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

/* --- paginated side tables --- */
function renderSideTable(bodyId, prevId, nextId, showId, rows, page, valKey, qtyKey, total){
  var body = $(bodyId); if (!body) return;
  var pages = Math.max(1, Math.ceil(rows.length / PER));
  if (page > pages) page = pages;
  var slice = rows.slice((page - 1) * PER, page * PER);
  body.innerHTML = slice.map(function(r, i){
    var share = total > 0 ? (r[valKey] / total * 100) : 0;
    return '<tr><td>' + ((page - 1) * PER + i + 1) + '. ' + BC.esc(bname(r.code)) + '</td>' +
      '<td>' + BC.fmtQ(r[qtyKey], r[valKey]) + '</td>' +
      '<td>' + BC.fmtV(r[valKey]) + '</td>' +
      '<td>' + (total > 0 ? share.toFixed(1) + '%' : '—') + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="bk-loading">No trades in this period.</td></tr>';
  var prev = $(prevId), next = $(nextId), show = $(showId);
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= pages;
  if (show) show.textContent = rows.length
    ? 'Showing ' + ((page - 1) * PER + 1) + '–' + Math.min(page * PER, rows.length) + ' of ' + rows.length
    : 'No trades in this period.';
  return page;
}
function wirePager(prevId, nextId, getPage, setPage, renderFn){
  var prev = $(prevId), next = $(nextId);
  if (prev) prev.addEventListener('click', function(){ if (getPage() > 1) { setPage(getPage() - 1); renderFn(); } });
  if (next) next.addEventListener('click', function(){
    var pages = Math.max(1, Math.ceil(renderFn.len() / PER));
    if (getPage() < pages) { setPage(getPage() + 1); renderFn(); }
  });
}

/* --- viz: net bars + buyer concentration --- */
function renderViz(nrows, buyers, totalBuy){
  var top = nrows.slice(0, 10);
  var max = top.length ? Math.max.apply(null, top.map(function(r){ return Math.abs(r.netVal); })) : 0;
  var rankHtml = top.length ? top.map(function(r){
    var w = max ? Math.round(Math.abs(r.netVal) / max * 100) : 0;
    var cls = r.netVal > 0 ? 'up' : (r.netVal < 0 ? 'down' : '');
    return '<div class="sp-rank"><span class="lb">' + BC.esc(r.code) + ' · ' + BC.esc(bname(r.code)) + '</span>' +
      '<span class="tr"><i class="' + cls + '" style="width:' + w + '%"></i></span>' +
      '<span class="vl ' + cls + '">' + (r.netVal > 0 ? '+' : '') + BC.fmtV(r.netVal) + '</span></div>';
  }).join('') : '<p class="sp-cap">No net flow in this period.</p>';
  var bsorted = buyers.slice().sort(function(a, b){ return b.val - a.val; }).slice(0, 5);
  var bmax = bsorted.length ? bsorted[0].val : 0;
  var concHtml = bsorted.length ? bsorted.map(function(r){
    var w = bmax ? Math.round(r.val / bmax * 100) : 0;
    var share = totalBuy > 0 ? (r.val / totalBuy * 100).toFixed(1) + '%' : '—';
    return '<div class="sp-rank"><span class="lb">' + BC.esc(r.code) + ' · ' + BC.esc(bname(r.code)) + '</span>' +
      '<span class="tr"><i class="lime" style="width:' + w + '%"></i></span>' +
      '<span class="vl">' + BC.fmtV(r.val) + ' · ' + share + '</span></div>';
  }).join('') : '<p class="sp-cap">No buyers in this period.</p>';
  return '<div class="sp-viz">' +
    '<div class="sp-viz-card"><h3>Largest net moves by broker</h3>' +
    '<p class="sp-cap">Top 10 brokers by absolute net value for this stock. Measured flow, not a forecast.</p>' +
    rankHtml + '</div>' +
    '<div class="sp-viz-card"><h3>Buyer concentration</h3>' +
    '<p class="sp-cap">Top 5 buyers and their share of total buy value. Measured flow, not a forecast.</p>' +
    concHtml + '</div></div>';
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
  /* Share denominators: the corrected traded total (dv.value). Netflow
     sums undercount on 12 incomplete-netflow symbols, so they are never
     the denominator — listed shares then honestly sum below 100% there. */
  var nt = netTotals(dv.netflow);
  var listBuy = Object.keys(dv.buyers).reduce(function(a, c){ return a + (dv.buyers[c][1] || 0); }, 0);
  var listSell = Object.keys(dv.sellers).reduce(function(a, c){ return a + (dv.sellers[c][1] || 0); }, 0);
  var totalBuy = dv.value > 0 ? dv.value : (nt.buy > 0 ? nt.buy : listBuy);
  var totalSell = dv.value > 0 ? dv.value : (nt.sell > 0 ? nt.sell : listSell);
  state.buyers = Object.keys(dv.buyers).map(function(c){
    var v = dv.buyers[c]; return { code: c, qty: v[0] || 0, val: v[1] || 0 };
  }).sort(function(a, b){ return b.val - a.val; });
  state.sellers = Object.keys(dv.sellers).map(function(c){
    var v = dv.sellers[c]; return { code: c, qty: v[0] || 0, val: v[1] || 0 };
  }).sort(function(a, b){ return b.val - a.val; });
  var nrows = netRows(dv.netflow);
  state.buyPage = 1; state.sellPage = 1;
  // Period tile, de-duplicated (parent fix 2026-10-26): BC.label('latest', d)
  // returns "last session (last session)" when the period file carries no
  // asof field, and the old sub-line repeated the range label() already
  // prints for non-latest periods. One line, no repetition.
  var periodText = state.period === 'latest' ? 'Last final session (' + periodDate(d) + ')'
    : BC.label(state.period, d);
  var html = '<div class="bk-tiles">' +
    '<div class="bk-tile"><div class="k">Total value</div><div class="v">' + BC.fmtV(dv.value) + '</div></div>' +
    '<div class="bk-tile"><div class="k">Total quantity</div><div class="v">' + BC.fmtN(dv.qty, 0) + '</div></div>' +
    '<div class="bk-tile"><div class="k">Avg rate</div><div class="v">Rs ' + BC.fmtN(dv.avg) + '</div></div>' +
    '<div class="bk-tile"><div class="k">Period</div><div class="v" style="font-size:1rem">' + BC.esc(periodText) + '</div></div></div>';
  var prec = usableProv(d);
  if (prec) {
    var pavg = prec.qty ? prec.amount / prec.qty : 0;
    html += '<div class="sp-prov"><p class="sp-prov-head">Provisional — ' + BC.esc(state.symbol) + ' (as of ' + BC.esc(provTime(state.prov)) + ' NPT, not final)</p>' +
      '<div class="bk-tiles">' +
      '<div class="bk-tile"><div class="k">Provisional value</div><div class="v">' + BC.fmtV(prec.amount) + '</div></div>' +
      '<div class="bk-tile"><div class="k">Provisional quantity</div><div class="v">' + BC.fmtN(prec.qty, 0) + '</div></div>' +
      '<div class="bk-tile"><div class="k">Provisional avg rate</div><div class="v">Rs ' + BC.fmtN(pavg) + '</div></div>' +
      '<div class="bk-tile"><div class="k">Provisional trades</div><div class="v">' + BC.fmtN(prec.trades, 0) + '</div></div></div></div>';
  }
  html += '<h2 class="bk-h2">' + BC.esc(sym) + (state.names[sym] ? ' — ' + BC.esc(state.names[sym]) : '') + '</h2>';
  html += renderViz(nrows, state.buyers, totalBuy);
  html += '<h2 class="bk-h2">Top buyers</h2>' +
    '<div class="bk-scroll"><table class="bk-table nd-table" id="buyTable"><thead><tr>' +
    '<th data-sort="code">Broker</th><th data-sort="qty">Buy qty</th><th data-sort="val">Buy value</th><th>Share</th>' +
    '</tr></thead><tbody id="buyBody"></tbody></table></div>' +
    '<div class="sp-pager"><button type="button" id="buyPrev">Prev</button>' +
    '<span class="sp-showing" id="buyShowing"></span>' +
    '<button type="button" class="sp-next" id="buyNext">Next</button></div>';
  html += '<h2 class="bk-h2">Top sellers</h2>' +
    '<div class="bk-scroll"><table class="bk-table nd-table" id="sellTable"><thead><tr>' +
    '<th data-sort="code">Broker</th><th data-sort="qty">Sell qty</th><th data-sort="val">Sell value</th><th>Share</th>' +
    '</tr></thead><tbody id="sellBody"></tbody></table></div>' +
    '<div class="sp-pager"><button type="button" id="sellPrev">Prev</button>' +
    '<span class="sp-showing" id="sellShowing"></span>' +
    '<button type="button" class="sp-next" id="sellNext">Next</button></div>';
  $('bkResult').innerHTML = html;
  window.__spTile = document.querySelector('.bk-tile') || null;
  var renderBuy = function(){
    state.buyPage = renderSideTable('buyBody', 'buyPrev', 'buyNext', 'buyShowing',
      state.buyers, state.buyPage, 'val', 'qty', totalBuy);
  };
  renderBuy.len = function(){ return state.buyers.length; };
  var renderSell = function(){
    state.sellPage = renderSideTable('sellBody', 'sellPrev', 'sellNext', 'sellShowing',
      state.sellers, state.sellPage, 'val', 'qty', totalSell);
  };
  renderSell.len = function(){ return state.sellers.length; };
  renderBuy(); renderSell();
  wirePager('buyPrev', 'buyNext', function(){ return state.buyPage; }, function(p){ state.buyPage = p; }, renderBuy);
  wirePager('sellPrev', 'sellNext', function(){ return state.sellPage; }, function(p){ state.sellPage = p; }, renderSell);
  BC.makeSortable($('buyTable'), function(){ return state.buyers; }, function(rs){ state.buyers = rs; state.buyPage = 1; renderBuy(); });
  BC.makeSortable($('sellTable'), function(){ return state.sellers; }, function(rs){ state.sellers = rs; state.sellPage = 1; renderSell(); });
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
    var sel = $('spSecSelect');
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
    var sum = $('spSecSum'); if (sum) sum.textContent = 'Sector list unavailable right now.';
  });
}
function renderSector(){
  var body = $('spSecBody'); if (!body) return;
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
  var sum = $('spSecSum');
  if (sum) sum.textContent = list.length + ' stocks · batch ' + (state.sectorBatch || '');
  var show = $('spSecShowing');
  if (show) show.textContent = list.length
    ? 'Showing ' + ((state.secPage - 1) * PER + 1) + '–' + Math.min(state.secPage * PER, list.length) + ' of ' + list.length
    : 'No stocks in this sector';
  var prev = $('spSecPrev'), next = $('spSecNext');
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
    else $('bkResult').innerHTML = '<div class="bk-empty">Pick a stock above to see who bought and sold it.</div>';
    setFresh(false); setBanner();
    var n = $('spNotice');
    if (silent && changed) {
      if (n) n.textContent = 'Stock data updated · ' + nptTime() + ' NPT';
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
       signature here. Nulling it (the first version's bug) made the next
       silent tick take the "unchanged" branch unconditionally, so real
       data changes after a selection were never noticed. */
    state.sig = signature(state.data);
    setFresh(false); setBanner();
  }
  else if (!state.symbol) { $('bkResult').innerHTML = '<div class="bk-empty">Pick a stock above to see who bought and sold it.</div>'; updateSectorMarks(); }
});
$('symSearch').addEventListener('input', function(){ applySymbolFilter(); });
$('bkPeriods').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#bkPeriods button').forEach(function(x){ x.classList.remove('active'); });
  b.classList.add('active'); state.period = b.dataset.p; state.sig = null; load();
});
var secSel = $('spSecSelect');
if (secSel) secSel.addEventListener('change', function(){ state.secFilter = secSel.value; state.secPage = 1; renderSector(); });
var secPrev = $('spSecPrev'), secNext = $('spSecNext');
if (secPrev) secPrev.addEventListener('click', function(){ if (state.secPage > 1) { state.secPage--; renderSector(); } });
if (secNext) secNext.addEventListener('click', function(){
  var list = state.secFilter === 'All' ? state.sectorRows : state.sectorRows.filter(function(r){ return r.sec === state.secFilter; });
  var pages = Math.max(1, Math.ceil(list.length / PER));
  if (state.secPage < pages) { state.secPage++; renderSector(); }
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
