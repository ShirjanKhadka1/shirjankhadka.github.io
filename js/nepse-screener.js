/* NEPSE Stock Screener - client-side ranking table (teardown 2026-10-28,
 * verdict series page 4).
 *
 * Data: ../nepse-chart/data/verdicts.json (daily rule-based signals, built by
 * tools/build-nepse-universe.js) + ../nepse-chart/data/universe.json (names)
 * + ../nepse-chart/data/screener-calls.json (live call ledger)
 * + ../nepse-chart/data/track-record.json (250-session setup replay)
 * + ../nepse-chart/data/screener-verdict-archive.json (session archive)
 * + ../nepse-chart/data/wave1.json (RSI extremes / biggest movers, via the
 * shared js/nepse-wave1.js renderer — that file is shared with /nepse-daily/
 * and /nepse-decode/ and is NOT rewritten here; this page only calls its
 * public window.NepseWave1.refresh() on data change).
 * Live tape: the 15-minute snapshot via window.NepseLive (js/nepse-data.js).
 * Everything rendered here comes from those files; no fabricated values.
 * Educational use only - not investment advice.
 *
 * Teardown changes vs the previous build (all behaviour-preserving except
 * where noted): 60s change-gated refresh + page-owned freshness line
 * (replaces the 5-minute market-hours-only refresh); stat cards +
 * distribution mix bar + interactive sector blocks; session archive
 * section; stale markers (row asof < batch asof) + live-tape markers on
 * repainted prices; open-calls pagination; no-closed-calls banner;
 * timeframe hint element; nulls sort LAST on every column (was: -1
 * fallback, which put nulls first on ascending sorts); refresh preserves
 * the selected sector + timeframe (was: sector select reset, timeframe
 * silently reverted to daily); view handlers re-baseline the refresh
 * signature, never null it.
 */
