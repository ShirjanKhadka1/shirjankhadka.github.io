/* nepse-verdicts-v2/verdicts-v2.js — Warning Radar board + sectors + ledger +
 * forward track record + 60s change-gated refresh (teardown 2026-10-27).
 * Loads /data/verdicts-v2-summary.json (board) + /data/warning-ledger.json
 * (ledger + per-session trend) + /data/verdicts-v2-track-record.json
 * (forward outcomes) + /data/verdicts-v2-history.json (archive sessions).
 * Evidence accordions fetch per-letter shards (/data/verdicts-v2.d/<L>.json)
 * with fallback to the full /data/verdicts-v2.json.
 * REFRESH LAW (standing lesson): view-change handlers RE-BASELINE the
 * refresh signature after render — NEVER null it. A null signature
 * swallowed the first real change after a selection on another page.
 * All output escaped. Honesty rules: proxy lock-in never shows a precise
 * date; pending sections render as visible dated gaps; every signal shows
 * its backtest stat; unresolved warnings never get a placeholder rate. */
(function () {
  'use strict';
  var SUMMARY_URL = '/data/verdicts-v2-summary.json';
  var FULL_URL = '/data/verdicts-v2.json';
  var LEDGER_URL = '/data/warning-ledger.json';
  var TRACK_URL = '/data/verdicts-v2-track-record.json';
  var HISTORY_URL = '/data/verdicts-v2-history.json';
  var PER_PAGE = 50, LEDGER_PER_PAGE = 25;

  var state = { rows: [], asof: '', session: '', regime: '', regimeNote: '',
    engine: '', horizon: null, q: '', verdict: 'all', sector: 'all',
    sortKey: 'confidence', sortDir: -1, page: 1, ledgerPage: 1,
    expanded: null, pmeta: null, coverage: null, failures: [],
    ledger: [], ledgerUpdated: '', track: null, historySessions: [],
    builtAt: '', sig: null };
  var fullCache = null, fullLoading = false;
  var SHARD_BASE = '/data/verdicts-v2.d/';
  var shardCache = {}, shardLoading = {};
  var refreshTimer = null;

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
  function fmtPct2(v) { // signed decimal fraction -> +x.xx% / -x.xx%
    if (v == null || !isFinite(Number(v))) return '—';
    var p = Number(v) * 100;
    return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
  }
  function fmtAge(s) {
    if (s == null || !isFinite(Number(s))) return '—';
    s = Math.round(Number(s));
    if (s < 22) return s + ' sessions';
    if (s < 250) return '≈' + Math.round(s / 21) + ' mo';
    return (s / 250).toFixed(1) + ' yrs';
  }
  function fmtNPT(iso) { // ISO timestamp -> "27 Oct 2026, 15:55 NPT"
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu',
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false }) + ' NPT';
    } catch (e) { return String(iso); }
  }
  function fmtClock(d) {
    try {
      return d.toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu',
        hour: '2-digit', minute: '2-digit', hour12: false }) + ' NPT';
    } catch (e) { return ''; }
  }
  function fmtDate(iso) { // YYYY-MM-DD -> "27 Oct 2026"
    if (!iso) return '—';
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
  var WARN = ['EXHAUSTION_RISK', 'DISTRIBUTION_WARNING', 'ELEVATED_RISK'];
  var FLAGGED = ['EXHAUSTION_RISK', 'DISTRIBUTION_WARNING', 'ELEVATED_RISK', 'IGNITION', 'BOUNCE_SETUP'];
  function isFlag(l) { return FLAGGED.indexOf(l) >= 0; }
  function isWarn(l) { return WARN.indexOf(l) >= 0; }
  function isOpp(l) { return l === 'IGNITION' || l === 'BOUNCE_SETUP'; }

  function lockinCell(lk) {
    if (!lk) return '<span class="v3-dim">—</span>';
    if (lk.expiry) {
      var exp = lk.status === 'expired';
      return '<span class="v2-lock ' + (exp ? 'exp' : '') + '">' +
        (exp ? 'expired ' : 'expires ') + esc(lk.expiry) + '</span>';
    }
    return '<span class="v3-dim">expiry unverified</span>';
  }

  function fetchJSON(url, bust) {
    var u = bust ? url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now() : url;
    return fetch(u, { credentials: 'same-origin', cache: bust ? 'no-store' : 'default' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ---------------- signature + refresh ---------------- */

  function computeSig() {
    return [state.asof, state.session, state.rows.length,
      state.coverage ? state.coverage.scored + '/' + state.coverage.listed + '/' + state.coverage.failures : '',
      state.pmeta ? state.pmeta.changed + '/' + state.pmeta.new_flags + '/' + state.pmeta.cleared : '',
      state.ledgerUpdated, state.track ? state.track.updated_at || '' : '',
      state.historySessions.join(',')].join('|');
  }
  function rebaseline() { state.sig = computeSig(); }

  function renderFresh() {
    var el = $('v2Fresh');
    if (!el) return;
    var now = new Date(), next = new Date(now.getTime() + 60000);
    var built = state.builtAt ? ' · pipeline updated ' + fmtNPT(state.builtAt) : '';
    el.textContent = state.session
      ? 'Board as of ' + state.session + built + ' · checked ' + fmtClock(now) + ' · next check ' + fmtClock(next) + ' · refreshes every 60s when the data changes'
      : 'Board session unavailable';
  }

  function applySummary(json) {
    state.asof = json.asof || '';
    state.session = json.session_date || '';
    state.regime = json.regime || '';
    state.regimeNote = json.regime_note || '';
    state.engine = json.engine || '';
    state.coverage = json.coverage || null;
    state.pmeta = json.persistence_meta || null;
    state.failures = json.failures || [];
    if (!state.coverage && json.failures) {
      var nScored = Object.keys(json.verdicts || {}).length;
      state.coverage = { scored: nScored, failures: json.failures.length,
        listed: nScored + json.failures.length };
    }
    var v = json.verdicts || {};
    state.rows = Object.keys(v).map(function (sym) {
      var r = v[sym] || {};
      return {
        sym: sym, label: r.label || 'NEUTRAL',
        confidence: (typeof r.confidence === 'number' ? r.confidence : 0),
        pump: (typeof r.pump_score === 'number' ? r.pump_score : null),
        opp: (typeof r.opportunity_score === 'number' ? r.opportunity_score : null),
        horizon: r.horizon, age: r.age_sessions, sec: r.sector || null,
        early: !!r.early_lifecycle,
        flags: r.flags || [], lockin: r.lockin || null,
        pers: r.persistence || null
      };
    });
    var hz = null;
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].horizon != null) { hz = state.rows[i].horizon; break; }
    }
    state.horizon = hz;
  }

  function loadAll(bust, onDone) {
    var done = 0, total = 4;
    function tick() { if (++done >= total && onDone) onDone(); }
    fetchJSON(SUMMARY_URL, bust).then(function (json) {
      applySummary(json);
      renderHead(); renderHero(); renderStats(); renderControls(); renderSectors(); renderTable(); renderFailures();
      tick();
    }).catch(function () {
      $('v2TableWrap').innerHTML = '<div class="v2-empty">Could not load the warning radar. Please reload.</div>';
      tick();
    });
    fetchJSON(LEDGER_URL, bust).then(function (json) {
      state.ledger = json.warnings || [];
      state.ledgerUpdated = json.updated_at || '';
      if (!state.builtAt) state.builtAt = state.ledgerUpdated;
      renderTrend(); renderLedger();
      tick();
    }).catch(function () {
      $('v2Trend').innerHTML = '<div class="v2-empty">Could not load the warning ledger.</div>';
      $('v2Ledger').innerHTML = '<div class="v2-empty">Could not load the warning ledger.</div>';
      tick();
    });
    fetchJSON(TRACK_URL, bust).then(function (json) {
      state.track = json;
      if (!state.builtAt) state.builtAt = json.updated_at || '';
      renderTrack();
      tick();
    }).catch(function () {
      $('v2Track').innerHTML = '<div class="v2-empty">Could not load the forward track record.</div>';
      tick();
    });
    fetchJSON(HISTORY_URL, bust).then(function (json) {
      state.historySessions = json.sessions || [];
      renderHistory();
      tick();
    }).catch(function () {
      $('v2History').innerHTML = '<div class="v2-empty">Could not load the archive sessions.</div>';
      tick();
    });
  }

  function refreshTick() {
    var before = state.sig;
    loadAll(true, function () {
      if (computeSig() === before) {
        // Unchanged payloads: only the freshness clock advances.
        // The DOM is NOT re-rendered (change gate).
        renderFresh();
      } else {
        // Real change: re-render everything, keep the user's view
        // (filters, page, search, sector, expanded row) intact.
        if (state.page > 1) { /* renderTable clamps the page */ }
        renderHead(); renderHero(); renderStats(); renderControls(); renderSectors(); renderTable(); renderFailures();
        renderTrend(); renderTrack(); renderLedger(); renderHistory();
        rebaseline();
        renderFresh();
      }
    });
  }

  /* ---------------- hero + head ---------------- */

  function renderHead() {
    var rg = $('v2Regime'), asof = $('v2Asof');
    if (rg) rg.innerHTML = state.regime
      ? 'Market regime: <strong>' + esc(state.regime) + '</strong> <span class="dim">' + esc(state.regimeNote) + '</span>'
      : 'Market regime unavailable';
    if (asof) asof.textContent = state.session
      ? 'Verdicts from the ' + state.session + ' session · rebuilt daily after close'
      : 'Session date unavailable';
    renderFresh();
  }

  function warnRows() { return state.rows.filter(function (r) { return isWarn(r.label); }); }

  function renderHero() {
    var num = $('v2HeroNum'), chips = $('v2HeroChips');
    var w = warnRows();
    if (num) num.textContent = w.length;
    if (!chips) return;
    if (!w.length) { chips.innerHTML = '<span class="v2-hero-none">No warnings in the latest session.</span>'; return; }
    chips.innerHTML = w.map(function (r) {
      return '<button type="button" class="v2-chip" data-sym="' + esc(r.sym) + '">' + esc(r.sym) + '</button>';
    }).join('');
    chips.querySelectorAll('.v2-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = 'all'; state.sector = 'all'; state.q = b.getAttribute('data-sym'); state.page = 1; state.expanded = null;
        var s = $('v2Search'); if (s) s.value = state.q;
        renderStats(); renderControls(); renderSectors(); renderTable(); rebaseline();
        $('v2TableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ---------------- stats + distribution ---------------- */

  function fmtSince(p) {
    if (!p || !p.since) return '';
    var dt = new Date(p.since + 'T00:00:00');
    var ds = isNaN(dt.getTime()) ? p.since
      : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    var s = 'since ' + ds;
    if (p.since_sessions != null) {
      s += ' · ' + p.since_sessions + (p.since_sessions === 1 ? ' session' : ' sessions');
    }
    return s;
  }
  function changeChip(r) {
    var p = r.pers;
    if (!p || !p.changed_latest) return '';
    if (isFlag(r.label) && !isFlag(p.prev_label)) return ' <span class="v2-new">New</span>';
    if (!isFlag(r.label) && isFlag(p.prev_label)) return ' <span class="v2-cleared">Cleared</span>';
    return '';
  }

  function renderStats() {
    var host = $('v2Stats');
    if (!host) return;
    var warn = 0, neu = 0, opp = 0, exc = 0, unr = 0, ins = 0;
    state.rows.forEach(function (r) {
      if (isWarn(r.label)) warn++;
      else if (r.label === 'NEUTRAL') neu++;
      else if (isOpp(r.label)) opp++;
      else if (r.label === 'EXCLUDED_NON_EQUITY') exc++;
      else if (r.label === 'UNRELIABLE') unr++;
      else if (r.label === 'INSUFFICIENT_DATA') ins++;
    });
    var tot = state.rows.length || 1;
    var seg = [['dw', 'Warnings', warn], ['dn', 'Neutral', neu], ['do', 'Opportunity flags', opp],
      ['dx', 'Non-equity', exc], ['du', 'Unreliable data', unr], ['di', 'Too little data', ins]];
    var track = '', legend = '';
    seg.forEach(function (s) {
      if (!s[2]) return; // zero-count buckets render NO segment and NO legend row
      var pct = (s[2] / tot * 100);
      track += '<i class="' + s[0] + '" style="width:' + pct.toFixed(2) + '%"></i>';
      legend += '<span><b class="' + s[0] + '"></b>' + s[1] + ' ' + s[2] + '</span>';
    });
    host.innerHTML =
      '<button type="button" class="v2-stat warn" data-v="warnings" aria-pressed="' + (state.verdict === 'warnings') + '"><div class="num">' + warn + '</div><div class="lbl">Warnings</div></button>' +
      '<button type="button" class="v2-stat" data-v="NEUTRAL" aria-pressed="' + (state.verdict === 'NEUTRAL') + '"><div class="num">' + neu + '</div><div class="lbl">Neutral</div></button>' +
      '<button type="button" class="v2-stat opp" data-v="opps" aria-pressed="' + (state.verdict === 'opps') + '"><div class="num">' + opp + '</div><div class="lbl">Opportunity flags</div></button>' +
      '<button type="button" class="v2-stat" data-v="all" aria-pressed="' + (state.verdict === 'all') + '"><div class="num">' + state.rows.length + '</div><div class="lbl">Securities scanned</div></button>' +
      '<div class="v2-dist" role="img" aria-label="Verdict distribution across ' + state.rows.length + ' scanned securities"><div class="v2-dist-track">' + track + '</div><div class="v2-dist-legend">' + legend + '</div></div>' +
      (state.coverage ? '<p class="v2-coverage">' + state.coverage.scored + ' of ' + state.coverage.listed + ' listed securities scored · ' + state.coverage.failures + ' awaiting data</p>' : '') +
      (state.pmeta && state.pmeta.prev_session ? '<p class="v2-coverage">Latest session: ' + state.pmeta.changed + ' verdict' + (state.pmeta.changed === 1 ? '' : 's') + ' changed · ' + state.pmeta.new_flags + ' new flag' + (state.pmeta.new_flags === 1 ? '' : 's') + ' · ' + state.pmeta.cleared + ' cleared</p>' : '') +
      (state.engine ? '<p class="v2-coverage">Engine ' + esc(state.engine) + ' · horizon ' + (state.horizon || 20) + ' sessions · verdicts from the ' + esc(state.session || '') + ' session</p>' : '') +
      '<p class="v2-take">The radar is a warning instrument: it flags names that look dangerous and shows why. ' +
      '<a href="/nepse-verdicts-v2/methodology/">How it is validated →</a></p>';
    host.querySelectorAll('.v2-stat').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1; state.expanded = null;
        renderStats(); renderFilters(); renderTable(); rebaseline();
      });
    });
  }

  /* ---------------- controls: sector + sort + search + pills ---------------- */

  function sectorList() {
    var seen = {}, list = [];
    state.rows.forEach(function (r) {
      var s = r.sec || 'Unclassified';
      if (!seen[s]) { seen[s] = true; list.push(s); }
    });
    return list.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  }

  function renderControls() {
    var sel = $('v2SectorSel');
    if (sel) {
      var cur = state.sector;
      sel.innerHTML = '<option value="all">All sectors</option>' + sectorList().map(function (s) {
        return '<option value="' + esc(s) + '"' + (cur === s ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('');
    }
    syncSortSel();
    renderFilters();
  }

  function syncSortSel() {
    var sel = $('v2SortSel');
    if (!sel) return;
    var v = state.sortKey + '|' + state.sortDir;
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === v) { found = true; break; }
    }
    sel.value = found ? v : '';
  }

  var FILTERS = [['all', 'All'], ['warnings', 'Warnings'], ['DISTRIBUTION_WARNING', 'Distribution'], ['ELEVATED_RISK', 'Elevated'], ['NEUTRAL', 'Neutral'], ['opps', 'Opportunity'], ['UNRELIABLE', 'Unreliable']];
  function renderFilters() {
    var host = $('v2Filters');
    if (!host) return;
    host.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="v2-f" data-v="' + esc(f[0]) + '" aria-pressed="' + (state.verdict === f[0]) + '">' + esc(f[1]) + '</button>';
    }).join('');
    host.querySelectorAll('.v2-f').forEach(function (b) {
      b.addEventListener('click', function () {
        state.verdict = b.getAttribute('data-v'); state.page = 1; state.expanded = null;
        renderStats(); renderFilters(); renderTable(); rebaseline();
      });
    });
  }

  function filtered() {
    var rows = state.rows.slice();
    if (state.sector !== 'all') rows = rows.filter(function (r) { return (r.sec || 'Unclassified') === state.sector; });
    if (state.verdict === 'warnings') rows = rows.filter(function (r) { return isWarn(r.label); });
    else if (state.verdict === 'opps') rows = rows.filter(function (r) { return isOpp(r.label); });
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
      if (va < vb) return -1 * d; if (va > vb) return 1 * d; return 0;
    });
    return rows;
  }

  /* ---------------- sector cards ---------------- */

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function renderSectors() {
    var host = $('v2Sectors');
    if (!host) return;
    if (!state.rows.length) { host.innerHTML = '<div class="v2-empty">No sectors yet.</div>'; return; }
    var groups = {};
    state.rows.forEach(function (r) {
      var s = r.sec || 'Unclassified';
      if (!groups[s]) groups[s] = [];
      groups[s].push(r);
    });
    var names = Object.keys(groups).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    host.innerHTML = names.map(function (s) {
      var g = groups[s];
      var w = g.filter(function (r) { return isWarn(r.label); }).length;
      var o = g.filter(function (r) { return isOpp(r.label); }).length;
      var med = median(g.map(function (r) { return r.confidence; }));
      var pct = g.length ? Math.round(w / g.length * 100) : 0;
      var active = state.sector === s;
      return '<button type="button" class="d3-card d3-card--lift v2-sector' + (active ? ' is-open' : '') + '" data-sec="' + esc(s) + '" aria-pressed="' + active + '">' +
        '<span class="v2-sector-name">' + esc(s) + '</span>' +
        '<span class="v2-sector-count">' + g.length + ' stocks</span>' +
        '<span class="v2-sector-warn">' + w + ' warning' + (w === 1 ? '' : 's') + ' · ' + o + ' opportunity</span>' +
        '<span class="v2-sector-med">Median confidence ' + fmtPct(med) + '</span>' +
        '<span class="v2-sector-bar" role="img" aria-label="' + w + ' of ' + g.length + ' flagged"><i style="width:' + pct + '%"></i></span>' +
        '</button>';
    }).join('');
    host.querySelectorAll('.v2-sector').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = b.getAttribute('data-sec');
        state.sector = (state.sector === s) ? 'all' : s;
        state.page = 1; state.expanded = null;
        renderControls(); renderSectors(); renderTable(); rebaseline();
        $('v2TableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ---------------- board ---------------- */

  var COLS = [
    { k: 'sym', l: 'Symbol' }, { k: 'label', l: 'Verdict' }, { k: 'confidence', l: 'Confidence', n: 1 },
    { k: 'pump', l: 'Pump score', n: 1 }, { k: 'opp', l: 'Opportunity', n: 1 }, { k: 'age', l: 'Age', n: 1 },
    { k: 'sec', l: 'Sector' }, { k: 'lockin', l: 'Lock-in' }
  ];

  function statCell(r, k, label) {
    var v;
    if (k === 'confidence') v = '<span class="v3-num">' + fmtPct(r.confidence) + '</span>';
    else if (k === 'pump') v = '<span class="v3-num">' + (r.pump == null ? '—' : r.pump.toFixed(2)) + '</span>';
    else if (k === 'opp') v = '<span class="v3-num">' + (r.opp == null ? '—' : r.opp.toFixed(2)) + '</span>';
    else if (k === 'age') v = '<span class="v3-dim" title="Trading sessions since this stock listed">' + fmtAge(r.age) + '</span>';
    else if (k === 'sec') v = '<span class="v3-dim">' + esc(r.sec == null ? '—' : r.sec) + '</span>';
    else v = lockinCell(r.lockin);
    return '<div class="v3-c stat" data-l="' + esc(label) + '">' + v + '</div>';
  }

  function flagChips(r) {
    if (!r.flags || !r.flags.length) return '';
    return '<span class="v2-flags">' + r.flags.map(function (f) {
      return '<span class="v2-flag">' + esc(f) + '</span>';
    }).join('') + '</span>';
  }

  function renderTable() {
    var host = $('v2TableWrap'), cnt = $('v2Count'), pager = $('v2Pager');
    var rows = filtered();
    var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PER_PAGE;
    var page = rows.slice(start, start + PER_PAGE);

    var th = COLS.map(function (c) {
      var active = state.sortKey === c.k;
      var arr = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
      return '<div class="v3-th sortable' + (c.n ? ' num' : '') + '" data-k="' + c.k + '" role="columnheader" tabindex="0">' + esc(c.l) + '<span class="arr">' + arr + '</span></div>';
    }).join('') + '<div class="v3-th v3-th-chev" aria-hidden="true"></div>';

    var cards = page.length ? page.map(function (r) {
      var open = state.expanded === r.sym;
      var cls = vClass(r.label);
      var h = '<div class="v3-card ' + cls + (open ? ' open' : '') + '" data-sym="' + esc(r.sym) + '" role="button" tabindex="0" aria-expanded="' + open + '">' +
        '<div class="v3-c sym"><span class="v3-sym">' + esc(r.sym) + '</span>' + (r.early ? ' <span class="v2-early">Early</span>' : '') + '</div>' +
        '<div class="v3-c verdict"><span class="v2-v ' + cls + '">' + esc(vLabel(r.label)) + '</span>' + changeChip(r) +
        (fmtSince(r.pers) ? '<span class="v3-since">' + esc(fmtSince(r.pers)) + '</span>' : '') + flagChips(r) + '</div>' +
        '<div class="v3-statrow">' +
        statCell(r, 'confidence', 'Confidence') + statCell(r, 'pump', 'Pump score') +
        statCell(r, 'opp', 'Opportunity') + statCell(r, 'age', 'Age') +
        statCell(r, 'sec', 'Sector') + statCell(r, 'lockin', 'Lock-in') +
        '</div>' +
        '<div class="v3-chev" aria-hidden="true">▾</div>' +
        '</div>';
      if (open) h += '<div class="v3-detailwrap"><div class="v3-detail" id="v3Detail-' + esc(r.sym) + '"><div class="v2-empty">Loading evidence…</div></div></div>';
      return h;
    }).join('') : '<div class="v2-empty">No securities match your filters.</div>';

    host.innerHTML = '<div class="v3-board" role="table" aria-label="Warning radar">' +
      '<div class="v3-thead" role="row">' + th + '</div>' +
      '<div class="v3-rows">' + cards + '</div></div>' +
      '<p class="v3-cap">Warning radar · ' + (state.sortDir === 1 ? 'ascending' : 'descending') + ' · ' + esc(state.session || 'date unavailable') +
      (state.sector !== 'all' ? ' · sector: ' + esc(state.sector) : '') + '</p>';

    host.querySelectorAll('.v3-th.sortable').forEach(function (h) {
      var go = function () {
        var k = h.getAttribute('data-k');
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = (k === 'sym' || k === 'label' || k === 'sec' ? 1 : -1); }
        state.page = 1; renderTable(); syncSortSel(); rebaseline();
      };
      h.addEventListener('click', go);
      h.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    host.querySelectorAll('.v3-card').forEach(function (card) {
      var toggle = function () {
        var sym = card.getAttribute('data-sym');
        state.expanded = (state.expanded === sym) ? null : sym;
        renderTable();
        if (state.expanded) loadDetail(state.expanded);
        rebaseline();
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    if (cnt) cnt.textContent = rows.length
      ? 'Showing ' + (start + 1) + '–' + Math.min(start + PER_PAGE, rows.length) + ' of ' + rows.length + ' securities · click a card for evidence'
      : 'No securities found';
    renderPager(pager, totalPages, 'board');
    if (state.expanded) loadDetail(state.expanded);
  }

  function renderPager(host, totalPages, which) {
    if (!host) return;
    if (totalPages <= 1) { host.innerHTML = ''; return; }
    var cur = which === 'ledger' ? state.ledgerPage : state.page;
    var h = '<button type="button" class="v2-pagebtn" data-p="prev"' + (cur <= 1 ? ' disabled' : '') + ' aria-label="Previous">← Prev</button>';
    var lo = Math.max(1, cur - 2), hi = Math.min(totalPages, cur + 2);
    if (lo > 1) h += '<button type="button" class="v2-pagebtn" data-p="1">1</button>' + (lo > 2 ? '<span class="v2-pageinfo">…</span>' : '');
    for (var p = lo; p <= hi; p++) h += '<button type="button" class="v2-pagebtn" data-p="' + p + '"' + (p === cur ? ' aria-current="true"' : '') + '>' + p + '</button>';
    if (hi < totalPages) h += (hi < totalPages - 1 ? '<span class="v2-pageinfo">…</span>' : '') + '<button type="button" class="v2-pagebtn" data-p="' + totalPages + '">' + totalPages + '</button>';
    h += '<button type="button" class="v2-pagebtn" data-p="next"' + (cur >= totalPages ? ' disabled' : '') + ' aria-label="Next">Next →</button>';
    h += '<span class="v2-pageinfo">Page ' + cur + ' of ' + totalPages + '</span>';
    host.innerHTML = h;
    host.querySelectorAll('.v2-pagebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var v = b.getAttribute('data-p');
        if (which === 'ledger') {
          if (v === 'prev') state.ledgerPage = Math.max(1, state.ledgerPage - 1);
          else if (v === 'next') state.ledgerPage = Math.min(totalPages, state.ledgerPage + 1);
          else state.ledgerPage = parseInt(v, 10) || 1;
          renderLedger();
          $('v2Ledger').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          if (v === 'prev') state.page = Math.max(1, state.page - 1);
          else if (v === 'next') state.page = Math.min(totalPages, state.page + 1);
          else state.page = parseInt(v, 10) || 1;
          state.expanded = null; renderTable();
          $('v2TableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        rebaseline();
      });
    });
  }

  /* ---------------- failures ---------------- */

  function renderFailures() {
    var host = $('v2Failures');
    if (!host) return;
    var f = state.failures || [];
    if (!f.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<h2 class="v2-h2">Awaiting data (' + f.length + ')</h2>' +
      '<p class="v2-lede">These listed securities got no verdict in the latest run — the radar names them instead of silently skipping them:</p>' +
      '<ul class="v2-fail-list">' + f.map(function (x) {
        return '<li><strong>' + esc(x.symbol) + '</strong> — ' + esc(x.reason || 'no data') +
          (x.bars != null ? ' · ' + esc(x.bars) + ' bars on file' : '') + '</li>';
      }).join('') + '</ul>';
  }

  /* ---------------- warnings-per-session trend (from the ledger) ---------------- */

  function renderTrend() {
    var host = $('v2Trend');
    if (!host) return;
    var counts = {};
    state.ledger.forEach(function (w) { counts[w.session_date] = (counts[w.session_date] || 0) + 1; });
    var sessions = Object.keys(counts).sort();
    if (!sessions.length) { host.innerHTML = '<div class="v2-empty">No warnings in the ledger yet.</div>'; return; }
    var max = Math.max.apply(null, sessions.map(function (s) { return counts[s]; }));
    var total = state.ledger.length;
    host.innerHTML = '<div class="v2-trendrows" role="img" aria-label="Warnings issued per session, ' + total + ' total">' +
      sessions.map(function (s) {
        var c = counts[s];
        return '<div class="v2-trendrow"><span class="v2-trend-date">' + fmtDate(s) + '</span>' +
          '<span class="v2-trend-track"><i style="width:' + (max ? Math.round(c / max * 100) : 0) + '%"></i></span>' +
          '<span class="v2-trend-val">' + c + '</span></div>';
      }).join('') + '</div>' +
      '<p class="v2-cap">Warnings issued per session · ' + total + ' total · newest session ' + fmtDate(sessions[sessions.length - 1]) + ' issued ' + counts[sessions[sessions.length - 1]] + '</p>';
  }

  /* ---------------- forward track record ---------------- */

  function trackTable(title, rows, cols) {
    if (!rows.length) return '';
    var h = '<div class="v2-tablewrap"><table class="v2-table"><caption>' + esc(title) + '</caption><thead><tr>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.l) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>' + cols.map(function (c) {
        var v = r[c.k];
        return '<td' + (c.num ? ' class="num"' : '') + '>' + (v == null ? '—' : esc(v)) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderTrack() {
    var host = $('v2Track');
    if (!host) return;
    var t = state.track;
    if (!t) { host.innerHTML = '<div class="v2-empty">Track record unavailable.</div>'; return; }
    var o = t.overall || {};
    var bv = t.by_verdict || {}, bf = t.by_factor || {};
    var cards = [
      ['Warnings issued', o.warnings_issued], ['Still open', o.open],
      ['Provisional hits', o.provisional_hits], ['Resolved', o.resolved],
      ['Confirmed hits', o.hits], ['False positives', o.false_positives]
    ];
    var h = '<div class="v2-trackgrid">' + cards.map(function (c) {
      return '<div class="d3-card v2-trackcard"><div class="num">' + (c[1] == null ? '—' : fmtN(c[1], 0)) + '</div><div class="lbl">' + esc(c[0]) + '</div></div>';
    }).join('') + '</div>';
    if (!o.resolved) {
      h += '<div class="v2-gap v2-gap-warn"><strong>No resolved warnings yet — no hit rate to report.</strong> ' +
        'Precision is hits ÷ resolved warnings; with 0 resolved, the rate stays blank by design, never a placeholder. ' +
        'The earliest warnings are only ' + (state.ledger.length ? Math.max.apply(null, state.ledger.map(function (w) { return w.outcomes ? (w.outcomes.sessions_elapsed || 0) : 0; })) : 0) +
        ' sessions into their 20-session window.</div>';
    } else {
      h += '<p class="v2-coverage">Precision (hits ÷ resolved): ' + (o.precision_pct == null ? '—' : o.precision_pct + '%') +
        ' · false-positive rate: ' + (o.false_positive_rate_pct == null ? '—' : o.false_positive_rate_pct + '%') + '</p>';
    }
    var bvRows = Object.keys(bv).map(function (k) {
      var r = bv[k];
      return { label: vLabel(k), warnings: r.warnings, resolved: r.resolved, hits: r.hits,
        rate: r.hit_rate_pct == null ? '—' : r.hit_rate_pct + '%' };
    });
    var bfRows = Object.keys(bf).map(function (k) {
      var r = bf[k];
      return { label: k, warnings: r.warnings, resolved: r.resolved, hits: r.hits,
        rate: r.hit_rate_pct == null ? '—' : r.hit_rate_pct + '%' };
    });
    h += trackTable('Outcomes by verdict', bvRows,
      [{ l: 'Verdict', k: 'label' }, { l: 'Warnings', k: 'warnings', num: 1 }, { l: 'Resolved', k: 'resolved', num: 1 }, { l: 'Hits', k: 'hits', num: 1 }, { l: 'Hit rate', k: 'rate', num: 1 }]);
    h += trackTable('Outcomes by factor', bfRows,
      [{ l: 'Factor', k: 'label' }, { l: 'Warnings', k: 'warnings', num: 1 }, { l: 'Resolved', k: 'resolved', num: 1 }, { l: 'Hits', k: 'hits', num: 1 }, { l: 'Hit rate', k: 'rate', num: 1 }]);
    var pw = t.pump_weights || {};
    var pwRows = Object.keys(pw).map(function (k) { return { label: k, weight: pw[k] }; });
    if (pwRows.length) {
      h += trackTable('Pump-score weights (sum to 1.0)', pwRows,
        [{ l: 'Flag', k: 'label' }, { l: 'Weight', k: 'weight', num: 1 }]);
    }
    var d = t.definitions || {};
    h += '<div class="v2-defs"><h3 class="v2-h3">How outcomes are judged</h3>' +
      '<p>Warning labels tracked: ' + esc((d.warning_labels || []).join(', ')) + ' · horizon ' + esc(d.horizon_sessions) + ' sessions.</p>' +
      '<p><strong>Hit:</strong> ' + esc(d.hit || '') + '</p>' +
      '<p><strong>False positive:</strong> ' + esc(d.false_positive || '') + '</p>' +
      '<p><strong>Neutral:</strong> ' + esc(d.neutral || '') + '</p>' +
      '<p><strong>Precision:</strong> ' + esc(d.precision || '') + '</p>' +
      (d.note ? '<p class="dim">' + esc(d.note) + '</p>' : '') + '</div>';
    h += '<p class="v2-cap">Track record updated ' + fmtNPT(t.updated_at) + ' · weights version ' + esc(t.engine_weights_version || '') + '</p>';
    host.innerHTML = h;
  }

  /* ---------------- ledger cards ---------------- */

  function ledgerSorted() {
    return state.ledger.slice().sort(function (a, b) {
      if (a.session_date < b.session_date) return 1;
      if (a.session_date > b.session_date) return -1;
      return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0);
    });
  }

  function renderLedger() {
    var host = $('v2Ledger'), cnt = $('v2LedgerCount'), pager = $('v2LedgerPager');
    if (!host) return;
    var rows = ledgerSorted();
    var totalPages = Math.max(1, Math.ceil(rows.length / LEDGER_PER_PAGE));
    if (state.ledgerPage > totalPages) state.ledgerPage = totalPages;
    var start = (state.ledgerPage - 1) * LEDGER_PER_PAGE;
    var page = rows.slice(start, start + LEDGER_PER_PAGE);
    host.innerHTML = page.length ? page.map(function (w) {
      var oc = w.outcomes || {};
      var st = oc.status || 'open';
      var stLbl = st === 'provisional_hit' ? 'Provisional hit' : (st === 'open' ? 'Open' : st);
      var stCls = st === 'provisional_hit' ? 'prov' : 'open';
      return '<div class="v3-card lg ' + vClass(w.verdict) + '">' +
        '<div class="v3-c sym"><span class="v3-sym">' + esc(w.symbol) + '</span></div>' +
        '<div class="v3-c verdict"><span class="v2-v ' + vClass(w.verdict) + '">' + esc(vLabel(w.verdict)) + '</span></div>' +
        '<div class="v3-statrow">' +
        '<div class="v3-c stat" data-l="Session"><span class="v3-dim">' + esc(w.session_date) + '</span></div>' +
        '<div class="v3-c stat" data-l="Close"><span class="v3-num">' + fmtN(w.close, 2) + '</span></div>' +
        '<div class="v3-c stat" data-l="Elapsed"><span class="v3-num">' + (oc.sessions_elapsed != null ? oc.sessions_elapsed + ' sessions' : '—') + '</span></div>' +
        '<div class="v3-c stat" data-l="Return 5"><span class="v3-num">' + fmtPct2(oc.ret_5) + '</span></div>' +
        '<div class="v3-c stat" data-l="Max drawdown"><span class="v3-num">' + fmtPct2(oc.max_drawdown_20) + '</span></div>' +
        '<div class="v3-c stat" data-l="Max gain"><span class="v3-num">' + fmtPct2(oc.max_gain_20) + '</span></div>' +
        '<div class="v3-c stat" data-l="Last close"><span class="v3-num">' + fmtN(oc.last_close, 2) + '</span></div>' +
        '</div>' +
        '<div class="v3-c status"><span class="v2-status ' + stCls + '">' + esc(stLbl) + '</span></div>' +
        '<div class="v3-reason">' + esc(w.reason || '') +
        ((w.flags || []).length ? ' <span class="v2-flags">' + w.flags.map(function (f) { return '<span class="v2-flag">' + esc(f) + '</span>'; }).join('') + '</span>' : '') + '</div>' +
        '</div>';
    }).join('') : '<div class="v2-empty">No warnings in the ledger yet.</div>';
    if (cnt) cnt.textContent = rows.length
      ? 'Showing ' + (start + 1) + '–' + Math.min(start + LEDGER_PER_PAGE, rows.length) + ' of ' + rows.length + ' warnings · newest first'
      : 'No warnings found';
    renderPager(pager, totalPages, 'ledger');
  }

  /* ---------------- history strip ---------------- */

  function renderHistory() {
    var host = $('v2History');
    if (!host) return;
    var ss = state.historySessions;
    if (!ss.length) { host.innerHTML = '<div class="v2-empty">No archive sessions recorded.</div>'; return; }
    host.innerHTML = '<div class="v2-sessions">' + ss.map(function (s) {
      return '<span class="v2-session">' + fmtDate(s) + '</span>';
    }).join('') + '</div>' +
      '<p class="v2-coverage">The board archive holds ' + ss.length + ' session' + (ss.length === 1 ? '' : 's') +
      ' (' + ss.map(fmtDate).join(', ') + '). The warning ledger spans more issue sessions — it is the longer record; ' +
      'the board archive tracks verdict persistence across its recorded sessions.</p>';
  }

  /* ---------------- evidence accordion ---------------- */

  function loadDetail(sym) {
    var host = $('v3Detail-' + sym);
    if (!host) return;
    if (fullCache) { host.innerHTML = renderEvidence(fullCache.verdicts[sym]); return; }
    var letter = sym.charAt(0).toUpperCase();
    if (shardCache[letter]) { host.innerHTML = renderEvidence((shardCache[letter].verdicts || {})[sym]); return; }
    if (shardLoading[letter]) return;
    shardLoading[letter] = true;
    fetch(SHARD_BASE + letter + '.json', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        shardLoading[letter] = false;
        if (!json || !json.verdicts ||
            (state.session && json.session_date && json.session_date !== state.session)) {
          loadFullDetail(sym); return;
        }
        shardCache[letter] = json;
        var cur = state.expanded;
        if (cur && cur.charAt(0).toUpperCase() === letter) {
          var h = $('v3Detail-' + cur);
          if (h) h.innerHTML = renderEvidence((json.verdicts || {})[cur]);
        }
      })
      .catch(function () {
        shardLoading[letter] = false;
        loadFullDetail(sym);
      });
  }

  function loadFullDetail(sym) {
    var host = $('v3Detail-' + sym);
    if (!host) return;
    if (fullCache) { host.innerHTML = renderEvidence(fullCache.verdicts[sym]); return; }
    if (fullLoading) return;
    fullLoading = true;
    fetch(FULL_URL, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        fullCache = json; fullLoading = false;
        var h = $('v3Detail-' + sym);
        if (h && state.expanded === sym) h.innerHTML = renderEvidence((json.verdicts || {})[sym]);
      })
      .catch(function () {
        fullLoading = false;
        var h = $('v3Detail-' + sym);
        if (h) h.innerHTML = '<div class="v2-empty">Could not load evidence. Please reload.</div>';
      });
  }

  function gap(text) { return '<div class="v2-gap">' + esc(text) + '</div>'; }

  function sec(title, inner) {
    return '<details class="v2-sec"><summary>' + esc(title) + '</summary><div class="v2-secbody">' + inner + '</div></details>';
  }
  function kv(k, v) {
    return '<div class="v2-kv"><span>' + esc(k) + '</span><span>' + v + '</span></div>';
  }

  function renderEvidence(v) {
    if (!v) return '<div class="v2-empty">No verdict for this symbol.</div>';
    var e = v.evidence || {};
    var sc = v.scores || {};
    var h = '';

    h += '<div class="v2-banner ' + vClass(v.verdict) + '"><div><div class="v2-bverdict">' + esc(vLabel(v.verdict)) + '</div>' +
      '<div class="v2-bmeta">Horizon ' + esc(v.horizon_sessions) + ' sessions · confidence ' + fmtPct(v.confidence) +
      (sc.opportunity_score != null ? ' · opportunity ' + Number(sc.opportunity_score).toFixed(2) : '') +
      (sc.pump_score != null ? ' · pump ' + Number(sc.pump_score).toFixed(2) : '') +
      (sc.sector_bearish_multiplier != null && Number(sc.sector_bearish_multiplier) !== 1
        ? ' · sector multiplier ×' + Number(sc.sector_bearish_multiplier) : '') + '</div></div>' +
      '<div class="v2-bconf"><div class="v2-bar"><i style="width:' + Math.round((v.confidence || 0) * 100) + '%"></i></div></div></div>';
    if (v.reason) h += '<p class="v2-reason">' + esc(v.reason) + '</p>';

    var id = e.identity || {};
    var ih = kv('Sector', esc(id.sector || 'pending — sector not yet classified (added 2026-10-05 roadmap)')) +
      kv('Listing date', esc(id.listing_date || '—')) +
      kv('Age', id.age_sessions != null ? esc(id.age_sessions) + ' sessions' : '—') +
      kv('Float', id.float_status === 'measured'
        ? esc(fmtN(id.float_shares, 0)) + ' shares (' + fmtPct(id.promoter_pct) + ' promoter)' + (id.traded_public_pct != null ? ' · ' + id.traded_public_pct + '% of float traded' : '')
        : esc('float capture in progress — added 2026-10-05 roadmap'));
    h += sec('Identity', ih);

    var lk = e.lockin || {};
    var lh;
    if (lk.listing_date_source === 'user-verified' || lk.listing_date_source === 'lockin-table') {
      lh = kv('Status', esc(lk.status || '—')) +
        (lk.expiry ? kv(lk.status === 'expired' ? 'Expired' : 'Expiry', esc(lk.expiry) + (lk.expiry_bs ? ' BS' : '')) : '') +
        kv('Source', esc(lk.provenance || lk.listing_date_source || '—'));
      if (lk.note) lh += '<p class="v2-note2">' + esc(lk.note) + '</p>';
    } else {
      lh = gap('Lock-in expiry: estimated window — true listing date not yet verified (added 2026-10-05 roadmap).') +
        kv('Position', esc(lk.status || '—') + ' <span class="dim">(estimated)</span>');
    }
    h += sec('Promoter lock-in', lh);

    var c = e.circuit_record || {};
    var ch = kv('Limit-ups, 60d', fmtN(c.limit_ups_60d, 0)) +
      kv('Limit-ups, all-time', fmtN(c.limit_ups_alltime, 0)) +
      kv('Last circuit', esc(c.last_circuit || '—'));
    if (c.age_gate === 'exhaustion_suppressed_age_lt_15')
      ch += '<p class="v2-note2">Exhaustion read suppressed — listing under 15 sessions (young-listing limit-ups read as ignition, not exhaustion).</p>';
    else if (c.note) ch += '<p class="v2-note2">' + esc(c.note) + '</p>';
    h += sec('Circuit record', ch);

    var vm = e.volume_anatomy || {};
    var vh = '';
    if (vm.withheld_float_flag) vh += '<p class="v2-badge">Withheld float — unusually low traded float for the size</p>';
    var tv = vm.top_volume_days || [];
    vh += tv.length
      ? '<div class="v2-list">' + tv.slice(0, 5).map(function (d) {
          return '<div class="v2-kv"><span>' + esc(d.date) + '</span><span>' + esc(fmtN(d.qty, 0)) + ' shares · ' + esc(d.context || '') + '</span></div>';
        }).join('') + '</div>'
      : gap('Volume anatomy not yet computed for this symbol.');
    h += sec('Volume', vh);

    var dd = e.drawdown_state || {};
    var dh = kv('From peak', fmtPct(dd.from_peak_pct)) +
      kv('Peak date', esc(dd.peak_date || '—')) +
      kv('Sessions underwater', fmtN(dd.sessions_underwater, 0)) +
      kv('Reclaimed 50% of drawdown', dd.reclaim50 ? 'yes' : 'no');
    h += sec('Drawdown', dh);

    var fs = e.factors || [];
    var fh = '<div class="v2-list">' + fs.map(function (f) {
      var exp = /experimental/i.test(f.reading || '') || /NOT in score/i.test(f.backtest || '');
      return '<div class="v2-factor"><div class="v2-fhead"><strong>' + esc(f.name) + '</strong>' +
        (exp ? ' <span class="v2-early">experimental — not in score</span>' : '') + '</div>' +
        '<div class="v2-kv"><span>Reading</span><span>' + esc(f.reading || '—') + (f.value != null ? ' (' + Number(f.value).toFixed(3) + ')' : '') + '</span></div>' +
        '<div class="v2-kv"><span>Direction</span><span>' + esc(f.direction || '—') + '</span></div>' +
        '<div class="v2-bt">' + esc(f.backtest || 'no backtest stat') + '</div></div>';
    }).join('') + '</div>';
    h += sec('Factors (' + fs.length + ')', fh);

    var fl = e.flags || [];
    if (fl.length) {
      var flh = '<div class="v2-list">' + fl.map(function (f) {
        return '<div class="v2-kv"><span>' + esc(f.name) + (f.active ? ' · active' : '') + '</span><span>' +
          esc(f.status || '') + (f.weight != null ? ' · weight ' + Number(f.weight).toFixed(2) : '') + '</span></div>';
      }).join('') + '</div>';
      h += sec('Flags (' + fl.length + ')', flh);
    }

    var lc = e.lifecycle || {};
    var phases = lc.phases || [];
    if (phases.length) {
      var shown = phases.slice(-10);
      var ph = '<div class="v2-list">' + shown.map(function (p) {
        return '<div class="v2-kv"><span>' + esc(p.type) + (p.open ? ' · open' : '') + '</span><span>' +
          esc(p.sessions != null ? p.sessions + ' sessions' : '') +
          (p.high != null ? ' · high ' + fmtN(p.high, 1) : '') +
          (p.low != null ? ' · low ' + fmtN(p.low, 1) : '') + '</span></div>';
      }).join('') + '</div>';
      if (phases.length > shown.length) ph += '<p class="v2-note2">Showing the latest ' + shown.length + ' of ' + phases.length + ' phases.</p>';
      h += sec('Lifecycle phases (' + phases.length + ')', ph);
    }

    var ep = e.episode_history || [];
    var eh = ep.length
      ? '<div class="v2-list">' + ep.map(function (x) {
          return '<div class="v2-kv"><span>' + esc(x.type) + ' · peak ' + esc(x.peak_date || x.peak) + '</span><span>' + esc(x.source || '') + '</span></div>';
        }).join('') + '</div>'
      : gap('No labeled pump/distribution episodes for this symbol.');
    if (e.analyst_narrative) eh += '<p class="v2-note2">' + esc(e.analyst_narrative) + '</p>';
    h += sec('Episode history', eh);

    var notes = e.notes || [];
    if (notes.length) {
      h += sec('Notes (' + notes.length + ')', '<div class="v2-list">' + notes.map(function (n) {
        return '<p class="v2-note2">' + esc(typeof n === 'string' ? n : JSON.stringify(n)) + '</p>';
      }).join('') + '</div>');
    }

    var fu = e.fundamentals || {};
    var uh;
    if (fu.status === 'reported') {
      uh = kv('FY / quarter', esc((fu.fiscal_year || '') + ' ' + (fu.quarter || ''))) +
        kv('EPS (TTM)', fmtN(fu.eps_ttm, 2)) + kv('P/E (TTM)', fmtN(fu.pe_ttm, 1)) +
        kv('BVPS', fmtN(fu.bvps, 2)) + kv('ROE (TTM)', fmtPct((fu.roe_ttm || 0) / 100)) +
        kv('Net profit', esc(fmtN(fu.netprofit_k, 0)) + 'k NPR') +
        '<p class="v2-note2">Figures are public facts from company filings (FY ' + esc(fu.fiscal_year || '') + '). Evidence only — never scored.</p>';
    } else {
      uh = gap('No fundamentals record in the 2026-10-05 export — symbol not covered or non-reporting.');
    }
    h += sec('Fundamentals', uh);

    var pr = e.promoter || {};
    h += sec('Promoter', pr.status === 'pending'
      ? gap('Promoter identity not yet captured — added 2026-10-05 roadmap.')
      : '<p>' + esc(pr.note || '') + '</p>');

    var br = e.base_rates_shown || {};
    var bh = Object.keys(br).length
      ? '<div class="v2-list">' + Object.keys(br).map(function (k) {
          return '<div class="v2-kv"><span>' + esc(k.replace(/_/g, ' ')) + '</span><span>' + esc(br[k]) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="v2-note2">Base rates include failure rates by design — a signal without its miss rate is not shown.</p>'
      : gap('Base rates pending for this symbol.');
    h += sec('Base rates (honest)', bh);

    h += '<p class="v2-methodlink"><a href="/nepse-verdicts-v2/methodology/">How this verdict is built →</a></p>';
    h += '<p class="v2-disclaimer">Educational analysis, not investment advice. Past patterns do not guarantee future results.</p>';
    return h;
  }

  /* ---------------- init ---------------- */

  function init() {
    var s = $('v2Search');
    if (s) s.addEventListener('input', function () { state.q = s.value.trim(); state.page = 1; state.expanded = null; renderTable(); rebaseline(); });
    var secSel = $('v2SectorSel');
    if (secSel) secSel.addEventListener('change', function () {
      state.sector = secSel.value; state.page = 1; state.expanded = null;
      renderSectors(); renderTable(); rebaseline();
      $('v2TableWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    var sortSel = $('v2SortSel');
    if (sortSel) sortSel.addEventListener('change', function () {
      var v = sortSel.value.split('|');
      if (v.length === 2) { state.sortKey = v[0]; state.sortDir = parseInt(v[1], 10) || 1; }
      state.page = 1; renderTable(); rebaseline();
    });
    loadAll(false, function () {
      rebaseline();
      renderFresh();
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(refreshTick, 60000);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
