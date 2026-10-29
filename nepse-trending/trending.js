/* trending.js — /nepse-trending/ interactive ranking (teardown rebuild).
   Sources: nepse-chart/data/trending.json (board) + live.json (tape) +
   trending-research.json (lazy research panels). No other fetches.
   ADJUSTED-DAY RULE (audit condition 1): the board's Day % never uses
   the builder's raw prior close. It is repainted from the exchange
   adjusted reference in live.json (previous_close + percent_change),
   mirroring the VPI MEN fix and the engine-verdict/screener repaint:
   price + Day % only; score, turnover, 5d %, tone, reasons, spark are
   NEVER repainted. change_pct in trending.json is 1-day by the
   builder's own definition (build_trending_value.py: "1-day change:
   today vs previous session"); ret_5d_pct is 5-day. Every % on this
   page carries its window label; the hero falls back to 5d only with
   an explicit "(5d)" tag. */
(function(){
"use strict";
var BASE = '/nepse-chart/data/';
var PAGE_SIZE = 25;
var state = { tone: 'all', sector: 'all', sort: 'score', dir: -1, search: '', page: 1,
  rows: [], meta: null, tape: null, tapeSession: null, research: null };
var $ = function(id){ return document.getElementById(id); };

function fmt(n, d){ d = d===undefined?2:d; if(n===null||n===undefined||!isFinite(n)) return '–';
  return Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function cls(v){ return v>0?'pos':(v<0?'neg':''); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function finite(n){ return n!==null && n!==undefined && isFinite(n); }
/* NPT date (en-CA) for epoch-ms asofs; ISO asofs keep their own date part. */
function nptDate(ms){
  try { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kathmandu',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms)); }
  catch(e){ var d = new Date(ms); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
}
function tapeSessionOf(live){
  if(!live || live.asof===undefined || live.asof===null) return null;
  if(typeof live.asof === 'number') return nptDate(live.asof);
  return String(live.asof).slice(0,10);
}
function hhmm(d){
  try { return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kathmandu',hour:'2-digit',minute:'2-digit'}).format(d); }
  catch(e){ return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
}
function nextTick(d){ var n = new Date(d.getTime()+60000); return hhmm(n); }

var TONE_LABEL = { accumulation: ['tone-acc','Accumulation interest'], distribution: ['tone-dist','Distribution pressure'], watch: ['tone-watch','Watch'] };

/* ---- Adjusted-day repaint (page-level, never the builder) ---- */
function enrichRows(rows, live){
  var qmap = {};
  if(live && live.quotes){
    live.quotes.forEach(function(q){ if(q && q.symbol) qmap[q.symbol] = q; });
  }
  var tapeOk = !!(live && state.tapeSession && state.meta && state.tapeSession === state.meta.asof);
  var nDayRep = 0, nPriceRep = 0;
  rows.forEach(function(s){
    var q = qmap[s.symbol];
    s._ltp = s.ltp; s._day = s.change_pct; s._dayRep = false; s._priceRep = false;
    if(!tapeOk || !q) return;
    if(finite(q.ltp) && finite(q.previous_close) && q.previous_close > 0){
      var day = finite(q.percent_change) ? q.percent_change : (q.ltp - q.previous_close) / q.previous_close * 100;
      s._ltp = q.ltp;
      s._day = Math.round(day * 100) / 100;
      if(finite(s.ltp) && Math.abs(q.ltp - s.ltp) >= 0.005) s._priceRep = true;
      if(finite(s.change_pct) && Math.abs(s._day - s.change_pct) >= 0.01){ s._dayRep = true; nDayRep++; }
      if(s._priceRep) nPriceRep++;
    }
  });
  return { dayRep: nDayRep, priceRep: nPriceRep, tapeOk: tapeOk };
}

/* ---- Signature + refresh (change-gated, re-baseline never null) ---- */
var sig = null;
/* Tape fingerprint: any quote's LTP / % / previous_close moving must
   re-render the tick. Without it the signature only saw session dates
   and counts, so intraday tape moves in the same session would never
   paint — the page would sit on stale prices all day. Cheap djb2-style
   hash over the quote fields the repaint reads; collisions only risk
   a skipped minute, never a wrong figure. */
function tapeHash(){
  var q = (state.tape && state.tape.quotes) || [];
  var s = '', h = 0;
  for(var i = 0; i < q.length; i++){
    var x = q[i]; if(!x || !x.symbol) continue;
    s += x.symbol + ':' + x.ltp + ':' + x.percent_change + ':' + x.previous_close + ';';
  }
  for(var j = 0; j < s.length; j++){ h = ((h << 5) - h + s.charCodeAt(j)) | 0; }
  return h;
}
function computeSig(){
  var tones = {accumulation:0, distribution:0, watch:0};
  var secs = {};
  state.rows.forEach(function(s){
    if(tones[s.tone]!==undefined) tones[s.tone]++;
    secs[s.sector] = (secs[s.sector]||0)+1;
  });
  return [state.meta ? state.meta.asof : '', state.rows.length,
    tones.accumulation, tones.distribution, tones.watch,
    Object.keys(secs).sort().map(function(k){ return k+'='+secs[k]; }).join(','),
    state.tapeSession || '', state.research ? state.research.asof : '',
    tapeHash()].join('|');
}
function rebaseline(){ sig = computeSig(); }
function renderFresh(){
  var el = $('trFresh'); if(!el) return;
  var now = new Date();
  var tape = state.tapeSession ? state.tapeSession : 'tape unavailable';
  el.innerHTML = '<span class="tr-pulse" aria-hidden="true"></span>Ranking as of ' + esc(state.meta ? state.meta.asof : '—') +
    ' · tape ' + esc(tape) + ' · checked ' + hhmm(now) + ' · next check ' + nextTick(now) +
    ' · refreshes every 60s when the data changes';
}

function sparkline(cv, data, up){
  if(!cv || !data || data.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var W = 120, H = 36;
  cv.width = W*dpr; cv.height = H*dpr; cv.style.width = W+'px'; cv.style.height = H+'px';
  var c = cv.getContext('2d'); c.scale(dpr, dpr);
  c.clearRect(0,0,W,H);
  var mn = Math.min.apply(null,data), mx = Math.max.apply(null,data), rg = (mx-mn)||1;
  c.beginPath();
  data.forEach(function(v,i){
    var x = 2 + i*(W-4)/(data.length-1);
    var y = 3 + (1-(v-mn)/rg)*(H-6);
    if(i===0) c.moveTo(x,y); else c.lineTo(x,y);
  });
  c.strokeStyle = up ? '#4ADE80' : '#F87171'; c.lineWidth = 1.6; c.stroke();
  c.lineTo(W-2,H); c.lineTo(2,H); c.closePath();
  c.fillStyle = up ? 'rgba(74,222,128,.12)' : 'rgba(248,113,113,.12)'; c.fill();
  var lx = 2 + (data.length-1)*(W-4)/(data.length-1), ly = 3 + (1-(data[data.length-1]-mn)/rg)*(H-6);
  c.beginPath(); c.arc(lx-2,ly,2.6,0,7); c.fillStyle = up ? '#4ADE80' : '#F87171'; c.fill();
}

/* Score decomposition (same capped formula as the builder, for the title). */
function scoreTitle(s){
  var ct = Math.min(Math.max(s.turnover_ratio||0,0),5)/5*35;
  var cv = Math.min(Math.max(s.volume_ratio||0,0),5)/5*20;
  var cm = Math.min(Math.max(s.ret_5d_pct||0,0),15)/15*20;
  var cc = Math.min(Math.max(s.broker_conc_pct||0,0),25)/25*15;
  var cn = Math.min(Math.max(s.news_7d||0,0),5)/5*10;
  return 'Score ' + fmt(s.score,1) + ' = turnover ' + fmt(s.turnover_ratio,1) + '× (' + ct.toFixed(1) +
    ') + volume ' + fmt(s.volume_ratio,1) + '× (' + cv.toFixed(1) +
    ') + 5d ' + fmt(s.ret_5d_pct,1) + '% (' + cm.toFixed(1) +
    ') + broker ' + fmt(s.broker_conc_pct,1) + '% (' + cc.toFixed(1) +
    ') + news ' + (s.news_7d||0) + ' (' + cn.toFixed(1) + '). Inputs capped as documented.';
}

/* ---- Filtering (search runs over the full set, then paginate) ---- */
function filtered(){
  var q = state.search.trim().toLowerCase();
  var r = state.rows.filter(function(s){
    if(state.tone!=='all' && s.tone!==state.tone) return false;
    if(state.sector!=='all' && s.sector!==state.sector) return false;
    if(q && (s.symbol||'').toLowerCase().indexOf(q)===-1 && (s.name||'').toLowerCase().indexOf(q)===-1) return false;
    return true;
  });
  var k = state.sort, d = state.dir;
  function val(s){
    if(k==='_ltp') return s._ltp;
    if(k==='_day') return s._day;
    return s[k];
  }
  function cmp(a,b){
    var va = val(a), vb = val(b);
    if(va===null || va===undefined || !isFinite(va)) return 1;   /* nulls always last */
    if(vb===null || vb===undefined || !isFinite(vb)) return -1;
    if(typeof va === 'string') return va.localeCompare(vb)*d;
    return (va-vb)*d;
  }
  r.sort(cmp);
  /* Exact symbol matches rank first (typing MEN surfaces MEN, not MCHL). */
  if(q){
    var ex = r.filter(function(s){ return (s.symbol||'').toLowerCase() === q; });
    if(ex.length) r = ex.concat(r.filter(function(s){ return (s.symbol||'').toLowerCase() !== q; }));
  }
  return r;
}
function dayCell(s){
  if(!finite(s._day)) return '<span class="cx-chip flat">—</span>';
  var mark = s._dayRep ? '<span class="tr-live-dot" title="Day % repainted from the adjusted tape reference, ' + esc(state.tapeSession||'') + '"></span>' : '';
  return '<span class="cx-chip '+(s._day>0?'up':s._day<0?'down':'flat')+'">'+(s._day>0?'+':'')+fmt(s._day)+'%</span>'+mark;
}
function heroChg(s){
  if(finite(s._day)){
    return { txt: (s._day>0?'+':'')+fmt(s._day)+'%', cls: cls(s._day), tag: 'Day %' };
  }
  if(finite(s.ret_5d_pct)){
    return { txt: (s.ret_5d_pct>0?'+':'')+fmt(s.ret_5d_pct)+'% (5d)', cls: cls(s.ret_5d_pct), tag: '5d % (Day % unavailable)' };
  }
  return { txt: '–', cls: '', tag: 'Day %' };
}

/* ---- Snapshot Day % repaint (same adjusted rule as the board) ----
   The baked snapshot between SNAP-START/SNAP-END carries the builder's
   raw prior-close Day % (and the baker rewrites that section on every
   run, so the fix cannot live in the baked markup). On load, and on
   every re-render, each snapshot Day % cell is repainted from the same
   enriched board rows the interactive table uses — but ONLY while the
   tape session matches the board session. When the tape moves on (or
   is unavailable) the baked cells are restored from their saved
   originals, so the snapshot never shows a mixed-session figure.
   The baked orientation note ("ranking below") is also corrected at
   render time: the snapshot moved below the board in this teardown,
   while the baker template still says "below" (template fix flagged
   in the brief — the rendered page must not wait for it). */
function repaintSnapshot(){
  var tbody = document.querySelector('.tr-snapwrap .snap tbody');
  var outer = document.querySelector('.tr-snapwrap > p.snap-note');
  var inner = document.querySelector('.tr-snapwrap .snap .snap-note');
  if(inner && inner.textContent.indexOf('ranking below') !== -1){
    inner.textContent = inner.textContent.replace('ranking below', 'ranking above');
  }
  if(!tbody) return;
  var tapeOk = !!(state.tape && state.tapeSession && state.meta && state.tapeSession === state.meta.asof);
  var bySym = {};
  state.rows.forEach(function(s){ bySym[s.symbol] = s; });
  var nRep = 0;
  var rows = tbody.querySelectorAll('tr');
  rows.forEach(function(tr){
    var link = tr.querySelector('a.symlink'); if(!link) return;
    var m = (link.getAttribute('href') || '').match(/\/stocks\/([^\/]+)\//); if(!m) return;
    var s = bySym[m[1]]; if(!s) return;
    var cell = tr.cells[3]; if(!cell) return;
    if(cell.dataset.baked === undefined){ cell.dataset.baked = cell.innerHTML; cell.dataset.bakedCls = cell.className; }
    if(tapeOk && s._dayRep){
      cell.className = 'num ' + cls(s._day);
      cell.innerHTML = (s._day>0?'+':'') + fmt(s._day) + '%<span class="tr-live-dot" title="Day % repainted from the adjusted tape reference, ' + esc(state.tapeSession||'') + '"></span>';
      nRep++;
    } else {
      cell.innerHTML = cell.dataset.baked; cell.className = cell.dataset.bakedCls;
    }
  });
  if(outer){
    if(tapeOk){
      outer.textContent = 'Snapshot Day % repainted live from the exchange adjusted reference (same rule as the interactive ranking above) for ' + nRep + ' rows where the raw prior close differs; otherwise the baked builder figure shows. 5-day % is the builder\'s figure in both places.';
    } else {
      outer.textContent = 'Snapshot Day % is the builder\'s raw prior-close figure (baked at build time); the live tape is unavailable or from another session, so no repaint is applied. See the repaint note under the board for the current tape status.';
    }
  }
}

/* ---- Hero: session top 3, unfiltered (stable anchor) ---- */
function renderHero(){
  var host = $('trendHero'); if(!host) return;
  var top3 = state.rows.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); }).slice(0,3);
  var medals = ['🥇','🥈','🥉'];
  host.innerHTML = top3.map(function(s, i){
    var chg = heroChg(s);
    var why = (s.reasons||[]).slice(0,2).join(' · ');
    var tl = TONE_LABEL[s.tone] || TONE_LABEL.watch;
    var priceMark = s._priceRep ? '<span class="tr-live-dot" title="LTP from the live tape, ' + esc(state.tapeSession||'') + '"></span>' : '';
    return '<a class="trend-card cx-card" href="/nepse-chart/?s='+esc(s.symbol)+'">'
      + '<span class="t-rank">'+(i+1)+'</span>'
      + '<div class="t-sym">'+medals[i]+' '+esc(s.symbol)+'</div>'
      + '<div class="t-name">'+esc(s.name)+' · '+esc(s.sector)+'</div>'
      + '<div><span class="t-price">Rs '+fmt(s._ltp)+'</span>'+priceMark+'<span class="t-chg '+chg.cls+'" title="'+esc(chg.tag)+'">'+chg.txt+'</span></div>'
      + '<div class="t-meta"><span class="tone '+tl[0]+'">'+tl[1]+'</span>'
      + '<span><span class="scorebar"><i style="width:'+Math.round(s.score)+'%"></i></span> <b>'+fmt(s.score,1)+'</b></span></div>'
      + '<div class="t-turn">Rs '+fmt(s.turnover_rs_m,1)+' M turnover · '+fmt(s.turnover_ratio,1)+'× average</div>'
      + (why ? '<div class="t-why">'+esc(why)+'</div>' : '')
      + '</a>';
  }).join('');
  var asof = $('trendHeroAsof');
  if(asof && state.meta && state.meta.asof) asof.textContent = 'Session of ' + state.meta.asof;
}

/* ---- Stats + tone mix bar (house pattern; zero buckets absent) ---- */
function renderStats(){
  var tones = {accumulation:0, distribution:0, watch:0};
  state.rows.forEach(function(s){ if(tones[s.tone]!==undefined) tones[s.tone]++; });
  var total = state.rows.length;
  var top = state.rows.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); })[0];
  var secs = {};
  state.rows.forEach(function(s){ secs[s.sector] = (secs[s.sector]||0)+1; });
  $('trStats').innerHTML =
    '<div class="d3-card tr-stat"><p class="tr-eyebrow">Equities scored</p><p class="tr-num">'+total+'</p><p class="tr-sub">of the trending universe</p></div>'
    + '<div class="d3-card tr-stat"><p class="tr-eyebrow">Accumulation</p><p class="tr-num">'+tones.accumulation+'</p><p class="tr-sub">rising on heavy volume</p></div>'
    + '<div class="d3-card tr-stat"><p class="tr-eyebrow">Distribution</p><p class="tr-num">'+tones.distribution+'</p><p class="tr-sub">falling on heavy volume</p></div>'
    + '<div class="d3-card tr-stat"><p class="tr-eyebrow">Watch</p><p class="tr-num">'+tones.watch+'</p><p class="tr-sub">elevated, no clear direction</p></div>'
    + '<div class="d3-card tr-stat"><p class="tr-eyebrow">Top score</p><p class="tr-num">'+(top ? fmt(top.score,1) : '–')+'</p><p class="tr-sub">'+(top ? esc(top.symbol) : '')+'</p></div>';
  var parts = [['Accumulation', tones.accumulation, '#4ADE80'], ['Distribution', tones.distribution, '#F87171'], ['Watch', tones.watch, '#F5B301']];
  var segs = '', legend = '';
  parts.forEach(function(p){
    if(!p[1]) return;
    segs += '<i style="width:'+(total ? (p[1]/total*100) : 0)+'%;background:'+p[2]+'"></i>';
    legend += '<span><i style="background:'+p[2]+'"></i>'+p[0]+' '+p[1]+'</span>';
  });
  $('trMix').innerHTML = '<div class="tr-track" role="img" aria-label="Tone split: accumulation '+tones.accumulation+', distribution '+tones.distribution+', watch '+tones.watch+'">'+segs+'</div><div class="tr-legend">'+legend+'</div>';
  $('coverage').innerHTML = '<strong>Data as of ' + esc(state.meta.asof) + '.</strong> ' + total +
    ' equities scored (' + tones.accumulation + ' accumulation · ' + tones.distribution +
    ' distribution · ' + tones.watch + ' watch) across ' + Object.keys(secs).length +
    ' sectors. Scores rebuild every trading day from the daily close.';
}

/* ---- Sector cards (click → filter + scroll, mirrors screener) ---- */
function renderSectors(){
  var host = $('trSectors'); if(!host) return;
  var by = {};
  state.rows.forEach(function(s){
    if(!by[s.sector]) by[s.sector] = { rows: [], tones: {accumulation:0, distribution:0, watch:0} };
    by[s.sector].rows.push(s);
    if(by[s.sector].tones[s.tone]!==undefined) by[s.sector].tones[s.tone]++;
  });
  var secs = Object.keys(by).map(function(k){
    return { name: k, rows: by[k].rows, tones: by[k].tones };
  }).sort(function(a,b){ return b.rows.length - a.rows.length; });
  host.innerHTML = secs.map(function(sec){
    var top3 = sec.rows.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); }).slice(0,3);
    var total = sec.rows.length;
    var bar = [['#4ADE80', sec.tones.accumulation], ['#F87171', sec.tones.distribution], ['#F5B301', sec.tones.watch]]
      .map(function(p){ return p[1] ? '<i style="width:'+(p[1]/total*100)+'%;background:'+p[0]+'"></i>' : ''; }).join('');
    var topHtml = top3.map(function(s){
      return '<a href="/nepse-chart/?s='+esc(s.symbol)+'">'+esc(s.symbol)+'</a> '+fmt(s.score,1)+' · '+(finite(s._day)?(s._day>0?'+':'')+fmt(s._day)+'%':'–');
    }).join('<br>');
    var pressed = state.sector===sec.name ? 'true' : 'false';
    return '<div class="d3-card tr-sector' + (pressed === 'true' ? ' is-pressed' : '') + '" data-sector="'+esc(sec.name)+'">'
      + '<button type="button" class="tr-sector-btn" aria-pressed="'+pressed+'">'
      + '<h3>'+esc(sec.name)+'</h3>'
      + '<p class="tr-secmeta">'+total+' stocks · '+sec.tones.accumulation+' acc · '+sec.tones.distribution+' dist · '+sec.tones.watch+' watch</p>'
      + '<div class="tr-minibar">'+bar+'</div></button>'
      + '<p class="tr-top">'+topHtml+'</p></div>';
  }).join('');
  host.querySelectorAll('.tr-sector').forEach(function(b){
    /* A11y 2026-10-29: card is a div; the top-3 chart links are siblings
       of the toggle button, not nested in it. Link clicks navigate only
       (the old bubbled toggle was lost on navigation anyway); every other
       card click — including button keyboard activation, which bubbles
       here — toggles the filter exactly as before. */
    b.addEventListener('click', function(ev){
      if (ev.target.closest && ev.target.closest('a')) return;
      var name = b.getAttribute('data-sector');
      state.sector = (state.sector===name) ? 'all' : name;
      var sel = $('trSector'); if(sel) sel.value = state.sector;
      state.page = 1;
      render(); rebaseline(); renderFresh();
      var tbl = $('trendTable'); if(tbl) tbl.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
  var sel = $('trSector'); if(sel){
    sel.innerHTML = '';
    var opt = document.createElement('option'); opt.value = 'all'; opt.textContent = 'All sectors ('+state.rows.length+')'; sel.appendChild(opt);
    secs.forEach(function(sec){
      var o = document.createElement('option'); o.value = sec.name; o.textContent = sec.name+' ('+sec.rows.length+')'; sel.appendChild(o);
    });
  }
  if(sel) sel.value = state.sector;
}

/* ---- Table + pager ---- */
function renderTable(){
  var rows = filtered();
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(state.page > pages) state.page = pages;
  var start = (state.page-1) * PAGE_SIZE;
  var pageRows = rows.slice(start, start + PAGE_SIZE);
  var html = '';
  pageRows.forEach(function(s, i){
    var tl = TONE_LABEL[s.tone] || TONE_LABEL.watch;
    var chips = (s.reasons||[]).map(function(r){ return '<span class="rchip">'+esc(r)+'</span>'; }).join('');
    var priceMark = s._priceRep ? '<span class="tr-live-dot" title="LTP from the live tape, ' + esc(state.tapeSession||'') + '"></span>' : '';
    html += '<tr>'
      + '<td class="num">'+(start+i+1)+'</td>'
      + '<td><a class="symlink" href="/nepse-chart/?s='+esc(s.symbol)+'">'+esc(s.symbol)+'</a><span class="sname">'+esc(s.name)+' · '+esc(s.sector)+'</span></td>'
      + '<td class="num">'+fmt(s._ltp)+priceMark+'</td>'
      + '<td class="num">'+dayCell(s)+'</td>'
      + '<td class="num"><span class="cx-chip '+(s.ret_5d_pct>0?'up':s.ret_5d_pct<0?'down':'flat')+'">'+(s.ret_5d_pct>0?'+':'')+fmt(s.ret_5d_pct)+'%</span></td>'
      + '<td class="num">Rs '+fmt(s.turnover_rs_m,1)+' M<br><span style="color:var(--nd-dim,#6B7280);font-size:.75rem">'+fmt(s.turnover_ratio,1)+'× avg · Vol '+fmt(s.volume_ratio,1)+'×</span></td>'
      + '<td class="num">'+(finite(s.dist_52w_pct) ? (s.dist_52w_pct>0?'+':'')+fmt(s.dist_52w_pct)+'%' : '–')+'</td>'
      + '<td><span class="tone '+tl[0]+'">'+tl[1]+'</span></td>'
      + '<td class="num" title="'+esc(scoreTitle(s))+'"><span class="scorebar"><i style="width:'+Math.round(s.score)+'%"></i></span> '+fmt(s.score,1)+'</td>'
      + '<td><div class="rchips">'+chips+'</div></td>'
      + '<td><canvas class="spark" data-i="'+i+'"></canvas></td>'
      + '<td><button class="rs-toggle" data-sym="'+esc(s.symbol)+'" aria-expanded="false">Research</button></td>'
      + '</tr>';
  });
  if(!pageRows.length) html = '<tr><td colspan="12" style="text-align:center;color:var(--nd-dim,#6B7280)">No stocks match the current filters.</td></tr>';
  $('trendBody').innerHTML = html;
  pageRows.forEach(function(s, i){
    var cvs = $('trendBody').querySelectorAll('canvas.spark');
    if(cvs[i]) sparkline(cvs[i], s.spark, s.ret_5d_pct >= 0);
  });
  var ths = document.querySelectorAll('#trendTable th.sortable');
  ths.forEach(function(th){
    var k = th.getAttribute('data-k');
    var base = th.textContent.replace(/ [▲▼]/,'');
    th.innerHTML = esc(base) + (k===state.sort ? ' <span class="arr">'+(state.dir===-1?'▼':'▲')+'</span>' : '');
  });
  var pg = '';
  for(var p = 1; p <= pages; p++){
    pg += '<button type="button" data-p="'+p+'"'+(p===state.page?' style="border-color:var(--nd-lime);color:var(--nd-lime)"':'')+'>'+p+'</button>';
  }
  $('trPager').innerHTML =
    '<button type="button" class="tr-prev" data-p="'+(state.page-1)+'"'+(state.page<=1?' disabled':'')+'>← Prev</button>'
    + pg
    + '<button type="button" class="tr-next" data-p="'+(state.page+1)+'"'+(state.page>=pages?' disabled':'')+'>Next →</button>'
    + '<span class="tr-count">Showing '+(total? start+1 : 0)+'–'+Math.min(start+PAGE_SIZE, total)+' of '+total+' · Page '+state.page+' of '+pages+'</span>';
  $('trPager').querySelectorAll('button[data-p]').forEach(function(b){
    b.addEventListener('click', function(){
      var p = parseInt(b.getAttribute('data-p'), 10);
      if(p >= 1 && p <= pages && p !== state.page){ state.page = p; renderTable(); rebaseline(); renderFresh(); }
    });
  });
  var note = $('trRepaintNote');
  if(note){
    if(!state.tape){
      note.innerHTML = 'Live tape unavailable — Day % shown as computed from the raw prior close (unadjusted). Scores, turnover and 5d % are never repainted.';
    } else if(state.tapeSession !== state.meta.asof){
      note.innerHTML = 'Tape session ('+esc(state.tapeSession)+') does not match this board ('+esc(state.meta.asof)+') — Day % held at the batch figure to avoid mixing sessions. Scores, turnover and 5d % are never repainted.';
    } else {
      note.innerHTML = 'Day % repainted from the exchange adjusted reference (tape previous_close) for '+state._rep.dayRep+' rows where the raw prior close differs (bonus/rights adjustments); LTP repainted for '+state._rep.priceRep+' rows. Scores, turnover, 5d %, tone and reasons are never repainted. ● marks a repainted figure.';
    }
  }
}

/* ---- Method + archive + forward record ---- */
function renderMethod(){
  var el = $('methodBox'); if(!el || !state.meta) return;
  var p = state.meta.provenance || {};
  el.innerHTML = '<div class="tr-method"><p>'+esc(state.meta.method||'')+'</p>'
    + '<p><strong>Windows, labeled:</strong> Day % is 1-day (today vs the previous session, adjusted to the exchange reference); 5d % is 5 sessions (today vs the close 5 sessions ago). The score\'s momentum input uses 5d % capped at +15%; the displayed 5d % is uncapped. The hero shows Day % and falls back to 5d % only with an explicit "(5d)" tag.</p>'
    + '<p><strong>Source:</strong> '+esc(p.source||'nepse-chart/data/live.json')+' · session '+esc(p.source_session||state.meta.asof)+' · '+esc(p.source_quotes||'')+' quotes · verified: '+esc(p.verified===undefined?'':p.verified)+'. Research method: '+esc(state.researchMethod||'')+'</p></div>';
}
function renderArchiveForward(){
  var arch = $('trArchive'); if(!arch || !state.meta) return;
  var tones = {accumulation:0, distribution:0, watch:0};
  state.rows.forEach(function(s){ if(tones[s.tone]!==undefined) tones[s.tone]++; });
  var top = state.rows.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); })[0];
  arch.innerHTML = '<table class="sig-table"><thead><tr><th>Session</th><th class="num">Scored</th><th class="num">Acc</th><th class="num">Dist</th><th class="num">Watch</th><th>Top score</th></tr></thead>'
    + '<tbody><tr><td>'+esc(state.meta.asof)+'</td><td class="num">'+state.rows.length+'</td><td class="num">'+tones.accumulation+'</td><td class="num">'+tones.distribution+'</td><td class="num">'+tones.watch+'</td><td>'+(top ? esc(top.symbol)+' '+fmt(top.score,1) : '–')+'</td></tr></tbody></table>'
    + '<p class="tr-track-note">Archive starts with this teardown (session '+esc(state.meta.asof)+'). Earlier sessions are not in a trending-archive payload, so they are not reconstructed here — the daily snapshot above is the per-session record.</p>';
  var fwd = $('trForward'); if(!fwd) return;
  var top15 = state.rows.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); }).slice(0,15);
  var rows = top15.map(function(s, i){
    return '<tr><td class="num">'+(i+1)+'</td><td><a class="symlink" href="/nepse-chart/?s='+esc(s.symbol)+'">'+esc(s.symbol)+'</a></td>'
      + '<td class="num">'+fmt(s._ltp)+'</td><td class="num">'+(finite(s._day)?(s._day>0?'+':'')+fmt(s._day)+'%':'–')+'</td>'
      + '<td class="num">pending</td><td class="num">pending</td><td>Tracking</td></tr>';
  }).join('');
  fwd.innerHTML = '<div class="tr-noclosed">No resolved forward outcomes yet — tracking starts '+esc(state.meta.asof)+'.</div>'
    + '<table class="sig-table"><thead><tr><th class="num">#</th><th>Stock</th><th class="num">Entry LTP</th><th class="num">Entry Day %</th><th class="num">5-session return</th><th class="num">20-session return</th><th>Status</th></tr></thead>'
    + '<tbody>'+rows+'</tbody></table>'
    + '<p class="tr-track-note">5-session outcomes resolve after 5 sessions, 20-session after 20. Resolution needs a forward-tracking payload (a builder enhancement, flagged — no outcome is estimated here).</p>';
}

