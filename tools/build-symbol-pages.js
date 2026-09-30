#!/usr/bin/env node
/* Nepse Decode — per-symbol indexable company pages.
 *
 * Reads universe.json, verdicts.json (with d/w/m verdicts) and news.json
 * from the daily batch and emits one static, fully indexable page per
 * instrument at stocks/{SYM}/index.html (slash in symbol becomes "-").
 * Also emits stocks/index.html, a plain alphabetical directory of all pages.
 *
 * Everything on the page comes from the batch data. No invented figures,
 * no valuations, no price targets, no buy/sell calls. Verdict pills are
 * the transparent rule-based Alpha Lab engine readings with their asof
 * dates; timeframes without enough history say so honestly.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const OUT = path.join(ROOT, 'stocks');
const SITE = 'https://shirjankhadka.com.np';

const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const slugOf = (sym) => String(sym).replace(/\//g, '-');

/* NEPSE sector classifier — kept identical to js/nepse-sectors.js and
 * js/nepse-screener.js. NEPSE-official symbol overrides are checked
 * before keyword matching (NIFRA must precede the 'bank' keyword;
 * HIDCLP must precede the Promoter-share instrument check). */
const DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
const INVESTMENT_SYMBOLS = { CIT:1, HIDCL:1, HIDCLP:1, NIFRA:1, NRN:1, CHDC:1, ENL:1, HATHY:1 };
const TRADING_SYMBOLS = { BBC:1, STC:1 };
function classifySymbol(sym, name, type) {
  const symU = String(sym || '').toUpperCase();
  if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
  if (TRADING_SYMBOLS[symU]) return 'Trading';
  const n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
  if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
      n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
  if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
  if (type === 'Promoter share') return 'Promoter Shares';
  if (type && type !== 'Equity') return null;
  const has = (...ws) => ws.some((w) => n.indexOf(w) >= 0);
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
  return null;
}

function vClass(v) {
  if (v === 'Strong Buy') return 'vg-sb';
  if (v === 'Buy') return 'vg-b';
  if (v === 'Hold') return 'vg-h';
  if (v === 'Exit / Reduce') return 'vg-e';
  if (v === 'Strong Exit') return 'vg-se';
  return 'vg-na';
}

function pill(tfLabel, vobj) {
  if (!vobj || !vobj.v || vobj.v === 'Insufficient history') {
    return '<div class="vpill ' + vClass('') + '"><span class="vpill-tf">' + esc(tfLabel) + '</span>' +
      '<span class="vpill-na">Insufficient history on this timeframe</span></div>';
  }
  const bits = [];
  bits.push('<span class="vpill-tf">' + esc(tfLabel) + '</span>');
  bits.push('<span class="vpill-v ' + vClass(vobj.v) + '">' + esc(vobj.v) + '</span>');
  const meta = [];
  if (vobj.s !== null && vobj.s !== undefined) meta.push('score ' + esc(vobj.s));
  if (vobj.rsi) meta.push('RSI ' + esc(vobj.rsi));
  if (vobj.n) meta.push(esc(vobj.n) + ' bars');
  if (vobj.sl && vobj.tp) meta.push('SL ' + esc(vobj.sl) + ' / TP ' + esc(vobj.tp));
  if (vobj.setup) meta.push(esc(vobj.setup));
  if (vobj.asof) meta.push('as of ' + esc(vobj.asof));
  bits.push('<span class="vpill-meta">' + meta.join(' · ') + '</span>');
  return '<div class="vpill">' + bits.join('') + '</div>';
}