(function () {
  'use strict';

  var RANK = { 'Strong Buy': 0, 'Buy': 1, 'Hold': 2, 'Exit / Reduce': 3, 'Strong Exit': 4, 'Insufficient history': 5 };
  var CLS = { 'Strong Buy': 'sbuy', 'Buy': 'buy', 'Hold': 'hold', 'Exit / Reduce': 'exit', 'Strong Exit': 'sexit', 'Insufficient history': 'insufficient' };
  var DISP = { 'Strong Buy': 'Strong Buy', 'Buy': 'Buy', 'Hold': 'Hold', 'Exit / Reduce': 'Exit', 'Strong Exit': 'Strong Exit', 'Insufficient history': 'No signal' };
  var MIXCLS = { 'Strong Buy': 'm-sbuy', 'Buy': 'm-buy', 'Hold': 'm-hold', 'Exit / Reduce': 'm-exit', 'Strong Exit': 'm-sexit', 'Insufficient history': 'm-ins' };
  var VERDICTS = ['Strong Buy', 'Buy', 'Hold', 'Exit / Reduce', 'Strong Exit', 'Insufficient history'];

  /* Honest sector/instrument grouping.
   * The repo ships no per-symbol sector field (tools/sector-map.json is
   * absent, so verdicts.json sec is null for all symbols). Groups below
   * are derived ONLY from real repo data in nepse-chart/data/universe.json:
   *  - the instrument-type field `t` (Debenture / Mutual fund /
   *    Promoter share), plus NEPSE's own debenture symbol suffixes
   *    (D + maturity year) and the words "bond"/"rinpatra", "fund"/"kosh"
   *    in the official company name; these are instrument types, NOT sectors;
   *  - explicit business words in the official company name for equities
   *    (bank, finance, laghubitta, hydropower/power/hydro/urja,
   *    insurance/beema, hotel/tourism, investment, trading, cement and other
   *    manufacturing words); these map to the NEPSE sub-index names.
   * Anything left over falls into "Others" (the NEPSE Others sub-index bucket). Kept identical in js/nepse-sectors.js. */
  var DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
  /* Verified symbol -> sector overrides (2026-09-30, official NEPSE/company
     notices and market sources). Checked before keyword matching. */
  var SECTOR_OVERRIDES = {
    GVL: 'Hydropower', SNORL: 'Hydropower',
    BNL: 'Manufacturing And Processing', UNL: 'Manufacturing And Processing',
    SAIL: 'Manufacturing And Processing',
    CGH: 'Hotels And Tourism', KDL: 'Hotels And Tourism',
    SAGF: 'Mutual Funds', H8020: 'Mutual Funds', NMB50: 'Mutual Funds',
    CMF2: 'Mutual Funds', NICBF: 'Mutual Funds', LSH12: 'Mutual Funds',
    RBBF40: 'Mutual Funds',
    JBLBP: 'Promoter Shares', KBLPO: 'Promoter Shares', MLBLPO: 'Promoter Shares',
    SCBD: 'Debentures', SHINED: 'Debentures',
    SFCL: 'Finance',
    WNLB: 'Microfinance',
    NTC: 'Others', NRM: 'Others', NWCL: 'Others', TTL: 'Others', MKCL: 'Others'
  };
  /* NEPSE-official sector overrides, checked before keyword matching.
     Investment sub-index (NEPSE): CIT, HIDCL, NIFRA, NRN, CEDB/CHDC, plus
     newer listings ENL and HATHY; HIDCLP is HIDCL's promoter share and
     trades with the investment group. NIFRA must precede the 'bank'
     keyword; HIDCLP must precede the Promoter-share instrument check.
     Trading (NEPSE): BBC and STC. */
  var INVESTMENT_SYMBOLS = { CIT:1, HIDCL:1, HIDCLP:1, NIFRA:1, NRN:1, CHDC:1, ENL:1, HATHY:1 };
  var TRADING_SYMBOLS = { BBC:1, STC:1 };
  function classifySymbol(sym, name, type) {
    var symU = String(sym || '').toUpperCase();
    if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
    if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
    if (TRADING_SYMBOLS[symU]) return 'Trading';
    var n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
    if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
        n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
    if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
    if (type === 'Promoter share') return 'Promoter Shares';
    if (type && type !== 'Equity') return 'Others';
    function has() {
      for (var i = 0; i < arguments.length; i++) if (n.indexOf(arguments[i]) >= 0) return true;
      return false;
    }
    if (has('laghu', 'microfinance')) return 'Microfinance';
    if (has('hydropower', 'hydro', 'power', 'urja', 'dhyut', 'dyut', 'energy')) return 'Hydropower';
    if (has('development bank')) return 'Development Bank';
    if (has('bank')) return 'Banking';
    if (has('life insurance')) return 'Life Insurance';
    if (has('reinsurance', 'insurance', 'beema')) return 'Non Life Insurance';
    if (has('finance')) return 'Finance';
    if (has('hotel', 'tourism', 'cablecar')) return 'Hotels And Tourism';
    if (has('investment')) return 'Investment';
    if (has('trading')) return 'Trading';
    if (has('manufacturing', 'cement', 'bottler', 'distiller', 'spinning', 'pharmaceut',
      'paints', 'colour', 'panel', 'mineral', 'lube')) return 'Manufacturing And Processing';
    return 'Others';
  }

  var state = { rows: [], q: '', sector: '', verdict: '', rsi: '', pmin: null, pmax: null, vmin: null,
    sortK: 'sig', sortD: 1, page: 1, perPage: 25, tf: 'd', callsPage: 1,
    batchAsof: '', changes: null, callsDoc: null, trackRecord: null, archiveDoc: null,
    wave1Asof: '', tapeSession: '', liveQuotes: {}, sig: null, lastChecked: null };

  var TF_LABEL = { d: 'Daily', w: 'Weekly', m: 'Monthly' };
  var TF_HINT = {
    d: "Today's signal from the latest session.",
    w: 'One verdict per security from weekly candles. Needs 40+ weeks of history.',
    m: 'One verdict per security from monthly candles. Needs 36+ months of history.'
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num2(x) {
    return x == null ? '—' : (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtVol(x) { return x == null ? '—' : Math.round(+x).toLocaleString('en-US'); }
  function rvolBadge(r) {
    if (r.vol == null || r.volAvg == null || !r.volAvg) return '';
    var x = r.vol / r.volAvg;
    if (x < 1.5) return '';
    return '<span class="sc-rvol' + (x >= 3 ? ' hot' : '') + '" title="Volume vs 20-session average">' +
      x.toFixed(1) + 'x</span>';
  }
  function pct(x) { return (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function nptParts(d) {
    var n = new Date(d.getTime() + (5 * 60 + 45) * 60000);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return { y: n.getUTCFullYear(), m: p(n.getUTCMonth() + 1), d: p(n.getUTCDate()),
      hh: p(n.getUTCHours()), mm: p(n.getUTCMinutes()) };
  }
  function scrollToEl(el) {
    if (!el || !el.scrollIntoView) return;
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }

  /* Live-tape repaint (render-time, mirroring engine-verdict enrichRows):
   * price + change only, tape session >= row asof, stops/targets/verdicts/
   * scores NEVER repainted. Returns {p, ch, live}. */
  function liveVal(r) {
    var q = state.liveQuotes[r.sym];
    var rowAsof = r.asof || state.batchAsof || '';
    if (!q || q.ltp == null || !isFinite(Number(q.ltp))) return { p: r.p, ch: r.ch, live: false };
    if (state.tapeSession && rowAsof && state.tapeSession < rowAsof) return { p: r.p, ch: r.ch, live: false };
    var pctCh = null;
    if (q.percent_change != null && isFinite(Number(q.percent_change))) pctCh = Number(q.percent_change);
    else if (q.pct != null && isFinite(Number(q.pct))) pctCh = Number(q.pct);
    else if (q.previous_close && isFinite(Number(q.previous_close)) && Number(q.previous_close) > 0)
      pctCh = (Number(q.ltp) - Number(q.previous_close)) / Number(q.previous_close) * 100;
    return { p: Number(q.ltp), ch: pctCh, live: true };
  }
  function staleMark(r) {
    var a = r.asof || '';
    if (!a || !state.batchAsof || a >= state.batchAsof) return '';
    return ' <span class="sc-flag" title="Last scored ' + esc(a) + '">◷ ' + esc(a.slice(5)) + '</span>';
  }

  function slCell(r) {
    if (r.sl == null || r.p == null || !r.p) return '<span class="sc-dash">—</span>';
    var d = (r.sl - r.p) / r.p * 100;
    return '<b class="sc-sl">' + num2(r.sl) + '</b> <span class="sc-dist dn">(' + pct(d) + ')</span>';
  }
  function tpCell(r) {
    if (r.tp == null || r.p == null || !r.p) return '<span class="sc-dash">—</span>';
    var d = (r.tp - r.p) / r.p * 100;
    return '<b class="sc-tp">' + num2(r.tp) + '</b> <span class="sc-dist up">(' + pct(d) + ')</span>';
  }
  function hitCell(r) {
    if (!r.tr || r.tr.n == null || r.tr.w == null) return '<span class="sc-dash">—</span>';
    var w = Math.round(r.tr.w * 100);
    return '<span class="cx-hit"><b class="sc-hit">' + w + '%</b> <span class="sc-sub">' + r.tr.n + ' calls</span>' +
      '<span class="cx-prop"><span class="cx-prop-track"><span class="cx-prop-fill" style="--w:' + Math.max(0, Math.min(100, w)) + '%"></span></span></span></span>';
  }
  function rsiCell(r) {
    if (r.rsi == null) return '<span class="sc-dash">—</span>';
    var cls = r.rsi < 30 ? ' sc-rsi-os' : (r.rsi > 70 ? ' sc-rsi-ob' : '');
    var pos = Math.max(0, Math.min(100, Number(r.rsi)));
    return '<span class="cx-rsi"><b class="sc-rsi' + cls + '">' + r.rsi.toFixed(1) + '</b>' +
      '<span class="cx-rsi-bar"><span class="cx-rsi-mark" style="--pos:' + pos + '%"></span></span></span>';
  }
  function chCell(ch) {
    var c = Number(ch);
    if (ch == null || !isFinite(c)) return '<span class="sc-dash">—</span>';
    var cls = c > 0 ? 'up' : (c < 0 ? 'down' : 'flat');
    return '<span class="cx-chip ' + cls + '">' + (c > 0 ? '+' : '') + c.toFixed(2) + '%</span>';
  }
  function badge(v) {
    return '<span class="ms-v ' + (CLS[v] || 'insufficient') + '">' + esc(DISP[v] || v) + '</span>';
  }

  function filtered() {
    var q = state.q.trim().toUpperCase();
    var out = state.rows.filter(function (r) {
      if (state.verdict && r.v !== state.verdict) return false;
      if (state.sector && r.sec !== state.sector) return false;
      if (state.rsi) {
        if (r.rsi == null) return false;
        if (state.rsi === 'os' && !(r.rsi < 30)) return false;
        if (state.rsi === 'ob' && !(r.rsi > 70)) return false;
        if (state.rsi === 'mid' && !(r.rsi >= 30 && r.rsi <= 70)) return false;
      }
      if (state.pmin != null && (r.p == null || r.p < state.pmin)) return false;
      if (state.pmax != null && (r.p == null || r.p > state.pmax)) return false;
      if (state.vmin != null && (r.vol == null || r.vol < state.vmin)) return false;
      if (q && r.sym.indexOf(q) < 0 && (r.name || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = state.sortK, d = state.sortD;
    /* Nulls sort LAST on every column, regardless of direction (teardown
     * fix; the old code's -1 fallback put nulls first on ascending sorts). */
    function nullLast(a, b) {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return null;
    }
    out.sort(function (a, b) {
      var x, y, nl;
      switch (k) {
        case 'sn': return 0; // S.N. follows the ranking order
        case 'sec': x = a.sec || ''; y = b.sec || ''; return (x < y ? -1 : x > y ? 1 : 0) * d || rankCmp(a, b);
        case 'sym': x = a.sym; y = b.sym; return (x < y ? -1 : x > y ? 1 : 0) * d || rankCmp(a, b);
        case 'p': nl = nullLast(a.p, b.p); return nl !== null ? nl : (a.p - b.p) * d || rankCmp(a, b);
        case 'ch': nl = nullLast(a.ch, b.ch); return nl !== null ? nl : (a.ch - b.ch) * d || rankCmp(a, b);
        case 'vol': nl = nullLast(a.vol, b.vol); return nl !== null ? nl : (a.vol - b.vol) * d || rankCmp(a, b);
        case 'rsi': nl = nullLast(a.rsi, b.rsi); return nl !== null ? nl : (a.rsi - b.rsi) * d || rankCmp(a, b);
        case 'sig': return rankCmp(a, b) * d;
        case 'tr': x = a.tr ? a.tr.w : null; y = b.tr ? b.tr.w : null; nl = nullLast(x, y); return nl !== null ? nl : (x - y) * d || rankCmp(a, b);
        case 'sl': nl = nullLast(a.sl, b.sl); return nl !== null ? nl : (a.sl - b.sl) * d || rankCmp(a, b);
        case 'tp': nl = nullLast(a.tp, b.tp); return nl !== null ? nl : (a.tp - b.tp) * d || rankCmp(a, b);
        default: return 0;
      }
    });
    return out;
  }

  function rankCmp(a, b) {
    var ra = RANK[a.v] == null ? 9 : RANK[a.v], rb = RANK[b.v] == null ? 9 : RANK[b.v];
    if (ra !== rb) return ra - rb;
    var sa = a.s == null ? null : a.s, sb = b.s == null ? null : b.s;
    if (sa == null && sb == null) return a.sym < b.sym ? -1 : 1;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa || (a.sym < b.sym ? -1 : 1);
  }

  // Timeframe switch: remap each row's signal fields from the daily (d),
  // weekly (w) or monthly (m) verdict. Price, change and volume stay on the
  // latest daily session as price context; hit rate is daily-only.
  function applyTf() {
    var tf = state.tf;
    state.rows.forEach(function (r) {
      var e = r.raw || {}, src = tf === 'd' ? e : (e[tf] || null);
      if (src && src.v) {
        r.v = src.v; r.s = src.s; r.rsi = src.rsi; r.sl = src.sl; r.tp = src.tp;
        r.setup = src.setup || null; r.tfasof = src.asof || null;
        r.tr = tf === 'd' ? (e.tr || null) : null;
      } else {
        r.v = 'Insufficient history'; r.s = null; r.rsi = null; r.sl = null; r.tp = null;
        r.setup = null; r.tr = null; r.tfasof = null;
      }
    });
  }

  function tfRankedCount() {
    var n = 0;
    state.rows.forEach(function (r) { if (r.v !== 'Insufficient history') n++; });
    return n;
  }

  /* ---------- Batch summary: distribution + sectors (active timeframe) ---------- */
  function distCounts() {
    var c = {};
    VERDICTS.forEach(function (v) { c[v] = 0; });
    state.rows.forEach(function (r) { if (c[r.v] != null) c[r.v]++; else c[r.v] = 1; });
    return c;
  }
  function sectorCounts() {
    var c = {};
    state.rows.forEach(function (r) { c[r.sec || 'Others'] = (c[r.sec || 'Others'] || 0) + 1; });
    return c;
  }
  function renderStats() {
    var c = distCounts();
    var map = { 'Strong Buy': 'sc-n-sbuy', 'Buy': 'sc-n-buy', 'Hold': 'sc-n-hold',
      'Exit / Reduce': 'sc-n-exit', 'Strong Exit': 'sc-n-sexit', 'Insufficient history': 'sc-n-ins' };
    VERDICTS.forEach(function (v) {
      var el = $(map[v]);
      if (el) el.textContent = c[v];
    });
    document.querySelectorAll('.sc-card[data-v]').forEach(function (x) {
      x.classList.toggle('is-on', !!state.verdict && x.getAttribute('data-v') === state.verdict);
    });
    var track = $('sc-mix-track'), legend = $('sc-mix-legend');
    if (!track || !legend) return;
    var total = state.rows.length;
    var segs = '', legs = '';
    VERDICTS.forEach(function (v) {
      if (!c[v]) return; // zero-count buckets render NO segment and NO legend row
      var w = total ? (c[v] / total * 100) : 0;
      segs += '<i class="' + MIXCLS[v] + '" style="width:' + w + '%" title="' + esc(v) + ' ' + c[v] + '"></i>';
      legs += '<span><i class="' + MIXCLS[v] + '"></i>' + esc(DISP[v]) + ' <b>' + c[v] + '</b></span>';
    });
    track.innerHTML = segs;
    legend.innerHTML = legs;
    var mix = document.querySelector('.sc-mix');
    if (mix) mix.setAttribute('aria-label', 'Verdict mix: ' + VERDICTS.filter(function (v) { return c[v]; }).map(function (v) { return DISP[v] + ' ' + c[v]; }).join(', '));
  }
  function renderSectors() {
    var box = $('sc-sectors');
    if (!box) return;
    var counts = sectorCounts();
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
    box.innerHTML = names.map(function (sec) {
      var rows = state.rows.filter(function (r) { return (r.sec || 'Others') === sec; });
      var buy = rows.filter(function (r) { return r.v === 'Strong Buy' || r.v === 'Buy'; }).length;
      var exit = rows.filter(function (r) { return r.v === 'Exit / Reduce' || r.v === 'Strong Exit'; }).length;
      var hold = rows.length - buy - exit;
      var top = rows.slice().sort(rankCmp).slice(0, 3);
      var topHtml = top.map(function (r) {
        return '<a href="/stocks/' + esc(String(r.sym).replace(/\//g, '-')) + '/">' + esc(r.sym) + '</a> ' + badge(r.v) + (r.s != null ? ' ' + r.s.toFixed(1) : '');
      }).join(' · ');
      var tot = rows.length || 1;
      var bar = '<span class="sc-mix-track" style="height:8px"><i class="m-sbuy" style="width:' + (buy / tot * 100) + '%"></i>' +
        '<i class="m-hold" style="width:' + (hold / tot * 100) + '%"></i>' +
        '<i class="m-sexit" style="width:' + (exit / tot * 100) + '%"></i></span>';
      return '<button type="button" class="sc-sector-card' + (state.sector === sec ? ' is-on' : '') + '" data-sec="' + esc(sec) + '">' +
        '<h3>' + esc(sec) + '</h3>' +
        '<span class="sc-sec-meta">' + rows.length + ' stocks · ' + buy + ' buy-side · ' + exit + ' exit-side</span>' +
        bar +
        '<p class="sc-sec-top">' + topHtml + '</p></button>';
    }).join('');
    box.querySelectorAll('.sc-sector-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var sec = card.getAttribute('data-sec') || '';
        state.sector = (state.sector === sec) ? '' : sec;
        var sel = $('sc-sector');
        if (sel) sel.value = state.sector;
        state.page = 1;
        render();
        renderStats();
        renderSectors();
        rebaseline();
        if (state.sector) scrollToEl($('sc-table'));
      });
    });
  }

  function trackPct(x) { return x == null ? '—' : (x * 100).toFixed(1) + '%'; }
  function trackRet(x) { return x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%'; }
  function renderTracking() {
    try {
      var chEl = $('sc-changes-line'), chBody = $('sc-changes-body');
      if (chEl && chBody) {
        var c = state.changes;
        if (!c || !c.prev_session) {
          chEl.textContent = 'No previous session to compare with yet — changes appear from the next daily build.';
          chBody.innerHTML = '<p class="sig-sub">This is the verdict archive\'s first session, so there is no previous session to compare it with.</p>';
        } else {
          chEl.textContent = 'vs ' + c.prev_session + ': ' + c.upgraded + ' upgraded · ' + c.downgraded + ' downgraded · ' + c.held + ' held · ' + c.new + ' new · ' + c.flips.length + ' full Buy↔Exit flip' + (c.flips.length === 1 ? '' : 's');
          chBody.innerHTML = c.flips.length ? '<div class="scrollx sc-cardwrap"><table class="sig-table nd-table"><thead><tr><th>Symbol</th><th>From</th><th>To</th></tr></thead><tbody>' +
            c.flips.map(function (f) { return '<tr><td><a href="/stocks/' + esc(f.symbol) + '/">' + esc(f.symbol) + '</a></td><td>' + esc(f.from) + '</td><td>' + esc(f.to) + '</td></tr>'; }).join('') + '</tbody></table></div>'
            : '<p class="sig-sub">No security crossed from Buy to Exit (or back) in one step this session.</p>';
        }
      }
      var cb = $('sc-calls-body');
      if (!cb) return;
      var d = state.callsDoc;
      if (!d || !d.summary) {
        cb.innerHTML = '<p class="sig-sub">The live call ledger starts with the next daily build.</p>';
        return;
      }
      var s = d.summary;
      var open = (d.calls || []).filter(function (x) { return x.status === 'open'; });
      var closed = (d.calls || []).filter(function (x) { return x.status === 'closed'; }).sort(function (a, b) { return (b.exit_date || '') < (a.exit_date || '') ? -1 : 1; }).slice(0, 20);
      var persRows = ['flash', 'mid', 'persistent'].map(function (k) {
        var p = s.by_persistence[k];
        return '<tr><td>' + k + '</td><td class="num">' + p.decided + '</td><td class="num">' + p.wins + '</td><td class="num">' + (p.decided ? trackPct(p.wins / p.decided) : '—') + '</td></tr>';
      }).join('');
      var setupRows = (s.by_setup || []).map(function (r) {
        return '<tr><td>' + esc(r.setup) + '</td><td class="num">' + r.decided + '</td><td class="num">' + r.wins + '</td><td class="num">' + (r.win_rate == null ? '—' : trackPct(r.win_rate)) + '</td></tr>';
      }).join('');
      var tr = state.trackRecord;
      var replayRows = '';
      if (tr && tr.eval && tr.eval.setups) {
        replayRows = '<h3>Setup track record — replay, most recent 250 sessions</h3>' +
          '<p class="sig-sub">The same win rule (target before stop, 20 sessions) replayed over history. ' +
          'This is the backtest the live ledger will either confirm or correct as real calls resolve.</p>' +
          '<div class="scrollx sc-cardwrap"><table class="sig-table nd-table"><thead><tr><th>Setup</th><th class="num">Decided calls</th><th class="num">Win rate</th></tr></thead><tbody>' +
          tr.eval.setups.map(function (r) {
            return '<tr><td>' + esc(r.label) + '</td><td class="num">' + r.n + '</td><td class="num">' + trackPct(r.w) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      /* Open calls: paginated 25/page (was: all rows in one table). */
      var callPer = 25;
      var callPages = Math.max(1, Math.ceil(open.length / callPer));
      if (state.callsPage > callPages) state.callsPage = callPages;
      var cStart = (state.callsPage - 1) * callPer;
      var cSlice = open.slice(cStart, cStart + callPer);
      var cFrom = open.length ? cStart + 1 : 0, cTo = Math.min(cStart + callPer, open.length);
      var banner = (s.decided === 0)
        ? '<p class="sc-noclosed">No closed paper trades yet — every Buy/Strong Buy call below is still open; no win rate is shown until calls resolve.</p>'
        : '';
      var openHtml = open.length
        ? '<div class="scrollx sc-cardwrap"><table class="sig-table nd-table"><thead><tr><th>Symbol</th><th>Entry</th><th class="num">Price</th><th class="num">Stop</th><th class="num">Target</th><th>Setup</th><th class="num">Streak</th><th class="num">Sessions</th><th class="num">Return now</th></tr></thead><tbody>' +
          cSlice.map(function (x) {
            var price = (x.entry != null) ? x.entry.toFixed(2) : '—';
            return '<tr><td><a href="/stocks/' + esc(x.sym) + '/">' + esc(x.sym) + '</a></td><td>' + esc(x.date) + '</td><td class="num">' + price + '</td><td class="num">' + (x.sl != null ? x.sl.toFixed(2) : '—') + '</td><td class="num">' + (x.tp != null ? x.tp.toFixed(2) : '—') + '</td><td>' + esc(x.setup || '—') + '</td><td class="num">' + (x.streak != null ? x.streak : '—') + '</td><td class="num">' + (x.sessions_elapsed != null ? x.sessions_elapsed : '—') + '</td><td class="num">' + trackRet(x.last_return) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="sig-pager"><span>Showing ' + cFrom + ' to ' + cTo + ' of ' + open.length + ' open calls</span>' +
          '<span style="display:flex;gap:8px;margin-left:auto" id="sc-calls-pager" aria-label="Open calls pagination"></span></div>'
        : '<p class="sig-sub">No open calls.</p>';
      cb.innerHTML = banner +
        '<p class="sig-sub">' + s.open + ' open · ' + s.decided + ' decided (target ' + s.closed_tp + ' · stop ' + s.closed_sl + ' · expired ' + s.closed_expired + ') · win rate ' + (s.win_rate == null ? '—' : trackPct(s.win_rate)) + ' on decided calls.</p>' +
        '<div class="scrollx sc-cardwrap"><table class="sig-table nd-table"><thead><tr><th>Persistence at entry</th><th class="num">Decided</th><th class="num">Wins</th><th class="num">Win rate</th></tr></thead><tbody>' + persRows + '</tbody></table></div>' +
        (setupRows ? '<div class="scrollx sc-cardwrap"><table class="sig-table nd-table"><thead><tr><th>Setup</th><th class="num">Decided</th><th class="num">Wins</th><th class="num">Win rate</th></tr></thead><tbody>' + setupRows + '</tbody></table></div>' : '') +
        replayRows +
        '<h3>Open calls</h3>' + openHtml +
        '<h3>Recently closed</h3>' + (closed.length ? '<div class="scrollx sc-cardwrap"><table class="sig-table nd-table"><thead><tr><th>Symbol</th><th>Entry</th><th>Exit</th><th>Outcome</th><th class="num">Return</th><th class="num">Sessions held</th></tr></thead><tbody>' +
        closed.map(function (x) { return '<tr><td><a href="/stocks/' + esc(x.sym) + '/">' + esc(x.sym) + '</a></td><td>' + esc(x.date) + '</td><td>' + esc(x.exit_date) + '</td><td>' + esc(x.exit) + '</td><td class="num">' + trackRet(x.exit_return) + '</td><td class="num">' + (x.sessions_held != null ? x.sessions_held : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : '<p class="sig-sub">No closed calls yet — the first calls resolve as their targets, stops or 20 sessions arrive.</p>');
      /* Calls pager wiring (rebuilt on every renderTracking). */
      var cp = $('sc-calls-pager');
      if (cp && callPages > 1) {
        var h = '<button class="sc-pg" data-pg="prev"' + (state.callsPage <= 1 ? ' disabled' : '') + '>‹ Prev</button>';
        pageWindow(state.callsPage, callPages).forEach(function (p) {
          if (p === '…') h += '<span class="sc-gap">…</span>';
          else h += '<button class="sc-pg' + (p === state.callsPage ? ' is-on' : '') + '" data-pg="' + p + '">' + p + '</button>';
        });
        h += '<button class="sc-pg" data-pg="next"' + (state.callsPage >= callPages ? ' disabled' : '') + '>Next ›</button>';
        cp.innerHTML = h;
        cp.querySelectorAll('.sc-pg').forEach(function (b) {
          b.addEventListener('click', function () {
            var v = b.getAttribute('data-pg');
            if (v === 'prev') state.callsPage = Math.max(1, state.callsPage - 1);
            else if (v === 'next') state.callsPage = Math.min(callPages, state.callsPage + 1);
            else state.callsPage = +v;
            renderTracking();
            rebaseline();
            scrollToEl($('sc-calls-body'));
          });
        });
      }
    } catch (e) {
      var cb2 = $('sc-calls-body');
      if (cb2) cb2.innerHTML = '<p class="sig-sub">The call ledger could not be rendered.</p>';
    }
  }

  function renderArchive() {
    var sec = document.querySelector('section[aria-label="Verdict archive"]');
    var body = $('sc-archive-body'), note = $('sc-archive-note');
    var doc = state.archiveDoc;
    if (!doc || !doc.sessions) {
      if (sec) sec.style.display = 'none'; // absent component, never an empty frame
      return;
    }
    if (sec) sec.style.display = '';
    var sessions = Object.keys(doc.sessions).sort();
    body.innerHTML = sessions.map(function (k) {
      var snap = doc.sessions[k] || {};
      var c = { 'Strong Buy': 0, 'Buy': 0, 'Hold': 0, 'Exit / Reduce': 0, 'Strong Exit': 0, 'Insufficient history': 0 };
      var n = 0;
      Object.keys(snap).forEach(function (s) {
        var v = snap[s] && snap[s].v;
        if (c[v] != null) c[v]++; else c[v] = 1;
        n++;
      });
      return '<tr><td>' + esc(k) + '</td><td class="num">' + n + '</td><td class="num">' + c['Strong Buy'] + '</td><td class="num">' + c['Buy'] + '</td><td class="num">' + c['Hold'] + '</td><td class="num">' + c['Exit / Reduce'] + '</td><td class="num">' + c['Strong Exit'] + '</td><td class="num">' + c['Insufficient history'] + '</td></tr>';
    }).join('');
    if (note) note.textContent = sessions.length ? 'Tracking starts ' + sessions[0] + '.' : '';
  }

  function render() {
    var rows = filtered();
    var perPage = state.perPage;
    var pages = Math.max(1, Math.ceil(rows.length / perPage));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * perPage;
    var slice = rows.slice(start, start + perPage);
    var repainted = 0;

    var html = slice.map(function (r, i) {
      var sn = start + i + 1;
      var Mono = window.NepseMono || null;
      var lv = liveVal(r);
      if (lv.live) repainted++;
      var priceHtml = '<b>' + num2(lv.p) + '</b>' +
        (lv.live ? ' <span class="sc-live-dot" title="Live tape, ' + esc(state.tapeSession) + '">●</span>' : '');
      return '<tr>' +
        '<td class="num sc-sn" data-label="S.N.">' + sn + '</td>' +
        '<td data-label="Sector">' + (r.sec ? '<span class="sc-sector">' + esc(r.sec) + '</span>' : '<span class="sc-dash">—</span>') + '</td>' +
        '<td data-label="Symbol"><a class="sc-sym" href="/stocks/' + esc(String(r.sym).replace(/\//g, '-')) + '/">' +
          (window.NepseLogo ? window.NepseLogo.html(r.sym, r.sec, 28) : (Mono ? Mono.avatar(r.sym, r.sec, 28) : '')) + '<span>' + esc(r.sym) + '</span></a>' +
          (r.l ? ' <span class="sc-ltp" title="LTP-only history">LTP</span>' : '') + staleMark(r) + '</td>' +
        '<td class="num" data-label="Price">' + priceHtml + '</td>' +
        '<td class="num" data-label="Change">' + chCell(lv.ch) + '</td>' +
        '<td class="num" data-label="Volume">' + fmtVol(r.vol) + rvolBadge(r) + '</td>' +
        '<td class="num" data-label="RSI">' + rsiCell(r) + '</td>' +
        '<td data-label="Signal &amp; setup">' + badge(r.v) + (r.setup ? ' <span class="sc-setup-chip">' + esc(r.setup) + '</span>' : '') +
        (r.vc ? '<br><span class="sc-prev">' + (r.vc === 'new' ? 'new signal' : (r.pv ? 'was ' + esc(r.pv) + (r.ps != null ? ' ' + r.ps : '') : '')) + (r.st ? ' · Buy streak ' + r.st : '') + (r.flip ? ' · <b>FLIP</b>' : '') + '</span>' : '') + '</td>' +
        '<td class="num" data-label="Hit rate">' + hitCell(r) + '</td>' +
        '<td class="num" data-label="Stop loss">' + slCell(r) + '</td>' +
        '<td class="num" data-label="Target">' + tpCell(r) + '</td>' +
        '</tr>';
    }).join('');
    $('sc-body').innerHTML = html || '<tr><td colspan="11" class="sc-empty">Nothing matches those filters. Try widening or resetting the filters.</td></tr>';

    // compact summary bar: "X of 410 shown"
    var sumEl = $('sc-summary');
    if (sumEl) {
      sumEl.innerHTML = '<span class="sc-sum-tf">' + esc(TF_LABEL[state.tf] || '') + '</span>' +
        '<span><b>' + rows.length + '</b>&nbsp;of&nbsp;<b>' + state.rows.length + '</b>&nbsp;shown</span>' +
        (state.batchAsof ? '<span class="sc-sum-dot">·</span><span>as of ' + esc(state.batchAsof) + '</span>' : '');
    }

    // sort indicators
    var ths = document.querySelectorAll('#sc-table th[data-k]');
    ths.forEach(function (th) {
      var k = th.getAttribute('data-k');
      var on = k === state.sortK;
      th.classList.toggle('sorted', on);
      var label = th.getAttribute('data-label') || th.textContent.replace(/[▴▾]/g, '').trim();
      th.setAttribute('data-label', label);
      th.innerHTML = esc(label) + (on ? ' <span class="arr">' + (state.sortD > 0 ? '▴' : '▾') + '</span>' : '');
      th.setAttribute('aria-sort', on ? (state.sortD > 0 ? 'ascending' : 'descending') : 'none');
    });

    // "Showing x to y of z entries"
    var from = rows.length ? start + 1 : 0, to = Math.min(start + perPage, rows.length);
    $('sc-range').textContent = 'Showing ' + from + ' to ' + to + ' of ' + rows.length + ' entries';

    // repaint note: live prices are marked; signals/SL/TP stay daily-batch
    var rn = $('sc-repaint-note');
    if (rn) {
      rn.textContent = state.tapeSession
        ? repainted + ' price' + (repainted === 1 ? '' : 's') + ' on this page repainted from live tape ' + state.tapeSession + ' (●); signals, stop-loss, targets and hit rates stay daily-batch.'
        : 'Batch prices shown (live tape unavailable). Signals, stop-loss and targets are daily-batch.';
    }

    renderPager(rows.length, pages);
  }

  function renderPager(total, pages) {
    var el = $('sc-pager');
    if (pages <= 1) { el.innerHTML = ''; return; }
    var h = '<button class="sc-pg" data-pg="prev"' + (state.page <= 1 ? ' disabled' : '') + '>‹ Prev</button>';
    var win = pageWindow(state.page, pages);
    win.forEach(function (p) {
      if (p === '…') h += '<span class="sc-gap">…</span>';
      else h += '<button class="sc-pg' + (p === state.page ? ' is-on' : '') + '" data-pg="' + p + '">' + p + '</button>';
    });
    h += '<button class="sc-pg" data-pg="next"' + (state.page >= pages ? ' disabled' : '') + '>Next ›</button>';
    el.innerHTML = h;
    el.querySelectorAll('.sc-pg').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-pg');
        if (v === 'prev') state.page = Math.max(1, state.page - 1);
        else if (v === 'next') state.page = Math.min(pages, state.page + 1);
        else state.page = +v;
        render();
        rebaseline();
        scrollToEl(document.getElementById('sc-table'));
      });
    });
  }

  function pageWindow(cur, total) {
    var set = [1, total, cur - 1, cur, cur + 1];
    var nums = set.filter(function (p) { return p >= 1 && p <= total; })
      .sort(function (a, b) { return a - b; })
      .filter(function (p, i, a) { return a.indexOf(p) === i; });
    var out = [], prev = 0;
    nums.forEach(function (p) { if (p - prev > 1) out.push('…'); out.push(p); prev = p; });
    return out;
  }

  // Summary cards double as signal filters (top-level: used by bindControls,
  // applyData and the sector-card handler).
// summary cards double as signal filters
function syncCards() {
  document.querySelectorAll('.sc-card[data-v]').forEach(function (x) {
    x.classList.toggle('is-on', !!state.verdict && x.getAttribute('data-v') === state.verdict);
  });
  var sigSel2 = $('sc-signal');
  if (sigSel2 && sigSel2.value !== state.verdict) sigSel2.value = state.verdict;
}

  // Wave 8: inline top-10 for the tapped signal card (top-level: used by
  // bindControls, applyData and the live overlay).
// Wave 8: inline top-10 for the tapped signal card. Rows carry symbol,
// price, day change, verdict, stop loss, target and a chart link.
function renderCardResults() {
  var box = document.getElementById('sc-card-results');
  if (!box) return;
  if (!state.verdict) { box.innerHTML = ''; box.hidden = true; return; }
  var matched = state.rows.filter(function (r) { return r.v === state.verdict; })
    .sort(rankCmp);
  var rows = matched.slice(0, 10);
  var total = matched.length;
  if (!rows.length) {
    box.innerHTML = '<p class="sc-cr-empty">No ' + esc(DISP[state.verdict] || state.verdict) +
      ' verdicts in the latest batch.</p>';
    box.hidden = false;
    return;
  }
  var Mono = window.NepseMono || null;
  var h = '<h3 class="sc-cr-head">Top ' + rows.length + ' ' +
    esc(DISP[state.verdict] || state.verdict) + ' matches</h3>';
  h += '<div class="sc-cr-list">' + rows.map(function (r) {
    var lv = liveVal(r);
    var chHtml = chCell(lv.ch);
    var priceHtml = num2(lv.p) + (lv.live ? ' <span class="sc-live-dot" title="Live tape, ' + esc(state.tapeSession) + '">●</span>' : '');
    return '<div class="sc-cr-row">' +
      '<a class="sc-cr-sym" href="/stocks/' + esc(String(r.sym).replace(/\//g, '-')) + '/">' +
        (window.NepseLogo ? window.NepseLogo.html(r.sym, r.sec, 26) : (Mono ? Mono.avatar(r.sym, r.sec, 26) : '')) + '<span>' + esc(r.sym) + '</span></a>' +
      '<span class="sc-cr-num tnum">Rs ' + priceHtml + '</span>' +
      '<span class="sc-cr-num tnum">' + chHtml + '</span>' +
      '<span>' + badge(r.v) + '</span>' +
      '<span class="sc-cr-num tnum">SL ' + num2(r.sl) + '</span>' +
      '<span class="sc-cr-num tnum">TP ' + num2(r.tp) + '</span>' +
      '<a class="sc-cr-link" href="/nepse-chart/?s=' + esc(r.sym) + '">Chart</a>' +
    '</div>';
  }).join('') + '</div>';
  if (total > rows.length) {
    h += '<p class="sc-cr-more"><a href="#sc-table" id="sc-cr-all">See all ' + total +
      ' in the full table below</a></p>';
  }
  box.innerHTML = h;
  box.hidden = false;
  var all = document.getElementById('sc-cr-all');
  if (all) all.addEventListener('click', function (e) {
    e.preventDefault();
    var tbl = document.getElementById('sc-table');
    if (tbl) scrollToEl(tbl);
  });
}

  function bindControls() {
    var q = $('sc-q'), deb = null;
    q.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () { state.q = q.value; state.page = 1; render(); rebaseline(); }, 160);
    });
    $('sc-sector').addEventListener('change', function (e) {
      state.sector = e.target.value; state.page = 1; render(); renderStats(); renderSectors(); rebaseline();
    });
    var sigSel = $('sc-signal');
    if (sigSel) sigSel.addEventListener('change', function (e) {
      state.verdict = e.target.value;
      syncCards();
      state.page = 1; render(); renderStats();
      renderCardResults();
      rebaseline();
    });
    var rsiSel = $('sc-rsi');
    if (rsiSel) rsiSel.addEventListener('change', function (e) { state.rsi = e.target.value; state.page = 1; render(); rebaseline(); });
    function numInput(id, set) {
      var el = $(id);
      if (!el) return;
      var deb = null;
      el.addEventListener('input', function () {
        clearTimeout(deb);
        deb = setTimeout(function () {
          var v = parseFloat(el.value);
          set(isFinite(v) && v >= 0 ? v : null);
          state.page = 1; render(); rebaseline();
        }, 220);
      });
    }
    numInput('sc-pmin', function (v) { state.pmin = v; });
    numInput('sc-pmax', function (v) { state.pmax = v; });
    numInput('sc-vmin', function (v) { state.vmin = v; });
    var resetBtn = $('sc-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);
    $('sc-perpage').addEventListener('change', function (e) {
      state.perPage = Math.max(1, parseInt(e.target.value, 10) || 25);
      state.page = 1; render(); rebaseline();
    });
    // Timeframe switch: Daily / Weekly / Monthly signal ranking.
    var tfSel = $('sc-tf');
    if (tfSel) tfSel.addEventListener('change', function (e) {
      state.tf = e.target.value || 'd';
      applyTf();
      var tf = state.tf;
      var votes = {};
      state.rows.forEach(function (r) { if (r.tfasof) votes[r.tfasof] = (votes[r.tfasof] || 0) + 1; });
      var best = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0]
        || state.batchAsof || '';
      var n = tfRankedCount();
      var scAsof = $('sc-asof');
      scAsof.textContent = tf === 'd'
        ? 'Signals as of ' + best + ' · ' + state.rows.length + ' securities ranked'
        : TF_LABEL[tf] + ' signals as of ' + best + ' · ' + n + ' of ' + state.rows.length + ' securities ranked';
      if (window.NepseFresh && best && !scAsof.querySelector('.fresh'))
        scAsof.insertAdjacentHTML('beforeend', ' ' + window.NepseFresh.badge(best));
      var hint = $('sc-tf-hint');
      if (hint) hint.textContent = TF_HINT[tf] || '';
      var asof2 = $('sc-asof2');
      if (asof2) asof2.textContent = best
        ? (tf === 'd' ? best : best + ' (' + TF_LABEL[tf].toLowerCase() + ' candles)')
        : 'the last close';
      state.page = 1;
      syncCards();
      render();
      renderStats();
      renderSectors();
      renderCardResults();
      rebaseline();
    });
    function cardFilter(card) {
      var v = card.getAttribute('data-v') || '';
      state.verdict = (state.verdict === v) ? '' : v;
      syncCards();
      state.page = 1; render(); renderStats();
      // Wave 8: the top matches render directly beneath the cards, so the
      // result is visible the moment a card is tapped (the full table below
      // keeps working as the complete filtered view)
      renderCardResults();
      rebaseline();
      if (state.verdict) {
        var box = document.getElementById('sc-card-results');
        if (box && box.scrollIntoView) scrollToEl(box);
      }
    }
    function resetFilters() {
      state.q = ''; state.sector = ''; state.verdict = '';
      state.rsi = ''; state.pmin = null; state.pmax = null; state.vmin = null;
      state.page = 1;
      var q2 = $('sc-q'); if (q2) q2.value = '';
      var sec = $('sc-sector'); if (sec) sec.value = '';
      var sig = $('sc-signal'); if (sig) sig.value = '';
      var rs = $('sc-rsi'); if (rs) rs.value = '';
      ['sc-pmin', 'sc-pmax', 'sc-vmin'].forEach(function (id) {
        var el = $(id); if (el) el.value = '';
      });
      syncCards();
      render();
      renderStats();
      renderSectors();
      renderCardResults();
      rebaseline();
    }
    document.querySelectorAll('.sc-card[data-v]').forEach(function (c) {
      c.addEventListener('click', function () { cardFilter(c); });
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cardFilter(c); }
      });
    });
    document.querySelectorAll('#sc-table th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (k === 'sn') return; // S.N. always follows the ranking
        if (state.sortK === k) state.sortD = -state.sortD;
        else { state.sortK = k; state.sortD = (k === 'sym' || k === 'sec' || k === 'rsi') ? 1 : -1; }
        state.page = 1; render(); rebaseline();
      });
    });
  }

  var controlsBound = false;

  /* Apply one batch load to the page. Safe to call repeatedly: controls
   * bind once, the sector filter is rebuilt from scratch (preserving the
   * selected sector), and the freshness badge is replaced rather than
   * duplicated. The active timeframe is re-applied after every rebuild
   * (the old code silently reverted to daily on refresh). */
  function applyData(res) {
      var vj = res[0], uj = res[1];
      var names = {}, groups = {};
      if (uj && uj.symbols) uj.symbols.forEach(function (it) {
        if (it.s) {
          names[it.s] = it.n || it.s;
          groups[it.s] = classifySymbol(it.s, it.n, it.t);
        }
      });
      var v = vj.verdicts || {};
      state.changes = vj.changes || null;
      state.callsDoc = res[2] || null;
      state.trackRecord = res[3] || null;
      state.archiveDoc = res[4] || null;
      state.wave1Asof = (res[5] && res[5].asof) || '';
      state.rows = Object.keys(v).map(function (sym) {
        var e = v[sym];
        // Authoritative verdicts.json sec (written by the universe builder
        // from tools/sector-map.json) wins; the local classifier is the
        // fallback. Every security lands in exactly one real category.
        var sec = (e.sec && e.sec !== 'Unknown') ? e.sec : (groups[sym] || 'Others');
        return {
          sym: sym, name: names[sym] || sym, v: e.v, s: e.s, p: e.p, ch: e.ch,
          vol: e.vol, volAvg: e.volAvg || null, sec: sec, sl: e.sl, tp: e.tp,
          setup: e.setup || null, l: e.l || 0, tr: e.tr || null, rsi: e.rsi,
          pv: e.pv || null, ps: (e.ps == null ? null : e.ps),
          st: e.st || 0, vc: e.vc || null, flip: !!e.flip,
          asof: e.asof || null, raw: e
        };
      });
      var asof = vj.asof || '';
      state.batchAsof = asof;
      var scAsof = $('sc-asof');
      scAsof.textContent = asof
        ? 'Signals as of ' + asof + ' · ' + state.rows.length + ' securities ranked'
        : state.rows.length + ' securities ranked';
      var oldFresh = scAsof.querySelector('.fresh');
      if (oldFresh) oldFresh.remove();
      if (window.NepseFresh && asof)
        scAsof.insertAdjacentHTML('beforeend', ' ' + window.NepseFresh.badge(asof));
      $('sc-asof2').textContent = asof || 'the last close';
      // sector dropdown (rebuilt from scratch so refreshes never duplicate options)
      var secs = {};
      state.rows.forEach(function (r) { if (r.sec) secs[r.sec] = 1; });
      var sel = $('sc-sector');
      while (sel.options.length > 1) sel.remove(1);
      Object.keys(secs).sort(function (a, b) {
        return a < b ? -1 : a > b ? 1 : 0;
      }).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        sel.appendChild(o);
      });
      if (state.sector) sel.value = state.sector; // preserve selection across refreshes

      if (!controlsBound) { bindControls(); controlsBound = true; }

      // sector deep link (used by the /nepse-sectors/ dashboard tiles): ?sector=Banking
      try {
        var qsec = new URLSearchParams(location.search).get('sector');
        if (qsec) {
          var match = Object.keys(secs).filter(function (s) { return s.toLowerCase() === qsec.toLowerCase(); })[0];
          if (match) { state.sector = match; sel.value = match; }
        }
      } catch (e) {}
      if (state.tf !== 'd') applyTf();
      render();
      renderStats();
      renderSectors();
      renderTracking();
      renderArchive();
      renderCardResults();
      // movers window-end (the range window's last session, from wave1.json)
      var mvEl = $('w1-mv-asof');
      if (mvEl && res[5] && res[5].movers && res[5].movers.top) {
        var ends = res[5].movers.top.map(function (t) { return t.asof || ''; }).filter(Boolean).sort();
        if (ends.length) mvEl.textContent = ends[ends.length - 1];
      }
      startLiveOverlay();
  }

  function fetchData() {
    function get(url) {
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
        return r.json();
      });
    }
    return Promise.all([
      get('../nepse-chart/data/verdicts.json'),
      get('../nepse-chart/data/universe.json').catch(function () { return null; }),
      get('../nepse-chart/data/screener-calls.json').catch(function () { return null; }),
      get('../nepse-chart/data/track-record.json').catch(function () { return null; }),
      get('../nepse-chart/data/screener-verdict-archive.json').catch(function () { return null; }),
      get('../nepse-chart/data/wave1.json').catch(function () { return null; })
    ]);
  }

  function failLoad() {
    $('sc-body').innerHTML = '<tr><td colspan="11" class="sc-empty">Could not load the ranking data. Please retry in a moment.</td></tr>';
    $('sc-asof').textContent = 'Data unavailable';
  }

  function load() {
    // skeleton rows: hold the table's footprint while the ranking loads
    (function () {
      var rows = '';
      for (var i = 0; i < 10; i++) {
        rows += '<tr><td colspan="11" aria-hidden="true"><span class="skl skl-row"></span></td></tr>';
      }
      $('sc-body').innerHTML = rows;
    })();
    fetchData().then(function (res) { applyData(res); rebaseline(); }).catch(failLoad);
  }

  /* Live overlay: the 15-minute tape (via window.NepseLive) feeds
   * render-time repaint. Signals, SL/TP and hit rates stay daily-batch. */
  var liveStarted = false;
  function startLiveOverlay() {
    if (liveStarted) return;
    var NL = window.NepseLive || null;
    if (!NL || !document.getElementById('sc-live')) return;
    liveStarted = true;
    NL.start({
      el: 'sc-live',
      onData: function (d) {
        if (!d) return;
        /* NL's d.asof is epoch ms (snap.asofMs), NOT a date string — the
         * original .slice(0, 10) threw on a number and NL swallowed it, so
         * the overlay never painted. Convert via the NPT clock helper. */
        if (d.asof > 0) {
          var tp = nptParts(new Date(d.asof));
          state.tapeSession = tp.y + '-' + tp.m + '-' + tp.d;
        }
        /* Tape map from the RAW snapshot (quarantined-included), mirroring
         * engine-verdict's direct live.json read: NL's d.quotes drops
         * ±10% movers (BENH +14.98%), which the series displays with a ●,
         * not hides. Raw quotes carry ltp/percent_change/previous_close,
         * the exact fields liveVal reads. Fall back to d.quotes only if
         * the snapshot is momentarily unavailable. */
        var ND = window.NepseData || null;
        var snap = ND ? ND.getSnapshot() : null;
        var map = {};
        if (snap && snap.quotes && snap.quotes.length) {
          snap.quotes.forEach(function (q) { if (q && q.symbol) map[q.symbol] = q; });
        } else if (d.quotes) {
          map = d.quotes;
        }
        if (!Object.keys(map).length) return;
        state.liveQuotes = map;
        render();
        renderCardResults();
        renderFresh();
      }
    });
  }

  /* ---------- 60s change-gated refresh + page-owned freshness ---------- */
  function computeSig() {
    var c = distCounts();
    var dist = VERDICTS.map(function (v) { return v + ':' + (c[v] || 0); }).join(',');
    var secs = sectorCounts();
    var secStr = Object.keys(secs).sort().map(function (s) { return s + ':' + secs[s]; }).join(',');
    var arch = state.archiveDoc && state.archiveDoc.sessions
      ? Object.keys(state.archiveDoc.sessions).sort().join(',') : '';
    return [state.batchAsof, state.rows.length, dist, secStr,
      (state.callsDoc && state.callsDoc.asof) || '',
      (state.trackRecord && state.trackRecord.asof) || '',
      state.wave1Asof, arch, state.tf].join('|');
  }
  function renderFresh() {
    var el = $('sc-fresh-text');
    if (!el) return;
    var now = new Date();
    state.lastChecked = now;
    var a = nptParts(now), b = nptParts(new Date(now.getTime() + 60000));
    el.textContent = 'Ranking as of ' + (state.batchAsof || '—') +
      ' · tape ' + (state.tapeSession || 'unavailable') +
      ' · checked ' + a.hh + ':' + a.mm + ' · next check ' + b.hh + ':' + b.mm +
      ' · refreshes every 60s when the data changes';
  }
  function rebaseline() {
    state.sig = computeSig();
    renderFresh();
  }
  function refreshTick() {
    fetchData().then(function (res) {
      var prevSig = state.sig;
      /* Signature of the FRESH payloads, computed without touching state. */
      var vj = res[0];
      var freshRows = vj.verdicts || {};
      var fc = {};
      VERDICTS.forEach(function (v) { fc[v] = 0; });
      Object.keys(freshRows).forEach(function (s) {
        var vv = freshRows[s].v;
        if (fc[vv] != null) fc[vv]++; else fc[vv] = 1;
      });
      var fdist = VERDICTS.map(function (v) { return v + ':' + (fc[v] || 0); }).join(',');
      /* Fresh sector counts under the SAME rule as applyData (sec-wins,
       * classifier fallback from the fresh universe) so the tick signature
       * is computed identically to computeSig() — a placeholder here would
       * make every tick look like a change. */
      var fnames = {}, fgroups = {};
      if (res[1] && res[1].symbols) res[1].symbols.forEach(function (it) {
        if (it.s) { fnames[it.s] = it.n || it.s; fgroups[it.s] = classifySymbol(it.s, it.n, it.t); }
      });
      var fsec = {};
      Object.keys(freshRows).forEach(function (sym) {
        var e = freshRows[sym];
        var sec = (e.sec && e.sec !== 'Unknown') ? e.sec : (fgroups[sym] || 'Others');
        fsec[sec] = (fsec[sec] || 0) + 1;
      });
      var fsecStr = Object.keys(fsec).sort().map(function (s) { return s + ':' + fsec[s]; }).join(',');
      var farch = (res[4] && res[4].sessions) ? Object.keys(res[4].sessions).sort().join(',') : '';
      var freshSig = [vj.asof || '', Object.keys(freshRows).length, fdist, fsecStr,
        (res[2] && res[2].asof) || '', (res[3] && res[3].asof) || '',
        (res[5] && res[5].asof) || '', farch, state.tf].join('|');
      if (freshSig !== prevSig) {
        applyData(res);
        if (window.ScreenerVerdict) window.ScreenerVerdict.refresh();
        if (window.NepseWave1) window.NepseWave1.refresh();
        rebaseline();
      } else {
        renderFresh(); // unchanged payloads: only the clock advances
      }
    }).catch(function () { /* failed poll keeps the last good data on screen */ });
  }
  setInterval(refreshTick, 60000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
