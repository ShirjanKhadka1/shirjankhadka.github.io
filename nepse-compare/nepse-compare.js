/* nepse-compare.js — family script for /nepse-compare/.
   Client-side only, from published files: universe.json (picker +
   names + instrument types), live.json (quotes), verdicts.json
   (verdicts + 52-week data), shareholding.json (listed totals +
   splits), adjustments.json (verified bonus/right events),
   history/<SYM>.json (per-symbol closes), index-history.json
   (NEPSE benchmark row + chart line). No new pipeline, no new
   source. Every number goes through NepseFormat; money-in-prose
   uses the suite arab/crore pattern (see nepse-sectors.js).
   Missing data renders as an em dash, never 0.
   Period returns mirror tools/build-symbol-pages.js loadLadder
   exactly: only bars on/after VERIFIED_START (2026-07-15) are
   used; bars strictly before a verified event's ex-date are
   multiplied by the event factor (bonus: 100/(100+pct); right:
   TERP/cum-close); cash dividends are never reinvested, so the
   label is "bonus/right-adjusted price returns", never "total
   return". 6M/1Y/3Y render unavailable when their reference bar
   would fall before the verified window — never estimated.
   Sector labels mirror js/nepse-sectors.js classifySymbol
   (universe-derived classification, gap-4 law); verdicts sec is
   only the fallback. Day change is the live quote's day change;
   verdicts change is never shown beside it (open basis-labeling
   question — the two bases are never mixed on this page).
   60s tick refetches live.json + verdicts.json and repaints the
   snapshot only when the fingerprint changes. */