function head(sym, name, slug) {
  const title = name + ' (' + sym + ') Share Price, Signals and News | Nepse Decode';
  const desc = name + ' (' + sym + '): latest NEPSE price, daily, weekly and monthly Alpha Lab engine signals, 52-week range and latest headlines. Free, educational, not investment advice.';
  const url = SITE + '/stocks/' + slug + '/';
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', name: title, url,
        description: desc,
        author: { '@type': 'Person', name: 'Shirjan Khadka', url: SITE + '/' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: 'Stocks', item: SITE + '/stocks/' },
          { '@type': 'ListItem', position: 3, name: sym, item: url },
        ],
      },
    ],
  };
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<meta name="author" content="Nepse Decode">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#FAF8F2">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Nepse Decode">\n' +
    '<meta property="og:title" content="' + esc(name + ' (' + sym + ') | Nepse Decode') + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(name + ' (' + sym + ') | Nepse Decode') + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/css/nepse-luxury.css?v=20260930c">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave7.css?v=20261002c">\n' +
    '<link rel="stylesheet" href="/css/nepse-brand.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave8.css?v=20261003a">\n' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n' +
    '</head>\n';
}

const RAIL = '<body>\n<a class="skip" href="#main">Skip to content</a>\n\n' +
  '<aside class="suite-rail" aria-label="Nepse Decode suite">\n' +
  '  <a class="rail-word" href="/nepse-decode/"><img class="wm-mark" src="/assets/brand/nepse-decode-mark.svg" alt="" width="26" height="26">Nepse Decode</a>\n' +
  '  <p class="rail-k">Suite</p>\n' +
  '  <nav class="rail-links">\n' +
  '    <a href="/nepse-decode/">Overview</a>\n' +
  '    <a href="/nepse-chart/">Chart &amp; signals</a>\n' +
  '    <a href="/nepse-screener/">Screener</a>\n' +
  '    <a href="/nepse-sectors/">Sectors</a>\n' +
  '    <a href="/nepse-news/">Market news</a>\n' +
  '    <a href="/nepse-watchlist/">Watchlist</a>\n' +
  '    <a href="/nepse-dashboard/">Dashboard</a>\n' +
  '    <a href="/nepse-portfolio/">Portfolio</a>\n' +
  '    <a href="/nepse-simulator/">Simulator</a>\n' +
  '    <a href="/nepse-reports/">Reports</a>\n' +
  '    <a href="/nepse-actions/">Corp. actions</a>\n' +
  '    <a href="/nepse-chart/data-check.html">Data check</a>\n' +
  '  </nav>\n' +
  '  <p class="rail-foot">Free forever · no login</p>\n' +
  '</aside>\n\n' +
  '<header class="topbar">\n' +
  '  <div class="wrap topbar-in">\n' +
  '    <a class="wordmark" href="/nepse-decode/"><img class="wm-mark" src="/assets/brand/nepse-decode-mark.svg" alt="" width="30" height="30">Nepse Decode</a>\n' +
  '    <nav class="suite-links" aria-label="Nepse Decode suite">\n' +
  '      <a href="/nepse-chart/">The Lab</a>\n' +
  '      <a href="/nepse-screener/">Screener</a>\n' +
  '      <a href="/nepse-sectors/">Sectors</a>\n' +
  '      <a href="/nepse-news/">News</a>\n' +
  '      <a href="/nepse-watchlist/">Watchlist</a>\n' +
  '      <a href="/nepse-actions/">Corp. actions</a>\n' +
  '    </nav>\n' +
  '    <div class="spacer"></div>\n' +
  '    <a class="btn small" href="/nepse-chart/">Open the Lab →</a>\n' +
  '  </div>\n' +
  '</header>\n\n';

const FOOT = '<footer class="sc-footer">\n' +
  '  <div class="wrap">\n' +
  '    <p>Built by <a href="/">Shirjan Khadka</a> · Kathmandu, Nepal</p>\n' +
  '    <p class="sc-footer-sub">Per-symbol NEPSE snapshot · rule-based signals · educational use only, not investment advice</p>\n' +
  '  </div>\n' +
  '</footer>\n</body>\n</html>\n';

function fmtNum(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : esc(x);
}

