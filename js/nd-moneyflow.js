/* Money Flow page (P19) — broker buy/sell flow from public floorsheet records */
(function () {
  'use strict';
  var BASE = '/nepse-brokers/data/';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtRs(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    var n = Number(v);
    var a = Math.abs(n);
    var sign = n < 0 ? '−' : '';
    if (a >= 1e7) return sign + 'Rs ' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return sign + 'Rs ' + (a / 1e5).toFixed(2) + ' L';
    return sign + 'Rs ' + a.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function fmtNum(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
  }

  var brokerNames = {};
  var flowData = null;
  var sortMode = 'net-desc';
  var showAll = false;

  function sortBrokers(list) {
    var arr = list.slice();
    switch (sortMode) {
      case 'net-desc': arr.sort(function (a, b) { return (b.net || 0) - (a.net || 0); }); break;
      case 'net-asc': arr.sort(function (a, b) { return (a.net || 0) - (b.net || 0); }); break;
      case 'buy-desc': arr.sort(function (a, b) { return (b.buy_value || 0) - (a.buy_value || 0); }); break;
      case 'sell-desc': arr.sort(function (a, b) { return (b.sell_value || 0) - (a.sell_value || 0); }); break;
    }
    return arr;
  }

  function renderTable() {
    var body = $('mfBody');
    if (!body || !flowData) return;
    var all = sortBrokers(flowData.brokers || []);
    var rows = showAll ? all : all.slice(0, 25);
    body.innerHTML = rows.map(function (b) {
      var name = brokerNames[b.code] || ('Broker ' + b.code);
      var net = Number(b.net || 0);
      var cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
      return '<tr>' +
        '<td class="l"><span class="bname">' + esc(name) + '</span><span class="bcode">Broker ' + esc(b.code) + '</span></td>' +
        '<td class="r">' + fmtRs(b.buy_value) + '</td>' +
        '<td class="r">' + fmtRs(b.sell_value) + '</td>' +
        '<td class="r ' + cls + '">' + (net > 0 ? '+' : '') + fmtRs(net).replace('−', '-') + '</td>' +
        '<td class="r">' + fmtNum(b.total_qty) + '</td></tr>';
    }).join('');
    var note = $('mfTableNote');
    if (note && flowData) {
      var total = (flowData.brokers || []).length;
      note.textContent = (showAll ? 'All ' + total : 'Top 25 of ' + total) + ' brokers · ' + flowData.from + ' → ' + flowData.to;
    }
    // Show all toggle
    var toggle = $('mfShowAll');
    if (toggle) {
      toggle.textContent = showAll ? 'Show top 25' : 'Show all ' + (flowData.brokers || []).length + ' brokers';
    }
  }

  function renderTiles() {
    var host = $('mfTiles');
    if (!host || !flowData) return;
    var brokers = flowData.brokers || [];
    var totBuy = 0, totSell = 0;
    brokers.forEach(function (b) { totBuy += Number(b.buy_value || 0); totSell += Number(b.sell_value || 0); });
    var topBuyer = brokers.slice().sort(function (a, b) { return (b.net || 0) - (a.net || 0); })[0];
    var topSeller = brokers.slice().sort(function (a, b) { return (a.net || 0) - (b.net || 0); })[0];
    host.innerHTML =
      tile('Total bought', fmtRs(totBuy), 'across all brokers') +
      tile('Total sold', fmtRs(totSell), 'across all brokers') +
      tile('Top net buyer', esc(brokerNames[topBuyer.code] || ('Broker ' + topBuyer.code)), '+' + fmtRs(topBuyer.net).replace('−', '-')) +
      tile('Top net seller', esc(brokerNames[topSeller.code] || ('Broker ' + topSeller.code)), fmtRs(topSeller.net).replace('−', '-'));
    function tile(k, v, s) {
      return '<div class="mf-tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
    }
  }

  function renderAccumDist() {
    var acc = $('mfAccum'), dist = $('mfDist');
    if (!flowData) return;
    if (acc) {
      var a = (flowData.accumulation || []).slice(0, 8);
      acc.innerHTML = a.length ? a.map(function (x) {
        return '<div class="mf-flowitem"><div><span class="sym"><a href="/stocks/' + esc(x.symbol) + '/">' + esc(x.symbol) + '</a></span>' +
          '<span class="dt">via Broker ' + esc(x.broker) + '</span></div>' +
          '<span class="amt pos">+' + fmtRs(x.net_value).replace('−', '-') + '</span></div>';
      }).join('') : '<p class="mf-loading">No accumulation data.</p>';
    }
    if (dist) {
      var d = (flowData.distribution || []).slice(0, 8);
      dist.innerHTML = d.length ? d.map(function (x) {
        return '<div class="mf-flowitem"><div><span class="sym"><a href="/stocks/' + esc(x.symbol) + '/">' + esc(x.symbol) + '</a></span>' +
          '<span class="dt">via Broker ' + esc(x.broker) + '</span></div>' +
          '<span class="amt neg">' + fmtRs(x.net_value).replace('−', '-') + '</span></div>';
      }).join('') : '<p class="mf-loading">No distribution data.</p>';
    }
  }

  function init() {
    if (!$('mfBody')) return;
    // Tabs
    var tabs = document.querySelectorAll('.mf-tabs button');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        sortMode = btn.getAttribute('data-sort');
        renderTable();
      });
    });
    // Show all toggle
    var showAllBtn = $('mfShowAll');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', function () {
        showAll = !showAll;
        renderTable();
      });
    }
    // Load broker names + latest flow
    fetchJSON(BASE + 'brokers.json').then(function (bn) { brokerNames = bn || {}; }).catch(function () {})
      .then(function () { return fetchJSON(BASE + 'periods/1D.json'); })
      .then(function (fd) {
        flowData = fd;
        var sess = $('mfSession');
        if (sess) sess.textContent = 'Session of ' + fd.from + (fd.to !== fd.from ? ' → ' + fd.to : '') +
          ' · ' + fd.trading_days + ' trading day(s) · Source: NEPSE floorsheet records';
        renderTiles();
        renderTable();
        renderAccumDist();
      })
      .catch(function () {
        var body = $('mfBody');
        if (body) body.innerHTML = '<tr><td colspan="5" class="mf-loading">Broker flow data unavailable. Please try again later.</td></tr>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Auto-refresh with market calendar awareness:
  // - Mon-Fri 11:00-15:00 NPT: every 5 min
  // - Mon-Fri outside hours: every 30 min (catches post-close pipeline update)
  // - Sat/Sun (holiday): every 2 hours (Friday's data won't change)
  function refreshIntervalMs() {
    try {
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
      var day = now.getDay();
      if (day === 0 || day === 6) return 2 * 60 * 60 * 1000;
      var mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= 660 && mins < 900) return 5 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }
  setInterval(function () {
    if (document.hidden) return;
    init();
  }, refreshIntervalMs());
})();