/* ---- Research (lazy, once) ---- */
var researchCache = null, researchPromise = null;
function getResearch(){
  if(researchCache) return Promise.resolve(researchCache);
  if(!researchPromise){
    researchPromise = fetch(BASE+'trending-research.json', { cache: 'no-store' }).then(function(r){
      if(!r.ok) throw 0; return r.json();
    }).then(function(d){
      researchCache = { _meta: d, _bySym: {} };
      (d.stocks||[]).forEach(function(s){ researchCache._bySym[s.symbol] = s; });
      return researchCache;
    }).catch(function(){ researchPromise = null; throw 0; });
  }
  return researchPromise;
}
function closeResearchPanels(){
  var rows = document.querySelectorAll('#trendBody .rs-panel-row');
  rows.forEach(function(r){ r.remove(); });
  var btns = document.querySelectorAll('#trendBody .rs-toggle[aria-expanded="true"]');
  btns.forEach(function(b){ b.setAttribute('aria-expanded','false'); });
}
function rsRow(label, val){
  if(val===null||val===undefined||val==='') return '';
  return '<dt>'+esc(label)+'</dt><dd>'+esc(val)+'</dd>';
}
function researchPanelHTML(e, meta){
  var f = e.financial, m = e.management, h = '';
  h += '<div class="rs-head"><span class="sig-kicker">Equity research</span>'
     + '<span class="rs-asof">As of '+esc(meta.asof||'')+' · from published filings &amp; the corporate-action archive</span></div>';
  h += '<div class="rs-grid">';
  h += '<section class="rs-card"><h3>Financial analysis</h3>';
  if(f){
    h += '<dl class="rs-facts">';
    h += rsRow('Reporting period', f.period || '—');
    h += rsRow('TTM EPS', f.eps_ttm!==null ? 'Rs '+fmt(f.eps_ttm) : '—');
    h += rsRow('P/E (TTM)', f.pe_ttm!==null ? fmt(f.pe_ttm) : 'n/a (loss-making year)');
    h += rsRow('P/BV', f.pbv!==null ? fmt(f.pbv) : '—');
    h += rsRow('BVPS', f.bvps!==null ? 'Rs '+fmt(f.bvps) : '—');
    h += rsRow('ROE (TTM)', f.roe_ttm_pct!==null ? fmt(f.roe_ttm_pct)+'%' : '—');
    h += rsRow('Earnings yield', f.ey_pct!==null ? fmt(f.ey_pct)+'%' : '—');
    h += rsRow('Revenue', f.revenue_rs_m!==null ? 'Rs '+fmt(f.revenue_rs_m,1)+' M' : '—');
    h += rsRow('Net profit', f.net_profit_rs_m!==null ? 'Rs '+fmt(f.net_profit_rs_m,1)+' M' : '—');
    h += rsRow('Net worth', f.networth_rs_m!==null ? 'Rs '+fmt(f.networth_rs_m,1)+' M' : '—');
    if(f.sector_median_pe){
      h += '<div class="rs-sub">Sector P/E median '+fmt(f.sector_median_pe)
         + (f.sector_median_pbv ? ' · P/BV median '+fmt(f.sector_median_pbv) : '') + '</div>';
    }
    if(f.trend && f.trend.quarters >= 2){
      h += '<div class="rs-sub">Net profit '+esc(f.trend.direction)+' over '+f.trend.quarters
         + ' quarters (Rs '+fmt(f.trend.first_rs_m,1)+' M → Rs '+fmt(f.trend.last_rs_m,1)+' M)</div>';
    }
    h += '</dl>';
  } else {
    h += '<p class="sig-sub">No published fundamentals in our dataset for this symbol — the activity is pure trading interest with no reported numbers behind it.</p>';
  }
  h += '</section>';
  h += '<section class="rs-card"><h3>Management &amp; governance</h3>';
  if(m){
    h += '<dl class="rs-facts">';
    h += rsRow('Dividend years (last 5 FY)', m.dividend_years_last5+' of 5');
    var ld = m.latest_dividend;
    h += rsRow('Latest dividend', (ld && ld.year) ? ld.bonus_pct.toFixed(2)+'% bonus + '+ld.cash_pct.toFixed(2)+'% cash · FY '+esc(ld.year) : '—');
    h += rsRow('AGMs on record', m.agm_count);
    h += rsRow('Rights issues', m.rights_count + (m.latest_right && m.latest_right.ratio ? ' · latest '+esc(m.latest_right.ratio) : ''));
    h += rsRow('Auction sales', m.auctions_count);
    h += '<div class="rs-sub">From the corporate-action archive (dividend, AGM, rights &amp; auction notices). Promoter/ownership percentages are not in our datasets and are never estimated.</div>';
    h += '</dl>';
  } else {
    h += '<p class="sig-sub">Our corporate-action archive holds no dividend or AGM record for this symbol.</p>';
  }
  h += '</section>';
  h += '</div>';
  h += '<div class="rs-note"><span class="sig-kicker">Analyst note</span><p>'+esc(e.analyst_note)+'</p></div>';
  h += '<p class="sig-sub rs-foot">Educational only — not investment advice. Figures from published quarterly filings and the corporate-action archive.</p>';
  return h;
}
function researchMissingHTML(sym){
  return '<div class="rs-panel"><div class="rs-loading">Research was compiled for the top 40 activity-ranked stocks in today\'s run; '
       + esc(sym) + ' is outside that set. The activity row above still shows its full trading picture.</div></div>';
}
function initResearch(){
  $('trendBody').addEventListener('click', function(ev){
    var b = ev.target.closest('.rs-toggle'); if(!b) return;
    var sym = b.getAttribute('data-sym');
    var tr = b.closest('tr');
    var wasOpen = tr.nextElementSibling && tr.nextElementSibling.classList.contains('rs-panel-row');
    closeResearchPanels();
    if(wasOpen) return;
    b.setAttribute('aria-expanded','true');
    var panelTr = document.createElement('tr');
    panelTr.className = 'rs-panel-row';
    panelTr.innerHTML = '<td colspan="12"><div class="rs-panel"><div class="rs-loading">Loading research…</div></div></td>';
    tr.after(panelTr);
    getResearch().then(function(cache){
      var entry = cache._bySym[sym];
      panelTr.querySelector('.rs-panel').outerHTML =
        '<!-- RESEARCH-LAYER-START: equity-research panel for '+sym.replace(/[^A-Z0-9]/g,'')+' -->'
        + '<div class="rs-panel">' + (entry ? researchPanelHTML(entry, cache._meta) : researchMissingHTML(sym)) + '</div>'
        + '<!-- RESEARCH-LAYER-END -->';
    }).catch(function(){
      b.setAttribute('aria-expanded','false');
      panelTr.querySelector('.rs-panel').innerHTML = '<div class="rs-loading">Research data is unavailable right now. Please try again later.</div>';
    });
  });
}