// Numbers-first fundamentals block. Values come from fundamentals.json
// (published quarterly figures); symbols without coverage get one honest line.
function fundBlock(sym, fund) {
  const f = fund && fund.banks && fund.banks[sym];
  let h = '<section aria-label="Fundamentals"><h2>Fundamentals</h2>\n';
  if (!f) {
    h += '<p class="sp-note">Quarterly figures not yet published for this security.</p>\n</section>\n';
    return h;
  }
  const cell = (val, label) =>
    '<div class="sp-fund"><span class="sp-fund-v">' + val + '</span><span class="sp-fund-l">' + label + '</span></div>';
  const b = (x) => (x === null || x === undefined) ? '–' : 'Rs ' + Number(x).toLocaleString('en-US') + 'b';
  const r = (x, suf) => (x === null || x === undefined) ? '–' : esc(x) + suf;
  h += '<p class="sp-note">' + esc(fund.period || '') + ' · published quarterly figures</p>\n';
  h += '<div class="sp-fund-grid">\n';
  h += cell('Rs ' + r(f.eps_ttm, ''), 'EPS (TTM)') + '\n';
  h += cell(r(f.pe_ttm, 'x'), 'P/E (TTM)') + '\n';
  h += cell(b(f.netprofit_b), 'Net profit') + '\n';
  h += cell(b(f.paidup_b), 'Paid-up capital') + '\n';
  h += cell(b(f.reserves_b), 'Reserves') + '\n';
  h += cell(b(f.deposits_b), 'Deposits') + '\n';
  h += cell(b(f.loans_b), 'Loans') + '\n';
  h += cell(r(f.npl_pct, '%'), 'NPL ratio') + '\n';
  h += '</div>\n</section>\n';
  return h;
}

/* Sector peer comparison table: same-sector equities ranked by engine
 * score, with price/session change from verdicts and P/E + EPS from
 * published fundamentals where available. Current symbol highlighted.
 * Educational comparison of published figures, never a ranking or call. */
function peerTable(sym, sector, sectorPeers, verdicts, fund) {
  if (!sector || sectorPeers.length < 2) return '';
  const rows = sectorPeers.map((p) => {
    const v = verdicts[p.s] || {};
    const f = fund && fund.banks && fund.banks[p.s];
    return { s: p.s, n: p.n, v, f };
  }).filter((r) => r.v && r.v.p !== null && r.v.p !== undefined);
  if (rows.length < 2) return '';
  const shown = rows.slice(0, 9);
  let h = '<section aria-label="Sector peer comparison"><h2>Sector peers · ' + esc(sector) + '</h2>\n';
  h += '<p class="sp-note">Same-sector equities by engine score. P/E and EPS show published quarterly figures where available; – means not yet published.</p>\n';
  h += '<div class="sp-table-wrap"><table class="sp-peer-table">\n<thead><tr>' +
    '<th scope="col">Symbol</th><th scope="col">Price (Rs)</th>' +
    '<th scope="col">Session</th><th scope="col">P/E (TTM)</th><th scope="col">EPS (TTM)</th>' +
    '</tr></thead>\n<tbody>\n';
  for (const r of shown) {
    const ch = r.v.ch;
    const chTxt = (ch === null || ch === undefined || ch === '') ? '–'
      : ((Number(ch) > 0 ? '+' : '') + ch + '%');
    const chCls = (ch === null || ch === undefined || ch === '') ? ''
      : (Number(ch) < 0 ? 'neg' : (Number(ch) > 0 ? 'pos' : ''));
    const pe = r.f && r.f.pe_ttm !== null && r.f.pe_ttm !== undefined ? esc(r.f.pe_ttm) + 'x' : '–';
    const eps = r.f && r.f.eps_ttm !== null && r.f.eps_ttm !== undefined ? 'Rs ' + esc(r.f.eps_ttm) : '–';
    const cur = r.s === sym ? ' class="cur"' : '';
    h += '<tr' + cur + '><td><a href="/stocks/' + slugOf(r.s) + '/">' + esc(r.s) + '</a></td>' +
      '<td>' + esc(fmtNum(r.v.p)) + '</td>' +
      '<td class="' + chCls + '">' + esc(chTxt) + '</td>' +
      '<td>' + pe + '</td><td>' + eps + '</td></tr>\n';
  }
  h += '</tbody></table></div>\n';
  h += '<p class="sp-note">Figures from the same data date as this page. Educational comparison only, not investment advice.</p>\n</section>\n';
  return h;
}

