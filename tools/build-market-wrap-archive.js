#!/usr/bin/env node
/**
 * build-market-wrap-archive.js — Nepse Decode daily Market Wrap archive.
 *
 * Records one wrap entry per trading session (deduped on session_date) into
 * nepse-chart/data/wrap-archive.json and rebuilds the static, paginated
 * archive pages under nepse-decode/wrap/ (10 entries per page):
 *
 *   /nepse-decode/wrap/            (latest entries)
 *   /nepse-decode/wrap/page/2/ ... (older entries)
 *
 * Also refreshes a WRAP-ARCHIVE block in sitemap.xml with the archive URLs.
 *
 * Editorial logic mirrors js/nd-home.js renderWrap(): direction word,
 * magnitude words (sharply/firmly/moderately), sector leaders/laggards,
 * advance/decline breadth, day range — all from REAL session data, never
 * invented. Sessions where only index OHLC survives (index-history) get an
 * index-only entry with no sector/breadth claims (those fields stay null).
 *
 * Session-date rule: live.session_date is the authoritative trading-day
 * stamp. data_asof is a fetch timestamp and is NEVER used as the session.
 *
 * Idempotent: if the current session is already recorded, prints
 * "already current" and exits 0 without touching pages or the sitemap.
 * Pass --force to rebuild pages/sitemap regardless.
 *
 * Usage: node tools/build-market-wrap-archive.js [--force]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
const ARCH = path.join(ROOT, 'nepse-chart', 'data', 'wrap-archive.json');
const IDX_HIST = path.join(ROOT, 'data', 'index-history.json');
const SM = path.join(ROOT, 'sitemap.xml');
const WRAP_DIR = path.join(ROOT, 'nepse-decode', 'wrap');
const SITE = 'https://shirjankhadka.com.np';
const PER_PAGE = 10;
const FORCE = process.argv.includes('--force');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const fmt = (v, dp) => (v == null || !isFinite(Number(v)))
  ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; } };

function sessLabel(sessDate) { // "Fri, 9 Oct 2026"
  const d = new Date(sessDate + 'T12:00:00+05:45');
  return isFinite(d.getTime())
    ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' })
    : sessDate;
}
function weekdayLong(sessDate) {
  const d = new Date(sessDate + 'T12:00:00+05:45');
  return isFinite(d.getTime())
    ? d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Kathmandu' })
    : '';
}

/* ---------- entry builders ---------- */

// Full entry from a close-state live.json (index + indices + quotes).
function entryFromLive(live) {
  const ix = live.index || {};
  const sessDate = live.session_date;
  const chg = Number(ix.change) || 0;
  const pct = Number(ix.percent_change) || 0;
  const dir = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
  const mag = Math.abs(pct);
  const magWord = mag >= 2 ? 'sharply' : mag >= 1 ? 'firmly' : mag >= 0.5 ? 'moderately' : '';

  const sectors = (live.indices || []).filter((x) =>
    x.name !== 'NEPSE' && x.name !== 'Sensitive' && x.name !== 'Float' && x.name !== 'Sensitive Float');
  sectors.sort((a, b) => (b.percent_change || 0) - (a.percent_change || 0));
  const leaders = sectors.slice(0, 2).map((x) => ({ name: x.name, pct: Number(x.percent_change || 0) }));
  const laggards = sectors.slice(-2).map((x) => ({ name: x.name, pct: Number(x.percent_change || 0) }));

  let adv = 0, dec = 0;
  (live.quotes || []).forEach((q) => {
    const pc = Number(q.percent_change);
    if (pc > 0) adv++; else if (pc < 0) dec++;
  });

  const leadNames = leaders.map((l) => l.name).join(' and ');
  const lagNames = laggards.map((l) => l.name).join(' and ');
  let headline = 'NEPSE closes ' + dir;
  if (magWord) headline += ' ' + magWord;
  headline += ' at ' + fmt(ix.value);
  if (chg > 0 && leadNames) headline += ' as ' + leadNames.toLowerCase() + ' lead';
  else if (chg < 0 && lagNames) headline += ' as ' + lagNames.toLowerCase() + ' drag';

  const breadthTxt = adv > dec ? 'advancers outnumbered decliners'
    : dec > adv ? 'decliners outnumbered advancers' : 'advancers and decliners were evenly split';

  let body1 = 'The NEPSE index closed at ' + fmt(ix.value) + ' (' +
    (chg > 0 ? '+' : '') + fmt(chg) + ' points, ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%). ';
  if (chg > 0) {
    body1 += 'Bulls were in control as ' + breadthTxt + ' (' + adv + ' vs ' + dec + '). ';
    if (leadNames) body1 += 'Strength came from ' + leaders.map((l) => l.name).join(' and ') +
      ' shares' + (leaders[0].pct ? ' (up ' + leaders[0].pct.toFixed(2) + '%)' : '') + '. ';
  } else if (chg < 0) {
    body1 += 'Bears dominated as ' + breadthTxt + ' (' + dec + ' vs ' + adv + '). ';
    if (lagNames) body1 += 'Weakness was concentrated in ' + lagNames +
      (laggards[laggards.length - 1].pct ? ' (down ' + Math.abs(laggards[laggards.length - 1].pct).toFixed(2) + '%)' : '') + '. ';
    if (leaders.length && leaders[0].pct > 0)
      body1 += leaders[0].name + ' declined the least (+' + leaders[0].pct.toFixed(2) + '%). ';
  } else {
    body1 += 'The market ended flat as ' + breadthTxt + '. ';
  }
  body1 += 'Day range: ' + fmt(ix.low) + ' – ' + fmt(ix.high) + '.';

  const body2 = 'All figures above are the official session close. ' +
    'Quotes refresh during market hours; outside hours the last close is shown.';

  return {
    session_date: sessDate,
    market: live.market || 'CLOSED',
    index: {
      value: Number(ix.value), open: null,
      change: Number(ix.change), pct: Number(ix.percent_change),
      high: ix.high == null ? null : Number(ix.high),
      low: ix.low == null ? null : Number(ix.low),
    },
    breadth: { adv, dec },
    sectors: { leaders, laggards },
    headline, body: [body1, body2],
    source: 'live-close',
    generated_at: new Date().toISOString(),
  };
}

