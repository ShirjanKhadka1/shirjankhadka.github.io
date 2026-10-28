/* Broker custom date-range aggregation — gap 3 (agency-agents program).
   Builds a period-shaped payload ({period:'range', from, to, trading_days,
   brokers, broker_symbols, symbols, accumulation, distribution}) from the
   already-published broker data files, so every broker view renders a
   custom from/to range through its existing render path, byte-identical
   in behaviour to the fixed periods.

   Aggregation semantics (proven against the published files before this
   module was written; see the gap-3 validation notes in the program
   inventory):
   - Per (symbol, broker) buy/sell comes from the day's netflow entries
     [net_qty, net_value, buy_qty, buy_value, sell_qty, sell_value],
     UNION the buyers/sellers lists: where both exist they agree exactly
     (1.3M checks, 0 disagreements over the whole daily archive); the
     lists add pairs netflow omits (exact-zero pairs and a few list-only
     pairs per file).
   - Symbols qty/value are the daily files' own totals: FULL-shape days
     already double-count (buy+sell), OLD-shape days (2026-04-24 →
     2026-08-18) single-count, so OLD days are doubled to match the
     period convention (the subpage strips halve symbol totals back).
   - Brokers[]: FULL days use the file's brokers[]; OLD days (no
     brokers[] section) derive it from the pairs (bounded error: median
     0.0008% of the day's value, worst 0.017% over the OLD archive,
     excluding the degenerate 2026-10-07 file).
   - broker_symbols: top 25 per broker by total value desc; buyers /
     sellers: top 25 by buy / sell value desc. Tie-break everywhere is
     the code/symbol as a STRING ascending ("17" < "8", "38" < "5"),
     matching the published files' order exactly.
   - netflow: pairs whose rounded net is not (0, 0), sorted by net_value
     desc; accumulation / distribution: top 200 net bought / net sold.
   - All money and quantities are rounded to 2 decimals (paisa) at
     output: this kills float dust (e.g. 2.3e-10 phantom pairs) that
     otherwise survives a multi-file subtraction.
   - Hybrid ranges (to == meta.latest): minuend = the period file with
     the largest from <= from (1D, 2D, 1W, 2W, 1M, 3M, in that order);
     if minuend.from == from the period file IS the result; otherwise
     result = minuend - daily-sum[minuend.from, from-1]. If from is
     before every period start, result = 3M + daily-sum[from, 3M.from-1]
     (requires from >= the first daily file). Subtraction was proven
     against published periods: 3M - daily[2026-07-15, 2026-09-06] ==
     published 1M with zero symbol-quantity mismatches.
   - A range is NEVER partially summed: any trading day without a usable
     daily file makes the whole range unavailable, listing the missing
     dates. A day's file is unusable when it is degenerate (non-numeric
     broker codes, '*' symbol key — the 2026-10-07 file) or unreachable.
   - Trading days are weekdays minus holidays. The shared market config
     (when loaded) supplies its holiday list; this module additionally
     carries six 2026 holidays the config omits, each verified against
     four liquid symbols' OHLC bars (no bar on the day) plus the daily
     archive gap and the period trading-day counts (1M = 30 sessions
     only when these days are excluded): 2026-05-28, 2026-05-29,
     2026-09-04, 2026-09-08, 2026-09-21, 2026-09-25. One weekday gap is a
     genuinely MISSING file, not a holiday — 2026-04-28 (Tuesday, bars
     exist, no daily file) — so unknown weekday gaps stay unavailable
     (fail-safe: a holiday mistaken for trading refuses the range,
     never mis-sums it).
   - Zero-sum gate: |sum buy - sum sell| must be within
     max(Rs 100,000, 0.01% of buy total); beyond that the range renders
     the honest error state, never wrong numbers.
   Vanilla JS, no frameworks. The module is standalone (no BrokerCommon
   dependency) so the hub page can use it without broker-common.js. */