function symbolPage(u, v, newsItems, fund, liveQ, liveDate, sector, sectorPeers, verdicts) {
  const sym = u.s, name = u.n, slug = slugOf(sym);
  // Headline price prefers our canonical live payload (NEPSE API) when it is
  // at least as fresh as the batch verdict — the batch daily history comes
  // from a third-party feed that can lag by a session.
  const vAsof = (v && v.asof) || '';
  const useLive = !!(liveQ && liveDate && liveDate >= vAsof && Number.isFinite(Number(liveQ.ltp)));
  const pNum = useLive ? Number(liveQ.ltp) : (v && v.p);
  const cNum = (useLive && Number.isFinite(Number(liveQ.percent_change))) ? Number(liveQ.percent_change) : (v && v.ch);
  const asofD = useLive ? liveDate : vAsof;
  const price = fmtNum(pNum);
  const chg = cNum !== null && cNum !== undefined && cNum !== '' ? esc(cNum) + '%' : null;
  const chgCls = chg && Number(cNum) < 0 ? 'neg' : (chg && Number(cNum) > 0 ? 'pos' : '');

  let h = head(sym, name, slug) + RAIL + '<main id="main" class="wrap">\n';
  h += '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/stocks/">Stocks</a> / <span>' + esc(sym) + '</span></nav>\n';
  h += '<section class="hero"><div class="hero-rule"></div>\n';
  h += '<p class="eyebrow">' + esc(u.t || 'Security') + ' · NEPSE</p>\n';
  h += '<h1>' + esc(name) + ' (' + esc(sym) + ')</h1>\n';
  h += '<p class="asof">Data as of ' + esc(asofD) + ' · refreshed daily after market close</p></section>\n';

  // Price snapshot
  h += '<section class="sp-snap" aria-label="Price snapshot"><div class="sp-price-card">\n';
  h += '<div class="sp-price-main">\n';
  if (price) {
    h += '<div class="sp-price">Rs ' + price + '</div>\n';
    if (chg) h += '<div class="sp-chg ' + chgCls + '">' + (Number(cNum) > 0 ? '+' : '') + chg + ' on the session</div>\n';
  } else {
    h += '<div class="sp-price">No recent price data</div>\n';
  }
  h += '</div><div class="sp-price-side">\n';
  const h52 = fmtNum(v && v.h52), l52 = fmtNum(v && v.l52);
  if (h52 || l52) h += '<div class="sp-stat"><span class="sp-stat-v">Rs ' + (l52 || '–') + ' – Rs ' + (h52 || '–') + '</span><span class="sp-stat-l">52-week range</span></div>\n';
  const vol = fmtNum(useLive && Number.isFinite(Number(liveQ.volume)) ? Number(liveQ.volume) : (v && v.vol));
  if (vol) h += '<div class="sp-stat"><span class="sp-stat-v">' + vol + '</span><span class="sp-stat-l">Volume (shares)</span></div>\n';
  h += '</div>';
  h += '</div></section>\n';

h += '<div class="sp-tabs" role="tablist" aria-label="Security details">';
  h += '<button class="sp-tab active" role="tab" aria-selected="true" data-tab="overview">Overview</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="signals">Signals</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="fundamentals">Fundamentals</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="news">News</button>';
  h += '</div>';
  h += '<div class="sp-tabpanel active" data-panel="overview" role="tabpanel">';
  h += '<p class="sp-note">Price snapshot above. Switch tabs for engine signals, published fundamentals, and latest headlines.</p>';
  h += '<ul class="sp-links">';
  h += '<li><a href="/nepse-chart/?s=' + esc(sym) + '">Full chart, patterns and divergences <span aria-hidden="true">→</span></a></li>';
  h += '<li><a href="/nepse-screener/">Ranked screener <span aria-hidden="true">→</span></a></li>';
  h += '</ul></div>';
  h += '<div class="sp-tabpanel" data-panel="signals" role="tabpanel" hidden>';
  h += '<h2>Alpha Lab engine signals</h2>';
  h += '<p class="sp-note">Transparent rule-based readings, one per timeframe. A daily Buy can be weak while the weekly read is stronger; each pill names its own timeframe and data date.</p>';
  h += pill('Daily', v) + pill('Weekly', v && v.w) + pill('Monthly', v && v.m);
  h += '</div>';
  h += '<div class="sp-tabpanel" id="fundamentals" data-panel="fundamentals" role="tabpanel" hidden>';
  h += fundBlock(sym, fund);
  h += peerTable(sym, sector, sectorPeers, verdicts, fund);
  h += '</div>';
  h += '<div class="sp-tabpanel" data-panel="news" role="tabpanel" hidden>';
  h += '<h2>Latest headlines</h2>';
  if (newsItems.length) {
    h += '<ul class="sp-news">';
    for (const it of newsItems.slice(0, 5)) {
      h += '<li><a href="' + esc(it.link) + '" rel="noopener" target="_blank">' + esc(it.title) + '</a> ';
      h += '<span class="sp-news-src">' + esc(it.src || '') + ' · ' + esc(it.date || '') + '</span></li>';
    }
    h += '</ul>';
  } else {
    h += '<p class="sp-note">No recent headlines mention ' + esc(sym) + ' in the tracked press.</p>';
  }
  h += '<ul class="sp-links">';
  h += '<li><a href="#fundamentals" data-goto-tab="fundamentals">Fundamentals snapshot <span aria-hidden="true">→</span></a></li>';
  h += '<li><a href="/nepse-news/">Market news <span aria-hidden="true">→</span></a></li>';
  h += '</ul></div>';

  // More in this sector: true sector peers, not a random same-type list.
  const morePeers = (sectorPeers || []).filter((p) => p.s !== sym).slice(0, 5);
  if (morePeers.length) {
    const moreLabel = sector ? 'More in ' + sector : 'More ' + (u.t || 'securities');
    h += '<section aria-label="' + esc(moreLabel) + '"><h2>' + esc(moreLabel) + '</h2><ul class="sp-peers">\n';
    for (const p of morePeers) {
      h += '<li><a href="/stocks/' + slugOf(p.s) + '/">' + esc(p.n) + ' (' + esc(p.s) + ')</a></li>\n';
    }
    h += '</ul></section>\n';
  }

  h += '<p class="sp-disc">Educational use only, not investment advice. Signals are mechanical readings of past prices; past patterns do not guarantee future results.</p>\n';
// Tab switching
  h += '<script>(function(){';
  h += 'var tabs=document.querySelectorAll(".sp-tab"),panels=document.querySelectorAll(".sp-tabpanel");';
  h += 'function on(n){tabs.forEach(function(t){var a=t.dataset.tab===n;t.classList.toggle("active",a);t.setAttribute("aria-selected",a);});';
  h += 'panels.forEach(function(p){var a=p.dataset.panel===n;p.classList.toggle("active",a);if(a)p.removeAttribute("hidden");else p.setAttribute("hidden","");});}';
  h += 'tabs.forEach(function(t){t.addEventListener("click",function(){on(t.dataset.tab);});';
  h += 't.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key==="ArrowLeft"){';
  h += 'var i=Array.prototype.indexOf.call(tabs,t);var nx=e.key==="ArrowRight"?(i+1)%tabs.length:(i-1+tabs.length)%tabs.length;';
  h += 'tabs[nx].focus();on(tabs[nx].dataset.tab);}});});';
  h += 'document.querySelectorAll("[data-goto-tab]").forEach(function(a){a.addEventListener("click",function(){on(a.dataset.gotoTab);});});';
  h += 'if(location.hash==="#fundamentals"){on("fundamentals");}';
  h += '})();</scr' + 'ipt>';
  h += '</main>\n' + FOOT;
  return h;
}

