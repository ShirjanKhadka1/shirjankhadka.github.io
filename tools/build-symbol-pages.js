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
    '<meta name="author" content="Shirjan Khadka">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#FAF8F2">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Shirjan Khadka">\n' +
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
  '  <a class="rail-word" href="/nepse-alpha/"><img class="wm-mark" src="/assets/brand/nepse-decode-mark.svg" alt="" width="26" height="26">Nepse Decode</a>\n' +
  '  <p class="rail-k">Suite</p>\n' +
  '  <nav class="rail-links">\n' +
  '    <a href="/nepse-alpha/">Overview</a>\n' +
  '    <a href="/nepse-chart/">Chart &amp; signals</a>\n' +
  '    <a href="/nepse-screener/">Screener</a>\n' +
  '    <a href="/nepse-sectors/">Sectors</a>\n' +
  '    <a href="/nepse-news/">Market news</a>\n' +
  '    <a href="/nepse-watchlist/">Watchlist</a>\n' +
  '    <a href="/nepse-dashboard/">Dashboard</a>\n' +
  '    <a href="/nepse-portfolio/">Portfolio</a>\n' +
  '    <a href="/nepse-simulator/">Simulator</a>\n' +
  '    <a href="/nepse-fundamentals/">Fundamentals</a>\n' +
  '    <a href="/nepse-reports/">Reports</a>\n' +
  '    <a href="/nepse-actions/">Corp. actions</a>\n' +
  '    <a href="/nepse-chart/data-check.html">Data check</a>\n' +
  '  </nav>\n' +
  '  <p class="rail-foot">Free forever · no login</p>\n' +
  '</aside>\n\n' +
  '<header class="topbar">\n' +
  '  <div class="wrap topbar-in">\n' +
  '    <a class="wordmark" href="/nepse-alpha/"><img class="wm-mark" src="/assets/brand/nepse-decode-mark.svg" alt="" width="30" height="30">Nepse Decode</a>\n' +
  '    <nav class="suite-links" aria-label="Nepse Decode suite">\n' +
  '      <a href="/nepse-chart/">The Lab</a>\n' +
  '      <a href="/nepse-screener/">Screener</a>\n' +
  '      <a href="/nepse-sectors/">Sectors</a>\n' +
  '      <a href="/nepse-news/">News</a>\n' +
  '      <a href="/nepse-watchlist/">Watchlist</a>\n' +
  '      <a href="/nepse-fundamentals/">Fundamentals</a>\n' +
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
  '</footer>\n<script src="/js/nepse-suite.js?v=20261003a" defer></script>\n</body>\n</html>\n';

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

