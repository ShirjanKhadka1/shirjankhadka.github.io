/* nepse-verdicts-v2/verdicts-v2.js — Warning Radar table + evidence accordion.
 * Loads /data/verdicts-v2-summary.json (compact) after first paint; fetches
 * /data/verdicts-v2.json lazily on first row expansion and caches it.
 * All output escaped. Honesty rules: proxy lock-in never shows a precise
 * date; pending sections render as visible dated gaps; every signal shows
 * its backtest stat. */
(function () {
  'use strict';
  var SUMMARY_URL = '/data/verdicts-v2-summary.json';
  var FULL_URL = '/data/verdicts-v2.json';
  var PER_PAGE = 50;

  var state = { rows: [], asof: '', session: '', regime: '', regimeNote: '',
    q: '', verdict: 'all', sortKey: 'confidence', sortDir: -1, page: 1,
    expanded: null };
  var fullCache = null, fullLoading = false;

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
  function fmtPct(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }

  var VCLASS = {
    'EXHAUSTION_RISK': 'warn', 'DISTRIBUTION_WARNING': 'warn',
    'ELEVATED_RISK': 'elev', 'IGNITION': 'opp', 'BOUNCE_SETUP': 'opp',
    'NEUTRAL': 'neu', 'UNRELIABLE': 'unr', 'EXCLUDED_NON_EQUITY': 'exc',
    'INSUFFICIENT_DATA': 'unr'
  };
  function vClass(v) { return VCLASS[v] || 'neu'; }
  function vLabel(v) {
    return { 'EXHAUSTION_RISK': 'Exhaustion risk', 'DISTRIBUTION_WARNING': 'Distribution warning',
      'ELEVATED_RISK': 'Elevated risk', 'IGNITION': 'Ignition', 'BOUNCE_SETUP': 'Bounce setup',
      'NEUTRAL': 'Neutral', 'UNRELIABLE': 'Unreliable data', 'EXCLUDED_NON_EQUITY': 'Non-equity',
      'INSUFFICIENT_DATA': 'Too little data' }[v] || v;
  }

  function lockinCell(lk) {
    if (!lk) return '<span class="v3-dim">—</span>';
    // HARD RULE: precise expiry only from verified tiers.
    if (lk.expiry) {
      var exp = lk.status === 'expired';
      return '<span class="v2-lock ' + (exp ? 'exp' : '') + '">' +
        (exp ? 'expired ' : 'expires ') + esc(lk.expiry) + '</span>';
    }
    return '<span class="v3-dim">expiry unverified</span>';
  }

  function load() {
    fetch(SUMMARY_URL, {credentials:'same-origin'})
      .then(function (r) { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function (json) {
        state.asof = json.asof || '';
        state.session = json.session_date || '';
        state.regime = json.regime || '';
        state.regimeNote = json.regime_note || '';
        var v = json.verdicts || {};
        state.rows = Object.keys(v).map(function (sym) {
          var r = v[sym] || {};
          return {
            sym: sym, label: r.label || 'NEUTRAL',
            confidence: (typeof r.confidence === 'number' ? r.confidence : 0),
            pump: (typeof r.pump_score === 'number' ? r.pump_score : null),
            opp: (typeof r.opportunity_score === 'number' ? r.opportunity_score : null),
            age: r.age_sessions, sec: r.sector || '—',
            early: !!r.early_lifecycle,
            flags: r.flags || [], lockin: r.lockin || null
          };
        });
        renderHead(); renderStats(); renderFilters(); renderTable();
      })
      .catch(function () {
        $('v2TableWrap').innerHTML = '<div class="v2-empty">Could not load the warning radar. Please reload.</div>';
      });
  }

  function renderHead() {
    var rg = $('v2Regime'), asof = $('v2Asof');
    if (rg) rg.innerHTML = state.regime
      ? 'Market regime: <strong>' + esc(state.regime) + '</strong> <span class="dim">' + esc(state.regimeNote) + '</span>'
      : 'Market regime unavailable';
    if (asof) asof.textContent = state.session
      ? 'Verdicts from the ' + state.session + ' session · rebuilt daily after close'
      : 'Session date unavailable';
  }

  var WARN = ['EXHAUSTION_RISK','DISTRIBUTION_WARNING','ELEVATED_RISK'];
  function renderStats() {
    var host = $('v2Stats');
    if (!host) return;
    var warn = 0, neu = 0, opp = 0, other = 0;
    state.rows.forEach(function (r) {
      if (WARN.indexOf(r.label) >= 0) warn++;
      else if (r.label === 'NEUTRAL') neu++;
      else if (r.label === 'IGNITION' || r.label === 'BOUNCE_SETUP') opp++;
      else other++;
    });
    host.innerHTML =
      '<button type="button" class="v2-stat warn" data-v="warnings" aria-pressed="'+(state.verdict==='warnings')+'"><div class="num">'+warn+'</div><div class="lbl">Warnings</div></button>'+
      '<button type="button" class="v2-stat" data-v="NEUTRAL" aria-pressed="'+(state.verdict==='NEUTRAL')+'"><div class="num">'+neu+'</div><div class="lbl">Neutral</div></button>'+
      '<button type="button" class="v2-stat opp" data-v="opps" aria-pressed="'+(state.verdict==='opps')+'"><div class="num">'+opp+'</div><div class="lbl">Opportunity flags</div></button>'+
      '<button type="button" class="v2-stat" data-v="all" aria-pressed="'+(state.verdict==='all')+'"><div class="num">'+state.rows.length+'</div><div class="lbl">Securities scanned</div></button>'+
      '<p class="v2-take">The radar is a warning instrument: it flags names that look dangerous and shows why. ' +
      '<a href="/nepse-verdicts-v2/methodology/">How it is validated →</a></p>';
    host.querySelectorAll('.v2-stat').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1; state.expanded = null;
        renderStats(); renderFilters(); renderTable();
      });
    });
  }

  var FILTERS = [['all','All'],['warnings','Warnings'],['DISTRIBUTION_WARNING','Distribution'],['ELEVATED_RISK','Elevated'],['NEUTRAL','Neutral'],['opps','Opportunity'],['UNRELIABLE','Unreliable']];
  function renderFilters() {
    var host = $('v2Filters');
    if (!host) return;
    host.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="v2-f" data-v="'+esc(f[0])+'" aria-pressed="'+(state.verdict===f[0])+'">'+esc(f[1])+'</button>';
    }).join('');
    host.querySelectorAll('.v2-f').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1; state.expanded = null;
        renderFilters(); renderTable();
      });
    });
  }

  function filtered() {
    var rows = state.rows.slice();
    if (state.verdict === 'warnings') rows = rows.filter(function (r) { return WARN.indexOf(r.label) >= 0; });
    else if (state.verdict === 'opps') rows = rows.filter(function (r) { return r.label === 'IGNITION' || r.label === 'BOUNCE_SETUP'; });
    else if (state.verdict !== 'all') rows = rows.filter(function (r) { return r.label === state.verdict; });
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
    {k:'sym', l:'Symbol'}, {k:'label', l:'Verdict'}, {k:'confidence', l:'Confidence', n:1},
    {k:'pump', l:'Pump score', n:1}, {k:'age', l:'Age', n:1}, {k:'sec', l:'Sector'}, {k:'lockin', l:'Lock-in'}
  ];

  function statCell(r, k, label) {
    var v;
    if (k === 'confidence') v = '<span class="v3-num">' + fmtPct(r.confidence) + '</span>';
    else if (k === 'pump') v = '<span class="v3-num">' + (r.pump == null ? '—' : r.pump.toFixed(2)) + '</span>';
    else if (k === 'age') v = '<span class="v3-dim">' + (r.age == null ? '—' : r.age) + '</span>';
    else if (k === 'sec') v = '<span class="v3-dim">' + esc(r.sec == null ? '—' : r.sec) + '</span>';
    else v = lockinCell(r.lockin);
    return '<div class="v3-c stat" data-l="' + esc(label) + '">' + v + '</div>';
  }

  function renderTable() {
    var host = $('v2TableWrap'), cnt = $('v2Count'), pager = $('v2Pager');
    var rows = filtered();
    var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page-1)*PER_PAGE;
    var page = rows.slice(start, start+PER_PAGE);

    var th = COLS.map(function (c) {
      var active = state.sortKey === c.k;
      var arr = active ? (state.sortDir===1?'▲':'▼') : '';
      return '<div class="v3-th sortable' + (c.n?' num':'') + '" data-k="'+c.k+'" role="columnheader" tabindex="0">'+esc(c.l)+'<span class="arr">'+arr+'</span></div>';
    }).join('') + '<div class="v3-th v3-th-chev" aria-hidden="true"></div>';

    var cards = page.length ? page.map(function (r) {
      var open = state.expanded === r.sym;
      var cls = vClass(r.label);
      var h = '<div class="v3-card ' + cls + (open ? ' open' : '') + '" data-sym="'+esc(r.sym)+'" role="button" tabindex="0" aria-expanded="'+open+'">' +
        '<div class="v3-c sym"><span class="v3-sym">'+esc(r.sym)+'</span>'+(r.early?' <span class="v2-early">Early</span>':'')+'</div>' +
        '<div class="v3-c verdict"><span class="v2-v '+cls+'">'+esc(vLabel(r.label))+'</span></div>' +
        '<div class="v3-statrow">' +
          statCell(r,'confidence','Confidence') + statCell(r,'pump','Pump score') +
          statCell(r,'age','Age') + statCell(r,'sec','Sector') + statCell(r,'lockin','Lock-in') +
        '</div>' +
        '<div class="v3-chev" aria-hidden="true">▾</div>' +
      '</div>';
      if (open) h += '<div class="v3-detailwrap"><div class="v3-detail" id="v3Detail-'+esc(r.sym)+'"><div class="v2-empty">Loading evidence…</div></div></div>';
      return h;
    }).join('') : '<div class="v2-empty">No securities match your filters.</div>';

    host.innerHTML = '<div class="v3-board" role="table" aria-label="Warning radar">' +
      '<div class="v3-thead" role="row">'+th+'</div>' +
      '<div class="v3-rows">'+cards+'</div></div>' +
      '<p class="v3-cap">Warning radar · ' + (state.sortDir===1?'ascending':'descending') + ' · ' + esc(state.session||'date unavailable') + '</p>';

    host.querySelectorAll('.v3-th.sortable').forEach(function (h) {
      var go = function () {
        var k = h.getAttribute('data-k');
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = (k==='sym'||k==='label'||k==='sec' ? 1 : -1); }
        state.page = 1; renderTable();
      };
      h.addEventListener('click', go);
      h.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); go(); } });
    });
    host.querySelectorAll('.v3-card').forEach(function (card) {
      var toggle = function () {
        var sym = card.getAttribute('data-sym');
        state.expanded = (state.expanded === sym) ? null : sym;
        renderTable();
        if (state.expanded) loadDetail(state.expanded);
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); toggle(); } });
    });
    if (cnt) cnt.textContent = rows.length
      ? 'Showing '+(start+1)+'–'+Math.min(start+PER_PAGE,rows.length)+' of '+rows.length+' securities · click a card for evidence'
      : 'No securities found';
    renderPager(pager, totalPages);
    if (state.expanded) loadDetail(state.expanded);
  }

  function renderPager(host, totalPages) {
    if (!host) return;
    if (totalPages <= 1) { host.innerHTML=''; return; }
    var h = '<button type="button" class="v2-pagebtn" data-p="prev"'+(state.page<=1?' disabled':'')+' aria-label="Previous">←</button>';
    var lo = Math.max(1,state.page-2), hi = Math.min(totalPages,state.page+2);
    if (lo>1) h += '<button type="button" class="v2-pagebtn" data-p="1">1</button>'+(lo>2?'<span class="v2-pageinfo">…</span>':'');
    for (var p=lo;p<=hi;p++) h += '<button type="button" class="v2-pagebtn" data-p="'+p+'"'+(p===state.page?' aria-current="true"':'')+'>'+p+'</button>';
    if (hi<totalPages) h += (hi<totalPages-1?'<span class="v2-pageinfo">…</span>':'')+'<button type="button" class="v2-pagebtn" data-p="'+totalPages+'">'+totalPages+'</button>';
    h += '<button type="button" class="v2-pagebtn" data-p="next"'+(state.page>=totalPages?' disabled':'')+' aria-label="Next">→</button>';
    h += '<span class="v2-pageinfo">Page '+state.page+' of '+totalPages+'</span>';
    host.innerHTML = h;
    host.querySelectorAll('.v2-pagebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var v = b.getAttribute('data-p');
        if (v==='prev') state.page = Math.max(1,state.page-1);
        else if (v==='next') state.page = Math.min(totalPages,state.page+1);
        else state.page = parseInt(v,10)||1;
        state.expanded = null; renderTable();
        $('v2TableWrap').scrollIntoView({behavior:'smooth',block:'start'});
      });
    });
  }

  /* ---------------- evidence accordion ---------------- */

  function loadDetail(sym) {
    var host = $('v3Detail-'+sym);
    if (!host) return;
    if (fullCache) { host.innerHTML = renderEvidence(fullCache.verdicts[sym]); return; }
    if (fullLoading) return;
    fullLoading = true;
    fetch(FULL_URL, {credentials:'same-origin'})
      .then(function (r) { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function (json) {
        fullCache = json; fullLoading = false;
        var h = $('v3Detail-'+sym);
        if (h && state.expanded === sym) h.innerHTML = renderEvidence((json.verdicts||{})[sym]);
      })
      .catch(function () {
        fullLoading = false;
        var h = $('v3Detail-'+sym);
        if (h) h.innerHTML = '<div class="v2-empty">Could not load evidence. Please reload.</div>';
      });
  }

  function gap(text) { return '<div class="v2-gap">'+esc(text)+'</div>'; }

  function sec(title, inner) {
    return '<details class="v2-sec"><summary>'+esc(title)+'</summary><div class="v2-secbody">'+inner+'</div></details>';
  }
  function kv(k, v) {
    return '<div class="v2-kv"><span>'+esc(k)+'</span><span>'+v+'</span></div>';
  }

  function renderEvidence(v) {
    if (!v) return '<div class="v2-empty">No verdict for this symbol.</div>';
    var e = v.evidence || {};
    var h = '';

    // banner
    h += '<div class="v2-banner '+vClass(v.verdict)+'"><div><div class="v2-bverdict">'+esc(vLabel(v.verdict))+'</div>' +
      '<div class="v2-bmeta">Horizon ' + esc(v.horizon_sessions) + ' sessions · confidence ' + fmtPct(v.confidence) + '</div></div>' +
      '<div class="v2-bconf"><div class="v2-bar"><i style="width:'+Math.round((v.confidence||0)*100)+'%"></i></div></div></div>';
    if (v.reason) h += '<p class="v2-reason">'+esc(v.reason)+'</p>';

    // identity
    var id = e.identity || {};
    var ih = kv('Sector', esc(id.sector || 'pending — sector not yet classified (added 2026-10-05 roadmap)')) +
      kv('Listing date', esc(id.listing_date || '—')) +
      kv('Age', id.age_sessions != null ? esc(id.age_sessions) + ' sessions' : '—') +
      kv('Float', id.float_status === 'measured'
        ? esc(fmtN(id.float_shares,0)) + ' shares (' + fmtPct(id.promoter_pct) + ' promoter)' + (id.traded_public_pct != null ? ' · ' + id.traded_public_pct + '% of float traded' : '')
        : esc('float capture in progress — added 2026-10-05 roadmap'));
    h += sec('Identity', ih);

    // lock-in — HARD RULE: precise date only from verified tiers
    var lk = e.lockin || {};
    var lh;
    if (lk.listing_date_source === 'user-verified' || lk.listing_date_source === 'lockin-table') {
      lh = kv('Status', esc(lk.status || '—')) +
        (lk.expiry ? kv(lk.status === 'expired' ? 'Expired' : 'Expiry', esc(lk.expiry) + (lk.expiry_bs ? ' BS' : '')) : '') +
        kv('Source', esc(lk.provenance || lk.listing_date_source || '—'));
      if (lk.note) lh += '<p class="v2-note2">'+esc(lk.note)+'</p>';
    } else {
      lh = gap('Lock-in expiry: estimated window — true listing date not yet verified (added 2026-10-05 roadmap).') +
        kv('Position', esc(lk.status || '—') + ' <span class="dim">(estimated)</span>');
    }
    h += sec('Promoter lock-in', lh);

    // circuit record
    var c = e.circuit_record || {};
    var ch = kv('Limit-ups, 60d', fmtN(c.limit_ups_60d, 0)) +
      kv('Limit-ups, all-time', fmtN(c.limit_ups_alltime, 0)) +
      kv('Last circuit', esc(c.last_circuit || '—'));
    if (c.age_gate === 'exhaustion_suppressed_age_lt_15')
      ch += '<p class="v2-note2">Exhaustion read suppressed — listing under 15 sessions (young-listing limit-ups read as ignition, not exhaustion).</p>';
    else if (c.note) ch += '<p class="v2-note2">'+esc(c.note)+'</p>';
    h += sec('Circuit record', ch);

    // volume
    var vm = e.volume_anatomy || {};
    var vh = '';
    if (vm.withheld_float_flag) vh += '<p class="v2-badge">Withheld float — unusually low traded float for the size</p>';
    var tv = vm.top_volume_days || [];
    vh += tv.length
      ? '<div class="v2-list">' + tv.slice(0,5).map(function (d) {
          return '<div class="v2-kv"><span>'+esc(d.date)+'</span><span>'+esc(fmtN(d.qty,0))+' shares · '+esc(d.context||'')+'</span></div>';
        }).join('') + '</div>'
      : gap('Volume anatomy not yet computed for this symbol.');
    h += sec('Volume', vh);

    // drawdown
    var dd = e.drawdown_state || {};
    var dh = kv('From peak', fmtPct(dd.from_peak_pct)) +
      kv('Peak date', esc(dd.peak_date || '—')) +
      kv('Sessions underwater', fmtN(dd.sessions_underwater, 0)) +
      kv('Reclaimed 50% of drawdown', dd.reclaim50 ? 'yes' : 'no');
    h += sec('Drawdown', dh);

    // factors
    var fs = e.factors || [];
    var fh = '<div class="v2-list">' + fs.map(function (f) {
      var exp = /experimental/i.test(f.reading || '') || /NOT in score/i.test(f.backtest || '');
      return '<div class="v2-factor"><div class="v2-fhead"><strong>'+esc(f.name)+'</strong>' +
        (exp ? ' <span class="v2-early">experimental — not in score</span>' : '') + '</div>' +
        '<div class="v2-kv"><span>Reading</span><span>'+esc(f.reading||'—')+(f.value!=null?' ('+Number(f.value).toFixed(3)+')':'')+'</span></div>' +
        '<div class="v2-kv"><span>Direction</span><span>'+esc(f.direction||'—')+'</span></div>' +
        '<div class="v2-bt">'+esc(f.backtest||'no backtest stat')+'</div></div>';
    }).join('') + '</div>';
    h += sec('Factors (' + fs.length + ')', fh);

    // episodes
    var ep = e.episode_history || [];
    var eh = ep.length
      ? '<div class="v2-list">' + ep.map(function (x) {
          return '<div class="v2-kv"><span>'+esc(x.type)+' · peak '+esc(x.peak_date||x.peak)+'</span><span>'+esc(x.source||'')+'</span></div>';
        }).join('') + '</div>'
      : gap('No labeled pump/distribution episodes for this symbol.');
    if (e.analyst_narrative) eh += '<p class="v2-note2">'+esc(e.analyst_narrative)+'</p>';
    h += sec('Episode history', eh);

    // fundamentals
    var fu = e.fundamentals || {};
    var uh;
    if (fu.status === 'reported') {
      uh = kv('FY / quarter', esc((fu.fiscal_year||'') + ' ' + (fu.quarter||''))) +
        kv('EPS (TTM)', fmtN(fu.eps_ttm, 2)) + kv('P/E (TTM)', fmtN(fu.pe_ttm, 1)) +
        kv('BVPS', fmtN(fu.bvps, 2)) + kv('ROE (TTM)', fmtPct((fu.roe_ttm||0)/100)) +
        kv('Net profit', esc(fmtN(fu.netprofit_k,0)) + 'k NPR') +
        '<p class="v2-note2">Figures are public facts from company filings (FY ' + esc(fu.fiscal_year||'') + '). Evidence only — never scored.</p>';
    } else {
      uh = gap('No fundamentals record in the 2026-10-05 export — symbol not covered or non-reporting.');
    }
    h += sec('Fundamentals', uh);

    // promoter gap
    var pr = e.promoter || {};
    h += sec('Promoter', pr.status === 'pending'
      ? gap('Promoter identity not yet captured — added 2026-10-05 roadmap.')
      : '<p>'+esc(pr.note||'')+'</p>');

    // base rates — hit AND failure rates, always together
    var br = e.base_rates_shown || {};
    var bh = Object.keys(br).length
      ? '<div class="v2-list">' + Object.keys(br).map(function (k) {
          return '<div class="v2-kv"><span>'+esc(k.replace(/_/g,' '))+'</span><span>'+esc(br[k])+'</span></div>';
        }).join('') + '</div>' +
        '<p class="v2-note2">Base rates include failure rates by design — a signal without its miss rate is not shown.</p>'
      : gap('Base rates pending for this symbol.');
    h += sec('Base rates (honest)', bh);

    h += '<p class="v2-methodlink"><a href="/nepse-verdicts-v2/methodology/">How this verdict is built →</a></p>';
    h += '<p class="v2-disclaimer">Educational analysis, not investment advice. Past patterns do not guarantee future results.</p>';
    return h;
  }

  function init() {
    var s = $('v2Search');
    if (s) s.addEventListener('input', function(){ state.q = s.value.trim(); state.page=1; state.expanded=null; renderTable(); });
    // async after first paint: let the shell render first
    if ('requestIdleCallback' in window) requestIdleCallback(load, {timeout: 1500});
    else setTimeout(load, 60);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