function indexPage(symbols, asof) {
  const title = 'All NEPSE Listed Securities | Nepse Decode';
  const desc = 'Alphabetical directory of every NEPSE-listed security with a free price, signal and news snapshot. Educational, no login.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title,
    url: SITE + '/stocks/',
    description: desc,
    author: { '@type': 'Person', name: 'Shirjan Khadka', url: SITE + '/' },
  };
  let h = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n' +
    '<link rel="canonical" href="' + SITE + '/stocks/">\n' +
    '<meta name="robots" content="index, follow">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + SITE + '/stocks/">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/css/nepse-luxury.css?v=20260930c">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave7.css?v=20261002c">\n' +
    '<link rel="stylesheet" href="/css/nepse-brand.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave8.css?v=20261003a">\n' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n</head>\n' +
    RAIL + '<main id="main" class="wrap">\n' +
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <span>Stocks</span></nav>\n' +
    '<section class="hero"><div class="hero-rule"></div><p class="eyebrow">Directory</p>\n' +
    '<h1>All NEPSE listed securities</h1>\n' +
    '<p class="asof">' + symbols.length + ' instruments · data as of ' + esc(asof || '') + '</p></section>\n' +
    '<section aria-label="Security directory"><ul class="sp-dir">\n';
  const sorted = symbols.slice().sort((a, b) => String(a.s).localeCompare(String(b.s)));
  for (const u of sorted) {
    h += '<li><a href="/stocks/' + slugOf(u.s) + '/">' + esc(u.n) + ' (' + esc(u.s) + ')</a> <span class="sp-type">' + esc(u.t || '') + '</span></li>\n';
  }
  h += '</ul></section>\n<p class="sp-disc">Educational use only, not investment advice.</p>\n</main>\n' + FOOT;
  return h;
}