(function () {
  'use strict';

  var LIVE_URL = '/nepse-chart/data/live.json';
  var VERD_URL = '/nepse-chart/data/verdicts.json';
  var UNI_URL = '/nepse-chart/data/universe.json';
  var SH_URL = '/nepse-chart/data/shareholding.json';
  var ADJ_URL = '/nepse-chart/data/adjustments.json';
  var IHIST_URL = '/data/index-history.json';
  var HIST_URL = function (s) { return '/nepse-chart/data/history/' + encodeURIComponent(s) + '.json'; };

  var VERIFIED_START = '2026-07-15';
  var MAX_SYMS = 4;
  var DEFAULT_SYMS = ['NABIL', 'NIFRA'];
  var PERIODS = [
    { label: '1W', days: 7 }, { label: '1M', months: 1 }, { label: '3M', months: 3 },
    { label: '6M', months: 6 }, { label: '1Y', months: 12 }, { label: '3Y', months: 36 }
  ];
  var CHART_PERIODS = [
    { label: '1W', days: 7 }, { label: '1M', months: 1 }, { label: '3M', months: 3 },
    { label: 'Since 15 Jul 2026', window: true }
  ];

  var F = (typeof window !== 'undefined' && window.NepseFormat) || null;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LINE_COLORS = ['__LIME__', '__INFO__', '#8B5CF6', '__AMBER__'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(x) {
    if (x === null || x === undefined || x === '') return NaN;
    var n = Number(x);
    return isFinite(n) ? n : NaN;
  }
  function fmtPrice(x) { return F ? F.fmtPrice(x) : (isNaN(num(x)) ? '—' : String(x)); }
  function fmtPct(x) { return F ? F.fmtPct(x) : (isNaN(num(x)) ? '—' : String(x) + '%'); }
  function fmtNum(x) { return F ? F.fmtNum(x) : (isNaN(num(x)) ? '—' : String(Math.round(num(x)))); }
  function fmtAge(ms) { return F ? F.fmtAge(ms) : ''; }
  function fmtDateTime(iso) { return F ? F.fmtDateTimeNPT(iso) : esc(iso); }
  function fmtRs(x) {
    var n = num(x);
    if (isNaN(n)) return '—';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e9) return sign + 'Rs ' + (a / 1e9).toFixed(2) + ' arab';
    if (a >= 1e7) return sign + 'Rs ' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return sign + 'Rs ' + (a / 1e5).toFixed(2) + ' L';
    return sign + 'Rs ' + fmtNum(a);
  }
  function fmtISODate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '—';
    return m[3].replace(/^0/, '') + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }
  function fmtDay(yyyymmdd) {
    var s = String(yyyymmdd);
    if (!/^\d{8}$/.test(s)) return '—';
    return s.slice(6, 8).replace(/^0/, '') + ' ' + MONTHS[Number(s.slice(4, 6)) - 1] + ' ' + s.slice(0, 4);
  }
  function clsFor(ch) {
    var n = num(ch);
    if (isNaN(n)) return 'cp-flat';
    return n > 0 ? 'cp-up' : (n < 0 ? 'cp-down' : 'cp-flat');
  }
  function signedPct(p) {
    var n = num(p);
    if (isNaN(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function tokenColor(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) { return fallback; }
  }

  /* ---- universe-derived sector classification (mirrors
     js/nepse-sectors.js classifySymbol + tables, gap-4 law) ---- */
  var DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
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
    SFCL: 'Finance', WNLB: 'Microfinance',
    NTC: 'Others', NRM: 'Others', NWCL: 'Others', TTL: 'Others', MKCL: 'Others'
  };
  var INVESTMENT_SYMBOLS = { CIT: 1, HIDCL: 1, HIDCLP: 1, NIFRA: 1, NRN: 1, CHDC: 1, ENL: 1, HATHY: 1 };
  var TRADING_SYMBOLS = { BBC: 1, STC: 1 };
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

  /* ---- ladder math (mirrors build-symbol-pages.js loadLadder) ---- */
  function isoOf(yyyymmdd) {
    var s = String(yyyymmdd);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  function subDaysIso(iso, n) {
    var dt = new Date(iso + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - n);
    return dt.toISOString().slice(0, 10);
  }
  function subMonthsIso(iso, m) {
    var p = iso.split('-').map(Number);
    var total = (p[0] * 12 + (p[1] - 1)) - m;
    var yy = Math.floor(total / 12);
    var mm = total - yy * 12 + 1;
    var dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    var dd = Math.min(p[2], dim);
    return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }
  function eventFactor(e, byDate) {
    if (e.kind === 'bonus' && isFinite(+e.pct) && +e.pct > 0) return 100 / (100 + +e.pct);
    if (e.kind === 'right' && isFinite(+e.ratio_new) && isFinite(+e.ratio_old) && +e.ratio_old > 0 && isFinite(+e.price)) {
      var cum = null;
      var keys = Object.keys(byDate).sort();
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] < e.ex_date) cum = byDate[keys[i]]; else break;
      }
      if (cum == null || cum <= 0) return null;
      return ((+e.ratio_old * cum + +e.ratio_new * +e.price) / (+e.ratio_old + +e.ratio_new)) / cum;
    }
    return null;
  }
  /* rows: [[yyyymmdd, O, H, L, C, vol, turnover], ...] -> verified ladder */
  function buildLadder(rows, adjEvents) {
    var byDate = {};
    rows.forEach(function (r) {
      if (!r || r.length < 5) return;
      var d = isoOf(r[0]);
      var c = num(r[4]);
      if (d >= VERIFIED_START && !isNaN(c) && c > 0) byDate[d] = c;
    });
    var dates = Object.keys(byDate).sort();
    if (!dates.length) return null;
    var anchor = dates[dates.length - 1];
    var factors = [];
    (adjEvents || []).forEach(function (e) {
      var f = eventFactor(e, byDate);
      if (f != null) factors.push({ event: e, factor: f });
    });
    function adj(d) {
      var c = byDate[d];
      factors.forEach(function (x) {
        if (d < x.event.ex_date) c *= x.factor;
      });
      return c;
    }
    var c0 = adj(anchor);
    var cells = PERIODS.map(function (p) {
      var target = p.days ? subDaysIso(anchor, p.days) : subMonthsIso(anchor, p.months);
      var ref = null;
      for (var i = dates.length - 1; i >= 0; i--) {
        if (dates[i] <= target) { ref = dates[i]; break; }
      }
      if (!ref) return { label: p.label, pct: null, ref: null };
      return { label: p.label, pct: (c0 / adj(ref) - 1) * 100, ref: ref };
    });
    var adjusted = cells.some(function (c) {
      if (c.pct === null) return false;
      var raw = (byDate[anchor] / byDate[c.ref] - 1) * 100;
      return Math.abs(raw - c.pct) > 1e-9;
    });
    return { anchor: anchor, close: byDate[anchor], first: dates[0], cells: cells,
      adjusted: adjusted, adjEvents: factors.map(function (x) { return x.event; }),
      byDate: byDate, dates: dates, adjFn: adj };
  }
  /* index ladder: same reference rule, no adjustments, full history */
  function buildIndexLadder(rows) {
    var byDate = {};
    rows.forEach(function (r) {
      if (!r || r.length < 5) return;
      var d = isoOf(r[0]);
      var c = num(r[4]);
      if (!isNaN(c) && c > 0) byDate[d] = c;
    });
    var dates = Object.keys(byDate).sort();
    if (!dates.length) return null;
    var anchor = dates[dates.length - 1];
    var c0 = byDate[anchor];
    var cells = PERIODS.map(function (p) {
      var target = p.days ? subDaysIso(anchor, p.days) : subMonthsIso(anchor, p.months);
      var ref = null;
      for (var i = dates.length - 1; i >= 0; i--) {
        if (dates[i] <= target) { ref = dates[i]; break; }
      }
      if (!ref) return { label: p.label, pct: null, ref: null };
      return { label: p.label, pct: (c0 / byDate[ref] - 1) * 100, ref: ref };
    });
    return { anchor: anchor, close: c0, cells: cells, byDate: byDate, dates: dates };
  }

  /* ---- state ---- */
  var S = {
    uni: {}, uniList: [], live: null, verd: null, sh: null, adj: null, ihist: null,
    syms: [], picked: [], perSym: {}, indexLadder: null, chartPeriod: '3M',
    fingerprint: ''
  };

  function verdictChip(v) {
    var map = { 'Strong Buy': 'sb', 'Buy': 'b', 'Hold': 'h', 'Exit / Reduce': 'er', 'Strong Exit': 'se' };
    var cls = map[v] || 'na';
    return '<span class="cp-vchip ' + cls + '">' + esc(v || 'No verdict') + '</span>';
  }
  function splitLine(sym) {
    var e = S.sh && S.sh.symbols ? S.sh.symbols[sym] : null;
    if (!e) return '—';
    if (e.split_status === 'verified') {
      var prov = e.verified_via === 'filing' ? 'filing-verified' : 'matched';
      return fmtNum(e.promoter_shares) + ' promoter (' + fmtPct(e.promoter_pct) + ') · ' +
        fmtNum(e.public_shares) + ' public (' + fmtPct(e.public_pct) + ') · ' + prov;
    }
    if (e.split_status === 'promoter_instrument') return 'Promoter share — 100% promoter / 0% public';
    if (e.split_status === 'held') return 'Held — split not yet verified';
    if (e.split_status === 'na_debenture') return '— · Debenture (no promoter/public split)';
    if (e.split_status === 'na_mutual_fund') return '— · Mutual fund (no promoter/public split)';
    if (e.split_status === 'unavailable') return '— · No listed total on file';
    return '—';
  }

  /* ---- picker ---- */
  function renderPicker() {
    var box = $('cpPicker');
    if (!box) return;
    var html = '';
    S.picked.forEach(function (sym, i) {
      var name = (S.uni[sym] && S.uni[sym].n) || '';
      html += '<div class="cp-field"><label for="cpIn' + i + '">Symbol ' + (i + 1) + '</label>' +
        '<input id="cpIn' + i + '" list="cpSyms" value="' + esc(sym) + '" autocomplete="off" spellcheck="false">' +
        '<div class="cp-name" id="cpName' + i + '">' + esc(name) + '</div>' +
        (i >= 2 ? '<button type="button" class="cp-btn ghost" data-remove="' + i + '" style="min-height:36px;padding:6px 14px">Remove</button>' : '') +
        '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('input').forEach(function (inp, i) {
      inp.addEventListener('input', function () {
        var v = inp.value.trim().toUpperCase();
        var nameEl = $('cpName' + i);
        if (nameEl) nameEl.textContent = (S.uni[v] && S.uni[v].n) || '';
      });
    });
    box.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.picked.splice(Number(btn.getAttribute('data-remove')), 1);
        renderPicker();
      });
    });
    var add = $('cpAdd');
    if (add) add.disabled = S.picked.length >= MAX_SYMS;
  }
  function readPicked() {
    var out = [];
    S.picked.forEach(function (_, i) {
      var inp = $('cpIn' + i);
      if (inp) out.push(inp.value.trim().toUpperCase());
    });
    return out;
  }
  function parseUrlSyms() {
    try {
      var q = new URLSearchParams(window.location.search).get('s');
      if (!q) return null;
      var seen = {}, out = [];
      q.split(',').forEach(function (t) {
        var s = t.trim().toUpperCase();
        if (s && S.uni[s] && !seen[s]) { seen[s] = 1; out.push(s); }
      });
      return out.length ? out.slice(0, MAX_SYMS) : null;
    } catch (e) { return null; }
  }

  /* ---- snapshot ---- */
  function snapshotHTML() {
    var syms = S.syms;
    var head = '<tr><th>Metric</th>' + syms.map(function (s) {
      return '<th><a href="/stocks/' + esc(s) + '/">' + esc(s) + '</a></th>';
    }).join('') + '</tr>';
    function row(label, fn, isNum) {
      var cells = syms.map(function (s) {
        var v = fn(s);
        return '<td' + (isNum ? ' class="num"' : '') + '>' + v + '</td>';
      }).join('');
      return '<tr><td class="rowlab">' + label + '</td>' + cells + '</tr>';
    }
    var quotes = {};
    if (S.live && Array.isArray(S.live.quotes)) {
      S.live.quotes.forEach(function (q) { if (q && q.symbol) quotes[q.symbol] = q; });
    }
    var rows = '';
    rows += row('Company', function (s) {
      var u = S.uni[s];
      return esc(u ? u.n : '—');
    });
    rows += row('Sector / type', function (s) {
      var u = S.uni[s];
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      var sec = u ? classifySymbol(s, u.n, u.t) : (v ? v.sec : null);
      var typ = u ? u.t : '—';
      return esc(sec || '—') + '<div class="sub">' + esc(typ) + '</div>';
    });
    rows += row('Price (Rs)', function (s) {
      var q = quotes[s];
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      if (q && !isNaN(num(q.ltp))) return '<strong>' + fmtPrice(q.ltp) + '</strong>';
      if (v && !isNaN(num(v.p))) return '<strong>' + fmtPrice(v.p) + '</strong><div class="sub">verdicts as of ' + esc(S.verd.asof || '') + '</div>';
      return '—';
    }, true);
    rows += row('Day change', function (s) {
      var q = quotes[s];
      if (!q || isNaN(num(q.change))) return '—';
      return '<span class="' + clsFor(q.change) + '">' + (num(q.change) > 0 ? '+' : '') + fmtPrice(q.change) +
        ' (' + signedPct(q.percent_change) + ')</span>';
    }, true);
    rows += row('Day range', function (s) {
      var q = quotes[s];
      if (!q || isNaN(num(q.high))) return '—';
      return fmtPrice(q.low) + ' – ' + fmtPrice(q.high) + '<div class="sub">prev close ' + fmtPrice(q.previous_close) + '</div>';
    }, true);
    rows += row('Volume', function (s) {
      var q = quotes[s];
      return q && !isNaN(num(q.volume)) ? fmtNum(q.volume) : '—';
    }, true);
    rows += row('Turnover', function (s) {
      var q = quotes[s];
      return q && !isNaN(num(q.turnover)) ? fmtRs(q.turnover) : '—';
    }, true);
    rows += row('Trades', function (s) {
      var q = quotes[s];
      return q && !isNaN(num(q.trades)) ? fmtNum(q.trades) : '—';
    }, true);
    rows += row('Verdict', function (s) {
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      if (!v) return verdictChip(null);
      return verdictChip(v.v) + '<div class="sub">as of ' + esc(v.asof || S.verd.asof || '') + '</div>';
    });
    rows += row('Verdict score', function (s) {
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      if (!v || isNaN(num(v.s))) return '—';
      var sc = num(v.s);
      var pct = Math.max(0, Math.min(100, ((sc + 5) / 10) * 100));
      return fmtPrice(sc) + '<div class="cp-gauge"><div class="trk"><i class="fl" style="width:' + pct.toFixed(0) + '%;background:var(--nd-lime)"></i></div></div>';
    }, true);
    rows += row('RSI', function (s) {
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      return v && !isNaN(num(v.rsi)) ? fmtPrice(v.rsi) : '—';
    }, true);
    rows += row('52-week range', function (s) {
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      if (!v || isNaN(num(v.h52))) return '—';
      var pos = num(v.pos);
      var pct = isNaN(pos) ? null : Math.max(0, Math.min(100, pos * 100));
      return fmtPrice(v.l52) + ' – ' + fmtPrice(v.h52) +
        (pct === null ? '' : '<div class="cp-pctbar"><span class="trk"><i class="fl" style="width:' + pct.toFixed(0) + '%;background:var(--nd-lime)"></i></span><span>' + pct.toFixed(0) + '%</span></div>');
    }, true);
    rows += row('Stop / target', function (s) {
      var v = S.verd && S.verd.verdicts ? S.verd.verdicts[s] : null;
      if (!v || (isNaN(num(v.sl)) && isNaN(num(v.tp)))) return '—';
      return 'SL ' + fmtPrice(v.sl) + ' · TP ' + fmtPrice(v.tp) + '<div class="sub">' + esc(v.setup || '') + '</div>';
    }, true);
    rows += row('Listed shares', function (s) {
      var e = S.sh && S.sh.symbols ? S.sh.symbols[s] : null;
      return e && !isNaN(num(e.listed)) ? fmtNum(e.listed) : '—';
    }, true);
    rows += row('Promoter / public', function (s) { return splitLine(s); });
    return '<table class="cp-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---- returns ---- */
  function returnsHTML() {
    var syms = S.syms;
    var head = '<tr><th>Period</th>' + syms.map(function (s) {
      return '<th class="num"><a href="/stocks/' + esc(s) + '/">' + esc(s) + '</a></th>';
    }).join('') + '<th class="num">NEPSE</th></tr>';
    var rows = PERIODS.map(function (p) {
      var cells = syms.map(function (s) {
        var L = S.perSym[s] && S.perSym[s].ladder;
        if (!L) return '<td class="num">—<div class="sub">No verified history</div></td>';
        var c = null;
        L.cells.forEach(function (x) { if (x.label === p.label) c = x; });
        if (!c || c.pct === null) return '<td class="num">—<div class="sub">No verified history</div></td>';
        return '<td class="num"><span class="' + clsFor(c.pct) + '">' + signedPct(c.pct) + '</span><div class="sub">vs ' + fmtISODate(c.ref) + '</div></td>';
      }).join('');
      var ic = null;
      if (S.indexLadder) S.indexLadder.cells.forEach(function (x) { if (x.label === p.label) ic = x; });
      var icell = (!ic || ic.pct === null)
        ? '<td class="num">—</td>'
        : '<td class="num"><span class="' + clsFor(ic.pct) + '">' + signedPct(ic.pct) + '</span><div class="sub">vs ' + fmtISODate(ic.ref) + '</div></td>';
      return '<tr><td class="rowlab">' + p.label + '</td>' + cells + icell + '</tr>';
    }).join('');
    var notes = [];
    syms.forEach(function (s) {
      var L = S.perSym[s] && S.perSym[s].ladder;
      if (L && L.adjusted && L.adjEvents.length) {
        notes.push(esc(s) + ' adjusted for ' + L.adjEvents.map(function (e) {
          return esc(+e.pct) + '% bonus (ex-date ' + esc(e.ex_date) + ')';
        }).join(', ') + '.');
      }
      if (S.adj && S.adj.unverified) {
        var claim = S.adj.unverified[s];
        if (claim) notes.push(esc(s) + ': ' + esc(claim) + ' — no adjustment applied.');
      }
    });
    var noteHtml = notes.length
      ? '<p class="cp-cap">' + notes.join(' ') + '</p>'
      : '';
    return '<table class="cp-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
      '<p class="cp-cap">Bonus/right-adjusted price returns: each figure compares the latest verified close with the close on/before the period target date; reference dates are printed under each figure. 6M/1Y/3Y show “—” when their reference bar would fall before 15 Jul 2026, the verified-history start. Cash dividends are not reinvested, so these are price returns, not total returns. NEPSE figures use the index archive closes over the same reference rule.</p>' +
      noteHtml;
  }

  /* ---- chart ---- */
  function lineColor(i) {
    var c = LINE_COLORS[i % LINE_COLORS.length];
    if (c === '__LIME__') return tokenColor('--nd-lime', '#B8E62E');
    if (c === '__INFO__') return tokenColor('--nd-info', '#3080FF');
    if (c === '__AMBER__') return tokenColor('--nd-amber', '#F5B301');
    return c;
  }
  function chartSeries() {
    var period = null;
    CHART_PERIODS.forEach(function (p) { if (p.label === S.chartPeriod) period = p; });
    if (!period) period = CHART_PERIODS[2];
    var out = [];
    S.syms.forEach(function (s, i) {
      var L = S.perSym[s] && S.perSym[s].ladder;
      if (!L) return;
      var pts = [];
      if (period.window) {
        L.dates.forEach(function (d) { pts.push([d, L.adjFn(d)]); });
      } else {
        var target = period.days ? subDaysIso(L.anchor, period.days) : subMonthsIso(L.anchor, period.months);
        var ref = null;
        for (var k = L.dates.length - 1; k >= 0; k--) {
          if (L.dates[k] <= target) { ref = L.dates[k]; break; }
        }
        if (!ref) return;
        L.dates.forEach(function (d) { if (d >= ref) pts.push([d, L.adjFn(d)]); });
      }
      if (pts.length < 2) return;
      var base = pts[0][1];
      out.push({ sym: s, color: lineColor(i), start: pts[0][0],
        pts: pts.map(function (p) { return [p[0], (p[1] / base) * 100]; }) });
    });
    if (S.indexLadder && out.length) {
      var start = out[0].start;
      out.forEach(function (o) { if (o.start < start) start = o.start; });
      var ipts = [];
      S.indexLadder.dates.forEach(function (d) {
        if (d >= start) ipts.push([d, S.indexLadder.byDate[d]]);
      });
      if (ipts.length >= 2) {
        var ibase = ipts[0][1];
        out.push({ sym: 'NEPSE', color: tokenColor('--nd-dim', '#9AA3B2'), dashed: true, start: ipts[0][0],
          pts: ipts.map(function (p) { return [p[0], (p[1] / ibase) * 100]; }) });
      }
    }
    return out;
  }
  function drawChart() {
    var cv = $('cpChart');
    if (!cv) return;
    var series = chartSeries();
    var cap = $('cpChartCap');
    var legend = $('cpChartLegend');
    if (!series.length) {
      if (cap) cap.textContent = 'No verified history for the selected symbols in this window.';
      if (legend) legend.innerHTML = '';
      var ctx0 = cv.getContext('2d');
      if (ctx0) ctx0.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 600;
    var h = cv.clientHeight || 300;
    cv.width = w * dpr;
    cv.height = h * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var padL = 46, padR = 12, padT = 12, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    var allDates = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { allDates.push(p[0]); }); });
    allDates.sort();
    var dMin = allDates[0], dMax = allDates[allDates.length - 1];
    function tOf(d) {
      var a = new Date(dMin + 'T00:00:00Z').getTime();
      var b = new Date(dMax + 'T00:00:00Z').getTime();
      var t = new Date(d + 'T00:00:00Z').getTime();
      return b === a ? 0 : (t - a) / (b - a);
    }
    var vMin = Infinity, vMax = -Infinity;
    series.forEach(function (s) { s.pts.forEach(function (p) {
      if (p[1] < vMin) vMin = p[1];
      if (p[1] > vMax) vMax = p[1];
    }); });
    var span = vMax - vMin || 1;
    vMin -= span * 0.08; vMax += span * 0.08;
    var grid = tokenColor('--nd-border', '#1E2430');
    var txt = tokenColor('--nd-dim', '#8E98A8');
    ctx.font = '11px IBM Plex Mono, monospace';
    ctx.fillStyle = txt;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    var steps = 4;
    for (var gi = 0; gi <= steps; gi++) {
      var v = vMin + (vMax - vMin) * gi / steps;
      var y = padT + ih - (v - vMin) / (vMax - vMin) * ih;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iw, y); ctx.stroke();
      ctx.fillText(v.toFixed(0), 4, y + 4);
    }
    [0, 0.5, 1].forEach(function (f) {
      var idx = Math.round(f * (allDates.length - 1));
      var d = allDates[idx];
      var x = padL + tOf(d) * iw;
      ctx.fillText(fmtISODate(d), Math.max(padL, Math.min(padL + iw - 70, x - 30)), h - 8);
    });
    ctx.beginPath(); ctx.moveTo(padL, padT + ih); ctx.lineTo(padL, padT); ctx.stroke();
    series.forEach(function (s) {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(s.dashed ? [6, 4] : []);
      ctx.lineJoin = 'round';
      s.pts.forEach(function (p, i) {
        var x = padL + tOf(p[0]) * iw;
        var y = padT + ih - (p[1] - vMin) / (vMax - vMin) * ih;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });
    if (legend) {
      legend.innerHTML = series.map(function (s) {
        var last = s.pts[s.pts.length - 1][1];
        var chg = last - 100;
        return '<span><i class="sw' + (s.dashed ? ' dash' : '') + '" style="background:' + esc(s.color) +
          ';color:' + esc(s.color) + '"></i>' + esc(s.sym) + ' ' +
          '<span class="' + clsFor(chg) + '">' + signedPct(chg) + '</span></span>';
      }).join('');
    }
    if (cap) {
      var starts = series.map(function (s) { return esc(s.sym) + ' from ' + fmtISODate(s.start); }).join(' · ');
      cap.textContent = 'Rebased to 100 at each series\u2019 first plotted close (' + starts +
        '). Adjusted for verified bonus/right events, like the returns table. NEPSE is the index benchmark.';
    }
  }
  function renderPills() {
    var box = $('cpChartPills');
    if (!box) return;
    box.innerHTML = '';
    CHART_PERIODS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      b.setAttribute('aria-pressed', p.label === S.chartPeriod ? 'true' : 'false');
      b.addEventListener('click', function () {
        S.chartPeriod = p.label;
        renderPills();
        drawChart();
      });
      box.appendChild(b);
    });
  }

  /* ---- render orchestration ---- */
  function renderAll() {
    var snap = $('cpSnapshotBody');
    if (snap) snap.innerHTML = snapshotHTML();
    var ret = $('cpReturnsBody');
    if (ret) ret.innerHTML = returnsHTML();
    drawChart();
  }
  function setFreshline() {
    var fl = $('cpFreshline');
    if (!fl || !S.live) return;
    var asof = S.live.asof || '';
    var age = '';
    try {
      var ms = Date.now() - new Date(asof).getTime();
      if (isFinite(ms) && ms >= 0) age = ' · ' + fmtAge(ms) + ' old';
    } catch (e) { /* keep blank */ }
    fl.textContent = 'Quotes as of ' + fmtDateTime(asof) + age + ' · verdicts as of ' +
      fmtISODate(S.verd ? S.verd.asof : '') + ' · source: NEPSE (delayed feed).';
    var chip = $('cpStateChip');
    if (chip) {
      var m = S.live.market || '';
      chip.className = 'cp-chip ' + (m === 'OPEN' ? 'live' : (m ? 'closed' : 'unverified'));
      chip.innerHTML = '<span class="dot"></span>' + (m === 'OPEN' ? 'LIVE' : (m ? 'CLOSED' : 'STATE UNVERIFIED'));
    }
  }
  function fingerprint() {
    var parts = [(S.live && S.live.asof) || '', (S.verd && S.verd.asof) || ''];
    if (S.live && Array.isArray(S.live.quotes)) {
      var map = {};
      S.live.quotes.forEach(function (q) { if (q && q.symbol) map[q.symbol] = q.ltp; });
      S.syms.forEach(function (s) { parts.push(s + ':' + (map[s] === undefined ? '' : map[s])); });
    }
    return parts.join('|');
  }
  function loadComparison(syms, first) {
    S.syms = syms;
    var err = $('cpErr');
    if (err) err.textContent = '';
    var jobs = syms.map(function (s) {
      return fetchJSON(HIST_URL(s)).then(function (h) {
        var ev = (S.adj && S.adj.events) ? S.adj.events.filter(function (e) { return e.symbol === s; }) : [];
        S.perSym[s] = { hist: h, ladder: buildLadder(h.data || [], ev) };
      }).catch(function () {
        S.perSym[s] = { hist: null, ladder: null };
      });
    });
    Promise.all(jobs).then(function () {
      renderAll();
      setFreshline();
      if (!first) {
        try {
          var url = window.location.pathname + '?s=' + syms.map(encodeURIComponent).join(',');
          window.history.replaceState(null, '', url);
        } catch (e) { /* URL state is best-effort */ }
      }
    });
  }
  function doCompare() {
    var raw = readPicked();
    var err = $('cpErr');
    var seen = {}, valid = [];
    raw.forEach(function (s) {
      if (s && S.uni[s] && !seen[s]) { seen[s] = 1; valid.push(s); }
    });
    if (valid.length < 2) {
      if (err) err.textContent = 'Pick at least 2 valid symbols from the list (2–4 allowed). Unknown symbols: ' +
        esc(raw.filter(function (s) { return s && !S.uni[s]; }).join(', ') || 'none') + '.';
      return;
    }
    S.picked = valid.slice();
    renderPicker();
    loadComparison(valid.slice(), false);
  }

  /* ---- boot ---- */
  function boot() {
    Promise.all([
      fetchJSON(UNI_URL).catch(function () { return null; }),
      fetchJSON(LIVE_URL).catch(function () { return null; }),
      fetchJSON(VERD_URL).catch(function () { return null; }),
      fetchJSON(SH_URL).catch(function () { return null; }),
      fetchJSON(ADJ_URL).catch(function () { return null; }),
      fetchJSON(IHIST_URL).catch(function () { return null; })
    ]).then(function (res) {
      var uni = res[0], live = res[1], verd = res[2], sh = res[3], adj = res[4], ih = res[5];
      if (uni && Array.isArray(uni.symbols)) {
        uni.symbols.forEach(function (u) { if (u && u.s) S.uni[u.s] = u; });
        S.uniList = uni.symbols.map(function (u) { return u.s; }).filter(Boolean).sort();
      }
      var dl = $('cpSyms');
      if (dl) {
        dl.innerHTML = '';
        S.uniList.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s;
          o.label = (S.uni[s] && S.uni[s].n) || '';
          dl.appendChild(o);
        });
      }
      S.live = live; S.verd = verd; S.sh = sh;
      if (adj) {
        var evMap = {};
        (adj.events || []).forEach(function (e) { if (e && e.symbol) evMap[e.symbol] = 1; });
        var unv = {};
        (adj.unverified_claims || []).forEach(function (u) { if (u && u.symbol) unv[u.symbol] = u.claim; });
        S.adj = { events: adj.events || [], unverified: unv };
      }
      if (ih && Array.isArray(ih.rows)) S.indexLadder = buildIndexLadder(ih.rows);
      var initial = parseUrlSyms() || DEFAULT_SYMS.slice();
      if (initial.length < 2) initial = DEFAULT_SYMS.slice();
      S.picked = initial.slice();
      renderPicker();
      renderPills();
      loadComparison(initial.slice(), true);
      setInterval(function () {
        Promise.all([fetchJSON(LIVE_URL).catch(function () { return null; }),
          fetchJSON(VERD_URL).catch(function () { return null; })]).then(function (r) {
          if (r[0]) S.live = r[0];
          if (r[1]) S.verd = r[1];
          setFreshline();
          var fp = fingerprint();
          if (fp !== S.fingerprint) {
            S.fingerprint = fp;
            var snap = $('cpSnapshotBody');
            if (snap) snap.innerHTML = snapshotHTML();
          }
        });
      }, 60000);
      var btn = $('cpGo');
      if (btn) btn.addEventListener('click', doCompare);
      var add = $('cpAdd');
      if (add) add.addEventListener('click', function () {
        if (S.picked.length >= MAX_SYMS) return;
        S.picked.push('');
        renderPicker();
        var inp = $('cpIn' + (S.picked.length - 1));
        if (inp) inp.focus();
      });
    }).catch(function () {
      var snap = $('cpSnapshotBody');
      if (snap) snap.innerHTML = '<p class="cp-cap">Could not load market data. Please retry.</p>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
