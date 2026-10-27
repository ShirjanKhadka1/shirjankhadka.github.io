/* nepse-radar/radar.js — Distribution Radar board (teardown 2026-10-28).
   Reads ONLY /data/verdicts-v2-summary.json (the v2 engine's current
   verdicts) + /data/warning-ledger.json (forward outcome tracking).
   All counts are computed from the payloads at runtime — nothing is
   hardcoded. 60s change-gated refresh: view handlers RE-BASELINE the
   signature after every render and NEVER null it. */
(function(){
  'use strict';
  var LABELS = {
    'DISTRIBUTION_WARNING': 'Distribution Warning',
    'ELEVATED_RISK': 'Elevated Risk',
    'BOUNCE_SETUP': 'Bounce Setup',
    'NEUTRAL': 'Neutral',
    'UNRELIABLE': 'Unreliable data',
    'INSUFFICIENT_DATA': 'Insufficient data',
    'EXCLUDED_NON_EQUITY': 'Non-equity'
  };
  var FLAG = ['EXHAUSTION_RISK','DISTRIBUTION_WARNING','ELEVATED_RISK','IGNITION','BOUNCE_SETUP'];
  function isFlag(l){ return FLAG.indexOf(l) >= 0; }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtN(n, d){ if (n == null || n === '') return '—'; var f = parseFloat(n); if (isNaN(f)) return '—'; return f.toFixed(d == null ? 2 : d); }
  function fmtPct(c){ if (c == null) return '—'; return Math.round(c * 100) + '%'; }
  function pillCls(l){
    return l === 'DISTRIBUTION_WARNING' ? 'warn' : l === 'ELEVATED_RISK' ? 'elev' : l === 'BOUNCE_SETUP' ? 'opp' : l === 'NEUTRAL' ? 'neu' : 'unr';
  }
  function flagCls(f){
    return f === 'CLIMAX' ? 'climax' : f === 'WINNER_FADE' ? 'fade' : f === 'BOUNCE_SETUP' ? 'bounce' : '';
  }
  function flagTitle(f){
    return f === 'CLIMAX' ? 'Climax / blow-off top' : f === 'WINNER_FADE' ? 'Prior winner fading' : f === 'BOUNCE_SETUP' ? 'Bounce setup flag' : f;
  }
  function fmtSince(p){
    if (!p || !p.since) return '';
    var dt = new Date(p.since + 'T00:00:00');
    var ds = isNaN(dt.getTime()) ? p.since : dt.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
    var s = 'since ' + ds;
    if (p.since_sessions != null) s += ' · ' + p.since_sessions + (p.since_sessions === 1 ? ' session' : ' sessions');
    return s;
  }
  function changeChip(label, p){
    if (!p || !p.changed_latest) return '';
    if (isFlag(label) && !isFlag(p.prev_label)) return '<span class="rd-chip new">New</span>';
    if (!isFlag(label) && isFlag(p.prev_label)) return '<span class="rd-chip cleared">Cleared</span>';
    return '';
  }
  function sinceLine(p){
    var s = fmtSince(p);
    return s ? '<span class="rd-since">' + s + '</span>' : '';
  }
  function nptTime(d){
    try { return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kathmandu'}); }
    catch (e) { return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}); }
  }

  var state = {
    verdicts: {}, summary: null, ledger: null,
    filter: 'warnings', sector: 'all', sort: 'conf-desc', search: '', page: 1,
    sig: null, lastCheck: null
  };
  var PAGE_SIZE = 25;

  function $(id){ return document.getElementById(id); }

  function rowsFiltered(){
    var rows = [];
    Object.keys(state.verdicts).forEach(function(sym){
      var v = state.verdicts[sym];
      var label = v.label || 'NEUTRAL';
      if (state.filter === 'warnings') {
        if (['DISTRIBUTION_WARNING','ELEVATED_RISK','BOUNCE_SETUP'].indexOf(label) < 0) return;
      } else if (state.filter !== 'all' && label !== state.filter) return;
      var sec = v.sector || 'Unspecified';
      if (state.sector !== 'all' && sec !== state.sector) return;
      if (state.search && sym.toLowerCase().indexOf(state.search) < 0) return;
      rows.push({sym: sym, v: v, label: label});
    });
    rows.sort(function(a, b){
      var ca = a.v.confidence == null ? -1 : a.v.confidence;
      var cb = b.v.confidence == null ? -1 : b.v.confidence;
      if (state.sort === 'conf-asc') { if (ca !== cb) return ca - cb; }
      else if (state.sort === 'sym-asc') { return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0; }
      else { if (ca !== cb) return cb - ca; }
      return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0;
    });
    return rows;
  }

  function computeSig(){
    var s = state.summary, counts = {};
    Object.keys(state.verdicts).forEach(function(k){
      var l = state.verdicts[k].label || 'NEUTRAL';
      counts[l] = (counts[l] || 0) + 1;
    });
    /* Full-payload hash: any displayed field change (confidence, flags,
       scores, sector, lock-in) must re-render. A label-count-only signature
       would miss confidence-only updates (proven by QA). djb2 over the
       verdicts JSON; cheap at 60s cadence. */
    var hash = 0, json = '';
    try { json = JSON.stringify(state.verdicts); } catch (e) { json = ''; }
    for (var i = 0; i < json.length; i++) { hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0; }
    return [
      s ? s.asof : '', s ? s.count : 0,
      Object.keys(counts).sort().map(function(k){ return k + ':' + counts[k]; }).join(','),
      'vhash:' + hash,
      state.ledger ? state.ledger.updated_at : '',
      s && s.failures ? s.failures.length : 0
    ].join('|');
  }
  function rebaseline(){ state.sig = computeSig(); }

  function renderStats(){
    var v = state.verdicts, c = {dw: 0, de: 0, do: 0};
    Object.keys(v).forEach(function(k){
      var l = v[k].label;
      if (l === 'DISTRIBUTION_WARNING') c.dw++;
      else if (l === 'ELEVATED_RISK') c.de++;
      else if (l === 'BOUNCE_SETUP') c.do++;
    });
    var tot = Object.keys(v).length, warn = c.dw + c.de + c.do;
    $('rd-stat-warn').textContent = warn;
    $('rd-stat-dist').textContent = c.dw;
    $('rd-stat-elev').textContent = c.de;
    $('rd-stat-bounce').textContent = c.do;
    $('rd-stat-scored').textContent = tot;
    $('rd-stat-warn-sub').textContent = 'Distribution ' + c.dw + ' · Elevated ' + c.de + ' · Bounce ' + c.do;
    var pillCounts = {'warnings': warn, 'all': tot, 'DISTRIBUTION_WARNING': c.dw, 'ELEVATED_RISK': c.de, 'BOUNCE_SETUP': c.do};
    var pillLabels = {'warnings': 'Warnings', 'all': 'All verdicts', 'DISTRIBUTION_WARNING': 'Distribution', 'ELEVATED_RISK': 'Elevated Risk', 'BOUNCE_SETUP': 'Bounce Setups'};
    $('rd-filters').querySelectorAll('button[data-filter]').forEach(function(b){
      var f = b.getAttribute('data-filter');
      b.textContent = pillLabels[f] + ' (' + pillCounts[f] + ')';
    });
  }

  function renderDist(){
    var v = state.verdicts, b = {dw: 0, de: 0, do: 0, dn: 0, dx: 0};
    Object.keys(v).forEach(function(k){
      var l = v[k].label || 'NEUTRAL';
      if (l === 'DISTRIBUTION_WARNING') b.dw++;
      else if (l === 'ELEVATED_RISK') b.de++;
      else if (l === 'BOUNCE_SETUP' || l === 'IGNITION') b.do++;
      else if (l === 'NEUTRAL') b.dn++;
      else b.dx++;
    });
    var tot = Object.keys(v).length || 1;
    var seg = [['dw','Distribution Warning',b.dw],['de','Elevated Risk',b.de],['do','Bounce / Ignition',b.do],['dn','Neutral',b.dn],['dx','Excluded / unreliable / insufficient',b.dx]];
    var track = '', legend = '';
    seg.forEach(function(s){
      if (!s[2]) return;
      track += '<i class="' + s[0] + '" style="width:' + (s[2] / tot * 100).toFixed(2) + '%"></i>';
      legend += '<span><b class="' + s[0] + '"></b>' + s[1] + ' ' + s[2] + '</span>';
    });
    $('rd-dist-track').innerHTML = track;
    $('rd-dist-legend').innerHTML = legend;
  }

  function renderSectors(){
    var groups = {};
    Object.keys(state.verdicts).forEach(function(sym){
      var v = state.verdicts[sym];
      var sec = v.sector || 'Unspecified';
      (groups[sec] = groups[sec] || []).push({sym: sym, v: v});
    });
    var names = Object.keys(groups).sort(function(a, b){ return groups[b].length - groups[a].length; });
    var sel = $('rd-sector');
    var cur = state.sector;
    sel.innerHTML = '<option value="all">All sectors</option>' + names.map(function(n){
      return '<option value="' + esc(n) + '"' + (cur === n ? ' selected' : '') + '>' + esc(n) + ' (' + groups[n].length + ')</option>';
    }).join('');
    $('rd-sectors').innerHTML = names.map(function(n){
      var rows = groups[n];
      var dw = rows.filter(function(r){ return r.v.label === 'DISTRIBUTION_WARNING'; }).length;
      var de = rows.filter(function(r){ return r.v.label === 'ELEVATED_RISK'; }).length;
      var bo = rows.filter(function(r){ return r.v.label === 'BOUNCE_SETUP'; }).length;
      var flagged = rows.filter(function(r){ return ['DISTRIBUTION_WARNING','ELEVATED_RISK','BOUNCE_SETUP'].indexOf(r.v.label) >= 0; })
        .sort(function(a, b){ return (b.v.confidence || 0) - (a.v.confidence || 0) || (a.sym < b.sym ? -1 : 1); })
        .slice(0, 3);
      var tot = rows.length || 1;
      var bar = '';
      if (dw) bar += '<i class="dw" style="width:' + (dw / tot * 100).toFixed(1) + '%"></i>';
      if (de) bar += '<i class="de" style="width:' + (de / tot * 100).toFixed(1) + '%"></i>';
      if (bo) bar += '<i class="do" style="width:' + (bo / tot * 100).toFixed(1) + '%"></i>';
      var top = flagged.length ? '<ul class="rd-sector-top">' + flagged.map(function(r){
        return '<li><a href="/stocks/' + esc(r.sym) + '/">' + esc(r.sym) + '</a><span><span class="rd-pill ' + pillCls(r.v.label) + '">' + esc(LABELS[r.v.label] || r.v.label) + '</span> ' + fmtPct(r.v.confidence) + '</span></li>';
      }).join('') + '</ul>' : '<p class="rd-sector-empty">No current warnings in this sector.</p>';
      var active = state.sector === n ? ' is-open' : '';
      return '<button type="button" class="d3-card d3-card--lift rd-sector' + active + '" data-sec="' + esc(n) + '" aria-pressed="' + (state.sector === n) + '">' +
        '<h3>' + esc(n) + '</h3>' +
        '<p class="rd-sector-meta">' + rows.length + ' securities · ' + dw + ' distribution · ' + de + ' elevated · ' + bo + ' bounce</p>' +
        '<div class="rd-sector-bar">' + bar + '</div>' + top + '</button>';
    }).join('');
    $('rd-sectors').querySelectorAll('button[data-sec]').forEach(function(btn){
      btn.addEventListener('click', function(){
        setSector(btn.getAttribute('data-sec'));
        document.getElementById('rd-table-wrap').scrollIntoView({behavior: 'smooth', block: 'start'});
      });
    });
  }

  function setSector(sec){
    state.sector = sec; state.page = 1;
    $('rd-sector').value = sec;
    renderSectors(); renderTable(); rebaseline();
  }

  function renderMoves(){
    var s = state.summary, meta = (s && s.persistence_meta) || {};
    var changed = meta.changed || 0, nf = meta.new_flags || 0, cl = meta.cleared || 0;
    var other = Math.max(0, changed - nf - cl);
    var tot = changed || 1;
    $('rd-moves-bar').innerHTML =
      (nf ? '<i class="mn" style="width:' + (nf / tot * 100).toFixed(1) + '%"></i>' : '') +
      (cl ? '<i class="mc" style="width:' + (cl / tot * 100).toFixed(1) + '%"></i>' : '') +
      (other ? '<i class="mo" style="width:' + (other / tot * 100).toFixed(1) + '%"></i>' : '');
    $('rd-moves-legend').innerHTML =
      '<span><b class="mn"></b>New flags ' + nf + '</span>' +
      '<span><b class="mc"></b>Cleared ' + cl + '</span>' +
      '<span><b class="mo"></b>Other label changes ' + other + '</span>' +
      '<span>Changed this session: ' + changed + ' (session ' + esc(meta.session || '') + ', prev ' + esc(meta.prev_session || '') + ')</span>';
    var nv = [], cv = [];
    Object.keys(state.verdicts).forEach(function(sym){
      var v = state.verdicts[sym], p = v.persistence || {};
      if (!p.changed_latest) return;
      var lab = v.label, prev = p.prev_label;
      if (isFlag(lab) && !isFlag(prev)) nv.push(sym);
      else if (!isFlag(lab) && isFlag(prev)) cv.push(sym);
    });
    nv.sort(); cv.sort();
    $('rd-new-chips').innerHTML = nv.length ? nv.map(function(sym){
      return '<a href="/stocks/' + esc(sym) + '/">' + esc(sym) + '</a>';
    }).join('') : '<span style="color:var(--nd-dim)">None this session.</span>';
    $('rd-cleared-chips').innerHTML = cv.length ? cv.map(function(sym){
      return '<a href="/stocks/' + esc(sym) + '/">' + esc(sym) + '</a>';
    }).join('') : '<span style="color:var(--nd-dim)">None this session.</span>';
  }

  function renderTable(){
    var rows = rowsFiltered();
    var total = rows.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE, slice = rows.slice(start, start + PAGE_SIZE);
    var body = $('rd-body');
    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center">No verdicts match this filter.</td></tr>';
    } else {
      body.innerHTML = slice.map(function(r){
        var v = r.v;
        var conf = v.confidence != null ? '<span class="rd-conf"><i style="width:' + Math.round(v.confidence * 100) + '%"></i></span>' + fmtPct(v.confidence) : '—';
        var flags = (v.flags || []).map(function(f){
          return '<span class="rd-flag ' + flagCls(f) + '" title="' + esc(flagTitle(f)) + '">' + esc(f) + '</span>';
        }).join('');
        var lk = v.lockin || {};
        if (lk.status === 'in_lockin' || lk.status === 'estimated_in_lockin_window') {
          flags += '<span class="rd-flag lock" title="Lock-in status: ' + esc(lk.status) + '">🔒 lock-in</span>';
        }
        var scores = [];
        if (v.pump_score != null && v.pump_score > 0) scores.push('pump ' + fmtN(v.pump_score));
        if (v.opportunity_score != null) scores.push('opp ' + fmtN(v.opportunity_score));
        var early = v.early_lifecycle ? '<span class="rd-early" title="Early lifecycle — short price history">early</span>' : '';
        return '<tr>' +
          '<td><a class="rdsym" href="/stocks/' + esc(r.sym) + '/">' + esc(r.sym) + '</a>' + early + '</td>' +
          '<td><span class="rd-pill ' + pillCls(r.label) + '">' + esc(LABELS[r.label] || r.label) + '</span>' + changeChip(r.label, v.persistence) + sinceLine(v.persistence) + '</td>' +
          '<td class="num">' + conf + '</td>' +
          '<td>' + esc(v.sector || 'Unspecified') + '</td>' +
          '<td>' + (flags || '—') + '</td>' +
          '<td class="num">' + (scores.length ? scores.join(' · ') : '—') + '</td></tr>';
      }).join('');
    }
    $('rd-count').textContent = total === 0 ? 'Showing 0 of 0 securities' :
      'Showing ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, total) + ' of ' + total + ' securities';
    var pager = $('rd-pager');
    var btns = '';
    btns += '<button type="button" class="rd-prev" data-page="' + (state.page - 1) + '"' + (state.page <= 1 ? ' disabled' : '') + '>← Prev</button>';
    for (var p = 1; p <= pages; p++) {
      if (pages > 7 && Math.abs(p - state.page) > 2 && p !== 1 && p !== pages) continue;
      btns += '<button type="button" class="rd-page' + (p === state.page ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
    }
    btns += '<button type="button" class="rd-next" data-page="' + (state.page + 1) + '"' + (state.page >= pages ? ' disabled' : '') + '>Next →</button>';
    pager.innerHTML = btns + '<span class="rd-pageinfo">Page ' + state.page + ' of ' + pages + '</span>';
    pager.querySelectorAll('button[data-page]').forEach(function(b){
      b.addEventListener('click', function(){
        var pg = parseInt(b.getAttribute('data-page'), 10);
        if (!pg || pg < 1 || pg > pages || pg === state.page) return;
        state.page = pg; renderTable(); rebaseline();
        document.getElementById('rd-table-wrap').scrollIntoView({behavior: 'smooth', block: 'start'});
      });
    });
  }

  function renderTrack(){
    var L = state.ledger;
    if (!L || !L.warnings) { $('rd-track').style.display = 'none'; return; }
    $('rd-track').style.display = '';
    var w = L.warnings, issued = w.length, open = 0, prov = 0, resolved = 0, maxEl = 0;
    var perSession = {};
    w.forEach(function(x){
      var oc = x.outcomes || {}, st = oc.status || 'open';
      if (st === 'provisional_hit') prov++;
      else if (st === 'open') open++;
      else resolved++;
      if (oc.sessions_elapsed && oc.sessions_elapsed > maxEl) maxEl = oc.sessions_elapsed;
      perSession[x.session_date] = (perSession[x.session_date] || 0) + 1;
    });
    $('rd-track-issued').textContent = issued;
    $('rd-track-open').textContent = open;
    $('rd-track-prov').textContent = prov;
    $('rd-track-resolved').textContent = resolved;
    $('rd-track-note').innerHTML = resolved === 0
      ? '<strong>No resolved warnings yet — no hit rate to report.</strong> Precision is hits ÷ resolved warnings; with 0 resolved, the rate stays blank by design, never a placeholder. The earliest warnings are only ' + maxEl + ' sessions old (20-session horizon).'
      : 'Precision (hits ÷ resolved): ' + (resolved ? 'see the full ledger on the Warning Radar page' : '—') + '.';
    var sessions = Object.keys(perSession).sort().slice(-10);
    var maxC = Math.max.apply(null, sessions.map(function(s){ return perSession[s]; }).concat([1]));
    $('rd-sessions').innerHTML = sessions.map(function(s){
      var c = perSession[s];
      return '<div class="rd-session"><i style="height:' + Math.max(4, Math.round(c / maxC * 64)) + 'px"></i><span>' + esc(s.slice(5)) + '<br>' + c + '</span></div>';
    }).join('');
    $('rd-track-meta').textContent = 'Ledger updated ' + esc(L.updated_at || '') + ' · ' + sessions.length + ' sessions tracked (first ' + esc(sessions[0] || '') + ') · full 196-warning ledger on the Warning Radar page.';
  }

  function renderFailures(){
    var s = state.summary;
    if (!s || !s.failures) { $('rd-failures').style.display = 'none'; return; }
    $('rd-failures').style.display = '';
    $('rd-fail-count').textContent = s.failures.length;
    $('rd-fail-list').innerHTML = s.failures.map(function(f){
      return '<li><b>' + esc(f.symbol) + '</b> — ' + esc(f.reason) + ' (' + esc(f.bars) + ' bars)</li>';
    }).join('');
  }

  function renderCoverage(){
    var s = state.summary;
    if (!s) return;
    var cov = s.coverage || {};
    $('rd-coverage').innerHTML =
      'Verdicts as of ' + esc(s.asof || s.session_date || '') + ' · ' +
      (cov.scored != null ? cov.scored : Object.keys(state.verdicts).length) + ' of ' +
      (cov.listed != null ? cov.listed : '') + ' listed in this engine run · ' +
      (cov.failures != null ? cov.failures : '') + ' unscored (named below) · ' +
      'engine ' + esc(s.engine || 'verdict-v2') + ' · regime ' + esc(s.regime || '') +
      (s.regime_note ? ' — ' + esc(s.regime_note) : '');
  }

  function renderFresh(){
    var s = state.summary, now = new Date();
    var nxt = new Date(now.getTime() + 60000);
    $('rd-fresh').innerHTML = '<span class="rd-dot"></span>' +
      'Warnings as of ' + esc(s ? (s.asof || s.session_date || '') : '') +
      ' · ledger updated ' + esc(state.ledger ? (state.ledger.updated_at || '') : '') +
      ' · checked ' + nptTime(now) + ' NPT · next check ' + nptTime(nxt) + ' NPT · refreshes every 60s when the data changes';
    state.lastCheck = now;
  }

  function renderAll(){
    renderStats(); renderDist(); renderSectors(); renderMoves();
    renderTable(); renderTrack(); renderFailures(); renderCoverage(); renderFresh();
  }

  function load(){
    return Promise.all([
      fetch('/data/verdicts-v2-summary.json', {cache: 'no-store'}).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
      fetch('/data/warning-ledger.json', {cache: 'no-store'}).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function(){ return null; })
    ]).then(function(res){
      state.summary = res[0];
      state.verdicts = res[0].verdicts || {};
      state.ledger = res[1];
      return true;
    });
  }

  function refreshTick(){
    load().then(function(){
      if (computeSig() !== state.sig) {
        var keepPage = state.page;
        renderAll(); rebaseline();
        state.page = Math.min(keepPage, Math.max(1, Math.ceil(rowsFiltered().length / PAGE_SIZE)));
        renderTable(); rebaseline();
      } else {
        renderFresh();
      }
    }).catch(function(){ renderFresh(); });
  }

  function wireControls(){
    $('rd-filters').addEventListener('click', function(e){
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      state.filter = btn.getAttribute('data-filter'); state.page = 1;
      this.querySelectorAll('button').forEach(function(b){
        b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
      renderTable(); rebaseline();
    });
    $('rd-sector').addEventListener('change', function(){ setSector(this.value); });
    $('rd-sort').addEventListener('change', function(){ state.sort = this.value; state.page = 1; renderTable(); rebaseline(); });
    $('rd-search').addEventListener('input', function(){ state.search = this.value.trim().toLowerCase(); state.page = 1; renderTable(); rebaseline(); });
  }

  load().then(function(){
    wireControls();
    renderAll(); rebaseline();
    setInterval(refreshTick, 60000);
  }).catch(function(err){
    $('rd-body').innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center">Could not load verdicts: ' + esc(err.message) + '</td></tr>';
    $('rd-fresh').textContent = 'Verdicts unavailable — refresh the page to retry.';
  });
})();