// Index-only entry from data/index-history.json rows: [date, open, close, ...].
// Open/close pairing verified (each day's open == previous day's close); the
// remaining columns' meaning is not established, so high/low stay null.
function entryFromIndexRow(row) {
  const ymd = String(row[0]);
  const sessDate = ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
  const open = Number(row[1]), close = Number(row[2]);
  const chg = close - open;
  const pct = open ? (chg / open) * 100 : 0;
  const dir = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
  const mag = Math.abs(pct);
  const magWord = mag >= 2 ? 'sharply' : mag >= 1 ? 'firmly' : mag >= 0.5 ? 'moderately' : '';
  const headline = 'NEPSE closes ' + dir + (magWord ? ' ' + magWord : '') + ' at ' + fmt(close);
  const body1 = 'The NEPSE index closed at ' + fmt(close) + ' (' +
    (chg > 0 ? '+' : '') + fmt(chg) + ' points, ' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%).';
  const body2 = 'Archived index record for this session. Sector and breadth ' +
    'detail is only published for sessions recorded live.';
  return {
    session_date: sessDate,
    market: 'CLOSED',
    index: { value: close, open, change: Number(chg.toFixed(2)), pct: Number(pct.toFixed(2)), high: null, low: null },
    breadth: { adv: null, dec: null },
    sectors: { leaders: [], laggards: [] },
    headline, body: [body1, body2],
    source: 'index-history',
    generated_at: new Date().toISOString(),
  };
}

/* ---------- archive page rendering ---------- */

