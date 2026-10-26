/* Nepse Decode: browser-local portfolio tracker.
 *
 * Unlimited named portfolios, holdings with weighted-average cost, and
 * realized P&L on recorded sells. Everything lives in this browser only,
 * under the 'nl_portfolios_v1' localStorage key. No login, no server,
 * nothing syncs anywhere.
 *
 * Valuation prices come from the daily market batch
 * (/nepse-chart/data/verdicts.json). A holding without a price in the batch
 * shows '—' and is excluded from value math; figures are never invented.
 * This is descriptive bookkeeping for education. Not investment advice.
 */
(function () {
  'use strict';

  var KEY = 'nl_portfolios_v1';

  /* ================= pure math (no DOM, unit-testable) ================= */
  function round2(x) { return Math.round(x * 100) / 100; }

  var Calc = {
    /* weighted average cost after adding a lot */
    addLot: function (qty, cost, addQty, addPrice) {
      var nq = qty + addQty;
      if (!(nq > 0)) return null;
      return { qty: round2(nq), cost: round2((qty * cost + addQty * addPrice) / nq) };
    },
    /* partial or full sale: remaining qty and realized P&L */
    sell: function (qty, cost, sellQty, sellPrice) {
      if (!(sellQty > 0) || !(sellQty <= qty)) return null;
      return { qty: round2(qty - sellQty), realized: round2((sellPrice - cost) * sellQty) };
    },
    unrealized: function (qty, cost, price) {
      if (price == null || !isFinite(price)) return null;
      return round2((price - cost) * qty);
    },
    retPct: function (qty, cost, price) {
      if (price == null || !isFinite(price) || !(qty * cost > 0)) return null;
      return round2((price - cost) / cost * 100);
    },
    /* day P&L from the batch's day-change percent: prev = p / (1 + ch/100) */
    dayPnl: function (qty, price, chPct) {
      if (price == null || !isFinite(price) || chPct == null || !isFinite(chPct)) return null;
      var prev = price / (1 + chPct / 100);
      return round2((price - prev) * qty);
    },
    pctOf: function (part, total) {
      if (!(total > 0)) return null;
      return round2(part / total * 100);
    }
  };

  /* ================= store ================= */
  function uid() {
    return 'pf-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }
  function cleanSym(s) {
    s = String(s || '').trim().toUpperCase();
    return /^[A-Z0-9]{1,12}$/.test(s) ? s : null;
  }
  function cleanHolding(h) {
    if (!h || typeof h !== 'object') return null;
    var s = cleanSym(h.s);
    var qty = +h.qty, cost = +h.cost;
    if (!s || !(qty > 0) || !(cost > 0)) return null;
    return { s: s, qty: round2(qty), cost: round2(cost) };
  }
  function cleanSell(x) {
    if (!x || typeof x !== 'object') return null;
    var h = cleanHolding({ s: x.s, qty: x.qty, cost: x.cost });
    if (!h) return null;
    var price = +x.price;
    if (!(price > 0)) return null;
    var date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '';
    return {
      s: h.s, qty: h.qty, price: round2(price), cost: h.cost, date: date,
      realized: round2((price - h.cost) * h.qty)
    };
  }
  function cleanPortfolio(p) {
    if (!p || typeof p !== 'object') return null;
    var out = {
      id: typeof p.id === 'string' && p.id ? p.id : uid(),
      name: String(p.name || 'Portfolio').slice(0, 60) || 'Portfolio',
      holdings: [], sells: []
    };
    (Array.isArray(p.holdings) ? p.holdings : []).forEach(function (h) {
      var c = cleanHolding(h); if (c) out.holdings.push(c);
    });
    (Array.isArray(p.sells) ? p.sells : []).forEach(function (x) {
      var c = cleanSell(x); if (c) out.sells.push(c);
    });
    return out;
  }
  function blank() { return { version: 1, active: null, portfolios: [], snapshots: [] }; }
  /* Per-session portfolio snapshots (browser-local only, same key).
     One entry per (session, portfolio): the active portfolio's valuation
     from the batch of that session. Old stores without the field load as
     [] — no migration, nothing stranded. Capped at 1000 (about 4 years). */
  function cleanSnapshot(x) {
    if (!x || typeof x !== 'object') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.session || '')) return null;
    if (typeof x.pid !== 'string' || !x.pid) return null;
    var v = +x.value, inv = +x.invested, un = +x.unrl, re = +x.realized, pr = +x.priced;
    if (!isFinite(v) || !isFinite(inv) || !isFinite(un) || !isFinite(re) || !isFinite(pr)) return null;
    if (v < 0 || inv < 0 || pr < 0) return null;
    return {
      session: x.session, pid: x.pid, value: round2(v), invested: round2(inv),
      unrl: round2(un), realized: round2(re), priced: Math.floor(pr)
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      var st = {
        version: 1,
        active: (d && typeof d.active === 'string') ? d.active : null,
        portfolios: [],
        snapshots: []
      };
      (d && Array.isArray(d.portfolios) ? d.portfolios : []).forEach(function (p) {
        var c = cleanPortfolio(p); if (c) st.portfolios.push(c);
      });
      (d && Array.isArray(d.snapshots) ? d.snapshots : []).forEach(function (x) {
        var c = cleanSnapshot(x); if (c) st.snapshots.push(c);
      });
      if (st.snapshots.length > 1000) st.snapshots = st.snapshots.slice(-1000);
      return st;
    } catch (e) { return blank(); }
  }
  /* Upsert the active portfolio's snapshot for the current batch session.
     Returns true only when the stored entry is new or changed, so the
     save() -> onChange -> renderAll loop terminates after one pass.
     Skipped silently when nothing is priced: a value-0 snapshot against
     invested capital would chart a false cliff. */
  function upsertSnapshot(st, v, p) {
    if (!dataReady || !dataAsof || !/^\d{4}-\d{2}-\d{2}$/.test(dataAsof)) return false;
    if (!v.rows.length || v.pricedCount <= 0) return false;
    var snap = {
      session: dataAsof, pid: p.id, value: v.value, invested: v.invested,
      unrl: v.unrl, realized: v.realized, priced: v.pricedCount
    };
    var snaps = st.snapshots || (st.snapshots = []);
    for (var i = 0; i < snaps.length; i++) {
      if (snaps[i].session === snap.session && snaps[i].pid === snap.pid) {
        if (snaps[i].value === snap.value && snaps[i].invested === snap.invested &&
            snaps[i].unrl === snap.unrl && snaps[i].realized === snap.realized &&
            snaps[i].priced === snap.priced) return false;
        snaps[i] = snap;
        return true;
      }
    }
    snaps.push(snap);
    if (snaps.length > 1000) st.snapshots = snaps.slice(-1000);
    return true;
  }

  var listeners = [];
  function save(st) {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* storage full or blocked */ }
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function onChange(fn) { listeners.push(fn); }

  function getActive(st) {
    var p = null, i;
    for (i = 0; i < st.portfolios.length; i++) {
      if (st.portfolios[i].id === st.active) { p = st.portfolios[i]; break; }
    }
    if (!p && st.portfolios.length) { p = st.portfolios[0]; st.active = p.id; }
    return p;
  }
  function ensureDefault(st) {
    var p = getActive(st);
    if (!p) {
      p = { id: uid(), name: 'My Portfolio', holdings: [], sells: [] };
      st.portfolios.push(p);
      st.active = p.id;
      save(st);
    }
    return p;
  }

  /* store API for this page and future suite widgets */
  window.NLPortfolio = {
    key: KEY, Calc: Calc, load: load, save: save, onChange: onChange,
    getActive: function () { var st = load(); return ensureDefault(st); },
    cleanHolding: cleanHolding
  };
  window.NLPortfolioCalc = Calc;

  /* ================= page UI (only on /nepse-portfolio/) ================= */
  var hasDOM = typeof document !== 'undefined' && !!document.getElementById;
  var root = hasDOM ? document.getElementById('pf-root') : null;
  if (!root) return;
  var requiredIds = ['pf-summary', 'pf-tbody', 'pf-empty'];
  for (var ri = 0; ri < requiredIds.length; ri++) {
    if (!document.getElementById(requiredIds[ri])) return;
  }

  var universe = [];   // [{s, n}]
  var verdicts = {};   // sym -> {p, ch, sec, asof}
  var dataAsof = '';
  var dataReady = false;
  var editor = null;   // {mode:'sell'|'edit', sym}
  var activeIdx = -1, currentMatches = [];

  var el = {
    select: $('pf-select'), summary: $('pf-summary'), tbody: $('pf-tbody'),
    empty: $('pf-empty'), holdWrap: $('pf-hold-wrap'),
    allocH: $('pf-alloc-hold'), allocS: $('pf-alloc-sec'), analytics: $('pf-analytics'),
    sellsBody: $('pf-sells-body'), sellsEmpty: $('pf-sells-empty'),
    search: $('pf-search'), suggest: $('pf-suggest'), qty: $('pf-qty'),
    price: $('pf-price'), addBtn: $('pf-add-btn'), hint: $('pf-hint'),
    barForm: $('pf-bar-form'),
    freshLine: $('pf-fresh-line'),
    sectorSelect: $('pf-sector-select'), sectorTbody: $('pf-sector-tbody'),
    sectorEmpty: $('pf-sector-empty'), sectorPagerInfo: $('pf-sector-pager-info'),
    sectorPrev: $('pf-sector-prev'), sectorNext: $('pf-sector-next'),
    histChart: $('pf-history-chart'), histNote: $('pf-history-note'),
    histTbody: $('pf-history-tbody'),
    bench: $('pf-bench'), benchNote: $('pf-bench-note'),
    outTbody: $('pf-outcomes-tbody')
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return Number(x).toLocaleString('en-US', {
      minimumFractionDigits: d || 0, maximumFractionDigits: d || 0
    });
  }
  function fmtRs(x) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return 'Rs ' + fmtNum(x, 2);
  }
  function fmtPct(x) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return (x > 0 ? '+' : '') + fmtNum(x, 2) + '%';
  }
  function signedCls(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; }
  function metaFor(sym) {
    for (var i = 0; i < universe.length; i++) if (universe[i].s === sym) return universe[i];
    return null;
  }
  function known(sym) { return !!metaFor(sym); }

  function showHint(msg, ms) {
    if (!el.hint) return;
    el.hint.textContent = msg;
    el.hint.hidden = false;
  }

  /* ================= valuation ================= */
  function valuate(p) {
    var rows = p.holdings.map(function (h) {
      var vd = verdicts[h.s] || {};
      var price = (vd.p != null && isFinite(vd.p)) ? +vd.p : null;
      var ch = (vd.ch != null && isFinite(vd.ch)) ? +vd.ch : null;
      return {
        h: h, price: price, ch: ch, sec: vd.sec || 'Others',
        value: price == null ? null : round2(h.qty * price),
        unrl: Calc.unrealized(h.qty, h.cost, price),
        ret: Calc.retPct(h.qty, h.cost, price),
        day: Calc.dayPnl(h.qty, price, ch)
      };
    });
    var invested = 0, value = 0, unrl = 0, day = 0, pricedValue = 0;
    rows.forEach(function (r) {
      invested += r.h.qty * r.h.cost;
      if (r.value != null) { value += r.value; pricedValue += r.value; }
      if (r.unrl != null) unrl += r.unrl;
      if (r.day != null) day += r.day;
    });
    var realized = 0;
    p.sells.forEach(function (s) { realized += s.realized; });
    return {
      rows: rows,
      invested: round2(invested),
      value: round2(value),
      unrl: round2(unrl),
      unrlPct: Calc.pctOf(unrl, invested),
      day: round2(day),
      realized: round2(realized),
      pricedCount: rows.filter(function (r) { return r.value != null; }).length
    };
  }

  /* ================= render ================= */
  function statCard(label, big, sub, cls) {
    return '<div class="pf-stat"><span class="pf-lab">' + esc(label) + '</span>' +
      '<span class="pf-big tnum ' + (cls || '') + '">' + big + '</span>' +
      (sub ? '<span class="pf-sub">' + sub + '</span>' : '') + '</div>';
  }

  function renderSummary(v, p) {
    var cards = [
      statCard('Invested', fmtRs(v.invested), p.holdings.length + (p.holdings.length === 1 ? ' holding' : ' holdings')),
      statCard('Current value', fmtRs(v.value), v.pricedCount + ' of ' + p.holdings.length + ' priced'),
      statCard('Unrealized P&L', fmtRs(v.unrl) + ' (' + fmtPct(v.unrlPct) + ')', 'open positions', signedCls(v.unrl)),
      statCard('Day P&L', fmtRs(v.day), 'latest batch move', signedCls(v.day)),
      statCard('Realized P&L', fmtRs(v.realized), p.sells.length + (p.sells.length === 1 ? ' sale' : ' sales') + ' recorded', signedCls(v.realized)),
      statCard('Total return', fmtPct(v.unrlPct), 'on invested capital', signedCls(v.unrlPct))
    ];
    el.summary.innerHTML = cards.join('');
  }

  function editorRow(r, colspan) {
    if (!editor || editor.sym !== r.h.s) return '';
    var h = r.h;
    if (editor.mode === 'sell') {
      return '<tr class="pf-editrow"><td colspan="' + colspan + '">' +
        '<form class="pf-edform" id="pf-sell-form" data-sym="' + esc(h.s) + '">' +
        '<strong>Record a sale of ' + esc(h.s) + '</strong> <span class="pf-muted">You hold ' + fmtNum(h.qty, 2) + ' @ ' + fmtRs(h.cost) + ' avg.</span>' +
        '<label>Qty sold <input type="number" id="pf-sell-qty" min="0.01" step="any" max="' + h.qty + '" value="' + h.qty + '" required></label>' +
        '<label>Sell price (Rs) <input type="number" id="pf-sell-price" min="0.01" step="any" placeholder="e.g. 540.00" required></label>' +
        '<label>Date <input type="date" id="pf-sell-date" value="' + todayISO() + '"></label>' +
        '<button type="submit" class="btn small">Record sale</button> ' +
        '<button type="button" class="pf-link" data-cancel>Cancel</button>' +
        '</form></td></tr>';
    }
    return '<tr class="pf-editrow"><td colspan="' + colspan + '">' +
      '<form class="pf-edform" id="pf-edit-form" data-sym="' + esc(h.s) + '">' +
      '<strong>Edit ' + esc(h.s) + '</strong>' +
      '<label>Quantity <input type="number" id="pf-edit-qty" min="0.01" step="any" value="' + h.qty + '" required></label>' +
      '<label>Avg cost (Rs) <input type="number" id="pf-edit-cost" min="0.01" step="any" value="' + h.cost + '" required></label>' +
      '<button type="submit" class="btn small">Save</button> ' +
      '<button type="button" class="pf-link" data-cancel>Cancel</button>' +
      '</form></td></tr>';
  }

  /* Diverging P&L bar: zero line at the track centre, fill extends right
     for gains and left for losses, scaled to the largest |P&L| on the
     page. Width/position are data, so they stay inline (same justification
     as the simulator's P&L bars). */
  function divbarHtml(unrl, maxAbs) {
    if (unrl == null) return '<span class="tnum">—</span>';
    var w = maxAbs > 0 ? Math.abs(unrl) / maxAbs * 50 : 0;
    var left = unrl >= 0 ? 50 : 50 - w;
    var cls = unrl > 0 ? 'up' : unrl < 0 ? 'down' : '';
    return '<span class="pf-divbar"><span class="pf-divbar-track"><span class="pf-divbar-zero"></span>' +
      '<span class="pf-divbar-fill ' + cls + '" style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></span></span>' +
      '<span class="pf-divbar-val ' + cls + '">' + fmtRs(unrl) + '</span></span>';
  }

  function renderHoldings(v) {
    if (!v.rows.length) {
      el.holdWrap.hidden = true;
      el.empty.hidden = false;
      return;
    }
    el.holdWrap.hidden = false;
    el.empty.hidden = true;
    var maxAbs = 0;
    v.rows.forEach(function (r) {
      if (r.unrl != null && Math.abs(r.unrl) > maxAbs) maxAbs = Math.abs(r.unrl);
    });
    var html = v.rows.map(function (r) {
      var h = r.h, m = metaFor(h.s);
      var dayHtml = r.ch == null
        ? '<span class="tnum">—</span>'
        : '<span class="tnum ' + signedCls(r.ch) + '">' + fmtPct(r.ch) + '</span>';
      var unHtml = r.unrl == null
        ? '<span class="tnum">—</span>'
        : '<span class="tnum ' + signedCls(r.unrl) + '">' + fmtRs(r.unrl) + '<br><small>' + fmtPct(r.ret) + '</small></span>';
      return '<tr>' +
        '<td><a class="pf-sym" href="/nepse-chart/?s=' + esc(h.s) + '">' + (window.NepseLogo?window.NepseLogo.html(h.s,'',24):'') + esc(h.s) + '</a>' +
        '<span class="pf-name">' + esc(m ? m.n : '') + '</span></td>' +
        '<td class="tnum">' + fmtNum(h.qty, 2) + '</td>' +
        '<td class="tnum">' + fmtRs(h.cost) + '</td>' +
        '<td class="tnum">' + (r.price == null ? '—' : fmtRs(r.price)) + '</td>' +
        '<td>' + dayHtml + '</td>' +
        '<td class="tnum">' + (r.value == null ? '—' : fmtRs(r.value)) + '</td>' +
        '<td>' + unHtml + '</td>' +
        '<td>' + divbarHtml(r.unrl, maxAbs) + '</td>' +
        '<td class="pf-actcol"><button type="button" class="pf-mini" data-act="sell" data-sym="' + esc(h.s) + '">Sell</button>' +
        '<button type="button" class="pf-mini" data-act="edit" data-sym="' + esc(h.s) + '">Edit</button>' +
        '<button type="button" class="pf-mini danger" data-act="remove" data-sym="' + esc(h.s) + '">Remove</button></td>' +
        '</tr>' + editorRow(r, 9);
    }).join('');
    el.tbody.innerHTML = html;
  }

  function allocBlock(title, items, total) {
    var top = items.slice(0, 8);
    var rest = items.slice(8);
    if (rest.length) {
      var rv = rest.reduce(function (a, b) { return a + b.value; }, 0);
      top.push({ label: 'Other (' + rest.length + ')', value: round2(rv) });
    }
    var max = top.length ? top[0].value : 0;
    var rows = top.map(function (it) {
      var pct = Calc.pctOf(it.value, total);
      var w = max > 0 ? (it.value / max * 100).toFixed(1) : 0;
      return '<div class="pf-alloc-row"><span class="pf-alloc-lab">' + esc(it.label) + '</span>' +
        '<span class="pf-alloc-track"><span class="pf-alloc-fill" style="width:' + w + '%"></span></span>' +
        '<span class="pf-alloc-pct tnum">' + fmtPct(pct).replace('+', '') + '</span></div>';
    }).join('');
    return '<h3>' + esc(title) + '</h3>' + (rows || '<p class="pf-muted">Nothing to allocate yet.</p>');
  }

  /* Donut palette: the kit categorical set, theme-aware so every segment
     reads on both the dark cinema canvas and the light panel. The old
     palette's darkest greens vanished on the dark panel. */
  function donutColors() {
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    return dark
      ? ['#B8E62E', '#4ADE80', '#60A5FA', '#F5B301', '#A78BFA', '#2DD4BF', '#F472B6', '#9AA3B2']
      : ['#4D7C0F', '#15803D', '#2563EB', '#B45309', '#7C3AED', '#0F766E', '#BE185D', '#64748B'];
  }

  function drawDonut(cv, items, total) {
    if (!cv || !cv.getContext) return;
    var cols = donutColors();
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    var dpr = window.devicePixelRatio || 1, size = 180;
    cv.width = size * dpr; cv.height = size * dpr;
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    var cx = size / 2, cy = size / 2, R = 76, r = 50;
    var a = -Math.PI / 2, i, it, frac, a0, a1;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      frac = total > 0 ? it.value / total : 0;
      if (!(frac > 0)) continue;
      a0 = a + 0.028; a1 = a + frac * Math.PI * 2 - 0.028;
      if (a1 <= a0) { a0 = a; a1 = a + frac * Math.PI * 2; }
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a1);
      ctx.arc(cx, cy, r, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = cols[i % cols.length];
      ctx.fill();
      a += frac * Math.PI * 2;
    }
    ctx.fillStyle = dark ? '#9AA3B2' : '#66705F';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillText('TOTAL VALUE', cx, cy - 13);
    ctx.fillStyle = dark ? '#F6F7F9' : '#0C1F16';
    ctx.font = '700 15px Inter, sans-serif';
    ctx.fillText('Rs ' + fmtNum(total, 0), cx, cy + 7);
  }

  function renderDonutCard(items, total) {
    var top = items.slice(0, 8), rest = items.slice(8);
    if (rest.length) {
      top.push({
        label: 'Other (' + rest.length + ')',
        value: round2(rest.reduce(function (acc, b) { return acc + b.value; }, 0))
      });
    }
    if (!top.length) {
      el.allocH.innerHTML = '<h3>By holding</h3><p class="pf-muted">Nothing to allocate yet.</p>';
      return;
    }
    var cols = donutColors();
    var legend = top.map(function (it, i) {
      var pct = Calc.pctOf(it.value, total);
      return '<li><i style="background:' + cols[i % cols.length] + '"></i>' +
        '<span class="pf-dl-sym">' + (window.NepseLogo?window.NepseLogo.html(it.label,'',20):'') + esc(it.label) + '</span>' +
        '<span class="pf-dl-val tnum">' + fmtRs(it.value) + '</span>' +
        '<span class="pf-dl-pct tnum">' + fmtPct(pct).replace('+', '') + '</span></li>';
    }).join('');
    var ariaBits = top.map(function (it) {
      return it.label + ' ' + fmtPct(Calc.pctOf(it.value, total)).replace('+', '');
    }).join(', ');
    el.allocH.innerHTML = '<h3>By holding</h3>' +
      '<div class="pf-donut-flex">' +
      '<canvas id="pf-donut" role="img" aria-label="Allocation across holdings: ' + esc(ariaBits) + '"></canvas>' +
      '<ul class="pf-donut-legend">' + legend + '</ul></div>';
    drawDonut(document.getElementById('pf-donut'), top, total);
  }

  function renderAlloc(v) {
    var priced = v.rows.filter(function (r) { return r.value != null; });
    var total = priced.reduce(function (a, r) { return a + r.value; }, 0);
    var byHold = priced.map(function (r) { return { label: r.h.s, value: r.value }; })
      .sort(function (a, b) { return b.value - a.value; });
    var secMap = {};
    priced.forEach(function (r) {
      secMap[r.sec] = (secMap[r.sec] || 0) + r.value;
    });
    var bySec = Object.keys(secMap).map(function (k) { return { label: k, value: round2(secMap[k]) }; })
      .sort(function (a, b) { return b.value - a.value; });
    renderDonutCard(byHold, total);
    el.allocS.innerHTML = allocBlock('By sector', bySec, total);
  }

  function renderAnalytics(v) {
    var priced = v.rows.filter(function (r) { return r.ret != null; });
    function ana(label, big, sub) {
      return '<div class="pf-stat"><span class="pf-lab">' + esc(label) + '</span>' +
        '<span class="pf-big">' + big + '</span>' + (sub ? '<span class="pf-sub">' + sub + '</span>' : '') + '</div>';
    }
    if (!priced.length) {
      el.analytics.innerHTML = '<p class="pf-muted">Analytics appear once your holdings have prices in the latest batch.</p>';
      return;
    }
    var byRet = priced.slice().sort(function (a, b) { return a.ret - b.ret; });
    var best = byRet[byRet.length - 1], worst = byRet[0];
    var byVal = priced.slice().sort(function (a, b) { return b.value - a.value; });
    var top = byVal[0];
    var topPct = Calc.pctOf(top.value, v.value);
    var winners = priced.filter(function (r) { return r.ret > 0; }).length;
    var losers = priced.filter(function (r) { return r.ret < 0; }).length;
    el.analytics.innerHTML =
      ana('Best performer', esc(best.h.s) + ' <span class="tnum up">' + fmtPct(best.ret) + '</span>', fmtRs(best.unrl) + ' unrealized') +
      ana('Worst performer', esc(worst.h.s) + ' <span class="tnum ' + signedCls(worst.ret) + '">' + fmtPct(worst.ret) + '</span>', fmtRs(worst.unrl) + ' unrealized') +
      ana('Largest position', esc(top.h.s) + ' <span class="tnum">' + fmtPct(topPct).replace('+', '') + '</span>', fmtRs(top.value) + ' of portfolio value') +
      ana('Winners vs losers', '<span class="tnum up">' + winners + '</span> / <span class="tnum down">' + losers + '</span>', 'holdings above vs below avg cost');
  }

  function renderSells(p) {
    if (!p.sells.length) {
      el.sellsBody.innerHTML = '';
      el.sellsEmpty.hidden = false;
      return;
    }
    el.sellsEmpty.hidden = true;
    var tot = 0;
    var rows = p.sells.slice().reverse().map(function (s) {
      tot += s.realized;
      return '<tr><td class="tnum">' + esc(s.date || '—') + '</td>' +
        '<td><a class="pf-sym" href="/nepse-chart/?s=' + esc(s.s) + '">' + (window.NepseLogo?window.NepseLogo.html(s.s,'',24):'') + esc(s.s) + '</a></td>' +
        '<td class="tnum">' + fmtNum(s.qty, 2) + '</td>' +
        '<td class="tnum">' + fmtRs(s.price) + '</td>' +
        '<td class="tnum">' + fmtRs(s.cost) + '</td>' +
        '<td class="tnum ' + signedCls(s.realized) + '">' + fmtRs(s.realized) + '</td></tr>';
    }).join('');
    el.sellsBody.innerHTML = rows +
      '<tr class="pf-total"><td colspan="5">Total realized</td><td class="tnum ' + signedCls(tot) + '">' + fmtRs(round2(tot)) + '</td></tr>';
  }

  function renderBar(st) {
    el.select.innerHTML = st.portfolios.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === st.active ? ' selected' : '') + '>' +
        esc(p.name) + ' (' + p.holdings.length + ')</option>';
    }).join('');
  }

  function renderAll() {
    var st = load();
    var p = ensureDefault(st);
    renderBar(st);
    var v = valuate(p);
    if (!v.rows.length) {
      // No holdings: the guided empty state renders even when market data
      // failed — #pf-empty must never stay hidden with zero holdings.
      renderHoldings(v);
      renderAlloc(v);
      renderAnalytics(v);
      renderSells(p);
      el.summary.innerHTML = '<p class="pf-muted">Your portfolio is empty. Add a holding above to start tracking — everything stays in this browser.</p>';
      renderSector();
      renderHistory(p);
      renderBench(p);
      renderOutcomes(p);
      return;
    }
    if (!dataReady) {
      el.summary.innerHTML = '<p class="pf-muted">Loading market data…</p>';
      renderSector();
      renderHistory(p);
      renderBench(p);
      renderOutcomes(p);
      return;
    }
    renderSummary(v, p);
    renderHoldings(v);
    renderAlloc(v);
    renderAnalytics(v);
    renderSells(p);
    // Snapshot upsert: save() fires onChange -> renderAll once more, but
    // the second pass finds the entry unchanged and stops. Never loops.
    if (upsertSnapshot(st, v, p)) save(st);
    renderSector();
    renderHistory(p);
    renderBench(p);
    renderOutcomes(p);
    // Freshness: the suite [data-freshness-badge] line in the masthead
    // stays untouched; the page-level #pf-fresh-line under the summary
    // (updated on every check, including failures) is the line the
    // refresh scheduler owns.
    var ph = document.getElementById('pf-print-name');
    if (ph) ph.textContent = p.name;
    var pd = document.getElementById('pf-print-date');
    if (pd) pd.textContent = todayLong();
  }

  /* ================= mutations ================= */
  function mutate(fn, msg) {
    var st = load();
    var p = ensureDefault(st);
    var r = fn(st, p);
    if (r === false) return;
    save(st);
    editor = null;
    renderAll();
    if (msg) showHint(msg);
  }

  function doAdd(sym, qty, price) {
    sym = cleanSym(sym);
    qty = +qty; price = +price;
    if (!sym || !known(sym)) { showHint('Pick a listed security from the suggestions first.'); return; }
    if (!(qty > 0)) { showHint('Quantity must be more than zero.'); return; }
    if (!(price > 0)) { showHint('Buy price must be more than zero.'); return; }
    var addedMsg = '';
    mutate(function (st, p) {
      var ex = null;
      p.holdings.forEach(function (h) { if (h.s === sym) ex = h; });
      if (ex) {
        var r = Calc.addLot(ex.qty, ex.cost, qty, price);
        ex.qty = r.qty; ex.cost = r.cost;
        addedMsg = sym + ' topped up. New avg cost ' + fmtRs(r.cost) + '.';
      } else {
        p.holdings.push({ s: sym, qty: round2(qty), cost: round2(price) });
        addedMsg = sym + ' added at ' + fmtRs(price) + ' avg cost.';
      }
    }, null);
    if (addedMsg) showHint(addedMsg);
    el.search.value = ''; el.qty.value = ''; el.price.value = '';
    el.search.focus();
  }

  /* ================= autocomplete ================= */
  function matches(q) {
    q = q.trim().toUpperCase();
    if (!q) return [];
    var starts = [], contains = [];
    for (var i = 0; i < universe.length; i++) {
      var u = universe[i];
      if (u.s.indexOf(q) === 0) starts.push(u);
      else if (u.s.indexOf(q) > -1 || u.n.toUpperCase().indexOf(q) > -1) contains.push(u);
      if (starts.length >= 8) break;
    }
    return starts.concat(contains).slice(0, 8);
  }
  function renderSuggest() {
    if (!currentMatches.length) {
      el.suggest.hidden = true; el.suggest.innerHTML = ''; activeIdx = -1;
      el.search.setAttribute('aria-expanded', 'false');
      return;
    }
    el.suggest.innerHTML = currentMatches.map(function (u, i) {
      return '<li role="option" id="pf-opt-' + i + '" aria-selected="' + (i === activeIdx) + '">' +
        (window.NepseLogo?window.NepseLogo.html(u.s,'',22):'') + '<strong>' + esc(u.s) + '</strong><span>' + esc(u.n) + '</span></li>';
    }).join('');
    el.suggest.hidden = false;
    el.search.setAttribute('aria-expanded', 'true');
  }
  function closeSuggest() {
    el.suggest.hidden = true; el.suggest.innerHTML = '';
    el.search.setAttribute('aria-expanded', 'false');
    activeIdx = -1; currentMatches = [];
  }

  /* ================= data + market-aware refresh ================= */
  var lastCheckAt = 0, refreshTimer = null, liveStarted = false;
  var benchDB = null, benchFailed = false;
  /* ---- Tick change-gate (fading fix): loadData used to renderAll() on
     every tick even when the batch was identical, rebuilding every
     holdings/allocation/history/bench node. The signature covers the
     whole batch, so an unchanged tick moves only the freshness line.
     Boot always renders (firstLoad), preserving the loading/empty
     states on a failed first fetch. */
  var lastBatchSig = null, firstLoad = true;
  function batchSig(u, vd){
    var a = (u && Array.isArray(u.symbols)) ? u.symbols.map(function(s){ return s.s; }).join(',') : '';
    var b = (vd && vd.verdicts) ? (vd.asof || '') + '|' + JSON.stringify(vd.verdicts) : '';
    return a + '||' + b;
  }

  /* NEPSE hours are Mon–Fri 11:00–15:00 NPT. Cadence: 15 min in session,
     30 min outside it on weekdays, 2 h on weekends. Hidden tabs skip the
     fetch; visibilitychange re-checks on return. */
  function nptParts(d) {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu', weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d);
      var o = {};
      parts.forEach(function (x) { o[x.type] = x.value; });
      return o;
    } catch (e) {
      return { weekday: '', hour: '12', minute: '00' };
    }
  }
  function nptDateStr(d) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(d);
    } catch (e) { return todayISO(); }
  }
  function nptTimeStr(d) {
    var p = nptParts(d);
    return p.hour + ':' + p.minute;
  }
  function inNPTSession(d) {
    var p = nptParts(d);
    var mins = (+p.hour) * 60 + (+p.minute);
    return p.weekday !== 'Sat' && p.weekday !== 'Sun' && mins >= 11 * 60 && mins < 15 * 60;
  }
  function cadenceMs(d) {
    var p = nptParts(d || new Date());
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return 2 * 60 * 60 * 1000;
    var mins = (+p.hour) * 60 + (+p.minute);
    if (mins >= 11 * 60 && mins < 15 * 60) return 15 * 60 * 1000;
    return 30 * 60 * 1000;
  }
  /* The page-level freshness line: updated on EVERY check, including
     failures ("Check failed — showing last loaded batch", never silent
     stale data). The suite [data-freshness-badge] line is separate and
     untouched. */
  function freshLine(ok) {
    if (!el.freshLine) return;
    var now = new Date();
    var cadMin = Math.round(cadenceMs(now) / 60000);
    if (!ok) {
      el.freshLine.setAttribute('data-state', 'failed');
      el.freshLine.textContent = 'Check failed — showing last loaded batch' +
        (dataAsof ? ' (' + dataAsof + ')' : ' (none yet)') +
        ' · checked ' + nptTimeStr(now) + ' NPT · retry in ' + cadMin + ' min';
      return;
    }
    var today = nptDateStr(now);
    var state, note;
    if (dataAsof === today) {
      state = inNPTSession(now) ? 'live' : 'closed';
      note = state === 'live' ? 'market open' : 'market closed';
    } else {
      state = 'delayed';
      note = 'batch behind';
    }
    el.freshLine.setAttribute('data-state', state);
    el.freshLine.textContent = 'Prices as of ' + dataAsof +
      ' · ' + universe.length + ' securities · ' + note +
      ' · checked ' + nptTimeStr(now) + ' NPT · next check in ' + cadMin + ' min';
  }
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (document.hidden) return; // visibilitychange re-checks on return
      refreshData();
    }, cadenceMs());
  }
  function refreshData() {
    lastCheckAt = Date.now();
    loadData(true);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && lastCheckAt && Date.now() - lastCheckAt >= cadenceMs()) refreshData();
  });

  /* Benchmark database: fetched once per load (it is ~100KB gzipped and
     changes only when its builder republishes), refetched when a batch
     moves past it so the strip never scores against a stale window. */
  function loadBench(force) {
    if (benchDB && !force) return Promise.resolve(benchDB);
    return fetch('/data/portfolio-benchmark.json').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (db) {
      if (db && db.nepse) { benchDB = db; benchFailed = false; }
      else benchFailed = true;
      return benchDB;
    }).catch(function () {
      benchFailed = true;
      return null;
    });
  }

  function loadData(isRefresh) {
    Promise.all([
      fetch('/nepse-chart/data/universe.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/nepse-chart/data/verdicts.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (res) {
      var u = res[0], vd = res[1];
      var full = !!(u && Array.isArray(u.symbols) && vd && vd.verdicts);
      var changed;
      if (firstLoad) {
        changed = true; firstLoad = false;
        if (full) lastBatchSig = batchSig(u, vd);
      }
      else if (full) {
        var sig = batchSig(u, vd);
        changed = sig !== lastBatchSig;
        lastBatchSig = sig;
      } else {
        /* Partial tick: render only if the verdicts asof advanced. */
        changed = !!(vd && vd.verdicts && vd.asof !== dataAsof);
      }
      if (u && Array.isArray(u.symbols)) universe = u.symbols;
      if (vd && vd.verdicts) { verdicts = vd.verdicts; dataAsof = vd.asof || ''; }
      dataReady = true;
      lastCheckAt = Date.now();
      freshLine(true);
      if (changed) renderAll();
      if (!liveStarted) { startLiveOverlay(); liveStarted = true; }
      if (benchDB && dataAsof && dataAsof > benchDB.asof) {
        var oldBench = JSON.stringify(benchDB);
        loadBench(true).then(function () {
          /* A bench refetch on a stale window repaints only when the
             bench content actually moved, never on an identical file. */
          if (JSON.stringify(benchDB || '') !== oldBench) renderAll();
        });
      }
      scheduleRefresh();
    }).catch(function () {
      lastCheckAt = Date.now();
      if (!isRefresh) {
        dataReady = false;
        el.summary.innerHTML = '<p class="pf-muted">Could not load market data. Your saved portfolios are safe in this browser; please try again later.</p>';
      }
      // On a refresh failure the last loaded batch keeps rendering — the
      // line says so, never silent stale data.
      freshLine(false);
      scheduleRefresh();
    });
  }

  /* Live overlay: when the 15-minute tape is fresh, repaint holding prices
     and day changes in place. Quantities, costs, values, and P&L bars
     repaint on the full market-aware refresh. */
  function startLiveOverlay() {
    var NL = window.NepseLive || null;
    if (!NL) return;
    // Note: the suite [data-freshness-badge] line and the page-level
    // #pf-fresh-line are separate; the overlay only repaints prices.
    NL.start({
      el: null,
      onData: function (d) {
        if (!d || !d.quotes) return;
        var quotes = d.quotes;
        var wrap = document.getElementById('pf-hold-wrap');
        if (!wrap) return;
        var rows = wrap.querySelectorAll('tr');
        for (var i = 0; i < rows.length; i++) {
          var link = rows[i].querySelector('.pf-sym');
          if (!link) continue;
          var sym = link.textContent.trim();
          var q = sym && quotes[sym];
          if (!q || q.ltp == null || !isFinite(Number(q.ltp))) continue;
          var cells = rows[i].querySelectorAll('td');
          // Price cell (index 3), day-change cell (index 4). Write only
          // on value change: identical pushes must not touch the DOM.
          var pxTxt = fmtRs(q.ltp);
          if (cells[3] && cells[3].textContent !== pxTxt) cells[3].textContent = pxTxt;
          if (cells[4]) {
            var pct = (q.pct != null && isFinite(Number(q.pct))) ? Number(q.pct) : null;
            if (pct != null) {
              var chHtml = '<span class="tnum ' + signedCls(pct) + '">' +
                fmtPct(pct) + '</span>';
              if (cells[4].innerHTML !== chHtml) cells[4].innerHTML = chHtml;
            }
          }
        }
      }
    });
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayLong() {
    var d = new Date();
    var M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
  }

  /* ================= sector stocks block ================= */
  var sectorPage = 1, sectorFilter = '__all', sectorSig = '';
  var SECTOR_PAGE_SIZE = 25;

  function sectorOf(sym) {
    var vd = verdicts[sym];
    return (vd && vd.sec) || 'Others';
  }
  /* Counts are computed over UNIVERSE symbols (not verdicts keys) so each
     option's count exactly matches the rows that sector shows. A universe
     symbol with no verdict falls under Others, same as its rows. */
  function sectorCounts() {
    var m = {};
    var syms = universe.length ? universe.map(function (u) { return u.s; }) : Object.keys(verdicts);
    syms.forEach(function (s) {
      var sec = sectorOf(s);
      m[sec] = (m[sec] || 0) + 1;
    });
    return m;
  }
  function renderSector() {
    if (!el.sectorSelect || !el.sectorTbody) return;
    if (!dataReady) {
      el.sectorTbody.innerHTML = '';
      if (el.sectorPagerInfo) el.sectorPagerInfo.textContent = 'Loading market data…';
      if (el.sectorEmpty) el.sectorEmpty.hidden = true;
      if (el.sectorPrev) el.sectorPrev.disabled = true;
      if (el.sectorNext) el.sectorNext.disabled = true;
      return;
    }
    var counts = sectorCounts();
    var total = 0;
    Object.keys(counts).forEach(function (k) { total += counts[k]; });
    var sig = JSON.stringify(counts) + '|' + dataAsof;
    if (sig !== sectorSig) {
      sectorSig = sig;
      var names = Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
      });
      el.sectorSelect.innerHTML =
        '<option value="__all">All sectors (' + total + ')</option>' +
        names.map(function (n) {
          return '<option value="' + esc(n) + '">' + esc(n) + ' (' + counts[n] + ')</option>';
        }).join('');
      el.sectorSelect.value = sectorFilter;
      if (el.sectorSelect.value !== sectorFilter) {
        sectorFilter = '__all';
        el.sectorSelect.value = '__all';
      }
    }
    var rows = universe.filter(function (u) {
      return sectorFilter === '__all' || sectorOf(u.s) === sectorFilter;
    }).sort(function (a, b) { return a.s < b.s ? -1 : a.s > b.s ? 1 : 0; });
    var pages = Math.max(1, Math.ceil(rows.length / SECTOR_PAGE_SIZE));
    if (sectorPage > pages) sectorPage = pages;
    var from = (sectorPage - 1) * SECTOR_PAGE_SIZE;
    var page = rows.slice(from, from + SECTOR_PAGE_SIZE);
    el.sectorTbody.innerHTML = page.map(function (u) {
      var vd = verdicts[u.s] || {};
      var p = (vd.p != null && isFinite(vd.p)) ? +vd.p : null;
      var ch = (vd.ch != null && isFinite(vd.ch)) ? +vd.ch : null;
      return '<tr>' +
        '<td><a class="pf-sym" href="/nepse-chart/?s=' + esc(u.s) + '">' + esc(u.s) + '</a></td>' +
        '<td class="pf-left">' + esc(u.n || '') + '</td>' +
        '<td class="tnum">' + (p == null ? '—' : fmtRs(p)) + '</td>' +
        '<td>' + (ch == null ? '<span class="tnum">—</span>' :
          '<span class="tnum ' + signedCls(ch) + '">' + fmtPct(ch) + '</span>') + '</td>' +
        '<td class="tnum">' + esc(dataAsof || '—') + '</td>' +
        '<td class="pf-actcol"><button type="button" class="pf-mini lime" data-prefill="' + esc(u.s) + '" data-price="' + (p == null ? '' : p) + '">Add</button></td>' +
        '</tr>';
    }).join('');
    var to = Math.min(from + page.length, rows.length);
    if (el.sectorPagerInfo) el.sectorPagerInfo.textContent = rows.length
      ? 'Showing ' + (from + 1) + '–' + to + ' of ' + rows.length
      : 'No stocks in this sector.';
    if (el.sectorEmpty) el.sectorEmpty.hidden = rows.length > 0;
    if (el.sectorPrev) el.sectorPrev.disabled = sectorPage <= 1;
    if (el.sectorNext) el.sectorNext.disabled = sectorPage >= pages;
  }
  /* Prefill only: fills the add form, never touches holdings, never
     auto-adds. The user reviews quantity and price, then Add holding. */
  function prefillAdd(sym, price) {
    el.search.value = sym;
    if (price !== '') el.price.value = price;
    showHint(sym + ' prefilled — review quantity and price, then Add holding.');
    var form = document.querySelector('.pf-add');
    if (form) form.scrollIntoView();
    el.qty.focus();
  }

  /* ================= snapshots, history chart, benchmark, outcomes ================= */
  function snapshotsFor(pid) {
    var st = load();
    return (st.snapshots || []).filter(function (x) { return x.pid === pid; })
      .sort(function (a, b) { return a.session < b.session ? -1 : a.session > b.session ? 1 : 0; });
  }
  function drawHistoryChart(snaps) {
    var cv = el.histChart;
    if (!cv || !cv.getContext) return;
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 600, h = 260;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (snaps.length < 2) return;
    var padL = 64, padR = 16, padT = 14, padB = 28;
    var iw = w - padL - padR, ih = h - padT - padB;
    var vals = snaps.map(function (s) { return s.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) max = min + 1;
    var X = function (i) { return padL + (snaps.length === 1 ? iw / 2 : i / (snaps.length - 1) * iw); };
    var Y = function (v) { return padT + (1 - (v - min) / (max - min)) * ih; };
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)';
    ctx.fillStyle = dark ? '#9AA3B2' : '#66705F';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var gv = min + (max - min) * g / 4, gy = Y(gv);
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
      ctx.fillText('Rs ' + fmtNum(gv, 0), padL - 8, gy);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    [0, Math.floor((snaps.length - 1) / 2), snaps.length - 1].forEach(function (i) {
      ctx.fillText(snaps[i].session.slice(5), X(i), padT + ih + 8);
    });
    ctx.strokeStyle = dark ? '#B8E62E' : '#4D7C0F';
    ctx.lineWidth = 2; ctx.beginPath();
    snaps.forEach(function (s, i) {
      if (i === 0) ctx.moveTo(X(i), Y(s.value));
      else ctx.lineTo(X(i), Y(s.value));
    });
    ctx.stroke();
    ctx.fillStyle = dark ? '#B8E62E' : '#4D7C0F';
    snaps.forEach(function (s, i) {
      ctx.beginPath(); ctx.arc(X(i), Y(s.value), 3, 0, Math.PI * 2); ctx.fill();
    });
  }
  function renderHistory(p) {
    if (!el.histTbody) return;
    var snaps = snapshotsFor(p.id);
    var latest = snaps.slice(-30).reverse();
    el.histTbody.innerHTML = latest.map(function (s) {
      return '<tr><td class="tnum">' + esc(s.session) + '</td>' +
        '<td class="tnum">' + fmtRs(s.value) + '</td>' +
        '<td class="tnum">' + fmtRs(s.invested) + '</td>' +
        '<td class="tnum ' + signedCls(s.unrl) + '">' + fmtRs(s.unrl) + '</td>' +
        '<td class="tnum ' + signedCls(s.realized) + '">' + fmtRs(s.realized) + '</td></tr>';
    }).join('');
    if (el.histNote) {
      if (!snaps.length) {
        el.histNote.textContent = 'No snapshots yet. The first snapshot appears after the next batch with a priced holding — history builds as sessions land, never before.';
      } else if (snaps.length === 1) {
        el.histNote.textContent = 'One session recorded (' + snaps[0].session + '). The chart draws once a second session lands.';
      } else {
        el.histNote.textContent = snaps.length + ' sessions, ' + snaps[0].session + ' → ' + snaps[snaps.length - 1].session +
          (snaps.length > 30 ? ' · table shows the latest 30.' : ' · all sessions shown.');
      }
    }
    if (el.histChart) {
      el.histChart.setAttribute('aria-label', snaps.length >= 2
        ? 'Portfolio value from ' + fmtRs(snaps[0].value) + ' on ' + snaps[0].session +
          ' to ' + fmtRs(snaps[snaps.length - 1].value) + ' on ' + snaps[snaps.length - 1].session +
          ' across ' + snaps.length + ' sessions'
        : 'Portfolio value over recorded sessions');
    }
    drawHistoryChart(snaps);
  }
  function nepseWindowReturn(d0, d1) {
    if (!benchDB || !benchDB.nepse) return null;
    var n0 = benchDB.nepse[d0], n1 = benchDB.nepse[d1];
    if (n0 == null || n1 == null || !(n0 > 0)) return null;
    return round2((n1 / n0 - 1) * 100);
  }
  function renderBench(p) {
    if (!el.bench) return;
    var snaps = snapshotsFor(p.id);
    if (!benchDB) {
      el.bench.innerHTML = '<p class="pf-muted">' +
        (benchFailed
          ? 'Benchmark data unavailable right now — snapshots still record, and the strip returns on the next successful load.'
          : 'Loading benchmark data…') + '</p>';
      if (el.benchNote) el.benchNote.textContent = '';
      return;
    }
    if (snaps.length < 2) {
      el.bench.innerHTML = '<p class="pf-muted">The benchmark strip needs two snapshots to form a window. Keep holding — it appears once a second session lands.</p>';
      if (el.benchNote) el.benchNote.textContent = 'Benchmark database as of ' + benchDB.asof + '.';
      return;
    }
    var d0 = snaps[0].session, d1 = snaps[snaps.length - 1].session;
    var pv0 = snaps[0].value, pv1 = snaps[snaps.length - 1].value;
    var pr = (pv0 > 0) ? round2((pv1 / pv0 - 1) * 100) : null;
    var nr = nepseWindowReturn(d0, d1);
    var maxAbs = Math.max(Math.abs(pr || 0), Math.abs(nr || 0));
    function bar(val, colorCls) {
      if (val == null) return '<span class="pf-bench-bar"></span>';
      var w = maxAbs > 0 ? Math.abs(val) / maxAbs * 50 : 0;
      var left = val >= 0 ? 50 : 50 - w;
      return '<span class="pf-bench-bar"><span class="pf-bench-fill ' + colorCls + '" style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></span></span>';
    }
    var verdict = '';
    if (pr != null && nr != null) {
      var diff = round2(pr - nr);
      verdict = '<p class="pf-bench-verdict ' + (diff > 0 ? 'beat' : diff < 0 ? 'trail' : '') + '">' +
        (diff > 0 ? 'Ahead of NEPSE by ' + fmtNum(diff, 2) + ' pp' :
         diff < 0 ? 'Behind NEPSE by ' + fmtNum(Math.abs(diff), 2) + ' pp' :
         'In line with NEPSE') + ' over this window.</p>';
    }
    el.bench.innerHTML =
      '<div class="pf-bench-row"><span class="pf-bench-name">Portfolio</span>' + bar(pr, 'portfolio') +
      '<span class="pf-bench-val ' + signedCls(pr) + '">' + fmtPct(pr) + '</span></div>' +
      '<div class="pf-bench-row"><span class="pf-bench-name">NEPSE</span>' + bar(nr, 'nepse') +
      '<span class="pf-bench-val ' + signedCls(nr) + '">' + fmtPct(nr) + '</span></div>' + verdict;
    if (el.benchNote) el.benchNote.textContent =
      'Window ' + d0 + ' → ' + d1 + ' · portfolio from snapshots, NEPSE closes from data/portfolio-benchmark.json (asof ' + benchDB.asof + ').' +
      (nr == null ? ' NEPSE closes missing for this window — showing –.' : '');
  }
  /* Holding window return: the holding's price at the first snapshot
     session comes from the published per-symbol history file (last bar on
     or before that date); the end price is the page's current batch price,
     the same basis as every other number on the page. Missing bars → '—',
     never invented. Fetches only for held symbols, cached in memory. */
  var histCache = {};
  function closeFromBars(bars, compact) {
    var close = null;
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (!Array.isArray(b) || b.length < 5) continue;
      if (String(b[0]) <= compact) close = +b[4];
      else break;
    }
    return (close != null && isFinite(close)) ? close : null;
  }
  function histCloseAtOrBefore(sym, isoDate) {
    var compact = isoDate.replace(/-/g, '');
    if (histCache[sym]) return Promise.resolve(closeFromBars(histCache[sym], compact));
    return fetch('/nepse-chart/data/history/' + sym + '.json').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      var bars = (j && Array.isArray(j.data)) ? j.data : null;
      if (bars) histCache[sym] = bars;
      return bars ? closeFromBars(bars, compact) : null;
    }).catch(function () { return null; });
  }
  function renderOutcomes(p) {
    if (!el.outTbody) return;
    var v = valuate(p);
    var snaps = snapshotsFor(p.id);
    var d0 = snaps.length ? snaps[0].session : null;
    var d1 = snaps.length ? snaps[snaps.length - 1].session : null;
    var nr = (d0 && d1) ? nepseWindowReturn(d0, d1) : null;
    if (!v.rows.length) {
      el.outTbody.innerHTML = '';
      return;
    }
    el.outTbody.innerHTML = v.rows.map(function (r) {
      var h = r.h;
      var costChip = r.ret == null ? '<span class="tnum">—</span>' :
        '<span class="pf-outcome ' + (r.ret > 0 ? 'win' : r.ret < 0 ? 'loss' : 'flat') + '">' +
        (r.ret > 0 ? 'Win' : r.ret < 0 ? 'Loss' : 'Flat') + '</span>';
      return '<tr data-out-sym="' + esc(h.s) + '">' +
        '<td><a class="pf-sym" href="/nepse-chart/?s=' + esc(h.s) + '">' + esc(h.s) + '</a></td>' +
        '<td class="tnum ' + signedCls(r.ret) + '">' + fmtPct(r.ret) + '</td>' +
        '<td class="tnum" data-win-val>…</td>' +
        '<td class="tnum">' + fmtPct(nr) + '</td>' +
        '<td>' + costChip + ' <span data-win-chip>…</span></td>' +
        '</tr>';
    }).join('');
    if (!d0 || nr == null) {
      el.outTbody.querySelectorAll('[data-win-val]').forEach(function (c) { c.textContent = '—'; });
      el.outTbody.querySelectorAll('[data-win-chip]').forEach(function (c) { c.textContent = '—'; });
      return;
    }
    v.rows.forEach(function (r) {
      var h = r.h;
      var row = el.outTbody.querySelector('tr[data-out-sym="' + h.s + '"]');
      if (!row) return;
      var valCell = row.querySelector('[data-win-val]');
      var chipCell = row.querySelector('[data-win-chip]');
      var endPrice = r.price;
      if (endPrice == null) {
        if (valCell) valCell.textContent = '—';
        if (chipCell) chipCell.textContent = '—';
        return;
      }
      histCloseAtOrBefore(h.s, d0).then(function (startPrice) {
        if (startPrice == null || !(startPrice > 0)) {
          if (valCell) valCell.textContent = '—';
          if (chipCell) chipCell.textContent = '—';
          return;
        }
        var wr = round2((endPrice / startPrice - 1) * 100);
        if (valCell) { valCell.textContent = fmtPct(wr); valCell.className = 'tnum ' + signedCls(wr); }
        if (chipCell) {
          chipCell.innerHTML = '<span class="pf-outcome ' + (wr > nr ? 'beat' : wr < nr ? 'trail' : 'flat') + '">' +
            (wr > nr ? 'Beat NEPSE' : wr < nr ? 'Trailed NEPSE' : 'In line') + '</span>';
        }
      });
    });
  }

  /* ================= events ================= */
  function on(id, evt, fn) {
    var n = document.getElementById(id);
    if (n) n.addEventListener(evt, fn);
  }
  if (el.select) el.select.addEventListener('change', function () {
    mutate(function (st) { st.active = el.select.value; });
  });

  /* Sector block controls: picker, pager, prefill (prefill only — never adds). */
  if (el.sectorSelect) el.sectorSelect.addEventListener('change', function () {
    sectorFilter = el.sectorSelect.value; sectorPage = 1; renderSector();
  });
  on('pf-sector-prev', 'click', function () { if (sectorPage > 1) { sectorPage--; renderSector(); } });
  on('pf-sector-next', 'click', function () { sectorPage++; renderSector(); });
  if (el.sectorTbody) el.sectorTbody.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-prefill]');
    if (!btn) return;
    prefillAdd(btn.getAttribute('data-prefill'), btn.getAttribute('data-price') || '');
  });

  on('pf-new', 'click', function () { barForm('new'); });
  on('pf-rename', 'click', function () { barForm('rename'); });
  on('pf-delete', 'click', function () {
    var st = load(); var p = getActive(st);
    if (!p) return;
    if (!window.confirm('Delete the portfolio "' + p.name + '"? Its holdings and sale history will be removed from this browser.')) return;
    mutate(function (st2) {
      st2.portfolios = st2.portfolios.filter(function (x) { return x.id !== p.id; });
      st2.snapshots = (st2.snapshots || []).filter(function (x) { return x.pid !== p.id; });
      if (!st2.portfolios.length) {
        var np = { id: uid(), name: 'My Portfolio', holdings: [], sells: [] };
        st2.portfolios.push(np); st2.active = np.id;
      } else if (st2.active === p.id) { st2.active = st2.portfolios[0].id; }
    }, 'Portfolio deleted.');
  });

  function barForm(mode) {
    var st = load(); var p = ensureDefault(st);
    if (mode === 'new') {
      el.barForm.innerHTML =
        '<label class="pf-inline">Name <input id="pf-bar-name" maxlength="60" placeholder="e.g. Long term" required></label>' +
        ' <button type="button" class="btn small" id="pf-bar-go">Create</button>' +
        ' <button type="button" class="pf-link" id="pf-bar-cancel">Cancel</button>';
      var inp = document.getElementById('pf-bar-name'); inp.focus();
      document.getElementById('pf-bar-go').addEventListener('click', function () {
        var name = inp.value.trim().slice(0, 60) || 'Portfolio';
        el.barForm.innerHTML = '';
        mutate(function (st2) {
          var np = { id: uid(), name: name, holdings: [], sells: [] };
          st2.portfolios.push(np); st2.active = np.id;
        }, 'Portfolio "' + name + '" created.');
      });
      document.getElementById('pf-bar-cancel').addEventListener('click', function () { el.barForm.innerHTML = ''; });
    } else {
      el.barForm.innerHTML =
        '<label class="pf-inline">Rename to <input id="pf-bar-name" maxlength="60" value="' + esc(p.name) + '" required></label>' +
        ' <button type="button" class="btn small" id="pf-bar-go">Save</button>' +
        ' <button type="button" class="pf-link" id="pf-bar-cancel">Cancel</button>';
      var inp2 = document.getElementById('pf-bar-name'); inp2.focus(); inp2.select();
      document.getElementById('pf-bar-go').addEventListener('click', function () {
        var name = inp2.value.trim().slice(0, 60);
        if (!name) { showHint('Give the portfolio a name.'); return; }
        el.barForm.innerHTML = '';
        mutate(function (st2, p2) { p2.name = name; }, 'Portfolio renamed.');
      });
      document.getElementById('pf-bar-cancel').addEventListener('click', function () { el.barForm.innerHTML = ''; });
    }
  }

  el.addBtn.addEventListener('click', function () {
    var sym = activeIdx > -1 && currentMatches[activeIdx] ? currentMatches[activeIdx].s : el.search.value;
    doAdd(sym, el.qty.value, el.price.value);
  });

  el.search.addEventListener('input', function () {
    activeIdx = -1;
    currentMatches = dataReady ? matches(el.search.value) : [];
    renderSuggest();
  });
  el.search.addEventListener('keydown', function (e) {
    if (el.suggest.hidden) {
      if (e.key === 'Enter') { e.preventDefault(); doAdd(el.search.value, el.qty.value, el.price.value); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, currentMatches.length - 1); renderSuggest(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, -1); renderSuggest(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      doAdd(activeIdx > -1 ? currentMatches[activeIdx].s : el.search.value, el.qty.value, el.price.value);
    }
    else if (e.key === 'Escape') closeSuggest();
  });
  el.suggest.addEventListener('click', function (e) {
    var li = e.target.closest('li[role="option"]');
    if (!li) return;
    var u = currentMatches[Number(li.id.replace('pf-opt-', ''))];
    if (u) { el.search.value = u.s; closeSuggest(); el.qty.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.pf-search-wrap')) closeSuggest();
  });

  /* holdings table actions (delegated; forms inside are re-rendered) */
  el.tbody.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (btn) {
      var sym = btn.getAttribute('data-sym'), act = btn.getAttribute('data-act');
      if (act === 'remove') {
        if (!window.confirm('Remove ' + sym + ' from this portfolio? Recorded sales are kept.')) return;
        mutate(function (st, p) {
          p.holdings = p.holdings.filter(function (h) { return h.s !== sym; });
        }, sym + ' removed.');
        return;
      }
      editor = { mode: act, sym: sym };
      renderAll();
      var f = document.getElementById(act === 'sell' ? 'pf-sell-form' : 'pf-edit-form');
      if (f) { var i = f.querySelector('input'); if (i) i.focus(); }
      return;
    }
    if (e.target.closest('[data-cancel]')) { editor = null; renderAll(); }
  });

  el.tbody.addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var sym = form.getAttribute('data-sym');
    if (form.id === 'pf-sell-form') {
      var sq = +document.getElementById('pf-sell-qty').value;
      var sp = +document.getElementById('pf-sell-price').value;
      var dt = document.getElementById('pf-sell-date').value || todayISO();
      if (!(sq > 0)) { showHint('Sale quantity must be more than zero.'); return; }
      if (!(sp > 0)) { showHint('Sell price must be more than zero.'); return; }
      mutate(function (st, p) {
        var h = null;
        p.holdings.forEach(function (x) { if (x.s === sym) h = x; });
        if (!h) return false;
        if (sq > h.qty) { showHint('You only hold ' + fmtNum(h.qty, 2) + ' ' + sym + '.'); return false; }
        var r = Calc.sell(h.qty, h.cost, sq, sp);
        p.sells.push({ s: sym, qty: round2(sq), price: round2(sp), cost: h.cost, date: dt, realized: r.realized });
        if (r.qty === 0) p.holdings = p.holdings.filter(function (x) { return x.s !== sym; });
        else h.qty = r.qty;
        showHint('Sale recorded: ' + fmtNum(sq, 2) + ' ' + sym + ' @ ' + fmtRs(sp) +
          '. Realized P&L ' + fmtRs(r.realized) + '.');
      });
    } else if (form.id === 'pf-edit-form') {
      var eq = +document.getElementById('pf-edit-qty').value;
      var ec = +document.getElementById('pf-edit-cost').value;
      if (!(eq > 0) || !(ec > 0)) { showHint('Quantity and avg cost must be more than zero.'); return; }
      mutate(function (st, p) {
        p.holdings.forEach(function (x) { if (x.s === sym) { x.qty = round2(eq); x.cost = round2(ec); } });
      }, sym + ' updated.');
    }
  });

  var printBtn = document.getElementById('pf-print');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  onChange(renderAll);
  renderAll();
  loadData(false);
  loadBench(false).then(function () { renderAll(); });
})();
