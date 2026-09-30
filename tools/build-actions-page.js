#!/usr/bin/env node
/* Nepse Decode - corporate-action archive page.
 *
 * Reads nepse-chart/data/corporate-actions.json (durable, append-only) and
 * regenerates nepse-actions/index.html: filter by kind + symbol search,
 * newest first, each entry linking its official NEPSE PDF. The official
 * record remains the NEPSE disclosure archive; this page is a convenience
 * index of verified notices only.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'nepse-chart', 'data', 'corporate-actions.json');
const OUT_DIR = path.join(ROOT, 'nepse-actions');
const SITE = 'https://shirjankhadka.com.np';

const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const KIND_LABEL = {
  'dividend': 'Dividend',
  'bonus-share': 'Bonus share',
  'right-share': 'Right share',
  'promoter-share': 'Promoter share',
  'auction': 'Auction',
};

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtAnnounced(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return esc(d || '');
  return String(+m[3]) + ' ' + MON3[+m[2] - 1] + ' ' + m[1];
}

function main() {
  const store = loadJson(DATA_FILE, null);
  const items = (store && store.items) || [];
  const updated = (store && store.updated) || '';

  const years = Array.from(new Set(items.map((it) => String(it.announced || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))).sort().reverse();

  const title = 'NEPSE Corporate Actions Archive: Dividends, Bonus, Rights | Nepse Decode';
  const desc = 'Durable archive of verified NEPSE corporate actions: dividend, bonus share, right share, promoter-share sale and auction notices, each linked to its official NEPSE disclosure PDF. Educational, free.';
  const url = SITE + '/nepse-actions/';

  const itemList = items.map((it, i) => ({
    '@type': 'ListItem', position: i + 1,
    name: it.headline,
    url: it.officialPdf || it.sourceUrl || url,
  }));
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', name: title, url, description: desc,
        author: { '@type': 'Person', name: 'Shirjan Khadka', url: SITE + '/' },
      },
      { '@type': 'ItemList', itemListElement: itemList },
    ],
  };

  let h = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<meta name="author" content="Shirjan Khadka">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#FAF8F2">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Shirjan Khadka">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/css/nepse-luxury.css?v=20260929d">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave7.css?v=20261002d">\n' +
    '<link rel="stylesheet" href="/css/nepse-brand.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nepse-wave8.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nepse-actions.css?v=20260929a">\n' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n' +
    '</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n\n' +
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
    '    <a href="/nepse-actions/" class="on" aria-current="page">Corp. actions</a>\n' +
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
    '      <a href="/nepse-actions/" class="on" aria-current="page">Corp. actions</a>\n' +
    '    </nav>\n' +
    '    <div class="spacer"></div>\n' +
    '    <a class="btn small" href="/nepse-chart/">Open the Lab →</a>\n' +
    '  </div>\n' +
    '</header>\n\n' +
    '<main id="main" class="wrap">\n' +
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <span>Corporate actions</span></nav>\n' +
    '<section class="hero"><div class="hero-rule"></div>\n' +
    '<p class="eyebrow">Archive · verified notices</p>\n' +
    '<h1>NEPSE corporate actions archive</h1>\n' +
    '<p class="lede">Dividend, bonus share, right share, promoter-share sale and auction notices, each linked to its official NEPSE disclosure PDF. The official record is the NEPSE disclosure archive; this page is a convenience index of notices verified at capture time.</p>\n' +
    '<p class="asof">Archive updated ' + esc(updated ? updated.slice(0, 10) : 'recently') + ' · ' + items.length + ' verified notices</p></section>\n' +
    '<section aria-label="Filters">\n' +
    '<p class="ca-grow">The archive grows as new verified notices are captured; the official record is the NEPSE disclosure archive.</p>\n' +
    '<div class="ca-filters">\n' +
    '  <label>Year <select id="ca-year"><option value="">All years</option>' +
    years.map((y) => '<option value="' + y + '">' + y + '</option>').join('') +
    '</select></label>\n' +
    '  <label>Kind <select id="ca-kind"><option value="">All kinds</option>' +
    Object.keys(KIND_LABEL).map((k) => '<option value="' + k + '">' + KIND_LABEL[k] + '</option>').join('') +
    '</select></label>\n' +
    '  <label class="ca-search">Symbol <input id="ca-q" type="search" placeholder="e.g. NABIL" aria-label="Search by symbol"></label>\n' +
    '  <span class="ca-count" id="ca-count" aria-live="polite"></span>\n' +
    '</div></section>\n' +
    '<section aria-label="Notices" id="ca-list">\n';

  for (const yr of years.length ? years : ['']) {
    if (yr) h += '<h2 class="ca-year">' + yr + '</h2>\n';
    for (const it of items) {
      if (yr && String(it.announced || '').slice(0, 4) !== yr) continue;
      const kind = KIND_LABEL[it.kind] || esc(it.kind);
      const dot = ' <span class="ca-dot">·</span> ';
      h += '<article class="ca-item" data-kind="' + esc(it.kind) + '" data-sym="' + esc((it.symbol || '').toLowerCase()) + '" data-year="' + esc(String(it.announced || '').slice(0, 4)) + '">\n' +
        '<div class="ca-top"><span class="ca-kind k-' + esc(it.kind) + '">' + esc(kind) + '</span>' +
        (it.symbol ? '<a class="ca-sym" href="/stocks/' + esc(it.symbol.replace(/\//g, '-')) + '/">' + esc(it.symbol) + '</a>' : '') + '</div>\n' +
        '<h3 class="ca-head">' + esc(it.headline) + '</h3>\n' +
        '<p class="ca-meta">' + (it.company ? esc(it.company) + dot : '') +
        (it.announced ? 'Announced ' + fmtAnnounced(it.announced) + dot : '') +
        (it.officialPdf ? '<a href="' + esc(it.officialPdf) + '" rel="noopener" target="_blank">Official NEPSE PDF</a>' : '') +
        '</p>\n' +
        '</article>\n';
    }
  }
  if (!items.length) {
    h += '<p class="sp-note">No verified notices in the archive yet. New dividend, bonus, right, promoter-share and auction notices are added as they are published and verified.</p>\n';
  }

  h += '</section>\n' +
    '<p class="sp-disc">Educational use only, not investment advice. Notices are captured from official NEPSE disclosures; always confirm dates, ratios and book closures against the official NEPSE disclosure archive before acting.</p>\n' +
    '</main>\n' +
    '<footer class="sc-footer">\n' +
    '  <div class="wrap">\n' +
    '    <p>Built by <a href="/">Shirjan Khadka</a> · Kathmandu, Nepal</p>\n' +
    '    <p class="sc-footer-sub">NEPSE corporate actions archive · verified official notices · educational use only</p>\n' +
    '  </div>\n' +
    '</footer>\n' +
    '<script>\n' +
    '(function () {\n' +
    '  var year = document.getElementById("ca-year"), kind = document.getElementById("ca-kind"), q = document.getElementById("ca-q"),\n' +
    '      items = Array.prototype.slice.call(document.querySelectorAll(".ca-item")),\n' +
    '      years = Array.prototype.slice.call(document.querySelectorAll(".ca-year")),\n' +
    '      count = document.getElementById("ca-count");\n' +
    '  function apply() {\n' +
    '    var y = year.value, k = kind.value, s = q.value.trim().toLowerCase(), n = 0;\n' +
    '    items.forEach(function (el) {\n' +
    '      var ok = (!y || el.getAttribute("data-year") === y) &&\n' +
    '               (!k || el.getAttribute("data-kind") === k) &&\n' +
    '               (!s || el.getAttribute("data-sym").indexOf(s) !== -1);\n' +
    '      el.style.display = ok ? "" : "none";\n' +
    '      if (ok) n++;\n' +
    '    });\n' +
    '    years.forEach(function (h) {\n' +
    '      var el = h.nextElementSibling, any = false;\n' +
    '      while (el && !el.classList.contains("ca-year")) {\n' +
    '        if (el.classList && el.classList.contains("ca-item") && el.style.display !== "none") { any = true; break; }\n' +
    '        el = el.nextElementSibling;\n' +
    '      }\n' +
    '      h.style.display = any ? "" : "none";\n' +
    '    });\n' +
    '    count.textContent = n + " of " + items.length + " notices";\n' +
    '  }\n' +
    '  year.addEventListener("change", apply);\n' +
    '  kind.addEventListener("change", apply);\n' +
    '  q.addEventListener("input", apply);\n' +
    '  apply();\n' +
    '})();\n' +
    '</script>\n</body>\n</html>\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), h);
  console.log(JSON.stringify({ items: items.length, page: 'nepse-actions/index.html' }));
}

main();
