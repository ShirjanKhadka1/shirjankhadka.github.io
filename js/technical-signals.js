/* Technical Signals board — renders /data/technical-signals.json
   (Nepse Decode teardown Link 9, rebuilt 2026-10-27). Plain DOM, no
   dependencies. Auto-refresh: 60s change-gated — an unchanged payload
   moves only the freshness clock, never the DOM. View-change handlers
   RE-BASELINE the refresh signature after render, never null it. */
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
  var PAGE_SIZE = 25;
  var REFRESH_MS = 60000;
  var state = { rating: 'All', sector: 'All', q: '', sort: 'score_desc',
    horizon: '10', page: 1, open: null };
  var DATA = null;
  var lastSig = null;
  var lastCheckMs = 0;

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
  /* Band colour for a score-band midpoint, reusing the rating segments. */
  function bandCls(mid) {
    if (mid >= 70) return 'ts-seg-sb';
    if (mid >= 60) return 'ts-seg-b';
    if (mid >= 51) return 'ts-seg-n';
    if (mid >= 42) return 'ts-seg-s';
    return 'ts-seg-ss';
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

  function renderVerdict(p) {
    var s = p.summary;
    document.getElementById('verdictMedian').textContent = s.median_score;
    document.getElementById('verdictMean').textContent =
      'Mean ' + fmt(s.mean_score, 1) + ' · ' + s.symbols_scored + ' stocks scored';
    var sorted = p.board.slice().sort(function (a, b) { return b.score - a.score; });
    var top = sorted.slice(0, 5);
    var bottom = sorted.slice(-3).reverse();
    function li(r) {
      return '<li><span class="ts-sym">' + esc(r.symbol) + '</span> ' + esc(r.rating) +
        '<span class="ts-vscore">' + r.score + '</span></li>';
    }
    document.getElementById('verdictTop').innerHTML = top.map(li).join('');
    document.getElementById('verdictBottom').innerHTML = bottom.map(li).join('');
  }

  function kv(label, value) {
    return '<div class="ts-kv"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }
  function detailHtml(r) {
    var v = r.values;
    var head = '<p class="ts-note" style="margin:0 2px var(--nd-s3)"><strong>' + esc(r.name || r.symbol) +
      '</strong> · ' + esc(r.type || '') + ' · ' + esc(r.sector) +
      ' · Overall score <strong>' + r.score + '</strong> — ' + esc(r.classification) +
      ' · Previous close ' + fmt(r.prev_close, 2) +
      (r.change === 'new' || r.prev_score == null ? ' · first tracked session at this rating'
        : ' · vs ' + esc(DATA.changes.prev_session) + ': ' + esc(r.prev_rating) + ' ' + r.prev_score +
          ' → ' + esc(r.rating) + ' ' + r.score + ' · ' + ordinal(r.streak) +
          ' consecutive session' + (r.streak === 1 ? '' : 's') + ' at this rating' +
          (r.flip ? ' · <b>FLIP</b>: crossed sides in one step — treat a one-day flip as noise, not a call' : '')) + '</p>';
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

  function filteredRows() {
    var rows = DATA.board.filter(function (r) {
      if (state.rating !== 'All' && r.rating !== state.rating) return false;
      if (state.sector !== 'All' && r.sector !== state.sector) return false;
      if (state.q && r.symbol.indexOf(state.q) !== 0 &&
          (r.name || '').toUpperCase().indexOf(state.q) < 0) return false;
      return true;
    });
    var cmp = {
      score_desc: function (a, b) { return (b.score - a.score) || (a.symbol < b.symbol ? -1 : 1); },
      score_asc: function (a, b) { return (a.score - b.score) || (a.symbol < b.symbol ? -1 : 1); },
      symbol: function (a, b) { return a.symbol < b.symbol ? -1 : 1; },
      chg_desc: function (a, b) { return ((b.change_pct == null ? -1e9 : b.change_pct) - (a.change_pct == null ? -1e9 : a.change_pct)) || (a.symbol < b.symbol ? -1 : 1); },
      chg_asc: function (a, b) { return ((a.change_pct == null ? 1e9 : a.change_pct) - (b.change_pct == null ? 1e9 : b.change_pct)) || (a.symbol < b.symbol ? -1 : 1); }
    }[state.sort] || function () { return 0; };
    return rows.slice().sort(cmp);
  }

  function renderPager(total) {
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var el = document.getElementById('boardPager');
    if (!total) { el.innerHTML = ''; return; }
    function btn(label, to, disabled, aria, extra) {
      return '<button type="button" class="ts-pgbtn' + (extra ? ' ' + extra : '') + '"' +
        (disabled ? ' disabled' : '') + ' aria-label="' + aria + '" data-page="' + to + '">' +
        esc(label) + '</button>';
    }
    el.innerHTML = '<span class="ts-pginfo">Page ' + state.page + ' of ' + pages + '</span>' +
      '<span class="ts-pgbtns">' +
      btn('‹ Prev', state.page - 1, state.page <= 1, 'Previous page', '') +
      btn('Next ›', state.page + 1, state.page >= pages, 'Next page', 'ts-pgbtn-next') + '</span>';
    var btns = el.querySelectorAll('button[data-page]');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        state.page = parseInt(b.getAttribute('data-page'), 10);
        state.open = null;
        renderBoard();
      });
    });
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function changeSub(r) {
    if (r.change === 'new' || r.prev_score == null) return '<span class="ts-prev">new to the board</span>';
    var arrow = r.change === 'up' ? '▲' : r.change === 'down' ? '▼' : '·';
    var cls = r.change === 'up' ? 'ts-pos' : r.change === 'down' ? 'ts-neg' : '';
    var txt = arrow + ' ' + r.prev_score + ' · ' + ordinal(r.streak) + ' session' +
      (r.flip ? ' · <b>FLIP</b> from ' + esc(r.prev_rating) : '');
    return '<span class="ts-prev ' + cls + '">' + txt + '</span>';
  }

  function renderSectorChip() {
    var el = document.getElementById('sectorChip');
    if (!el) return;
    if (state.sector === 'All') { el.innerHTML = ''; return; }
    el.innerHTML = '<button type="button" class="ts-chipbtn" id="sectorChipBtn">Sector: ' +
      esc(state.sector) + ' ×</button>';
    document.getElementById('sectorChipBtn').addEventListener('click', function () {
      setSector('All');
    });
  }

  function renderBoard() {
    var rows = filteredRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var page = rows.slice(start, start + PAGE_SIZE);
    var html = '';
    page.forEach(function (r, i) {
      var chg = r.change_pct;
      html += '<tr class="ts-row" tabindex="0" data-sym="' + esc(r.symbol) + '"><td class="num">' + (start + i + 1) + '</td>' +
        '<td class="ts-sym">' + esc(r.symbol) + '</td>' +
        '<td class="ts-sector">' + esc(r.sector) + '</td>' +
        '<td class="num">' + fmt(r.close, 2) + '</td>' +
        '<td class="num ' + (chg > 0 ? 'ts-pos' : chg < 0 ? 'ts-neg' : '') + '">' + pct(chg) + '</td>' +
        '<td class="num"><span class="ts-score"><b>' + r.score + '</b>' +
        '<span class="ts-gauge"><i style="--pos:' + r.score + '%"></i></span>' + changeSub(r) + '</span></td>' +
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
    if (rows.length) {
      var end = Math.min(start + page.length, rows.length);
      document.getElementById('boardCount').textContent =
        'Showing ' + (start + 1) + '–' + end + ' of ' + rows.length +
        (rows.length === DATA.board.length ? ' scored stocks' : ' matching stocks') +
        ' · session ' + DATA.asof;
    } else {
      document.getElementById('boardCount').textContent =
        'No stocks match this filter · ' + DATA.board.length + ' scored stocks · session ' + DATA.asof;
    }
    renderPager(rows.length);
    renderSectorChip();
    var trs = document.querySelectorAll('#boardTable tr.ts-row');
    Array.prototype.forEach.call(trs, function (tr) {
      function toggle() {
        var sym = tr.getAttribute('data-sym');
        state.open = state.open === sym ? null : sym;
        renderBoard();
      }
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
    /* View-change handlers RE-BASELINE the refresh signature after render:
       the signature always describes the DATA on screen, so the next
       refresh compares against the truth instead of a stale value. */
    lastSig = signature(DATA);
  }

  function sectorEntries() {
    return Object.keys(DATA.summary.by_sector).map(function (k) {
      var s = DATA.summary.by_sector[k];
      return { sector: k, n: s.n, med: s.median_score, bull: s.bullish_rated, bear: s.bearish_rated };
    }).sort(function (a, b) { return b.med - a.med; });
  }

  function renderSectorCards() {
    var el = document.getElementById('sectorCards');
    if (!el) return;
    var s = DATA.summary;
    var cards = [{
      sector: 'All', n: s.symbols_scored, med: s.median_score,
      bull: s.rating_counts['Strong Buy'] + s.rating_counts['Buy'],
      bear: s.rating_counts['Sell'] + s.rating_counts['Strong Sell'],
      all: true
    }].concat(sectorEntries());
    el.innerHTML = cards.map(function (e) {
      var pressed = state.sector === e.sector ? 'true' : 'false';
      return '<button type="button" class="ts-seccard" data-sector="' + esc(e.sector) +
        '" aria-pressed="' + pressed + '">' +
        '<div class="ts-seccard-name">' + esc(e.all ? 'All sectors' : e.sector) + '</div>' +
        '<div class="ts-seccard-n">' + e.n + ' stocks</div>' +
        '<div class="ts-seccard-med">' + fmt(e.med, 0) + ' <small>median score</small></div>' +
        '<span class="ts-seccard-bar"><i style="width:' + e.med + '%"></i></span>' +
        '<div class="ts-seccard-counts"><span class="ts-pos">▲ ' + e.bull + ' bullish</span>' +
        '<span class="ts-neg">▼ ' + e.bear + ' bearish</span></div></button>';
    }).join('');
    var btns = el.querySelectorAll('.ts-seccard');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        setSector(b.getAttribute('data-sector'));
        document.getElementById('board').scrollIntoView();
      });
    });
  }

  /* Single funnel for sector changes: card, dropdown, or chip all land here,
     so the board, the dropdown, and the cards can never disagree. */
  function setSector(sector) {
    state.sector = sector;
    state.page = 1;
    state.open = null;
    var sel = document.getElementById('sectorSel');
    if (sel) sel.value = sector;
    renderBoard();
    renderSectorCards();
  }

  function renderHist() {
    var buckets = [];
    var i;
    for (i = 0; i < 10; i++) buckets.push(0);
    DATA.board.forEach(function (r) {
      var b = Math.min(9, Math.max(0, Math.floor(r.score / 10)));
      buckets[b]++;
    });
    var max = Math.max.apply(null, buckets);
    document.getElementById('scoreHist').innerHTML = buckets.map(function (n, b) {
      var lo = b * 10, hi = b === 9 ? 100 : lo + 9;
      return '<div class="ts-histcol"><div class="ts-histbar ' + bandCls(lo + 5) +
        '" style="height:' + (max ? Math.round(100 * n / max) : 0) + '%" title="' +
        lo + '–' + hi + ': ' + n + ' stocks"></div><span class="ts-histn">' + n +
        '</span><span class="ts-histlab">' + lo + '–' + hi + '</span></div>';
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

  function renderChanges() {
    var c = DATA.changes;
    var line = document.getElementById('changesLine');
    var body = document.getElementById('changesBody');
    if (!line || !body) return;
    if (!c || !c.prev_session) {
      line.textContent = 'Rating-change tracking starts with the next published board.';
      body.innerHTML = '<p class="ts-note">This board predates the archive, so there is no previous session to compare it with.</p>';
      return;
    }
    line.textContent = 'vs ' + c.prev_session + ': ' + c.upgraded + ' upgraded · ' +
      c.downgraded + ' downgraded · ' + c.held + ' held · ' + c.new + ' new · ' +
      c.flips.length + ' full Buy↔Sell flip' + (c.flips.length === 1 ? '' : 's');
    if (!c.flips.length) {
      body.innerHTML = '<p class="ts-note">No stock crossed from the Buy side to the Sell side (or back) in one step this session.</p>';
      return;
    }
    body.innerHTML = '<div class="cx-scroll ts-tablewrap"><table class="cx-table"><thead><tr>' +
      '<th>Symbol</th><th>From</th><th>To</th><th class="num">Score</th></tr></thead><tbody>' +
      c.flips.map(function (f) {
        return '<tr><td class="ts-sym">' + esc(f.symbol) + '</td><td>' + esc(f.from) +
          '</td><td>' + esc(f.to) + '</td><td class="num">' + f.prev_score + ' → ' + f.score + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function fmtRet(x) {
    if (x == null || isNaN(x)) return '—';
    return pct(x * 100);
  }

  function renderCohorts() {
    var co = DATA.cohorts;
    var el = document.getElementById('cohortBody');
    if (!el) return;
    if (!co || !co.latest) {
      el.innerHTML = '<p class="ts-note">No cohort is tracked yet — the first tracked session has no forward window behind it.</p>';
      return;
    }
    var lat = co.latest;
    var tracked = '<p class="ts-note">Forward tracking: ' +
      (co.sessions_tracked || 0) + ' sessions tracked · ' +
      (co.resolved_outcomes || 0) + ' resolved outcomes. Latest tracked session ' +
      esc(lat.asof) + ': ';
    ['Strong Buy', 'Strong Sell'].forEach(function (rating) {
      var cc = lat.cohorts[rating];
      tracked += esc(rating) + ' ' + cc.splits.all + ' stocks (flash ' + cc.splits.flash +
        ', 2nd session ' + (cc.splits.all - cc.splits.flash - cc.splits.persistent) +
        ', persistent ' + cc.splits.persistent + '). ';
      [5, 10].forEach(function (h) {
        var o = cc.outcomes.all[h];
        tracked += '+' + h + ': ' + (o.status === 'resolved'
          ? 'mean ' + fmtRet(o.mean) + ', spread ' + fmtRet(o.spread) + ' over ' + o.n + ' names'
          : 'pending — ' + o.sessions_to_go + ' more session' + (o.sessions_to_go === 1 ? '' : 's')) + '. ';
      });
    });
    tracked += '</p>';
    var agg = co.aggregate || {};
    var rows = '';
    ['Strong Buy', 'Strong Sell'].forEach(function (rating) {
      ['all', 'flash', 'persistent'].forEach(function (split) {
        [5, 10].forEach(function (h) {
          var a = agg[rating] && agg[rating][split] && agg[rating][split][h];
          rows += '<tr><td>' + esc(rating) + '</td><td>' + split + '</td><td class="num">' + h +
            '</td><td class="num">' + (a ? a.sessions : 0) + '</td><td class="num">' + (a ? a.members : 0) +
            '</td><td class="num">' + fmtRet(a ? a.mean_return : null) +
            '</td><td class="num">' + fmtRet(a ? a.mean_benchmark : null) +
            '</td><td class="num ' + ((a && a.mean_spread > 0) ? 'ts-pos' : (a && a.mean_spread < 0) ? 'ts-neg' : '') + '">' +
            fmtRet(a ? a.mean_spread : null) + '</td></tr>';
        });
      });
    });
    el.innerHTML = tracked +
      '<div class="cx-scroll ts-tablewrap"><table class="cx-table"><thead><tr>' +
      '<th>Cohort</th><th>Split</th><th class="num">Horizon</th><th class="num">Sessions</th>' +
      '<th class="num">Members</th><th class="num">Mean return</th><th class="num">Board mean</th>' +
      '<th class="num">Spread</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="ts-note">Read flash vs persistent, not just Strong Buy vs Strong Sell. A rating that ' +
      'appears for one session and flips the next is noise: the flash column measures exactly those ' +
      'one-day ratings, the persistent column measures ratings held 3+ sessions. Spreads are the ' +
      'cohort\'s mean return minus the whole board\'s equal-weight mean over the same window, averaged ' +
      'across resolved sessions. Nothing here is a recommendation — it is the measured record of what ' +
      'the ratings were worth, and the record is what any future change to the ratings must beat.</p>';
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
      ['Rating changes & cohorts', m.tracking],
      ['Reading it honestly', m.honesty]
    ].filter(function (b) { return !!b[1]; });
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

  function builtDate(iso) {
    if (!iso) return null;
    var d = iso.slice(0, 10).split('-');
    if (d.length !== 3) return null;
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(d[2], 10) + ' ' + (mon[parseInt(d[1], 10) - 1] || '') + ' ' + d[0];
  }

  function nptTime(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false
    }) + ' NPT';
  }

  /* Page-owned freshness line: the BOARD session, labelled distinctly from
     the shared chrome badge above it (which carries session state). */
  function updateFreshLine(note) {
    var el = document.getElementById('tsFresh');
    if (!el || !DATA) return;
    var built = builtDate(DATA.built_at);
    el.textContent = 'Board as of ' + DATA.asof + ' · ' + DATA.summary.symbols_scored +
      ' stocks scored' + (built ? ' · rebuilt ' + built : '') +
      ' · checked ' + nptTime(lastCheckMs) +
      ' · next check ' + nptTime(lastCheckMs + REFRESH_MS) +
      (note ? ' · ' + note : '');
  }

  /* Signature: cheap, sensitive to any board change (session, build time,
     row count, score sum, first/last row). */
  function signature(p) {
    if (!p) return '';
    var sum = 0, i;
    for (i = 0; i < p.board.length; i++) sum += p.board[i].score;
    var first = p.board[0] || {}, last = p.board[p.board.length - 1] || {};
    return [p.asof, p.built_at, p.board.length, sum,
      first.symbol, first.score, last.symbol, last.score].join('|');
  }

  function renderAll() {
    renderStats(DATA);
    renderVerdict(DATA);
    drawRatingSeg();
    renderBoard();
    renderHist();
    renderChanges();
    renderSectorCards();
    renderReplay();
    renderCohorts();
    renderHistory();
    renderMethod();
    lastSig = signature(DATA);
  }

  function drawRatingSeg() {
    var ratingOpts = ['All'].concat(RATINGS);
    seg(document.getElementById('ratingTabs'), ratingOpts, state.rating, function (v) {
      state.rating = v;
      state.page = 1;
      drawRatingSeg();
      renderBoard();
    });
  }

  function fetchPayload() {
    return fetch('/data/technical-signals.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function refreshTick() {
    if (document.hidden) return;
    fetchPayload().then(function (p) {
      lastCheckMs = Date.now();
      if (signature(p) === lastSig) {
        /* Unchanged payload: only the clock moves, the DOM is untouched. */
        updateFreshLine();
        return;
      }
      var keepPage = state.page;
      DATA = p;
      renderAll();
      if (keepPage <= Math.max(1, Math.ceil(filteredRows().length / PAGE_SIZE))) state.page = keepPage;
      renderBoard();
      updateFreshLine('board updated');
    }).catch(function () {
      lastCheckMs = Date.now();
      updateFreshLine('refresh failed — showing last board');
    });
  }

  function init(p) {
    DATA = p;
    lastCheckMs = Date.now();
    var sel = document.getElementById('sectorSel');
    var fromRows = {};
    p.board.forEach(function (r) { fromRows[r.sector] = true; });
    Object.keys(p.summary.by_sector).forEach(function (k) { fromRows[k] = true; });
    var sectors = Object.keys(fromRows).sort();
    sel.innerHTML = '<option value="All">All sectors</option>' +
      sectors.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
    sel.addEventListener('change', function () { setSector(sel.value); });
    document.getElementById('sortSel').addEventListener('change', function (e) {
      state.sort = e.target.value;
      state.page = 1;
      renderBoard();
    });
    document.getElementById('symSearch').addEventListener('input', function (e) {
      state.q = e.target.value.trim().toUpperCase();
      state.page = 1;
      renderBoard();
    });
    renderAll();
    updateFreshLine();
    setInterval(refreshTick, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - lastCheckMs >= REFRESH_MS - 5000) refreshTick();
    });
  }

  fetchPayload()
    .then(init)
    .catch(function (e) {
      document.getElementById('boardBody').innerHTML =
        '<tr><td colspan="8" class="ts-loading">The board could not be loaded (' + esc(e.message) + ').</td></tr>';
    });
})();
