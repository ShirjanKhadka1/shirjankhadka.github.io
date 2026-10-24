/* Technical Signals board — renders /data/technical-signals.json
   (Nepse Decode teardown Link 9). Plain DOM, no dependencies. */
(function () {
  'use strict';
  var SIG_NAMES = { macd: 'MACD', rsi: 'RSI', sma: 'SMA', ema: 'EMA',
    bb: 'Bollinger', bull_bear_power: 'Bull/Bear Power',
    supertrend: 'Supertrend', ichimoku: 'Ichimoku', keltner: 'Keltner',
    adx: 'ADX', parabolic_sar: 'Parabolic SAR' };
  var SIG_ORDER = ['macd', 'rsi', 'sma', 'ema', 'bb', 'bull_bear_power',
    'supertrend', 'ichimoku', 'keltner', 'adx', 'parabolic_sar'];
  var FAM_ORDER = ['overall', 'macd', 'rsi', 'sma', 'ema', 'bb',
    'bull_bear_power', 'supertrend', 'ichimoku', 'keltner', 'adx',
    'parabolic_sar'];
  var FAM_NAMES = { overall: 'Overall rating' };
  SIG_ORDER.forEach(function (k) { FAM_NAMES[k] = SIG_NAMES[k]; });
  var RATINGS = ['Strong Buy', 'Buy', 'Neutral', 'Sell', 'Strong Sell'];
  var state = { rating: 'All', sector: 'All', q: '', horizon: '10', open: null };
  var DATA = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(x, d) {
    if (x == null || isNaN(x)) return '—';
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(x) {
    if (x == null || isNaN(x)) return '—';
    return (x > 0 ? '+' : '') + fmt(x, 2) + '%';
  }
  function sigClass(lab) {
    if (/Bull|Buy/.test(lab)) return 'up' + (/Strong/.test(lab) ? ' strong' : '');
    if (/Bear|Sell/.test(lab)) return 'down' + (/Strong/.test(lab) ? ' strong' : '');
    return 'flat';
  }
  function ratingChip(rating) {
    var cls = rating === 'Strong Buy' || rating === 'Buy' ? 'up'
      : rating === 'Neutral' ? 'flat' : 'down';
    return '<span class="cx-chip ' + cls + '">' + esc(rating) + '</span>';
  }
  function seg(el, options, current, cb) {
    el.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = o;
      b.setAttribute('aria-pressed', o === current ? 'true' : 'false');
      b.addEventListener('click', function () { cb(o); });
      el.appendChild(b);
    });
  }

  function renderStats(p) {
    var s = p.summary;
    var bull = s.rating_counts['Strong Buy'] + s.rating_counts['Buy'];
    var bear = s.rating_counts['Sell'] + s.rating_counts['Strong Sell'];
    var squeeze = p.board.filter(function (r) { return r.values.bb_state === 'Squeeze (low volatility)'; }).length;
    var cards = [
      ['Stocks scored', String(s.symbols_scored), 'Session ' + p.asof],
      ['Median overall score', String(s.median_score), 'Mean ' + fmt(s.mean_score, 1) + ' of 100'],
      ['Rated Buy or Strong Buy', String(bull), fmt(100 * bull / s.symbols_scored, 0) + '% of the board'],
      ['Rated Sell or Strong Sell', String(bear), fmt(100 * bear / s.symbols_scored, 0) + '% of the board'],
      ['In a volatility squeeze', String(squeeze), 'Bollinger band width in its lowest fifth of the last ~6 months']
    ];
    document.getElementById('statStrip').innerHTML = cards.map(function (c) {
      return '<div class="cx-stat"><div class="cx-stat-l">' + esc(c[0]) +
        '</div><div class="cx-stat-v">' + esc(c[1]) +
        '</div><div class="cx-stat-s">' + esc(c[2]) + '</div></div>';
    }).join('');
    var total = s.symbols_scored;
    var segCls = { 'Strong Buy': 'ts-seg-sb', 'Buy': 'ts-seg-b', 'Neutral': 'ts-seg-n', 'Sell': 'ts-seg-s', 'Strong Sell': 'ts-seg-ss' };
    var bar = RATINGS.map(function (r) {
      var n = s.rating_counts[r] || 0;
      return '<i class="' + segCls[r] + '" style="width:' + (100 * n / total) + '%"></i>';
    }).join('');
    var legend = RATINGS.map(function (r) {
      return '<span><i class="ts-dot ' + segCls[r] + '"></i>' + esc(r) + ' <b>' + (s.rating_counts[r] || 0) + '</b></span>';
    }).join('');
    var cc = s.classification_counts || {};
    var classLine = '<div class="ts-dist-legend">By overall classification: ' +
      ['Bull', 'Bullish', 'Bearish', 'Bear'].map(function (k) {
        return '<span>' + k + ' <b>' + (cc[k] || 0) + '</b></span>';
      }).join('') + '</div>';
    document.getElementById('ratingDist').innerHTML =
      '<div class="ts-dist-bar">' + bar + '</div><div class="ts-dist-legend">' + legend + '</div>' + classLine;
  }

  function kv(label, value) {
    return '<div class="ts-kv"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }
  function detailHtml(r) {
    var v = r.values;
    var head = '<p class="ts-note" style="margin:0 2px var(--nd-s3)"><strong>' + esc(r.name || r.symbol) +
      '</strong> · ' + esc(r.type || '') + ' · ' + esc(r.sector) +
      ' · Overall score <strong>' + r.score + '</strong> — ' + esc(r.classification) +
      ' · Previous close ' + fmt(r.prev_close, 2) + '</p>';
    var chips = SIG_ORDER.map(function (k) {
      return '<span class="ts-siglab">' + esc(SIG_NAMES[k]) + '</span>' +
        '<span class="ts-sig ' + sigClass(r.signals[k]) + '">' + esc(r.signals[k]) + '</span>';
    }).join('');
    var caution = '';
    if (r.ex_break && r.ex_break.recent) {
      caution = '<p class="ts-caution">Corporate-action break inside the window: this stock ' +
        'fell ' + fmt(Math.abs(r.ex_break.pct), 1) + '% in one session on ' + esc(r.ex_break.date) +
        ' — in NEPSE a single-session fall of this size is usually the mechanical step of a ' +
        'book-closure (ex-date). Our archive is as-traded, so the mechanical ' +
        'step sits inside the smoothing windows and depresses the momentum readings (RSI, MACD, ADX) ' +
        'for some weeks. It is flagged, not adjusted away.</p>';
    }
    var trend = kv('SMA 20 / 50 / 200', fmt(v.sma_20, 1) + ' / ' + fmt(v.sma_50, 1) + ' / ' + fmt(v.sma_200, 1)) +
      kv('EMA 20 / 50 / 200', fmt(v.ema_20, 1) + ' / ' + fmt(v.ema_50, 1) + ' / ' + fmt(v.ema_200, 1)) +
      kv('SMAs below close', v.sma_count + ' of 6') +
      kv('EMAs below close', v.ema_count + ' of 6') +
      kv('Close vs SMA 200', pct(v.dist_sma200_pct)) +
      kv('Supertrend', fmt(v.supertrend, 1) + ' · ' + (v.supertrend_dir || '—')) +
      kv('Parabolic SAR', fmt(v.psar, 1) + ' · ' + (v.psar_dir || '—')) +
      kv('Ichimoku cloud', v.cloud || '—') +
      kv('Tenkan / Kijun', fmt(v.tenkan, 1) + ' / ' + fmt(v.kijun, 1));
    var momentum = kv('RSI (14)', fmt(v.rsi, 1)) +
      kv('MACD / signal / histogram', fmt(v.macd, 2) + ' / ' + fmt(v.macd_signal_line, 2) + ' / ' + fmt(v.macd_hist, 2)) +
      kv('Stochastic %K / %D', fmt(v.stoch_k, 1) + ' / ' + fmt(v.stoch_d, 1)) +
      kv('Stochastic RSI %K / %D', fmt(v.stoch_rsi_k, 1) + ' / ' + fmt(v.stoch_rsi_d, 1)) +
      kv('CCI (20)', fmt(v.cci, 1)) +
      kv('Williams %R (14)', fmt(v.williams_r, 1)) +
      kv('Awesome Oscillator', fmt(v.ao, 2)) +
      kv('Momentum (10)', fmt(v.momentum, 1)) +
      kv('Ultimate Oscillator', fmt(v.uo, 1)) +
      kv('Bull/Bear Power', fmt(v.bbp, 2));
    var vol = kv('ADX (14)', fmt(v.adx, 1)) +
      kv('+DI / −DI', fmt(v.plus_di, 1) + ' / ' + fmt(v.minus_di, 1)) +
      kv('ATR (14)', fmt(v.atr, 2) + ' · ' + fmt(v.atr_pct, 2) + '% of close') +
      kv('Realised volatility 20 / 60', fmt(v.rvol20, 1) + '% / ' + fmt(v.rvol60, 1) + '% annualised') +
      kv('Bollinger %B', fmt(v.bb_percent_b, 2)) +
      kv('Bollinger width', fmt(v.bb_bandwidth_pct, 2) + '% of basis') +
      kv('Bollinger upper / lower', fmt(v.bb_upper, 1) + ' / ' + fmt(v.bb_lower, 1)) +
      kv('Keltner position', fmt(v.kc_percent, 2) + ' of channel') +
      kv('Bollinger state', v.bb_state || '—');
    return head + '<div class="ts-sigs">' + chips + '</div>' + caution +
      '<div class="ts-groups">' +
      '<div class="ts-group"><h3>Trend</h3>' + trend + '</div>' +
      '<div class="ts-group"><h3>Momentum</h3>' + momentum + '</div>' +
      '<div class="ts-group"><h3>Volatility &amp; strength</h3>' + vol + '</div>' +
      '</div>';
  }

  function renderBoard() {
    var rows = DATA.board.filter(function (r) {
      if (state.rating !== 'All' && r.rating !== state.rating) return false;
      if (state.sector !== 'All' && r.sector !== state.sector) return false;
      if (state.q && r.symbol.indexOf(state.q) !== 0 &&
          (r.name || '').toUpperCase().indexOf(state.q) < 0) return false;
      return true;
    });
    var html = '';
    rows.forEach(function (r, i) {
      var chg = r.change_pct;
      html += '<tr class="ts-row" data-sym="' + esc(r.symbol) + '"><td class="num">' + (i + 1) + '</td>' +
        '<td class="ts-sym">' + esc(r.symbol) + '</td>' +
        '<td class="ts-sector">' + esc(r.sector) + '</td>' +
        '<td class="num">' + fmt(r.close, 2) + '</td>' +
        '<td class="num ' + (chg > 0 ? 'ts-pos' : chg < 0 ? 'ts-neg' : '') + '">' + pct(chg) + '</td>' +
        '<td class="num"><span class="ts-score"><b>' + r.score + '</b>' +
        '<span class="ts-gauge"><i style="--pos:' + r.score + '%"></i></span></span></td>' +
        '<td>' + ratingChip(r.rating) + '</td>' +
        '<td class="num">' + r.counts.bullish + ' / ' + r.counts.neutral + ' / ' + r.counts.bearish + '</td></tr>';
      if (state.open === r.symbol) {
        html += '<tr class="ts-detail"><td colspan="8">' + detailHtml(r) + '</td></tr>';
      }
    });
    if (!rows.length) {
      html = '<tr><td colspan="8" class="ts-loading">No stocks match this filter.</td></tr>';
    }
    document.getElementById('boardBody').innerHTML = html;
    document.getElementById('boardCount').textContent =
      'Showing ' + rows.length + ' of ' + DATA.board.length + ' scored stocks · session ' + DATA.asof;
    var trs = document.querySelectorAll('#boardTable tr.ts-row');
    Array.prototype.forEach.call(trs, function (tr) {
      tr.addEventListener('click', function () {
        var sym = tr.getAttribute('data-sym');
        state.open = state.open === sym ? null : sym;
        renderBoard();
      });
    });
  }

  function renderSectors() {
    var entries = Object.keys(DATA.summary.by_sector).map(function (k) {
      var s = DATA.summary.by_sector[k];
      return { sector: k, n: s.n, med: s.median_score, bull: s.bullish_rated, bear: s.bearish_rated };
    }).sort(function (a, b) { return b.med - a.med; });
    document.getElementById('sectorBody').innerHTML = entries.map(function (e) {
      return '<tr><td class="ts-sector">' + esc(e.sector) + '</td><td class="num">' + e.n +
        '</td><td class="num">' + fmt(e.med, 0) + '</td><td class="num ts-pos">' + e.bull +
        '</td><td class="num ts-neg">' + e.bear + '</td></tr>';
    }).join('');
  }

  function renderReplay() {
    var rep = DATA.replay;
    document.getElementById('replaySub').textContent =
      'Every label these families produced at every session from ' + rep.era_start +
      ' to ' + rep.era_end + ', graded against the close ' + state.horizon +
      ' sessions later — computed on our own archive with final closes, no lookahead. ' +
      'A bullish label hits when the forward close is higher; a bearish label hits when it is lower.';
    seg(document.getElementById('horizonTabs'), ['5', '10'], state.horizon, function (h) {
      state.horizon = h;
      renderReplay();
    });
    var fams = rep.families;
    document.getElementById('replayBody').innerHTML = FAM_ORDER.map(function (k) {
      var f = fams[k] && fams[k][state.horizon];
      if (!f) return '';
      return '<tr><td class="ts-sector">' + esc(FAM_NAMES[k]) + '</td>' +
        '<td class="num">' + Number(f.bull_n).toLocaleString('en-US') + '</td>' +
        '<td class="num">' + fmt(f.bull_hit_pct, 1) + '%</td>' +
        '<td class="num ' + (f.bull_mean_pct > 0 ? 'ts-pos' : 'ts-neg') + '">' + pct(f.bull_mean_pct) + '</td>' +
        '<td class="num">' + Number(f.bear_n).toLocaleString('en-US') + '</td>' +
        '<td class="num">' + fmt(f.bear_hit_pct, 1) + '%</td>' +
        '<td class="num">' + pct(f.bear_mean_pct) + '</td></tr>';
    }).join('');
  }

  function renderHistory() {
    var rows = DATA.history_recent || [];
    if (!rows.length) {
      document.getElementById('historyBody').innerHTML =
        '<tr><td colspan="8" class="ts-loading">The ledger starts with this session.</td></tr>';
      return;
    }
    document.getElementById('historyBody').innerHTML = rows.map(function (e) {
      var rc = e.rating_counts || {};
      return '<tr><td class="ts-sym">' + esc(e.asof) + '</td><td class="num">' + e.symbols +
        '</td><td class="num">' + fmt(e.median_score, 0) + '</td>' +
        '<td class="num">' + (rc['Strong Buy'] || 0) + '</td><td class="num">' + (rc['Buy'] || 0) +
        '</td><td class="num">' + (rc['Neutral'] || 0) + '</td><td class="num">' + (rc['Sell'] || 0) +
        '</td><td class="num">' + (rc['Strong Sell'] || 0) + '</td></tr>';
    }).join('');
  }

  function renderMethod() {
    var m = DATA.methodology;
    var blocks = [
      ['The construction', m.construction],
      ['The cross-check', m.crosscheck],
      ['Prices', m.prices],
      ['The replay method', m.replay_method],
      ['Reading it honestly', m.honesty]
    ];
    document.getElementById('methodBox').innerHTML = blocks.map(function (b) {
      return '<h3>' + esc(b[0]) + '</h3><p>' + esc(b[1]) + '</p>';
    }).join('') + '<p><strong>Data source.</strong> ' + esc(DATA.source) + '.</p>';
    var c = DATA.coverage || {};
    document.getElementById('coverageNote').textContent =
      'Coverage: ' + DATA.summary.symbols_scored + ' stocks scored for ' + DATA.asof + '. ' +
      (c.skipped_stale_session || 0) + ' listed names had no bar on the session (suspended or stale), ' +
      (c.skipped_short_history || 0) + ' have fewer than 20 sessions of history, and debentures and ' +
      'mutual funds (' + (c.excluded_non_equity || 0) + ') are outside this board\'s equity scope.';
  }

  function init(p) {
    DATA = p;
    document.getElementById('tsSession').textContent =
      'Session ' + p.asof + ' · ' + p.summary.symbols_scored +
      ' stocks scored · rebuilt after the close';
    renderStats(p);
    var sectors = ['All'].concat(Object.keys(p.summary.by_sector).sort());
    var ratingOpts = ['All'].concat(RATINGS);
    function drawRatingSeg() {
      seg(document.getElementById('ratingTabs'), ratingOpts, state.rating, function (v) {
        state.rating = v;
        drawRatingSeg();
        renderBoard();
      });
    }
    function drawSectorSeg() {
      seg(document.getElementById('sectorTabs'), sectors, state.sector, function (v) {
        state.sector = v;
        drawSectorSeg();
        renderBoard();
      });
    }
    drawRatingSeg();
    drawSectorSeg();
    document.getElementById('symSearch').addEventListener('input', function (e) {
      state.q = e.target.value.trim().toUpperCase();
      renderBoard();
    });
    renderBoard();
    renderSectors();
    renderReplay();
    renderHistory();
    renderMethod();
  }

  fetch('/data/technical-signals.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="8" class="ts-loading">The board could not be loaded (' + esc(e.message) + ').</td></tr>';
    });
})();
