/**
 * js/nd-daily.js — NEPSE Daily Summary: full-market sortable table.
 * Renders every quote from /nepse-chart/data/live.json. Real data only.
 * Sort via clickable headers or ?sort=gainers|losers|turnover|volume|transactions.
 * Open price is not published in the feed -> rendered as "Unavailable" (honest).
 */
(function () {
  'use strict';

  var LIVE_URL = '/nepse-chart/data/live.json';
  var PER_PAGE = 50;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // True trading session date: derived from market-data timestamps, NOT the fetch time.
  // live.asof is when the pipeline fetched; the session is when the market actually traded.
  function getSessionDate(live) {
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
  function fmtInt(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------- Sort definitions ---------- */
  // key -> { label, get(q), dir: default direction ('desc'|'asc') }
  var COLS = {
    symbol:        { get: function (q) { return (q.symbol || '').toUpperCase(); }, dir: 'asc',  numeric: false },
    ltp:           { get: function (q) { return num(q.ltp); },                      dir: 'desc', numeric: true },
    change:        { get: function (q) { return num(q.change); },                   dir: 'desc', numeric: true },
    percent_change:{ get: function (q) { return num(q.percent_change); },          dir: 'desc', numeric: true },
    dayrange:      { get: function (q) { return num(q.high) - num(q.low); },        dir: 'desc', numeric: true },
    previous_close:{ get: function (q) { return num(q.previous_close); },          dir: 'desc', numeric: true },
    volume:        { get: function (q) { return num(q.volume); },                   dir: 'desc', numeric: true },
    trades:        { get: function (q) { return num(q.trades); },                   dir: 'desc', numeric: true },
    turnover:      { get: function (q) { return num(q.turnover); },                 dir: 'desc', numeric: true }
  };
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : -Infinity;
  }

  // ?sort= presets
  var PRESETS = {
    gainers:      { key: 'percent_change', dir: 'desc' },
    losers:       { key: 'percent_change', dir: 'asc' },
    turnover:     { key: 'turnover',       dir: 'desc' },
    volume:       { key: 'volume',         dir: 'desc' },
    transactions: { key: 'trades',          dir: 'desc' }
  };

  var state = {
    quotes: [],
    sortKey: 'turnover',
    sortDir: 'desc',
    query: '',
    sector: '',
    page: 0,
    perPage: PER_PAGE
  };

  /* ---------- Authoritative sector map (from tools/sector-map.json) ---------- */
  var SECTOR_MAP = {"ACLBSL":"Microfinance","ADBL":"Development Bank","ADBLD83":"Debentures","AHL":"Hydropower","AHPC":"Hydropower","AKJCL":"Hydropower","AKPL":"Hydropower","ALBSL":"Microfinance","ALICL":"Life Insurance","ANLB":"Microfinance","APHL":"Hydropower","API":"Hydropower","AVYAN":"Microfinance","BANDIPUR":"Hotels And Tourism","BARUN":"Hydropower","BBC":"Trading","BEDC":"Hydropower","BFC":"Finance","BGWT":"Hydropower","BHCL":"Hydropower","BHDC":"Hydropower","BHL":"Hydropower","BHPL":"Hydropower","BJHL":"Hydropower","BNHC":"Hydropower","BNL":"Manufacturing And Processing","BNT":"Manufacturing And Processing","BOKD86":"Debentures","BOKD86KA":"Debentures","BPCL":"Hydropower","BUNGAL":"Hydropower","C30MF":"Mutual Funds","CBBL":"Microfinance","CBLD88":"Debentures","CCBD88":"Debentures","CFCL":"Finance","CGH":"Hotels And Tourism","CHCL":"Hydropower","CHDC":"Investment","CHL":"Hydropower","CIT":"Investment","CITY":"Hotels And Tourism","CIZBD86":"Debentures","CIZBD90":"Debentures","CKHL":"Hydropower","CLI":"Life Insurance","CMF2":"Mutual Funds","CORBL":"Development Bank","CREST":"Life Insurance","CSBY":"Mutual Funds","CSY":"Mutual Funds","CYCL":"Microfinance","CZBIL":"Banking","DDBL":"Microfinance","DHEL":"Hydropower","DHPL":"Hydropower","DLBS":"Microfinance","DOLTI":"Hydropower","DORDI":"Hydropower","EBL":"Banking","EBLD85":"Debentures","EBLD86":"Debentures","EBLD91":"Debentures","ECL":"Manufacturing And Processing","EDBL":"Development Bank","EHPL":"Hydropower","ELIS":"Mutual Funds","ENL":"Investment","FMDBL":"Microfinance","FOWAD":"Microfinance","GBBD85":"Debentures","GBBL":"Banking","GBBLPO":"Promoter Shares","GBILD86/87":"Debentures","GBIME":"Banking","GBIMESY2":"Mutual Funds","GBLBS":"Microfinance","GCIL":"Manufacturing And Processing","GFCL":"Finance","GHL":"Hydropower","GIBF1":"Mutual Funds","GILB":"Microfinance","GLBSL":"Microfinance","GLH":"Hydropower","GMFBS":"Microfinance","GMFIL":"Banking","GMLI":"Life Insurance","GRDBL":"Development Bank","GSY":"Mutual Funds","GSYM":"Mutual Funds","GUFL":"Finance","GVL":"Hydropower","GWFD83":"Debentures","H8020":"Mutual Funds","HATHY":"Investment","HBL":"Banking","HBLD83":"Debentures","HBLD86":"Debentures","HDHPC":"Hydropower","HDL":"Manufacturing And Processing","HEI":"Non Life Insurance","HEIP":"Promoter Shares","HFIN":"Hotels And Tourism","HHL":"Hydropower","HIDCL":"Investment","HIDCLP":"Investment","HIMSTAR":"Hydropower","HLBSL":"Microfinance","HLI":"Life Insurance","HLICF":"Mutual Funds","HPPL":"Hydropower","HRL":"Non Life Insurance","HURJA":"Hydropower","ICFC":"Finance","ICFCD83":"Debentures","ICFCD88":"Debentures","ICFCD89":"Debentures","IGI":"Non Life Insurance","IHL":"Hydropower","ILBS":"Microfinance","ILI":"Life Insurance","JBBD87":"Debentures","JBBL":"Banking","JBLB":"Microfinance","JBLBP":"Promoter Shares","JFL":"Finance","JHAPA":"Hydropower","JOSHI":"Hydropower","JSLBB":"Microfinance","KAHL":"Hydropower","KBL":"Banking","KBLD86":"Debentures","KBLD90":"Debentures","KBLPO":"Promoter Shares","KBSH":"Hydropower","KDBY":"Mutual Funds","KDL":"Hotels And Tourism","KEF":"Mutual Funds","KHPL":"Hydropower","KKHC":"Hydropower","KMCDB":"Microfinance","KPCL":"Hydropower","KSBBL":"Banking","KSLY":"Mutual Funds","KSY":"Mutual Funds","LBBL":"Banking","LBBLD89":"Debentures","LEC":"Hydropower","LICN":"Life Insurance","LLBS":"Microfinance","LSH12":"Mutual Funds","LSL":"Banking","LUK":"Mutual Funds","LVF2":"Mutual Funds","MABEL":"Hydropower","MAKAR":"Hydropower","MANDU":"Hydropower","MATRI":"Microfinance","MBJC":"Hydropower","MBL":"Banking","MBLD2085":"Debentures","MBLEF":"Mutual Funds","MCHL":"Hydropower","MDB":"Development Bank","MEHL":"Hydropower","MEL":"Hydropower","MEN":"Hydropower","MEPDL":"Hydropower","MERO":"Microfinance","MFIL":"Finance","MFLD85":"Debentures","MHCL":"Hydropower","MHL":"Hydropower","MHNL":"Hydropower","MKCL":"Others","MKHC":"Hydropower","MKHL":"Hydropower","MKJC":"Hydropower","MLBBL":"Microfinance","MLBL":"Banking","MLBLD89":"Debentures","MLBLPO":"Promoter Shares","MLBS":"Microfinance","MLBSL":"Microfinance","MMF1":"Mutual Funds","MMKJL":"Hydropower","MNBBL":"Banking","MND84/85":"Debentures","MNMF1":"Mutual Funds","MPFL":"Finance","MSHL":"Hydropower","MSIP":"Mutual Funds","MSLB":"Microfinance","NABBC":"Development Bank","NABIL":"Banking","NABILD2089":"Debentures","NABILD87":"Debentures","NABILP":"Banking","NADDF":"Mutual Funds","NADEP":"Microfinance","NBBD2085":"Debentures","NBF2":"Mutual Funds","NBF3":"Mutual Funds","NBL":"Banking","NBLD82":"Debentures","NBLD85":"Debentures","NBLD87":"Debentures","NCCD86":"Debentures","NESDO":"Microfinance","NFCF":"Mutual Funds","NFS":"Finance","NGPL":"Hydropower","NHDL":"Hydropower","NHPC":"Hydropower","NI31":"Mutual Funds","NIBD84":"Debentures","NIBLGF":"Mutual Funds","NIBLSF":"Mutual Funds","NIBLSTF":"Mutual Funds","NIBSF2":"Mutual Funds","NICA":"Banking","NICAD2091":"Debentures","NICAD85/86":"Debentures","NICBF":"Mutual Funds","NICD88":"Debentures","NICFC":"Mutual Funds","NICGF2":"Mutual Funds","NICL":"Non Life Insurance","NICLBSL":"Microfinance","NICSF":"Mutual Funds","NIFRA":"Investment","NIFRAGED":"Debentures","NIL":"Non Life Insurance","NIMB":"Banking","NIMBPO":"Promoter Shares","NLG":"Non Life Insurance","NLIC":"Life Insurance","NLICL":"Life Insurance","NLO":"Manufacturing And Processing","NMB":"Banking","NMB50":"Mutual Funds","NMBD87/88":"Debentures","NMBHF2":"Mutual Funds","NMBMF":"Microfinance","NMBSBFE":"Mutual Funds","NMBUR93/94":"Debentures","NMFBS":"Microfinance","NMFBSP":"Promoter Shares","NMIC":"Non Life Insurance","NMLBBL":"Microfinance","NRIC":"Non Life Insurance","NRM":"Others","NRN":"Investment","NSIF2":"Mutual Funds","NSY":"Mutual Funds","NTC":"Others","NUBL":"Microfinance","NWCL":"Others","NYADI":"Hydropower","OHL":"Hotels And Tourism","OMPL":"Manufacturing And Processing","PBD85":"Debentures","PBD88":"Debentures","PBD93":"Debentures","PBLD84":"Debentures","PBLD87":"Debentures","PCBL":"Banking","PCIL":"Manufacturing And Processing","PFL":"Finance","PHCL":"Hydropower","PMHPL":"Hydropower","PMLI":"Life Insurance","PPCL":"Hydropower","PPL":"Hydropower","PRIN":"Non Life Insurance","PROFL":"Finance","PRSF":"Mutual Funds","PRVU":"Banking","PSF":"Mutual Funds","PSIS":"Mutual Funds","PURE":"Hydropower","RADHI":"Hydropower","RAWA":"Hydropower","RBBD2088":"Debentures","RBBD83":"Debentures","RBBF40":"Mutual Funds","RBCL":"Non Life Insurance","RBCLPO":"Promoter Shares","RFPL":"Hydropower","RHGCL":"Hydropower","RHPL":"Hydropower","RIDI":"Hydropower","RLEL":"Hydropower","RLFL":"Finance","RMF1":"Mutual Funds","RMF2":"Mutual Funds","RNLI":"Life Insurance","RSDC":"Microfinance","RSML":"Manufacturing And Processing","RSY":"Mutual Funds","RSY2":"Mutual Funds","RURU":"Hydropower","SABBL":"Banking","SADBL":"Development Bank","SAEF2":"Mutual Funds","SAGAR":"Manufacturing And Processing","SAGF":"Mutual Funds","SAHAS":"Hydropower","SAIL":"Manufacturing And Processing","SALICO":"Non Life Insurance","SANIMA":"Banking","SANVI":"Hydropower","SAPDBL":"Development Bank","SAPIL":"Manufacturing And Processing","SARBTM":"Manufacturing And Processing","SBCF":"Mutual Funds","SBI":"Banking","SBIBD86":"Debentures","SBID2090":"Debentures","SBID83":"Debentures","SBID89":"Debentures","SBL":"Banking","SBLD2091":"Debentures","SBLD84":"Debentures","SBLD89":"Debentures","SCB":"Banking","SCBD":"Debentures","SDBD87":"Debentures","SEF":"Mutual Funds","SEF2":"Mutual Funds","SFCL":"Finance","SFEF":"Mutual Funds","SFF":"Mutual Funds","SFMF":"Mutual Funds","SGHC":"Hydropower","SGHL":"Hydropower","SGIC":"Non Life Insurance","SHEL":"Hydropower","SHINE":"Development Bank","SHINED":"Debentures","SHIVM":"Manufacturing And Processing","SHL":"Hotels And Tourism","SHLB":"Microfinance","SHPC":"Hydropower","SICL":"Non Life Insurance","SIFC":"Finance","SIGS2":"Mutual Funds","SIGS3":"Mutual Funds","SIKLES":"Hydropower","SINDU":"Banking","SIPD":"Hydropower","SJCL":"Hydropower","SJLIC":"Life Insurance","SKBBL":"Microfinance","SKHEL":"Hydropower","SKHL":"Hydropower","SLBBL":"Microfinance","SLBSL":"Microfinance","SLCF":"Mutual Funds","SLK":"Mutual Funds","SMATA":"Microfinance","SMB":"Microfinance","SMFBS":"Microfinance","SMH":"Hydropower","SMHL":"Hydropower","SMJC":"Hydropower","SMPDA":"Microfinance","SNLI":"Life Insurance","SNORL":"Hydropower","SOHL":"Hydropower","SONA":"Manufacturing And Processing","SOPL":"Manufacturing And Processing","SPC":"Hydropower","SPDL":"Hydropower","SPHL":"Hydropower","SPIL":"Non Life Insurance","SPL":"Hydropower","SRLI":"Life Insurance","SSHL":"Hydropower","SSIS":"Mutual Funds","STC":"Trading","SWASTIK":"Microfinance","SWBBL":"Microfinance","SWMF":"Microfinance","SYPNL":"Manufacturing And Processing","TAMOR":"Hydropower","TPC":"Hydropower","TPKHL":"Hydropower","TRH":"Hotels And Tourism","TSHL":"Hydropower","TTL":"Others","TVCL":"Hydropower","UAIL":"Non Life Insurance","UHEWA":"Hydropower","ULBSL":"Microfinance","ULHC":"Hydropower","UMHL":"Hydropower","UMRH":"Hydropower","UNHPL":"Hydropower","UNL":"Manufacturing And Processing","UNLB":"Microfinance","UPCL":"Hydropower","UPPER":"Hydropower","USHEC":"Hydropower","USHL":"Hydropower","USLB":"Microfinance","VLBS":"Microfinance","VLUCL":"Hydropower","WNLB":"Microfinance","YMHL":"Hydropower","GBILD84/85":"Debentures","KBLD89":"Debentures","LSD92":"Debentures","MNBBLP":"Promoter Shares","NIMBD90":"Debentures","NMBD89/90":"Debentures","SRLIP":"Promoter Shares"};
  function sectorOf(sym, name) {
    var symU = String(sym || '').toUpperCase();
    if (SECTOR_MAP[symU]) return SECTOR_MAP[symU];
    return classifySymbol(sym, name);
  }
  var SECTOR_OVERRIDES = {};
  var INVESTMENT_SYMBOLS = { CIT: 1, HIDCL: 1, HIDCLP: 1, NIFRA: 1, NRN: 1, CHDC: 1, ENL: 1, HATHY: 1 };
  var TRADING_SYMBOLS = { BBC: 1, STC: 1 };
  var DEB_SYM_RE = /D\d{2,3}$/;
  function classifySymbol(sym, name) {
    var symU = String(sym || '').toUpperCase();
    if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
    if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
    if (TRADING_SYMBOLS[symU]) return 'Trading';
    var n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
    if (DEB_SYM_RE.test(symU) || n.indexOf('debenture') >= 0 || n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
    if (n.indexOf('fund') >= 0 || n.indexOf('kosh') >= 0) return 'Mutual Funds';
    function has() {
      for (var i = 0; i < arguments.length; i++) if (n.indexOf(arguments[i]) >= 0) return true;
      return false;
    }
    if (has('laghu', 'microfinance')) return 'Microfinance';
    if (has('hydropower', 'hydro', 'power', 'urja', 'energy')) return 'Hydropower';
    if (has('development bank')) return 'Development Bank';
    if (has('bank')) return 'Banking';
    if (has('life insurance')) return 'Life Insurance';
    if (has('insurance', 'beema')) return 'Non Life Insurance';
    if (has('finance')) return 'Finance';
    if (has('hotel', 'tourism')) return 'Hotels And Tourism';
    if (has('investment')) return 'Investment';
    if (has('manufacturing', 'cement', 'pharma')) return 'Manufacturing And Processing';
    return 'Others';
  }

  function readPreset() {
    try {
      var p = new URLSearchParams(window.location.search).get('sort');
      if (p && PRESETS[p]) {
        state.sortKey = PRESETS[p].key;
        state.sortDir = PRESETS[p].dir;
        return p;
      }
    } catch (e) {}
    return null;
  }

  function syncUrl(preset) {
    try {
      var url = new URL(window.location.href);
      if (preset) url.searchParams.set('sort', preset);
      else url.searchParams.delete('sort');
      window.history.replaceState(null, '', url.toString());
    } catch (e) {}
  }

  function presetFor(key, dir) {
    for (var p in PRESETS) {
      if (PRESETS[p].key === key && PRESETS[p].dir === dir) return p;
    }
    return null;
  }

  /* ---------- Filtering / sorting / paging ---------- */
  function filtered() {
    var q = state.query.trim().toLowerCase();
    var rows = state.quotes;
    if (state.sector) {
      rows = rows.filter(function (r) { return r._sector === state.sector; });
    }
    if (q) {
      rows = rows.filter(function (r) {
        return (r.symbol || '').toLowerCase().indexOf(q) !== -1 ||
               (r.name || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    return rows;
  }

  function sorted(rows) {
    var col = COLS[state.sortKey];
    if (!col) return rows;
    var dir = state.sortDir === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var va = col.get(a), vb = col.get(b);
      if (va === vb) {
        // stable tiebreak: symbol ascending
        var sa = (a.symbol || ''), sb = (b.symbol || '');
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      }
      if (!col.numeric) return (va < vb ? -1 : 1) * dir;
      return (va - vb) * dir;
    });
  }

  /* ---------- Rendering ---------- */
  function chgCell(q) {
    var c = Number(q.change), p = Number(q.percent_change);
    if (!isFinite(c) || !isFinite(p)) return '<td class="num flat">—</td><td class="num flat">—</td>';
    var cls = c > 0 ? 'up' : c < 0 ? 'dn' : 'flat';
    var arrow = c > 0 ? '▲ ' : c < 0 ? '▼ ' : '';
    var cs = (c > 0 ? '+' : '') + fmtNum(c);
    var ps = (p > 0 ? '+' : '') + p.toFixed(2) + '%';
    return '<td class="num ' + cls + '">' + arrow + cs + '</td>' +
           '<td class="num ' + cls + '">' + arrow + ps + '</td>';
  }

  function renderTable() {
    var body = $('dsBody');
    if (!body) return;
    var rows = sorted(filtered());
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / state.perPage));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    var start = state.page * state.perPage;
    var slice = rows.slice(start, start + state.perPage);

    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="10" class="ds-empty">No securities match your search.</td></tr>';
    } else {
      body.innerHTML = slice.map(function (q) {
        var sym = esc(q.symbol || '');
        var dayRange = (q.low != null && q.high != null && isFinite(Number(q.low)) && isFinite(Number(q.high)))
          ? fmtNum(q.low) + ' – ' + fmtNum(q.high)
          : '<span class="unavail">Unavailable</span>';
        var logo = (window.NepseLogo ? window.NepseLogo.html(q.symbol, q._sector, 28) : '');
        return '<tr>' +
          '<td><span class="sym">' + logo + '<a href="/stocks/' + sym + '/">' + sym + '</a></span>' +
            '<span class="cname">' + esc(q.name || '') + '</span></td>' +
          '<td class="num">' + fmtNum(q.ltp) + '</td>' +
          chgCell(q) +
          '<td class="num">' + dayRange + '</td>' +
          '<td class="num">' + fmtNum(q.previous_close) + '</td>' +
          '<td class="num">' + fmtInt(q.volume) + '</td>' +
          '<td class="num">' + fmtInt(q.trades) + '</td>' +
          '<td class="num">' + fmtNum(q.turnover) + '</td>' +
        '</tr>';
      }).join('');
    }

    // range + pager
    var range = $('dsRange');
    if (range) {
      range.textContent = total
        ? 'Showing ' + (start + 1).toLocaleString() + '–' + Math.min(start + state.perPage, total).toLocaleString() + ' of ' + total.toLocaleString() + ' securities'
        : 'No securities';
    }
    var prev = $('dsPrev'), next = $('dsNext'), pnum = $('dsPageNum');
    if (prev) prev.disabled = state.page <= 0;
    if (next) next.disabled = state.page >= pages - 1;
    if (pnum) pnum.textContent = 'Page ' + (state.page + 1) + ' / ' + pages;

    // header sort indicators
    var ths = document.querySelectorAll('#dsTable thead th[data-k]');
    Array.prototype.forEach.call(ths, function (th) {
      var k = th.getAttribute('data-k');
      th.classList.toggle('sorted', k === state.sortKey);
      var arr = th.querySelector('.arr');
      if (arr) arr.textContent = (k === state.sortKey) ? (state.sortDir === 'desc' ? '▼' : '▲') : '';
    });

    // active pill
    var preset = presetFor(state.sortKey, state.sortDir);
    var pills = document.querySelectorAll('.ds-pill[data-sort]');
    Array.prototype.forEach.call(pills, function (p) {
      p.classList.toggle('active', p.getAttribute('data-sort') === preset);
    });

    var count = $('dsCount');
    if (count) count.textContent = total.toLocaleString() + ' securities';
  }

  function onHeaderClick(th) {
    var k = th.getAttribute('data-k');
    if (!k || !COLS[k]) return; // non-sortable (e.g. Open)
    if (state.sortKey === k) {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortKey = k;
      state.sortDir = COLS[k].dir;
    }
    state.page = 0;
    syncUrl(presetFor(state.sortKey, state.sortDir));
    renderTable();
  }

  function renderMeta(live) {
    var sessDate = '';
    try {
      var d = getSessionDate(live);
      sessDate = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' });
    } catch (e) {}
    var asof = $('dsAsof');
    if (asof) asof.innerHTML = '<span class="dot"></span>Session: ' + esc(sessDate || 'unavailable');
    var upd = $('dsUpdated');
    if (upd) {
      var n = (live.quotes || []).length;
      upd.textContent = n ? n.toLocaleString() + ' securities · Source: NEPSE' : '';
    }
    renderOverview(live);
    renderChart(live);
    renderIndices(live);
  }

  /* ---------- Market Overview cards ---------- */
  function renderOverview(live) {
    var sec = $('dsOverview');
    if (!sec) return;
    var ix = live.index || {};
    var quotes = Array.isArray(live.quotes) ? live.quotes : [];

    // Aggregate real totals from quotes
    var totTurn = 0, totVol = 0, totTrades = 0, totMcap = 0;
    quotes.forEach(function (q) {
      totTurn += Number(q.turnover) || 0;
      totVol += Number(q.volume) || 0;
      totTrades += Number(q.trades) || 0;
      totMcap += Number(q.market_cap) || 0;
    });

    var chg = Number(ix.change), pct = Number(ix.percent_change);
    var chgCls = chg > 0 ? 'up' : chg < 0 ? 'dn' : 'flat';
    var chgArrow = chg > 0 ? '▲ ' : chg < 0 ? '▼ ' : '';
    var chgTxt = (isFinite(chg) ? (chg > 0 ? '+' : '') + fmtNum(chg) : '—') +
                 (isFinite(pct) ? ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%)' : '');

    function card(label, value, cls) {
      return '<div class="ds-ov-card"><div class="k">' + esc(label) + '</div>' +
             '<div class="v' + (cls ? ' ' + cls : '') + '">' + value + '</div></div>';
    }

    var grid = $('dsOvGrid');
    if (grid) {
      grid.innerHTML =
        card('Current Value', fmtNum(ix.value)) +
        card('Chg (% Chg)', esc(chgArrow + chgTxt), chgCls) +
        card('Prev Close', fmtNum(ix.previous_close)) +
        card('Turnover (Rs)', totTurn > 0 ? fmtNum(totTurn, 2) : '<span class="unavail">Unavailable</span>') +
        card('Volume', totVol > 0 ? fmtInt(totVol) : '<span class="unavail">Unavailable</span>') +
        card('Transactions', totTrades > 0 ? fmtInt(totTrades) : '<span class="unavail">Unavailable</span>') +
        card('Scrips Traded', quotes.length ? fmtInt(quotes.length) : '<span class="unavail">Unavailable</span>') +
        card('Market Cap (Rs)', totMcap > 0 ? fmtNum(totMcap, 2) : '<span class="unavail">Unavailable</span>');
    }

    // Day range bar
    var ranges = $('dsOvRanges');
    if (ranges) {
      var lo = Number(ix.low), hi = Number(ix.high), val = Number(ix.value);
      var dayBar = '';
      if (isFinite(lo) && isFinite(hi) && hi > lo && isFinite(val)) {
        var pos = Math.max(0, Math.min(100, ((val - lo) / (hi - lo)) * 100));
        dayBar = '<div class="ds-range-block"><div class="ds-range-head"><span>Trade Day Range</span>' +
                 '<span>' + fmtNum(lo) + ' – ' + fmtNum(hi) + '</span></div>' +
                 '<div class="ds-range-bar"><div class="ds-range-fill" style="width:' + pos.toFixed(1) + '%"></div>' +
                 '<div class="ds-range-marker" style="left:' + pos.toFixed(1) + '%"></div></div>' +
                 '<div class="ds-range-lbl"><span>Low</span><span>High</span></div></div>';
      }
      ranges.innerHTML = dayBar;
    }

    sec.hidden = false;
  }

  /* ---------- NEPSE trend chart (SVG) ---------- */
  function renderChart(live) {
    var svg = $('dsChartSvg');
    var valEl = $('dsChartVal');
    var noteEl = $('dsChartNote');
    if (!svg) return;

    var ix = live.index || {};
    var val = Number(ix.value), chg = Number(ix.change);
    if (valEl && isFinite(val)) {
      valEl.innerHTML = '<strong>' + fmtNum(val) + '</strong> ' +
        '<span class="' + (chg > 0 ? 'up' : chg < 0 ? 'dn' : 'flat') + '">' +
        (chg > 0 ? '▲ +' : chg < 0 ? '▼ ' : '') + fmtNum(chg) + '</span>';
    }

    // Use index history if available, else flat line at current value
    var hist = window.NEPSE_DAILY || [];
    var closes = hist.slice(-60).map(function (r) { return r[4]; }).filter(isFinite);
    if (!closes.length && isFinite(val)) closes = [val];

    if (closes.length < 2) {
      if (noteEl) noteEl.textContent = 'Trend data unavailable.';
      return;
    }

    var W = 600, H = 220, P = 10;
    var min = Math.min.apply(null, closes), max = Math.max.apply(null, closes);
    var span = (max - min) || 1;
    var up = closes[closes.length - 1] >= closes[0];
    var color = up ? '#4ade80' : '#f87171';

    var pts = closes.map(function (c, i) {
      var x = P + (i / (closes.length - 1)) * (W - 2 * P);
      var y = H - P - ((c - min) / span) * (H - 2 * P);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    var areaPts = P + ',' + (H - P) + ' ' + pts + ' ' + (W - P) + ',' + (H - P);
    svg.innerHTML =
      '<defs><linearGradient id="dsCg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity="0.35"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0.02"/></linearGradient></defs>' +
      '<polygon points="' + areaPts + '" fill="url(#dsCg)"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2"/>' +
      '<text x="' + (W - P) + '" y="16" text-anchor="end" font-size="11" fill="var(--nd-dim)">' + fmtNum(max) + '</text>' +
      '<text x="' + (W - P) + '" y="' + (H - 6) + '" text-anchor="end" font-size="11" fill="var(--nd-dim)">' + fmtNum(min) + '</text>';

    if (noteEl) noteEl.textContent = 'Last ' + closes.length + ' sessions · Source: NEPSE';
  }
  function renderIndices(live) {
    var sec = $('dsIndices');
    var body = $('dsIdxBody');
    if (!sec || !body) return;
    var indices = Array.isArray(live.indices) ? live.indices : [];
    if (!indices.length) {
      body.innerHTML = '<tr><td colspan="4" class="ds-empty">Index data unavailable.</td></tr>';
      sec.hidden = false;
      return;
    }
    body.innerHTML = indices.map(function (ix) {
      var c = Number(ix.change), p = Number(ix.percent_change);
      var cls = c > 0 ? 'up' : c < 0 ? 'dn' : 'flat';
      var arrow = c > 0 ? '▲ ' : c < 0 ? '▼ ' : '';
      var cs = isFinite(c) ? (c > 0 ? '+' : '') + fmtNum(c) : '—';
      var ps = isFinite(p) ? (p > 0 ? '+' : '') + p.toFixed(2) + '%' : '—';
      return '<tr>' +
        '<td><span class="sym">' + esc(ix.name || '') + '</span></td>' +
        '<td class="num">' + fmtNum(ix.value) + '</td>' +
        '<td class="num ' + cls + '">' + arrow + cs + '</td>' +
        '<td class="num ' + cls + '">' + arrow + ps + '</td>' +
      '</tr>';
    }).join('');
    sec.hidden = false;
  }

  function fail(msg) {
    var body = $('dsBody');
    if (body) body.innerHTML = '<tr><td colspan="10" class="ds-empty">' + esc(msg || 'Could not load market data. Please reload the page.') + '</td></tr>';
    var asof = $('dsAsof');
    if (asof) asof.textContent = 'Data unavailable';
  }

  /* ---------- Init ---------- */
  function init() {
    if (!$('dsTable')) return;
    var preset = readPreset();

    // header clicks
    var ths = document.querySelectorAll('#dsTable thead th[data-k]');
    Array.prototype.forEach.call(ths, function (th) {
      if (!COLS[th.getAttribute('data-k')]) { th.classList.add('no-sort'); return; }
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'button');
      th.addEventListener('click', function () { onHeaderClick(th); });
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderClick(th); }
      });
    });

    // pills
    var pills = document.querySelectorAll('.ds-pill[data-sort]');
    Array.prototype.forEach.call(pills, function (p) {
      p.addEventListener('click', function (e) {
        e.preventDefault();
        var pr = PRESETS[p.getAttribute('data-sort')];
        if (!pr) return;
        state.sortKey = pr.key; state.sortDir = pr.dir; state.page = 0;
        syncUrl(p.getAttribute('data-sort'));
        renderTable();
      });
    });
    // "All" pill resets to default turnover sort
    var allPill = document.querySelector('.ds-pill[data-sort="all"]');
    if (allPill) allPill.addEventListener('click', function (e) {
      e.preventDefault();
      state.sortKey = 'turnover'; state.sortDir = 'desc'; state.page = 0;
      syncUrl(null);
      renderTable();
    });

    // search
    var search = $('dsSearch');
    if (search) search.addEventListener('input', function () {
      state.query = search.value; state.page = 0; renderTable();
    });

    // per-page
    var pp = $('dsPerPage');
    if (pp) pp.addEventListener('change', function () {
      state.perPage = parseInt(pp.value, 10) || PER_PAGE; state.page = 0; renderTable();
    });

    // pager
    var prev = $('dsPrev'), next = $('dsNext');
    if (prev) prev.addEventListener('click', function () { if (state.page > 0) { state.page--; renderTable(); } });
    if (next) next.addEventListener('click', function () { state.page++; renderTable(); });

    fetchJSON(LIVE_URL).then(function (live) {
      state.quotes = Array.isArray(live.quotes) ? live.quotes : [];
      // Classify sectors using authoritative map
      state.quotes.forEach(function (q) {
        q._sector = sectorOf(q.symbol, q.name);
      });
      populateSectors();
      renderMeta(live);
      renderTable();
    }).catch(function () { fail(); });
  }

  function populateSectors() {
    var sel = $('dsSector');
    if (!sel) return;
    var sectors = {};
    state.quotes.forEach(function (q) { if (q._sector) sectors[q._sector] = true; });
    var list = Object.keys(sectors).sort();
    sel.innerHTML = '<option value="">All Sectors</option>' +
      list.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    sel.addEventListener('change', function () {
      state.sector = sel.value;
      state.page = 0;
      renderTable();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
