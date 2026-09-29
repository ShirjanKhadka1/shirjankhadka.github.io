/* NEPSE Alpha Lab: browser-local portfolio tracker.
 *
 * Unlimited named portfolios, holdings with weighted-average cost, and
 * realized P&L on recorded sells. Everything lives in this browser only,
 * under the 'nl_portfolios_v1' localStorage key. No login, no server,
 * nothing syncs anywhere.
 *
 * Valuation prices come from the daily market batch
 * (/nepse-chart/data/verdicts.json). A holding without a price in the batch
 * shows '–' and is excluded from value math; figures are never invented.
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
  function blank() { return { version: 1, active: null, portfolios: [] }; }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      var st = {
        version: 1,
        active: (d && typeof d.active === 'string') ? d.active : null,
        portfolios: []
      };
      (d && Array.isArray(d.portfolios) ? d.portfolios : []).forEach(function (p) {
        var c = cleanPortfolio(p); if (c) st.portfolios.push(c);
      });
      return st;
    } catch (e) { return blank(); }
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
    updated: $('pf-updated'), barForm: $('pf-bar-form')
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    return Number(x).toLocaleString('en-US', {
      minimumFractionDigits: d || 0, maximumFractionDigits: d || 0
    });
  }
  function fmtRs(x) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    return 'Rs ' + fmtNum(x, 2);
  }
  function fmtPct(x) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
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
        h: h, price: price, ch: ch, sec: vd.sec || 'Unclassified',
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

  function renderHoldings(v) {
    if (!v.rows.length) {
      el.holdWrap.hidden = true;
      el.empty.hidden = false;
      return;
    }
    el.holdWrap.hidden = false;
    el.empty.hidden = true;
    var html = v.rows.map(function (r) {
      var h = r.h, m = metaFor(h.s);
      var dayHtml = r.ch == null
        ? '<span class="tnum">–</span>'
        : '<span class="tnum ' + signedCls(r.ch) + '">' + fmtPct(r.ch) + '</span>';
      var unHtml = r.unrl == null
        ? '<span class="tnum">–</span>'
        : '<span class="tnum ' + signedCls(r.unrl) + '">' + fmtRs(r.unrl) + '<br><small>' + fmtPct(r.ret) + '</small></span>';
      return '<tr>' +
        '<td><a class="pf-sym" href="/nepse-chart/?s=' + esc(h.s) + '">' + esc(h.s) + '</a>' +
        '<span class="pf-name">' + esc(m ? m.n : '') + '</span></td>' +
        '<td class="tnum">' + fmtNum(h.qty, 2) + '</td>' +
        '<td class="tnum">' + fmtRs(h.cost) + '</td>' +
        '<td class="tnum">' + (r.price == null ? '–' : fmtRs(r.price)) + '</td>' +
        '<td>' + dayHtml + '</td>' +
        '<td class="tnum">' + (r.value == null ? '–' : fmtRs(r.value)) + '</td>' +
        '<td>' + unHtml + '</td>' +
        '<td class="pf-actcol"><button type="button" class="pf-mini" data-act="sell" data-sym="' + esc(h.s) + '">Sell</button>' +
        '<button type="button" class="pf-mini" data-act="edit" data-sym="' + esc(h.s) + '">Edit</button>' +
        '<button type="button" class="pf-mini danger" data-act="remove" data-sym="' + esc(h.s) + '">Remove</button></td>' +
        '</tr>' + editorRow(r, 8);
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

  var DONUT_COLORS = ['#1E6B4A', '#C6A86B', '#14382A', '#1E7A44', '#B23A2E', '#8A8F7E', '#2E5E4E', '#D9C08F'];

  function drawDonut(cv, items, total) {
    if (!cv || !cv.getContext) return;
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
      ctx.fillStyle = DONUT_COLORS[i % DONUT_COLORS.length];
      ctx.fill();
      a += frac * Math.PI * 2;
    }
    ctx.fillStyle = '#66705F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillText('TOTAL VALUE', cx, cy - 13);
    ctx.fillStyle = '#0C1F16';
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
    var legend = top.map(function (it, i) {
      var pct = Calc.pctOf(it.value, total);
      return '<li><i style="background:' + DONUT_COLORS[i % DONUT_COLORS.length] + '"></i>' +
        '<span class="pf-dl-sym">' + esc(it.label) + '</span>' +
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
      return '<tr><td class="tnum">' + esc(s.date || '–') + '</td>' +
        '<td><a class="pf-sym" href="/nepse-chart/?s=' + esc(s.s) + '">' + esc(s.s) + '</a></td>' +
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
    if (!dataReady) {
      el.summary.innerHTML = '<p class="pf-muted">Loading market data…</p>';
      return;
    }
    var v = valuate(p);
    renderSummary(v, p);
    renderHoldings(v);
    renderAlloc(v);
    renderAnalytics(v);
    renderSells(p);
    if (el.updated && dataAsof) {
      el.updated.innerHTML = 'Prices as of ' + esc(dataAsof) + '. ' +
        (window.NepseFresh ? NepseFresh.badge(dataAsof) : '');
    }
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
        '<strong>' + esc(u.s) + '</strong><span>' + esc(u.n) + '</span></li>';
    }).join('');
    el.suggest.hidden = false;
    el.search.setAttribute('aria-expanded', 'true');
  }
  function closeSuggest() {
    el.suggest.hidden = true; el.suggest.innerHTML = '';
    el.search.setAttribute('aria-expanded', 'false');
    activeIdx = -1; currentMatches = [];
  }

  /* ================= data ================= */
  function loadData() {
    Promise.all([
      fetch('/nepse-chart/data/universe.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/nepse-chart/data/verdicts.json').then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (res) {
      var u = res[0], vd = res[1];
      if (u && Array.isArray(u.symbols)) universe = u.symbols;
      if (vd && vd.verdicts) { verdicts = vd.verdicts; dataAsof = vd.asof || ''; }
      dataReady = true;
      renderAll();
    }).catch(function () {
      dataReady = false;
      el.summary.innerHTML = '<p class="pf-muted">Could not load market data. Your saved portfolios are safe in this browser; please try again later.</p>';
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

  /* ================= events ================= */
  el.select.addEventListener('change', function () {
    mutate(function (st) { st.active = el.select.value; });
  });

  document.getElementById('pf-new').addEventListener('click', function () { barForm('new'); });
  document.getElementById('pf-rename').addEventListener('click', function () { barForm('rename'); });
  document.getElementById('pf-delete').addEventListener('click', function () {
    var st = load(); var p = getActive(st);
    if (!p) return;
    if (!window.confirm('Delete the portfolio "' + p.name + '"? Its holdings and sale history will be removed from this browser.')) return;
    mutate(function (st2) {
      st2.portfolios = st2.portfolios.filter(function (x) { return x.id !== p.id; });
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
  loadData();
})();
