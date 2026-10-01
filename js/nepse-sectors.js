/* NEPSE Alpha Lab: sector dashboard.
   Loads /nepse-chart/data/verdicts.json (via version.json cache-bust) and
   aggregates it into a size-weighted heatmap, per-sector breadth cards, and
   a sortable comparison table. Everything is computed client-side from the
   latest daily batch; no figures are invented. */
(function () {
  'use strict';
  var FALLBACK_V = '20260924g';
  var VER = 'v=20261002a';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(x, d) {
    if (x == null || isNaN(x)) return null;
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function signPct(x) {
    if (x == null || isNaN(x)) return '<span class="sx-dash">-</span>';
    var cls = x > 0 ? 'sx-pos' : (x < 0 ? 'sx-neg' : '');
    var s = (x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
    return cls ? '<span class="' + cls + '">' + esc(s) + '</span>' : esc(s);
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
      return r.json();
    });
  }

  /* Honest sector/instrument grouping.
   * The universe builder writes the authoritative per-symbol sector into
   * every verdicts.json entry's `sec` field from tools/sector-map.json (the
   * single source of truth). The classifier below is the client-side
   * fallback and is kept identical in js/nepse-screener.js and
   * tools/build-symbol-pages.js. Groups are derived ONLY from real repo
   * data in nepse-chart/data/universe.json:
   *  - explicit verified symbol overrides (checked FIRST, before any
   *    keyword matching) for symbols whose official company name does not
   *    reveal the real sector;
   *  - NEPSE-official sub-index overrides (Investment: CIT/HIDCL/HIDCLP/
   *    NIFRA/NRN/CHDC/ENL/HATHY; Trading: BBC/STC);
   *  - the instrument-type field `t` (Debenture / Mutual fund /
   *    Promoter share), plus NEPSE's own debenture symbol suffixes
   *    (D + maturity year) and the words "bond"/"rinpatra", "fund"/"kosh"
   *    in the official company name; these are instrument types, NOT sectors;
   *  - explicit business words in the official company name for equities
   *    (bank, finance, laghubitta, hydropower/power/hydro/urja,
   *    insurance/beema, hotel/tourism, investment, trading, cement and other
   *    manufacturing words); these map to the NEPSE sub-index names.
   * Anything left over falls into "Others" (the NEPSE Others sub-index
   * bucket). Every listed security belongs to exactly one real category —
   * there is no "Unclassified". */
  var DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
  /* Verified symbol -> sector overrides (2026-09-30, official NEPSE/company
     notices and market sources). Checked before keyword matching. */
  var SECTOR_OVERRIDES = {
    GVL: 'Hydropower', SNORL: 'Hydropower',
    BNL: 'Manufacturing And Processing', UNL: 'Manufacturing And Processing',
    SAIL: 'Manufacturing And Processing',
    CGH: 'Hotels And Tourism', KDL: 'Hotels And Tourism',
    SAGF: 'Mutual Funds', H8020: 'Mutual Funds', NMB50: 'Mutual Funds',
    CMF2: 'Mutual Funds', NICBF: 'Mutual Funds', LSH12: 'Mutual Funds',
    RBBF40: 'Mutual Funds',
    JBLBP: 'Promoter Shares', KBLPO: 'Promoter Shares', MLBLPO: 'Promoter Shares',
    SCBD: 'Debentures', SHINED: 'Debentures',
    SFCL: 'Finance',
    WNLB: 'Microfinance',
    NTC: 'Others', NRM: 'Others', NWCL: 'Others', TTL: 'Others', MKCL: 'Others'
  };
  /* NEPSE-official sector overrides, checked before keyword matching.
     Investment sub-index (NEPSE): CIT, HIDCL, NIFRA, NRN, CEDB/CHDC, plus
     newer listings ENL and HATHY; HIDCLP is HIDCL's promoter share and
     trades with the investment group. NIFRA must precede the 'bank'
     keyword; HIDCLP must precede the Promoter-share instrument check.
     Trading (NEPSE): BBC and STC. */
  var INVESTMENT_SYMBOLS = { CIT:1, HIDCL:1, HIDCLP:1, NIFRA:1, NRN:1, CHDC:1, ENL:1, HATHY:1 };
  var TRADING_SYMBOLS = { BBC:1, STC:1 };
  function classifySymbol(sym, name, type) {
    var symU = String(sym || '').toUpperCase();
    if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
    if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
    if (TRADING_SYMBOLS[symU]) return 'Trading';
    var n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
    if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
        n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
    if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
    if (type === 'Promoter share') return 'Promoter Shares';
    if (type && type !== 'Equity') return 'Others';
    function has() {
      for (var i = 0; i < arguments.length; i++) if (n.indexOf(arguments[i]) >= 0) return true;
      return false;
    }
    if (has('laghu', 'microfinance')) return 'Microfinance';
    if (has('hydropower', 'hydro', 'power', 'urja', 'dhyut', 'dyut', 'energy')) return 'Hydropower';
    if (has('development bank')) return 'Development Bank';
    if (has('bank')) return 'Banking';
    if (has('life insurance')) return 'Life Insurance';
    if (has('reinsurance', 'insurance', 'beema')) return 'Non Life Insurance';
    if (has('finance')) return 'Finance';
    if (has('hotel', 'tourism', 'cablecar')) return 'Hotels And Tourism';
    if (has('investment')) return 'Investment';
    if (has('trading')) return 'Trading';
    if (has('manufacturing', 'cement', 'bottler', 'distiller', 'spinning', 'pharmaceut',
      'paints', 'colour', 'panel', 'mineral', 'lube')) return 'Manufacturing And Processing';
    return 'Others';
  }
  var sectorMap = null;
  function sectorOf(e, sym) {
    // Authoritative verdicts.json sec (written by the universe builder from
    // tools/sector-map.json) wins; the local classifier is the fallback.
    // Every security lands in exactly one real category — never Unclassified.
    if (e && e.sec && e.sec !== 'Unknown') return e.sec;
    return (sectorMap && sectorMap[sym]) || 'Others';
  }

  function load() {
    return getJSON('/nepse-chart/data/version.json')
      .then(function (j) { return (j && j.v) ? j.v : FALLBACK_V; })
      .catch(function () { return FALLBACK_V; })
      .then(function (v) {
        return Promise.all([
          getJSON('/nepse-chart/data/verdicts.json?v=' + encodeURIComponent(v)),
          getJSON('/nepse-chart/data/universe.json?v=' + encodeURIComponent(v)).catch(function () { return null; })
        ]);
      })
      .then(function (res) {
        sectorMap = {};
        var uj = res[1];
        if (uj && uj.symbols) uj.symbols.forEach(function (it) {
          if (it.s) sectorMap[it.s] = classifySymbol(it.s, it.n, it.t);
        });
        return res[0];
      });
  }

  function aggregate(vj) {
    var v = vj.verdicts || {};
    var sectors = {};
    var totalTurn = 0;
    Object.keys(v).forEach(function (sym) {
      var e = v[sym] || {};
      var sec = sectorOf(e, sym);
      if (!sectors[sec]) sectors[sec] = {
        name: sec, count: 0, chs: [], adv: 0, dec: 0, flat: 0,
        turn: 0, rsis: [], rows: [], tiles: []
      };
      var g = sectors[sec];
      g.count++;
      var ch = (e.ch == null) ? null : Number(e.ch);
      var p = (e.p == null) ? null : Number(e.p);
      var vol = (e.vol == null) ? null : Number(e.vol);
      var turn = 0;
      if (vol != null && p != null && !isNaN(vol) && !isNaN(p) && vol > 0) {
        turn = vol * p;
        g.turn += turn;
        totalTurn += turn;
      }
      if (ch != null && !isNaN(ch)) {
        g.chs.push(ch);
        if (ch > 0) g.adv++; else if (ch < 0) g.dec++; else g.flat++;
        g.rows.push({ sym: sym, p: p, ch: ch });
      }
      g.tiles.push({ sym: sym, p: p, ch: (ch != null && !isNaN(ch)) ? ch : null, turn: turn });
      if (e.rsi != null && !isNaN(Number(e.rsi))) g.rsis.push(Number(e.rsi));
    });
    var list = Object.keys(sectors).map(function (k) {
      var g = sectors[k];
      var n = g.chs.length;
      var avgCh = n ? g.chs.reduce(function (a, b) { return a + b; }, 0) / n : null;
      var pctUp = n ? (g.adv / n) * 100 : null;
      var avgRsi = g.rsis.length
        ? g.rsis.reduce(function (a, b) { return a + b; }, 0) / g.rsis.length : null;
      var gainers = g.rows.slice().sort(function (a, b) { return b.ch - a.ch; }).slice(0, 3);
      var losers = g.rows.slice().sort(function (a, b) { return a.ch - b.ch; }).slice(0, 3);
      return {
        name: g.name, count: g.count, adv: g.adv, dec: g.dec, flat: g.flat, nCh: n,
        avgCh: avgCh, pctUp: pctUp, avgRsi: avgRsi,
        turnShare: totalTurn > 0 ? (g.turn / totalTurn) * 100 : null,
        gainers: gainers, losers: losers, tiles: g.tiles
      };
    });
    // canonical order: sectors by count desc
    list.sort(function (a, b) {
      return b.count - a.count;
    });
    return { sectors: list, asof: vj.asof || '', total: Object.keys(v).length };
  }

  /* Live-tape aggregation: recomputes the sector picture from the 15-minute
   * quote tape instead of the daily batch. Same output shape as aggregate()
   * so the renderers work unchanged. Only used when the tape is from
   * today's session (checked by the caller). RSI needs multi-session
   * history, so avgRsi is null (shown as a dash) in live mode. */
  function aggregateLiveTape(live, todayStr) {
    var q = (live && live.quotes) || {};
    var sectors = {}, totalTurn = 0, count = 0;
    Object.keys(q).forEach(function (sym) {
      var e = q[sym] || {};
      var sec = sectorOf(null, sym);
      if (!sectors[sec]) sectors[sec] = {
        name: sec, count: 0, chs: [], adv: 0, dec: 0, flat: 0,
        turn: 0, rows: [], tiles: []
      };
      var g = sectors[sec];
      g.count++; count++;
      var ch = (e.pct == null || isNaN(e.pct)) ? null : Number(e.pct);
      var p = (e.ltp == null || isNaN(Number(e.ltp))) ? null : Number(e.ltp);
      var t = Number(e.turnover);
      var turn = (e.turnover != null && !isNaN(t) && t > 0) ? t : 0;
      if (turn > 0) { g.turn += turn; totalTurn += turn; }
      if (ch != null) {
        g.chs.push(ch);
        if (ch > 0) g.adv++; else if (ch < 0) g.dec++; else g.flat++;
        g.rows.push({ sym: sym, p: p, ch: ch });
      }
      g.tiles.push({ sym: sym, p: p, ch: ch, turn: turn });
    });
    var list = Object.keys(sectors).map(function (k) {
      var g = sectors[k];
      var n = g.chs.length;
      var avgCh = n ? g.chs.reduce(function (a, b) { return a + b; }, 0) / n : null;
      var gainers = g.rows.slice().sort(function (a, b) { return b.ch - a.ch; }).slice(0, 3);
      var losers = g.rows.slice().sort(function (a, b) { return a.ch - b.ch; }).slice(0, 3);
      return {
        name: g.name, count: g.count, adv: g.adv, dec: g.dec, flat: g.flat, nCh: n,
        avgCh: avgCh, pctUp: n ? (g.adv / n) * 100 : null, avgRsi: null,
        turnShare: totalTurn > 0 ? (g.turn / totalTurn) * 100 : null,
        gainers: gainers, losers: losers, tiles: g.tiles
      };
    });
    list.sort(function (a, b) {
      return b.count - a.count;
    });
    return { sectors: list, asof: todayStr, total: count };
  }

  var MONTHS_L = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  function fmtLiveDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + ' ' + MONTHS_L[+m[2] - 1] + ' ' + m[1] : String(iso || '');
  }

  function heatClass(avgCh) {
    if (avgCh == null) return 'sx-none';
    if (avgCh >= 1.5) return 'sx-up2';
    if (avgCh >= 0.25) return 'sx-up1';
    if (avgCh > -0.25) return 'sx-n';
    if (avgCh > -1.5) return 'sx-dn1';
    return 'sx-dn2';
  }

  function tileLink(sec) {
    return '/nepse-screener/?sector=' + encodeURIComponent(sec);
  }

  function fmtTurn(x) {
    if (x == null || !isFinite(x) || x <= 0) return null;
    if (x >= 1e7) return 'Rs ' + (x / 1e7).toFixed(1) + ' Cr';
    if (x >= 1e5) return 'Rs ' + (x / 1e5).toFixed(1) + ' L';
    if (x >= 1e3) return 'Rs ' + (x / 1e3).toFixed(1) + 'K';
    return 'Rs ' + Math.round(x);
  }
  function pctText(x) {
    if (x == null || isNaN(x)) return '-';
    return (x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  }

  /* Treemap-style heatmap: one tile per security, tile area follows session
   * turnover (square-root scaled so small names stay tappable), color follows
   * the security's own day change, tiles grouped under their sector. */
  function renderHeat(sectors) {
    var list = sectors.slice().sort(function (a, b) {
      return (b.turnShare || 0) - (a.turnShare || 0);
    });
    var h = list.map(function (g) {
      var tiles = (g.tiles || []).slice().sort(function (a, b) { return (b.turn || 0) - (a.turn || 0); });
      var meta = g.count + (g.count === 1 ? ' security' : ' securities');
      if (g.avgCh != null) meta += ' · avg ' + pctText(g.avgCh);
      if (g.turnShare != null) meta += ' · ' + g.turnShare.toFixed(1) + '% of turnover';
      var th = '<div class="sx-tm-sec">' +
        '<div class="sx-tm-head"><h3><a href="' + esc(tileLink(g.name)) + '">' + esc(g.name) + '</a></h3>' +
        '<span class="sx-tm-meta">' + esc(meta) + '</span></div>' +
        '<div class="sx-tm-tiles" aria-label="' + esc(g.name) + ' securities">';
      var tb = tiles.map(function (t) {
        var tip = t.sym +
          (t.p != null ? ' · Rs ' + num(t.p, 2) : '') +
          (t.ch != null ? ' · day ' + pctText(t.ch) : ' · no day-change data') +
          (t.turn > 0 ? ' · turnover ' + fmtTurn(t.turn) : '');
        return '<a class="sx-tm-tile ' + heatClass(t.ch) + '"' +
          ' href="/stocks/' + esc(String(t.sym).replace(/\//g, '-')) + '/"' +
          ' title="' + esc(tip) + '">' +
          '<span class="sx-tm-sym">' + esc(t.sym) + '</span>' +
          '<span class="sx-tm-ch">' + esc(pctText(t.ch)) + '</span></a>';
      }).join('');
      return th + tb + '</div></div>';
    }).join('');
    $('sx-heat').innerHTML = h || '<p class="sx-empty">Heatmap data unavailable.</p>';
  }

  function leaderList(rows, sec, emptyMsg) {
    if (!rows.length) return '<p class="sx-empty-lead">' + esc(emptyMsg) + '</p>';
    var Mono = window.NepseMono || null;
    return '<ul>' + rows.map(function (r) {
      var price = r.p == null ? '-' : num(r.p, 2);
      return '<li><a class="sx-sym" href="/nepse-chart/?s=' + esc(r.sym) + '">' +
        (Mono ? Mono.avatar(r.sym, sec, 26) : '') + '<span>' + esc(r.sym) + '</span></a>' +
        '<span class="sx-p tnum">' + esc(price) + '</span>' +
        '<span class="sx-ch tnum">' + signPct(r.ch) + '</span></li>';
    }).join('') + '</ul>';
  }

  function renderCards(sectors) {
    var h = sectors.map(function (g) {
      var t = g.adv + g.dec + g.flat;
      var wUp = t ? (g.adv / t) * 100 : 0;
      var wDn = t ? (g.dec / t) * 100 : 0;
      var wFlat = t ? (g.flat / t) * 100 : 0;
      return '<article class="sx-card">' +
        '<div class="sx-card-head"><h3><a href="' + esc(tileLink(g.name)) + '">' + esc(g.name) + '</a></h3>' +
        '<span class="sx-avg">' + signPct(g.avgCh) + '</span></div>' +
        '<div class="sx-breadth" role="img" aria-label="' + esc(g.name) + ': ' + g.adv +
          ' advancers, ' + g.dec + ' decliners, ' + g.flat + ' unchanged">' +
          '<i class="sx-b-up" data-w="' + wUp.toFixed(1) + '" style="width:0"></i>' +
          '<i class="sx-b-dn" data-w="' + wDn.toFixed(1) + '" style="width:0"></i>' +
          '<i class="sx-b-flat" data-w="' + wFlat.toFixed(1) + '" style="width:0"></i></div>' +
        '<p class="sx-breadth-cap"><span data-count="' + g.adv + '">' + g.adv + '</span> up · ' +
          '<span data-count="' + g.dec + '">' + g.dec + '</span> down · ' +
          '<span data-count="' + g.flat + '">' + g.flat + '</span> flat' +
          (g.count - t ? ' · ' + (g.count - t) + ' no change data' : '') + '</p>' +
        '<details><summary>Leaders and laggards</summary>' +
          '<div class="sx-lead">' +
            '<div><h4>Top gainers</h4>' + leaderList(g.gainers, g.name, 'No change data in this sector.') + '</div>' +
            '<div><h4>Top losers</h4>' + leaderList(g.losers, g.name, 'No change data in this sector.') + '</div>' +
          '</div></details></article>';
    }).join('');
    $('sx-cards').innerHTML = h;
  }

  function renderTable(sectors, mode) {
    var rows = sectors.slice();
    if (mode === 'change') {
      rows.sort(function (a, b) { return (b.avgCh == null ? -999 : b.avgCh) - (a.avgCh == null ? -999 : a.avgCh); });
    } else if (mode === 'count') {
      rows.sort(function (a, b) { return b.count - a.count; });
    } else {
      rows.sort(function (a, b) { return (b.turnShare || 0) - (a.turnShare || 0); });
    }
    $('sx-body').innerHTML = rows.map(function (g) {
      return '<tr><td><a href="' + esc(tileLink(g.name)) + '">' + esc(g.name) + '</a></td>' +
        '<td class="num">' + g.count + '</td>' +
        '<td class="num">' + signPct(g.avgCh) + '</td>' +
        '<td class="num">' + (g.pctUp == null ? '<span class="sx-dash">-</span>' : esc(g.pctUp.toFixed(1) + '%')) + '</td>' +
        '<td class="num">' + (g.turnShare == null ? '<span class="sx-dash">-</span>' : esc(g.turnShare.toFixed(1) + '%')) + '</td>' +
        '<td class="num">' + (g.avgRsi == null ? '<span class="sx-dash">-</span>' : esc(g.avgRsi.toFixed(1))) + '</td></tr>';
    }).join('');
  }

  function showError() {
    var asof = $('sx-asof'); if (asof) asof.textContent = 'Data unavailable. Please try again later.';
    var heat = $('sx-heat'); if (heat) heat.innerHTML = '<p class="sx-empty">Heatmap data unavailable.</p>';
    var cards = $('sx-cards'); if (cards) cards.innerHTML = '<p class="sx-empty">Sector cards unavailable.</p>';
    var body = $('sx-body'); if (body) body.innerHTML = '<tr><td colspan="6" class="sx-empty">Table data unavailable.</td></tr>';
  }

  // Wave 7: breadth bars animate from zero to their real widths; entrance
  // and count-ups run only when the shared motion layer is available.
  function animateSectors() {
    var bars = document.querySelectorAll('#sx-cards .sx-breadth i');
    function set() {
      for (var i = 0; i < bars.length; i++) {
        bars[i].style.width = bars[i].getAttribute('data-w') + '%';
      }
    }
    var M = window.NepseMotion || null;
    if (M && M.reduced) { set(); }
    else requestAnimationFrame(function () { requestAnimationFrame(set); });
    if (M) {
      var els = document.querySelectorAll('#sx-heat .sx-tm-tile, #sx-cards .sx-card');
      for (var j = 0; j < els.length; j++) els[j].classList.add('rv');
      M.reveal(document);
      M.watchCounts(document);
    }
  }

  var currentSectors = [];
  var lastLiveAsOf = 0;

  function drawAll(agg, isLive) {
    currentSectors = agg.sectors;
    renderHeat(currentSectors);
    renderCards(currentSectors);
    var sel = $('sx-sort');
    renderTable(currentSectors, sel ? sel.value : 'change');
    animateSectors();
    var sxAsof = $('sx-asof');
    if (isLive) {
      sxAsof.textContent = 'Live session of ' + fmtLiveDay(agg.asof) + ' · ' +
        agg.total + ' securities · updating every 15 min';
    } else {
      sxAsof.textContent = agg.asof
        ? 'Aggregated from the batch as of ' + agg.asof + ' · ' + agg.total + ' securities'
        : agg.total + ' securities aggregated';
    }
    if (window.NepseFresh && agg.asof && !sxAsof.querySelector('.fresh'))
      sxAsof.insertAdjacentHTML('beforeend', ' ' + window.NepseFresh.badge(agg.asof));
  }

  // Recomputes every sector figure from the quote tape whenever a fresh
  // snapshot of TODAY's session lands, in market hours and after close.
  // Never mixes sessions: a tape from any other day is ignored.
  function paintLiveFromTape(d) {
    var NL = window.NepseLive;
    if (!NL || !d || !d.quotes || !d.asof || d.asof === lastLiveAsOf) return;
    var dayStr = null, todayStr = null;
    try {
      dayStr = new Date(d.asof + 5.75 * 3600 * 1000).toISOString().slice(0, 10);
      todayStr = NL.nowNPT().toISOString().slice(0, 10);
    } catch (e) { /* keep nulls */ }
    if (!dayStr || dayStr !== todayStr) return;
    lastLiveAsOf = d.asof;
    drawAll(aggregateLiveTape(d, todayStr), true);
  }

  function init() {
    load().then(function (vj) {
      drawAll(aggregate(vj), false);
      var sel = $('sx-sort');
      if (sel) sel.addEventListener('change', function () {
        renderTable(currentSectors, sel.value);
      });
      // Wave 7: live feed status next to the batch date; the sector figures
      // themselves follow the 15-minute tape whenever it is today's.
      var NL = window.NepseLive || null;
      if (NL && $('sx-live')) {
        NL.start({ el: $('sx-live'), onData: function (d) { paintLiveFromTape(d); } });
      }
    }).catch(showError);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
