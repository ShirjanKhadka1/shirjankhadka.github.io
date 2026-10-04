/* nepse-engine-verdict/verdict.js — engine ranking table (2026-10-04).
 * Loads /nepse-chart/data/verdicts.json, renders sortable/filterable
 * ranking table (50/page). All output escaped. */
(function () {
  'use strict';
  var DATA_URL = '/nepse-chart/data/verdicts.json';
  var PER_PAGE = 50;

  var state = { rows: [], asof: '', q: '', verdict: 'all', sortKey: 's', sortDir: -1, page: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function fmtN(v, d) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString('en-US', {minimumFractionDigits: d||0, maximumFractionDigits: d||0}) : '—';
  }

  var VCLASS = {
    'Strong Buy': 'sb', 'Buy': 'b', 'Hold': 'h',
    'Exit': 'e', 'Exit / Reduce': 'e', 'Strong Exit': 'se', 'Strong Sell': 'se'
  };
  function vClass(v) { return VCLASS[v] || 'h'; }

  function load() {
    fetch(DATA_URL, {credentials:'same-origin'})
      .then(function (r) { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function (json) {
        state.asof = json.asof || '';
        var v = json.verdicts || {};
        state.rows = Object.keys(v).map(function (sym) {
          var r = v[sym] || {};
          return {
            sym: sym, v: r.v || 'Hold', s: (typeof r.s === 'number' ? r.s : 0),
            p: r.p, ch: r.ch, rsi: r.rsi, sec: r.sec || '—',
            setup: r.setup || '—', sl: r.sl, tp: r.tp, pos: r.pos
          };
        });
        var asof = $('evAsof');
        if (asof) asof.textContent = state.asof
          ? 'Scores from the ' + state.asof + ' session · rebuilt daily after close'
          : 'Session date unavailable';
        renderStats(); renderFilters(); renderTable();
      })
      .catch(function () {
        $('evTableWrap').innerHTML = '<div class="ev-empty">Could not load engine verdicts. Please reload.</div>';
      });
  }

  function renderStats() {
    var host = $('evStats');
    if (!host) return;
    var c = { sb: 0, b: 0, h: 0, e: 0, se: 0 };
    state.rows.forEach(function (r) { var k = vClass(r.v); c[k] = (c[k]||0)+1; });
    host.innerHTML =
      '<button type="button" class="ev-stat buy" data-v="buy-side" aria-pressed="'+(state.verdict==='buy-side')+'"><div class="num">'+(c.sb+c.b)+'</div><div class="lbl">Buy-side</div></button>'+
      '<button type="button" class="ev-stat" data-v="Hold" aria-pressed="'+(state.verdict==='Hold')+'"><div class="num">'+c.h+'</div><div class="lbl">Hold</div></button>'+
      '<button type="button" class="ev-stat exit" data-v="exit-side" aria-pressed="'+(state.verdict==='exit-side')+'"><div class="num">'+(c.e+c.se)+'</div><div class="lbl">Exit-side</div></button>'+
      '<button type="button" class="ev-stat" data-v="all" aria-pressed="'+(state.verdict==='all')+'"><div class="num">'+state.rows.length+'</div><div class="lbl">Securities scored</div></button>';
    host.querySelectorAll('.ev-stat').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1;
        renderStats(); renderFilters(); renderTable();
      });
    });
  }

  var FILTERS = [['all','All'],['buy-side','Buy-side'],['Strong Buy','Strong Buy'],['Buy','Buy'],['Hold','Hold'],['exit-side','Exit-side'],['Exit','Exit'],['Strong Exit','Strong Exit']];
  function renderFilters() {
    var host = $('evFilters');
    if (!host) return;
    host.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="ev-f" data-v="'+esc(f[0])+'" aria-pressed="'+(state.verdict===f[0])+'">'+esc(f[1])+'</button>';
    }).join('');
    host.querySelectorAll('.ev-f').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1;
        renderFilters(); renderTable();
      });
    });
  }

  function filtered() {
    var rows = state.rows.slice();
    if (state.verdict === 'buy-side')
      rows = rows.filter(function (r) { var k = vClass(r.v); return k === 'sb' || k === 'b'; });
    else if (state.verdict === 'exit-side')
      rows = rows.filter(function (r) { var k = vClass(r.v); return k === 'e' || k === 'se'; });
    else if (state.verdict !== 'all')
      rows = rows.filter(function (r) { return r.v === state.verdict; });
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return r.sym.toLowerCase().indexOf(q) !== -1; });
    }
    var k = state.sortKey, d = state.sortDir;
    rows.sort(function (a, b) {
      var va = a[k], vb = b[k];
      if (va == null) va = -Infinity; if (vb == null) vb = -Infinity;
      if (typeof va === 'string') { va = va.toLowerCase(); vb = String(vb).toLowerCase(); }
      if (va < vb) return -1*d; if (va > vb) return 1*d; return 0;
    });
    return rows;
  }

  var COLS = [
    {k:'sym', l:'Symbol'}, {k:'v', l:'Verdict'}, {k:'s', l:'Score', n:1},
    {k:'p', l:'Price', n:1}, {k:'ch', l:'Chg %', n:1}, {k:'rsi', l:'RSI', n:1},
    {k:'pos', l:'52W Pos', n:1}, {k:'setup', l:'Setup'}, {k:'sl', l:'Stop-loss', n:1}, {k:'tp', l:'Target', n:1}
  ];
  var LABELS = {}; COLS.forEach(function (c) { LABELS[c.k] = c.l; });

  function cell(r, k) {
    if (k === 'sym') return '<td class="sym">'+esc(r.sym)+'</td>';
    if (k === 'v') return '<td><span class="ev-v '+vClass(r.v)+'">'+esc(r.v)+'</span></td>';
    if (k === 's') {
      var cls = r.s > 0 ? 'pos' : r.s < 0 ? 'neg' : '';
      return '<td class="num"><span class="ev-score '+cls+'">'+(r.s>0?'+':'')+r.s.toFixed(1)+'</span></td>';
    }
    if (k === 'p') return '<td class="num">'+fmtN(r.p,2)+'</td>';
    if (k === 'ch') {
      var c = r.ch == null ? '—' : (r.ch>0?'+':'')+Number(r.ch).toFixed(2)+'%';
      var cc = r.ch > 0 ? 'pos' : r.ch < 0 ? 'neg' : '';
      return '<td class="num"><span class="ev-score '+cc+'">'+c+'</span></td>';
    }
    if (k === 'rsi') return '<td class="num dim">'+(r.rsi==null?'—':Number(r.rsi).toFixed(1))+'</td>';
    if (k === 'pos') return '<td class="num dim">'+(r.pos==null?'—':Math.round(r.pos*100)+'%')+'</td>';
    if (k === 'sl' || k === 'tp') return '<td class="num dim">'+fmtN(r[k],2)+'</td>';
    return '<td class="dim">'+esc(r[k]==null?'—':r[k])+'</td>';
  }

  function renderTable() {
    var host = $('evTableWrap'), cnt = $('evCount'), pager = $('evPager');
    var rows = filtered();
    var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page-1)*PER_PAGE;
    var page = rows.slice(start, start+PER_PAGE);

    var th = COLS.map(function (c) {
      var active = state.sortKey === c.k;
      var arr = active ? (state.sortDir===1?'▲':'▼') : '';
      return '<th scope="col" data-k="'+c.k+'" class="sortable'+(c.n?' num':'')+'">'+esc(c.l)+'<span class="arr">'+arr+'</span></th>';
    }).join('');
    var body = page.length
      ? page.map(function (r) { return '<tr>'+COLS.map(function (c){return cell(r,c.k);}).join('')+'</tr>'; }).join('')
      : '<tr><td colspan="'+COLS.length+'"><div class="ev-empty">No securities match your filters.</div></td></tr>';
    host.innerHTML = '<table class="ev-table"><caption>Ranked by engine score '+
      (state.sortDir===1?'ascending':'descending')+' · '+esc(state.asof||'date unavailable')+
      '</caption><thead><tr>'+th+'</tr></thead><tbody>'+body+'</tbody></table>';
    host.querySelectorAll('th.sortable').forEach(function (h) {
      h.addEventListener('click', function () {
        var k = h.getAttribute('data-k');
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = (k==='sym'||k==='v'||k==='setup' ? 1 : -1); }
        state.page = 1; renderTable();
      });
    });
    if (cnt) cnt.textContent = rows.length
      ? 'Showing '+(rows.length?start+1:0)+'–'+Math.min(start+PER_PAGE,rows.length)+' of '+rows.length+' securities'
      : 'No securities found';
    renderPager(pager, totalPages);
  }

  function renderPager(host, totalPages) {
    if (!host) return;
    if (totalPages <= 1) { host.innerHTML=''; return; }
    var h = '<button type="button" class="ev-pagebtn" data-p="prev"'+(state.page<=1?' disabled':'')+' aria-label="Previous">←</button>';
    var lo = Math.max(1,state.page-2), hi = Math.min(totalPages,state.page+2);
    if (lo>1) h += '<button type="button" class="ev-pagebtn" data-p="1">1</button>'+(lo>2?'<span class="ev-pageinfo">…</span>':'');
    for (var p=lo;p<=hi;p++) h += '<button type="button" class="ev-pagebtn" data-p="'+p+'"'+(p===state.page?' aria-current="true"':'')+'>'+p+'</button>';
    if (hi<totalPages) h += (hi<totalPages-1?'<span class="ev-pageinfo">…</span>':'')+'<button type="button" class="ev-pagebtn" data-p="'+totalPages+'">'+totalPages+'</button>';
    h += '<button type="button" class="ev-pagebtn" data-p="next"'+(state.page>=totalPages?' disabled':'')+' aria-label="Next">→</button>';
    h += '<span class="ev-pageinfo">Page '+state.page+' of '+totalPages+'</span>';
    host.innerHTML = h;
    host.querySelectorAll('.ev-pagebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var v = b.getAttribute('data-p');
        if (v==='prev') state.page = Math.max(1,state.page-1);
        else if (v==='next') state.page = Math.min(totalPages,state.page+1);
        else state.page = parseInt(v,10)||1;
        renderTable();
        $('evTableWrap').scrollIntoView({behavior:'smooth',block:'start'});
      });
    });
  }

  function init() {
    var s = $('evSearch');
    if (s) s.addEventListener('input', function(){ state.q = s.value.trim(); state.page=1; renderTable(); });
    load();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
