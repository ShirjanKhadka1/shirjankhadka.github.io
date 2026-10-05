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
 * js/nepse-screener.js. Verified symbol overrides are checked FIRST,
 * then NEPSE-official symbol overrides (NIFRA must precede the 'bank'
 * keyword; HIDCLP must precede the Promoter-share instrument check).
 * Anything left over falls into "Others" — never "Unclassified". */
const DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
const SECTOR_OVERRIDES = {
  GVL:'Hydropower', SNORL:'Hydropower',
  BNL:'Manufacturing And Processing', UNL:'Manufacturing And Processing',
  SAIL:'Manufacturing And Processing',
  CGH:'Hotels And Tourism', KDL:'Hotels And Tourism',
  SAGF:'Mutual Funds', H8020:'Mutual Funds', NMB50:'Mutual Funds',
  CMF2:'Mutual Funds', NICBF:'Mutual Funds', LSH12:'Mutual Funds',
  RBBF40:'Mutual Funds',
  JBLBP:'Promoter Shares', KBLPO:'Promoter Shares', MLBLPO:'Promoter Shares',
  SCBD:'Debentures', SHINED:'Debentures',
  SFCL:'Finance',
  WNLB:'Microfinance',
  NTC:'Others', NRM:'Others', NWCL:'Others', TTL:'Others', MKCL:'Others'
};
const INVESTMENT_SYMBOLS = { CIT:1, HIDCL:1, HIDCLP:1, NIFRA:1, NRN:1, CHDC:1, ENL:1, HATHY:1 };
const TRADING_SYMBOLS = { BBC:1, STC:1 };
function classifySymbol(sym, name, type) {
  const symU = String(sym || '').toUpperCase();
  if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
  if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
  if (TRADING_SYMBOLS[symU]) return 'Trading';
  const n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
  if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
      n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
  if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
  if (type === 'Promoter share') return 'Promoter Shares';
  if (type && type !== 'Equity') return 'Others';
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
  return 'Others';
}

/* Sector group for choosing sector-appropriate fundamental metrics.
 * bank: deposit-taking lenders (bank-specific balance-sheet metrics apply).
 * ins: insurers (premium-driven; no deposits/loans/NPL).
 * inst: fund/debt instruments, not operating companies.
 * corp: everyone else (hydropower, manufacturing, hotels, investment, trading). */
