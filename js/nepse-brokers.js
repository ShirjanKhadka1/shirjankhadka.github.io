/* Nepse Decode — Broker Analytics live layer.
   Extracted from the page's old inline script + teardown changes:
   - 'Latest' reads intraday-provisional.json (the old intraday.json
     never existed: live 404, so the old page always fell back to 1D).
     Final wins when published: if the 1D period already covers the
     provisional date, the final session renders instead.
   - 60s refresh is change-gated: an unchanged payload moves only the
     freshness line; a changed payload re-renders; a failed tick keeps
     the old view. Non-silent loads always render.
   - Accumulation/distribution and holdings "accumulating" labels are
     measured transaction flow, never a forecast. No predictive claim
     ships on this page (see the prediction audit in the report).
   - All URL/state-derived strings injected as HTML pass through esc().
   Vanilla JS, no frameworks. */
(function(){
"use strict";
var BASE = '/nepse-brokers/data/';
var DAILY_END = '2026-10-07'; /* daily archive end, rewritten by the snapshot baker; verifier-checked */
var state = { view: 'top', period: 'latest', data: null, brokers: {}, meta: null, asof: null, rangeFrom: null, rangeTo: null, symbol: null, broker: null, topPage: 0, holdPage: 0, brkPage: 0, brkQuery: '', accPage: 0, distPage: 0, accSearch: '', sorts: {}, provPage: 0, mode: '' };
var $ = function(id){ return document.getElementById(id); };
var lastSig = null, lastData = null, lastFresh = '';

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function nptTime(d){ try { return d.toLocaleString('en-GB',{timeZone:'Asia/Kathmandu',hour:'2-digit',minute:'2-digit'}); } catch(e){ return ''; } }
function nptDate(d){ try { return d.toLocaleString('en-CA',{timeZone:'Asia/Kathmandu',year:'numeric',month:'2-digit',day:'2-digit'}); } catch(e){ return ''; } }

/* ---------- URL-backed state (replaceState; no history spam) ---------- */
function readURL(){
  var q = {};
  var s = location.search.replace(/^\?/,'');
  if(!s) return q;
  s.split('&').forEach(function(p){
    var kv = p.split('=');
    if(kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||'');
  });
  return q;
}
function syncURL(){
  var parts = [];
  if(state.view!=='top') parts.push('view='+encodeURIComponent(state.view));
  if(state.period!=='latest') parts.push('period='+encodeURIComponent(state.period));
  if(state.period==='asof' && state.asof) parts.push('asof='+encodeURIComponent(state.asof));
  if(state.period==='range' && state.rangeFrom && state.rangeTo){
    parts.push('from='+encodeURIComponent(state.rangeFrom));
    parts.push('to='+encodeURIComponent(state.rangeTo));
  }
  if(state.symbol) parts.push('symbol='+encodeURIComponent(state.symbol));
  if(state.broker) parts.push('broker='+encodeURIComponent(state.broker));
  history.replaceState(null, '', location.pathname + (parts.length ? '?'+parts.join('&') : ''));
}
function initFromURL(){
  var q = readURL();
  var views = {top:1, broker:1, stock:1, holdings:1, accdist:1};
  if(q.view && views[q.view]) state.view = q.view;
  var periods = {latest:1,'1D':1,'1W':1,'2W':1,'1M':1,'3M':1,'6M':1,'1Y':1,'2Y':1,'3Y':1,asof:1,range:1};
  if(q.period && periods[q.period]){
    if(q.period==='asof'){
      if(/^\d{4}-\d{2}-\d{2}$/.test(q.asof||'')){ state.period='asof'; state.asof=q.asof; }
    } else if(q.period==='range'){
      if(/^\d{4}-\d{2}-\d{2}$/.test(q.from||'') && /^\d{4}-\d{2}-\d{2}$/.test(q.to||'') && q.from<=q.to){
        state.period='range'; state.rangeFrom=q.from; state.rangeTo=q.to;
      }
    } else {
      state.period = q.period;
    }
  }
  if(q.symbol) state.symbol = q.symbol.toUpperCase();
  if(q.broker) state.broker = q.broker;
}
function syncStaticControls(){
  document.querySelectorAll('#viewTabs button').forEach(function(x){
    x.classList.toggle('active', x.dataset.view===state.view);
    x.setAttribute('aria-selected', x.dataset.view===state.view ? 'true' : 'false');
  });
  document.querySelectorAll('#periodBar button').forEach(function(x){
    x.classList.toggle('active', x.dataset.p===state.period);
    x.setAttribute('aria-selected', x.dataset.p===state.period ? 'true' : 'false');
  });
  if(state.period==='asof' && state.asof) $('asofDate').value = state.asof;
  if(state.period==='range'){
    if(state.rangeFrom) $('bkRangeFrom').value = state.rangeFrom;
    if(state.rangeTo) $('bkRangeTo').value = state.rangeTo;
  }
}

function fmtN(n, d){ d = d===undefined?2:d; if(n==null||n===''||!isFinite(Number(n))) return '–';
  return Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtV(n){ if(!isFinite(n)) return '–'; var a=Math.abs(n);
  if(a>=1e7) return 'Rs '+(n/1e7).toFixed(2)+' Cr';
  if(a>=1e5) return 'Rs '+(n/1e5).toFixed(2)+' L';
  return 'Rs '+Math.round(n).toLocaleString('en-US'); }
function fmtQ(qty,val){ return (qty===0||qty==='0'||qty==null) && val>0 ? '—' : fmtN(qty||0,0); }
function bname(code){ return state.brokers[code] || ('Broker '+code); }
function cls(v){ return v>0?'pos':(v<0?'neg':''); }

/* ---------- generic table sorting (all broker tables) ---------- */
var sortPageKey = { top:'topPage', broker:'brkPage', holdings:'holdPage', acc:'accPage', dist:'distPage' };
function sortState(view){ return state.sorts[view] || (state.sorts[view] = {key:null, dir:-1}); }
function thS(view, key, label, clsName){
  var s = sortState(view), active = s.key === key;
  var arrow = active ? (s.dir===1 ? ' ▲' : ' ▼') : '';
  return '<th data-sort="'+view+':'+key+'" class="'+((clsName||'')+(active?' sorted':''))+'">'+label+arrow+'</th>';
}
function applySort(arr, view, get){
  var s = sortState(view);
  if(!s.key || !get[s.key]) return arr;
  var d = s.dir, g = get[s.key];
  return arr.sort(function(a,b){
    var va=g(a), vb=g(b);
    var c=(typeof va==='string') ? (va<vb?-1:va>vb?1:0) : (va-vb);
    return c*d;
  });
}
function numCode(v){ var n = parseFloat(v); return isNaN(n) ? String(v==null?'':v).toLowerCase() : n; }
function pager(page, totalPages, total, noun, prevId, nextId){
  var start = total ? page*10+1 : 0, end = Math.min((page+1)*10, total);
  return '<div class="bk-pager"><button type="button" id="'+prevId+'" '+(page===0?'disabled':'')+'>← Prev</button>'+
    '<span class="bk-showing">Showing '+start+'–'+end+' of '+total+' · page '+(page+1)+' of '+totalPages+'</span>'+
    '<button type="button" class="bk-next" id="'+nextId+'" '+(page>=totalPages-1?'disabled':'')+'>Next →</button></div>';
}

/* ---------- meta + snapshot label ---------- */
function loadMeta(){
  return fetch(BASE+'meta.json').then(function(r){return r.json()}).then(function(m){
    state.meta = m;
    $('coverage').innerHTML = '<strong>Data:</strong> ' + esc(m.earliest) + ' → ' + esc(m.latest) +
      ' (' + esc(m.trading_days) + ' trading days)' +
      (m.trading_days < 60 ? ' — <strong>history still building;</strong> longer periods fill in automatically.' : '') +
      ' <span style="color:var(--nd-dim)">Updated ' + esc(String(m.updated_at).slice(0,10)) + '</span>';
    return fetch(BASE+'brokers.json').then(function(r){return r.json()}).then(function(b){
      state.brokers = b;
      var sel = $('brokerSel');
      Object.keys(b).filter(function(c){return /^\d+$/.test(c)}).sort(function(a,c){return a-c}).forEach(function(c){
        var o = document.createElement('option'); o.value=c; o.textContent=c+' — '+b[c]; sel.appendChild(o);
      });
    });
  });
}
function tradingDaysBetween(fromYMD, toYMD){
  var CFG = window.NepseMarketConfig;
  if (!CFG || typeof CFG.isTradingDay !== 'function') return -1;
  var from = new Date(fromYMD + 'T00:00:00Z'), to = new Date(toYMD + 'T00:00:00Z');
  var n = 0, d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= to) {
    if (CFG.isTradingDay(d.toISOString().slice(0, 10))) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}
/* The baked snapshot is only as fresh as its last bake. Label it at
   runtime against the market's own latest session (live.json
   session_date): when it is behind, the heading says so explicitly
   instead of letting the word "Latest" overclaim. */
function labelSnapshot(){
  var span = document.querySelector('.snap-asof');
  var h2 = span ? span.closest('h2') : null;
  if (!span || !h2 || !state.meta) return;
  var m = /(\d{4}-\d{2}-\d{2})/.exec(span.textContent || '');
  if (!m) return;
  var snapDate = m[1];
  fetch('/nepse-chart/data/live.json', { cache: 'no-store' }).then(function(r){
    if (!r.ok) throw 0; return r.json();
  }).then(function(live){
    var mkt = live && live.session_date;
    if (!mkt || snapDate >= mkt) return;
    var behind = tradingDaysBetween(snapDate, mkt);
    var lead = h2.childNodes[0];
    if (lead && lead.nodeType === 3) lead.textContent = 'Latest available session broker flow ';
    span.textContent = '· session ' + snapDate +
      (behind > 0
        ? ' · ' + behind + ' sessions behind the latest market session (' + mkt + ')'
        : ' · behind the latest market session (' + mkt + ')') +
      ' — latest available snapshot · interactive views below carry broker data to ' + state.meta.latest;
    span.style.color = '#d97706';
  }).catch(function(){ /* leave the baked label untouched */ });
}

/* ---------- freshness line ---------- */
function setFresh(kind, extra){
  var el = $('bkFresh'); if(!el) return;
  var now = nptTime(new Date());
  var txt, clsName = '';
  if (kind === 'fail'){
    txt = 'Refresh failed at ' + now + ' NPT — showing last good data · next retry in 60 seconds';
    clsName = ' fail';
  } else if (kind === 'prov'){
    txt = 'PROVISIONAL symbol-only totals · as of ' + extra + ' NPT · checked ' + now + ' NPT · next check in 60 seconds · broker split publishes after close';
  } else if (kind === 'provsplits'){
    txt = 'PROVISIONAL broker splits · as of ' + extra + ' NPT · checked ' + now + ' NPT · next check in 60 seconds · final totals publish after close';
  } else if (kind === 'fallback'){
    txt = 'No provisional file — showing last final session (' + extra + ') · checked ' + now + ' NPT · next check in 60 seconds';
  } else if (kind === 'same'){
    /* Unchanged tick: keep the previous line's meaning, but the checked
       time MUST advance — otherwise a healthy page looks frozen. A stale
       failure line never carries forward (the tick just succeeded). */
    if (lastFresh && lastFresh.indexOf('Refresh failed') !== 0){
      txt = lastFresh.replace(/(checked|Checked) \d{2}:\d{2} NPT/, function(m, w){ return w + ' ' + now + ' NPT'; });
    } else {
      txt = 'Checked ' + now + ' NPT · next check in 60 seconds';
    }
  } else {
    txt = 'Checked ' + now + ' NPT · next check in 60 seconds' + (extra ? ' · ' + extra : '');
  }
  lastFresh = txt;
  el.innerHTML = '<span class="dot"></span>' + esc(txt) + (kind === 'changed' && extra && extra.moved ? ' <span class="bk-new">' + extra.moved + ' symbols moved</span>' : '');
  el.className = 'bk-fresh' + clsName;
}

/* ---------- change gate ---------- */
function fnv(str){ var h = 0x811c9dc5; for (var i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h>>>0).toString(36); }
function sigOf(d){
  if (d === lastData) return lastSig;
  try { return fnv(JSON.stringify(d)); } catch(e){ return null; }
}
function movedCount(next, prev){
  if (!next || !next.symbols || !prev || !prev.symbols) return 0;
  var n = 0;
  Object.keys(next.symbols).forEach(function(s){
    var a = next.symbols[s], b = prev.symbols[s];
    if (!b || (a.amount||0) !== (b.amount||0)) n++;
  });
  return n;
}

/* ---------- loading ---------- */
/* Period aggregates and per-day archives are immutable once published:
   fetch once per session and reuse across period switches, with normal
   HTTP cache semantics (no 'no-store'). The intraday provisional feed
   is not cached in memory — the 60s auto-refresh must keep seeing
   rebuilds during market hours. Failures are evicted so retries work. */
var periodCache = {};
function fetchPeriodCached(url){
  if (!periodCache[url]) {
    var pr = fetch(url).then(function(r){ if(!r.ok) throw 0; return r.json(); });
    periodCache[url] = pr;
    pr.catch(function(){ delete periodCache[url]; });
  }
  return periodCache[url];
}
function fetchLatest(){
  /* Provisional first; final wins when the 1D period already covers
     the provisional date (post-close). Provisional older than the
     1D period is stale (yesterday's file before today's first write)
     and is ignored in favour of the final. */
  return fetch(BASE+'intraday-provisional.json', { cache: 'no-store' }).then(function(r){
    if(!r.ok) throw 0; return r.json();
  }).then(function(prov){
    return fetchPeriodCached(BASE+'periods/1D.json').then(function(d1){
      if (prov.date && d1.to && prov.date <= d1.to) return Object.assign({}, d1, { _mode: 'final' });
      prov._mode = 'provisional';
      return prov;
    }, function(){ prov._mode = 'provisional'; return prov; });
  }).catch(function(){
    return fetchPeriodCached(BASE+'periods/1D.json').then(function(d){
      return Object.assign({}, d, { _mode: 'fallback' });
    });
  });
}
function loadPeriod(silent){
  var p = state.period;
  /* Range payloads are immutable for fixed from/to (a hybrid range tracks
     meta.latest only across day rollovers, which a reload picks up):
     silent 60s ticks move only the freshness line, never recompute and
     never reset pagination — the same rule fixed periods follow. */
  if (silent && p === 'range'){ setFresh('same'); return Promise.resolve(); }
  var url, req, isLatest = (p === 'latest');
  if (isLatest) req = fetchLatest();
  else if (p === 'asof') { url = BASE+'daily/'+state.asof+'.json'; req = fetchPeriodCached(url); }
  else if (p === 'range') {
    if (!window.BrokerRange || !window.BrokerRange.loadRange) {
      req = Promise.reject(new Error('Range module not loaded — please reload the page.'));
    } else {
      req = window.BrokerRange.loadRange(state.rangeFrom, state.rangeTo, function(pr){
        if (!silent) $('view').innerHTML = '<p style="color:var(--nd-muted)">Building range… ' +
          (pr.stage === 'daily' ? 'fetching daily files (' + pr.done + '/' + pr.total + ')' : 'loading period data (' + pr.done + '/' + pr.total + ')') + '</p>';
      });
    }
  }
  else { url = BASE+'periods/'+p+'.json'; req = fetchPeriodCached(url); }
  if (!silent) $('view').innerHTML = '<p style="color:var(--nd-muted)">Loading…</p>';
  return req.then(function(d){
    var sig = sigOf(d);
    if (silent && sig !== null && sig === lastSig && lastData){
      setFresh('same');
      return; /* unchanged tick: DOM probes survive, only the freshness line moves */
    }
    var moved = 0;
    if (d && d._mode === 'provisional' && lastData && lastData._mode === 'provisional') moved = movedCount(d, lastData);
    state.data = d; lastData = d; lastSig = sig;
    render();
    if (d && d._mode === 'provisional') setFresh(d.symbol_only === false ? 'provsplits' : 'prov', String(d.asof||'').slice(0,10) + ' ' + String(d.asof||'').slice(11,16));
    else if (d && d._mode === 'fallback') setFresh('fallback', d.to ? String(d.to).slice(0,10) : 'last session');
    else if (moved) setFresh('changed', { moved: moved });
    else setFresh('ok', state.modeLabel || '');
  }).catch(function(e){
    if (silent){ setFresh('fail'); return; } /* background refresh failed: keep last good render */
    var msg;
    if (p === 'range'){
      /* Range errors carry their own honest message (missing dates,
         zero-sum failure, validation) — render it, never a stale view. */
      msg = (e && e.message) ? e.message : 'Range could not be built.';
    } else if (p === 'asof'){
      msg = (state.asof && state.asof > DAILY_END)
        ? 'No daily file for ' + esc(state.asof) + ' — the daily archive currently ends ' + DAILY_END + '; later sessions are in the period views (1D–3Y) above.'
        : 'No data for ' + esc(state.asof) + ' (weekend/holiday, or not yet backfilled).';
    } else if (p === 'latest'){
      msg = 'Live broker feed not available yet — it goes live with the market-hours poller. Try 1D for the last session.';
    } else {
      msg = 'This period is still building — check back as the history backfill progresses.';
    }
    $('view').innerHTML = '<div class="cover">'+msg+'</div>';
  });
}

/* ---------- views ---------- */
function pagerK(page, totalPages, total, key){
  var start = total ? page*10+1 : 0, end = Math.min((page+1)*10, total);
  return '<div class="bk-pager"><button type="button" class="accPrev" data-k="'+key+'" '+(page===0?'disabled':'')+'>← Prev</button>'+
    '<span class="bk-showing">Showing '+start+'–'+end+' of '+total+' · page '+(page+1)+' of '+totalPages+'</span>'+
    '<button type="button" class="bk-next accNext" data-k="'+key+'" '+(page>=totalPages-1?'disabled':'')+'>Next →</button></div>';
}
function renderTop(d){
  var PER_PAGE = 10;
  var get = {
    broker: function(b){ return bname(b.code).toLowerCase(); },
    code: function(b){ return numCode(b.code); },
    buy_qty: function(b){ return b.buy_qty||0; }, buy_value: function(b){ return b.buy_value||0; },
    sell_qty: function(b){ return b.sell_qty||0; }, sell_value: function(b){ return b.sell_value||0; },
    total_qty: function(b){ return b.total_qty||0; }, total_value: function(b){ return b.total||0; },
    net_qty: function(b){ return b.net_qty||0; }, net_value: function(b){ return b.net||0; }
  };
  var all = applySort((d.brokers || []).slice(), 'top', get);
  var totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  if (state.topPage >= totalPages) state.topPage = totalPages - 1;
  if (state.topPage < 0) state.topPage = 0;
  var start = state.topPage * PER_PAGE;
  var page = all.slice(start, start + PER_PAGE);
  var rows = page.map(function(b,i){
    var idx = start + i + 1;
    return '<tr><td>'+idx+'</td><td class="bk-name"><strong>'+esc(bname(b.code))+'</strong><br><span style="color:var(--nd-dim)">'+esc(b.code)+'</span></td>'+
      '<td>'+fmtQ(b.buy_qty,b.buy_value)+'</td><td>'+fmtV(b.buy_value)+'</td>'+
      '<td>'+fmtQ(b.sell_qty,b.sell_value)+'</td><td>'+fmtV(b.sell_value)+'</td>'+
      '<td><strong>'+fmtQ(b.total_qty,b.total)+'</strong></td><td><strong>'+fmtV(b.total)+'</strong></td>'+
      '<td class="'+cls(b.net_qty)+'">'+fmtQ(b.net_qty,Math.abs(b.net))+'</td><td class="'+cls(b.net)+'">'+fmtV(b.net)+'</td></tr>';
  }).join('');
  return '<h2 class="bk-h">Top brokers by turnover — '+esc(label())+'</h2>'+
    '<div class="scrollx" tabindex="0" role="region" aria-label="Top brokers by turnover table"><table class="bk-table nd-table"><thead><tr><th>#</th>'+
    thS('top','broker','Broker','bk-name')+thS('top','buy_qty','Buy vol')+thS('top','buy_value','Buy value')+
    thS('top','sell_qty','Sell vol')+thS('top','sell_value','Sell value')+thS('top','total_qty','Total vol')+
    thS('top','total_value','Total value')+thS('top','net_qty','Net vol')+thS('top','net_value','Net value')+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>'+pager(state.topPage, totalPages, all.length, '', 'bkPrev', 'bkNext');
}

function renderBroker(d){
  var code = $('brokerSel').value;
  if(!code) return '<div class="cover">Pick a broker above to see what it traded.</div>';
  var allSyms = (d.broker_symbols && d.broker_symbols[code]) || [];
  var q = (state.brkQuery||'').trim().toUpperCase();
  var syms = q ? allSyms.filter(function(s){ return s.symbol.toUpperCase().indexOf(q) >= 0; }) : allSyms;
  var bget = {
    symbol: function(s){ return s.symbol; },
    buy_qty: function(s){ return s.buy_qty||0; }, buy_value: function(s){ return s.buy_value||0; },
    sell_qty: function(s){ return s.sell_qty||0; }, sell_value: function(s){ return s.sell_value||0; },
    net_value: function(s){ return (s.buy_value||0)-(s.sell_value||0); }
  };
  syms = applySort(syms.slice(), 'broker', bget);
  var t = d.brokers.filter(function(b){return b.code===code})[0] || {};
  var PER_PAGE = 10;
  var totalPages = Math.max(1, Math.ceil(syms.length / PER_PAGE));
  if (state.brkPage >= totalPages) state.brkPage = totalPages - 1;
  if (state.brkPage < 0) state.brkPage = 0;
  var start = state.brkPage * PER_PAGE;
  var rows = syms.slice(start, start + PER_PAGE).map(function(s){
    var net = s.buy_value - s.sell_value;
    return '<tr><td><strong>'+esc(s.symbol)+'</strong></td><td>'+fmtQ(s.buy_qty,s.buy_value)+'</td><td>'+fmtV(s.buy_value)+'</td>'+
      '<td>'+fmtQ(s.sell_qty,s.sell_value)+'</td><td>'+fmtV(s.sell_value)+'</td><td class="'+cls(net)+'">'+fmtV(net)+'</td></tr>';
  }).join('');
  return '<h2 class="bk-h">'+esc(bname(code))+' — trade pattern, '+esc(label())+'</h2>'+
    '<div class="stat-row">'+
    '<div class="stat"><div class="l">Buy volume</div><div class="v">'+fmtQ(t.buy_qty,t.buy_value)+'</div></div>'+
    '<div class="stat"><div class="l">Buy value</div><div class="v">'+fmtV(t.buy_value||0)+'</div></div>'+
    '<div class="stat"><div class="l">Sell volume</div><div class="v">'+fmtQ(t.sell_qty,t.sell_value)+'</div></div>'+
    '<div class="stat"><div class="l">Sell value</div><div class="v">'+fmtV(t.sell_value||0)+'</div></div>'+
    '<div class="stat"><div class="l">Net volume</div><div class="v '+cls((t.buy_qty||0)-(t.sell_qty||0))+'">'+fmtQ((t.buy_qty||0)-(t.sell_qty||0),Math.abs((t.buy_value||0)-(t.sell_value||0)))+'</div></div>'+
    '<div class="stat"><div class="l">Net value</div><div class="v '+cls((t.buy_value||0)-(t.sell_value||0))+'">'+fmtV((t.buy_value||0)-(t.sell_value||0))+'</div></div>'+
    '<div class="stat"><div class="l">Stocks traded</div><div class="v">'+allSyms.length+'</div></div></div>'+
    '<div class="scrollx" tabindex="0" role="region" aria-label="Broker stock detail table"><table class="bk-table nd-table"><thead><tr>'+
    thS('broker','symbol','Symbol')+thS('broker','buy_qty','Buy qty')+thS('broker','buy_value','Buy value')+
    thS('broker','sell_qty','Sell qty')+thS('broker','sell_value','Sell value')+thS('broker','net_value','Net value')+
    '</tr></thead><tbody>'+(rows||'<tr><td colspan="6">'+(q?'No symbols match "'+esc(q)+'".':'No trades in this period.')+'</td></tr>')+'</tbody></table></div>'+pager(state.brkPage, totalPages, syms.length, '', 'brPrev', 'brNext');
}

function symbolOptions(d){
  return Object.keys(d.symbols||{}).sort();
}

function renderStock(d){
  var sym = $('symbolSel').value;
  if(!sym) return '<div class="cover">Pick a stock above to see who bought and sold it.</div>';
  function union(a,b){ var u={}; Object.keys(a||{}).forEach(function(k){u[k]=1}); Object.keys(b||{}).forEach(function(k){u[k]=1}); return u; }
  var s = d.symbols[sym];
  if(!s) return '<div class="cover">No trades for '+esc(sym)+' in this period.</div>';
  /* Legacy netflow-only shapes lack top-level qty/value — derive from netflow. */
  if (s.netflow && (s.qty == null || s.value == null)){
    var tq = 0, tv = 0;
    Object.keys(s.netflow).forEach(function(c){
      var v = s.netflow[c] || [];
      tq += (v[2]||0) + (v[4]||0);
      tv += (v[3]||0) + (v[5]||0);
    });
    s.qty = tq / 2; s.value = tv / 2;
    s.avg_rate = s.qty ? s.value / s.qty : 0;
  }
  function bt(obj, title){
    /* buyers/sellers entries are [qty, value]; tolerate legacy value-only schema
       and missing objects entirely. */
    var rows = Object.keys(obj||{}).map(function(c){
      var v = obj[c];
      return [c, Array.isArray(v) ? v : [0, v]];
    }).sort(function(a,b){return b[1][1]-a[1][1]})
      .slice(0,10).map(function(x,i){
        return '<tr><td>'+(i+1)+'</td><td class="bk-name">'+esc(bname(x[0]))+'</td><td>'+fmtQ(x[1][0],x[1][1])+'</td><td>'+fmtV(x[1][1])+'</td></tr>';
      }).join('');
    return '<div><h2 class="bk-h">'+esc(title)+'</h2><div class="scrollx" tabindex="0" role="region" aria-label="'+esc(title)+' table"><table class="bk-table nd-table"><thead><tr><th>#</th><th class="bk-name">Broker</th><th>Qty (shares)</th><th>Value</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }
  var activeN = (s.netflow && Object.keys(s.netflow).length)
    ? Object.keys(s.netflow).length
    : Object.keys(union(s.buyers,s.sellers)).length;
  /* Legacy netflow-only shapes: derive the top buyer/seller lists from
     netflow so this tab works instead of throwing.
     netflow entries: [net_qty, net_value, buy_qty, buy_value, sell_qty, sell_value] */
  var buyers = s.buyers, sellers = s.sellers;
  if ((!buyers || !Object.keys(buyers).length) && (!sellers || !Object.keys(sellers).length) && s.netflow){
    buyers = {}; sellers = {};
    Object.keys(s.netflow).forEach(function(c){
      var v = s.netflow[c] || [];
      if ((v[3]||0) > 0) buyers[c] = [v[2]||0, v[3]||0];
      if ((v[5]||0) > 0) sellers[c] = [v[4]||0, v[5]||0];
    });
  }
  return '<h2 class="bk-h">'+esc(sym)+' — trade pattern, '+esc(label())+'</h2>'+
    '<div class="stat-row">'+
    '<div class="stat"><div class="l">Total quantity</div><div class="v">'+fmtN(s.qty,0)+'</div></div>'+
    '<div class="stat"><div class="l">Total value</div><div class="v">'+fmtV(s.value)+'</div></div>'+
    '<div class="stat"><div class="l">Average rate</div><div class="v">Rs '+fmtN(s.avg_rate)+'</div></div>'+
    '<div class="stat"><div class="l">Brokers active</div><div class="v">'+activeN+'</div></div></div>'+
    '<div class="two">'+bt(buyers,'Top buyers')+bt(sellers,'Top sellers')+'</div>';
}

function renderHoldings(d){
  var sym = $('symbolSel').value;
  if(!sym) return '<div class="cover">Pick a stock above to see broker net positions (flow-based).</div>';
  var s = d.symbols[sym];
  if(!s) return '<div class="cover">No trades for '+esc(sym)+' in this period.</div>';
  var net = {};
  /* netflow entries: [net_qty, net_value, buy_qty, buy_value, sell_qty, sell_value];
     tolerate legacy [net_qty, net_value] and value-only schemas */
  function pair6(v){
    if(!Array.isArray(v)) return [0, v||0, 0, 0, 0, 0];
    return [v[0]||0, v[1]||0, v[2]||0, v[3]||0, v[4]||0, v[5]||0];
  }
  function qv(v){ return Array.isArray(v) ? v : [0, v||0]; }
  if (s.netflow && Object.keys(s.netflow).length){
    Object.keys(s.netflow).forEach(function(c){ net[c] = pair6(s.netflow[c]); });
  } else {
    Object.keys(s.buyers||{}).forEach(function(c){ var v=qv(s.buyers[c]);
      var e = net[c] = net[c] || [0,0,0,0,0,0]; e[2]+=v[0]; e[3]+=v[1]; e[0]+=v[0]; e[1]+=v[1]; });
    Object.keys(s.sellers||{}).forEach(function(c){ var v=qv(s.sellers[c]);
      var e = net[c] = net[c] || [0,0,0,0,0,0]; e[4]+=v[0]; e[5]+=v[1]; e[0]-=v[0]; e[1]-=v[1]; });
  }
  var PER_PAGE = 10;
  var all = Object.keys(net).map(function(c){return [c,net[c]]});
  var hget = {
    broker: function(x){ return bname(x[0]).toLowerCase(); },
    code: function(x){ return numCode(x[0]); },
    buy_qty: function(x){ return x[1][2]; },
    buy_value: function(x){ return x[1][3]; },
    sell_qty: function(x){ return x[1][4]; },
    sell_value: function(x){ return x[1][5]; },
    net_qty: function(x){ return x[1][0]; },
    net_value: function(x){ return x[1][1]; }
  };
  var hs = sortState('holdings');
  if(!hs.key){ hs.key = 'net_value'; hs.dir = -1; }
  all = applySort(all, 'holdings', hget);
  var totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  if (state.holdPage >= totalPages) state.holdPage = totalPages - 1;
  if (state.holdPage < 0) state.holdPage = 0;
  var start = state.holdPage * PER_PAGE;
  var rows = all.slice(start, start + PER_PAGE)
    .map(function(x){
      var n = x[1], nq = n[0], nv = n[1];
      var tag = nv>0?'<span class="pos">accumulating</span>':'<span class="neg">distributing</span>';
      return '<tr><td class="bk-name">'+esc(bname(x[0]))+'</td><td>'+esc(x[0])+'</td>'+
        '<td>'+fmtQ(n[2],n[3])+'</td><td>'+fmtV(n[3])+'</td>'+
        '<td>'+fmtQ(n[4],n[5])+'</td><td>'+fmtV(n[5])+'</td>'+
        '<td>'+fmtQ(nq,Math.abs(nv))+'</td><td class="'+cls(nv)+'">'+fmtV(nv)+'</td><td>'+tag+'</td></tr>';
    }).join('');
  return '<h2 class="bk-h">'+esc(sym)+' — stockwise broker flow, '+esc(label())+'</h2>'+
    '<p style="font-size:.85rem;color:var(--nd-dim)">Every broker that traded this stock, netted over the period. Net bought = accumulating · net sold = distributing (by transaction value). This is transaction flow, not verified shareholding.</p>'+
    '<div class="scrollx" tabindex="0" role="region" aria-label="'+esc(sym)+' stockwise broker flow table"><table class="bk-table nd-table"><thead><tr>'+
    thS('holdings','broker','Broker','bk-name')+thS('holdings','code','Code')+thS('holdings','buy_qty','Buy qty')+thS('holdings','buy_value','Buy value')+
    thS('holdings','sell_qty','Sell qty')+thS('holdings','sell_value','Sell value')+thS('holdings','net_qty','Net qty')+thS('holdings','net_value','Net value')+
    '<th>Flow</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+pager(state.holdPage, totalPages, all.length, '', 'hdPrev', 'hdNext');
}

function renderAccDist(d){
  var PER_PAGE = 10;
  var search = (state.accSearch || '').toUpperCase();
  function filterList(list){
    if(!search) return list;
    return list.filter(function(x){ return (x.symbol||'').toUpperCase().indexOf(search) >= 0; });
  }
  function tbl(list, title, good, pageKey){
    var view = pageKey === 'accPage' ? 'acc' : 'dist';
    var aget = {
      stock: function(x){ return x.symbol; },
      broker: function(x){ return bname(x.broker).toLowerCase(); },
      net_qty: function(x){ return x.net_qty||0; },
      net_value: function(x){ return x.net_value||0; }
    };
    var filtered = applySort(filterList(list).slice(), view, aget);
    var totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    var pg = state[pageKey] || 0;
    if(pg >= totalPages) pg = totalPages - 1;
    if(pg < 0) pg = 0;
    state[pageKey] = pg;
    var start = pg * PER_PAGE;
    var page = filtered.slice(start, start + PER_PAGE);
    var rows = page.map(function(x,i){
      return '<tr><td>'+(start+i+1)+'</td><td><strong>'+esc(x.symbol)+'</strong></td><td class="bk-name">'+esc(bname(x.broker))+'</td>'+
        '<td>'+fmtQ(x.net_qty,Math.abs(x.net_value))+'</td><td class="'+(good?'pos':'neg')+'">'+fmtV(x.net_value)+'</td></tr>';
    }).join('');
    return '<div><h2 class="bk-h">'+esc(title)+'</h2><div class="scrollx" tabindex="0" role="region" aria-label="'+esc(title)+' table"><table class="bk-table nd-table"><thead><tr><th>#</th>'+
      thS(view,'stock','Stock')+thS(view,'broker','Broker','bk-name')+thS(view,'net_qty','Net qty')+thS(view,'net_value','Net value')+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>'+pagerK(pg, totalPages, filtered.length, pageKey)+'</div>';
  }
  var searchBox = '<div style="margin:0 0 12px;"><input id="accSearch" type="text" aria-label="Search symbol" placeholder="Search symbol (e.g. NABIL)…" value="'+esc(state.accSearch||'')+'" style="padding:8px 12px;border-radius:8px;width:250px;"></div>';
  return searchBox+'<div class="two">'+tbl(d.accumulation||[],'Accumulating — top net bought',true,'accPage')+tbl(d.distribution||[],'Distributing — top net sold',false,'distPage')+'</div>';
}

/* ---------- provisional view (symbol-only intraday totals) ---------- */
function renderProvisional(d){
  var syms = Object.keys(d.symbols||{}).map(function(s){
    var v = d.symbols[s] || {};
    return { s: s, trades: v.trades||0, qty: v.qty||0, amount: v.amount||0 };
  }).sort(function(a,b){ return b.amount - a.amount; });
  var PER_PAGE = 25;
  var totalPages = Math.max(1, Math.ceil(syms.length / PER_PAGE));
  if (state.provPage >= totalPages) state.provPage = totalPages - 1;
  if (state.provPage < 0) state.provPage = 0;
  var start = state.provPage * PER_PAGE;
  var rows = syms.slice(start, start + PER_PAGE).map(function(r,i){
    return '<tr><td>'+(start+i+1)+'</td><td><strong><a href="/stocks/'+esc(r.s)+'/">'+esc(r.s)+'</a></strong></td>'+
      '<td>'+fmtN(r.trades,0)+'</td><td>'+fmtN(r.qty,0)+'</td><td>'+fmtV(r.amount)+'</td></tr>';
  }).join('');
  var asof = String(d.asof||'');
  return '<div class="bk-prov"><strong>PROVISIONAL</strong> — intraday symbol-only totals, no broker split. '+
    'Broker-split views (top brokers, broker pattern, holdings, accumulation/distribution) resume with the final session — switch to 1D for the last final session.</div>'+
    '<h2 class="bk-h">Intraday symbol totals — provisional ' + esc(d.date||'') + '</h2>'+
    '<div class="stat-row">'+
    '<div class="stat"><div class="l">Symbols traded</div><div class="v">'+syms.length+'</div></div>'+
    '<div class="stat"><div class="l">Trades captured</div><div class="v">'+fmtN(d.source_trades||0,0)+'</div></div>'+
    '<div class="stat"><div class="l">Quantity</div><div class="v">'+fmtN(d.total_qty||0,0)+'</div></div>'+
    '<div class="stat"><div class="l">Amount (partial)</div><div class="v">'+fmtV(d.total_amount||0)+'</div></div></div>'+
    '<p style="font-size:.85rem;color:var(--nd-dim)">Partial capture as of '+esc(asof.slice(11,16))+' NPT — the final session total publishes after close. This is transaction flow, not verified shareholding.</p>'+
    '<div class="scrollx" tabindex="0" role="region" aria-label="Provisional intraday symbol totals table"><table class="bk-table nd-table"><thead><tr><th>#</th><th>Symbol</th><th>Trades</th><th>Qty (shares)</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    pager(state.provPage, totalPages, syms.length, '', 'pvPrev', 'pvNext');
}

/* ---------- viz (real data only, numbers printed beside every bar) ---------- */
/* Viz labels use a short form (legal suffixes stripped) so bar labels
   stay readable; tables always carry the full registered name. */
function shortName(n){
  /* Suffix strip: "PVT. LTD." / "LTD" (no dot) both occur. The suffix must
     be a standalone word (\s+ … \b) so "COMPANY" never loses its "CO".
     A dangling "and" (e.g. "…Investment and Securities…") is trimmed. */
  var s = String(n || '').replace(/\s*Securities.*$/i, '').replace(/\s+(Co\.?|Pvt\.?|Ltd\.?)\b.*$/i, '').replace(/\s+(and|&)$/i, '').trim();
  return s || n;
}
function rankRows(items, maxV, fmt){
  return items.map(function(it){
    var w = maxV ? Math.max(0, Math.min(100, Math.abs(it.v)/maxV*100)) : 0;
    return '<div class="bk-rank"><span class="bk-rl">'+esc(it.l)+'</span><span class="bk-track"><i class="bk-fill'+(it.neg?' neg':'')+'" style="--w:'+w.toFixed(1)+'%"></i></span><span class="bk-rv">'+fmt(it.v)+'</span></div>';
  }).join('');
}
function renderViz(d){
  var el = $('bkViz'); if(!el) return;
  if (d && d._mode === 'provisional'){
    el.innerHTML = '<div class="bk-viz"><div class="bk-viz-card"><h3>Provisional coverage</h3><p class="bk-cap">Partial intraday capture — final totals publish after close.</p>'+
      '<div class="bk-totals"><span>Symbols <b>'+Object.keys(d.symbols||{}).length+'</b></span><span>Trades <b>'+fmtN(d.source_trades||0,0)+'</b></span><span>Amount <b>'+fmtV(d.total_amount||0)+'</b></span></div></div></div>';
    return;
  }
  var brokers = (d.brokers||[]).slice();
  if (!brokers.length){ el.innerHTML = ''; return; }
  var tot = brokers.reduce(function(a,b){ return a + (b.total||0); }, 0);
  var top = brokers.slice().sort(function(a,b){ return (b.total||0)-(a.total||0); }).slice(0,8);
  var topShare = top.reduce(function(a,b){ return a + (b.total||0); }, 0);
  var nets = brokers.map(function(b){ return { l: shortName(bname(b.code)), v: b.net||0, neg: (b.net||0) < 0 }; });
  var buyers = nets.filter(function(x){ return x.v > 0; }).sort(function(a,b){ return b.v - a.v; }).slice(0,5);
  var sellers = nets.filter(function(x){ return x.v < 0; }).sort(function(a,b){ return a.v - b.v; }).slice(0,5);
  var maxNet = Math.max.apply(null, nets.map(function(x){ return Math.abs(x.v); }).concat([0]));
  var buySum = brokers.reduce(function(a,b){ return a + (b.buy_value||0); }, 0);
  el.innerHTML = '<div class="bk-viz">'+
    '<div class="bk-viz-card"><h3>Top brokers by turnover</h3><p class="bk-cap">Share of broker turnover (buy + sell) in this period. Top 8 hold '+fmtN(tot ? topShare/tot*100 : 0, 1)+'%.</p>'+
    rankRows(top.map(function(b){ return { l: shortName(bname(b.code)), v: b.total||0 }; }), top.length ? top[0].total||0 : 0, fmtV)+'</div>'+
    '<div class="bk-viz-card"><h3>Net flow extremes</h3><p class="bk-cap">Largest net buyers (lime) and net sellers (red) by transaction value. Measured flow, not a forecast.</p>'+
    rankRows(buyers, maxNet, fmtV)+rankRows(sellers, maxNet, fmtV)+'</div></div>'+
    '<div class="bk-totals"><span>Sessions <b>'+esc(d.trading_days||'')+'</b></span><span>Brokers <b>'+brokers.length+'</b></span><span>Symbols <b>'+Object.keys(d.symbols||{}).length+'</b></span><span>Turnover <b>'+fmtV(buySum)+'</b></span></div>';
}

function label(){
  if(state.period==='range'){
    var dd = state.data;
    return state.rangeFrom+' → '+state.rangeTo+
      (dd && dd.trading_days ? ' ('+dd.trading_days+' sessions)' : '');
  }
  if(state.period==='latest'){
    var d = state.data;
    if (d && d._mode === 'provisional'){
      var a = String(d.asof||'');
      return 'provisional today (as of '+a.slice(11,16)+' NPT)';
    }
    if (d && (d._mode === 'fallback' || d._mode === 'final')){
      var ds = d.to ? String(d.to).slice(0,10) : 'last session';
      return d._mode === 'final' ? "today's final session ("+ds+')' : 'last session ('+ds+')';
    }
    return 'live today';
  }
  if(state.period==='asof') return state.asof;
  var dd = state.data;
  return dd && dd.from ? dd.from+' → '+dd.to+' ('+dd.trading_days+' sessions)' : state.period;
}

var _searchTimer = null;
/* Debounced re-render for search inputs: waits until the user pauses typing,
   then re-renders and restores focus + caret so typing stays fluid. */
function debounceRender(focusId){
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function(){
    _searchTimer = null;
    render();
    var el = focusId ? $(focusId) : null;
    if (el){
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch(e){}
    }
  }, 250);
}

function render(){
  var d = state.data; if(!d) return;
  /* Rebuild the stock dropdown from the current dataset, then restore the
     user's pick (kept in state) so period changes never lose the selection. */
  var sel = $('symbolSel');
  sel.innerHTML = '<option value="">Select stock…</option>';
  var syms = symbolOptions(d);
  syms.forEach(function(s){ var o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
  if(state.symbol){
    /* Keep the picked symbol visible even when this period has no trades for
       it — the view then shows its honest "No trades … in this period" state. */
    if(syms.indexOf(state.symbol)<0){
      var o=document.createElement('option'); o.value=state.symbol; o.textContent=state.symbol; sel.appendChild(o);
    }
    sel.value = state.symbol;
  } else {
    sel.value = '';
  }
  /* Restore the broker pick (options come from brokers.json, stable across periods);
     drop it if the code is no longer listed. */
  var bsel = $('brokerSel');
  if(state.broker){
    var ok = false, i;
    for(i=0;i<bsel.options.length;i++){ if(bsel.options[i].value===state.broker){ ok=true; break; } }
    if(ok) bsel.value = state.broker;
    else { bsel.value=''; state.broker=null; }
  } else {
    bsel.value = '';
  }
  renderViz(d);
  var html = '';
  /* Splits provisional files carry genuine broker splits, so they render
     through the normal view dispatch (top/broker/stock/holdings/accdist)
     exactly like final data. Only symbol-only provisional files (or a
     splits-shaped file with no brokers, defensively) take the symbol
     totals view. */
  if (d._mode === 'provisional' && !(d.symbol_only === false && (d.brokers || []).length)) html = renderProvisional(d);
  else if(state.view==='top') html = renderTop(d);
  else if(state.view==='broker') html = renderBroker(d);
  else if(state.view==='stock') html = renderStock(d);
  else if(state.view==='holdings') html = renderHoldings(d);
  else html = renderAccDist(d);
  $('view').innerHTML = html;
  /* Pagination handlers for Top Brokers / Holdings / Broker views */
  var bp = $('bkPrev'), bn = $('bkNext');
  if (bp) bp.addEventListener('click', function(){ if(state.topPage>0){ state.topPage--; render(); } });
  if (bn) bn.addEventListener('click', function(){ if(state.topPage<9999){ state.topPage++; render(); } });
  var hp = $('hdPrev'), hn = $('hdNext');
  if (hp) hp.addEventListener('click', function(){ if(state.holdPage>0){ state.holdPage--; render(); } });
  if (hn) hn.addEventListener('click', function(){ if(state.holdPage<9999){ state.holdPage++; render(); } });
  var rp = $('brPrev'), rn = $('brNext');
  if (rp) rp.addEventListener('click', function(){ if(state.brkPage>0){ state.brkPage--; render(); } });
  if (rn) rn.addEventListener('click', function(){ if(state.brkPage<9999){ state.brkPage++; render(); } });
  var pp = $('pvPrev'), pn = $('pvNext');
  if (pp) pp.addEventListener('click', function(){ if(state.provPage>0){ state.provPage--; render(); } });
  if (pn) pn.addEventListener('click', function(){ if(state.provPage<9999){ state.provPage++; render(); } });
  var bsq = $('brokerSymSearch');
  if (bsq){
    if (document.activeElement !== bsq) bsq.value = state.brkQuery||'';
    bsq.oninput = function(){
      state.brkQuery = this.value; state.brkPage = 0;
      debounceRender('brokerSymSearch');
    };
  }
  var asq = $('accSearch');
  if (asq){
    if (document.activeElement !== asq) asq.value = state.accSearch||'';
    asq.oninput = function(){
      state.accSearch = this.value; state.accPage = 0; state.distPage = 0;
      debounceRender('accSearch');
    };
  }
  document.querySelectorAll('.accPrev').forEach(function(btn){
    btn.addEventListener('click', function(){ var k=btn.getAttribute('data-k'); if(state[k]>0){ state[k]--; render(); } });
  });
  document.querySelectorAll('.accNext').forEach(function(btn){
    btn.addEventListener('click', function(){ var k=btn.getAttribute('data-k'); state[k]++; render(); });
  });
  document.querySelectorAll('#view th[data-sort]').forEach(function(th){
    th.addEventListener('click', function(){
      var parts = th.getAttribute('data-sort').split(':'), v = parts[0], k = parts[1];
      var s = sortState(v);
      if (s.key === k) s.dir *= -1;
      else { s.key = k; s.dir = /^(broker|symbol|stock|code)$/.test(k) ? 1 : -1; }
      var pk = sortPageKey[v];
      if (pk) state[pk] = 0;
      render();
    });
  });
  syncURL();
}

function syncControls(){
  var v = state.view;
  $('viewControls').style.display = (v==='top'||v==='accdist') ? 'none' : 'flex';
  $('brokerSel').style.display = v==='broker' ? '' : 'none';
  $('brokerSymSearch').style.display = v==='broker' ? '' : 'none';
  var showSym = (v==='stock'||v==='holdings');
  $('symbolSel').style.display = showSym ? '' : 'none';
}

/* ---------- sector block (same pattern as news/actions) ---------- */
function initSector(){
  var sel = document.getElementById('bkSecSelect');
  if (!sel) return;
  var sum = document.getElementById('bkSecSum');
  var body = document.getElementById('bkSecBody');
  var prev = document.getElementById('bkSecPrev');
  var next = document.getElementById('bkSecNext');
  var show = document.getElementById('bkSecShowing');
  var rows = [], filter = 'All', page = 1, PER = 25;
  function renderSec(){
    var list = filter === 'All' ? rows : rows.filter(function(r){ return r.sec === filter; });
    var pages = Math.max(1, Math.ceil(list.length / PER));
    if (page > pages) page = pages;
    var slice = list.slice((page - 1) * PER, page * PER);
    body.innerHTML = slice.map(function(r){
      return '<tr><td><a href="/stocks/' + esc(r.s) + '/">' + esc(r.s) + '</a></td>' +
        '<td>' + esc(r.n) + '</td><td>' + esc(r.sec) + '</td></tr>';
    }).join('');
    if (sum) sum.textContent = list.length + ' stocks';
    if (show) show.textContent = list.length
      ? 'Showing ' + ((page - 1) * PER + 1) + '–' + Math.min(page * PER, list.length) + ' of ' + list.length
      : 'No stocks in this sector';
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pages;
  }
  sel.addEventListener('change', function(){ filter = sel.value; page = 1; renderSec(); });
  if (prev) prev.addEventListener('click', function(){ if (page > 1){ page--; renderSec(); } });
  if (next) next.addEventListener('click', function(){ page++; renderSec(); });
  Promise.all([
    fetch('/nepse-chart/data/verdicts.json').then(function(r){ return r.json(); }),
    fetch('/nepse-chart/data/universe.json').then(function(r){ return r.json(); })
  ]).then(function(res){
    var vd = res[0].verdicts || {};
    /* Universe symbols is a LIST of {s,n,t,o} — build the name map. */
    var uniMap = {};
    (res[1].symbols || []).forEach(function(e){ if (e && e.s) uniMap[e.s] = e.n; });
    rows = Object.keys(vd).sort().map(function(k){
      /* Company names come from the universe (n), never verdicts n —
         verdicts n is a count (the blog block's mislabel bug). */
      return { s: k, n: uniMap[k] || k, sec: vd[k].sec || 'Others' };
    });
    var counts = {};
    rows.forEach(function(r){ counts[r.sec] = (counts[r.sec] || 0) + 1; });
    var opts = ['<option value="All">All sectors (' + rows.length + ')</option>'];
    Object.keys(counts).sort().forEach(function(sec){
      opts.push('<option value="' + esc(sec) + '">' + esc(sec) + ' (' + counts[sec] + ')</option>');
    });
    sel.innerHTML = opts.join('');
    renderSec();
  }).catch(function(){ /* sector block stays empty; never errors */ });
}

$('viewTabs').addEventListener('click', function(e){
  var b = e.target.closest('button'); if(!b) return;
  document.querySelectorAll('#viewTabs button').forEach(function(x){x.classList.remove('active')});
  b.classList.add('active'); state.view = b.dataset.view; syncControls(); syncURL(); render();
});
$('periodBar').addEventListener('click', function(e){
  var b = e.target.closest('button'); if(!b || !b.dataset.p) return; /* Apply carries no data-p */
  document.querySelectorAll('#periodBar button').forEach(function(x){x.classList.remove('active')});
  b.classList.add('active'); state.period = b.dataset.p; state.asof = null; state.holdPage = 0; state.brkPage = 0; state.brkQuery = ''; $('asofDate').value='';
  /* Selections live in state and are restored by render() — never wipe them here. */
  syncURL();
  if (b.dataset.p === 'range'){
    /* Range needs dates + Apply: re-show a previously applied range if
       one exists, else prompt for dates instead of loading blindly. */
    if (state.rangeFrom && state.rangeTo) loadPeriod();
    else $('view').innerHTML = '<div class="cover">Pick a from and to date, then Apply.</div>';
    return;
  }
  loadPeriod();
});
var bkRangeApply = $('bkRangeApply');
if (bkRangeApply) bkRangeApply.addEventListener('click', function(){
  var f = $('bkRangeFrom').value, t = $('bkRangeTo').value;
  document.querySelectorAll('#periodBar button').forEach(function(x){x.classList.toggle('active', x.dataset.p === 'range')});
  state.period = 'range'; state.asof = null; $('asofDate').value='';
  if (!f || !t){ $('view').innerHTML = '<div class="cover">Pick a from and to date, then Apply.</div>'; syncURL(); return; }
  state.rangeFrom = f; state.rangeTo = t; state.holdPage = 0; state.brkPage = 0; state.brkQuery = '';
  syncURL();
  loadPeriod();
});
$('asofDate').addEventListener('change', function(e){
  if(!e.target.value) return;
  document.querySelectorAll('#periodBar button').forEach(function(x){x.classList.remove('active')});
  state.period = 'asof'; state.asof = e.target.value;
  syncURL();
  loadPeriod();
});
$('brokerSel').addEventListener('change', function(){ state.broker = this.value || null; state.brkPage = 0; state.brkQuery = ''; syncURL(); render(); });
$('symbolSel').addEventListener('change', function(){ state.symbol = this.value || null; state.holdPage = 0; syncURL(); render(); });

initFromURL();
syncStaticControls();
loadMeta().then(function(){
  /* Validate the broker pick once the options exist (from brokers.json). */
  if(state.broker){
    var bsel = $('brokerSel'), ok = false, i;
    for(i=0;i<bsel.options.length;i++){ if(bsel.options[i].value===state.broker){ ok=true; break; } }
    if(ok) bsel.value = state.broker; else state.broker = null;
  }
  syncControls();
  labelSnapshot();
  initSector();
  return loadPeriod();
});
/* Auto-refresh: re-fetch the current view every 60s (skipped while the tab
   is hidden). The provisional feed rebuilds every 15 min during market
   hours, so a page left open picks up the fresh snapshot without a
   reload. Change-gated — an unchanged payload moves only the freshness
   line; errors keep the last good render on screen. */
setInterval(function(){
  if (document.hidden) return;
  loadPeriod(true);
}, 60000);
})();
