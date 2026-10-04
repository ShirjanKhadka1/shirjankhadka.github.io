/**
 * js/nd-home.js — Concept 03 editorial homepage sections.
 * Renders index strip, market wrap, and newsroom from REAL data only.
 * No mock figures. Every number comes from live.json or news.json.
 */
(function () {
  'use strict';

  var LIVE_URL = '/nepse-chart/data/live.json';
  var NEWS_URL = '/nepse-chart/data/news.json';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(v, dp) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp
    });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------- Index strip ---------- */
  function renderStrip(indices) {
    var track = $('ndStripTrack');
    if (!track || !indices || !indices.length) return;
    // Order: NEPSE first, then sub-indices by absolute change
    var sorted = indices.slice().sort(function (a, b) {
      if (a.name === 'NEPSE') return -1;
      if (b.name === 'NEPSE') return 1;
      return Math.abs(b.percent_change || 0) - Math.abs(a.percent_change || 0);
    });
    track.innerHTML = sorted.map(function (ix) {
      var chg = Number(ix.percent_change) || 0;
      var cls = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
      var arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '·';
      var href = ix.name === 'NEPSE' ? '/nepse-chart/' : '/nepse-sectors/';
      return '<a class="nd-icard" href="' + href + '">' +
        '<div class="nm">' + esc(ix.name) + '</div>' +
        '<div class="vl">' + fmtNum(ix.value) + '</div>' +
        '<div class="ch ' + cls + '">' + arrow + ' ' + (chg > 0 ? '+' : '') + chg.toFixed(2) + '%</div>' +
        '</a>';
    }).join('');
    var prev = $('ndStripPrev'), next = $('ndStripNext');
    if (prev) prev.onclick = function () { track.scrollBy({ left: -320, behavior: 'smooth' }); };
    if (next) next.onclick = function () { track.scrollBy({ left: 320, behavior: 'smooth' }); };
  }

  /* ---------- Market Wrap (generated from real session data) ---------- */
  function renderWrap(live) {
    var host = $('ndWrap');
    if (!host || !live || !live.index) return;
    var ix = live.index;
    var chg = Number(ix.change) || 0;
    var pct = Number(ix.percent_change) || 0;
    var dir = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
    var sessDate = '';
    try {
      var d = new Date((live.data_asof || live.asof));
      sessDate = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
    } catch (e) {}
    // Leading/lagging sectors from indices
    var sectors = (live.indices || []).filter(function (x) {
      return x.name !== 'NEPSE' && x.name !== 'Sensitive' && x.name !== 'Float' && x.name !== 'Sensitive Float';
    });
    sectors.sort(function (a, b) { return (b.percent_change || 0) - (a.percent_change || 0); });
    var leaders = sectors.slice(0, 2).map(function (x) { return x.name; }).join(' and ');
    var laggards = sectors.slice(-2).map(function (x) { return x.name; }).join(' and ');
    var leadPct = sectors.length ? Number(sectors[0].percent_change || 0) : 0;
    var lagPct = sectors.length ? Number(sectors[sectors.length - 1].percent_change || 0) : 0;

    // Market breadth
    var quotes = live.quotes || [];
    var adv = 0, dec = 0;
    quotes.forEach(function (q) {
      var pc = Number(q.percent_change);
      if (pc > 0) adv++; else if (pc < 0) dec++;
    });
    var breadthTxt = adv > dec ? 'advancers outnumbered decliners' : dec > adv ? 'decliners outnumbered advancers' : 'advancers and decliners were evenly split';

    // Dynamic headline based on actual close — direction word gets color-coded span (not escaped)
    var dirCls = chg > 0 ? 'dir-up' : chg < 0 ? 'dir-dn' : '';
    var dirWord = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
    var dirSpan = dirCls ? '<span class="' + dirCls + '">' + dirWord + '</span>' : dirWord;
    var headlineHtml = 'NEPSE closes ' + dirSpan;
    var mag = Math.abs(pct);
    if (mag >= 2) headlineHtml += ' sharply';
    else if (mag >= 1) headlineHtml += ' firmly';
    else if (mag >= 0.5) headlineHtml += ' moderately';
    headlineHtml += ' at ' + esc(fmtNum(ix.value));
    if (chg > 0 && leaders) headlineHtml += ' as ' + esc(leaders.toLowerCase()) + ' lead';
    else if (chg < 0 && laggards) headlineHtml += ' as ' + esc(laggards.toLowerCase()) + ' drag';

    var body1 = 'The NEPSE index closed at <strong>' + esc(fmtNum(ix.value)) + '</strong> (' +
      (chg > 0 ? '+' : '') + esc(fmtNum(chg)) + ' points, ' +
      (pct > 0 ? '+' : '') + pct.toFixed(2) + '%). ';
    if (chg > 0) {
      body1 += 'Bulls were in control as ' + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + '). ';
      if (leaders) body1 += 'Strength came from <strong>' + esc(leaders) + '</strong> shares' + (leadPct ? ' (up ' + leadPct.toFixed(2) + '%)' : '') + '. ';
    } else if (chg < 0) {
      body1 += 'Bears dominated as ' + esc(breadthTxt) + ' (<strong>' + dec + '</strong> vs ' + adv + '). ';
      if (laggards) body1 += 'Weakness was concentrated in <strong>' + esc(laggards) + '</strong>' + (lagPct ? ' (down ' + Math.abs(lagPct).toFixed(2) + '%)' : '') + '. ';
      if (leaders && leadPct > 0) body1 += esc(leaders) + ' declined the least' + ' (+' + leadPct.toFixed(2) + '%). ';
    } else {
      body1 += 'The market ended flat as ' + esc(breadthTxt) + '. ';
    }
    body1 += 'Day range: <strong>' + esc(fmtNum(ix.low)) + ' – ' + esc(fmtNum(ix.high)) + '</strong>.';

    host.innerHTML =
      '<div class="nd-badges">' +
        '<span class="nd-badge lime">Market Wrap</span>' +
        '<span class="nd-badge">' + esc(sessDate) + '</span>' +
        '<span class="nd-badge ' + (chg > 0 ? 'lime' : chg < 0 ? 'amber' : '') + '">' +
          (chg > 0 ? '▲ GREEN CLOSE' : chg < 0 ? '▼ RED CLOSE' : '· FLAT CLOSE') + '</span>' +
      '</div>' +
      '<h2 class="nd-wraphead">' + headlineHtml + '</h2>' +
      '<div class="nd-wrapbody"><p>' + body1 + '</p>' +
      '<p>All figures below are the official session close. Quotes refresh during market hours; ' +
      'outside hours the last close is shown.</p></div>' +
      '<div class="nd-wrapmeta"><strong>Nepse Decode Desk</strong> · Data as of ' + esc(sessDate) + ' · Source: NEPSE</div>' +
      '<a class="nd-btn-lime" href="/nepse-daily/">See today\'s market →</a>';
  }

  /* ---------- NEPSE index card ---------- */
  var SPARK_URL = '/nepse-chart/data/index-spark.json';
  var sparkData = null;

  function sparklineSVG(closes, w, h) {
    if (!closes || closes.length < 2) return '';
    var vals = closes.map(function (c) { return c[1]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var rng = (max - min) || 1;
    var pts = vals.map(function (v, i) {
      var x = (i / (vals.length - 1)) * w;
      var y = h - ((v - min) / rng) * (h - 8) - 4;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var up = vals[vals.length - 1] >= vals[0];
    var col = up ? '#4ade80' : '#f87171';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="120" preserveAspectRatio="none" role="img" aria-label="NEPSE index trend">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="2"/>' +
      '<circle cx="' + w + '" cy="' + (h - ((vals[vals.length-1] - min) / rng) * (h - 8) - 4).toFixed(1) + '" r="4" fill="' + col + '"/></svg>';
  }

  function renderIndexCard(live) {
    var host = $('ndIxCard');
    if (!host || !live || !live.index) return;
    var ix = live.index;
    var chg = Number(ix.change) || 0;
    var pct = Number(ix.percent_change) || 0;
    var cls = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
    var arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '·';
    // 52w from spark data - be honest about the actual range
    var w52lo = 'Unavailable', w52hi = 'Unavailable', w52note = '';
    if (sparkData && sparkData.closes && sparkData.closes.length) {
      var vals = sparkData.closes.map(function (c) { return c[1]; });
      w52lo = fmtNum(Math.min.apply(null, vals));
      w52hi = fmtNum(Math.max.apply(null, vals));
      w52note = sparkData.closes.length + ' closes on record';
    }
    var spark = sparkData ? sparklineSVG(sparkData.closes.slice(-30), 600, 120) : '';

    // Market breadth from quotes
    var quotes = live.quotes || [];
    var adv = 0, dec = 0, unc = 0;
    quotes.forEach(function (q) {
      var pc = Number(q.percent_change);
      if (!isFinite(pc)) return;
      if (pc > 0) adv++; else if (pc < 0) dec++; else unc++;
    });

    // Day range beam with gradient
    var dayLo = Number(ix.low), dayHi = Number(ix.high), dayVal = Number(ix.value);
    var dayBeam = '';
    if (isFinite(dayLo) && isFinite(dayHi) && isFinite(dayVal) && dayHi > dayLo) {
      var pos = ((dayVal - dayLo) / (dayHi - dayLo) * 100).toFixed(1);
      var beamCls = chg >= 0 ? 'up' : 'dn';
      dayBeam = '<div class="nd-range"><div class="nd-range-beam ' + beamCls + '">' +
        '<div class="nd-range-marker" style="left:' + pos + '%"></div></div>' +
        '<div class="nd-range-labels"><span>' + fmtNum(dayLo) + '</span><span>' + fmtNum(dayHi) + '</span></div></div>';
    }

    // Session range beam (from spark data range) — dates are YYYYMMDD ints
    function fmtYMD(ymd) {
      var s = String(ymd);
      if (/^\d{8}$/.test(s)) {
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return parseInt(s.slice(6, 8), 10) + ' ' + months[parseInt(s.slice(4, 6), 10) - 1] + ' ' + s.slice(0, 4);
      }
      return s;
    }
    var sessBeam = '', sessDates = '';
    if (sparkData && sparkData.closes && sparkData.closes.length > 1) {
      var sVals = sparkData.closes.map(function (c) { return c[1]; });
      var sLo = Math.min.apply(null, sVals), sHi = Math.max.apply(null, sVals);
      var sPos = ((dayVal - sLo) / ((sHi - sLo) || 1) * 100).toFixed(1);
      var sCls = chg >= 0 ? 'up' : 'dn';
      sessBeam = '<div class="nd-range"><div class="nd-range-beam ' + sCls + '">' +
        '<div class="nd-range-marker" style="left:' + Math.max(0, Math.min(100, sPos)) + '%"></div></div>' +
        '<div class="nd-range-labels"><span>Low <strong>' + esc(fmtNum(sLo)) + '</strong></span><span>High <strong>' + esc(fmtNum(sHi)) + '</strong></span></div></div>';
      sessDates = fmtYMD(sparkData.closes[0][0]) + ' → ' + fmtYMD(sparkData.closes[sparkData.closes.length - 1][0]) + ' · ' + sparkData.closes.length + ' closes';
    }
    // Day beam labels with Low/High
    dayBeam = dayBeam.replace('<span>' + fmtNum(dayLo) + '</span>', '<span>Low <strong>' + esc(fmtNum(dayLo)) + '</strong></span>')
                     .replace('<span>' + fmtNum(dayHi) + '</span>', '<span>High <strong>' + esc(fmtNum(dayHi)) + '</strong></span>');
    var sessDateShort = '';
    try { sessDateShort = 'session ' + new Date((live.data_asof || live.asof)).toISOString().slice(0, 10); } catch (e) {}
    var chgLabel = sessDateShort ? sessDateShort.replace('session ', '') : 'last session';

    // Aggregate real totals from quotes (index object lacks these fields)
    var totTurn = 0, totVol = 0, totTrades = 0;
    quotes.forEach(function (q) {
      totTurn += Number(q.turnover) || 0;
      totVol += Number(q.volume) || 0;
      totTrades += Number(q.trades) || 0;
    });

    host.innerHTML =
      '<div class="lbl"><span>NEPSE INDEX</span><span class="nd-badge amber">' + esc(live.market || '—') + '</span></div>' +
      '<div class="big">' + fmtNum(ix.value) + '</div>' +
      '<div class="chg ' + cls + '">' + arrow + ' ' + (chg > 0 ? '+' : '') + fmtNum(chg) +
        ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%) · ' + esc(chgLabel) + '</div>' +
      spark +
      '<div class="tabs" role="group" aria-label="Chart timeframe">' +
        '<button class="on" data-tf="1D">1D</button><button data-tf="1W">1W</button>' +
        '<button data-tf="1M">1M</button><button data-tf="3M">3M</button><button data-tf="1Y">1Y</button>' +
      '</div>' +
      '<div class="nd-ixsearch"><input type="text" id="ndIxSearch" placeholder="Search any symbol, e.g. NABIL" aria-label="Search symbol"><button onclick="var v=document.getElementById(\'ndIxSearch\').value.trim().toUpperCase();if(v)location.href=\'/stocks/\'+encodeURIComponent(v)+\'/\'">Search</button></div>' +
      '<div class="nd-ixfoot"><span class="nd-badge amber">CLOSING FIGURES</span>' +
      '<span class="note">Quotes are delayed during trading hours; figures shown are the last close when the market is shut.</span></div>';
    // Tab switching filters sparkline range
    var tabs = host.querySelectorAll('.tabs button');
    tabs.forEach(function (btn) {
      btn.onclick = function () {
        tabs.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        if (!sparkData) return;
        var tf = btn.getAttribute('data-tf');
        // 1D shows the full available range (single session = single point, show all)
        var n = { '1D': sparkData.closes.length, '1W': 5, '1M': 22, '3M': 66, '1Y': 250 }[tf] || 30;
        var svg = host.querySelector('.spark');
        if (svg) svg.outerHTML = sparklineSVG(sparkData.closes.slice(-n), 600, 120);
      };
    });
  }

  /* ---------- Biggest moves ---------- */
  function fmtCrore(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    var cr = Number(v) / 10000000;
    if (cr >= 1) return 'Rs ' + cr.toFixed(2) + ' crore';
    var lk = Number(v) / 100000;
    return 'Rs ' + lk.toFixed(2) + ' lakh';
  }
  function renderMoves(quotes, sessDate) {
    var gb = $('ndGainersBody'), lb = $('ndLosersBody');
    if (!gb || !lb || !quotes || !quotes.length) return;
    var valid = quotes.filter(function (q) { return q.percent_change != null && isFinite(Number(q.percent_change)); });
    var gainers = valid.slice().sort(function (a, b) { return b.percent_change - a.percent_change; }).slice(0, 5);
    var losers = valid.slice().sort(function (a, b) { return a.percent_change - b.percent_change; }).slice(0, 5);
    function row(q, isUp) {
      var pct = Number(q.percent_change);
      var arrow = isUp ? '▲' : '▼';
      var cls = isUp ? 'up' : 'dn';
      return '<tr><td class="sym"><a href="/stocks/' + esc(q.symbol) + '/">' + esc(q.symbol) + '</a></td>' +
        '<td class="num">' + fmtNum(q.ltp) + '</td>' +
        '<td class="num ' + cls + '">' + arrow + ' ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</td>' +
        '<td class="num">' + fmtCrore(q.turnover) + '</td></tr>';
    }
    gb.innerHTML = gainers.map(function (q) { return row(q, true); }).join('');
    lb.innerHTML = losers.map(function (q) { return row(q, false); }).join('');
    var ds = $('ndGainersDate'), dl = $('ndLosersDate'), ms = $('ndMovesSub');
    if (ds) ds.textContent = sessDate || '';
    if (dl) dl.textContent = sessDate || '';
    if (ms && sessDate) ms.textContent = 'Ranked by % change · last session · closing figures from ' + sessDate;
  }

  /* ---------- Newsroom ---------- */
  function renderNewsroom(items) {
    var host = $('ndNewsGrid');
    if (!host || !items || !items.length) return;
    // Categorize: markets / companies / economy (simple keyword buckets)
    var cats = { Markets: [], Companies: [], 'Economy & Policy': [] };
    items.forEach(function (n) {
      var t = ((n.title || '') + ' ' + (n.summary || '')).toLowerCase();
      if (/nrb|sebon|policy|economy|remittance|ipo|government|budget/.test(t)) cats['Economy & Policy'].push(n);
      else if (/hydropower|bank|insurance|finance|company|ltd|dividend|bonus/.test(t)) cats.Companies.push(n);
      else cats.Markets.push(n);
    });
    host.innerHTML = Object.keys(cats).map(function (cat) {
      var list = cats[cat].slice(0, 4);
      if (!list.length) return '';
      return '<div class="nd-newscard"><div class="cat"><span class="dot"></span>' + esc(cat) + '</div>' +
        list.map(function (n) {
          var href = n.url || n.link || '/nepse-news/';
          var time = n.published || n.date || '';
          var tag = (n.tags && n.tags[0]) || (n.symbol || '');
          return '<div class="nd-newsitem"><a href="' + esc(href) + '">' +
            '<div class="t">' + esc(n.title || 'Untitled') + '</div>' +
            '<div class="m"><span>' + esc(time) + '</span>' +
            (tag ? '<span class="tag">' + esc(String(tag).toUpperCase()) + '</span>' : '') +
            '</div></a></div>';
        }).join('') + '</div>';
    }).join('');
  }

  /* ---------- Most active ---------- */
  var activeQuotes = [];
  var activeMetric = 'turnover';
  function renderActive() {
    var body = $('ndActiveBody'), title = $('ndActiveTitle'), colHead = $('ndActiveColHead');
    if (!body || !activeQuotes.length) return;
    var metric = activeMetric;
    var sorted = activeQuotes.slice().filter(function (q) {
      var v = metric === 'turnover' ? q.turnover : metric === 'volume' ? q.volume : q.trades;
      return v != null && isFinite(Number(v)) && Number(v) > 0;
    });
    sorted.sort(function (a, b) {
      var va = metric === 'turnover' ? a.turnover : metric === 'volume' ? a.volume : a.trades;
      var vb = metric === 'turnover' ? b.turnover : metric === 'volume' ? b.volume : b.trades;
      return Number(vb) - Number(va);
    });
    var top = sorted.slice(0, 7);
    var titles = { turnover: 'By turnover', volume: 'By traded shares', transactions: 'By transactions' };
    var heads = { turnover: 'TURNOVER', volume: 'SHARES', transactions: 'TXNS' };
    if (title) title.textContent = titles[metric] || '';
    if (colHead) colHead.textContent = heads[metric] || '';
    body.innerHTML = top.map(function (q) {
      var v = metric === 'turnover' ? q.turnover : metric === 'volume' ? q.volume : q.trades;
      var vTxt = metric === 'turnover' ? fmtCrore(v) : Number(v).toLocaleString('en-IN');
      var pct = Number(q.percent_change) || 0;
      var cls = pct > 0 ? 'up' : pct < 0 ? 'dn' : '';
      return '<tr><td class="sym"><a href="/stocks/' + esc(q.symbol) + '/">' + esc(q.symbol) + '</a></td>' +
        '<td class="num">' + vTxt + '</td>' +
        '<td class="num ' + cls + '">' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</td>' +
        '<td class="num">' + fmtNum(q.ltp) + '</td></tr>';
    }).join('');
    // Tab switching
    var tabs = document.querySelectorAll('.nd-active-tabs button');
    // Map homepage metric -> daily page sort preset
    var metricToSort = { turnover: 'turnover', volume: 'volume', transactions: 'transactions' };
    // Scope to the Most Active card (there are multiple .nd-seemore links on the page)
    var activeTitle = document.getElementById('ndActiveTitle');
    var seemore = activeTitle ? activeTitle.parentElement.querySelector('.nd-seemore') : null;
    tabs.forEach(function (btn) {
      btn.onclick = function () {
        tabs.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        activeMetric = btn.getAttribute('data-metric');
        if (seemore && metricToSort[activeMetric]) {
          seemore.setAttribute('href', '/nepse-daily/?sort=' + metricToSort[activeMetric] + '#all-stocks');
        }
        renderActive();
      };
    });
  }

  /* ---------- Market Pulse + Engine Verdicts ---------- */
  function renderPulseEngine(quotes, sessDate) {
    var pulseHost = $('ndPulseList'), engineHost = $('ndEngineList');
    if (!quotes || !quotes.length) return;

    // Market Pulse: top 6 by turnover
    if (pulseHost) {
      var byTurnover = quotes.slice()
        .filter(function (q) { return q.turnover && Number(q.turnover) > 0; })
        .sort(function (a, b) { return Number(b.turnover) - Number(a.turnover); })
        .slice(0, 6);
      pulseHost.innerHTML = byTurnover.map(function (q, i) {
        var pct = Number(q.percent_change) || 0;
        var cls = pct > 0 ? 'up' : pct < 0 ? 'dn' : '';
        return '<a class="nd-pulse-item" href="/stocks/' + esc(q.symbol) + '/">' +
          '<span class="rank">' + (i + 1) + '</span>' +
          '<div class="info"><div class="sym">' + esc(q.symbol) + '</div>' +
          '<div class="meta">Rs ' + fmtNum(q.ltp) + ' · <span class="' + cls + '">' +
          (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</span> · ' + fmtCrore(q.turnover) + '</div></div></a>';
      }).join('');
      var ps = $('ndPulseSub');
      if (ps && sessDate) ps.textContent = 'Ranked by live turnover · session of ' + sessDate;
    }

    // Engine Verdicts: fetch from verdicts.json if available
    if (engineHost) {
      fetchJSON('/nepse-chart/data/verdicts.json').then(function (v) {
        var raw = Array.isArray(v) ? v : (v.verdicts || v.data || []);
        // verdicts.json uses {SYMBOL: {v, s, ...}} object format — normalize to array
        var verdicts = Array.isArray(raw) ? raw : Object.keys(raw).map(function (sym) {
          var x = raw[sym] || {};
          return { symbol: sym, verdict: x.v || x.verdict, score: (x.s != null ? x.s : x.score) };
        });
        if (!verdicts.length) {
          engineHost.innerHTML = '<p class="nd-pe-sub">Verdicts updating…</p>';
          return;
        }
        // Top 4 buys and top 4 exits
        var buys = verdicts.filter(function (x) { return /buy/i.test(x.verdict || ''); })
          .sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 4);
        var exits = verdicts.filter(function (x) { return /exit|sell/i.test(x.verdict || ''); })
          .sort(function (a, b) { return (a.score || 0) - (b.score || 0); }).slice(0, 4);
        var html = '';
        if (buys.length) {
          html += '<div class="nd-eyebrow" style="margin-bottom:8px">Strongest buys</div>';
          html += buys.map(function (x) {
            return '<div class="nd-engine-item"><span class="sym">' + esc(x.symbol) + '</span>' +
              '<span class="score">score ' + esc(String(x.score)) + '</span>' +
              '<span class="nd-verdict buy">' + esc(x.verdict) + '</span></div>';
          }).join('');
        }
        if (exits.length) {
          html += '<div class="nd-eyebrow" style="margin:12px 0 8px">Strongest exits</div>';
          html += exits.map(function (x) {
            return '<div class="nd-engine-item"><span class="sym">' + esc(x.symbol) + '</span>' +
              '<span class="score">score ' + esc(String(x.score)) + '</span>' +
              '<span class="nd-verdict exit">' + esc(x.verdict) + '</span></div>';
          }).join('');
        }
        engineHost.innerHTML = html || '<p class="nd-pe-sub">No verdicts available.</p>';
        var es = $('ndEngineSub');
        if (es) es.textContent = 'Batch of ' + sessDate + ' · ' + verdicts.length + ' securities scored · Not investment advice';
      }).catch(function () {
        engineHost.innerHTML = '<p class="nd-pe-sub">Verdicts unavailable.</p>';
      });
    }
  }

  /* ---------- Init ---------- */
  function init() {
    if (!$('ndStripTrack') && !$('ndWrap') && !$('ndNewsGrid')) return;
    // Fetch spark data first for the index card chart
    fetchJSON(SPARK_URL).then(function (sp) { sparkData = sp; }).catch(function () {}).then(function () {
      fetchJSON(LIVE_URL).then(function (live) {
        renderStrip(live.indices);
        renderWrap(live);
        renderIndexCard(live);
        var sessDate = '';
        try {
          var d = new Date((live.data_asof || live.asof));
          sessDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
        } catch (e) {}
        renderMoves(live.quotes, sessDate);
        activeQuotes = live.quotes || [];
        renderActive();
        renderPulseEngine(live.quotes, sessDate);
        var as = $('ndActiveSub');
        if (as && sessDate) as.textContent = 'Ranked by trading activity · session of ' + sessDate;
      }).catch(function () {});
    });
    fetchJSON(NEWS_URL).then(function (news) {
      var items = Array.isArray(news) ? news : (news.items || news.news || []);
      renderNewsroom(items);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
