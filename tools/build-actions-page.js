#!/usr/bin/env node
/* Nepse Decode — corporate-actions page builder (generator-only page).
 *
 * Bakes nepse-actions/index.html from the published pipeline files:
 *   nepse-chart/data/corporate-actions.json (the notice archive)
 *   nepse-chart/data/div-live.json        (dividend figures + book-closes)
 *   nepse-chart/data/verdicts.json        (sector for every symbol)
 *   nepse-chart/data/universe.json        (company names)
 *   stocks/                                (stock-page set, ground truth
 *     for symbol chips: 428 pages, incl. debenture/preference lines
 *     and dash spellings of slash series — NOT the 412-symbol universe)
 *
 * NEVER hand-edit nepse-actions/index.html: this builder is the page's
 * sole source of truth, and the next rebuild erases hand edits. The live
 * layer (js/nepse-actions.js) mirrors the renderers below — card HTML,
 * figure strips, status logic and the sector directory must stay in
 * sync between this file and that one.
 *
 * Stamps are raw-content SHA-1 first-8 of each asset file, recomputed
 * on every build (design master §9.1). The shared chain carries the
 * nav fix (nd-chrome.css 69b323cf at build time, recomputed here).
 *
 * Status is baked at build time AND recomputed at view time by the
 * client: Open until the book-close passes, then Closed. The baked
 * book-close resolves from the item itself first, then from the
 * matched div-live record (same nearest-announcement matcher as the
 * figure strips), so dividends whose book-close lives only in div-live
 * (VLUCL, MEN, BARUN) still flip on their own.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CA = path.join(ROOT, 'nepse-chart', 'data', 'corporate-actions.json');
const DIV = path.join(ROOT, 'nepse-chart', 'data', 'div-live.json');
const VERDICTS = path.join(ROOT, 'nepse-chart', 'data', 'verdicts.json');
const UNI = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
const STOCKS_DIR = path.join(ROOT, 'stocks');
const OUT = path.join(ROOT, 'nepse-actions', 'index.html');

const TITLE = 'NEPSE Corporate Actions: Dividends, Rights, Promoter Sales | Nepse Decode';
const DESC = 'Verified NEPSE corporate actions — dividend (incl. bonus), right share, promoter-share sale, lock-in and auction notices — each linked to its official NEPSE disclosure PDF. Free, educational, updated from official NEPSE disclosures.';
const CANON = 'https://shirjankhadka.com.np/nepse-actions/';
const PAGE = 6, SECTOR_PAGE = 25;

const KIND_LABEL = {
  'dividend': 'Dividend', 'bonus-share': 'Dividend',
  'right-share': 'Right share', 'promoter-share': 'Promoter share',
  'auction': 'Auction', 'lock-in': 'Lock-in',
  'meeting': 'Meeting', 'book-close': 'Book close'
};
const normKind = (k) => (k === 'bonus-share' ? 'dividend' : (k || ''));
const kindLabel = (k) => KIND_LABEL[k] || (k ? k.replace(/-/g, ' ') : 'Notice');

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}
function stamp(rel) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) throw new Error('missing asset for stamp: ' + rel);
  return sha1(f);
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1] : String(iso || '');
}
function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] : String(iso || '');
}
function daysBetween(a, b) {
  return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

function main() {
  const ca = JSON.parse(fs.readFileSync(CA, 'utf8'));
  const div = JSON.parse(fs.readFileSync(DIV, 'utf8'));
  const verdictsDoc = JSON.parse(fs.readFileSync(VERDICTS, 'utf8'));
  const uni = JSON.parse(fs.readFileSync(UNI, 'utf8'));
  const items = (ca.items || []).slice().sort((a, b) => String(b.announced || '').localeCompare(String(a.announced || '')));
  const verdicts = verdictsDoc.verdicts || verdictsDoc;
  const names = {};
  (uni.symbols || []).forEach((u) => { names[u.s] = u.n; });
  const stockPages = new Set(fs.readdirSync(STOCKS_DIR).filter((d) => {
    try { return fs.statSync(path.join(STOCKS_DIR, d)).isDirectory(); } catch { return false; }
  }));

  /* Dividend-calendar join: nearest announcement_date within 60 days. */
  function divMatch(it) {
    if (!div.companies || !it.symbol || !div.companies[it.symbol]) return null;
    let best = null, bestD = 9999;
    for (const r of div.companies[it.symbol]) {
      if (!r.announcement_date || !it.announced) continue;
      const d = Math.abs(daysBetween(r.announcement_date, it.announced));
      if (d < bestD) { best = r; bestD = d; }
    }
    return bestD <= 60 ? best : null;
  }
  function divBookclose(it) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(it.bookclose_date || ''));
    if (m) return m[1];
    const rec = divMatch(it);
    if (rec) { const m2 = /^(\d{4}-\d{2}-\d{2})/.exec(String(rec.bookclose_date || '')); if (m2) return m2[1]; }
    return '';
  }
  /* Baked status uses the BUILD date as "today"; the client recomputes
     at view time, so a stale baked pill self-corrects on first refresh. */
  // Calendar "today" is NPT, uniform with the verifier and the ledger:
  // market dates (book closes, sessions) are NPT dates. UTC was a day
  // behind during 00:00-05:45 NPT (2026-10-27: baker UTC vs verifier NPT).
  const buildToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  function statusAt(it, today) {
    const k = String(it.kind || '');
    if (k !== 'dividend' && k !== 'bonus-share' && k !== 'right-share') return null;
    const bc = divBookclose(it);
    if (/^\d{4}-\d{2}-\d{2}$/.test(bc)) return bc < today ? 'Closed' : 'Open';
    const ann = /^(\d{4}-\d{2}-\d{2})/.exec(String(it.announced || ''));
    if (ann) { const days = daysBetween(ann[1], today); if (days >= 0 && days <= 365) return 'Open'; }
    return null;
  }
  function symChip(sym) {
    if (!sym) return '';
    return stockPages.has(sym)
      ? '<a class="na-sym" href="/stocks/' + esc(sym) + '/">' + esc(sym) + '</a>'
      : '<span class="na-sym na-sym--nolink">' + esc(sym) + '</span>';
  }
  /* Hero figure strip, dividend cards only (old builder's kind gate),
     skipped when the card already carries figures (facts block or a %
     in the headline) so verified numbers never double-render. Chips
     render only for values > 0, numbers trimmed, number-first format —
     exactly the old builder's strip, so baked cards are unchanged. */
  function trimNum(v) {
    const s = String(v);
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }
  function figuresHTML(it) {
    if (normKind(it.kind) !== 'dividend') return '';
    if (!div.companies) return '';
    if (it.facts && typeof it.facts === 'object' && Object.keys(it.facts).length) return '';
    if (/%/.test(String(it.headline || ''))) return '';
    const rec = divMatch(it);
    if (!rec) return '';
    const chips = [];
    const chip = (label, val, total) => {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) return;
      chips.push('<span class="na-fig' + (total ? ' na-fig-total' : '') + '" title="Figures as recorded in the verified investment calendar"><b>' + esc(trimNum(val)) + '%</b>&nbsp;' + esc(label) + '</span>');
    };
    chip('bonus', rec.bonus_share, false);
    chip('cash', rec.cash_dividend, false);
    chip('total', Number(rec.total_dividend) || (Number(rec.bonus_share) || 0) + (Number(rec.cash_dividend) || 0), true);
    return chips.length ? '<div class="na-figs">' + chips.join('') + '</div>' : '';
  }
  function cardHTML(it) {
    const kk = normKind(it.kind), kind = kindLabel(kk), dot = ' <span class="na-dot">·</span> ';
    const st = statusAt(it, buildToday);
    const status = st
      ? '<span class="na-status ' + (st === 'Open' ? 'is-open' : 'is-closed') +
        '" data-bc="' + esc(divBookclose(it)) + '" data-ann="' + esc(String(it.announced || '').slice(0, 10)) + '">' + st + '</span>'
      : '';
    let facts = '';
    if (it.facts && typeof it.facts === 'object') {
      const rows = [];
      for (const k of Object.keys(it.facts)) {
        const v = it.facts[k];
        if (v === null || v === undefined || v === '') continue;
        const val = (typeof v === 'number' && v >= 1000) ? v.toLocaleString('en-US') : String(v);
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
        rows.push('<div class="na-fact"><dt>' + esc(label) + '</dt><dd>' + esc(val) + '</dd></div>');
      }
      if (rows.length) facts = '<dl class="na-facts">' + rows.join('') + '</dl>';
    }
    return '<article class="na-card" data-kind="' + esc(kk) + '" data-sym="' + esc(String(it.symbol || '').toLowerCase()) + '" data-year="' + esc(String(it.announced || '').slice(0, 4)) + '">' +
      '<div class="na-top"><span class="na-kind k-' + esc(kk) + '">' + esc(kind) + '</span>' +
      symChip(it.symbol) + status + '</div>' +
      '<h3 class="na-head">' + esc(it.headline) + '</h3>' + figuresHTML(it) + facts +
      '<p class="na-meta">' + (it.company ? esc(it.company) + dot : '') +
      (it.announced ? 'Announced ' + fmtDate(it.announced) + dot : '') +
      (it.officialPdf ? '<a href="' + esc(it.officialPdf) + '" rel="noopener" target="_blank">Official NEPSE PDF ↗</a>' : '') + '</p></article>';
  }

  /* ---- baked feed (full archive, like the old builder) + pager ----
     The client paginates to page 1 on load, exactly as before; the
     full bake keeps the no-JS view and the search index complete. */
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const pageItems = items.slice(0, PAGE);
  const years = {};
  items.forEach((it) => {
    const y = String(it.announced || '').slice(0, 4) || '';
    (years[y] = years[y] || []).push(it);
  });
  let feedHTML = '';
  Object.keys(years).sort().reverse().forEach((y) => {
    if (y) feedHTML += '<h2 class="na-year">' + esc(y) + '</h2>';
    feedHTML += '<div class="na-feed">' + years[y].map(cardHTML).join('') + '</div>';
  });
  const pagerInfo = 'Showing 1–' + pageItems.length + ' of ' + items.length + (pages > 1 ? ' · page 1 of ' + pages : '');

  /* ---- baked session strip ---- */
  const sessCounts = {};
  items.forEach((it) => {
    const d = String(it.announced || '').slice(0, 10);
    if (d) sessCounts[d] = (sessCounts[d] || 0) + 1;
  });
  const sessDates = Object.keys(sessCounts).sort().reverse();
  const sessionHTML = '<button type="button" class="na-session is-active" data-session="all" aria-pressed="true">All · ' + items.length + '</button>' +
    sessDates.map((d) => '<button type="button" class="na-session" data-session="' + esc(d) + '" aria-pressed="false">' +
      fmtShort(d) + ' · ' + sessCounts[d] + '</button>').join('');

  /* ---- baked viz: kind mix, open/closed, upcoming closes ---- */
  const kc = {};
  items.forEach((it) => { const k = normKind(it.kind); kc[k] = (kc[k] || 0) + 1; });
  const kindOrder = ['dividend', 'promoter-share', 'right-share', 'auction', 'lock-in', 'meeting', 'book-close'];
  const kinds = kindOrder.filter((k) => kc[k]);
  Object.keys(kc).forEach((k) => { if (!kinds.includes(k)) kinds.push(k); });
  const mixBar = '<div class="na-mix-bar" role="img" aria-label="Notice mix: ' +
    kinds.map((k) => kindLabel(k) + ' ' + kc[k]).join(', ') + '">' +
    kinds.map((k) => '<span class="na-mix-seg k-' + esc(k) + '" style="width:' + (kc[k] / items.length * 100).toFixed(1) + '%"></span>').join('') + '</div>';
  const mixLegend = '<div class="na-mix-legend">' + kinds.map((k) =>
    '<span class="na-mix-item"><i class="na-mix-dot k-' + esc(k) + '"></i>' + esc(kindLabel(k)) + ' <b>' + kc[k] + '</b></span>').join('') + '</div>';
  let open = 0, closed = 0, nostatus = 0;
  items.forEach((it) => {
    const st = statusAt(it, buildToday);
    if (st === 'Open') open++;
    else if (st === 'Closed') closed++;
    else nostatus++;
  });
  const statusBar = open
    ? '<div class="na-mix-bar" role="img" aria-label="Open ' + open + ', Closed ' + closed + '">' +
      '<span class="na-mix-seg k-open" style="width:' + (open / (open + closed || 1) * 100).toFixed(1) + '%"></span></div>' : '';
  const up = [];
  items.forEach((it) => {
    /* Dividend/right items only: a promoter notice must never inherit
       its symbol's dividend book-close (VLUCL has both kinds). */
    const k = String(it.kind || '');
    if (k !== 'dividend' && k !== 'bonus-share' && k !== 'right-share') return;
    const bc = divBookclose(it);
    if (bc && bc >= buildToday) up.push({ it, bc });
  });
  up.sort((a, b) => (a.bc < b.bc ? -1 : (a.bc > b.bc ? 1 : 0)));
  const closesHTML = up.length
    ? '<ul class="na-closes">' + up.map((u) => {
        const d = daysBetween(buildToday, u.bc);
        const rel = d === 0 ? 'today' : (d === 1 ? 'tomorrow' : 'in ' + d + ' days');
        return '<li>' + symChip(u.it.symbol) + '<span class="na-close-kind">' + esc(kindLabel(normKind(u.it.kind))) + '</span>' +
          '<span class="na-close-date">' + fmtDate(u.bc) + '</span><span class="na-close-rel">' + rel + '</span></li>';
      }).join('') + '</ul>'
    : '<p class="na-viz-note">No upcoming book-closes in the archive.</p>';
  const vizHTML =
    '<section class="na-viz" aria-label="Archive overview">' +
    '<div class="na-viz-panel"><h2 class="na-viz-head">Notice mix</h2>' + mixBar + mixLegend + '</div>' +
    '<div class="na-viz-panel"><h2 class="na-viz-head">Dividend &amp; rights status</h2>' +
    '<div class="na-statline"><span><b>' + open + '</b> Open</span><span><b>' + closed + '</b> Closed</span></div>' +
    statusBar + '<p class="na-viz-note">' + nostatus + ' promoter / lock-in notices carry no book-close date and show no status.</p></div>' +
    '<div class="na-viz-panel"><h2 class="na-viz-head">Upcoming book-closes</h2>' + closesHTML + '</div></section>';

  /* ---- baked sector directory (All sectors, first page) ---- */
  const secOf = {};
  Object.keys(verdicts).forEach((s) => { secOf[s] = verdicts[s].sec || 'Others'; });
  const secCounts = {};
  Object.keys(secOf).forEach((s) => { secCounts[secOf[s]] = (secCounts[secOf[s]] || 0) + 1; });
  const sectors = Object.keys(secCounts).sort((a, b) => secCounts[b] - secCounts[a]);
  const secTotal = Object.keys(secOf).length;
  const acts = {};
  items.forEach((it) => { if (it.symbol) acts[it.symbol] = (acts[it.symbol] || 0) + 1; });
  const allSyms = Object.keys(secOf).sort();
  const secPages = Math.max(1, Math.ceil(allSyms.length / SECTOR_PAGE));
  const secRows = allSyms.slice(0, SECTOR_PAGE).map((s) => {
    const mark = acts[s] ? '<span class="na-sec-mark" title="' + acts[s] + ' archive notice(s)">● ' + acts[s] + '</span>' : '';
    return '<tr><td><a class="na-sym" href="/stocks/' + esc(s) + '/">' + esc(s) + '</a> ' + mark + '</td>' +
      '<td>' + esc(names[s] || '') + '</td><td>' + esc(secOf[s]) + '</td></tr>';
  }).join('');
  const secInfo = 'Showing 1–' + Math.min(SECTOR_PAGE, allSyms.length) + ' of ' + allSyms.length + (secPages > 1 ? ' · page 1 of ' + secPages : '');
  const secSelect = '<option value="all">All sectors (' + secTotal + ')</option>' +
    sectors.map((s) => '<option value="' + esc(s) + '">' + esc(s) + ' (' + secCounts[s] + ')</option>').join('');

  /* ---- stamps (raw-content SHA-1 first-8, recomputed per build) ---- */
  const st = {
    editorial: stamp('css/nd-editorial-theme.css'),
    cinema: stamp('css/nd-cinema.css'),
    chrome: stamp('css/nd-chrome.css'),
    actions: stamp('css/nd-actions.css'),
    actionsJs: stamp('js/nepse-actions.js'),
    themeToggle: stamp('js/theme-toggle.js'),
    marketConfig: stamp('js/nepse-market-config.js'),
    freshness: stamp('js/freshness-badge.js'),
    sidebar: stamp('js/nepse-sidebar.js'),
    chromeJs: stamp('js/nd-chrome.js')
  };

  const updated = String(ca.updated || '').slice(0, 10);
  const html =
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(TITLE) + '</title>\n' +
    '<meta name="description" content="' + esc(DESC) + '">\n' +
    '<meta name="author" content="Shirjan Khadka">\n' +
    '<link rel="canonical" href="' + CANON + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#0A0C10">\n' +
    '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Nepse Decode">\n' +
    '<meta property="og:title" content="' + esc(TITLE) + '">\n' +
    '<meta property="og:description" content="' + esc(DESC) + '">\n' +
    '<meta property="og:url" content="' + CANON + '">\n' +
    '<meta property="og:image" content="https://shirjankhadka.com.np/assets/images/og/decode.png">\n' +
    '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(TITLE) + '">\n' +
    '<meta name="twitter:description" content="' + esc(DESC) + '">\n' +
    '<meta name="twitter:image" content="https://shirjankhadka.com.np/assets/images/og/decode.png">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'CollectionPage', name: TITLE, url: CANON, description: DESC }] }) + '</script>\n' +
    '<link rel="stylesheet" href="/css/nd-tokens.css">\n' +
    '<link rel="stylesheet" href="/css/fonts.css">\n' +
    '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=' + st.editorial + '">\n' +
    '<link rel="stylesheet" href="/css/nd-cinema.css?v=' + st.cinema + '">\n' +
    '<link rel="stylesheet" href="/css/nd-chrome.css?v=' + st.chrome + '">\n' +
    '<link rel="stylesheet" href="/css/nd-actions.css?v=' + st.actions + '">\n' +
    '<script>(function(){try{var t=localStorage.getItem("sk-theme");if(!t){t="dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();</script>\n' +
    '</head>\n<body class="nd" data-page="actions">\n' +
    '<a class="skip-link" href="#na-feed">Skip to notices</a>\n' +
    '<div id="nd-header"></div>\n' +
    '<main class="na-wrap" id="main">\n' +
    '<header class="na-masthead">\n' +
    '<p class="na-kicker">NEPSE CORPORATE ACTIONS</p>\n' +
    '<h1>Corporate actions, verified</h1>\n' +
    '<p class="na-lede">Every dividend (including bonus), right share, promoter-share sale, lock-in and auction notice we have verified against an official NEPSE disclosure — with the figures, the book-close status, and the PDF itself. Statuses flip on their own when a book-close passes; nothing here waits for a rebuild.</p>\n' +
    '<p class="na-fresh-line" id="na-fresh-line">Archive updated ' + fmtDate(updated) + ' · ' + items.length + ' verified notices</p>\n' +
    '<p class="na-new-note" id="na-new-note" style="display:none"></p>\n' +
    '</header>\n' +
    '<nav class="na-session-strip" id="na-session-strip" aria-label="Filter by announcement session">' + sessionHTML + '</nav>\n' +
    vizHTML + '\n' +
    '<div class="na-filters">\n' +
    '<input class="na-search" id="na-q" type="search" placeholder="Search by symbol" aria-label="Search by symbol">\n' +
    '<span class="na-count" id="na-count" aria-live="polite">' + items.length + ' of ' + items.length + ' notices</span>\n' +
    '</div>\n' +
    '<div class="na-pills" id="naPills" role="group" aria-label="Filter by notice kind">\n' +
    '<button class="na-pill" data-kind="" aria-pressed="true">All</button>\n' +
    '<button class="na-pill" data-kind="dividend" aria-pressed="false">Dividend</button>\n' +
    '<button class="na-pill" data-kind="right-share" aria-pressed="false">Right share</button>\n' +
    '<button class="na-pill" data-kind="promoter-share" aria-pressed="false">Promoter share</button>\n' +
    '</div>\n' +
    '<div id="na-feed" aria-live="polite">' + feedHTML + '</div>\n' +
    '<div class="na-pager" id="na-pager"' + (pages > 1 ? '' : ' style="display:none"') + '>\n' +
    '<button class="na-page-btn" id="na-prev" type="button">← Newer</button>\n' +
    '<button class="na-page-btn is-next" id="na-next" type="button">Older →</button>\n' +
    '<span class="na-page-info" id="na-page-info" aria-live="polite">' + pagerInfo + '</span>\n</div>\n' +
    '<section class="na-sector" aria-label="Browse stocks by sector">\n' +
    '<h2 class="na-sector-head">Browse by sector</h2>\n' +
    '<p class="na-sector-sub">Every listed stock, grouped by sector. A lime mark shows symbols with notices in this archive — click a symbol for its stock page.</p>\n' +
    '<div class="na-sector-controls"><select class="na-select" id="na-sector-select" aria-label="Choose sector">' + secSelect + '</select>\n' +
    '<span class="na-sector-note" id="na-sector-note" style="display:none"></span></div>\n' +
    '<table class="na-sec-table"><thead><tr><th>Symbol</th><th>Company</th><th>Sector</th></tr></thead>' +
    '<tbody id="na-sector-body">' + secRows + '</tbody></table>\n' +
    '<div class="na-pager" id="na-sector-pager"' + (secPages > 1 ? '' : ' style="display:none"') + '>\n' +
    '<button class="na-page-btn" id="na-sector-prev" type="button">← Prev</button>\n' +
    '<button class="na-page-btn is-next" id="na-sector-next" type="button">Next →</button>\n' +
    '<span class="na-page-info" id="na-sector-info">' + secInfo + '</span>\n</div>\n</section>\n' +
    '<p class="na-disc">For education only. Not investment advice. Notices are captured from official NEPSE disclosures; always confirm dates, ratios and book closures against the official NEPSE disclosure archive before acting.</p>\n' +
    '</main>\n<div id="nd-footer"></div>\n' +
    '<script src="/js/theme-toggle.js?v=' + st.themeToggle + '" defer></script>\n' +
    '<script src="/js/nepse-market-config.js?v=' + st.marketConfig + '" defer></script>\n' +
    '<script src="/js/freshness-badge.js?v=' + st.freshness + '" defer></script>\n' +
    '<script src="/js/nepse-sidebar.js?v=' + st.sidebar + '" defer></script>\n' +
    '<script src="/js/nd-chrome.js?v=' + st.chromeJs + '" defer></script>\n' +
    '<script src="/js/nepse-actions.js?v=' + st.actionsJs + '" defer></script>\n' +
    '</body>\n</html>\n';

  fs.writeFileSync(OUT, html);
  console.log(JSON.stringify({
    page: 'nepse-actions/index.html', bytes: html.length, items: items.length, pages,
    sessions: sessDates.length, sectors: sectors.length, sectorTotal: secTotal,
    open, closed, nostatus, upcomingCloses: up.map((u) => u.it.symbol + ':' + u.bc),
    stamps: st
  }, null, 2));
}

main();
