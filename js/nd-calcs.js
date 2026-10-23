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
      '<button type="button" class="cx-btn lot-x" aria-label="Remove lot">Remove</button>';
    row.querySelector('.lot-x').addEventListener('click', function () { row.remove(); wacc(); });
    row.querySelectorAll('input').forEach(function (i) { i.addEventListener('input', wacc); });
    lotsEl.appendChild(row);
  }
  function wacc() {
    var tq = 0, tc = 0;
    lotsEl.querySelectorAll('.lot-row').forEach(function (row) {
      var q = parseFloat(row.querySelector('.lot-q').value) || 0;
      var p = parseFloat(row.querySelector('.lot-p').value) || 0;
      if (q > 0 && p > 0) { var s = side(q * p); tq += q; tc += s.amount + s.charges; }
    });
    $('waccStats').innerHTML =
      stat('Total shares', tq.toLocaleString('en-IN')) +
      stat('Total cost incl. charges', rs(tc)) +
      stat('Weighted average cost / share', tq ? rs(tc / tq) : 'Rs 0.00');
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
  }
  ['sipAmt', 'sipYrs', 'sipRet'].forEach(function (id) { $(id).addEventListener('input', sip); });
  sip();

  /* ---------- price adjustment ---------- */
  function adj() {
    var price = num('adjPrice'), b = num('adjBonus') / 100, r = num('adjRight') / 100, face = num('adjFace');
    $('adjStats').innerHTML =
      stat('After ' + num('adjBonus') + '% bonus', b > 0 ? rs(price / (1 + b)) : '—') +
      stat('After ' + num('adjRight') + '% right', r > 0 ? rs((price + face * r) / (1 + r)) : '—');
  }
  ['adjPrice', 'adjBonus', 'adjRight', 'adjFace'].forEach(function (id) { $(id).addEventListener('input', adj); });
  adj();
})();