function main() {
  const universe = loadJson(path.join(DATA, 'universe.json'), null);
  const ver = loadJson(path.join(DATA, 'verdicts.json'), null);
  const news = loadJson(path.join(DATA, 'news.json'), null);
  const fund = loadJson(path.join(DATA, 'fundamentals.json'), null);
  // Canonical live quotes (NEPSE API) for the headline price snapshot.
  const live = loadJson(path.join(DATA, 'live.json'), null);
  const liveMap = {};
  let liveDate = '';
  if (live && Array.isArray(live.quotes)) {
    for (const q of live.quotes) { if (q && q.symbol) liveMap[q.symbol] = q; }
    liveDate = String(live.asof || '').slice(0, 10);
  }
  const pageAsof = (liveDate && liveDate >= String((ver && ver.asof) || '')) ? liveDate : ((ver && ver.asof) || '');
  if (!universe || !universe.symbols || !ver || !ver.verdicts) {
    console.error('build-symbol-pages: missing universe/verdicts data');
    process.exit(1);
  }
  const symbols = universe.symbols;
  const verdicts = ver.verdicts;
  const newsBySym = {};
  if (news && news.items) {
    for (const it of news.items) {
      if (!it.sym) continue;
      (newsBySym[it.sym] = newsBySym[it.sym] || []).push(it);
    }
  }
  // Sector peers: classified with the same NEPSE sector map as the
  // screener and sector heatmap, ranked by engine score desc.
  const scoreOf = (s) => { const e = verdicts[s]; const sc = e && e.s; return (sc === null || sc === undefined) ? -Infinity : Number(sc); };
  const sectorOf = {};
  const bySector = {};
  for (const u of symbols) {
    const sec = classifySymbol(u.s, u.n, u.t);
    sectorOf[u.s] = sec;
    if (sec) (bySector[sec] = bySector[sec] || []).push(u);
  }
  for (const sec of Object.keys(bySector)) bySector[sec].sort((a, b) => scoreOf(b.s) - scoreOf(a.s));

  let made = 0;
  for (const u of symbols) {
    const sym = u.s, slug = slugOf(sym);
    const v = verdicts[sym] || null;
    const sector = sectorOf[sym] || null;
    const sectorPeers = sector ? (bySector[sector] || []) : [];
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), symbolPage(u, v, newsBySym[sym] || [], fund, liveMap[sym], liveDate, sector, sectorPeers, verdicts));
    made++;
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(symbols, pageAsof));
  console.log(JSON.stringify({ pages: made, dir: 'stocks/' }));
}

main();
