/* Nepse Decode sector dashboard.
   Loads /nepse-chart/data/verdicts.json (via version.json cache-bust) and
   aggregates it into a sector-grouped tile heatmap, per-sector breadth cards, and
   a sortable comparison table, plus a stat strip and a paginated
   sector-stocks panel. Everything is computed client-side from the latest
   daily batch; no figures are invented. A page-owned 60s tick repaints
   from the live tape only when its value-sensitive signature changes. */
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
   * The grouping key is the universe-derived classification below
   * (official company name + instrument-type field from
   * nepse-chart/data/universe.json), used identically in batch and
   * live mode. verdicts.json `sec` is only the fallback, when
   * universe.json failed to load or the symbol is absent from it:
   * tools/sector-map.json (which the universe builder uses for `sec`)
   * is stale (417 keys vs a 432-symbol universe), so 18 symbols carry
   * a default 'Others' sec there (NABILP carries 'Banking') while
   * their universe name+type classifies them correctly. The
   * classifier below is kept identical in js/nepse-screener.js and
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
  var nameMap = null;
  var universeSyms = [];
  function nameOf(sym) {
    return (nameMap && nameMap[sym]) || String(sym || '');
  }
  function sectorOf(e, sym) {
    // Grouping key, SAME in batch and live mode: the universe-derived
    // classification (sectorMap, built from universe.json name+type).
    // verdicts.json sec is only the fallback, when universe.json failed
    // to load or the symbol is absent from it. Reason (verified
    // 2026-10-29): the classifier below disagrees with verdicts sec on
    // exactly 18 symbols and on nothing else, and on all 18 the
    // universe classification is the correct one (11 debentures and
    // 6 promoter shares defaulted to 'Others' in verdicts sec, NABILP
    // to 'Banking', BENH hydropower equity to 'Others'), so
    // universe-first changes nothing but corrections. Every security
    // lands in exactly one real category — never Unclassified.
    if (sectorMap && sectorMap[sym]) return sectorMap[sym];
    if (e && e.sec && e.sec !== 'Unknown') return e.sec;
    return 'Others';
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
        nameMap = {};
        var uj = res[1];
        if (uj && uj.symbols) uj.symbols.forEach(function (it) {
          if (it.s) sectorMap[it.s] = classifySymbol(it.s, it.n, it.t);
          if (it.s && it.n) nameMap[it.s] = it.n;
        });
        universeSyms = Object.keys(sectorMap);
        return res[0];
      })
      .then(function (vj) {
        // Cache the daily batch's RSI per symbol: RSI needs multi-session
        // history, so the live tape reuses the latest batch values instead
        // of showing a dash.
        batchRsi = {};
        var vv = (vj && vj.verdicts) || {};
        Object.keys(vv).forEach(function (sym) {
          var r = vv[sym] && vv[sym].rsi;
          if (r != null && !isNaN(Number(r))) batchRsi[sym] = Number(r);
        });
        return vj;
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
      g.tiles.push({ sym: sym, name: nameOf(sym), p: p, ch: (ch != null && !isNaN(ch)) ? ch : null, turn: turn, vol: vol });
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
        turn: g.turn,
        gainers: gainers, losers: losers, tiles: g.tiles
      };
    });
    // canonical order: sectors by count desc
    list.sort(function (a, b) {
      return b.count - a.count;
    });
    return { sectors: list, asof: vj.asof || '', total: Object.keys(v).length, listed: universeSyms.length || Object.keys(v).length, totalTurn: totalTurn };
  }

  /* Live-tape aggregation: recomputes the sector picture from the live
   * quote tape instead of the daily batch. Same output shape as aggregate()
   * so the renderers work unchanged. Only used when the tape is from
   * today's session (checked by the caller). Built over the FULL listed
   * universe: securities with no quote on the tape yet render as no-data
   * tiles and are counted in noData — never silently dropped. RSI needs
   * multi-session history, so avgRsi reuses the latest daily batch values
   * (batchRsi), which the loader caches from verdicts.json.
   * QUARANTINE BUCKET (2026-10-30, audit F7): the live layer
   * (js/nepse-data.js, ±10% vs previous close — threshold NOT changed
   * here) drops quarantined quotes before consumers see them, so a
   * quarantined symbol is ABSENT from the NepseLive quote map exactly
   * like a genuinely unquoted symbol. Folding it into noData hid it:
   * on 2026-10-29 BENH (+15.0%, real quote) was counted among the
   * "not yet traded". Quarantined symbols are therefore counted
   * SEPARATELY (agg.quarantined, per-sector g.quarantined, quarantined
   * breadth qAdv/qDec/qFlat) and never contribute to traded, breadth,
   * averages, or turnover — their tiles carry no price/change, so no
   * quarantined figure is ever displayed, only the bucket count. The
   * quarantine set comes from the live layer itself: the caller passes
   * it (paintLiveFromTape reads NepseData's flagged snapshot), or a
   * quote carries its own quarantined flag (shapeRawTape, raw-tape path,
   * same ±10% rule). noData is then genuinely unquoted only, and
   * traded + quarantined reconciles to the tape's quoted count. */
  function aggregateLiveTape(live, todayStr, quarantinedSet) {
    var q = (live && live.quotes) || {};
    var sectors = {}, totalTurn = 0;
    // Full listed universe first (captured by load() from universe.json);
    // any tape symbol outside it is appended, never dropped either way.
    var syms = universeSyms.slice();
    Object.keys(q).forEach(function (sym) {
      if (syms.indexOf(sym) < 0) syms.push(sym);
    });
    var qset = quarantinedSet || (live && live.quarantinedSet) || null;
    var traded = 0, quarantined = 0, quarantinedSyms = [];
    var qAdv = 0, qDec = 0, qFlat = 0;
    syms.forEach(function (sym) {
      var e = q[sym] || null;
      var sec = sectorOf(null, sym);
      if (!sectors[sec]) sectors[sec] = {
        name: sec, count: 0, chs: [], adv: 0, dec: 0, flat: 0,
        turn: 0, rsis: [], rows: [], tiles: [], quarantined: 0
      };
      var g = sectors[sec];
      g.count++;
      // Quarantine check FIRST, before the no-quote branch: on the
      // NepseLive path a quarantined symbol is ABSENT from the quote map
      // (e === null) exactly like a genuinely unquoted symbol, so checking
      // !e first would fold it back into noData — the bug being fixed.
      // qset values carry the live layer's percent_change when known
      // (see quarantinedSetFromLiveLayer), so quarantined breadth can
      // still reconcile (traded up + quarantined up = tape up) without
      // displaying any quarantined price/change.
      var isQ = false, qch = null;
      if (e && e.quarantined) {
        isQ = true;
        qch = (e.pct == null || isNaN(e.pct)) ? null : Number(e.pct);
      } else if (qset && qset[sym] != null) {
        isQ = true;
        qch = (typeof qset[sym] === 'number') ? qset[sym]
          : ((e && e.pct != null && !isNaN(e.pct)) ? Number(e.pct) : null);
      }
      if (isQ) {
        // Quarantined by the live layer: counted in its own bucket only.
        // No price/change/turnover is displayed for it, and it contributes
        // to neither traded nor breadth nor any average.
        quarantined++;
        quarantinedSyms.push(sym);
        g.quarantined++;
        if (qch != null) {
          if (qch > 0) qAdv++; else if (qch < 0) qDec++; else qFlat++;
        }
        g.tiles.push({ sym: sym, name: (e && e.name) || nameOf(sym), p: null, ch: null, turn: 0, vol: null, quarantined: true });
        return;
      }
      if (!e) {
        // Listed but not yet traded on this tape: no-data tile, and no
        // breadth/average contribution — present, never silently absent.
        g.tiles.push({ sym: sym, name: nameOf(sym), p: null, ch: null, turn: 0, vol: null });
        return;
      }
      traded++;
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
      if (batchRsi[sym] != null) g.rsis.push(batchRsi[sym]);
      g.tiles.push({ sym: sym, name: e.name || nameOf(sym), p: p, ch: ch, turn: turn, vol: (e.volume != null && !isNaN(Number(e.volume))) ? Number(e.volume) : null });
    });
    var list = Object.keys(sectors).map(function (k) {
      var g = sectors[k];
      var n = g.chs.length;
      var avgCh = n ? g.chs.reduce(function (a, b) { return a + b; }, 0) / n : null;
      var avgRsi = g.rsis.length
        ? g.rsis.reduce(function (a, b) { return a + b; }, 0) / g.rsis.length : null;
      var gainers = g.rows.slice().sort(function (a, b) { return b.ch - a.ch; }).slice(0, 3);
      var losers = g.rows.slice().sort(function (a, b) { return a.ch - b.ch; }).slice(0, 3);
      return {
        name: g.name, count: g.count, adv: g.adv, dec: g.dec, flat: g.flat, nCh: n,
        avgCh: avgCh, pctUp: n ? (g.adv / n) * 100 : null, avgRsi: avgRsi,
        turnShare: totalTurn > 0 ? (g.turn / totalTurn) * 100 : null,
        turn: g.turn, quarantined: g.quarantined || 0,
        gainers: gainers, losers: losers, tiles: g.tiles
      };
    });
    list.sort(function (a, b) {
      return b.count - a.count;
    });
    return { sectors: list, asof: todayStr, total: syms.length, listed: syms.length, traded: traded,
      quarantined: quarantined, quarantinedSyms: quarantinedSyms,
      quarantinedAdv: qAdv, quarantinedDec: qDec, quarantinedFlat: qFlat,
      noData: syms.length - traded - quarantined, tapeAsof: (live && live.asof) || 0, totalTurn: totalTurn };
  }

  /* Quarantine set from the live layer: NepseData's canonical snapshot
   * keeps quarantined quotes, flagged (q.quarantined), even though
   * getQuotes()/NepseLive filter them out of the consumer map. Reading
   * the set here — never re-deriving it from the filtered map, where
   * quarantined and unquoted are indistinguishable — is what lets
   * aggregateLiveTape break quarantine out of noData. Returns null when
   * the live layer is unavailable (caller then falls back to the
   * filtered counts, as before). */
  function quarantinedSetFromLiveLayer() {
    try {
      var ND = window.NepseData;
      if (!ND || typeof ND.getSnapshot !== 'function') return null;
      var snap = ND.getSnapshot();
      if (!snap) return null;
      var set = {};
      function put(qq) {
        if (!qq || !qq.quarantined) return;
        var pc = Number(qq.percent_change);
        set[qq.symbol] = isFinite(pc) ? pc : true;
      }
      (snap.quotes || []).forEach(put);
      var map = snap.map || {};
      Object.keys(map).forEach(function (s) { put(map[s]); });
      return set;
    } catch (e) { return null; }
  }

  var MONTHS_L = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  function fmtLiveDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + ' ' + MONTHS_L[+m[2] - 1] + ' ' + m[1] : String(iso || '');
  }

  function pad2(n) { return ('0' + n).slice(-2); }
  // " · last update 14:32 NPT · 6 min old", from the tape's own asof
  // (epoch ms) — measured, never a hardcoded refresh claim. Empty string
  // when the tape carries no timestamp.
  function tapeAgeBit(asofMs) {
    var t = Number(asofMs);
    if (!t || !isFinite(t)) return '';
    var npt = new Date(t + 5.75 * 3600 * 1000);
    var hhmm = pad2(npt.getUTCHours()) + ':' + pad2(npt.getUTCMinutes());
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    return ' · last update ' + hhmm + ' NPT · ' + (mins < 1 ? 'under 1 min old' : mins + ' min old');
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
          (t.turn > 0 ? ' · turnover ' + fmtTurn(t.turn) : '') +
          (t.quarantined ? ' · quarantined' : '');
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
        (window.NepseLogo ? window.NepseLogo.html(r.sym, sec, 26) : (Mono ? Mono.avatar(r.sym, sec, 26) : '')) + '<span>' + esc(r.sym) + '</span></a>' +
        '<span class="sx-p tnum">' + esc(price) + '</span>' +
        '<span class="sx-ch tnum">' + signPct(r.ch) + '</span></li>';
    }).join('') + '</ul>';
  }

  function renderCards(sectors) {
    var h = sectors.map(function (g) {
      var t = g.adv + g.dec + g.flat;
      var qn = g.quarantined || 0;
      var noCh = g.count - t - qn;
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
          (noCh ? ' · ' + noCh + ' no change data' : '') +
          (qn ? ' · ' + qn + ' quarantined' : '') + '</p>' +
        '<details><summary>Leaders and laggards</summary>' +
          '<div class="sx-lead">' +
            '<div><h4>Top gainers</h4>' + leaderList(g.gainers, g.name, 'No change data in this sector.') + '</div>' +
            '<div><h4>Top losers</h4>' + leaderList(g.losers, g.name, 'No change data in this sector.') + '</div>' +
          '</div></details>' +
        '<button type="button" class="sx-panel-stockbtn" data-sec="' + esc(g.name) + '">View all ' + g.count + ' stocks in ' + esc(g.name) + '</button></article>';
    }).join('');
    $('sx-cards').innerHTML = h;
    var btns = document.querySelectorAll('#sx-cards .sx-panel-stockbtn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        openPanelSector(this.getAttribute('data-sec'));
      });
    }
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
      // Heatmap tiles: show immediately, no scroll-reveal (reveal was leaving invisible gaps)
      var els = document.querySelectorAll('#sx-cards .sx-card');
      for (var j = 0; j < els.length; j++) els[j].classList.add('rv');
      M.reveal(document);
      M.watchCounts(document);
    }
  }


  /* S2 · Market map treemap: top 60 securities sized by turnover or volume,
   * colored by the same fixed day-change bands as the sector legend. Hover
   * shows a real-data tooltip; a click opens that security's stock page. */
  var mapMode = 'turnover';
  var mapRects = [];
  var MAP_TOP = 60;
  function mapBands() {
    /* Kept in sync with the --heat-* tokens in nepse-sectors/index.html and
       nepse-sectors/sectors.css (2026-10-09 mid-band brightening). */
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    if (light) return {
      up2: ['#1E7A44', '#FAF8F2'], up1: ['#cfe8cf', '#0C1F16'],
      n: ['#FAF8F2', '#0C1F16'], dn1: ['#f2cfc7', '#0C1F16'],
      dn2: ['#B23A2E', '#FAF8F2'], none: ['#E7DFCE', '#66705F']
    };
    return {
      up2: ['#3ddc84', '#06120c'], up1: ['#2f8f57', '#07130c'],
      n: ['#232c3a', '#aeb8c6'], dn1: ['#c2544c', '#ffffff'],
      dn2: ['#ff5d5d', '#1c0605'], none: ['#1a2230', '#525c6c']
    };
  }
  function mapBandOf(ch) {
    if (ch == null || isNaN(ch)) return 'none';
    if (ch >= 1.5) return 'up2';
    if (ch >= 0.25) return 'up1';
    if (ch > -0.25) return 'n';
    if (ch > -1.5) return 'dn1';
    return 'dn2';
  }
  function mapItems(sectors) {
    var all = [];
    (sectors || []).forEach(function (g) {
      (g.tiles || []).forEach(function (t) {
        var size = mapMode === 'volume' ? (t.vol || 0) : (t.turn || 0);
        if (size > 0) all.push({
          sym: t.sym, name: t.name || t.sym, sec: g.name,
          p: t.p, ch: t.ch, turn: t.turn, vol: t.vol, size: size
        });
      });
    });
    all.sort(function (a, b) { return b.size - a.size; });
    return all.slice(0, MAP_TOP);
  }
  /* Squarified treemap layout, ported from the D2 S2 sample
   * (~/workspace/wt-design samples/js/samples.js). Items must be sorted
   * desc by size; returns [{item, x, y, w, h}] with no gaps or overlaps. */
  function squarify(children, x, y, w, h) {
    var out = [];
    var total = 0, i;
    for (i = 0; i < children.length; i++) total += children[i].size;
    if (!total || w <= 0 || h <= 0) return out;
    var scale = (w * h) / total;
    var rest = children.map(function (c) { return { item: c, v: c.size * scale }; });
    var row = [], rowSum = 0, cx = x, cy = y, cw = w, ch = h;
    function worst(rs) {
      var s = Math.min(cw, ch), sum = 0, mx = 0, mn = Infinity, k;
      for (k = 0; k < rs.length; k++) {
        sum += rs[k].v;
        if (rs[k].v > mx) mx = rs[k].v;
        if (rs[k].v < mn) mn = rs[k].v;
      }
      if (!sum || !mn || !isFinite(mn) || !s) return Infinity;
      return Math.max((s * s * mx) / (sum * sum), (sum * sum) / (s * s * mn));
    }
    function layoutRow() {
      var horizontal = cw >= ch;
      var shortSide = Math.min(cw, ch);
      var t = shortSide ? rowSum / shortSide : 0;
      var off = 0, k;
      for (k = 0; k < row.length; k++) {
        var it = row[k];
        var len = rowSum ? (it.v / rowSum) * shortSide : 0;
        out.push({
          item: it.item,
          x: horizontal ? cx : cx + off,
          y: horizontal ? cy + off : cy,
          w: horizontal ? t : len,
          h: horizontal ? len : t
        });
        off += len;
      }
      if (horizontal) { cx += t; cw -= t; } else { cy += t; ch -= t; }
      row = []; rowSum = 0;
    }
    while (rest.length) {
      var it = rest[0];
      var trial = row.concat([it]);
      if (!row.length || worst(trial) <= worst(row)) {
        row = trial; rowSum += it.v; rest.shift();
      } else {
        layoutRow();
      }
    }
    if (row.length) layoutRow();
    return out;
  }
  function mapLabel(ctx, rect, bands) {
    var it = rect.item, pad = 6;
    if (rect.w < 36 || rect.h < 32) return;
    var band = bands[mapBandOf(it.ch)];
    ctx.fillStyle = band[1];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    var fs = (rect.w > 120 && rect.h > 56) ? 13 : 11;
    ctx.font = '700 ' + fs + 'px Inter,system-ui,sans-serif';
    ctx.fillText(String(it.sym).slice(0, 12), rect.x + pad, rect.y + pad, Math.max(0, rect.w - pad * 2));
    if (rect.h > 46) {
      ctx.font = '600 11px Inter,system-ui,sans-serif';
      var chs = (it.ch == null || isNaN(it.ch)) ? '-' :
        ((it.ch > 0 ? '+' : '') + Number(it.ch).toFixed(2) + '%');
      ctx.fillText(chs, rect.x + pad, rect.y + pad + fs + 4, Math.max(0, rect.w - pad * 2));
    }
  }
  function renderMap(sectors) {
    var cv = $('sxMap');
    if (!cv || !sectors || !sectors.length) return;
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 800;
    var csH = parseInt((window.getComputedStyle ? getComputedStyle(cv).height : ''), 10);
    var H = (csH && csH > 0) ? csH : 420;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var items = mapItems(sectors);
    var bands = mapBands();
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = light ? '#F6F7F9' : '#0A0C10';
    ctx.fillRect(0, 0, W, H);
    mapRects = items.length ? squarify(items, 0, 0, W, H) : [];
    mapRects.forEach(function (r) {
      var band = bands[mapBandOf(r.item.ch)];
      ctx.fillStyle = band[0];
      var gap = 2, x = r.x + gap / 2, y = r.y + gap / 2,
          w = r.w - gap, h = r.h - gap;
      if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      mapLabel(ctx, r, bands);
    });
    var cnt = $('sxMapCount');
    if (cnt) cnt.textContent = items.length ? ('Top ' + items.length + ' by ' + mapMode) : '';
    var st = $('sxMapState');
    if (st) st.textContent = lastLiveAsOf ? 'LIVE' : 'BATCH';
    var src = $('sxMapSrc');
    if (src) src.textContent = 'Top ' + (items.length || MAP_TOP) + ' by ' + mapMode +
      ' · tile color follows the fixed day-change bands · click a tile for its page';
  }
  function mapHit(mx, my) {
    for (var i = mapRects.length - 1; i >= 0; i--) {
      var r = mapRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return null;
  }
  function mapTipHTML(it) {
    var px = (it.p != null && isFinite(it.p))
      ? 'Rs ' + Number(it.p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
    var ch = (it.ch == null || isNaN(it.ch)) ? '-'
      : ((it.ch > 0 ? '+' : '') + Number(it.ch).toFixed(2) + '%');
    var h = '<div class="t-sym">' + esc(it.sym) + '</div>' +
      '<div class="t-name">' + esc(it.name) + '</div>' +
      '<div class="t-row"><span>Price</span><b>' + esc(px) + '</b></div>' +
      '<div class="t-row"><span>Day change</span><b>' + esc(ch) + '</b></div>' +
      '<div class="t-row"><span>Turnover</span><b>' + esc(fmtTurn(it.turn) || '-') + '</b></div>' +
      '<div class="t-row"><span>Volume</span><b>' + esc(it.vol != null ? Number(it.vol).toLocaleString('en-US') : '-') + '</b></div>' +
      '<div class="t-row"><span>Sector</span><b>' + esc(it.sec) + '</b></div>';
    return h;
  }
  function stockURL(sym) {
    return '/stocks/' + encodeURIComponent(String(sym).replace(/\//g, '-')) + '/';
  }
  function initMap() {
    var cv = $('sxMap');
    if (!cv) return;
    var tip = $('sxMapTip');
    /* The tip is position:fixed, but it lives inside a .d2-card whose :hover
       lift (transform) turns the card into the containing block for fixed
       descendants — the tip then renders offset by the card's distance from
       the viewport origin (verified 2026-10-23: +205/+316 px locally; the
       owner's right-edge tiles pushed it off-screen). Reparent to <body> so
       fixed means the viewport (same repair as the mobile nav drawer). */
    if (tip && tip.parentNode !== document.body) document.body.appendChild(tip);
    cv.addEventListener('mousemove', function (ev) {
      var r = cv.getBoundingClientRect();
      var hit = mapHit(ev.clientX - r.left, ev.clientY - r.top);
      if (hit && tip) {
        tip.innerHTML = mapTipHTML(hit.item);
        tip.style.display = 'block';
        var tw = tip.offsetWidth, th = tip.offsetHeight;
        var lx = ev.clientX + 14, ly = ev.clientY + 14;
        if (lx + tw > window.innerWidth - 8) lx = ev.clientX - tw - 14;
        if (ly + th > window.innerHeight - 8) ly = ev.clientY - th - 14;
        tip.style.left = lx + 'px';
        tip.style.top = ly + 'px';
        cv.style.cursor = 'pointer';
      } else {
        if (tip) tip.style.display = 'none';
        cv.style.cursor = 'default';
      }
    });
    cv.addEventListener('mouseleave', function () { if (tip) tip.style.display = 'none'; });
    cv.addEventListener('click', function (ev) {
      var r = cv.getBoundingClientRect();
      var hit = mapHit(ev.clientX - r.left, ev.clientY - r.top);
      if (hit) window.location.href = stockURL(hit.item.sym);
    });
    var seg = document.querySelectorAll('.d2-seg button');
    for (var i = 0; i < seg.length; i++) {
      seg[i].addEventListener('click', function () {
        for (var j = 0; j < seg.length; j++)
          seg[j].setAttribute('aria-pressed', seg[j] === this ? 'true' : 'false');
        mapMode = (this.getAttribute('data-size') === 'volume') ? 'volume' : 'turnover';
        renderMap(currentSectors);
        rebaselineSig();
      });
    }
    var rsz = null;
    window.addEventListener('resize', function () {
      if (rsz) clearTimeout(rsz);
      rsz = setTimeout(function () { renderMap(currentSectors); rebaselineSig(); }, 150);
    });
    try {
      new MutationObserver(function (muts) {
        for (var k = 0; k < muts.length; k++) {
          if (muts[k].attributeName === 'data-theme') { renderMap(currentSectors); break; }
        }
      }).observe(document.documentElement, { attributes: true });
    } catch (e) { /* older browsers keep the current theme colors */ }
  }

  var currentSectors = [];
  var lastLiveAsOf = 0;
  var batchRsi = {};
  var heatFilter = 'all';

  /* Teardown 2026-10-28 — sector-stocks panel state + refresh signature.
   * The signature describes the DATA (mode/asof/traded/turnover/tape
   * time), never the view: view-change handlers RE-BASELINE it from the
   * last aggregate after re-rendering, so a tick never mistakes a
   * filtered view for changed data. It is never nulled. */
  var panelSector = null, panelSort = 'turnover', panelSearch = '', panelPage = 1;
  var PANEL_PAGE = 25;
  var lastSig = null, lastAgg = null, lastIsLive = false, drawCount = 0;
  var freshTimer = null;

  function sigOf(agg, isLive) {
    if (!agg) return null;
    // Value-sensitive tail: FNV-1a over symbol:price:change:turnover for
    // every tile (sorted by symbol), so a quote move repaints even when
    // the snapshot timestamp does not advance (beyond NepseLive's
    // asof-only gate).
    var tiles = [];
    (agg.sectors || []).forEach(function (g) {
      (g.tiles || []).forEach(function (t) { tiles.push(t); });
    });
    tiles.sort(function (a, b) { return String(a.sym).localeCompare(String(b.sym)); });
    var h = 2166136261;
    tiles.forEach(function (t) {
      var s = t.sym + ':' + t.p + ':' + t.ch + ':' + t.turn + '|';
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    });
    return (isLive ? 'live' : 'batch') + '|' + (agg.asof || '') + '|' +
      (agg.traded != null ? agg.traded : agg.total) + '|' +
      (agg.quarantined || 0) + '|' +
      Math.round(agg.totalTurn || 0) + '|' + (agg.tapeAsof || 0) + '|' + h.toString(16);
  }
  function rebaselineSig() {
    // View changed, data did not: re-assert the signature from the last
    // aggregate. Never nulls it — a null would force a spurious repaint.
    if (lastAgg) lastSig = sigOf(lastAgg, lastIsLive);
  }
  function nptHHMM(t) {
    var d = new Date((t || Date.now()) + 5.75 * 3600 * 1000);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function fmtMoneyFull(x) {
    if (x == null || !isFinite(x)) return '-';
    if (x >= 1e9) return 'Rs ' + (x / 1e9).toFixed(2) + ' arab';
    if (x >= 1e7) return 'Rs ' + (x / 1e7).toFixed(2) + ' Cr';
    if (x >= 1e5) return 'Rs ' + (x / 1e5).toFixed(2) + ' L';
    return 'Rs ' + Math.round(x).toLocaleString('en-US');
  }
  function updateFreshline() {
    var fl = $('sxFreshline');
    if (!fl || !lastAgg) return;
    var agg = lastAgg;
    var state = lastIsLive ? 'live' : 'closed';
    var now = Date.now(), next = now + 60000;
    var session = lastIsLive ? ('Live session of ' + fmtLiveDay(agg.asof))
      : ('Batch as of ' + (agg.asof || '—'));
    var counts = lastIsLive
      ? ((agg.traded != null ? agg.traded : agg.total) + ' traded · ' +
        (agg.quarantined ? agg.quarantined + ' quarantined · ' : '') +
        (agg.noData != null ? agg.noData : 0) + ' not yet traded')
      : (agg.total + ' of ' + (agg.listed || agg.total) + ' listed securities');
    fl.innerHTML = '<span class="sx-fresh-dot" data-state="' + state + '"></span>' +
      esc(session) + ' · ' + esc(counts) +
      ' · checked ' + nptHHMM(now) + ' NPT · next check ' + nptHHMM(next) +
      ' NPT · refreshes every 60s when data changes';
  }
  function renderStats(agg, isLive) {
    var secs = agg.sectors || [];
    var adv = 0, dec = 0, flat = 0;
    secs.forEach(function (g) { adv += g.adv; dec += g.dec; flat += g.flat; });
    var t = adv + dec + flat;
    var top = secs.slice().sort(function (a, b) { return (b.turnShare || 0) - (a.turnShare || 0); })[0];
    var el;
    el = $('sxStatListed');
    if (el) el.textContent = isLive
      ? ((agg.traded != null ? agg.traded : agg.total) + ' of ' + (agg.listed || agg.total))
      : String(agg.listed || agg.total);
    el = $('sxStatListedSub');
    if (el) el.textContent = isLive
      ? ((agg.noData != null ? agg.noData : 0) + ' not yet traded' +
        (agg.quarantined ? ' · ' + agg.quarantined + ' quarantined' : '') +
        ' · ' + secs.length + ' sectors')
      : (secs.length + ' sectors · batch as of ' + (agg.asof || '—'));
    el = $('sxStatTurn');
    if (el) el.textContent = fmtMoneyFull(agg.totalTurn);
    el = $('sxStatTurnSub');
    if (el) el.textContent = isLive ? 'tape sum · live session'
      : 'batch sum (volume × price) · ' + (agg.asof || '—');
    el = $('sxStatBreadth');
    if (el) el.textContent = adv + ' up · ' + dec + ' down';
    el = $('sxStatBreadthSub');
    if (el) el.textContent = flat + ' flat · ' + t + ' with change data' +
      ((isLive && agg.quarantined)
        ? ' · ' + agg.quarantined + ' quarantined (' + (agg.quarantinedAdv || 0) + ' up)'
        : '');
    el = $('sxStatBreadthBar');
    if (el) {
      var wUp = t ? (adv / t) * 100 : 0, wDn = t ? (dec / t) * 100 : 0, wFl = t ? (flat / t) * 100 : 0;
      el.innerHTML = '<i class="sx-b-up" style="width:' + wUp.toFixed(1) + '%"></i>' +
        '<i class="sx-b-dn" style="width:' + wDn.toFixed(1) + '%"></i>' +
        '<i class="sx-b-flat" style="width:' + wFl.toFixed(1) + '%"></i>';
      el.setAttribute('aria-label', 'Breadth: ' + adv + ' up, ' + dec + ' down, ' + flat + ' flat');
    }
    el = $('sxStatTop');
    if (el) el.textContent = top ? top.name : '—';
    el = $('sxStatTopSub');
    if (el) el.textContent = top
      ? ((top.turnShare != null ? top.turnShare.toFixed(1) + '% of turnover' : '') +
        (top.turn ? ' · ' + fmtTurn(top.turn) : ''))
      : '—';
  }
  function panelRows() {
    var g = null;
    for (var i = 0; i < currentSectors.length; i++) {
      if (currentSectors[i].name === panelSector) { g = currentSectors[i]; break; }
    }
    if (!g) return [];
    var q = panelSearch.trim().toLowerCase();
    var rows = (g.tiles || []).slice();
    if (q) rows = rows.filter(function (t) {
      return String(t.sym).toLowerCase().indexOf(q) >= 0 ||
        String(t.name || '').toLowerCase().indexOf(q) >= 0;
    });
    if (panelSort === 'change') {
      rows.sort(function (a, b) {
        var ca = (a.ch == null ? -9999 : a.ch), cb = (b.ch == null ? -9999 : b.ch);
        return cb - ca;
      });
    } else if (panelSort === 'symbol') {
      rows.sort(function (a, b) { return String(a.sym).localeCompare(String(b.sym)); });
    } else {
      rows.sort(function (a, b) { return (b.turn || 0) - (a.turn || 0); });
    }
    return rows;
  }
  function renderPanelSelect() {
    var sel = $('sxPanelSector');
    if (!sel) return;
    var names = currentSectors.map(function (g) { return g.name; });
    if (panelSector == null || names.indexOf(panelSector) < 0) {
      panelSector = currentSectors.length
        ? currentSectors.slice().sort(function (a, b) { return b.count - a.count; })[0].name
        : null;
    }
    sel.innerHTML = currentSectors.map(function (g) {
      return '<option value="' + esc(g.name) + '"' +
        (g.name === panelSector ? ' selected' : '') + '>' +
        esc(g.name) + ' (' + g.count + ')</option>';
    }).join('');
  }
  function renderPanel() {
    var body = $('sxPanelBody');
    if (!body) return;
    var rows = panelRows();
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PANEL_PAGE));
    if (panelPage > pages) panelPage = pages;
    if (panelPage < 1) panelPage = 1;
    var start = (panelPage - 1) * PANEL_PAGE;
    var page = rows.slice(start, start + PANEL_PAGE);
    body.innerHTML = page.length ? page.map(function (t) {
      var traded = t.p != null;
      var status = t.quarantined
        ? '<span class="sx-notrade">quarantined</span>'
        : (lastIsLive
          ? (traded ? '<span class="sx-live-dot"></span>traded' : '<span class="sx-notrade">no trade</span>')
          : (traded ? 'session' : '<span class="sx-notrade">no price data</span>'));
      return '<tr><td><a href="' + esc(stockURL(t.sym)) + '">' + esc(t.sym) + '</a></td>' +
        '<td class="sx-col-name">' + esc(t.name || t.sym) + '</td>' +
        '<td class="num">' + (t.p != null ? esc(num(t.p, 2)) : '<span class="sx-dash">-</span>') + '</td>' +
        '<td class="num">' + signPct(t.ch) + '</td>' +
        '<td class="num">' + (t.turn > 0 ? esc(fmtTurn(t.turn)) : '<span class="sx-dash">-</span>') + '</td>' +
        '<td>' + status + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="sx-empty">No stocks match this filter.</td></tr>';
    var prev = $('sxPanelPrev'), next = $('sxPanelNext'), show = $('sxPanelShowing');
    if (prev) prev.disabled = panelPage <= 1;
    if (next) next.disabled = panelPage >= pages;
    if (show) show.textContent = total
      ? ('Showing ' + (start + 1) + '–' + Math.min(start + PANEL_PAGE, total) + ' of ' + total)
      : 'Showing 0–0 of 0';
  }
  function openPanelSector(name) {
    panelSector = name; panelPage = 1;
    renderPanelSelect();
    renderPanel();
    rebaselineSig();
    var sel = $('sxPanelSector');
    var panel = $('sx-panel-h');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (sel) sel.focus({ preventScroll: true });
  }
  /* Shape a RAW live.json fetch into the NepseLive shape paintLiveFromTape
   * expects: asof as epoch ms, quotes as a symbol-keyed map with pct
   * (not percent_change). Skipping this step feeds aggregateLiveTape a
   * LIST, which it reads as indices — every symbol renders untraded. */
  function shapeRawTape(raw) {
    if (!raw || !Array.isArray(raw.quotes)) return null;
    var asofMs = Date.parse(raw.asof);
    if (!isFinite(asofMs)) return null;
    function num(v) { v = Number(v); return isFinite(v) ? v : null; }
    // Quarantine threshold: read from the live layer's own config
    // (nepse-market-config.js CIRCUIT_QUARANTINE_PCT, ±10%) — read,
    // never changed, here. The flag lets aggregateLiveTape break
    // quarantined symbols out of "not yet traded" on this raw-tape path,
    // where no live-layer filtering has happened yet.
    var thresh = 10;
    try {
      var CFG = window.NepseMarketConfig;
      if (CFG && CFG.CIRCUIT_QUARANTINE_PCT != null && isFinite(Number(CFG.CIRCUIT_QUARANTINE_PCT)))
        thresh = Number(CFG.CIRCUIT_QUARANTINE_PCT);
    } catch (e) { /* keep 10 */ }
    var quotes = {};
    raw.quotes.forEach(function (q) {
      if (!q || !q.symbol) return;
      var ltp = num(q.ltp), prev = num(q.previous_close);
      var isQ = (ltp != null && prev != null && prev > 0 &&
        Math.abs((ltp - prev) / prev) * 100 > thresh);
      quotes[q.symbol] = {
        symbol: q.symbol, ltp: ltp, change: num(q.change),
        pct: num(q.percent_change), high: num(q.high), low: num(q.low),
        volume: num(q.volume), turnover: num(q.turnover), trades: num(q.trades),
        prev: prev, name: q.name || null, quarantined: isQ
      };
    });
    return { asof: asofMs, quotes: quotes };
  }
  /* Page-owned 60s tick (all hours, visible tab only): fetches the tape,
   * builds the live aggregate PURELY (no render), and repaints ONLY when
   * its signature differs from the rendered state. Identical data →
   * only the freshline clock advances; data containers stay byte-stable.
   * A failed fetch never clears the page — it only skips the repaint. */
  function tickNow() {
    updateFreshline();
    if (document.hidden) return;
    getJSON('/nepse-chart/data/live.json').then(function (raw) {
      var shaped = shapeRawTape(raw);
      if (!shaped) return;
      var NL = window.NepseLive;
      var todayStr = null;
      try { todayStr = NL ? NL.nowNPT().toISOString().slice(0, 10) : null; } catch (e) { /* keep null */ }
      if (!todayStr) return;
      // Stale tape (yesterday's frozen session on a new morning): the
      // freshline clock already advanced above; never paint it as live.
      var tapeDay = null;
      try { tapeDay = new Date(shaped.asof + 5.75 * 3600 * 1000).toISOString().slice(0, 10); } catch (e) { /* keep null */ }
      if (tapeDay !== todayStr) return;
      var agg = aggregateLiveTape(shaped, todayStr);
      if (sigOf(agg, true) === lastSig) return;
      var hh = null;
      try {
        var npt = new Date(Date.now() + 5.75 * 3600 * 1000);
        hh = npt.getUTCHours();
      } catch (e) { /* keep null */ }
      var st = (hh != null && hh >= 11 && hh < 15) ? 'live' : null;
      // Paint DIRECTLY, not via paintLiveFromTape: that function's asof
      // gate would swallow a value-only change (same snapshot time, new
      // quotes — the exact change this hash detected). Day guards already
      // applied above; the signature is this path's gate. NepseLive's own
      // onData path keeps using paintLiveFromTape unchanged.
      drawAll(agg, true, st);
      lastLiveAsOf = shaped.asof;
    }).catch(function () { /* tape unavailable: page keeps its last good render */ });
  }

  /* Concept 03: sector filter pills for the heatmap (preview view-heatmap).
   * Pills are built from the real sector names in the data. */
  function renderHeatFilters(sectors) {
    var host = $('sx-heat-filters');
    if (!host) return;
    var names = sectors.map(function (g) { return g.name; });
    var html = '<button type="button" data-heat="all"' + (heatFilter === 'all' ? ' class="active"' : '') + '>All sectors</button>' +
      names.map(function (n) {
        return '<button type="button" data-heat="' + esc(n) + '"' +
          (heatFilter === n ? ' class="active"' : '') + '>' + esc(n) + '</button>';
      }).join('');
    host.innerHTML = html;
    var btns = host.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        heatFilter = this.getAttribute('data-heat');
        renderHeatFilters(currentSectors);
        renderHeat(heatFilter === 'all' ? currentSectors :
          currentSectors.filter(function (g) { return g.name === heatFilter; }));
        rebaselineSig();
      });
    }
  }

  function drawAll(agg, isLive, marketState) {
    currentSectors = agg.sectors;
    // Baseline FIRST: renders below (panel status, freshline) read the
    // current mode, and the tick's before/after drawCount comparison
    // needs the increment to cover this draw.
    lastAgg = agg; lastIsLive = !!isLive;
    lastSig = sigOf(agg, isLive);
    drawCount++;
    renderHeatFilters(currentSectors);
    // View preservation: a live repaint must NOT reset the user's heat
    // filter (pre-teardown bug: renderHeat always drew all sectors).
    renderHeat(heatFilter === 'all' ? currentSectors :
      currentSectors.filter(function (g) { return g.name === heatFilter; }));
    renderCards(currentSectors);
    var sel = $('sx-sort');
    renderTable(currentSectors, sel ? sel.value : 'change');
    renderStats(agg, isLive);
    renderPanelSelect();
    renderPanel();
    animateSectors();
    var sxAsof = $('sx-asof');
    if (sxAsof) {
      if (isLive) {
        var liveNow = (marketState === 'live' || marketState === 'delayed');
        sxAsof.textContent = (liveNow ? 'Live session of ' : 'Session of ') + fmtLiveDay(agg.asof) + ' · ' +
          agg.total + ' of ' + (agg.listed || agg.total) + ' listed securities · ' +
          (agg.traded != null ? agg.traded : agg.total) + ' traded · ' +
          (agg.quarantined ? agg.quarantined + ' quarantined · ' : '') +
          (agg.noData != null ? agg.noData : 0) + ' not yet traded' + tapeAgeBit(agg.tapeAsof);
      } else {
        sxAsof.textContent = agg.asof
          ? 'Aggregated from the batch as of ' + agg.asof + ' · ' + agg.total + ' of ' + (agg.listed || agg.total) + ' listed securities'
          : agg.total + ' of ' + (agg.listed || agg.total) + ' listed securities aggregated';
      }
      if (window.NepseFresh && agg.asof && !sxAsof.querySelector('.fresh'))
        sxAsof.insertAdjacentHTML('beforeend', ' · ' + window.NepseFresh.badge(agg.asof));
    }
    renderMap(currentSectors);
    updateFreshline();
  }

  // Recomputes every sector figure from the quote tape whenever a fresh
  // snapshot of TODAY's session lands, in market hours and after close.
  // Never mixes sessions: a tape from any other day is ignored.
  function paintLiveFromTape(d, st) {
    var NL = window.NepseLive;
    if (!NL || !d || !d.quotes || !d.asof || d.asof === lastLiveAsOf) return;
    // CRITICAL: Don't use fetch timestamp (d.asof) to determine "today's session".
    // On weekends, a fresh poll has today's timestamp but Friday's data.
    // Check if today is actually a trading day first.
    var CFG = window.NepseMarketConfig;
    try {
      if (CFG && typeof CFG.isHoliday === 'function' && CFG.isHoliday(NL.nowNPT())) return;
      var dow = NL.nowNPT().getUTCDay();
      if (dow === 0 || dow === 6) return; // Saturday/Sunday: never "live"
    } catch (e) { /* continue with date check */ }
    var dayStr = null, todayStr = null;
    try {
      dayStr = new Date(d.asof + 5.75 * 3600 * 1000).toISOString().slice(0, 10);
      todayStr = NL.nowNPT().toISOString().slice(0, 10);
    } catch (e) { /* keep nulls */ }
    if (!dayStr || dayStr !== todayStr) return;
    lastLiveAsOf = d.asof;
    // NepseLive's map is already quarantine-filtered, so pass the live
    // layer's own flagged set — without it, quarantined symbols would
    // again fold into "not yet traded" (see aggregateLiveTape).
    drawAll(aggregateLiveTape(d, todayStr, quarantinedSetFromLiveLayer()), true, st && st.state);
  }

  function init() {
    initMap();
    load().then(function (vj) {
      drawAll(aggregate(vj), false);
      var sel = $('sx-sort');
      if (sel) sel.addEventListener('change', function () {
        renderTable(currentSectors, sel.value);
        rebaselineSig();
      });
      var psel = $('sxPanelSector');
      if (psel) psel.addEventListener('change', function () {
        panelSector = psel.value; panelPage = 1;
        renderPanel();
        rebaselineSig();
      });
      var psort = $('sxPanelSort');
      if (psort) psort.addEventListener('change', function () {
        panelSort = psort.value; panelPage = 1;
        renderPanel();
        rebaselineSig();
      });
      var psearch = $('sxPanelSearch');
      if (psearch) psearch.addEventListener('input', function () {
        panelSearch = psearch.value; panelPage = 1;
        renderPanel();
        rebaselineSig();
      });
      var pprev = $('sxPanelPrev');
      if (pprev) pprev.addEventListener('click', function () {
        if (panelPage > 1) { panelPage--; renderPanel(); rebaselineSig(); }
      });
      var pnext = $('sxPanelNext');
      if (pnext) pnext.addEventListener('click', function () {
        panelPage++; renderPanel(); rebaselineSig();
      });
      // Page-owned 60s refresh tick (all hours): value-sensitive, see
      // tickNow. NepseLive's own 60s poll stays for the status badge.
      if (!freshTimer) freshTimer = setInterval(tickNow, 60000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') tickNow();
      });
      // Wave 7: live feed status next to the batch date; the sector figures
      // themselves follow the 15-minute tape whenever it is today's.
      var NL = window.NepseLive || null;
      if (NL && $('sx-live')) {
        NL.start({ el: $('sx-live'), onData: function (d, st) { paintLiveFromTape(d, st); } });
      }
    }).catch(showError);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