function symbolPage(u, v, newsItems, peers, fund, actionItems, divItems) {
  const sym = u.s, name = u.n, slug = slugOf(sym);
  const price = fmtNum(v && v.p);
  const chg = v && v.ch !== null && v.ch !== undefined && v.ch !== '' ? esc(v.ch) + '%' : null;
  const chgCls = chg && Number(v.ch) < 0 ? 'neg' : (chg && Number(v.ch) > 0 ? 'pos' : '');

  let h = head(sym, name, slug) + RAIL + '<main id="main" class="wrap">\n';
  h += '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/stocks/">Stocks</a> / <span>' + esc(sym) + '</span></nav>\n';
  h += '<section class="hero"><div class="hero-rule"></div>\n';
  h += '<p class="eyebrow">' + esc(u.t || 'Security') + ' · NEPSE</p>\n';
  h += '<h1>' + esc(name) + ' (' + esc(sym) + ')</h1>\n';
  h += '<p class="asof">Data as of ' + esc((v && v.asof) || '') + ' · refreshed daily after market close</p></section>\n';

  // Price snapshot
  h += '<section class="sp-snap" aria-label="Price snapshot"><div class="sp-price-card">\n';
  if (price) {
    h += '<div class="sp-price">Rs ' + price + '</div>\n';
    if (chg) h += '<div class="sp-chg ' + chgCls + '">' + (Number(v.ch) > 0 ? '+' : '') + chg + ' on the session</div>\n';
  } else {
    h += '<div class="sp-price">No recent price data</div>\n';
  }
  const h52 = fmtNum(v && v.h52), l52 = fmtNum(v && v.l52);
  if (h52 || l52) h += '<div class="sp-range">52-week range: Rs ' + (l52 || '–') + ' – Rs ' + (h52 || '–') + '</div>\n';
  const vol = fmtNum(v && v.vol);
  if (vol) h += '<div class="sp-vol">Volume: ' + vol + ' shares</div>\n';
  h += '</div></section>\n';

  // Engine verdicts
  h += '<section aria-label="Engine signals"><h2>Alpha Lab engine signals</h2>\n';
  h += '<p class="sp-note">Transparent rule-based readings, one per timeframe. A daily Buy can be weak while the weekly read is stronger; each pill names its own timeframe and data date.</p>\n';
  h += pill('Daily', v) + '\n' + pill('Weekly', v && v.w) + '\n' + pill('Monthly', v && v.m) + '\n';
  h += '</section>\n';

  // Fundamentals: published quarterly numbers, numbers-first.
  h += fundBlock(sym, fund);

  // News
  h += '<section aria-label="Latest headlines"><h2>Latest headlines</h2>\n';
  if (newsItems.length) {
    h += '<ul class="sp-news">\n';
    for (const it of newsItems.slice(0, 5)) {
      h += '<li><a href="' + esc(it.link) + '" rel="noopener" target="_blank">' + esc(it.title) + '</a> ' +
        '<span class="sp-news-src">' + esc(it.src || '') + ' · ' + esc(it.date || '') + '</span></li>\n';
    }
    h += '</ul>\n';
  } else {
    h += '<p class="sp-note">No recent headlines mention ' + esc(sym) + ' in the tracked press.</p>\n';
  }
  h += '</section>\n';

  // Corporate actions history: dividend, right share, book closure, AGM/SGM
  const KIND_LABEL = { dividend: 'Dividend', 'right-share': 'Right share', 'book-closure': 'Book closure', 'agm-sgm': 'AGM/SGM', 'bonus-share': 'Bonus share', 'promoter-share': 'Promoter share', auction: 'Auction' };
  h += '<section aria-label="Corporate actions history"><h2>Corporate actions history</h2>\n';
  if (actionItems.length) {
    h += '<ul class="sp-actions">\n';
    for (const it of actionItems) {
      const kl = KIND_LABEL[it.kind] || it.kind;
      const dt = it.announced ? esc(it.announced) : '';
      const href = it.officialPdf || it.sourceUrl || '';
      h += '<li><span class="sp-act-kind">' + esc(kl) + '</span> ' +
        (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' : '') +
        esc(it.headline || kl) +
        (href ? '</a>' : '') +
        (dt ? ' <span class="sp-news-src">' + dt + '</span>' : '') + '</li>\n';
    }
    h += '</ul>\n';
    h += '<p class="sp-note"><a href="/nepse-actions/">All corporate actions</a></p>\n';
  } else {
    h += '<p class="sp-note">No corporate actions on record for ' + esc(sym) + ' yet.</p>\n';
  }
  h += '</section>\n';

  // Dividend history: full archive per symbol, newest first
  h += '<section aria-label="Dividend history"><h2>Dividend history</h2>\n';
  if (divItems.length) {
    h += '<div class="sp-divwrap"><table class="sp-div"><thead><tr>' +
      '<th>Fiscal year</th><th>Bonus</th><th>Cash</th><th>Total</th><th>Book close</th></tr></thead><tbody>\n';
    for (const it of divItems.slice(0, 20)) {
      const pct = (x) => (x === null || x === undefined || x === '' ? '—' : esc(String(x)) + '%');
      h += '<tr><td>' + esc(it.fiscalYear || '—') + '</td><td>' + pct(it.bonus) +
        '</td><td>' + pct(it.cash) + '</td><td><strong>' + pct(it.total) +
        '</strong></td><td>' + esc(it.bookclose || '—') + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
    if (divItems.length > 20) h += '<p class="sp-note">Showing latest 20 of ' + divItems.length + '.</p>\n';
    h += '<p class="sp-note">Source: company disclosures via ShareSansar. Figures in percent of paid-up capital.</p>\n';
  } else {
    h += '<p class="sp-note">No dividend record found for ' + esc(sym) + '.</p>\n';
  }
  h += '</section>\n';

  // Tool links
  h += '<section aria-label="Analyze further"><h2>Analyze further</h2><ul class="sp-links">\n';
  h += '<li><a href="/nepse-chart/?s=' + esc(sym) + '">Full chart, patterns and divergences</a></li>\n';
  h += '<li><a href="/nepse-screener/">Ranked screener</a></li>\n';
  h += '<li><a href="/nepse-fundamentals/">Fundamentals snapshot</a></li>\n';
  h += '<li><a href="/nepse-news/">Market news</a></li>\n';
  h += '</ul></section>\n';

  // Peers: highest engine-scored other instruments of the same type.
  // Labeled honestly as "more of this type", never as sector peers
  // (no sector map exists yet).
  if (peers.length) {
    h += '<section aria-label="More ' + esc(u.t || 'securities') + '"><h2>More ' + esc(u.t || 'securities') + '</h2><ul class="sp-peers">\n';
    for (const p of peers) {
      h += '<li><a href="/stocks/' + slugOf(p.s) + '/">' + esc(p.n) + ' (' + esc(p.s) + ')</a></li>\n';
    }
    h += '</ul></section>\n';
  }

  h += '<p class="sp-disc">Educational use only, not investment advice. Signals are mechanical readings of past prices; past patterns do not guarantee future results.</p>\n';
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
  const actions = loadJson(path.join(DATA, 'corporate-actions.json'), null);
  const divHist = loadJson(path.join(DATA, 'dividend-history.json'), null);
  const divBySym = (divHist && divHist.history) || {};
  // per-symbol corporate-action history, newest first
  const actionsBySym = {};
  if (actions && actions.items) {
    for (const it of actions.items) {
      const s = (it.symbol || '').toUpperCase();
      if (!s) continue;
      (actionsBySym[s] = actionsBySym[s] || []).push(it);
    }
    for (const s of Object.keys(actionsBySym)) {
      actionsBySym[s].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
  }
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
  // Peers: same instrument type, ranked by engine score desc.
  const byType = {};
  for (const u of symbols) {
    const t = u.t || 'Security';
    (byType[t] = byType[t] || []).push(u);
  }
  const scoreOf = (s) => { const e = verdicts[s]; const sc = e && e.s; return (sc === null || sc === undefined) ? -Infinity : Number(sc); };
  for (const t of Object.keys(byType)) byType[t].sort((a, b) => scoreOf(b.s) - scoreOf(a.s));

  let made = 0;
  for (const u of symbols) {
    const sym = u.s, slug = slugOf(sym);
    const v = verdicts[sym] || null;
    const peers = (byType[u.t || 'Security'] || []).filter((p) => p.s !== sym).slice(0, 5);
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), symbolPage(u, v, newsBySym[sym] || [], peers, fund, actionsBySym[sym] || [], divBySym[sym] || []));
    made++;
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(symbols, ver.asof));
  console.log(JSON.stringify({ pages: made, dir: 'stocks/' }));
}

main();