const COMMON_HEAD = (title, desc, canonical) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0A0C10">
<meta name="robots" content="index, follow, max-image-preview:large">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="keywords" content="NEPSE market wrap, NEPSE daily wrap, Nepal stock market wrap, NEPSE close summary, NEPSE index close, NEPSE breadth, NEPSE sector leaders">
<meta name="author" content="Nepse Decode">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nepse Decode">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/assets/images/og/decode.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}/assets/images/og/decode.png">
<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/nepse-design-system.css?v=c967c332">
<link rel="stylesheet" href="/css/theme.css?v=20261002d">
<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261009b">
<link rel="stylesheet" href="/css/nd-chrome.css?v=20261009f">
<style>
.wrap-arc{max-width:860px;margin:0 auto;padding:28px 20px 64px}
.wrap-arc .kicker{font:600 .72rem/1.4 var(--nd-font-mono,ui-monospace,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--nd-lime,#B8E62E);margin-bottom:10px}
.wrap-arc h1{font-family:var(--nd-font-display,Georgia,serif);font-weight:700;font-size:clamp(1.9rem,3.6vw,2.9rem);line-height:1.12;letter-spacing:-.02em;color:var(--nd-text,#fff);margin:0 0 10px}
.wrap-arc .lede{color:var(--nd-muted,#B8C0CE);font-size:1.02rem;line-height:1.7;margin:0 0 30px;max-width:64ch}
.wa-entry{border:1px solid var(--nd-border,#1E2430);border-radius:16px;background:var(--nd-panel,#12141A);padding:22px 22px 18px;margin:0 0 20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.wa-entry .wa-date{font:600 .7rem/1.4 var(--nd-font-mono,ui-monospace,monospace);letter-spacing:.12em;text-transform:uppercase;color:var(--nd-muted,#B8C0CE);margin-bottom:8px}
.wa-entry h2{font-family:var(--nd-font-display,Georgia,serif);font-weight:700;font-size:clamp(1.25rem,2.4vw,1.7rem);line-height:1.2;letter-spacing:-.01em;margin:0 0 10px;color:var(--nd-text,#fff)}
.wa-entry h2 .dir-up{color:#4ade80}.wa-entry h2 .dir-dn{color:#f87171}
[data-theme="light"] .wa-entry h2 .dir-up{color:#16a34a}[data-theme="light"] .wa-entry h2 .dir-dn{color:#dc2626}
.wa-entry p{color:var(--nd-muted,#B8C0CE);line-height:1.75;margin:0 0 10px}
.wa-entry p strong{color:var(--nd-text,#fff);font-weight:600}
.wa-entry .wa-meta{font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:12px;padding-top:12px;border-top:1px solid var(--nd-border,#1E2430)}
.wa-entry .wa-meta strong{color:var(--nd-text,#fff)}
.wa-pager{display:flex;gap:10px;align-items:center;justify-content:center;margin:34px 0 0;flex-wrap:wrap}
.wa-pager a,.wa-pager span.cur{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-weight:600;font-size:.9rem;background:var(--nd-panel,#12141A)}
.wa-pager a:hover{border-color:var(--nd-lime,#B8E62E)}
.wa-pager span.cur{background:var(--nd-lime,#B8E62E);color:#0A0C10;border-color:var(--nd-lime,#B8E62E)}
.wa-crumb{font-size:.82rem;color:var(--nd-dim,#8E98A8);margin-bottom:16px}
.wa-crumb a{color:var(--nd-lime,#B8E62E);text-decoration:none}
</style>
`;

function headlineHtml(e) {
  const chg = e.index.change || 0;
  const dirCls = chg > 0 ? 'dir-up' : chg < 0 ? 'dir-dn' : '';
  // Split headline on the direction word to color it, matching nd-home.js.
  const dirWord = chg > 0 ? 'higher' : chg < 0 ? 'lower' : 'flat';
  const span = dirCls ? '<span class="' + dirCls + '">' + dirWord + '</span>' : dirWord;
  return esc(e.headline).replace(dirWord, span);
}

function bodyHtml(e) {
  // Body text was generated with numbers already formatted; escape only.
  return e.body.map((p) => '<p>' + esc(p) + '</p>').join('\n');
}

function entryCard(e) {
  const chg = e.index.change || 0;
  const meta = [];
  meta.push('NEPSE ' + fmt(e.index.value));
  if (e.index.open != null) meta.push('open ' + fmt(e.index.open));
  meta.push((chg > 0 ? '+' : '') + fmt(chg) + ' (' + (e.index.pct > 0 ? '+' : '') + Number(e.index.pct).toFixed(2) + '%)');
  if (e.breadth && e.breadth.adv != null) meta.push(e.breadth.adv + ' adv / ' + e.breadth.dec + ' dec');
  return `<article class="wa-entry" itemscope itemtype="https://schema.org/NewsArticle">
  <div class="wa-date">${esc(sessLabel(e.session_date))} · ${esc(weekdayLong(e.session_date))}</div>
  <h2 itemprop="headline">${headlineHtml(e)}</h2>
  <div itemprop="articleBody">
  ${bodyHtml(e)}
  </div>
  <div class="wa-meta"><strong>Nepse Decode Desk</strong> · ${meta.map(esc).join(' · ')} · Source: NEPSE</div>
  <meta itemprop="datePublished" content="${e.session_date}">
  <meta itemprop="author" content="Nepse Decode">
</article>`;
}

function pageLD(entries, pageUrl, pageNum, totalPages) {
  const items = entries.map((e, i) => ({
    '@type': 'ListItem',
    position: (pageNum - 1) * PER_PAGE + i + 1,
    url: pageUrl,
    item: {
      '@type': 'NewsArticle',
      headline: e.headline,
      datePublished: e.session_date,
      author: { '@type': 'Organization', name: 'Nepse Decode' },
      publisher: { '@type': 'Organization', name: 'Nepse Decode' },
    },
  }));
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'NEPSE Market Wrap Archive',
    url: pageUrl,
    description: 'Daily NEPSE market wrap archive — index close, change, sector leaders and market breadth for every trading session.',
    isPartOf: { '@type': 'WebSite', name: 'Nepse Decode', url: SITE + '/' },
    mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items },
  };
  if (totalPages > 1) {
    ld.mainEntity.itemListElement = items;
  }
  return '<script type="application/ld+json">\n' + JSON.stringify(ld, null, 2) + '\n</script>';
}

function breadcrumbLD(pageUrl, pageNum) {
  const trail = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Nepse Decode', item: SITE + '/nepse-decode/' },
    { '@type': 'ListItem', position: 3, name: 'Market Wrap Archive', item: SITE + '/nepse-decode/wrap/' },
  ];
  if (pageNum > 1) trail.push({ '@type': 'ListItem', position: 4, name: 'Page ' + pageNum, item: pageUrl });
  return '<script type="application/ld+json">\n' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail,
  }, null, 2) + '\n</script>';
}

function renderPage(entries, pageNum, totalPages) {
  const isFirst = pageNum === 1;
  const pageUrl = isFirst ? SITE + '/nepse-decode/wrap/' : SITE + '/nepse-decode/wrap/page/' + pageNum + '/';
  const range = entries.length ? (sessLabel(entries[entries.length - 1].session_date) + ' – ' + sessLabel(entries[0].session_date)) : '';
  const title = isFirst
    ? 'NEPSE Market Wrap Archive — Daily Close Summaries | Nepse Decode'
    : 'NEPSE Market Wrap Archive — Page ' + pageNum + ' | Nepse Decode';
  const desc = isFirst
    ? 'Every NEPSE market wrap in one archive: daily index close, change, sector leaders, market breadth and day range — recorded automatically after each trading session. Free, no login.'
    : 'NEPSE market wrap archive, page ' + pageNum + ' (' + range + '): daily index close, change, sector leaders and market breadth. Free, no login.';

  let pager = '<nav class="wa-pager" aria-label="Wrap archive pages">\n';
  if (pageNum > 1) {
    const prev = pageNum === 2 ? '/nepse-decode/wrap/' : '/nepse-decode/wrap/page/' + (pageNum - 1) + '/';
    pager += '  <a href="' + prev + '">← Newer</a>\n';
  }
  for (let p = 1; p <= totalPages; p++) {
    if (p === pageNum) pager += '  <span class="cur" aria-current="page">' + p + '</span>\n';
    else {
      const href = p === 1 ? '/nepse-decode/wrap/' : '/nepse-decode/wrap/page/' + p + '/';
      pager += '  <a href="' + href + '">' + p + '</a>\n';
    }
  }
  if (pageNum < totalPages) pager += '  <a href="/nepse-decode/wrap/page/' + (pageNum + 1) + '/">Older →</a>\n';
  pager += '</nav>';

  const cards = entries.map(entryCard).join('\n');

  return COMMON_HEAD(title, desc, pageUrl) +
    pageLD(entries, pageUrl, pageNum, totalPages) + '\n' +
    breadcrumbLD(pageUrl, pageNum) + '\n' +
    '</head>\n<body class="nd">\n' +
    '<a class="skip-link" href="#main">Skip to content</a>\n' +
    '<div id="nd-header"></div>\n' +
    '<main id="main"><div class="wrap-arc">\n' +
    '<div class="wa-crumb"><a href="/">Home</a> · <a href="/nepse-decode/">Nepse Decode</a> · Market Wrap Archive</div>\n' +
    '<div class="kicker">NEPSE · Daily record</div>\n' +
    '<h1>NEPSE Market Wrap Archive</h1>\n' +
    '<p class="lede">One wrap for every trading session — the index close, how far it moved, ' +
    'which sectors led and lagged, and how breadth split between advancers and decliners. ' +
    'Entries are generated automatically from the official session data right after market close; ' +
    'nothing here is written by hand. Newest first.</p>\n' +
    cards + '\n' + pager + '\n' +
    '</div></main>\n' +
    '<div id="nd-footer"></div>\n' +
    '<script>try{var t=localStorage.getItem(\'sk-theme\');if(!t)t=\'dark\';document.documentElement.setAttribute(\'data-theme\',t);if(t===\'light\')document.documentElement.setAttribute(\'data-nd-ed\',\'light\')}catch(e){}</script>\n' +
    '<script src="/js/nd-chrome.js?v=20261006c" defer></script>\n' +
    '</body>\n</html>\n';
}

function pageFile(pageNum) {
  return pageNum === 1
    ? path.join(WRAP_DIR, 'index.html')
    : path.join(WRAP_DIR, 'page', String(pageNum), 'index.html');
}

/* ---------- sitemap ---------- */

function updateSitemap(totalPages) {
  let xml = fs.readFileSync(SM, 'utf8');
  const OPEN = '  <!-- WRAP-ARCHIVE-START -->';
  const CLOSE = '  <!-- WRAP-ARCHIVE-END -->';
  const re = new RegExp(
    OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' +
    CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?', '');
  xml = xml.replace(re, '');
  const today = new Date().toISOString().slice(0, 10);
  const lines = [OPEN];
  const urls = [SITE + '/nepse-decode/wrap/'];
  for (let p = 2; p <= totalPages; p++) urls.push(SITE + '/nepse-decode/wrap/page/' + p + '/');
  for (const u of urls) {
    lines.push('  <url>\n    <loc>' + u + '</loc>\n    <lastmod>' + today + '</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>');
  }
  lines.push(CLOSE);
  xml = xml.replace(/<\/urlset>/, lines.join('\n') + '\n</urlset>');
  fs.writeFileSync(SM, xml);
  return urls;
}

/* ---------- main ---------- */

function main() {
  let archive = readJson(ARCH, null);
  if (!Array.isArray(archive)) archive = [];
  const have = new Set(archive.map((e) => e.session_date));
  const added = [];

  const live = readJson(LIVE, null);
  if (live && live.session_date && live.index && !have.has(live.session_date)) {
    const mkt = live.market || '';
    // NPT "now": Date.now() + 5:45 in ms, as ISO date part.
    const npt = new Date(Date.now() + (5 * 60 + 45) * 60000);
    const nptISO = npt.toISOString().slice(0, 10);
    const nptH = npt.getUTCHours() + npt.getUTCMinutes() / 60;
    const closePassed = nptISO > live.session_date || (nptISO === live.session_date && nptH >= 15 + 35 / 60);
    if (mkt === 'OPEN' && !closePassed) {
      console.log(JSON.stringify({ status: 'market still open, skipping', session_date: live.session_date }));
    } else {
      const e = entryFromLive(live);
      archive.push(e);
      have.add(e.session_date);
      added.push(e.session_date);
    }
  }

  const newEntries = added.length > 0;
  if (!newEntries && !FORCE) {
    console.log(JSON.stringify({ status: 'already current', entries: archive.length }));
    return;
  }

  archive.sort((a, b) => (a.session_date < b.session_date ? 1 : -1));
  fs.mkdirSync(WRAP_DIR, { recursive: true });
  fs.writeFileSync(ARCH, JSON.stringify(archive, null, 2) + '\n');

  const totalPages = Math.max(1, Math.ceil(archive.length / PER_PAGE));
  for (let p = 1; p <= totalPages; p++) {
    const slice = archive.slice((p - 1) * PER_PAGE, p * PER_PAGE);
    const f = pageFile(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, renderPage(slice, p, totalPages));
  }
  // Remove stale pages beyond totalPages (no broken pagination links).
  let p = totalPages + 1;
  while (true) {
    const dir = path.join(WRAP_DIR, 'page', String(p));
    if (!fs.existsSync(dir)) break;
    fs.rmSync(dir, { recursive: true, force: true });
    p++;
  }
  try { fs.rmdirSync(path.join(WRAP_DIR, 'page')); } catch (e) { /* not empty — fine */ }

  const urls = updateSitemap(totalPages);
  console.log(JSON.stringify({
    status: 'rebuilt', added, entries: archive.length,
    pages: totalPages, urls,
  }));
}

main();
