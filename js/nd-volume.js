/* Volume Analysis page (VPI board) — renders /data/vpi.json */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
  }
  function fmt(n, d) {
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d });
  }
  function fmtVol(n) {
    if (n >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
    if (n >= 1e5) return (n / 1e5).toFixed(1) + ' L';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  var TAG_LABEL = {
    HIGH_VOLUME_SPIKE: 'Spike', ELEVATED_VOLUME: 'Elevated',
    NORMAL: 'Normal', VOLUME_DRYUP: 'Dry-up'
  };
  var FLAG_DEFS = [
    ['flag_volume_shock', 'shock', 'Shock'],
    ['flag_volume_expansion', 'expansion', 'Expansion'],
    ['flag_compression', 'compression', 'Compression'],
    ['flag_quiet_accumulation', 'quiet', 'Quiet accum.']
  ];

  var state = { rows: [], sortKey: 'rvol_7', sortDir: -1, flag: null };

  function chips(r) {
    var h = '';
    FLAG_DEFS.forEach(function (f) {
      if (r[f[0]]) h += '<span class="vp-chip ' + f[1] + '">' + f[2] + '</span>';
    });
    return h || '<span class="vp-chip">—</span>';
  }

  function render() {
    var q = ($('vpSearch').value || '').trim().toUpperCase();
    var sec = $('vpSector').value;
    var tag = $('vpTag').value;
    var rows = state.rows.filter(function (r) {
      if (q && r.symbol.indexOf(q) === -1) return false;
      if (sec && r.sector !== sec) return false;
      if (tag && r.signal_tag !== tag) return false;
      if (state.flag && !r[state.flag]) return false;
      return true;
    });
    var k = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
    var h = '';
    rows.forEach(function (r) {
      var pc = r.percentage_change;
      h += '<tr>' +
        '<td><a class="vp-sym" href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a></td>' +
        '<td class="vp-sector vp-hide-m">' + esc(r.sector) + '</td>' +
        '<td class="vp-num">' + fmt(r.ltp) + '</td>' +
        '<td class="vp-num ' + (pc > 0 ? 'vp-pos' : pc < 0 ? 'vp-neg' : '') + '">' + (pc > 0 ? '+' : '') + fmt(pc) + '%</td>' +
        '<td class="vp-num vp-hide-m">' + fmtVol(r.volume) + '</td>' +
        '<td class="vp-num"><strong>' + fmt(r.rvol_7) + '</strong></td>' +
        '<td class="vp-num vp-hide-m">' + fmt(r.rvol_15) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmt(r.rvol_20) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rvol_30) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rvol_60) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rvol_90) + '</td>' +
        '<td class="vp-num ' + (r.pvcs > 0 ? 'vp-pos' : r.pvcs < 0 ? 'vp-neg' : '') + '">' + fmt(r.pvcs) + '</td>' +
        '<td class="vp-num ' + (r.vpd > 0 ? 'vp-pos' : r.vpd < 0 ? 'vp-neg' : '') + '">' + fmt(r.vpd) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmt(r.volume_shock_ratio) + '×</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.daily_range_pct) + '%</td>' +
        '<td>' + chips(r) + '</td>' +
        '<td><span class="vp-tag ' + esc(r.signal_tag) + '">' + esc(TAG_LABEL[r.signal_tag] || r.signal_tag) + '</span></td>' +
        '</tr>';
    });
    $('vpBody').innerHTML = h || '<tr><td colspan="17" class="vp-loading">No symbols match the current filters.</td></tr>';
    $('vpCount').textContent = rows.length + ' of ' + state.rows.length + ' symbols';
  }

  function statCard(k, v, s) {
    return '<div class="vp-stat"><div class="sk">' + esc(k) + '</div><div class="sv">' + esc(v) + '</div><div class="ss">' + esc(s) + '</div></div>';
  }

  function init(data) {
    state.rows = data.data || [];
    var sum = data.summary || {};
    var tc = sum.tag_counts || {};
    $('vpSession').textContent = 'Session ' + data.asof + ' · ' + data.count + ' equities · rebuilt after every close · Source: Nepse Decode OHLCV archive';
    $('vpStats').innerHTML =
      statCard('Equities scanned', String(data.count), 'ordinary shares with 91+ sessions of history') +
      statCard('Median RVOL-7', fmt(sum.median_rvol_7), 'half the market traded above this pace') +
      statCard('Volume spikes', String(tc.HIGH_VOLUME_SPIKE || 0), 'RVOL-7 at or above 3.5× normal pace') +
      statCard('Volume dry-ups', String(tc.VOLUME_DRYUP || 0), 'RVOL-7 at or below 0.5× normal pace');
    var sectors = {};
    state.rows.forEach(function (r) { sectors[r.sector] = true; });
    var sel = $('vpSector');
    Object.keys(sectors).sort().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s; sel.appendChild(o);
    });
    ['vpSearch', 'vpSector', 'vpTag'].forEach(function (id) {
      $(id).addEventListener('input', render);
      $(id).addEventListener('change', render);
    });
    document.querySelectorAll('.vp-fbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-flag');
        var on = state.flag === f;
        state.flag = on ? null : f;
        document.querySelectorAll('.vp-fbtn').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        if (!on) b.setAttribute('aria-pressed', 'true');
        render();
      });
    });
    document.querySelectorAll('#vpTable th.vp-sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = (k === 'symbol' || k === 'sector' || k === 'signal_tag') ? 1 : -1; }
        document.querySelectorAll('#vpTable th .vp-arrow').forEach(function (a) { a.remove(); });
        var sp = document.createElement('span');
        sp.className = 'vp-arrow'; sp.textContent = state.sortDir === 1 ? '▲' : '▼';
        th.appendChild(sp);
        render();
      });
    });
    render();
  }

  fetchJSON('/data/vpi.json').then(init).catch(function () {
    $('vpBody').innerHTML = '<tr><td colspan="17" class="vp-loading">The volume board is being rebuilt — please check back after the next market close.</td></tr>';
    $('vpSession').textContent = 'Board temporarily unavailable';
  });
})();
