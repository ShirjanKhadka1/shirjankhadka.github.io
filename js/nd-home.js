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
  // True trading session date: derived from market-data timestamps, NOT the fetch time.
  // live.asof / data_asof are when the pipeline fetched (a refresh can land on a weekend);
  // the session is when the market actually traded.
  // Priority: session_date (authoritative trading day) -> data_asof -> index last_updated -> quote last_updated -> asof fallback.
  function getSessionDate(live) {
    if (live && live.session_date) {
      var sd = new Date(live.session_date + 'T12:00:00+05:45');
      if (isFinite(sd.getTime())) return sd;
    }
    if (live && live.data_asof) return new Date(live.data_asof);
    var ts = null;
    if (live) {
      var idx = live.indices || [];
      for (var i = 0; i < idx.length; i++) {
        if (idx[i] && idx[i].last_updated) {
          var t = new Date(idx[i].last_updated).getTime();
          if (isFinite(t) && (ts == null || t > ts)) ts = t;
        }
      }
      if (ts == null) {
        var qs = live.quotes || [];
        for (var j = 0; j < qs.length; j++) {
          if (qs[j] && qs[j].last_updated) {
            var t2 = new Date(qs[j].last_updated).getTime();
            if (isFinite(t2) && (ts == null || t2 > ts)) ts = t2;
          }
        }
      }
    }
    if (ts != null) return new Date(ts);
    return live && live.asof ? new Date(live.asof) : new Date();
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

  /**
   * P1.3: Get live data via shared NepseData module (dedupes fetches).
   * Falls back to direct fetch if NepseData is unavailable.
   */
  function getLive() {
    if (typeof window !== 'undefined' && window.NepseData && window.NepseData.whenReady) {
      return window.NepseData.whenReady();
    }
    return fetchJSON(LIVE_URL);
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
    // Live wording follows the feed's own market flag — the same value the
    // index-card pill shows, so the editorial can never contradict it.
    var isLive = !!(live.market === 'OPEN');
    var chg = Number(ix.change) || 0;
    var pct = Number(ix.percent_change) || 0;
    var dir = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
    var sessDate = '';
    try {
      var d = getSessionDate(live);
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
    // Breadth always prints its universe (the quotes in the snapshot).
    var breadthTotal = quotes.length;
    var breadthDir = adv > dec ? 1 : dec > adv ? -1 : 0;

    // Dynamic headline based on actual close — direction word gets color-coded span (not escaped)
    var dirCls = chg > 0 ? 'dir-up' : chg < 0 ? 'dir-dn' : '';
    var dirWord = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
    var dirSpan = dirCls ? '<span class="' + dirCls + '">' + dirWord + '</span>' : dirWord;
    var headlineHtml = (isLive ? 'NEPSE trading ' : 'NEPSE closes ') + dirSpan;
    var mag = Math.abs(pct);
    if (mag >= 2) headlineHtml += ' sharply';
    else if (mag >= 1) headlineHtml += ' firmly';
    else if (mag >= 0.5) headlineHtml += ' moderately';
    headlineHtml += ' at ' + esc(fmtNum(ix.value));
    if (chg > 0 && leaders) headlineHtml += ' as ' + esc(leaders.toLowerCase()) + ' lead';
    else if (chg < 0 && laggards) headlineHtml += ' as ' + esc(laggards.toLowerCase()) + ' drag';

    var body1 = (isLive ? 'The NEPSE index is trading at <strong>' : 'The NEPSE index closed at <strong>') + esc(fmtNum(ix.value)) + '</strong> (' +
      (chg > 0 ? '+' : '') + esc(fmtNum(chg)) + ' points, ' +
      (pct > 0 ? '+' : '') + pct.toFixed(2) + '%). ';
    if (chg > 0) {
      // Breadth drives the sentence when it disagrees with the index.
      if (breadthDir < 0) body1 += (isLive ? 'The index is rising on narrow breadth as ' : 'The index rose on narrow breadth as ') + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + ' of ' + breadthTotal + ' traded scrips). ';
      else if (breadthDir > 0) body1 += (isLive ? 'Bulls are in control as ' : 'Bulls were in control as ') + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + ' of ' + breadthTotal + ' traded scrips). ';
      else body1 += (isLive ? 'The index is up with ' : 'The index rose with ') + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + ' of ' + breadthTotal + ' traded scrips). ';
      if (leaders) body1 += (isLive ? 'Strength is coming from <strong>' : 'Strength came from <strong>') + esc(leaders) + '</strong> shares' + (leadPct ? ' (up ' + leadPct.toFixed(2) + '%)' : '') + '. ';
    } else if (chg < 0) {
      if (breadthDir > 0) body1 += (isLive ? 'The index is falling despite positive breadth as ' : 'The index fell despite positive breadth as ') + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + ' of ' + breadthTotal + ' traded scrips). ';
      else if (breadthDir < 0) body1 += (isLive ? 'Bears are dominating as ' : 'Bears dominated as ') + esc(breadthTxt) + ' (<strong>' + dec + '</strong> vs ' + adv + ' of ' + breadthTotal + ' traded scrips). ';
      else body1 += (isLive ? 'The index is down with ' : 'The index fell with ') + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + ' of ' + breadthTotal + ' traded scrips). ';
      if (laggards) body1 += (isLive ? 'Weakness is concentrated in <strong>' : 'Weakness was concentrated in <strong>') + esc(laggards) + '</strong>' + (lagPct ? ' (down ' + Math.abs(lagPct).toFixed(2) + '%)' : '') + '. ';
      if (leaders && leadPct > 0) body1 += esc(leaders) + (isLive ? ' have declined the least' : ' declined the least') + ' (+' + leadPct.toFixed(2) + '%). ';
    } else {
      body1 += (isLive ? 'The market is flat as ' : 'The market ended flat as ') + esc(breadthTxt) + ' (<strong>' + adv + '</strong> vs ' + dec + ' of ' + breadthTotal + ' traded scrips). ';
    }
    body1 += (isLive ? 'Day range so far: <strong>' : 'Day range: <strong>') + esc(fmtNum(ix.low)) + ' – ' + esc(fmtNum(ix.high)) + '</strong>.';

    host.innerHTML =
      '<div class="nd-badges">' +
        '<span class="nd-badge lime">Market Wrap</span>' +
        '<span class="nd-badge">' + esc(sessDate) + '</span>' +
        '<span class="nd-badge ' + (chg > 0 ? 'lime' : chg < 0 ? 'amber' : '') + '">' +
          (isLive
            ? (chg > 0 ? '▲ LIVE' : chg < 0 ? '▼ LIVE' : '· LIVE')
            : (chg > 0 ? '▲ GREEN CLOSE' : chg < 0 ? '▼ RED CLOSE' : '· FLAT CLOSE')) + '</span>' +
      '</div>' +
      '<h2 class="nd-wraphead">' + headlineHtml + '</h2>' +
      '<div class="nd-wrap-chips" aria-label="Market breadth">' +
        '<span class="nd-wchip up">' + adv + ' advancers</span>' +
        '<span class="nd-wchip dn">' + dec + ' decliners</span>' +
        '<span class="nd-wchip">' + breadthTotal + ' traded scrips</span>' +
        '<span class="nd-wchip">' + esc(fmtNum(ix.value)) + '</span>' +
      '</div>' +
      '<div class="nd-wrapbody"><p>' + body1 + '</p>' +
      '<p>' + (isLive
        ? 'Figures are live intraday and refresh during market hours; the official close prints at 15:00 NPT.'
        : 'All figures below are the official session close. Quotes refresh during market hours; ' +
          'outside hours the last close is shown.') + '</p></div>' +
      (function () {
        var lo = Number(ix.low), hi = Number(ix.high), vl = Number(ix.value);
        if (!(isFinite(lo) && isFinite(hi) && isFinite(vl) && hi > lo)) return '';
        var pos = ((vl - lo) / (hi - lo) * 100).toFixed(1);
        var beamCls = chg >= 0 ? 'up' : 'dn';
        return '<div class="nd-wrap-range"><div class="nd-wr-labels"><span>Day range</span><span>' +
          esc(fmtNum(lo)) + ' – ' + esc(fmtNum(hi)) + '</span></div>' +
          '<div class="nd-wr-beam ' + beamCls + '"><div class="nd-wr-marker" style="left:' + pos + '%"></div></div></div>';
      })() +
      '<div class="nd-wrapmeta"><strong>Nepse Decode Desk</strong> · Data as of ' + esc(sessDate) + ' · Source: NEPSE</div>' +
      '<div class="nd-wrap-actions">' +
        '<a class="nd-btn-lime" href="/nepse-daily/">See today\'s market →</a>' +
        '<a class="nd-link-more" href="/nepse-decode/wrap/">Every session’s wrap →</a>' +
      '</div>' +
      '<div class="nd-wrap-breadth"><div class="nd-wb-labels"><span>Breadth mix</span><span>' + adv + ' up · ' + dec + ' down · ' + (breadthTotal - adv - dec) + ' flat</span></div>' +
      breadthBarHTML(adv, dec, breadthTotal - adv - dec) + '</div>';
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
    try { sessDateShort = 'session ' + getSessionDate(live).toISOString().slice(0, 10); } catch (e) {}
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
    function row(q, isUp, i, maxAbs) {
      var pct = Number(q.percent_change);
      var arrow = isUp ? '▲' : '▼';
      var w = maxAbs > 0 ? Math.max(4, Math.round(Math.abs(pct) / maxAbs * 100)) : 0;
      return '<a class="cx-rank-row" href="/stocks/' + esc(q.symbol) + '/">' +
        '<span class="cx-rank-n">' + (i + 1) + '</span>' +
        '<span class="cx-rank-sym">' + esc(q.symbol) +
        '<span class="cx-rank-sub">Rs ' + fmtNum(q.ltp) + ' · ' + fmtCrore(q.turnover) + '</span></span>' +
        '<span class="cx-chip ' + (isUp ? 'up' : 'down') + '">' + arrow + ' ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</span>' +
        '<span class="cx-rank-track"><span class="cx-rank-fill ' + (isUp ? 'up' : 'down') + '" style="--w:' + w + '%"></span></span></a>';
    }
    var gMax = gainers.length ? Math.abs(Number(gainers[0].percent_change)) : 0;
    var lMax = losers.length ? Math.abs(Number(losers[0].percent_change)) : 0;
    gb.innerHTML = gainers.map(function (q, i) { return row(q, true, i, gMax); }).join('');
    lb.innerHTML = losers.map(function (q, i) { return row(q, false, i, lMax); }).join('');
    var ds = $('ndGainersDate'), dl = $('ndLosersDate'), ms = $('ndMovesSub');
    if (ds) ds.textContent = sessDate || '';
    if (dl) dl.textContent = sessDate || '';
    if (ms && sessDate) ms.textContent = 'Ranked by % change · last session · closing figures from ' + sessDate;
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
      var cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
      var topV = Number(top[0] ? (metric === 'turnover' ? top[0].turnover : metric === 'volume' ? top[0].volume : top[0].trades) : 0);
      var share = topV > 0 ? Math.max(3, Math.round(Number(v) / topV * 100)) : 0;
      return '<tr><td class="sym"><a href="/stocks/' + esc(q.symbol) + '/">' + esc(q.symbol) + '</a></td>' +
        '<td class="num">' + vTxt + '</td>' +
        '<td><span class="cx-prop"><span class="cx-prop-track"><span class="cx-prop-fill" style="--w:' + share + '%"></span></span></span></td>' +
        '<td class="num"><span class="cx-chip ' + cls + '">' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</span></td>' +
        '<td class="num">' + fmtNum(q.ltp) + '</td></tr>';
    }).join('');
    // Tab switching
    var tabs = document.querySelectorAll('.nd-active-tabs button');
    // Map homepage metric -> daily page sort preset
    var metricToSort = { turnover: 'turnover', volume: 'volume', transactions: 'transactions' };
    // Scope to the Most Active card (there are multiple .nd-seemore links on the page)
    var activeTitle = document.getElementById('ndActiveTitle');
    var seemore = activeTitle ? activeTitle.parentElement.querySelector('.nd-seemore') : null;
    tabs.forEach(function (btn, i) {
      btn.onclick = function () {
        tabs.forEach(function (b) {
          b.classList.remove('on');
          b.setAttribute('aria-selected', 'false');
          b.setAttribute('tabindex', '-1');
        });
        btn.classList.add('on');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');
        activeMetric = btn.getAttribute('data-metric');
        if (seemore && metricToSort[activeMetric]) {
          seemore.setAttribute('href', '/nepse-daily/?sort=' + metricToSort[activeMetric] + '#all-stocks');
        }
        renderActive();
        rebaseline();
      };
      // ARIA tabs pattern (Wave A): Arrow keys move + activate,
      // Home/End jump to the ends; roving tabindex stays in sync
      // via the click handler above.
      btn.onkeydown = function (ev) {
        var n = tabs.length, j = null;
        if (ev.key === 'ArrowRight') j = (i + 1) % n;
        else if (ev.key === 'ArrowLeft') j = (i - 1 + n) % n;
        else if (ev.key === 'Home') j = 0;
        else if (ev.key === 'End') j = n - 1;
        if (j === null) return;
        ev.preventDefault();
        tabs[j].focus();
        tabs[j].click();
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
      var pulseTop = byTurnover.length ? Number(byTurnover[0].turnover) : 0;
      pulseHost.innerHTML = byTurnover.map(function (q, i) {
        var pct = Number(q.percent_change) || 0;
        var cls = pct > 0 ? 'up' : pct < 0 ? 'dn' : '';
        var share = pulseTop > 0 ? Math.max(3, Math.round(Number(q.turnover) / pulseTop * 100)) : 0;
        return '<a class="nd-pulse-item cx-pulse-item" href="/stocks/' + esc(q.symbol) + '/">' +
          '<span class="rank">' + (i + 1) + '</span>' +
          '<div class="info"><div class="sym">' + esc(q.symbol) + '</div>' +
          '<div class="meta">Rs ' + fmtNum(q.ltp) + ' · <span class="' + cls + '">' +
          (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</span> · ' + fmtCrore(q.turnover) + '</div></div>' +
          '<span class="cx-prop"><span class="cx-prop-track"><span class="cx-prop-fill" style="--w:' + share + '%"></span></span></span></a>';
      }).join('');
      var ps = $('ndPulseSub');
      if (ps && sessDate) ps.textContent = 'Ranked by live turnover · session of ' + sessDate;
      var pf = $('ndPulseFoot');
      if (pf) pf.innerHTML = '<a class="nd-pe-link" href="/nepse-trending/">Trending archive + forward record →</a>';
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
        function engineRow(x) {
          var sc = Number(x.score);
          var pos = isFinite(sc) ? Math.max(0, Math.min(100, sc)) : 50;
          return '<div class="nd-engine-item"><span class="sym">' + esc(x.symbol) + '</span>' +
            '<span class="cx-gauge" role="img" aria-label="Score ' + esc(String(x.score)) + ' of 100"><span class="cx-gauge-mark" style="--pos:' + pos + '%"></span></span>' +
            '<span class="score">score ' + esc(String(x.score)) + '</span>' +
            '<span class="nd-verdict ' + (/buy/i.test(x.verdict || '') ? 'buy' : 'exit') + '">' + esc(x.verdict) + '</span></div>';
        }
        if (buys.length) {
          html += '<div class="nd-eyebrow" style="margin-bottom:8px">Strongest buys</div>';
          html += buys.map(engineRow).join('');
        }
        if (exits.length) {
          html += '<div class="nd-eyebrow" style="margin:12px 0 8px">Strongest exits</div>';
          html += exits.map(engineRow).join('');
        }
        engineHost.innerHTML = html || '<p class="nd-pe-sub">No verdicts available.</p>';
        verdictsData = v;
        if (currentLive) renderSectors();
        if (currentLive) renderStatStrip(currentLive);
        rebaseline();
        var ef = $('ndEngineFoot');
        if (ef) {
          var ch = v.changes || {};
          ef.innerHTML = '<span class="nd-pe-changes">Upgraded ' + (ch.upgraded != null ? ch.upgraded : '—') + ' · Downgraded ' + (ch.downgraded != null ? ch.downgraded : '—') + ' · Held ' + (ch.held != null ? ch.held : '—') + ' · New ' + (ch.new != null ? ch.new : '—') + '</span> <a class="nd-pe-link" href="/nepse-screener/">Full verdict board + paper-trade ledger →</a>';
        }
        var es = $('ndEngineSub');
        if (es) es.textContent = 'Batch of ' + sessDate + ' · ' + verdicts.length + ' securities scored · Not investment advice';
      }).catch(function () {
        engineHost.innerHTML = '<p class="nd-pe-sub">Verdicts unavailable.</p>';
        var sc = $('ndSectorCards');
        if (sc) sc.innerHTML = '<p class="nd-pe-sub">Sector data unavailable.</p>';
      });
    }
  }

  /* ---------- Ticker tape (moved from the dead inline script, same markup) ---------- */
  function renderTicker(quotes) {
    var track = $('d2TickTrack');
    if (!track || !quotes || !quotes.length) return;
    var top = quotes.slice().filter(function (q) { return q.turnover && Number(q.turnover) > 0; })
      .sort(function (a, b) { return Number(b.turnover) - Number(a.turnover); }).slice(0, 15);
    function item(q) {
      var pct = Number(q.percent_change) || 0;
      var cls = pct > 0 ? 'up' : pct < 0 ? 'dn' : '';
      return '<span class="d2-tick-item"><span class="d2-tick-sym">' + esc(q.symbol) + '</span>' +
        '<span class="d2-tick-val">' + fmtNum(q.ltp) + '</span>' +
        '<span class="' + cls + '">' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</span></span>';
    }
    var html = top.map(item).join('');
    track.innerHTML = html + html;
  }

  /* ---------- Nepali money ---------- */
  function money(v) {
    v = Number(v) || 0;
    if (v >= 1e9) return 'Rs ' + (v / 1e9).toFixed(2) + ' arba';
    if (v >= 1e7) return 'Rs ' + (v / 1e7).toFixed(2) + ' crore';
    if (v >= 1e5) return 'Rs ' + (v / 1e5).toFixed(2) + ' lakh';
    return 'Rs ' + v.toLocaleString('en-IN');
  }

  /* ---------- Breadth bar (kit cx-breadth structure) ---------- */
  function breadthBarHTML(adv, dec, unc) {
    var total = adv + dec + unc;
    if (!total) return '';
    return '<div class="cx-breadth" role="img" aria-label="Breadth: ' + adv + ' advancers, ' + dec + ' decliners, ' + unc + ' unchanged">' +
      '<i class="b-up" style="width:' + (adv / total * 100).toFixed(1) + '%"></i>' +
      '<i class="b-flat" style="width:' + (unc / total * 100).toFixed(1) + '%"></i>' +
      '<i class="b-down" style="width:' + (dec / total * 100).toFixed(1) + '%"></i></div>' +
      '<div class="cx-breadth-legend"><span><b>' + adv + '</b> advancers</span><span><b>' + dec + '</b> decliners</span><span><b>' + unc + '</b> unchanged</span></div>';
  }

  /* ---------- Stat strip (turnover total, previously computed but never shown) ---------- */
  function renderStatStrip(live) {
    if (!live || !live.index) return;
    var ix = live.index, quotes = live.quotes || [];
    var totTurn = 0, adv = 0, dec = 0, unc = 0;
    quotes.forEach(function (q) {
      totTurn += Number(q.turnover) || 0;
      var pc = Number(q.percent_change);
      if (pc > 0) adv++; else if (pc < 0) dec++; else unc++;
    });
    var chg = Number(ix.change) || 0, pct = Number(ix.percent_change) || 0;
    var cls = chg > 0 ? 'up' : chg < 0 ? 'dn' : '';
    var iEl = $('ndStatIndex'), iSub = $('ndStatIndexSub');
    if (iEl) iEl.innerHTML = esc(fmtNum(ix.value)) + ' <span class="' + cls + '">' + (chg > 0 ? '+' : '') + fmtNum(chg) + ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%)</span>';
    if (iSub) iSub.textContent = 'Day range ' + fmtNum(ix.low) + ' – ' + fmtNum(ix.high);
    var tEl = $('ndStatTurn'), tSub = $('ndStatTurnSub');
    if (tEl) tEl.textContent = money(totTurn);
    if (tSub) tSub.textContent = 'Rs ' + totTurn.toLocaleString('en-IN') + ' · tape sum of ' + quotes.length + ' quotes';
    var sEl = $('ndStatScrips'), sSub = $('ndStatScripsSub');
    var listed = 0;
    if (verdictsData) {
      if (verdictsData.count) listed = Number(verdictsData.count) || 0;
      else if (verdictsData.verdicts) listed = Object.keys(verdictsData.verdicts).length;
    }
    if (sEl) sEl.textContent = quotes.length + (listed ? ' of ' + listed : '');
    if (sSub) sSub.textContent = listed ? (listed - quotes.length) + ' listed symbols did not trade this session' : 'Traded this session';
    var bEl = $('ndStatBreadth'), bSub = $('ndStatBreadthSub'), bBar = $('ndStatBreadthBar');
    if (bEl) bEl.textContent = adv + ' up · ' + dec + ' down';
    if (bSub) bSub.textContent = adv + ' advancers · ' + dec + ' decliners · ' + unc + ' unchanged';
    if (bBar) bBar.innerHTML = breadthBarHTML(adv, dec, unc);
  }

  /* ---------- Sectors (verdicts sec + tape join) ---------- */
  var sectorSel = 'Hydropower', sectorSort = 'turnover', sectorSearch = '', sectorPage = 1;
  var SECTOR_PAGE_SIZE = 25;
  function sectorRows() {
    if (!verdictsData || !verdictsData.verdicts) return [];
    var raw = verdictsData.verdicts;
    var quoteBySym = {};
    (currentLive && currentLive.quotes || []).forEach(function (q) { quoteBySym[q.symbol] = q; });
    var rows = [];
    Object.keys(raw).forEach(function (sym) {
      var x = raw[sym] || {};
      if (x.sec !== sectorSel) return;
      var q = quoteBySym[sym];
      var traded = !!q;
      rows.push({
        symbol: sym, name: traded ? (q.name || '') : '', traded: traded,
        ltp: traded ? Number(q.ltp) : (x.p != null ? Number(x.p) : null),
        pct: traded ? Number(q.percent_change) : (x.ch != null ? Number(x.ch) : null),
        turnover: traded ? Number(q.turnover) || 0 : 0,
        verdict: x.v || ''
      });
    });
    var term = sectorSearch.trim().toLowerCase();
    if (term) rows = rows.filter(function (r) {
      return r.symbol.toLowerCase().indexOf(term) !== -1 || r.name.toLowerCase().indexOf(term) !== -1;
    });
    rows.sort(function (a, b) {
      if (sectorSort === 'pct') return (Number(b.pct) || 0) - (Number(a.pct) || 0);
      if (sectorSort === 'ltp') return (Number(b.ltp) || 0) - (Number(a.ltp) || 0);
      if (sectorSort === 'symbol') return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
      return (Number(b.turnover) || 0) - (Number(a.turnover) || 0);
    });
    return rows;
  }
  function renderSectors() {
    var cardsHost = $('ndSectorCards'), panel = $('ndSectorPanel');
    if (!cardsHost || !panel) return;
    if (!verdictsData || !verdictsData.verdicts) {
      cardsHost.innerHTML = '<p class="nd-pe-sub">Sector data loading…</p>';
      return;
    }
    var raw = verdictsData.verdicts;
    var quoteBySym = {};
    (currentLive && currentLive.quotes || []).forEach(function (q) { quoteBySym[q.symbol] = q; });
    var bySec = {};
    Object.keys(raw).forEach(function (sym) {
      var x = raw[sym] || {};
      var s = x.sec || 'Others';
      if (!bySec[s]) bySec[s] = [];
      bySec[s].push({ symbol: sym, x: x, q: quoteBySym[sym] || null });
    });
    var secs = Object.keys(bySec).sort(function (a, b) { return bySec[b].length - bySec[a].length; });
    if (secs.indexOf(sectorSel) === -1) sectorSel = secs[0] || 'Hydropower';
    cardsHost.innerHTML = secs.map(function (s) {
      var list = bySec[s];
      var traded = list.filter(function (r) { return !!r.q; });
      var mean = 0;
      if (traded.length) {
        var sum = 0;
        traded.forEach(function (r) { sum += Number(r.q.percent_change) || 0; });
        mean = sum / traded.length;
      }
      var top3 = list.slice().sort(function (a, b) { return (Number(b.q && b.q.turnover) || 0) - (Number(a.q && a.q.turnover) || 0); }).slice(0, 3);
      var mCls = mean > 0 ? 'up' : mean < 0 ? 'dn' : '';
      return '<button type="button" class="nd-sector-card cx-card' + (s === sectorSel ? ' on' : '') + '" data-sector="' + esc(s) + '" role="listitem">' +
        '<span class="nd-sector-name">' + esc(s) + '</span>' +
        '<span class="nd-sector-count">' + list.length + ' symbols · ' + traded.length + ' traded</span>' +
        '<span class="nd-sector-mean ' + mCls + '">' + (mean > 0 ? '+' : '') + mean.toFixed(2) + '% <em>mean Day % (traded only)</em></span>' +
        '<span class="nd-sector-top">' + top3.map(function (r) {
          var pc = r.q ? (Number(r.q.percent_change) || 0) : 0;
          var pcCls = pc > 0 ? 'up' : pc < 0 ? 'dn' : '';
          return '<span>' + esc(r.symbol) + ' <b class="' + pcCls + '">' + (pc > 0 ? '+' : '') + pc.toFixed(2) + '%</b></span>';
        }).join('') + '</span></button>';
    }).join('');
    var cards = cardsHost.querySelectorAll('.nd-sector-card');
    cards.forEach(function (c) {
      c.onclick = function () {
        sectorSel = c.getAttribute('data-sector'); sectorPage = 1;
        renderSectors(); rebaseline();
        var p = $('ndSectorPanel');
        if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    var sel = $('ndSectorSelect');
    if (sel) {
      sel.innerHTML = secs.map(function (s) { return '<option value="' + esc(s) + '"' + (s === sectorSel ? ' selected' : '') + '>' + esc(s) + ' (' + bySec[s].length + ')</option>'; }).join('');
      sel.onchange = function () { sectorSel = sel.value; sectorPage = 1; renderSectors(); rebaseline(); };
    }
    var sort = $('ndSectorSort');
    if (sort) { sort.value = sectorSort; sort.onchange = function () { sectorSort = sort.value; sectorPage = 1; renderSectors(); rebaseline(); }; }
    var search = $('ndSectorSearch');
    if (search) { search.value = sectorSearch; search.oninput = function () { sectorSearch = search.value; sectorPage = 1; renderSectors(); rebaseline(); }; }
    var rows = sectorRows();
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / SECTOR_PAGE_SIZE));
    if (sectorPage > pages) sectorPage = pages;
    var start = (sectorPage - 1) * SECTOR_PAGE_SIZE;
    var pageRows = rows.slice(start, start + SECTOR_PAGE_SIZE);
    var sub = $('ndSectorSub');
    if (sub) sub.textContent = secs.length + ' sectors · ' + Object.keys(raw).length + ' securities scored';
    var meta = $('ndSectorMeta');
    if (meta) {
      var list = bySec[sectorSel] || [];
      var tradedN = list.filter(function (r) { return !!r.q; }).length;
      meta.textContent = sectorSel + ' · ' + list.length + ' symbols · ' + tradedN + ' traded this session · ' + total + ' shown';
    }
    var body = $('ndSectorBody');
    if (body) {
      body.innerHTML = pageRows.length ? pageRows.map(function (r) {
        var pct = Number(r.pct);
        var pctTxt = isFinite(pct) ? (pct > 0 ? '+' : '') + pct.toFixed(2) + '%' : '—';
        var pctCls = pct > 0 ? 'up' : pct < 0 ? 'dn' : '';
        var vCls = /buy/i.test(r.verdict) ? 'buy' : /exit|sell/i.test(r.verdict) ? 'exit' : 'hold';
        return '<tr><td class="sym"><a href="/stocks/' + esc(r.symbol) + '/">' + esc(r.symbol) + '</a>' + (r.name ? '<span class="nd-row-name">' + esc(r.name) + '</span>' : '') + '</td>' +
          '<td class="num">' + (r.ltp != null ? fmtNum(r.ltp) : '—') + (r.traded ? ' <span class="nd-live-dot" title="Live tape">●</span>' : ' <span class="nd-notrade">no trade</span>') + '</td>' +
          '<td class="num"><span class="cx-chip ' + pctCls + '">' + pctTxt + '</span></td>' +
          '<td class="num">' + (r.traded ? fmtCrore(r.turnover) : '—') + '</td>' +
          '<td><span class="nd-verdict ' + vCls + '">' + esc(r.verdict || '—') + '</span></td></tr>';
      }).join('') : '<tr><td colspan="5">No symbols match this search.</td></tr>';
    }
    var info = $('ndSectorInfo'), prev = $('ndSectorPrev'), next = $('ndSectorNext');
    if (info) info.textContent = total ? ('Showing ' + (start + 1) + '–' + Math.min(start + SECTOR_PAGE_SIZE, total) + ' of ' + total) : 'Showing 0 of 0';
    if (prev) { prev.disabled = sectorPage <= 1; prev.onclick = function () { if (sectorPage > 1) { sectorPage--; renderSectors(); rebaseline(); } }; }
    if (next) { next.disabled = sectorPage >= pages; next.onclick = function () { if (sectorPage < pages) { sectorPage++; renderSectors(); rebaseline(); } }; }
  }

  /* ---------- Newsroom (data-derived panels: the feed carries no categories) ---------- */
  var newsNewest = null, newsDataAsOf = null;
  function renderNewsroom(items) {
    var grid = $('ndNewsGrid');
    if (!grid) return;
    items = (items || []).slice();
    items.sort(function (a, b) {
      var da = String(a.date || ''), db = String(b.date || '');
      return db < da ? -1 : db > da ? 1 : 0;
    });
    if (items.length) newsNewest = items[0].date || null;
    function itemHTML(n) {
      var href = n.link || n.url || '/nepse-news/';
      var ext = /^https?:\/\//.test(href) && href.indexOf(location.host) === -1;
      var syms = [];
      if (n.sym) syms.push(n.sym);
      if (Array.isArray(n.syms)) n.syms.forEach(function (s) { if (syms.indexOf(s) === -1) syms.push(s); });
      return '<a class="cx-cat-item" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' +
        '<span class="cx-ci-t">' + esc(n.title || '') + '</span>' +
        '<span class="cx-ci-d">' + esc(n.date || '') + (n.src ? ' · ' + esc(n.src) : '') + (syms.length ? ' · ' + esc(syms.join(', ')) : '') + '</span></a>';
    }
    var latest = items.slice(0, 12);
    var tagged = items.filter(function (n) { return n.sym || (Array.isArray(n.syms) && n.syms.length); }).slice(0, 8);
    grid.innerHTML = '<div class="nd-newscard cx-cat"><div class="cx-cat-head">Latest stories</div>' +
      (latest.length ? latest.map(itemHTML).join('') : '<p class="nd-pe-sub">No stories yet.</p>') + '</div>' +
      '<div class="nd-newscard cx-cat"><div class="cx-cat-head">Tagged to listed companies</div>' +
      (tagged.length ? tagged.map(itemHTML).join('') : '<p class="nd-pe-sub">No symbol-tagged stories in this feed.</p>') + '</div>' +
      '<div class="nd-newscard cx-cat"><div class="cx-cat-head">More</div>' +
      '<a class="cx-cat-item" href="/nepse-news/"><span class="cx-ci-t">Browse the full newsroom</span><span class="cx-ci-d">Every story, searchable</span></a>' +
      '<a class="cx-cat-item" href="/nepse-decode/wrap/"><span class="cx-ci-t">Market Wrap archive</span><span class="cx-ci-d">Every session’s wrap</span></a></div>';
    var nf = $('ndNewsFresh');
    if (nf) {
      var stale = '';
      if (newsNewest) {
        try {
          var nd = new Date(newsNewest + 'T00:00:00+05:45');
          var today = new Date();
          var todayNPT = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
          var days = Math.floor((todayNPT - nd) / 86400000);
          if (days > 3) stale = ' · STALE — feed has not updated in ' + days + ' days';
        } catch (e) {}
      }
      nf.textContent = 'Feed as of ' + (newsDataAsOf || '—') + ' · newest story ' + (newsNewest || '—') + ' · ' + items.length + ' stories in feed' + stale;
    }
  }

  /* ---------- Page-owned freshness line ---------- */
  var lastTickFailed = false;
  function nptTime(d) {
    try { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' }); }
    catch (e) { return ''; }
  }
  function renderFreshline(live) {
    var el = $('ndFreshlineText');
    if (!el) return;
    if (!live) { el.textContent = 'Loading session data…'; return; }
    var sessDate = '';
    try {
      var d = getSessionDate(live);
      sessDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
    } catch (e) {}
    var tapeTime = '';
    try { if (live.asof) tapeTime = nptTime(new Date(live.asof)); } catch (e) {}
    var now = new Date();
    var next = new Date(now.getTime() + 60000);
    var state = live.market === 'OPEN' ? 'LIVE' : 'CLOSED';
    var fl = $('ndFreshline');
    if (fl) fl.setAttribute('data-state', state.toLowerCase());
    el.textContent = 'Session ' + sessDate + ' · tape ' + (tapeTime || '—') + ' · checked ' + nptTime(now) +
      ' · next check ' + nptTime(next) + ' · ' + state +
      (lastTickFailed ? ' · last data check failed — showing last good session' : '') +
      ' · refreshes every 60s when data changes';
  }

  /* ---------- 60s change-gated refresh ---------- */
  var currentLive = null, verdictsData = null;
  var lastSig = null, tickCount = 0, lastAsofMs = 0;
  function tapeHash(quotes) {
    var h = 5381, s = '';
    (quotes || []).forEach(function (q) {
      s += q.symbol + ':' + q.ltp + ':' + q.percent_change + ':' + q.turnover + '|';
    });
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return String(h);
  }
  function computeSig() {
    if (!currentLive) return null;
    var ix = currentLive.index || {};
    return [currentLive.asof, ix.value, tapeHash(currentLive.quotes), verdictsData && verdictsData.asof, newsNewest].join('|');
  }
  // View-change handlers call this after re-rendering: the stored signature
  // is re-derived from current data (never nulled), so the next tick compares
  // against the post-change state instead of forcing a re-render.
  function rebaseline() { lastSig = computeSig(); }
  function applyFlash() {
    try { if (window.NepseFlash && typeof window.NepseFlash.apply === 'function') window.NepseFlash.apply(document); } catch (e) {}
  }
  function tick() {
    tickCount++;
    fetchJSON(LIVE_URL).then(function (live) {
      lastTickFailed = false;
      var prev = currentLive;
      currentLive = live;
      var sig = computeSig();
      if (sig !== lastSig) {
        lastSig = sig;
        renderAll(live);
        applyFlash();
      }
      renderFreshline(live);
      if (prev && live.asof !== prev.asof) {
        fetchJSON(NEWS_URL).then(function (news) {
          var items = Array.isArray(news) ? news : (news.items || news.news || []);
          newsDataAsOf = news.asof || null;
          renderNewsroom(items);
        }).catch(function () {});
      }
    }).catch(function () {
      lastTickFailed = true;
      if (currentLive) renderFreshline(currentLive);
    });
    if (tickCount % 10 === 0) {
      fetchJSON(NEWS_URL).then(function (news) {
        var items = Array.isArray(news) ? news : (news.items || news.news || []);
        newsDataAsOf = news.asof || null;
        renderNewsroom(items);
      }).catch(function () {});
    }
  }

  /* ---------- Render all + Init ---------- */
  // Renders every data-driven panel from one live snapshot. Called once on
  // load, again on session change (shared feed), and again on value change
  // (the page's own 60s tick). View state (active metric, sector selection,
  // sort, search, page) is read at render time, so ticks never clobber it.
  function renderAll(live) {
    if (!live) return;
    currentLive = live;
    lastAsofMs = live.asofMs || 0;
    renderStrip(live.indices);
    renderWrap(live);
    renderIndexCard(live);
    var sessDate = '';
    try {
      var d = getSessionDate(live);
      sessDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
    } catch (e) {}
    renderMoves(live.quotes, sessDate);
    activeQuotes = live.quotes || [];
    renderActive();
    renderPulseEngine(live.quotes, sessDate);
    renderTicker(live.quotes);
    renderStatStrip(live);
    renderSectors();
    renderFreshline(live);
    var as = $('ndActiveSub');
    if (as && sessDate) as.textContent = 'Ranked by trading activity · session of ' + sessDate;
  }
  function init() {
    if (!$('ndStripTrack') && !$('ndWrap') && !$('ndNewsGrid')) return;
    // Fetch spark data first for the index card chart
    fetchJSON(SPARK_URL).then(function (sp) { sparkData = sp; }).catch(function () {}).then(function () {
      // Use shared NepseData module (dedupes live.json fetch)
      getLive().then(function (live) {
        currentLive = live;
        renderAll(live);
        lastSig = computeSig();
        // Stay in sync: if the first paint used a stale cached snapshot, the
        // background fetch delivers the fresh one here. NepseData only
        // notifies on session change, so re-renders are cheap and rare.
        try {
          if (window.NepseData && typeof window.NepseData.subscribe === 'function') {
            window.NepseData.subscribe(function (snap) {
              if (snap && (snap.asofMs || 0) !== lastAsofMs) {
                currentLive = snap;
                renderAll(snap);
                rebaseline();
                applyFlash();
              }
            });
          }
        } catch (e) {}
        setInterval(tick, 60000);
      }).catch(function () {});
    });
    fetchJSON(NEWS_URL).then(function (news) {
      var items = Array.isArray(news) ? news : (news.items || news.news || []);
      newsDataAsOf = news.asof || null;
      renderNewsroom(items);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
