/* Nepse Decode calculators — pure client-side math on the verified schedule:
   commission slabs 0.36/0.33/0.31/0.27/0.24% (min Rs 10), SEBON 0.015%/side,
   DP Rs 25/scrip/side, CGT 5% (<=365d) / 3.75% (>365d) on the net gain —
   MoF notice, Nepal Gazette 31 Bhadra 2083 (16 Sep 2026). */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : 0; }
  function rs(v) { return 'Rs ' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function commission(amount) {
    var slabs = [[50000, 0.0036], [500000, 0.0033], [2000000, 0.0031], [10000000, 0.0027], [Infinity, 0.0024]];
    for (var i = 0; i < slabs.length; i++) if (amount <= slabs[i][0]) return Math.max(10, amount * slabs[i][1]);
    return amount * 0.0024;
  }
  function side(amount) {
    var c = commission(amount), s = amount * 0.00015;
    return { amount: amount, commission: c, sebon: s, dp: 25, charges: c + s + 25 };
  }
  function stat(label, value, cls) {
    return '<div class="cx-stat ' + (cls || '') + '"><div class="cx-stat-v">' + value + '</div><div class="cx-stat-l">' + label + '</div></div>';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function chgStr(ch) {
    if (!isFinite(ch)) return '—';
    var v = Number(ch);
    return '<span class="' + (v > 0 ? 'calc-up' : v < 0 ? 'calc-down' : '') + '">' + (v > 0 ? '+' : '') + v.toFixed(2) + '%</span>';
  }
  /* Latest computed run per calculator, for the history recorder. */
  var lastOut = { share: null, wacc: null, sip: null, adj: null };

  /* ---------- share calculator ---------- */
  var longHold = false;
  function shareCalc() {
    var q = num('scQty'), bp = num('scBuy'), sp = num('scSell');
    var buy = side(q * bp), sell = side(q * sp);
    var totalCost = buy.amount + buy.charges;
    var proceeds = sell.amount - sell.charges;
    var gain = proceeds - totalCost;
    var rate = longHold ? 0.0375 : 0.05;
    var cgt = gain > 0 ? gain * rate : 0;
    var netProfit = gain - cgt;
    var ret = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;
    $('scStats').innerHTML =
      stat('Total cost of buying', rs(totalCost)) +
      stat('Net sale proceeds', rs(proceeds)) +
      stat('Capital gain', rs(gain), gain >= 0 ? 'up' : 'down') +
      stat('CGT payable (' + (longHold ? '3.75%' : '5%') + ')', rs(cgt)) +
      stat('Net profit after tax', rs(netProfit), netProfit >= 0 ? 'up' : 'down') +
      stat('Return on cost', ret.toFixed(2) + '%', ret >= 0 ? 'up' : 'down');
    function row(name, b, s) {
      return '<tr><td>' + name + '</td><td class="num">' + rs(b) + '</td><td class="num">' + rs(s) + '</td></tr>';
    }
    $('scTable').innerHTML = '<thead><tr><th></th><th class="num">Buy side</th><th class="num">Sell side</th></tr></thead><tbody>' +
      row('Trade amount', buy.amount, sell.amount) +
      row('Broker commission', buy.commission, sell.commission) +
      row('SEBON fee (0.015%)', buy.sebon, sell.sebon) +
      row('DP charge', buy.dp, sell.dp) +
      '<tr><td><strong>' + (q && bp ? 'You pay ' + rs(totalCost) + ' to buy' : 'Total') + '</strong></td>' +
      '<td class="num"><strong>' + rs(totalCost) + '</strong></td>' +
      '<td class="num"><strong>' + rs(proceeds) + ' before CGT</strong></td></tr></tbody>';
    $('scNote').textContent = gain > 0
      ? 'Cost per share including buy-side charges: ' + rs(q ? totalCost / q : 0) + '. CGT is charged on the net gain only — sell proceeds after charges, minus the fee-inclusive buying cost.'
      : 'No capital gains tax on a loss. Cost per share including buy-side charges: ' + rs(q ? totalCost / q : 0) + '.';
    /* Check line: the identity recomputed from scratch, not copied. */
    var b2 = side(q * bp), s2 = side(q * sp);
    var cost2 = b2.amount + b2.charges, proc2 = s2.amount - s2.charges;
    var gain2 = proc2 - cost2, cgt2 = gain2 > 0 ? gain2 * rate : 0, net2 = gain2 - cgt2;
    var ok = Math.abs(net2 - netProfit) < 0.005;
    $('scCheck').innerHTML = 'Check: <strong>' + rs(proc2) + '</strong> proceeds − <strong>' + rs(cost2) +
      '</strong> buying cost − <strong>' + rs(cgt2) + '</strong> CGT = <strong>' + rs(net2) + '</strong> net profit ' +
      '<span class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ reconciles' : '⚠ mismatch') + '</span>';
    lastOut.share = { inputs: { q: q, bp: bp, sp: sp, long: longHold },
      outputs: { cost: totalCost, proceeds: proceeds, gain: gain, cgt: cgt, net: netProfit, ret: ret },
      title: 'Share · ' + q + ' @ ' + rs(bp) + ' → ' + rs(sp),
      detail: 'Cost ' + rs(totalCost) + ' · Proceeds ' + rs(proceeds) + ' · CGT ' + rs(cgt) + ' · Net ' + rs(netProfit) + ' (' + ret.toFixed(2) + '%)' };
  }
  ['scQty', 'scBuy', 'scSell'].forEach(function (id) { $(id).addEventListener('input', shareCalc); });
  $('holdShort').addEventListener('click', function () { longHold = false; $('holdShort').setAttribute('aria-pressed', 'true'); $('holdLong').setAttribute('aria-pressed', 'false'); shareCalc(); });
  $('holdLong').addEventListener('click', function () { longHold = true; $('holdLong').setAttribute('aria-pressed', 'true'); $('holdShort').setAttribute('aria-pressed', 'false'); shareCalc(); });
  shareCalc();

  /* ---------- WACC ---------- */
  var lotsEl = $('waccLots');
  function addLot(q, p) {
    var row = document.createElement('div');
    row.className = 'lot-row';
    row.innerHTML = '<div class="fld"><label>Quantity</label><input type="number" min="0" step="1" class="lot-q" value="' + (q || 100) + '"></div>' +
      '<div class="fld"><label>Buy price (Rs)</label><input type="number" min="0" step="0.01" class="lot-p" value="' + (p || 500) + '"></div>' +
      '<button type="button" class="cx-btn quiet lot-x" aria-label="Remove lot">Remove</button>';
    row.querySelector('.lot-x').addEventListener('click', function () { row.remove(); wacc(); });
    row.querySelectorAll('input').forEach(function (i) { i.addEventListener('input', wacc); });
    lotsEl.appendChild(row);
  }
  function wacc() {
    var tq = 0, tc = 0, lots = [];
    lotsEl.querySelectorAll('.lot-row').forEach(function (row) {
      var q = parseFloat(row.querySelector('.lot-q').value) || 0;
      var p = parseFloat(row.querySelector('.lot-p').value) || 0;
      if (q > 0 && p > 0) { var s = side(q * p); tq += q; tc += s.amount + s.charges; lots.push({ q: q, p: p, s: s }); }
    });
    $('waccStats').innerHTML =
      stat('Total shares', tq.toLocaleString('en-IN')) +
      stat('Total cost incl. charges', rs(tc)) +
      stat('Weighted average cost / share', tq ? rs(tc / tq) : 'Rs 0.00');
    /* Lot table + reconciliation: the table's own sums must equal the stats. */
    var rows = '', sq = 0, st = 0;
    lots.forEach(function (L, i) {
      var tot = L.s.amount + L.s.charges; sq += L.q; st += tot;
      rows += '<tr><td>Lot ' + (i + 1) + '</td><td class="num">' + L.q + '</td><td class="num">' + rs(L.p) +
        '</td><td class="num">' + rs(L.s.amount) + '</td><td class="num">' + rs(L.s.commission) +
        '</td><td class="num">' + rs(L.s.sebon) + '</td><td class="num">' + rs(L.s.dp) +
        '</td><td class="num">' + rs(tot) + '</td></tr>';
    });
    $('waccTable').innerHTML = '<thead><tr><th></th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th>' +
      '<th class="num">Commission</th><th class="num">SEBON</th><th class="num">DP</th><th class="num">Lot total</th></tr></thead><tbody>' + rows +
      '<tr><td><strong>Total</strong></td><td class="num"><strong>' + sq + '</strong></td><td></td><td></td><td></td><td></td><td></td>' +
      '<td class="num"><strong>' + rs(st) + '</strong></td></tr></tbody>';
    var ok = sq === tq && Math.abs(st - tc) < 0.005;
    $('waccCheck').innerHTML = 'Check: table sums <strong>' + sq + ' shares · ' + rs(st) + '</strong> against stats <strong>' +
      tq + ' shares · ' + rs(tc) + '</strong> ' +
      '<span class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ reconciles' : '⚠ mismatch') + '</span>' +
      (lots.length ? ' · Weighted average proof: ' + rs(tc) + ' ÷ ' + tq + ' = ' + rs(tq ? tc / tq : 0) + ' / share.' : '');
    lastOut.wacc = { inputs: { lots: lots.map(function (L) { return { q: L.q, p: L.p }; }) },
      outputs: { shares: tq, cost: tc, avg: tq ? tc / tq : 0 },
      title: 'WACC · ' + lots.length + ' lot' + (lots.length === 1 ? '' : 's') + ' · ' + tq + ' shares',
      detail: 'Total cost ' + rs(tc) + ' · Average ' + rs(tq ? tc / tq : 0) + ' / share' };
  }
  $('waccAdd').addEventListener('click', function () { addLot(100, 500); wacc(); });
  addLot(100, 500); addLot(50, 650); wacc();

  /* ---------- SIP ---------- */
  function sip() {
    var m = num('sipAmt'), yrs = Math.min(40, Math.max(0, num('sipYrs'))), r = num('sipRet') / 100 / 12;
    var invested = m * 12 * yrs, fv = 0, rows = '';
    for (var y = 1; y <= yrs; y++) {
      for (var k = 0; k < 12; k++) fv = (fv + m) * (1 + r);
      rows += '<tr><td>Year ' + y + '</td><td class="num">' + rs(m * 12 * y) + '</td><td class="num">' + rs(fv) + '</td></tr>';
    }
    $('sipStats').innerHTML =
      stat('Total invested', rs(invested)) +
      stat('Projected value', rs(fv)) +
      stat('Projected gain', rs(fv - invested), 'up');
    $('sipTable').innerHTML = '<thead><tr><th></th><th class="num">Invested so far</th><th class="num">Projected value</th></tr></thead><tbody>' + rows + '</tbody>';
    /* Check line: the month-by-month loop against the closed-form annuity-due
       value — two different float paths that must agree to the paisa. */
    var n = 12 * yrs, closed = r === 0 ? invested : m * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
    var diff = Math.abs(closed - fv), tol = Math.max(0.01, 1e-9 * Math.abs(fv));
    var ok = diff <= tol;
    $('sipCheck').innerHTML = 'Check: schedule loop <strong>' + rs(fv) + '</strong> vs closed-form <strong>' + rs(closed) +
      '</strong> (diff ' + rs(diff) + ') <span class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ reconciles' : '⚠ mismatch') +
      '</span> · Final schedule row = projected value; invested column final = total invested.';
    lastOut.sip = { inputs: { m: m, yrs: yrs, ret: num('sipRet') },
      outputs: { invested: invested, fv: fv, gain: fv - invested },
      title: 'SIP · ' + rs(m) + '/mo · ' + yrs + ' yrs @ ' + num('sipRet') + '%',
      detail: 'Invested ' + rs(invested) + ' · Projected ' + rs(fv) + ' · Gain ' + rs(fv - invested) };
  }
  ['sipAmt', 'sipYrs', 'sipRet'].forEach(function (id) { $(id).addEventListener('input', sip); });
  sip();

  /* ---------- price adjustment ---------- */
  function adj() {
    var price = num('adjPrice'), b = num('adjBonus') / 100, r = num('adjRight') / 100, face = num('adjFace');
    $('adjStats').innerHTML =
      stat('After ' + num('adjBonus') + '% bonus', b > 0 ? rs(price / (1 + b)) : '—') +
      stat('After ' + num('adjRight') + '% right', r > 0 ? rs((price + face * r) / (1 + r)) : '—');
    /* Check line: the formulas with this run's values substituted. */
    var parts = [];
    if (b > 0) parts.push('Bonus: ' + rs(price) + ' ÷ (1 + ' + num('adjBonus') + '%) = <strong>' + rs(price / (1 + b)) + '</strong>');
    if (r > 0) parts.push('Right: (' + rs(price) + ' + ' + rs(face) + ' × ' + num('adjRight') + '%) ÷ (1 + ' + num('adjRight') + '%) = <strong>' + rs((price + face * r) / (1 + r)) + '</strong>');
    $('adjCheck').innerHTML = parts.length ? 'Check: ' + parts.join(' · ') : 'Enter a bonus or right percentage to see the adjusted price.';
    lastOut.adj = { inputs: { price: price, bonus: num('adjBonus'), right: num('adjRight'), face: face },
      outputs: { bonusAdj: b > 0 ? price / (1 + b) : null, rightAdj: r > 0 ? (price + face * r) / (1 + r) : null },
      title: 'Adjustment · ' + rs(price) + ' · ' + num('adjBonus') + '% bonus · ' + num('adjRight') + '% right',
      detail: 'After bonus ' + (b > 0 ? rs(price / (1 + b)) : '—') + ' · After right ' + (r > 0 ? rs((price + face * r) / (1 + r)) : '—') };
  }
  ['adjPrice', 'adjBonus', 'adjRight', 'adjFace'].forEach(function (id) { $(id).addEventListener('input', adj); });
  adj();

  /* ---------- history (browser-local only — nothing leaves this browser) ---------- */
  var HKEY = 'nl_calc_history_v1', HCAP = 100, timers = {};
  function loadHist() { try { var j = JSON.parse(localStorage.getItem(HKEY) || '[]'); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
  function saveHist(h) { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) {} }
  function histTime(t) { try { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return t; } }
  function scheduleRecord(calc) {
    if (timers[calc]) clearTimeout(timers[calc]);
    timers[calc] = setTimeout(function () {
      var entry = lastOut[calc]; if (!entry) return;
      var h = loadHist();
      var top = h[0];
      if (top && top.calc === calc && JSON.stringify(top.inputs) === JSON.stringify(entry.inputs)) return;
      h.unshift({ id: Date.now() + '' + Math.floor(Math.random() * 1000), calc: calc, t: new Date().toISOString(), inputs: entry.inputs, outputs: entry.outputs });
      saveHist(h.slice(0, HCAP)); renderHistory();
    }, 800);
  }
  function renderHistory() {
    var h = loadHist(), agg = $('calcHistAgg'), list = $('calcHistList'), empty = $('calcHistEmpty');
    if (!h.length) { agg.textContent = ''; list.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    var counts = { share: 0, wacc: 0, sip: 0, adj: 0 };
    h.forEach(function (e) { if (counts[e.calc] !== undefined) counts[e.calc]++; });
    var names = { share: 'Share', wacc: 'WACC', sip: 'SIP', adj: 'Adjustment' };
    agg.innerHTML = '<span><strong>' + h.length + '</strong> saved</span>' +
      Object.keys(counts).map(function (k) { return '<span>' + names[k] + ' <strong>' + counts[k] + '</strong></span>'; }).join('') +
      '<span>Most recent: <strong>' + esc(histTime(h[0].t)) + '</strong></span>';
    list.innerHTML = h.map(function (e) {
      var sum = e.calc === 'share' ? 'Qty ' + e.inputs.q + ' · Buy ' + rs(e.inputs.bp) + ' · Sell ' + rs(e.inputs.sp) + ' · ' + (e.inputs.long ? 'long hold' : 'short hold') + ' · Net ' + rs(e.outputs.net)
        : e.calc === 'wacc' ? e.inputs.lots.map(function (L) { return L.q + '@' + rs(L.p); }).join(', ') + ' · Avg ' + rs(e.outputs.avg)
        : e.calc === 'sip' ? rs(e.inputs.m) + '/mo · ' + e.inputs.yrs + ' yrs @ ' + e.inputs.ret + '% · Projected ' + rs(e.outputs.fv)
        : rs(e.inputs.price) + ' · ' + e.inputs.bonus + '% bonus · ' + e.inputs.right + '% right · After bonus ' + (e.outputs.bonusAdj !== null ? rs(e.outputs.bonusAdj) : '—') + ' · After right ' + (e.outputs.rightAdj !== null ? rs(e.outputs.rightAdj) : '—');
      return '<div class="calc-hist-entry"><div class="calc-hist-main"><div class="calc-hist-title">' + esc(names[e.calc]) + '</div>' +
        '<div class="calc-hist-meta">' + esc(histTime(e.t)) + '</div><div class="calc-hist-detail">' + esc(sum) + '</div></div>' +
        '<div class="calc-hist-actions"><button type="button" class="cx-btn quiet" data-recall="' + esc(e.id) + '">Recall</button>' +
        '<button type="button" class="cx-btn danger" data-del="' + esc(e.id) + '">Delete</button></div></div>';
    }).join('');
    list.querySelectorAll('[data-recall]').forEach(function (btn) { btn.addEventListener('click', function () { recallEntry(btn.getAttribute('data-recall')); }); });
    list.querySelectorAll('[data-del]').forEach(function (btn) { btn.addEventListener('click', function () { saveHist(loadHist().filter(function (e) { return e.id !== btn.getAttribute('data-del'); })); renderHistory(); }); });
  }
  function scrollToId(id) {
    var el = $(id); if (!el) return;
    var smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }
  function recallEntry(id) {
    var e = loadHist().filter(function (x) { return x.id === id; })[0]; if (!e) return;
    if (e.calc === 'share') {
      $('scQty').value = e.inputs.q; $('scBuy').value = e.inputs.bp; $('scSell').value = e.inputs.sp;
      longHold = !!e.inputs.long;
      $('holdShort').setAttribute('aria-pressed', longHold ? 'false' : 'true');
      $('holdLong').setAttribute('aria-pressed', longHold ? 'true' : 'false');
      shareCalc(); scrollToId('scQty');
    } else if (e.calc === 'wacc') {
      lotsEl.innerHTML = '';
      e.inputs.lots.forEach(function (L) { addLot(L.q, L.p); });
      wacc(); scrollToId('waccLots');
    } else if (e.calc === 'sip') {
      $('sipAmt').value = e.inputs.m; $('sipYrs').value = e.inputs.yrs; $('sipRet').value = e.inputs.ret;
      sip(); scrollToId('sipAmt');
    } else if (e.calc === 'adj') {
      $('adjPrice').value = e.inputs.price; $('adjBonus').value = e.inputs.bonus; $('adjRight').value = e.inputs.right; $('adjFace').value = e.inputs.face;
      adj(); scrollToId('adjPrice');
    }
  }
  var clearArmed = false, clearTimer = null;
  $('calcHistClear').addEventListener('click', function () {
    var btn = $('calcHistClear');
    if (!clearArmed) {
      clearArmed = true; btn.textContent = 'Click again to confirm clear';
      clearTimer = setTimeout(function () { clearArmed = false; btn.textContent = 'Clear all history'; }, 3000);
      return;
    }
    clearTimeout(clearTimer); clearArmed = false; btn.textContent = 'Clear all history';
    saveHist([]); renderHistory();
  });
  /* Record only on real user gestures: page-load runs schedule nothing. */
  document.addEventListener('input', function (ev) {
    var sec = ev.target.closest ? ev.target.closest('[data-calc]') : null;
    if (sec) scheduleRecord(sec.getAttribute('data-calc'));
  });
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('#holdShort,#holdLong')) scheduleRecord('share');
    if (ev.target.closest && ev.target.closest('#waccAdd,.lot-x')) scheduleRecord('wacc');
  });
  renderHistory();

  /* ---------- sector picker (read-only site data; never user inputs) ---------- */
  var VERD = '/nepse-chart/data/verdicts.json', PAGE_SIZE = 25;
  var sectors = {}, batchAsof = null, lastGoodAsof = null, curSec = '', curPage = 1, refreshTimer = null;
  function nptParts() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
      var o = {}; parts.forEach(function (p) { o[p.type] = p.value; }); return o;
    } catch (e) { return { weekday: 'Mon', hour: '12' }; }
  }
  function nptClock() {
    try { return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' }) + ' NPT'; }
    catch (e) { return ''; }
  }
  function cadenceMin() {
    var p = nptParts(), wd = p.weekday, h = parseInt(p.hour, 10);
    if (wd === 'Sat' || wd === 'Sun') return 120;
    if (h >= 11 && h < 15) return 15;
    return 30;
  }
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (document.hidden) return; /* re-armed by visibilitychange */
    refreshTimer = setTimeout(function () { if (!document.hidden) refreshPicker(); scheduleRefresh(); }, cadenceMin() * 60000);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshPicker(); scheduleRefresh(); } });
  function median(vals) {
    if (!vals.length) return null;
    var s = vals.slice().sort(function (a, b) { return a - b; });
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }
  function renderBlock() {
    var block = $('calcSectorBlock'), empty = $('calcSectorEmpty');
    if (!curSec || !sectors[curSec]) { block.hidden = true; empty.hidden = false; return; }
    empty.hidden = true; block.hidden = false;
    var rows = sectors[curSec], pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (curPage > pages) curPage = pages;
    var slice = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
    var med = median(rows.map(function (r) { return r.ch; }).filter(function (v) { return isFinite(v); }));
    $('calcSectorSummary').innerHTML = '<span><strong>' + rows.length + '</strong> stocks in ' + esc(curSec) + '</span>' +
      '<span>Median day change: <strong>' + (med === null ? 'n/a' : (med > 0 ? '+' : '') + med.toFixed(2) + '%') + '</strong></span>' +
      '<span>Batch: <strong>' + esc(batchAsof || '—') + '</strong></span>';
    $('calcSectorTable').innerHTML = '<thead><tr><th>Symbol</th><th class="num">Close</th><th class="num">Day change</th><th>As of</th><th></th></tr></thead><tbody>' +
      slice.map(function (r) {
        return '<tr><td class="sym">' + esc(r.sym) + '</td><td class="num">' + rs(r.p) + '</td><td class="num">' + chgStr(r.ch) +
          '</td><td>' + esc(r.asof) + '</td><td><button type="button" class="cx-btn quiet calc-rowbtn" data-share="' + esc(r.sym) + '">→ Share</button> ' +
          '<button type="button" class="cx-btn quiet calc-rowbtn" data-wacc="' + esc(r.sym) + '">→ WACC lot</button></td></tr>';
      }).join('') + '</tbody>';
    $('calcSectorTable').querySelectorAll('[data-share]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = rows.filter(function (x) { return x.sym === btn.getAttribute('data-share'); })[0]; if (!r) return;
        $('scBuy').value = r.p; $('scSell').value = r.p; shareCalc(); scrollToId('scBuy');
      });
    });
    $('calcSectorTable').querySelectorAll('[data-wacc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = rows.filter(function (x) { return x.sym === btn.getAttribute('data-wacc'); })[0]; if (!r) return;
        addLot(100, r.p); wacc(); scrollToId('waccLots');
      });
    });
    var from = (curPage - 1) * PAGE_SIZE + 1, to = Math.min(curPage * PAGE_SIZE, rows.length);
    $('calcSecShowing').textContent = 'Showing ' + from + '–' + to + ' of ' + rows.length + ' stocks in ' + curSec;
    $('calcSecPrev').disabled = curPage <= 1;
    $('calcSecNext').disabled = curPage >= pages;
  }
  $('calcSecPrev').addEventListener('click', function () { if (curPage > 1) { curPage--; renderBlock(); } });
  $('calcSecNext').addEventListener('click', function () { curPage++; renderBlock(); });
  $('calcSecClear').addEventListener('click', function () { $('calcSector').value = ''; curSec = ''; curPage = 1; renderBlock(); });
  $('calcSector').addEventListener('change', function () { curSec = $('calcSector').value; curPage = 1; renderBlock(); });
  function refreshPicker() {
    return fetch(VERD, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (d) {
      var v = d.verdicts || {};
      var built = {}, count = 0;
      Object.keys(v).forEach(function (sym) {
        var row = v[sym]; if (!row || !isFinite(row.p)) return;
        var sec = row.sec || 'Others';
        if (!built[sec]) built[sec] = [];
        built[sec].push({ sym: sym, p: row.p, ch: row.ch, asof: row.asof || d.asof || '—' });
        count++;
      });
      Object.keys(built).forEach(function (sec) { built[sec].sort(function (a, b) { return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0; }); });
      var changed = d.asof !== batchAsof;
      sectors = built; batchAsof = d.asof || batchAsof; lastGoodAsof = batchAsof;
      var sel = $('calcSector'), keep = sel.value;
      sel.innerHTML = '<option value="">Choose a sector…</option>' +
        Object.keys(built).sort().map(function (sec) { return '<option value="' + esc(sec) + '">' + esc(sec) + ' (' + built[sec].length + ')</option>'; }).join('');
      if (keep && built[keep]) { sel.value = keep; curSec = keep; }
      if (changed) curPage = 1;
      renderBlock();
      $('calcFreshLine').textContent = 'Batch ' + (batchAsof || '—') + ' · ' + count + ' stocks · last refresh check ' + nptClock();
    }).catch(function () {
      $('calcFreshLine').innerHTML = '<span class="bad">Check failed — showing last loaded batch</span> · last good ' + (lastGoodAsof || '—') + ' · last refresh check ' + nptClock();
      if (!batchAsof) $('calcSectorEmpty').textContent = 'Sector data unavailable — check your connection and reload.';
    });
  }
  refreshPicker(); scheduleRefresh();
})();