(function(){
"use strict";
var BASE = '/nepse-brokers/data/';
var PERIOD_CANDIDATES = ['1D', '2D', '1W', '2W', '1M', '3M'];
/* 2026 holidays missing from nepse-market-config.js (verified: no OHLC
   bar for NABIL, NIFRA, GBIME and HIDCL on the day, no daily file, and
   the published period session counts only reconcile with them
   excluded). 2026-05-01 and 2026-08-28 are already in the config. */
var EXTRA_HOLIDAYS_2026 = ['2026-05-28', '2026-05-29', '2026-09-04',
  '2026-09-08', '2026-09-21', '2026-09-25'];

var cache = {};
function fetchCached(url){
  if (!cache[url]) {
    var pr = fetch(url).then(function(r){
      if (!r.ok) throw new Error('no-data');
      return r.json();
    });
    cache[url] = pr;
    pr.catch(function(){ delete cache[url]; });
  }
  return cache[url];
}
function fetchFresh(url){
  return fetch(url, { cache: 'no-store' }).then(function(r){
    if (!r.ok) throw new Error('no-data');
    return r.json();
  });
}
function rangeError(code, message){
  var e = new Error(message);
  e.code = code;
  return e;
}
function r2(x){
  var v = Math.round(Number(x) * 100) / 100;
  return v === 0 ? 0 : v; /* normalise -0 */
}
function isNumCode(c){ return /^\d+$/.test(String(c)); }
function cmpStr(a, b){ a = String(a); b = String(b); return a < b ? -1 : (a > b ? 1 : 0); }
function parseDay(ymd){
  var p = String(ymd).split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}
function fmtDay(ms){
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(ymd, n){
  return fmtDay(parseDay(ymd) + n * 86400000);
}
function isTradingDay(ymd){
  if (EXTRA_HOLIDAYS_2026.indexOf(ymd) !== -1) return false;
  var CFG = (typeof window !== 'undefined') ? window.NepseMarketConfig : null;
  if (CFG && typeof CFG.isTradingDay === 'function') {
    try { return !!CFG.isTradingDay(ymd); } catch (e) { /* fall through */ }
  }
  var dow = new Date(parseDay(ymd)).getUTCDay();
  return dow >= 1 && dow <= 5;
}
function tradingDaysIn(from, to){
  var days = [], cur = from;
  while (cur <= to) {
    if (isTradingDay(cur)) days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}
/* A daily file is usable when it carries real per-symbol data: FULL
   shape needs numeric broker codes and at least one real symbol key;
   OLD shape needs at least one real symbol key with flow data. The
   degenerate 2026-10-07 file (display-name codes, symbols {'*'})
   fails both arms and is treated as missing, never summed. */
function fileUsable(f){
  if (!f || !f.symbols) return false;
  var keys = Object.keys(f.symbols).filter(function(k){ return k !== '*'; });
  if (!keys.length) return false;
  if (f.brokers && f.brokers.length) {
    return f.brokers.every(function(b){ return isNumCode(b.code); });
  }
  return keys.some(function(k){
    var s = f.symbols[k] || {};
    return (s.buyers && Object.keys(s.buyers).length) ||
      (s.sellers && Object.keys(s.sellers).length) ||
      (s.netflow && Object.keys(s.netflow).length);
  });
}
function isFull(f){
  return !!(f.brokers && f.brokers.length &&
    f.brokers.every(function(b){ return isNumCode(b.code); }));
}
/* Per-(symbol, broker) buy/sell for one day: netflow union buyers/sellers
   lists (netflow wins where both exist — they agree exactly). */
function dayPairs(f){
  var pairs = {}; /* pairs[sym][code] = [bq, bv, sq, sv] */
  Object.keys(f.symbols || {}).forEach(function(sym){
    if (sym === '*') return;
    var s = f.symbols[sym] || {}, bySym = pairs[sym] = pairs[sym] || {};
    Object.keys(s.netflow || {}).forEach(function(c){
      var nf = s.netflow[c] || [];
      bySym[String(c)] = [nf[2] || 0, nf[3] || 0, nf[4] || 0, nf[5] || 0];
    });
    var buyers = s.buyers || {}, sellers = s.sellers || {};
    Object.keys(buyers).concat(Object.keys(sellers)).forEach(function(c){
      c = String(c);
      if (bySym[c]) return;
      var b = buyers[c] || [0, 0], sl = sellers[c] || [0, 0];
      bySym[c] = [b[0] || 0, b[1] || 0, sl[0] || 0, sl[1] || 0];
    });
  });
  return pairs;
}
function mergePairs(dst, src){
  Object.keys(src).forEach(function(sym){
    var d = dst[sym] = dst[sym] || {};
    Object.keys(src[sym]).forEach(function(c){
      var e = d[c] = d[c] || [0, 0, 0, 0], v = src[sym][c];
      e[0] += v[0]; e[1] += v[1]; e[2] += v[2]; e[3] += v[3];
    });
  });
}
function subPairs(minuend, sub){
  var out = {};
  var keys = {};
  Object.keys(minuend).forEach(function(s){ keys[s] = 1; });
  Object.keys(sub).forEach(function(s){ keys[s] = 1; });
  Object.keys(keys).forEach(function(sym){
    var m = minuend[sym] || {}, s = sub[sym] || {}, o = {};
    var codes = {};
    Object.keys(m).forEach(function(c){ codes[c] = 1; });
    Object.keys(s).forEach(function(c){ codes[c] = 1; });
    Object.keys(codes).forEach(function(c){
      var mv = m[c] || [0, 0, 0, 0], sv = s[c] || [0, 0, 0, 0];
      var d = [r2(mv[0] - sv[0]), r2(mv[1] - sv[1]), r2(mv[2] - sv[2]), r2(mv[3] - sv[3])];
      if (d[0] || d[1] || d[2] || d[3]) o[c] = d;
    });
    if (Object.keys(o).length) out[sym] = o;
  });
  return out;
}
/* Build the period-shaped payload from summed pairs + symbol totals.
   qv[sym] = [qty (double-counted convention), value]. Brokers[] here
   come from the pairs; callers override with file brokers[] where the
   file rule applies (FULL days, minuend files). */
function buildFromPairs(pairs, qv, from, to, td){
  var rounded = {};
  Object.keys(pairs).forEach(function(sym){
    var o = {};
    Object.keys(pairs[sym]).forEach(function(c){
      var v = pairs[sym][c];
      var rv = [r2(v[0]), r2(v[1]), r2(v[2]), r2(v[3])];
      if (rv[0] || rv[1] || rv[2] || rv[3]) o[c] = rv;
    });
    if (Object.keys(o).length) rounded[sym] = o;
  });
  pairs = rounded;
  var bm = {};
  Object.keys(pairs).forEach(function(sym){
    Object.keys(pairs[sym]).forEach(function(c){
      var v = pairs[sym][c], e = bm[c] = bm[c] || [0, 0, 0, 0];
      e[0] += v[0]; e[1] += v[1]; e[2] += v[2]; e[3] += v[3];
    });
  });
  var brokers = Object.keys(bm).map(function(c){
    var v = bm[c];
    return { code: c, buy_qty: r2(v[0]), buy_value: r2(v[1]),
      sell_qty: r2(v[2]), sell_value: r2(v[3]),
      total_qty: r2(v[0] + v[2]), total: r2(v[1] + v[3]),
      net_qty: r2(v[0] - v[2]), net: r2(v[1] - v[3]) };
  }).sort(function(a, b){
    return (b.total - a.total) || cmpStr(a.code, b.code);
  });
  var perBroker = {};
  Object.keys(pairs).forEach(function(sym){
    Object.keys(pairs[sym]).forEach(function(c){
      var v = pairs[sym][c];
      (perBroker[c] = perBroker[c] || []).push({ symbol: sym,
        buy_qty: v[0], buy_value: v[1], sell_qty: v[2], sell_value: v[3] });
    });
  });
  var brokerSymbols = {};
  Object.keys(perBroker).forEach(function(c){
    perBroker[c].sort(function(a, b){
      return ((b.buy_value + b.sell_value) - (a.buy_value + a.sell_value)) ||
        cmpStr(a.symbol, b.symbol);
    });
    brokerSymbols[c] = perBroker[c].slice(0, 25);
  });
  var symbols = {};
  Object.keys(qv).forEach(function(sym){
    var q = r2(qv[sym][0]), v = r2(qv[sym][1]);
    if (!q && !v) return;
    var d = pairs[sym] || {};
    var buyers = Object.keys(d).filter(function(c){ return d[c][0] || d[c][1]; })
      .sort(function(a, b){ return (d[b][1] - d[a][1]) || cmpStr(a, b); })
      .slice(0, 25);
    var sellers = Object.keys(d).filter(function(c){ return d[c][2] || d[c][3]; })
      .sort(function(a, b){ return (d[b][3] - d[a][3]) || cmpStr(a, b); })
      .slice(0, 25);
    var buyMap = {}, sellMap = {};
    buyers.forEach(function(c){ buyMap[c] = [d[c][0], d[c][1]]; });
    sellers.forEach(function(c){ sellMap[c] = [d[c][2], d[c][3]]; });
    var nf = {};
    Object.keys(d).sort(function(a, b){
      var na = r2(d[a][1] - d[a][3]), nb = r2(d[b][1] - d[b][3]);
      return (nb - na) || cmpStr(a, b);
    }).forEach(function(c){
      var vv = d[c];
      var net = [r2(vv[0] - vv[2]), r2(vv[1] - vv[3]), vv[0], vv[1], vv[2], vv[3]];
      if (net[0] || net[1]) nf[c] = net;
    });
    symbols[sym] = { qty: q, value: v, avg_rate: q ? r2(v / q) : 0,
      buyers: buyMap, sellers: sellMap, netflow: nf };
  });
  var nfAll = [];
  Object.keys(pairs).forEach(function(sym){
    Object.keys(pairs[sym]).forEach(function(c){
      var vv = pairs[sym][c];
      nfAll.push({ symbol: sym, broker: c,
        net_qty: r2(vv[0] - vv[2]), net_value: r2(vv[1] - vv[3]) });
    });
  });
  var acc = nfAll.filter(function(x){ return x.net_value > 0; })
    .sort(function(a, b){ return (b.net_value - a.net_value) ||
      cmpStr(a.symbol, b.symbol) || cmpStr(a.broker, b.broker); }).slice(0, 200);
  var dist = nfAll.filter(function(x){ return x.net_value < 0; })
    .sort(function(a, b){ return (a.net_value - b.net_value) ||
      cmpStr(a.symbol, b.symbol) || cmpStr(a.broker, b.broker); }).slice(0, 200);
  return { period: 'range', from: from, to: to, trading_days: td,
    brokers: brokers, broker_symbols: brokerSymbols, symbols: symbols,
    accumulation: acc, distribution: dist };
}
function brokersFromPairs(pairs){
  var bm = {};
  Object.keys(pairs).forEach(function(sym){
    Object.keys(pairs[sym]).forEach(function(c){
      var v = pairs[sym][c], e = bm[c] = bm[c] || [0, 0, 0, 0];
      e[0] += v[0]; e[1] += v[1]; e[2] += v[2]; e[3] += v[3];
    });
  });
  return Object.keys(bm).map(function(c){
    var v = bm[c];
    return { code: c, buy_qty: r2(v[0]), buy_value: r2(v[1]),
      sell_qty: r2(v[2]), sell_value: r2(v[3]),
      total_qty: r2(v[0] + v[2]), total: r2(v[1] + v[3]),
      net_qty: r2(v[0] - v[2]), net: r2(v[1] - v[3]) };
  }).sort(function(a, b){ return (b.total - a.total) || cmpStr(a.code, b.code); });
}
/* Sum daily files: pairs + symbol totals (OLD days doubled) + the
   merged brokers[] (FULL days: file brokers[]; OLD days: pairs). */
function sumDaily(files){
  var pairs = {}, qv = {}, fullBrokers = {}, oldPairs = {};
  files.forEach(function(f){
    var p = dayPairs(f);
    mergePairs(pairs, p);
    var mult = isFull(f) ? 1 : 2;
    Object.keys(f.symbols).forEach(function(sym){
      if (sym === '*') return;
      var s = f.symbols[sym], e = qv[sym] = qv[sym] || [0, 0];
      e[0] += (s.qty || 0) * mult; e[1] += (s.value || 0) * mult;
    });
    if (isFull(f)) {
      (f.brokers || []).forEach(function(b){
        var e = fullBrokers[String(b.code)] = fullBrokers[String(b.code)] || [0, 0, 0, 0];
        e[0] += b.buy_qty || 0; e[1] += b.buy_value || 0;
        e[2] += b.sell_qty || 0; e[3] += b.sell_value || 0;
      });
    } else {
      mergePairs(oldPairs, p);
    }
  });
  var merged = {};
  Object.keys(fullBrokers).forEach(function(c){ merged[c] = fullBrokers[c].slice(); });
  brokersFromPairs(oldPairs).forEach(function(b){
    var e = merged[b.code] = merged[b.code] || [0, 0, 0, 0];
    e[0] += b.buy_qty; e[1] += b.buy_value; e[2] += b.sell_qty; e[3] += b.sell_value;
  });
  var brokers = Object.keys(merged).map(function(c){
    var v = merged[c];
    return { code: c, buy_qty: r2(v[0]), buy_value: r2(v[1]),
      sell_qty: r2(v[2]), sell_value: r2(v[3]),
      total_qty: r2(v[0] + v[2]), total: r2(v[1] + v[3]),
      net_qty: r2(v[0] - v[2]), net: r2(v[1] - v[3]) };
  }).sort(function(a, b){ return (b.total - a.total) || cmpStr(a.code, b.code); });
  return { pairs: pairs, qv: qv, brokers: brokers };
}
function periodPairs(pub){
  var out = {};
  Object.keys(pub.symbols || {}).forEach(function(sym){
    var s = pub.symbols[sym] || {}, bySym = {};
    Object.keys(s.netflow || {}).forEach(function(c){
      var nf = s.netflow[c] || [];
      bySym[String(c)] = [nf[2] || 0, nf[3] || 0, nf[4] || 0, nf[5] || 0];
    });
    var buyers = s.buyers || {}, sellers = s.sellers || {};
    Object.keys(buyers).concat(Object.keys(sellers)).forEach(function(c){
      c = String(c);
      if (bySym[c]) return;
      var b = buyers[c] || [0, 0], sl = sellers[c] || [0, 0];
      bySym[c] = [b[0] || 0, b[1] || 0, sl[0] || 0, sl[1] || 0];
    });
    if (Object.keys(bySym).length) out[sym] = bySym;
  });
  return out;
}
function checkZeroSum(result){
  var buy = 0, sell = 0;
  (result.brokers || []).forEach(function(b){ buy += b.buy_value || 0; sell += b.sell_value || 0; });
  var eps = Math.max(100000, 0.0001 * Math.abs(buy));
  if (Math.abs(buy - sell) > eps) {
    throw rangeError('zero-sum',
      'Range totals do not balance (bought Rs ' + Math.round(buy).toLocaleString('en-US') +
      ' vs sold Rs ' + Math.round(sell).toLocaleString('en-US') +
      ') — the range is not shown rather than showing unbalanced figures.');
  }
}
function fetchDailyOrNull(date){
  return fetchCached(BASE + 'daily/' + date + '.json').catch(function(){ return null; });
}
/* Fetch every trading day in the list (bounded parallel pool: the sums
   are order-independent — every sort below is a total order with a
   string tie-break — so completion order cannot change the result).
   Returns {files, missing}; missing = trading days with no usable
   file (404 or degenerate). */
function fetchDailySet(dates, onProgress){
  var files = [], missing = [], done = 0, next = 0, POOL = 8;
  return new Promise(function(resolve){
    function worker(){
      if (next >= dates.length) {
        if (done >= dates.length) resolve({ files: files, missing: missing });
        return;
      }
      var date = dates[next++];
      fetchDailyOrNull(date).then(function(f){
        done++;
        if (onProgress) onProgress({ stage: 'daily', done: done, total: dates.length });
        if (f && fileUsable(f)) files.push(f);
        else missing.push(date);
        worker();
      });
    }
    if (!dates.length) { resolve({ files: files, missing: missing }); return; }
    var w = Math.min(POOL, dates.length);
    for (var i = 0; i < w; i++) worker();
  });
}
function unavailable(missing, from, to){
  return rangeError('unavailable',
    'No published broker data for ' + missing.join(', ') +
    ' in ' + from + ' → ' + to +
    ' — the range is not shown rather than showing a partial total. ' +
    'Pick a range whose trading days all have daily files, or use a fixed period.');
}

function loadRange(from, to, onProgress){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    return Promise.reject(rangeError('validation', 'Pick a valid from and to date.'));
  }
  if (from > to) {
    return Promise.reject(rangeError('validation',
      'The from date (' + from + ') is after the to date (' + to + ').'));
  }
  var days = tradingDaysIn(from, to);
  if (!days.length) {
    return Promise.reject(rangeError('validation',
      'No trading days in ' + from + ' → ' + to + ' (weekend / holiday only).'));
  }
  return Promise.all([fetchFresh(BASE + 'meta.json'), fetchFresh(BASE + 'brokers-ledger.json')])
    .catch(function(){
      throw rangeError('fetch',
        'Broker archive index not available right now — please retry.');
    })
    .then(function(res){
      var meta = res[0] || {}, ledger = res[1] || {};
      var latest = meta.latest;
      var dailyFirst = ledger.daily_first || null;
      if (!latest) throw rangeError('fetch', 'Broker archive index not available right now — please retry.');
      if (to > latest) {
        throw rangeError('validation',
          'Range ends ' + to + ' after the latest session (' + latest +
          ') — pick a to date on or before ' + latest + '.');
      }
      if (to === latest) return loadHybrid(from, latest, meta, dailyFirst, onProgress);
      /* Direct sum over daily files. */
      return fetchDailySet(days, onProgress).then(function(set){
        if (set.missing.length) throw unavailable(set.missing, from, to);
        var agg = sumDaily(set.files);
        var result = buildFromPairs(agg.pairs, agg.qv, from, to, set.files.length);
        result.brokers = agg.brokers;
        checkZeroSum(result);
        return result;
      });
    })
    .then(function(result){
      /* Matching is an add-on column: its absence never blocks the range
         (unlike the main builder, which refuses partial sums). Best
         effort over the range's trading days; the coverage note states
         exactly which sessions are included. */
      return mAttachRange(result, days);
    });
}
function loadHybrid(from, latest, meta, dailyFirst, onProgress){
  /* Minuend: first candidate (latest-first) whose from <= from. */
  var chain = Promise.resolve(null), picked = null, pickedName = null, tried = 0;
  PERIOD_CANDIDATES.forEach(function(name){
    chain = chain.then(function(){
      if (picked) return null;
      tried++;
      if (onProgress) onProgress({ stage: 'periods', done: tried, total: PERIOD_CANDIDATES.length });
      return fetchCached(BASE + 'periods/' + name + '.json').then(function(p){
        if (!picked && p && p.from && p.from <= from) { picked = p; pickedName = name; }
        return null;
      }).catch(function(){ return null; });
    });
  });
  return chain.then(function(){
    if (!picked) {
      /* ADD form: from predates every period start. */
      if (!dailyFirst || from < dailyFirst) {
        throw rangeError('unavailable',
          'No published broker data before ' + (dailyFirst || 'the daily archive') +
          ' — the range ' + from + ' → ' + latest + ' cannot be built from published files.');
      }
      return fetchCached(BASE + 'periods/3M.json').then(function(m3){
        if (!m3 || !m3.from) throw rangeError('fetch', 'Period data not available right now — please retry.');
        var subDays = tradingDaysIn(from, addDays(m3.from, -1));
        return fetchDailySet(subDays, onProgress).then(function(set){
          if (set.missing.length) throw unavailable(set.missing, from, latest);
          var agg = sumDaily(set.files);
          var pairs = {};
          mergePairs(pairs, periodPairs(m3));
          mergePairs(pairs, agg.pairs);
          var qv = {};
          Object.keys(m3.symbols || {}).forEach(function(sym){
            var s = m3.symbols[sym];
            qv[sym] = [s.qty || 0, s.value || 0];
          });
          Object.keys(agg.qv).forEach(function(sym){
            var e = qv[sym] = qv[sym] || [0, 0];
            e[0] += agg.qv[sym][0]; e[1] += agg.qv[sym][1];
          });
          var brokers = {};
          (m3.brokers || []).forEach(function(b){
            brokers[String(b.code)] = [b.buy_qty || 0, b.buy_value || 0, b.sell_qty || 0, b.sell_value || 0];
          });
          agg.brokers.forEach(function(b){
            var e = brokers[String(b.code)] = brokers[String(b.code)] || [0, 0, 0, 0];
            e[0] += b.buy_qty; e[1] += b.buy_value; e[2] += b.sell_qty; e[3] += b.sell_value;
          });
          var blist = Object.keys(brokers).map(function(c){
            var v = brokers[c];
            return { code: c, buy_qty: r2(v[0]), buy_value: r2(v[1]),
              sell_qty: r2(v[2]), sell_value: r2(v[3]),
              total_qty: r2(v[0] + v[2]), total: r2(v[1] + v[3]),
              net_qty: r2(v[0] - v[2]), net: r2(v[1] - v[3]) };
          }).sort(function(a, b){ return (b.total - a.total) || cmpStr(a.code, b.code); });
          var result = buildFromPairs(pairs, qv, from, latest, m3.trading_days + set.files.length);
          result.brokers = blist;
          checkZeroSum(result);
          return result;
        });
      });
    }
    if (picked.from === from) return picked;
    var subDays = tradingDaysIn(picked.from, addDays(from, -1));
    return fetchDailySet(subDays, onProgress).then(function(set){
      if (set.missing.length) throw unavailable(set.missing, from, latest);
      var agg = sumDaily(set.files);
      var pairs = subPairs(periodPairs(picked), agg.pairs);
      var qv = {};
      Object.keys(picked.symbols || {}).forEach(function(sym){
        var s = picked.symbols[sym];
        qv[sym] = [s.qty || 0, s.value || 0];
      });
      Object.keys(agg.qv).forEach(function(sym){
        var e = qv[sym] = qv[sym] || [0, 0];
        e[0] -= agg.qv[sym][0]; e[1] -= agg.qv[sym][1];
      });
      Object.keys(qv).forEach(function(sym){
        qv[sym][0] = r2(qv[sym][0]); qv[sym][1] = r2(qv[sym][1]);
        if (!qv[sym][0] && !qv[sym][1]) delete qv[sym];
      });
      var blist = [];
      var smap = {};
      agg.brokers.forEach(function(b){ smap[String(b.code)] = b; });
      (picked.brokers || []).forEach(function(b){
        var s = smap[String(b.code)];
        var bq = (b.buy_qty || 0) - (s ? s.buy_qty : 0);
        var bv = (b.buy_value || 0) - (s ? s.buy_value : 0);
        var sq = (b.sell_qty || 0) - (s ? s.sell_qty : 0);
        var sv = (b.sell_value || 0) - (s ? s.sell_value : 0);
        if (r2(bq) || r2(bv) || r2(sq) || r2(sv)) {
          blist.push({ code: String(b.code), buy_qty: r2(bq), buy_value: r2(bv),
            sell_qty: r2(sq), sell_value: r2(sv),
            total_qty: r2(bq + sq), total: r2(bv + sv),
            net_qty: r2(bq - sq), net: r2(bv - sv) });
        }
      });
      blist.sort(function(a, b){ return (b.total - a.total) || cmpStr(a.code, b.code); });
      var result = buildFromPairs(pairs, qv, from, latest, picked.trading_days - set.files.length);
      result.brokers = blist;
      checkZeroSum(result);
      return result;
    });
  });
}

/* ---------- Broker Matching Amount (gap 7) ----------
   Matching Amount = a broker's transactions with itself (buyer == seller
   on the same trade), per the portal Glossary. It is NOT derivable from
   aggregated broker columns, so it is computed at collection time from
   Chukul bydate rows (tools/build-broker-matching.py) and published
   under nepse-brokers/data/matching/. Pages NEVER call Chukul live.
   Coverage: tape from 2026-10-26 (2026-10-23 was a holiday, Kojagrat
   Purnima, so 2026-10-26 is the first trading session in the tape
   archive). Sessions before that have no tape and render honestly
   unavailable, never estimated. Provisional (intraday) views carry no
   matching: live-day bydate rows do not carry broker codes, and
   matching publishes after close with the final data.
   Attached fields on a period payload d:
     d.matching         {code: {qty, amount, trades}} or null
     d.matchingSymbols  {code: {symbol: {qty, amount, trades}}} or null
     d.matchingNote     null | 'final-only' | 'unavailable' | 'partial'
     d.matchingCoverage {covered, total} for partial/unavailable windows
   This module is standalone (no BrokerCommon dependency) and is loaded
   by the hub and all four broker subpages, so all of them share this
   one implementation. */
var MBASE = '/nepse-brokers/data/matching/';
var mFileCache = {};
function mFetchJSON(url){
  /* Period aggregates and daily matching files are immutable once
     published: fetch once and reuse, same rule as the period cache.
     Failures are evicted so retries work. */
  if (!mFileCache[url]){
    var pr = fetch(url).then(function(r){ if(!r.ok) throw new Error('no-matching'); return r.json(); });
    mFileCache[url] = pr;
    pr.catch(function(){ delete mFileCache[url]; });
  }
  return mFileCache[url];
}
function mRound2(x){ return Math.round(Number(x) * 100) / 100; }
function mSumFiles(files){
  var brokers = {}, symbols = {};
  files.forEach(function(f){
    Object.keys(f.brokers || {}).forEach(function(c){
      var v = f.brokers[c], e = brokers[c] = brokers[c] || {qty: 0, amount: 0, trades: 0};
      e.qty += v.qty || 0; e.amount += v.amount || 0; e.trades += v.trades || 0;
    });
    Object.keys(f.symbols || {}).forEach(function(c){
      Object.keys(f.symbols[c]).forEach(function(s){
        var v = f.symbols[c][s], m = symbols[c] = symbols[c] || {};
        var e = m[s] = m[s] || {qty: 0, amount: 0, trades: 0};
        e.qty += v.qty || 0; e.amount += v.amount || 0; e.trades += v.trades || 0;
      });
    });
  });
  Object.keys(brokers).forEach(function(c){
    brokers[c].qty = mRound2(brokers[c].qty); brokers[c].amount = mRound2(brokers[c].amount);
  });
  Object.keys(symbols).forEach(function(c){
    Object.keys(symbols[c]).forEach(function(s){
      symbols[c][s].qty = mRound2(symbols[c][s].qty); symbols[c][s].amount = mRound2(symbols[c][s].amount);
    });
  });
  return {brokers: brokers, symbols: symbols};
}
function mNoteFor(d){
  if (d.matchingNote === 'partial' && d.matchingCoverage){
    return 'Matching covers ' + d.matchingCoverage.covered + ' of ' +
      d.matchingCoverage.total + ' sessions in this window (Chukul tape from 2026-10-26); earlier sessions are excluded.';
  }
  if (d.matchingNote === 'unavailable'){
    return 'Matching unavailable for this window — no Chukul tape on file (tape from 2026-10-26).';
  }
  if (d.matchingNote === 'final-only'){
    return 'Matching publishes after close — provisional views carry no matching.';
  }
  if (d.matchingNote === 'unpublished'){
    return 'Matching not yet published for this period.';
  }
  return null;
}
function mAttachFromFile(d, file){
  d.matching = file.brokers || {};
  d.matchingSymbols = file.symbols || {};
  if (file.covered_days !== undefined && file.trading_days !== undefined){
    d.matchingCoverage = {covered: file.covered_days, total: file.trading_days};
    d.matchingNote = (file.covered_days < file.trading_days)
      ? (file.covered_days === 0 ? 'unavailable' : 'partial') : null;
    if (file.covered_days === 0){ d.matching = null; d.matchingSymbols = null; }
  } else {
    d.matchingCoverage = {covered: 1, total: 1};
    d.matchingNote = null;
  }
  return d;
}
/* Attach matching to a period payload. mode: 'latest' | fixed period code
   | 'asof' (asof = single date) | 'range' (already attached: no-op).
   Never rejects: on any failure the payload keeps matching=null and the
   views render '–' with the honest note. */
function mAttach(d, mode, asof){
  if (!d || d.matching !== undefined) return Promise.resolve(d);
  if (d._mode === 'provisional' || d.provisional === true){
    d.matching = null; d.matchingSymbols = null; d.matchingNote = 'final-only';
    return Promise.resolve(d);
  }
  if (mode === 'range') return Promise.resolve(d);
  var url;
  if (mode === 'asof' && asof) url = MBASE + 'daily/' + asof + '.json';
  else if (mode === 'latest') url = MBASE + 'periods/1D.json';
  else if (mode) url = MBASE + 'periods/' + mode + '.json';
  else return Promise.resolve(d);
  return mFetchJSON(url).then(function(f){
    return mAttachFromFile(d, f);
  }).catch(function(){
    d.matching = null; d.matchingSymbols = null;
    d.matchingNote = (mode === 'asof') ? 'unavailable' : 'unpublished';
    d.matchingCoverage = {covered: 0, total: 1};
    return d;
  });
}
/* Range attach: sum matching daily files over the range's trading days.
   Best-effort per file — a missing matching file NEVER blocks the range
   (unlike the main range builder, which refuses partial sums): it only
   narrows the coverage note. */
function mAttachRange(result, days){
  var idx = 0, files = [], covered = [], missing = [];
  return new Promise(function(resolve){
    function worker(){
      if (idx >= days.length){
        if (covered.length + missing.length >= days.length){
          var sum = mSumFiles(files);
          result.matching = covered.length ? sum.brokers : {};
          result.matchingSymbols = covered.length ? sum.symbols : {};
          result.matchingCoverage = {covered: covered.length, total: days.length};
          result.matchingNote = covered.length === 0 ? 'unavailable'
            : (covered.length < days.length ? 'partial' : null);
          if (covered.length === 0){ result.matching = null; result.matchingSymbols = null; }
          resolve(result);
        }
        return;
      }
      var date = days[idx++];
      fetchCached(MBASE + 'daily/' + date + '.json').then(function(f){
        if (f && f.brokers){ files.push(f); covered.push(date); }
        else missing.push(date);
        worker();
      }).catch(function(){ missing.push(date); worker(); });
    }
    if (!days.length){ result.matching = null; result.matchingSymbols = null; result.matchingNote = 'unavailable'; result.matchingCoverage = {covered: 0, total: 0}; resolve(result); return; }
    var w = Math.min(8, days.length);
    for (var i = 0; i < w; i++) worker();
  });
}

var BrokerMatching = {
  attach: mAttach,
  attachRange: mAttachRange,
  noteFor: mNoteFor,
  base: MBASE
};
if (typeof window !== 'undefined') window.BrokerMatching = BrokerMatching;

var BrokerRange = {
  loadRange: loadRange,
  /* Pure helpers, exposed for testing (Node) only. */
  _pure: {
    dayPairs: dayPairs, buildFromPairs: buildFromPairs, sumDaily: sumDaily,
    periodPairs: periodPairs, subPairs: subPairs, fileUsable: fileUsable,
    isTradingDay: isTradingDay, tradingDaysIn: tradingDaysIn, r2: r2
  }
};
if (typeof window !== 'undefined') window.BrokerRange = BrokerRange;
if (typeof module !== 'undefined' && module.exports) module.exports = BrokerRange;
})();