function sectorGroup(sec) {
  if (sec === 'Banking' || sec === 'Development Bank' ||
      sec === 'Finance' || sec === 'Microfinance') return 'bank';
  if (sec === 'Life Insurance' || sec === 'Non Life Insurance') return 'ins';
  if (sec === 'Mutual Funds' || sec === 'Debentures' ||
      sec === 'Promoter Shares') return 'inst';
  return 'corp';
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
  const title = sym + ' Share Price, Signals and News | Nepse Decode';
  const desc = name + ' (' + sym + '): latest NEPSE price, Alpha Lab signals, 52-week range and headlines. Free, educational.';
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
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<script>try{var t=localStorage.getItem(\'sk-theme\');if(!t)t=matchMedia(\'(prefers-color-scheme: dark)\').matches?\'dark\':\'light\';document.documentElement.setAttribute(\'data-theme\',t)}catch(e){}</script>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<meta name="author" content="Nepse Decode">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#0A0C10">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Nepse Decode">\n' +
    '<meta property="og:title" content="' + esc(name + ' (' + sym + ') | Nepse Decode') + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:image" content="https://shirjankhadka.com.np/assets/images/nepse-decode-og.jpg">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(name + ' (' + sym + ') | Nepse Decode') + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/css/nepse-luxury.css?v=20260930c">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave7.css?v=20261002c">\n' +
    '<link rel="stylesheet" href="/css/nepse-brand.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave8.css?v=20261003a">\n' +    '<link rel="stylesheet" href="/css/theme.css?v=20261001a">\n' +
    '<link rel="stylesheet" href="/css/nepse-d2.css?v=20261001a">\n' +
    '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/verdict-v2-banner.css?v=20261005a">\n' +
    '<link rel="stylesheet" href="/css/nd-chrome.css?v=20261004a">\n' +

    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n' +
    '</head>\n';
}

const RAIL = '<body>\n<a class="skip" href="#main">Skip to content</a>\n\n' +
  '<div id="nd-header"></div>\n\n';

  const FOOT =
  '<div id="nd-footer"></div>\n' +
  '<script src="/js/nd-chrome.js?v=20261003a" defer></script>\n' +
  '<script src="/js/stock-live.js?v=20260930a" defer></script>\n' +  '<script src="/js/val-lab.js?v=20261003a" defer></script>\n' +  '<script src="/js/theme-toggle.js?v=20261001a" defer></script>\n' +
  '<script src="/js/verdict-v2-banner.js?v=20261005a" defer></script>\n' +

  '</body>\n</html>\n';

function fmtNum(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : esc(x);
}

// Numbers-first fundamentals block. Values come from fundamentals.json
// (published quarterly figures); symbols without coverage get one honest line.
function fundBlock(sym, fund, sector) {
  const f = fund && fund.companies && fund.companies[sym];
  const g = sectorGroup(sector);
  let h = '<section aria-label="Fundamentals"><h2>Fundamentals</h2>\n';
  if (g === 'inst') {
    h += '<p class="sp-note">This is a fund or debt instrument, not an operating company; company-style quarterly profit figures do not apply.</p>\n</section>\n';
    return h;
  }
  if (!f) {
    h += '<p class="sp-note">Quarterly figures not yet published for this security.</p>\n</section>\n';
    return h;
  }
  const cell = (val, label) => {
    const na = val.indexOf('–') >= 0 ? ' na' : '';
    return '<div class="sp-fund"><span class="sp-fund-l">' + label + '</span>' +
      '<span class="sp-fund-v' + na + '">' + val + '</span></div>';
  };
  const b = (x) => (x === null || x === undefined) ? '–' : 'Rs ' + Number(x).toLocaleString('en-US') + 'b';
  // Adaptive money: sub-billion values read better in millions (many
  // hydropower/manufacturing companies report quarterly figures in crores).
  const bm = (x) => {
    if (x === null || x === undefined) return '–';
    const n = Number(x);
    if (Math.abs(n) < 1) return 'Rs ' + (n * 1000).toFixed(1) + 'm';
    return 'Rs ' + n.toLocaleString('en-US') + 'b';
  };
  const r = (x, suf) => (x === null || x === undefined) ? '–' : esc(x) + suf;
  // A P/E of exactly 0 means the source could not compute it (no or negative
  // EPS); showing "0x" would be wrong, so it renders as not published.
  const pe = (x) => (x === null || x === undefined || x === 0) ? '–' : esc(x) + 'x';
  h += '<p class="sp-note">Latest published quarter: ' + esc(f.period || fund.period || '') +
    ' · figures as published, not estimates</p>\n';
  h += '<div class="sp-fund-group"><h3 class="sp-fund-sub">Valuation</h3><div class="sp-fund-grid">\n';
  h += cell('Rs ' + r(f.eps_ttm, ''), 'EPS (TTM)') + '\n';
  h += cell(pe(f.pe_ttm), 'P/E (TTM)') + '\n';
  h += '</div></div>\n<div class="sp-fund-group"><h3 class="sp-fund-sub">Quarterly snapshot</h3><div class="sp-fund-grid">\n';
  h += cell(bm(f.netprofit_b), 'Net profit') + '\n';
  if (g === 'bank') {
    h += cell(b(f.paidup_b), 'Paid-up capital') + '\n';
    h += cell(b(f.reserves_b), 'Reserves') + '\n';
    h += cell(b(f.deposits_b), 'Deposits') + '\n';
    h += cell(b(f.loans_b), 'Loans') + '\n';
    h += cell(r(f.npl_pct, '%'), 'NPL ratio') + '\n';
  } else if (g === 'ins') {
    h += cell(bm(f.revenue_b), 'Revenue') + '\n';
    h += cell(bm(f.grossprofit_b), 'Gross profit') + '\n';
    h += cell(bm(f.assets_b), 'Total assets') + '\n';
    h += cell(bm(f.liabilities_b), 'Total liabilities') + '\n';
    h += cell(bm(f.paidup_b), 'Paid-up capital') + '\n';
  } else {
    h += cell(bm(f.revenue_b), 'Revenue') + '\n';
    h += cell(bm(f.grossprofit_b), 'Gross profit') + '\n';
    h += cell(bm(f.opprofit_b), 'Operating profit') + '\n';
    h += cell(bm(f.assets_b), 'Total assets') + '\n';
    h += cell(bm(f.paidup_b), 'Paid-up capital') + '\n';
  }
  h += '</div></div>\n</section>\n';
  return h;
}

/* Quarterly trend table. quarterly.json holds published quarterly figures
 * for covered securities (values in NPR thousands). P&L figures (net profit,
 * revenue, gross/operating profit) are published cumulative for the fiscal
 * year, so the standalone quarter is derived as cum(Q) minus cum(Q-1); Q1
 * stands alone. Balance-sheet items, EPS (TTM), P/E (TTM) and NPL are
 * point-in-time and compare directly. QoQ = latest quarter vs previous
 * quarter; YoY = latest vs same quarter of the previous fiscal year. NPL is
 * direction-aware (down is good); P/E differences are neutral. Metrics shown
 * depend on the sector: lenders get deposits/loans/NPL, other operating
 * companies get revenue and profit lines, fund/debt instruments get no trend
 * table. Missing figures render as –. */
function quarterlyTable(sym, quarterly, sector) {
  const g = sectorGroup(sector);
  if (g === 'inst') return '';
  const sq = quarterly && quarterly.symbols && quarterly.symbols[sym];
  if (!sq || !sq.quarters) return '';
  const qs = Object.keys(sq.quarters).map((k) => {
    const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(k);
    if (!m) return null;
    return { key: k, fy: m[1] + '/' + m[2], y0: +m[1], q: +m[3], d: sq.quarters[k] };
  }).filter(Boolean).sort((a, b) => (a.y0 - b.y0) || (a.q - b.q));
  if (qs.length < 2) return '';
  const byKey = {};
  qs.forEach((x) => { byKey[x.key] = x; });
  const prevQ = (x) => {
    if (x.q > 1) return byKey[x.fy + '-Q' + (x.q - 1)] || null;
    const p0 = x.y0 - 1;
    return byKey[p0 + '/' + (p0 + 1) + '-Q4'] || null;
  };
  const yoyQ = (x) => {
    const p0 = x.y0 - 1;
    return byKey[p0 + '/' + (p0 + 1) + '-Q' + x.q] || null;
  };
  const num = (x) => {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  // Standalone quarter P&L in Rs B (derived from cumulative fiscal-year figures).
  const stOf = (x, field) => {
    const c = num(x.d[field]);
    if (c === null) return null;
    if (x.q === 1) return c / 1e6;
    const p = prevQ(x);
    const pc = p ? num(p.d[field]) : null;
    if (pc === null) return null;
    return (c - pc) / 1e6;
  };
  const bOf = (x, f) => { const v = num(x.d[f]); return v === null ? null : v / 1e6; };
  const b2 = (x) => x === null ? '–' : 'Rs ' + x.toFixed(2) + 'b';
  const b1 = (x) => x === null ? '–' : 'Rs ' + x.toFixed(1) + 'b';
  // Adaptive: sub-billion quarterly figures read better in Rs millions.
  const bma = (x) => x === null ? '–' :
    (Math.abs(x) < 1 ? 'Rs ' + (x * 1000).toFixed(1) + 'm' : 'Rs ' + x.toFixed(2) + 'b');
  const r2 = (x) => x === null ? '–' : x.toFixed(2);
  const rs2 = (x) => x === null ? '–' : 'Rs ' + x.toFixed(2);
  const pc2 = (x) => x == null ? '–' : x.toFixed(2) + '%';
  const sec_h = (t) => ({ sec: t });
  // Full financial statements: P&L (standalone quarters), Balance Sheet (point-in-time), Ratios.
  const metrics = g === 'bank' ? [
    sec_h('Profit & Loss (standalone quarter)'),
    { l: 'Revenue', v: (x) => stOf(x, 'revenue'), f: bma, dir: 1 },
    { l: 'Gross profit', v: (x) => stOf(x, 'grossprofit'), f: bma, dir: 1 },
    { l: 'Operating profit', v: (x) => stOf(x, 'opprofit'), f: bma, dir: 1 },
    { l: 'Net profit', v: (x) => stOf(x, 'netprofit'), f: bma, dir: 1 },
    { l: 'Distributable profit', v: (x) => stOf(x, 'distprofit'), f: bma, dir: 1 },
    sec_h('Balance Sheet (point-in-time)'),
    { l: 'Paid-up capital', v: (x) => bOf(x, 'paidup'), f: bma, dir: 1 },
    { l: 'Reserves & surplus', v: (x) => bOf(x, 'reserves'), f: bma, dir: 1 },
    { l: 'Deposits', v: (x) => bOf(x, 'deposits'), f: bma, dir: 1 },
    { l: 'Loans & advances', v: (x) => bOf(x, 'loans'), f: bma, dir: 1 },
    { l: 'Total assets', v: (x) => bOf(x, 'assets'), f: bma, dir: 1 },
    { l: 'Total liabilities', v: (x) => bOf(x, 'liabilities'), f: bma, dir: 1 },
    sec_h('Key ratios'),
    { l: 'EPS (TTM)', v: (x) => num(x.d.eps_ttm), f: rs2, dir: 1 },
    { l: 'EPS (annualized)', v: (x) => num(x.d.eps_ann), f: rs2, dir: 1 },
    { l: 'P/E (TTM)', v: (x) => num(x.d.pe_ttm), f: (x) => (x === null || x === 0) ? '–' : x.toFixed(2) + '×', dir: 0 },
    { l: 'NPL ratio', v: (x) => num(x.d.npl_pct), f: pc2, dir: -1 },
    { l: 'Credit/deposit ratio', v: (x) => num(x.d.cd_ratio), f: pc2, dir: 0 },
    { l: 'Interest rate spread', v: (x) => num(x.d.spread), f: pc2, dir: 1 },
  ] : [
    sec_h('Profit & Loss (standalone quarter)'),
    { l: 'Revenue', v: (x) => stOf(x, 'revenue'), f: bma, dir: 1 },
    { l: 'Gross profit', v: (x) => stOf(x, 'grossprofit'), f: bma, dir: 1 },
    { l: 'Operating profit', v: (x) => stOf(x, 'opprofit'), f: bma, dir: 1 },
    { l: 'Net profit', v: (x) => stOf(x, 'netprofit'), f: bma, dir: 1 },
    { l: 'Distributable profit', v: (x) => stOf(x, 'distprofit'), f: bma, dir: 1 },
    sec_h('Balance Sheet (point-in-time)'),
    { l: 'Paid-up capital', v: (x) => bOf(x, 'paidup'), f: bma, dir: 1 },
    { l: 'Reserves & surplus', v: (x) => bOf(x, 'reserves'), f: bma, dir: 1 },
    { l: 'Total assets', v: (x) => bOf(x, 'assets'), f: bma, dir: 1 },
    { l: 'Total liabilities', v: (x) => bOf(x, 'liabilities'), f: bma, dir: 1 },
    sec_h('Key ratios'),
    { l: 'EPS (TTM)', v: (x) => num(x.d.eps_ttm), f: rs2, dir: 1 },
    { l: 'EPS (annualized)', v: (x) => num(x.d.eps_ann), f: rs2, dir: 1 },
    { l: 'P/E (TTM)', v: (x) => num(x.d.pe_ttm), f: (x) => (x === null || x === 0) ? '–' : x.toFixed(2) + '×', dir: 0 },
  ];
  const show = qs.slice(-12);
  const latest = show[show.length - 1];
  const pq = prevQ(latest), yq = yoyQ(latest);
  const pct = (cur, prev) => {
    if (cur === null || prev === null || prev === 0) return null;
    return (cur - prev) / Math.abs(prev) * 100;
  };
  const dCell = (m, ref) => {
    const d = pct(m.v(latest), ref ? m.v(ref) : null);
    if (d === null) return '<td>–</td>';
    const cls = m.dir === 0 ? '' : (d * m.dir > 0 ? ' class="pos"' : (d * m.dir < 0 ? ' class="neg"' : ''));
    return '<td' + cls + '>' + (d > 0 ? '+' : '') + d.toFixed(1) + '%</td>';
  };
  const qLabel = (x) => 'Q' + x.q + ' ' + x.fy.slice(2, 4) + '/' + x.fy.slice(7, 9);
  let h = '<section aria-label="Quarterly trend"><h2>Quarterly trend</h2>\n';
  h += '<p class="sp-note">Published quarterly figures · latest ' + show.length + ' quarters. QoQ compares with the previous quarter; YoY with the same quarter last fiscal year.</p>\n';
  h += '<div class="sp-table-wrap"><table class="sp-peer-table">\n<thead><tr><th scope="col">Metric</th><th scope="col">QoQ</th><th scope="col">YoY</th>';
  for (let i = show.length - 1; i >= 0; i--) h += '<th scope="col" class="num">' + esc(qLabel(show[i])) + '</th>';
  h += '</tr></thead>\n<tbody>\n';
  for (const m of metrics) {
    if (m.sec) {
      h += '<tr class="sp-sec-row"><td colspan="' + (3 + show.length) + '"><strong>' + esc(m.sec) + '</strong></td></tr>\n';
      continue;
    }
    h += '<tr><td>' + esc(m.l) + '</td>' + dCell(m, pq) + dCell(m, yq);
    for (let i = show.length - 1; i >= 0; i--) h += '<td class="num">' + m.f(m.v(show[i])) + '</td>';
    h += '</tr>\n';
  }
  h += '</tbody></table></div>\n';
  h += '<p class="sp-note">Profit figures are published cumulative for the fiscal year; the quarterly profit row shows the implied standalone quarter (this quarter minus the prior quarter). P/E is not shown as a trend: the screener prices every historical quarter at today\u2019s price, so a historical P/E would be misleading. – means not published.</p>\n</section>\n';
  return h;
}

/* Valuation lab (S6 idiom): metric-synced peer analysis inside the
 * Fundamentals tab. Clickable metric rows redraw one shared canvas with the
 * selected metric's real quarterly history for the company against up to five
 * same-sector peers; peer chips switch the highlighted company.
 * HONESTY: only filing-based quantities are charted (profit, revenue, EPS,
 * balance-sheet items, NPL). P/E is offered solely as a point-in-time peer
 * ranking — never a historical trend. Profit lines are implied standalone
 * quarters (published cumulative minus the prior quarter). All series come
 * from quarterly.json; unpublished quarters render as gaps, never as zeros. */
function valLab(sym, name, sector, sectorPeers, quarterly, fund, snap, asofD) {
  const g = sectorGroup(sector);
  if (g === 'inst') return '';
  const sq = quarterly && quarterly.symbols && quarterly.symbols[sym];
  if (!sq || !sq.quarters) return '';
  const ql = Object.keys(sq.quarters).map((k) => {
    const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(k);
    if (!m) return null;
    return { key: k, fy: m[1] + '/' + m[2], y0: +m[1], q: +m[3] };
  }).filter(Boolean).sort((a, b) => (a.y0 - b.y0) || (a.q - b.q));
  if (ql.length < 2) return '';
  const show = ql.slice(-12);
  const showKeys = show.map((x) => x.key);
  const labels = show.map((x) => 'Q' + x.q + ' ' + x.fy.slice(2, 4) + '/' + x.fy.slice(7, 9));
  const num = (x) => {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const M = (key, label, unit, kind, fmt, field, zeroBased) =>
    ({ key, label, unit, kind, fmt, field, zeroBased: !!zeroBased });
  const metrics = [
    M('netprofit', 'Net profit', 'Rs b', 'pl', 'money', 'netprofit'),
    M('revenue', 'Revenue', 'Rs b', 'pl', 'money', 'revenue', true),
    M('eps_ttm', 'EPS (TTM)', 'Rs', 'pt', 'rs', 'eps_ttm'),
  ].concat(g === 'bank'
    ? [M('npl_pct', 'NPL ratio', '%', 'pt', 'pct', 'npl_pct', true),
       M('deposits', 'Deposits', 'Rs b', 'pt', 'money', 'deposits', true)]
    : [M('assets', 'Total assets', 'Rs b', 'pt', 'money', 'assets', true)]);
  // Peer set: the focus company + up to 5 same-sector peers (engine-score
  // order) that actually have quarterly history. X axis is the focus
  // company's quarter list; peers map onto the same keys, gaps stay null.
  const peers = [];
  for (const p of (sectorPeers || [])) {
    if (p.s === sym) continue;
    const pq = quarterly.symbols && quarterly.symbols[p.s];
    if (pq && pq.quarters && Object.keys(pq.quarters).length >= 2) peers.push(p);
    if (peers.length >= 5) break;
  }
  const names = {};
  names[sym] = name;
  peers.forEach((p) => { names[p.s] = p.n; });
  const seriesForKeys = (qd) => {
    const qb = {};
    Object.keys(qd).forEach((k) => { qb[k] = qd[k]; });
    const prevOf = (key) => {
      const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(key);
      if (!m) return null;
      const fy = m[1] + '/' + m[2], q = +m[3], y0 = +m[1];
      if (q > 1) return qb[fy + '-Q' + (q - 1)] || null;
      const p0 = y0 - 1;
      return qb[p0 + '/' + (p0 + 1) + '-Q4'] || null;
    };
    const out = {};
    for (const m of metrics) {
      out[m.key] = showKeys.map((key) => {
        const d = qb[key];
        if (!d) return null;
        if (m.kind === 'pl') {
          const c = num(d[m.field]);
          if (c === null) return null;
          const q = +key.slice(-1);
          if (q === 1) return c / 1e6;
          const pd = prevOf(key);
          const pc = pd ? num(pd[m.field]) : null;
          return pc === null ? null : (c - pc) / 1e6;
        }
        const v = num(d[m.field]);
        return v === null ? null : (m.fmt === 'money' ? v / 1e6 : v);
      });
    }
    return out;
  };
  const series = {};
  const allSyms = [sym].concat(peers.map((p) => p.s));
  for (const s of allSyms) series[s] = seriesForKeys(quarterly.symbols[s].quarters);
  // Point-in-time P/E (TTM) for the ranking chart; 0/absent = not published.
  const peOf = (s) => {
    const f = fund && fund.companies && fund.companies[s];
    const pe = f && f.pe_ttm;
    return (pe === null || pe === undefined || pe === 0) ? null : Number(pe);
  };
  const pe = {};
  for (const s of allSyms) pe[s] = peOf(s);
  const fmtV = (m, v) => {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    if (m.fmt === 'money') {
      const a = Math.abs(v);
      return 'Rs ' + (a < 1 ? (v * 1000).toFixed(1) + 'm' : v.toFixed(2) + 'b');
    }
    if (m.fmt === 'pct') return v.toFixed(2) + '%';
    if (m.fmt === 'rs') return 'Rs ' + v.toFixed(2);
    return String(v);
  };
  const lastOf = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (v !== null && isFinite(v)) return v;
    }
    return null;
  };
  const subOf = (m) => m.kind === 'pl'
    ? 'standalone quarter · ' + m.unit
    : (m.key === 'eps_ttm' ? 'trailing twelve months · ' + m.unit : 'latest published · ' + m.unit);
  let rows = '';
  metrics.forEach((m, i) => {
    rows += '<button type="button" class="d2-metric-row" data-metric="' + m.key + '"' +
      ' aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' +
      '<span class="m-name">' + esc(m.label) + '<small>' + esc(subOf(m)) + '</small></span>' +
      '<span class="m-val">' + esc(fmtV(m, lastOf(series[sym][m.key]))) + '</span></button>\n';
  });
  const peTxt = pe[sym] === null ? '–' : pe[sym].toFixed(2) + '×';
  rows += '<button type="button" class="d2-metric-row" data-metric="__pe" aria-pressed="false">' +
    '<span class="m-name">P/E (TTM)<small>point-in-time peer ranking · ×</small></span>' +
    '<span class="m-val">' + esc(peTxt) + '</span></button>\n';
  const chips = allSyms.map((s, i) =>
    '<button type="button" data-sym="' + esc(s) + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '"' +
    ' aria-label="Highlight ' + esc(s) + ' in the chart">' + esc(s) + '</button>').join('\n');
  const px = snap && snap.p !== null && snap.p !== undefined
    ? 'Rs ' + Number(snap.p).toLocaleString('en-US') : '–';
  const chN = snap ? Number(snap.ch) : NaN;
  const chHtml = isFinite(chN)
    ? '<div class="c ' + (chN > 0 ? 'up' : chN < 0 ? 'dn' : '') + '">' +
      (chN > 0 ? '+' : '') + chN.toFixed(2) + '%</div>'
    : '';
  const fundPeriod = (fund && fund.period) || '';
  const payload = {
    quarters: labels, series, pe, focus: sym, peerNames: names, sector: sector || '',
    metrics: metrics.map((m) => ({
      key: m.key, label: m.label, unit: m.unit, kind: m.kind,
      fmt: m.fmt, zeroBased: m.zeroBased,
    })),
  };
  let h = '<section class="d2-val-lab" id="valLab" aria-label="Valuation lab">\n';
  h += '<p class="d2-val-label">Valuation lab · ' + esc(sector || 'sector peers') + '</p>\n';
  h += '<div class="d2-val-grid">\n<div>\n';
  h += '<div class="d2-val-label">Peer set · ' + allSyms.length + ' ' + esc(sector || 'companies') + '</div>\n';
  h += '<div class="d2-bank-chips" role="group" aria-label="Choose a company to highlight">\n' + chips + '\n</div>\n';
  h += '<div class="d2-val-co"><div class="d2-val-co-head"><div>' +
    '<div class="d2-val-co-sym" id="valCoSym">' + esc(sym) + '</div>' +
    '<div class="d2-val-co-name" id="valCoName">' + esc(name) + '</div></div>' +
    '<div class="d2-val-co-price"><div class="p">' + esc(px) + '</div>' + chHtml + '</div></div></div>\n';
  h += '<div class="d2-metric-rows" role="group" aria-label="Valuation metrics">\n' + rows + '</div>\n';
  h += '</div>\n<div>\n';
  h += '<div class="d2-val-chart-head"><div><strong id="valChartTitle">–</strong>' +
    '<span id="valChartSub">–</span></div><div class="d2-val-legend" id="valLegend"></div></div>\n';
  h += '<div class="d2-val-chart"><canvas id="valChart" role="img" aria-label="Valuation chart"></canvas></div>\n';
  h += '<p style="font-size:12.5px;color:var(--d2-muted);margin:10px 0 0;line-height:1.65">' +
    'Profit lines show implied standalone quarters (published cumulative minus the prior quarter). ' +
    'P/E is a point-in-time peer ranking, never a historical trend. Every figure is from published ' +
    'quarterly filings — nothing estimated.</p>\n';
  h += '<div class="d2-fresh"><b>Fundamentals</b><span>as of ' + esc(fundPeriod) + '</span>' +
    '<span aria-hidden="true">·</span><span>Source: published quarterly filings</span>' +
    '<span aria-hidden="true">·</span><span>Prices: session ' + esc(asofD || '') + '</span></div>\n';
  h += '</div>\n</div>\n';
  h += '<script type="application/json" id="val-lab-data">' +
    JSON.stringify(payload).replace(/</g, '\\u003c') + '<\/script>\n';
  h += '</section>\n';
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
    const f = fund && fund.companies && fund.companies[p.s];
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

/* Investment tab: all-time per-scrip history (dividends, rights, auctions, AGMs).
 * History rows come from corp-history.json (ShareSansar crawl: dividends,
 * AGMs, rights, auctions) unioned with div-history-yonepse.json (yonepse open
 * API dividends) at build time. Verified recent notices from
 * corporate-actions.json carry the official NEPSE/company PDF link. Nothing is
 * invented; missing history renders an honest note.
 * (2026-09-30: no on-page source label per his call.) */
const CA_KIND_LABEL = {
  'dividend': 'Dividend',
  'bonus-share': 'Bonus share',
  'right-share': 'Right share',
  'promoter-share': 'Promoter share',
  'auction': 'Auction',
};
function stripTags(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function pct(x) {
  if (x === null || x === undefined || x === '') return '–';
  const n = Number(x);
  return Number.isFinite(n) ? String(n) : String(x);
}
/* Investment Calendar card: Nepse Alpha-style past corporate-action history.
 * Shows all-time per-scrip history (dividends, AGMs, rights, auctions) in
 * a card with sidebar navigation, search, and pagination. History rows come
 * from corp-history.json unioned with div-history-yonepse.json at build time.
 * Nothing is invented; missing history renders an honest note. */
function investmentCalendarCard(sym, name, hist) {
  const H = hist || {};
  const divs = H.dividends || [], agms = H.agms || [],
        rights = H.rights || [], aucs = H.auctions || [];
  const uid = 'inv-' + sym.replace(/[^A-Z0-9]/gi, '');

  let h = '<section class="inv-cal" aria-label="Investment Calendar">\n';
  h += '<div class="inv-cal-head"><h2><span aria-hidden="true">📅</span> Investment Calendar</h2>' +
    '<span class="inv-cal-co">' + esc(name) + '</span></div>\n';

  const hasHist = divs.length + agms.length + rights.length + aucs.length > 0;
  if (!hasHist) {
    h += '<p class="sp-note inv-cal-empty">Past dividend, right share, auction and AGM history ' +
      'is being compiled for this security. Check back soon.</p>\n';
    h += '</section>\n';
    return h;
  }

  h += '<div class="inv-cal-body">\n';
  // Sidebar navigation
  h += '<nav class="inv-cal-nav" aria-label="History categories">\n';
  const tabs = [
    ['dividends', 'Dividends', divs.length],
    ['agm', 'AGM', agms.length],
    ['rights', 'Right Share', rights.length],
    ['auctions', 'Auction', aucs.length],
  ];
  tabs.forEach(([key, label, count], i) => {
    h += '<button class="inv-cal-tab' + (i === 0 ? ' active' : '') + '" data-inv-tab="' + key + '" ' +
      'data-inv-uid="' + uid + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' +
      esc(label.toUpperCase()) +
      (count ? ' <span class="inv-cal-count">' + count + '</span>' : '') +
      '</button>\n';
  });
  h += '</nav>\n';

  // Main content area
  h += '<div class="inv-cal-main">\n';
  h += '<div class="inv-cal-controls">\n';
  h += '<label>Show <select class="inv-cal-perpage" data-inv-uid="' + uid + '" aria-label="Entries per page">' +
    '<option value="10" selected>10</option><option value="25">25</option>' +
    '<option value="50">50</option><option value="100">100</option></select> entries</label>\n';
  h += '<label class="inv-cal-search">Search: <input type="search" class="inv-cal-q" data-inv-uid="' + uid + '" ' +
    'placeholder="" aria-label="Search history"></label>\n';
  h += '</div>\n';

  // Tables (one per category, only first visible)
  h += '<div class="inv-cal-tables" data-inv-uid="' + uid + '">\n';

  // Dividends table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="dividends">\n';
  if (divs.length) {
    h += '<div class="inv-cal-scroll"><table class="inv-cal-table">\n<thead><tr>' +
      '<th scope="col">Bonus %</th><th scope="col">Cash %</th><th scope="col">Total</th>' +
      '<th scope="col">Book Close Date</th><th scope="col">Fiscal Year</th><th scope="col">Status</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const d of divs) {
      const bonus = pct(d.bonus_share), cash = pct(d.cash_dividend), total = pct(d.total_dividend);
      /* Status pill: computed live in the browser from the book close date vs
       * today (Open while the date is today or in the future, Closed once it
       * has passed), so it flips on its own with no rebuild. A [Closed]
       * marker from the crawl is authoritative and passed through as data.
       * Falls back to the fiscal year when no book close date is on record. */
      const bcRaw = stripTags(d.bookclose_date || '');
      const bcMarkedClosed = /\[closed\]/i.test(bcRaw);
      const bcDisp = bcRaw.replace(/\s*\[closed\]/i, '').trim();
      const bcIso = ((/^(\d{4}-\d{2}-\d{2})/.exec(bcDisp) || [])[1]) || '';
      const fy = String(d.year || d.fiscal_year || '');
      h += '<tr><td>' + esc(bonus === '–' ? '–' : bonus + ' %') + '</td>' +
        '<td>' + esc(cash === '–' ? '–' : cash + ' %') + '</td>' +
        '<td>' + esc(total === '–' ? '–' : total + ' %') + '</td>' +
        '<td>' + esc(bcDisp || '–') + '</td>' +
        '<td>' + esc(fy || '–') + '</td>' +
        '<td><span class="inv-cal-divstatus" data-bc="' + esc(bcIso) + '"' +
        (bcMarkedClosed ? ' data-closed="1"' : '') + '></span></td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No dividend history available yet.</p>\n';
  }
  h += '</div>\n';

  // AGM table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="agm" hidden>\n';
  if (agms.length) {
    h += '<div class="inv-cal-scroll"><table class="inv-cal-table">\n<thead><tr>' +
      '<th scope="col">AGM</th><th scope="col">Meeting Date</th>' +
      '<th scope="col">Book Close</th><th scope="col">Venue</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const g of agms) {
      h += '<tr><td>' + esc(stripTags(g.agm) || '–') + '</td>' +
        '<td>' + esc(g.meeting_date || '–') + '</td>' +
        '<td>' + esc(stripTags(g.bookclose_date) || '–') + '</td>' +
        '<td>' + esc(stripTags(g.venue_time).slice(0, 80) || '–') + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No AGM history available yet.</p>\n';
  }
  h += '</div>\n';

  // Right share table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="rights" hidden>\n';
  if (rights.length) {
    h += '<div class="inv-cal-scroll"><table class="inv-cal-table">\n<thead><tr>' +
      '<th scope="col">Ratio</th><th scope="col">Units</th><th scope="col">Price (Rs)</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const r of rights) {
      const ratio = stripTags(r.ratio_value || r.ratio || r.right_ratio);
      const unitsRaw = stripTags(r.total_units || r.units);
      const unitsNum = Number(String(unitsRaw).replace(/,/g, ''));
      const units = unitsRaw ? (Number.isFinite(unitsNum)
        ? Math.round(unitsNum).toLocaleString('en-US') : unitsRaw) : '–';
      const priceRaw = stripTags(r.issue_price || r.price || r.rate);
      const priceNum = Number(String(priceRaw).replace(/,/g, ''));
      const price = priceRaw ? (Number.isFinite(priceNum) ? priceNum.toFixed(2) : priceRaw) : '–';
      h += '<tr><td>' + esc(ratio || '–') + '</td>' +
        '<td>' + esc(units) + '</td>' +
        '<td>' + esc(price) + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No right share history available yet.</p>\n';
  }
  h += '</div>\n';

  // Auction table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="auctions" hidden>\n';
  if (aucs.length) {
    h += '<div class="inv-cal-scroll"><table class="inv-cal-table">\n<thead><tr>' +
      '<th scope="col">Type</th><th scope="col">Units</th>' +
      '<th scope="col">Opened</th><th scope="col">Closed</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const a of aucs) {
      const typ = a.displayable_share_type || (String(a.share_type) === '1' ? 'Promoter Share' : a.share_type);
      h += '<tr><td>' + esc(stripTags(typ) || '–') + '</td>' +
        '<td>' + esc(stripTags(a.total_auction) || '–') + '</td>' +
        '<td>' + esc(a.opening_date || '–') + '</td>' +
        '<td>' + esc(a.closing_date || '–') + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No auction history available yet.</p>\n';
  }
  h += '</div>\n';

  h += '</div>\n'; // .inv-cal-tables

  // Pagination footer
  h += '<div class="inv-cal-foot" data-inv-uid="' + uid + '">\n';
  h += '<span class="inv-cal-info">Showing 1 to 10 of 0 entries</span>\n';
  h += '<div class="inv-cal-pages" role="navigation" aria-label="Pagination">\n';
  h += '<button class="inv-cal-prev" disabled>Previous</button>\n';
  h += '<span class="inv-cal-pagenums"></span>\n';
  h += '<button class="inv-cal-next" disabled>Next</button>\n';
  h += '</div></div>\n';

  h += '</div>\n'; // .inv-cal-main
  h += '</div>\n'; // .inv-cal-body
  h += '</section>\n';
  return h;
}

function symbolPage(u, v, newsItems, fund, liveQ, liveDate, sector, sectorPeers, verdicts, quarterly, corpHist) {
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

  // Verdict Engine v2 warning banner — hydrated client-side from
  // /data/verdicts-v2-summary.json (async, no first-paint cost).
  h += '<div data-verdict-v2-banner data-sym="' + esc(sym) + '"></div>\n';

  // Price snapshot — hydrated live in the browser by /js/stock-live.js
  // (data-live-symbol), so the page stays fresh without rebuilds.
  h += '<section class="sp-snap" aria-label="Price snapshot" data-live-symbol="' + esc(sym) + '"><div class="sp-price-card">\n';
  h += '<div class="sp-price-main">\n';
  if (price) {
    h += '<div class="sp-price">Rs ' + price + '</div>\n';
    if (chg) h += '<div class="sp-chg ' + chgCls + '">' + (Number(cNum) > 0 ? '+' : '') + chg + ' on the session</div>\n';
  } else {
    h += '<div class="sp-price">No recent price data</div>\n';
  }
  h += '<span class="sp-live-badge" data-live-badge style="display:none">LIVE</span>\n';
  h += '</div><div class="sp-price-side">\n';
  const h52 = fmtNum(v && v.h52), l52 = fmtNum(v && v.l52);
  if (h52 || l52) h += '<div class="sp-stat"><span class="sp-stat-v">Rs ' + (l52 || '–') + ' – Rs ' + (h52 || '–') + '</span><span class="sp-stat-l">52-week range</span></div>\n';
  const vol = fmtNum(useLive && Number.isFinite(Number(liveQ.volume)) ? Number(liveQ.volume) : (v && v.vol));
  if (vol) h += '<div class="sp-stat"><span class="sp-stat-v" data-live-vol>' + vol + '</span><span class="sp-stat-l">Volume (shares)</span></div>\n';
  const tno = fmtNum(useLive && Number.isFinite(Number(liveQ.turnover)) ? Math.round(Number(liveQ.turnover)) : null);
  if (tno) h += '<div class="sp-stat"><span class="sp-stat-v" data-live-turnover>Rs ' + tno + '</span><span class="sp-stat-l">Turnover</span></div>\n';
  h += '</div>';
  h += '</div></section>\n';

h += '<div class="sp-tabs" role="tablist" aria-label="Security details">';
  h += '<button class="sp-tab active" role="tab" aria-selected="true" data-tab="overview">Overview</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="signals">Signals</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="fundamentals">Fundamentals</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="news">News</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="actions">Corporate Actions</button>';
  h += '</div>';
  h += '<div class="sp-tabpanel active" data-panel="overview" role="tabpanel">';
  h += '<p class="sp-note">Price snapshot above. Switch tabs for engine signals, published fundamentals, latest headlines and corporate actions.</p>';
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
  h += valLab(sym, name, sector, sectorPeers, quarterly, fund, { p: pNum, ch: cNum }, asofD);
  h += fundBlock(sym, fund, sector);
  h += quarterlyTable(sym, quarterly, sector);
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
  h += '</div>';
  h += '<div class="sp-tabpanel" data-panel="actions" role="tabpanel" hidden>';
  h += '<h2>Corporate actions</h2>';
  h += '<p class="sp-note">Past dividends, bonus shares, right shares, auctions and AGM history.</p>';
  h += investmentCalendarCard(sym, name, corpHist);
  h += '</div>';

  // More in this sector: true sector peers, not a random same-type list.
  const morePeers = (sectorPeers || []).filter((p) => p.s !== sym).slice(0, 5);
  if (morePeers.length) {
    const moreLabel = sector ? 'More in the ' + sector + ' sector' : 'More ' + (u.t || 'securities');
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
  h += 'if(location.hash==="#actions"){on("actions");}';
  // Investment Calendar: sidebar tabs, search, pagination
  h += 'document.querySelectorAll(".inv-cal").forEach(function(card){';
  h += 'var uid=card.querySelector("[data-inv-uid]").dataset.invUid;';
  h += 'var state={tab:"dividends",q:"",page:1,per:10};';
  h += 'function rows(){var p=card.querySelector("[data-inv-panel=\\""+state.tab+"\\"]");';
  h += 'if(!p)return[];return Array.prototype.slice.call(p.querySelectorAll("tbody tr"));}';
  h += 'function filtered(){var q=state.q.toLowerCase();return rows().filter(function(r){';
  h += 'return !q||r.textContent.toLowerCase().indexOf(q)>-1;});}';
  h += 'function render(){var list=filtered(),total=list.length,pages=Math.max(1,Math.ceil(total/state.per));';
  h += 'if(state.page>pages)state.page=pages;var s=(state.page-1)*state.per;';
  h += 'rows().forEach(function(r){r.style.display="none";});';
  h += 'list.slice(s,s+state.per).forEach(function(r){r.style.display="";});';
  h += 'var info=card.querySelector(".inv-cal-info");';
  h += 'info.textContent=total?("Showing "+(s+1)+" to "+Math.min(s+state.per,total)+" of "+total+" entries"):"Showing 0 entries";';
  h += 'var nums=card.querySelector(".inv-cal-pagenums");nums.innerHTML="";';
  h += 'for(var i=1;i<=pages&&i<=7;i++){var b=document.createElement("button");';
  h += 'b.textContent=i;b.className="inv-cal-pg"+(i===state.page?" cur":"");';
  h += 'b.dataset.pg=i;b.addEventListener("click",function(){state.page=+this.dataset.pg;render();});nums.appendChild(b);}';
  h += 'card.querySelector(".inv-cal-prev").disabled=state.page<=1;';
  h += 'card.querySelector(".inv-cal-next").disabled=state.page>=pages;}';
  h += 'card.querySelectorAll("[data-inv-tab]").forEach(function(t){t.addEventListener("click",function(){';
  h += 'card.querySelectorAll("[data-inv-tab]").forEach(function(x){x.classList.remove("active");x.setAttribute("aria-selected","false");});';
  h += 't.classList.add("active");t.setAttribute("aria-selected","true");';
  h += 'state.tab=t.dataset.invTab;state.page=1;';
  h += 'card.querySelectorAll("[data-inv-panel]").forEach(function(p){p.hidden=p.dataset.invPanel!==state.tab;});';
  h += 'render();});});';
  h += 'var q=card.querySelector(".inv-cal-q");if(q)q.addEventListener("input",function(){state.q=this.value;state.page=1;render();});';
  h += 'var pp=card.querySelector(".inv-cal-perpage");if(pp)pp.addEventListener("change",function(){state.per=+this.value;state.page=1;render();});';
  h += 'card.querySelector(".inv-cal-prev").addEventListener("click",function(){if(state.page>1){state.page--;render();}});';
  h += 'card.querySelector(".inv-cal-next").addEventListener("click",function(){state.page++;render();});';
  /* Dividend status: derived from the Book Close Date against TODAY IN
   * KATHMANDU (Asia/Kathmandu), so every visitor sees the same status.
   * Open while the book close date is today or in the future, Closed once it
   * has passed. Computed here in the browser so the status flips on its own
   * when the date passes — no rebuild needed. Rows with no valid book close
   * date on record show an honest "–" (unknown) — never a guessed status. */
  h += 'card.querySelectorAll("[data-inv-panel=\\"dividends\\"] .inv-cal-divstatus").forEach(function(el){';
  h += 'var bc=el.getAttribute("data-bc")||"";';
  h += 'if(el.getAttribute("data-closed")==="1"){el.innerHTML="<span class=\\"inv-pill inv-pill-closed\\">Closed</span>";return;}';
  h += 'if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(bc)){el.textContent="\\u2013";return;}';
  h += 'var today="";try{today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kathmandu",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}';
  h += 'catch(e){var kd=new Date(Date.now()+20700000);today=kd.getUTCFullYear()+"-"+("0"+(kd.getUTCMonth()+1)).slice(-2)+"-"+("0"+kd.getUTCDate()).slice(-2);}';
  h += 'var closed=bc<today;';
  h += 'el.innerHTML="<span class=\\"inv-pill "+(closed?"inv-pill-closed":"inv-pill-open")+"\\">"+(closed?"Closed":"Open")+"</span>";});';
  h += 'render();});';
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
    '<meta property="og:image" content="https://shirjankhadka.com.np/assets/images/nepse-decode-og.jpg">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/css/nepse-luxury.css?v=20260930c">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave7.css?v=20261002c">\n' +
    '<link rel="stylesheet" href="/css/nepse-brand.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave8.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nd-chrome.css?v=20261004a">\n' +
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
  /* --symbol=XYZ rebuilds a single stock page (used by the dividend watcher
   * to refresh one Investment Calendar the moment a dividend is announced). */
  const onlySym = (process.argv.find((a) => a.startsWith('--symbol=')) || '').slice(9).toUpperCase();
  const universe = loadJson(path.join(DATA, 'universe.json'), null);
  const ver = loadJson(path.join(DATA, 'verdicts.json'), null);
  const news = loadJson(path.join(DATA, 'news.json'), null);
  const fund = loadJson(path.join(DATA, 'fundamentals.json'), null);
  const quarterly = loadJson(path.join(DATA, 'quarterly.json'), null);
  const corpHistData = loadJson(path.join(DATA, 'corp-history.json'), null);
  const corpHist = (corpHistData && corpHistData.companies) || {};
  /* Second dividend source: yonepse open API (tools/fetch-yonepse-dividends.js
   * -> div-history-yonepse.json). Union with the crawl's dividends, deduped by
   * (fiscal year, bonus %, cash %); crawl rows win ties (richer fields).
   * (2026-09-30: his call — never depend on a single source.) */
  const ynData = loadJson(path.join(DATA, 'div-history-yonepse.json'), null);
  const ynDivs = (ynData && ynData.companies) || {};
  const divKey = (d) => {
    const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    return String(d.year || d.fiscal_year || '').trim() + '|' + n(d.bonus_share) + '|' + n(d.cash_dividend);
  };
  for (const sym of Object.keys(ynDivs)) {
    const seen = new Set(), merged = [];
    for (const d of (((corpHist[sym] || {}).dividends) || [])) {
      const k = divKey(d);
      if (!seen.has(k)) { seen.add(k); merged.push(d); }
    }
    for (const d of (ynDivs[sym] || [])) {
      const k = divKey(d);
      if (!seen.has(k)) { seen.add(k); merged.push(d); }
    }
    merged.sort((a, b) =>
      String(b.year || b.fiscal_year || '').localeCompare(String(a.year || a.fiscal_year || '')) ||
      String(b.announcement_date || '').localeCompare(String(a.announcement_date || '')));
    if (!corpHist[sym]) corpHist[sym] = {};
    corpHist[sym].dividends = merged;
  }
  /* Third dividend source: div-live.json — verified dividend announcements
   * recorded by the dividend watcher the moment they publish
   * (tools/record-live-dividend.js). On key collisions the richest record
   * (most filled fields) wins, so a live record carrying a fresh book close
   * date upgrades a sparser historical row. (2026-09-30: his order — the
   * Investment Calendar must update automatically on every new dividend.) */
  const divLiveData = loadJson(path.join(DATA, 'div-live.json'), null);
  const divLive = (divLiveData && divLiveData.companies) || {};
  const divRich = (d) => ['bonus_share', 'cash_dividend', 'total_dividend',
    'announcement_date', 'bookclose_date', 'year', 'fiscal_year'].reduce(
    (n, k) => n + (d[k] !== undefined && d[k] !== null && String(d[k]).trim() !== '' ? 1 : 0), 0);
  const divSort = (a, b) =>
    String(b.year || b.fiscal_year || '').localeCompare(String(a.year || a.fiscal_year || '')) ||
    String(b.announcement_date || '').localeCompare(String(a.announcement_date || ''));
  for (const sym of Object.keys(divLive)) {
    if (!corpHist[sym]) corpHist[sym] = {};
    const byKey = new Map();
    for (const d of (corpHist[sym].dividends || [])) byKey.set(divKey(d), d);
    for (const d of (divLive[sym] || [])) {
      const k = divKey(d), ex = byKey.get(k);
      if (!ex || divRich(d) > divRich(ex)) byKey.set(k, d);
    }
    corpHist[sym].dividends = [...byKey.values()].sort(divSort);
  }
  const actionsData = loadJson(path.join(DATA, 'corporate-actions.json'), null);
  const actionsBySym = {};
  if (actionsData && actionsData.items) {
    for (const a of actionsData.items) {
      if (!a.symbol) continue;
      (actionsBySym[a.symbol] = actionsBySym[a.symbol] || []).push(a);
    }
  }
  // Canonical live quotes (NEPSE API) for the headline price snapshot.
  const live = loadJson(path.join(DATA, 'live.json'), null);
  const liveMap = {};
  let liveDate = '';
  if (live && Array.isArray(live.quotes)) {
    for (const q of live.quotes) { if (q && q.symbol) liveMap[q.symbol] = q; }
    liveDate = String(live.session_date || live.asof || '').slice(0, 10);
  }
  const pageAsof = (liveDate && liveDate >= String((ver && ver.asof) || '')) ? liveDate : ((ver && ver.asof) || '');
  if (!universe || !universe.symbols || !ver || !ver.verdicts) {
    console.error('build-symbol-pages: missing universe/verdicts data');
    process.exit(1);
  }
  const symbols = onlySym
    ? universe.symbols.filter((u) => String(u.s).toUpperCase() === onlySym)
    : universe.symbols;
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
    fs.writeFileSync(path.join(dir, 'index.html'), symbolPage(u, v, newsBySym[sym] || [], fund, liveMap[sym], liveDate, sector, sectorPeers, verdicts, quarterly, corpHist[sym]));
    made++;
  }
  if (!onlySym) fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(symbols, pageAsof));
  console.log(JSON.stringify({ pages: made, dir: 'stocks/', symbol: onlySym || undefined }));
}

main();