/* ---- Controls, load, 60s change-gated tick ---- */
function render(){
  closeResearchPanels();
  renderHero();
  renderStats();
  renderSectors();
  renderTable();
  repaintSnapshot();
  renderMethod();
  renderArchiveForward();
  var ths = document.querySelectorAll('#trendTable th.sortable');
  ths.forEach(function(th){
    var k = th.getAttribute('data-k');
    var base = th.textContent.replace(/ [▲▼]/,'');
    th.innerHTML = esc(base) + (k===state.sort ? ' <span class="arr">'+(state.dir===-1?'▼':'▲')+'</span>' : '');
  });
}
function initControls(){
  $('toneTabs').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    state.tone = b.getAttribute('data-tone');
    var bs = this.querySelectorAll('button');
    bs.forEach(function(x){ x.classList.remove('active'); });
    b.classList.add('active');
    state.page = 1;
    render(); rebaseline(); renderFresh();
  });
  document.querySelectorAll('#trendTable th.sortable').forEach(function(th){
    th.addEventListener('click', function(){
      var k = th.getAttribute('data-k');
      if(state.sort===k){ state.dir = -state.dir; } else { state.sort=k; state.dir=-1; }
      state.page = 1;
      renderTable(); rebaseline(); renderFresh();
    });
  });
  $('trSector').addEventListener('change', function(){ state.sector = this.value; state.page = 1; render(); rebaseline(); renderFresh(); });
  $('trSort').addEventListener('change', function(){
    var v = this.value;
    if(v==='score'){ state.sort='score'; state.dir=-1; }
    else if(v==='day'){ state.sort='_day'; state.dir=-1; }
    else if(v==='ret5'){ state.sort='ret_5d_pct'; state.dir=-1; }
    else if(v==='turnover'){ state.sort='turnover_rs_m'; state.dir=-1; }
    else if(v==='ltp'){ state.sort='_ltp'; state.dir=-1; }
    else if(v==='sym'){ state.sort='symbol'; state.dir=1; }
    state.page = 1;
    renderTable(); rebaseline(); renderFresh();
  });
  $('trSearch').addEventListener('input', function(){ state.search = this.value; state.page = 1; renderTable(); rebaseline(); renderFresh(); });
  $('trReset').addEventListener('click', function(){
    state.tone='all'; state.sector='all'; state.sort='score'; state.dir=-1; state.search=''; state.page=1;
    var sel = $('trSector'); if(sel) sel.value='all';
    var sor = $('trSort'); if(sor) sor.value='score';
    var sea = $('trSearch'); if(sea) sea.value='';
    document.querySelectorAll('#toneTabs button').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-tone')==='all'); });
    render(); rebaseline(); renderFresh();
  });
}
function load(silent){
  var liveP = fetch(BASE+'live.json', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  var resP = fetch(BASE+'trending-research.json', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  fetch(BASE+'trending.json', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(d){
    return Promise.all([liveP, resP]).then(function(parts){
      var live = parts[0];
      state.meta = d;
      state.rows = d.stocks || [];
      state.tape = live;
      state.tapeSession = tapeSessionOf(live);
      state.researchMethod = parts[1] ? parts[1].method : '';
      state._rep = enrichRows(state.rows, live);
      if(!state.controlsInit){ initControls(); initResearch(); state.controlsInit = true; }
      render(); rebaseline(); renderFresh();
    });
  }).catch(function(){
    if(silent) return;
    $('coverage').innerHTML = '<span class="tr-err">Could not load trending data. Please try again later.</span>';
    $('trendBody').innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--nd-dim,#6B7280)">Data unavailable.</td></tr>';
  });
}
function tick(){
  if(document.hidden) return;
  var liveP = fetch(BASE+'live.json', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  fetch(BASE+'trending.json', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(d){
    return liveP.then(function(live){
      var prevSig = sig;
      state.meta = d;
      state.rows = d.stocks || [];
      state.tape = live;
      state.tapeSession = tapeSessionOf(live);
      state._rep = enrichRows(state.rows, live);
      var next = computeSig();
      if(next !== prevSig){ render(); }
      rebaseline(); renderFresh();
    });
  }).catch(function(){ renderFresh(); });
}
load();
setInterval(tick, 60000);
})();
