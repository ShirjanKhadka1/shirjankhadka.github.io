/* Volume Analysis page (VPI board) — renders /data/vpi.json
   Full-page rebuild 2026-10-25: hero + auto-update panel + sector cards +
   paginated board + forward tracking, all inside the design master. */
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
  function pp(x) { return (x >= 0 ? '+' : '') + Number(x).toFixed(2) + 'pp'; }
  function pct1(x) { return (Number(x) * 100).toFixed(1) + '%'; }
  function npt(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 16).replace('T', ' ') + ' NPT';
  }

  var TAG_LABEL = {
    HIGH_VOLUME_SPIKE: 'Spike', ELEVATED_VOLUME: 'Elevated',
    NORMAL: 'Normal', VOLUME_DRYUP: 'Dry-up'
  };
  var TAG_COLOR = {
    HIGH_VOLUME_SPIKE: '#b45309', ELEVATED_VOLUME: '#2563eb',
    NORMAL: '#8A94A3', VOLUME_DRYUP: '#7c3aed'
  };
  var FLAG_DEFS = [
    ['flag_volume_shock', 'shock', 'Shock'],
    ['flag_volume_expansion', 'expansion', 'Expansion'],
    ['flag_compression', 'compression', 'Compression'],
    ['flag_quiet_accumulation', 'quiet', 'Quiet accum.']
  ];
  var GROUP_ORDER = ['HIGH_VOLUME_SPIKE', 'ELEVATED_VOLUME', 'NORMAL', 'VOLUME_DRYUP',
    'PVCS_TOP', 'PVCS_BOTTOM', 'VPD_POS', 'VPD_NEG', 'QUIET_ACCUM', 'SHOCK'];
  var GROUP_LABEL = {
    HIGH_VOLUME_SPIKE: 'Volume spike (RVOL-7 ≥ 3.5)',
    ELEVATED_VOLUME: 'Elevated (RVOL-7 1.8–3.5)',
    NORMAL: 'Normal',
    VOLUME_DRYUP: 'Dry-up (RVOL-7 ≤ 0.5)',
    PVCS_TOP: 'PVCS top decile',
    PVCS_BOTTOM: 'PVCS bottom decile',
    VPD_POS: 'VPD ≥ +5',
    VPD_NEG: 'VPD ≤ −5',
    QUIET_ACCUM: 'Quiet accumulation',
    SHOCK: 'Shock flag'
  };
  var PAGE_SIZE = 25;

  var state = { rows: [], sortKey: 'rvol_7', sortDir: -1, flag: null,
    sector: '', tag: '', q: '', page: 1, secPage: 1, horizon: 'h10', payload: null, refreshTimer: null };

  function chips(r) {
    var h = '';
    FLAG_DEFS.forEach(function (f) {
      if (r[f[0]]) h += '<span class="vp-chip ' + f[1] + '">' + f[2] + '</span>';
    });
    return h || '<span class="vp-chip">—</span>';
  }

  function filtered() {
    var q = state.q.trim().toUpperCase();
    return state.rows.filter(function (r) {
      if (q && r.symbol.indexOf(q) === -1) return false;
      if (state.sector && r.sector !== state.sector) return false;
      if (state.tag && r.signal_tag !== state.tag) return false;
      if (state.flag && !r[state.flag]) return false;
      return true;
    });
  }

  function syncURL() {
    var p = new URLSearchParams();
    if (state.sector) p.set('sector', state.sector);
    if (state.tag) p.set('tag', state.tag);
    if (state.q) p.set('q', state.q);
    if (state.page > 1) p.set('page', state.page);
    if (state.sortKey !== 'rvol_7' || state.sortDir !== -1) {
      p.set('sort', state.sortKey); p.set('dir', state.sortDir);
    }
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  function renderBoard() {
    var rows = filtered();
    var k = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var slice = rows.slice(start, start + PAGE_SIZE);
    var h = '';
    slice.forEach(function (r) {
      var pc = r.percentage_change;
      h += '<tr>' +
        '<td><a class="vp-sym" href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a></td>' +
        '<td class="vp-sector vp-hide-m">' + esc(r.sector) + '</td>' +
        '<td class="vp-num">' + fmt(r.ltp) + '</td>' +
        '<td class="vp-num ' + (pc > 0 ? 'vp-pos' : pc < 0 ? 'vp-neg' : '') + '">' + (pc > 0 ? '+' : '') + fmt(pc) + '%</td>' +
        '<td class="vp-num vp-hide-m">' + fmtVol(r.volume) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmtVol(r.volume_yesterday) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmtVol(r.avg_7) + '</td>' +
        '<td class="vp-num"><strong>' + fmt(r.rvol_7) + '</strong></td>' +
        '<td class="vp-num vp-hide-m">' + fmtVol(r.avg_15) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmt(r.rvol_15) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmtVol(r.avg_20) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmt(r.rvol_20) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmtVol(r.avg_30) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rvol_30) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmtVol(r.avg_60) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rvol_60) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmtVol(r.avg_90) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rvol_90) + '</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.rolling_high_20) + '</td>' +
        '<td class="vp-num ' + (r.pvcs > 0 ? 'vp-pos' : r.pvcs < 0 ? 'vp-neg' : '') + '">' + fmt(r.pvcs) + '</td>' +
        '<td class="vp-num ' + (r.vpd > 0 ? 'vp-pos' : r.vpd < 0 ? 'vp-neg' : '') + '">' + fmt(r.vpd) + '</td>' +
        '<td class="vp-num vp-hide-m">' + fmt(r.volume_shock_ratio) + '×</td>' +
        '<td class="vp-num vp-hide-s">' + fmt(r.daily_range_pct) + '%</td>' +
        '<td>' + chips(r) + '</td>' +
        '<td><span class="vp-tag ' + esc(r.signal_tag) + '">' + esc(TAG_LABEL[r.signal_tag] || r.signal_tag) + '</span></td>' +
        '</tr>';
    });
    $('vpBody').innerHTML = h || '<tr><td colspan="25" class="vp-loading">No symbols match the current filters.</td></tr>';
    $('vpCount').textContent = rows.length + ' of ' + state.rows.length + ' symbols';
    var lo = rows.length ? start + 1 : 0;
    $('vpPageNum').textContent = 'Showing ' + lo + '–' + Math.min(start + PAGE_SIZE, rows.length) +
      ' of ' + rows.length + ' · Page ' + state.page + ' of ' + pages;
    $('vpPrev').disabled = state.page <= 1;
    $('vpNext').disabled = state.page >= pages;
    syncURL();
  }

  function statCard(k, v, s) {
    return '<div class="vp-stat"><div class="sk">' + esc(k) + '</div><div class="sv">' + esc(v) + '</div><div class="ss">' + esc(s) + '</div></div>';
  }

  function sectorAgg() {
    var m = {};
    state.rows.forEach(function (r) {
      var s = m[r.sector] || (m[r.sector] = { sector: r.sector, n: 0, rvol: 0, spikes: 0, elevated: 0, topPvcs: null, topPvcsSym: '' });
      s.n += 1; s.rvol += r.rvol_7;
      if (r.signal_tag === 'HIGH_VOLUME_SPIKE') s.spikes += 1;
      if (r.signal_tag === 'ELEVATED_VOLUME') s.elevated += 1;
      if (s.topPvcs === null || r.pvcs > s.topPvcs) { s.topPvcs = r.pvcs; s.topPvcsSym = r.symbol; }
    });
    return Object.keys(m).map(function (k) {
      var s = m[k];
      s.meanRvol = s.rvol / s.n;
      var br = 0;
      state.rows.forEach(function (r) { if (r.sector === k && r.rvol_7 >= 1) br += 1; });
      s.breadth = br / s.n * 100;
      return s;
    }).sort(function (a, b) { return b.meanRvol - a.meanRvol; });
  }

  function renderSectors() {
    var secs = sectorAgg();
    var maxMean = Math.max.apply(null, secs.map(function (s) { return s.meanRvol; }));
    $('sectorChart').innerHTML = secs.map(function (s, i) {
      return '<div class="vp-srow"><span class="vp-srow-label">#' + (i + 1) + ' ' + esc(s.sector) + '</span>' +
        '<span class="vp-strack" aria-hidden="true"><i class="vp-sbar" style="width:' + (s.meanRvol / maxMean * 100).toFixed(1) + '%"></i></span>' +
        '<span class="vp-sval"><b>' + fmt(s.meanRvol) + '×</b><span>' + s.n + ' stocks</span></span></div>';
    }).join('');
    $('sectorCards').innerHTML = secs.map(function (s) {
      var active = state.sector === s.sector ? ' vp-card-active' : '';
      return '<button type="button" class="vp-card' + active + '" data-sector="' + esc(s.sector) + '">' +
        '<span class="vp-card-name">' + esc(s.sector) + '</span>' +
        '<span class="vp-card-big">' + fmt(s.meanRvol) + '×</span>' +
        '<span class="vp-card-meta">mean RVOL-7 · ' + s.n + ' stocks</span>' +
        '<span class="vp-card-meta">' + s.spikes + ' spike' + (s.spikes === 1 ? '' : 's') + ' · ' + s.elevated + ' elevated · breadth ' + fmt(s.breadth, 1) + '%</span>' +
        '<span class="vp-card-meta">Top PVCS: <a href="/stocks/' + esc(s.topPvcsSym) + '/" onclick="event.stopPropagation()">' + esc(s.topPvcsSym) + '</a> ' + fmt(s.topPvcs) + '</span>' +
        '<span class="vp-card-cta">' + (state.sector === s.sector ? 'Showing this sector ↑' : 'Show only this sector →') + '</span>' +
        '</button>';
    }).join('');
    document.querySelectorAll('#sectorCards .vp-card').forEach(function (c) {
      c.addEventListener('click', function () {
        var sec = c.getAttribute('data-sector');
        state.sector = state.sector === sec ? '' : sec;
        $('vpSector').value = state.sector;
        state.page = 1; state.secPage = 1;
        renderSectors(); renderBoard(); renderSectorBlock();
        document.getElementById(state.sector ? 'sectorBlock' : 'boardsec').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderAuto() {
    var d = state.payload;
    var sub, note;
    if (d.intraday) {
      var qt = '';
      try {
        qt = new Date(d.quotes_asof).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
      } catch (e) { qt = ''; }
      sub = 'Session ' + d.asof + ' · provisional board' + (qt ? ' (quotes as of ' + qt + ' NPT)' : '') +
        ' · the FINAL board replaces this after the close, around 16:38 NPT. During market hours the provisional board refreshes every 15 minutes.';
    } else {
      sub = 'Session ' + d.asof + ' · FINAL board · payload built ' + npt(d.built_at) +
        ' · next board after the next session\'s close, around 16:38 NPT. During market hours this page still shows the last close\'s board, refreshed provisionally every 15 minutes.';
    }
    $('vpAutoSub').textContent = sub;
    var t = d.tracking;
    if (t) {
      var through = d.intraday && t.latest !== d.asof
        ? 'Tracking through session ' + t.latest + ' (last FINAL board); today\'s provisional board does not append tracking.'
        : 'Latest session ' + t.latest + ' (' + d.count + ' stocks): all three horizons pending — they resolve as sessions trade out.';
      note = 'Tracking so far: ' + t.sessions_tracked + ' sessions archived · ' +
        Number(t.resolved_outcomes).toLocaleString('en-IN') + ' resolved group-horizon cells. ' + through;
    } else {
      note = 'Tracking builds with the next FINAL board — past signals measured forward, published below.';
    }
    $('vpTrackNote').textContent = note;
  }

  function renderTracking() {
    var d = state.payload, t = d.tracking;
    var vb = $('vpVerdict'), chart = $('trackChart'), body = $('vpTrackBody'), pend = $('vpTrackPending');
    if (!t || !t.aggregate) {
      vb.textContent = 'No tracking history in this payload yet — it arrives with the next FINAL board, and then every past signal gets measured forward here.';
      chart.innerHTML = ''; body.innerHTML = '';
      pend.textContent = '';
      return;
    }
    var agg = t.aggregate, h = state.horizon;
    var spike = agg.HIGH_VOLUME_SPIKE && agg.HIGH_VOLUME_SPIKE[h];
    var pvcsTop = agg.PVCS_TOP && agg.PVCS_TOP[h];
    var positives = GROUP_ORDER.filter(function (g) {
      return g !== 'NORMAL' && ['h5', 'h10', 'h20'].every(function (hh) { return agg[g] && agg[g][hh] && agg[g][hh].mean > 0; });
    });
    var v = 'Across ' + t.sessions_tracked + ' sessions, volume spikes trailed the average stock at every horizon' +
      (spike ? ' (' + pp(agg.HIGH_VOLUME_SPIKE.h5.mean) + ' at 5 sessions, ' + pp(agg.HIGH_VOLUME_SPIKE.h10.mean) +
        ' at 10, ' + pp(agg.HIGH_VOLUME_SPIKE.h20.mean) + ' at 20; only ' + pct1(agg.HIGH_VOLUME_SPIKE.h20.beat) + ' beat the market at 20 sessions)' : '.') +
      (pvcsTop ? ' The top-PVCS decile did worse still (' + pp(agg.PVCS_TOP.h5.mean) + ' at 5 sessions, ' + pct1(agg.PVCS_TOP.h5.beat) + ' beat).' : '') +
      (positives.length
        ? ' The only group that did not lose on all three horizons was ' + positives.map(function (g) { return GROUP_LABEL[g]; }).join(', ') +
          ' (' + positives.map(function (g) { return pp(agg[g].h5.mean) + ' / ' + pp(agg[g].h10.mean) + ' / ' + pp(agg[g].h20.mean); }).join('; ') + ').'
        : ' No group beat the average stock on all three horizons.') +
      ' Chasing volume, on this evidence, paid for attention with returns. The board\'s formula is unchanged — tracking only measures it.';
    vb.textContent = v;
    var rows = GROUP_ORDER.filter(function (g) { return agg[g] && agg[g][h]; })
      .map(function (g) { return { g: g, d: agg[g][h] }; });
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.d.mean); })) || 1;
    chart.innerHTML = rows.map(function (r) {
      var cls = r.d.mean >= 0 ? 'pos' : 'neg';
      return '<div class="vp-trow"><span class="vp-trow-label">' + esc(GROUP_LABEL[r.g]) + '</span>' +
        '<span class="vp-ttrack" aria-hidden="true"><i class="vp-tbar ' + cls + '" style="width:' + Math.max(4, Math.abs(r.d.mean) / maxAbs * 100).toFixed(1) + '%"></i></span>' +
        '<span class="vp-tval"><b>' + pp(r.d.mean) + '</b><span>beat ' + pct1(r.d.beat) + '</span></span></div>';
    }).join('');
    body.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(GROUP_LABEL[r.g]) + '</td>' +
        '<td class="vp-num ' + (r.d.mean >= 0 ? 'vp-pos' : 'vp-neg') + '">' + pp(r.d.mean) + '</td>' +
        '<td class="vp-num">' + pct1(r.d.beat) + '</td>' +
        '<td class="vp-num">' + r.d.sessions + '</td></tr>';
    }).join('');
    pend.textContent = d.intraday && t.latest !== d.asof
      ? 'Tracking through session ' + t.latest + ' (last FINAL board).'
      : 'Latest tracked session ' + t.latest + ': 5, 10 and 20-session horizons all pending — they resolve as sessions trade out.';
    document.querySelectorAll('.vp-segbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-h') === state.horizon ? 'true' : 'false');
    });
  }

  function renderHeader() {
    var data = state.payload;
    var sum = data.summary || {};
    var tc = sum.tag_counts || {};
    if (data.intraday) {
      var qt = '';
      try {
        qt = new Date(data.quotes_asof).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu'
        });
      } catch (e) { qt = ''; }
      $('vpSession').textContent = 'Session ' + data.asof + ' · in progress · ' + data.count +
        ' equities traded so far · averages from prior sessions through ' + (data.based_on_session || '') +
        ' · Source: Nepse Decode live quotes + OHLCV archive';
      var pv = $('vpProvisional');
      pv.hidden = false;
      pv.innerHTML = '<span class="vp-live-dot" aria-hidden="true"></span><strong>LIVE — intraday provisional board.</strong> ' +
        'Volumes are cumulative shares traded so far today' + (qt ? ' (quotes as of ' + qt + ' NPT)' : '') +
        '; RVOL, scores and flags are provisional and the final board replaces this after the close.';
    } else {
      $('vpProvisional').hidden = true;
      $('vpSession').textContent = 'Session ' + data.asof + ' · ' + data.count + ' equities · rebuilt after every close · Source: Nepse Decode OHLCV archive';
    }
    $('vpStats').innerHTML =
      statCard('Equities scanned', String(data.count), 'ordinary shares with 91+ sessions of history') +
      statCard('Median RVOL-7', fmt(sum.median_rvol_7), 'half the market traded above this pace') +
      statCard('Volume spikes', String(tc.HIGH_VOLUME_SPIKE || 0), 'RVOL-7 at or above 3.5× normal pace') +
      statCard('Volume dry-ups', String(tc.VOLUME_DRYUP || 0), 'RVOL-7 at or below 0.5× normal pace');
    var distOrder = ['HIGH_VOLUME_SPIKE', 'ELEVATED_VOLUME', 'NORMAL', 'VOLUME_DRYUP'];
    var total = data.count || 1;
    $('vpDist').innerHTML = '<div class="vp-dist-bar" aria-hidden="true">' + distOrder.map(function (k) {
      return '<i style="width:' + ((tc[k] || 0) / total * 100).toFixed(1) + '%;background:' + TAG_COLOR[k] + '"></i>';
    }).join('') + '</div><div class="vp-dist-legend">' + distOrder.map(function (k) {
      return '<span><i style="background:' + TAG_COLOR[k] + '"></i>' + esc(TAG_LABEL[k]) + ' ' + (tc[k] || 0) + ' (' + ((tc[k] || 0) / total * 100).toFixed(1) + '%)</span>';
    }).join('') + '</div>';
  }

  function renderSectorBlock() {
    var body = $('vpSecBody');
    var title = $('vpSecTitle');
    if (!state.sector) {
      title.textContent = 'Stocks in the selected sector';
      body.innerHTML = '<p class="vp-sec-empty">Select a sector card above, or pick a sector in the board controls, to see that sector\'s stocks here — ranked by RVOL-7, with PVCS, VPD and tag beside them.</p>';
      return;
    }
    var sec = null;
    sectorAgg().forEach(function (s) { if (s.sector === state.sector) sec = s; });
    var q = state.q.trim().toUpperCase();
    var rows = state.rows.filter(function (r) {
      if (r.sector !== state.sector) return false;
      if (q && r.symbol.indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return b.rvol_7 - a.rvol_7; });
    var totalVol = 0, fullSecVol = 0;
    state.rows.forEach(function (r) {
      totalVol += r.volume || 0;
      if (r.sector === state.sector) fullSecVol += r.volume || 0;
    });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.secPage > pages) state.secPage = pages;
    var start = (state.secPage - 1) * PAGE_SIZE;
    var slice = rows.slice(start, start + PAGE_SIZE);
    var maxRvol = rows.length ? Math.max.apply(null, rows.map(function (r) { return r.rvol_7; })) : 1;
    title.textContent = 'Stocks in ' + state.sector;
    var h = '<div class="vp-sec-summary">' +
      statCard('Stocks scored', sec ? String(sec.n) : '—', 'ordinary equities in this sector') +
      statCard('Mean RVOL-7', sec ? fmt(sec.meanRvol) + '×' : '—', 'average pace across the sector') +
      statCard('Spikes', sec ? String(sec.spikes) : '—', 'RVOL-7 at or above 3.5×') +
      statCard('Top PVCS', sec ? esc(sec.topPvcsSym) + ' ' + fmt(sec.topPvcs) : '—', 'strongest price-volume confirmation') +
      statCard('Volume share', totalVol ? (fullSecVol / totalVol * 100).toFixed(1) + '%' : '—', 'of this session\'s traded volume') +
      '</div>';
    h += '<div class="vp-tablewrap"><table class="vp-table"><thead><tr>' +
      '<th>Symbol</th><th class="vp-num">LTP</th><th class="vp-num">% Chg</th><th class="vp-num">Volume</th>' +
      '<th class="vp-num">RVOL 7</th><th class="vp-num">PVCS</th><th class="vp-num">VPD</th><th>Tag</th><th>RVOL</th>' +
      '</tr></thead><tbody>';
    slice.forEach(function (r) {
      var pc = r.percentage_change;
      h += '<tr>' +
        '<td><a class="vp-sym" href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a></td>' +
        '<td class="vp-num">' + fmt(r.ltp) + '</td>' +
        '<td class="vp-num ' + (pc > 0 ? 'vp-pos' : pc < 0 ? 'vp-neg' : '') + '">' + (pc > 0 ? '+' : '') + fmt(pc) + '%</td>' +
        '<td class="vp-num">' + fmtVol(r.volume) + '</td>' +
        '<td class="vp-num"><strong>' + fmt(r.rvol_7) + '</strong></td>' +
        '<td class="vp-num ' + (r.pvcs > 0 ? 'vp-pos' : r.pvcs < 0 ? 'vp-neg' : '') + '">' + fmt(r.pvcs) + '</td>' +
        '<td class="vp-num ' + (r.vpd > 0 ? 'vp-pos' : r.vpd < 0 ? 'vp-neg' : '') + '">' + fmt(r.vpd) + '</td>' +
        '<td><span class="vp-tag ' + esc(r.signal_tag) + '">' + esc(TAG_LABEL[r.signal_tag] || r.signal_tag) + '</span></td>' +
        '<td><span class="vp-minibar"><i style="width:' + Math.min(100, r.rvol_7 / maxRvol * 100).toFixed(1) + '%"></i></span></td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';
    var lo = rows.length ? start + 1 : 0;
    h += '<div class="vp-pager">' +
      '<button type="button" class="cx-btn quiet" id="vpSecPrevInner">← Prev</button>' +
      '<span class="vp-pagenum">Showing ' + lo + '–' + Math.min(start + PAGE_SIZE, rows.length) + ' of ' + rows.length + ' · Page ' + state.secPage + ' of ' + pages + '</span>' +
      '<button type="button" class="cx-btn" id="vpSecNextInner">Next →</button>' +
      '<button type="button" class="cx-btn quiet" id="vpSecClearInner">Show full board</button>' +
      '</div>';
    body.innerHTML = h;
    $('vpSecPrevInner').disabled = state.secPage <= 1;
    $('vpSecNextInner').disabled = state.secPage >= pages;
    $('vpSecPrevInner').addEventListener('click', function () { if (state.secPage > 1) { state.secPage -= 1; renderSectorBlock(); } });
    $('vpSecNextInner').addEventListener('click', function () { if (state.secPage < pages) { state.secPage += 1; renderSectorBlock(); } });
    $('vpSecClearInner').addEventListener('click', function () {
      state.sector = ''; state.secPage = 1;
      $('vpSector').value = '';
      renderSectors(); renderBoard(); renderSectorBlock();
    });
  }

  function nptClock(d) {
    try {
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
    } catch (e) { return ''; }
  }
  function boardKey(p) {
    return p.asof + '|' + (p.intraday ? 'LIVE:' + (p.quotes_asof || '') : 'FINAL');
  }
  function refreshDelayMs() {
    var parts;
    try {
      parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
    } catch (e) { return 30 * 60 * 1000; }
    var get = function (t) { var f = parts.filter(function (p) { return p.type === t; }); return f.length ? f[0].value : ''; };
    var wd = get('weekday'), h = parseInt(get('hour'), 10);
    if (wd === 'Sat' || wd === 'Sun') return 2 * 60 * 60 * 1000;
    if (h >= 11 && h < 15) return 15 * 60 * 1000;
    return 30 * 60 * 1000;
  }
  function refreshStatusLine(prefix, failed) {
    var d = state.payload;
    var mode = d.intraday
      ? 'LIVE provisional, quotes as of ' + nptClock(new Date(d.quotes_asof)) + ' NPT'
      : 'FINAL';
    $('vpRefresh').textContent = prefix + ' · Board session ' + d.asof + ' · ' + mode +
      ' · last refresh check ' + nptClock(new Date()) + ' NPT' +
      (failed ? ' (check failed — showing last loaded board)' : '');
  }
  function scheduleRefresh() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(checkForUpdate, refreshDelayMs());
  }
  function checkForUpdate() {
    if (!state.payload) { scheduleRefresh(); return; }
    if (document.hidden) { scheduleRefresh(); return; }
    fetchJSON('/data/vpi.json').then(function (p) {
      if (boardKey(p) !== boardKey(state.payload)) {
        state.payload = p;
        state.rows = p.data || [];
        renderHeader(); renderAuto(); renderSectors(); renderSectorBlock(); renderTracking(); renderBoard();
        refreshStatusLine('Board updated');
      } else {
        refreshStatusLine('Board unchanged');
      }
      scheduleRefresh();
    }).catch(function () {
      refreshStatusLine('Board unchanged', true);
      scheduleRefresh();
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkForUpdate();
  });

  function init(data) {
    state.payload = data;
    state.rows = data.data || [];
    renderHeader();
    var sectors = {};
    state.rows.forEach(function (r) { sectors[r.sector] = true; });
    var sel = $('vpSector');
    Object.keys(sectors).sort().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s; sel.appendChild(o);
    });
    var p = new URLSearchParams(location.search);
    if (p.get('sector')) { state.sector = p.get('sector'); sel.value = state.sector; }
    if (p.get('tag')) { state.tag = p.get('tag'); $('vpTag').value = state.tag; }
    if (p.get('q')) { state.q = p.get('q'); $('vpSearch').value = state.q; }
    if (p.get('page')) { state.page = Math.max(1, parseInt(p.get('page'), 10) || 1); }
    if (p.get('sort')) { state.sortKey = p.get('sort'); state.sortDir = p.get('dir') === '1' ? 1 : -1; }
    renderAuto(); renderSectors(); renderSectorBlock(); renderTracking(); renderBoard();
    refreshStatusLine('Board loaded');
    scheduleRefresh();
    $('vpSearch').addEventListener('input', function () { state.q = $('vpSearch').value; state.page = 1; renderBoard(); renderSectorBlock(); });
    $('vpSector').addEventListener('change', function () { state.sector = $('vpSector').value; state.page = 1; state.secPage = 1; renderSectors(); renderBoard(); renderSectorBlock(); });
    $('vpTag').addEventListener('change', function () { state.tag = $('vpTag').value; state.page = 1; renderBoard(); });
    document.querySelectorAll('.vp-fbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-flag');
        var on = state.flag === f;
        state.flag = on ? null : f;
        document.querySelectorAll('.vp-fbtn').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        if (!on) b.setAttribute('aria-pressed', 'true');
        state.page = 1; renderBoard();
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
        state.page = 1; renderBoard();
      });
    });
    $('vpPrev').addEventListener('click', function () { if (state.page > 1) { state.page -= 1; renderBoard(); } });
    $('vpNext').addEventListener('click', function () { state.page += 1; renderBoard(); });
    document.querySelectorAll('.vp-segbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-h') === state.horizon ? 'true' : 'false');
      b.addEventListener('click', function () { state.horizon = b.getAttribute('data-h'); renderTracking(); });
    });
  }

  fetchJSON('/data/vpi.json').then(init).catch(function () {
    $('vpBody').innerHTML = '<tr><td colspan="25" class="vp-loading">The volume board is being rebuilt — please check back after the next market close.</td></tr>';
    $('vpSession').textContent = 'Board temporarily unavailable';
  });
})();
