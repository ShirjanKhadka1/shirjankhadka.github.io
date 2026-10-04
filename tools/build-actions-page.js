#!/usr/bin/env node
/* Nepse Decode - corporate-action archive page.
 *
 * Reads nepse-chart/data/corporate-actions.json (durable, append-only) and
 * regenerates nepse-actions/index.html on the Concept 03 editorial theme:
 * magazine-style notice cards, kind pills, symbol search, pagination.
 * The official record remains the NEPSE disclosure archive; this page is a
 * convenience index of notices verified at capture time.
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
  'lock-in': 'Lock-in',
  'meeting': 'Meeting',
};

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtAnnounced(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return esc(d || '');
  return String(+m[3]) + ' ' + MON3[+m[2] - 1] + ' ' + m[1];
}

/* Render the extracted facts (from the official PDF) as a compact
 * definition list. Facts are only ever extracted from the verified
 * official notice — never invented. */
function fmtFacts(facts) {
  if (!facts || typeof facts !== 'object') return '';
  const rows = [];
  const label = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  for (const [k, v] of Object.entries(facts)) {
    if (v === null || v === undefined || v === '') continue;
    let val = v;
    if (typeof v === 'number' && v >= 1000) val = v.toLocaleString('en-US');
    rows.push('<div class="na-fact"><dt>' + esc(label(k)) + '</dt><dd>' + esc(String(val)) + '</dd></div>');
  }
  if (!rows.length) return '';
  return '<dl class="na-facts">\n' + rows.join('\n') + '\n</dl>\n';
}

/* Static card markup — mirrored by the client-side renderer below so a
 * live JSON refresh paints identical cards. */
function cardHTML(it) {
  const kind = KIND_LABEL[it.kind] || esc(it.kind || 'Notice');
  const dot = ' <span class="na-dot">·</span> ';
  return '<article class="na-card" data-kind="' + esc(it.kind) + '" data-sym="' + esc((it.symbol || '').toLowerCase()) + '" data-year="' + esc(String(it.announced || '').slice(0, 4)) + '">\n' +
    '<div class="na-top"><span class="na-kind k-' + esc(it.kind) + '">' + esc(kind) + '</span>' +
    (it.symbol ? '<a class="na-sym" href="/stocks/' + esc(String(it.symbol).replace(/\//g, '-')) + '/">' + esc(it.symbol) + '</a>' : '') + '</div>\n' +
    '<h3 class="na-head">' + esc(it.headline) + '</h3>\n' +
    fmtFacts(it.facts) +
    '<p class="na-meta">' + (it.company ? esc(it.company) + dot : '') +
    (it.announced ? 'Announced ' + fmtAnnounced(it.announced) + dot : '') +
    (it.officialPdf ? '<a href="' + esc(it.officialPdf) + '" rel="noopener" target="_blank">Official NEPSE PDF ↗</a>' : '') +
    '</p>\n' +
    '</article>\n';
}

function main() {
  const store = loadJson(DATA_FILE, null);
  const items = (store && store.items) || [];
  const updated = (store && store.updated) || '';

  const years = Array.from(new Set(items.map((it) => String(it.announced || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))).sort().reverse();
  const kinds = Object.keys(KIND_LABEL).filter((k) => items.some((it) => it.kind === k));

  const title = 'NEPSE Corporate Actions: Dividends, Bonus, Rights, Promoter Sales | Nepse Decode';
  const desc = 'Verified NEPSE corporate actions — dividend, bonus share, right share, promoter-share sale, lock-in and auction notices — each linked to its official NEPSE disclosure PDF. Free, educational.';
  const url = SITE + '/nepse-actions/';

  const itemList = items.map((it, i) => ({
    '@type': 'ListItem', position: i + 1,
    name: it.headline,
    url: it.officialPdf || url,
  }));
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', name: title, url, description: desc,
        author: { '@type': 'Organization', name: 'Nepse Decode', url: SITE + '/nepse-decode/' },
      },
      { '@type': 'ItemList', itemListElement: itemList },
    ],
  };

  let h = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<script>try{var t=localStorage.getItem(\'sk-theme\');if(!t)t=matchMedia(\'(prefers-color-scheme: dark)\').matches?\'dark\':\'light\';document.documentElement.setAttribute(\'data-theme\',t)}catch(e){}</script>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<meta name="author" content="Shirjan Khadka">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#0A0C10">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Nepse Decode">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:image" content="' + SITE + '/assets/images/og/decode.png">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<meta name="twitter:image" content="' + SITE + '/assets/images/og/decode.png">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nd-chrome.css?v=20261003a">\n' +
    '<link rel="stylesheet" href="/css/nd-actions.css?v=20261003b">\n' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n' +
    '</head>\n<body class="nd" data-page="actions">\n' +
    '<a class="skip-link" href="#main">Skip to content</a>\n' +
    '<div id="nd-header"></div>\n' +
    '<div class="fb-wrap" style="display:flex;justify-content:center;padding:10px 16px 0"><div data-freshness-badge></div></div>\n' +
    '<div class="nd-shell">\n  <div class="nd-content">\n    <main id="main" class="na-wrap">\n' +
    '<nav aria-label="Breadcrumb" style="margin:4px 0 16px;font-size:.85rem;color:var(--nd-dim)">\n' +
    '  <ol style="list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center">\n' +
    '    <li><a href="/" style="color:inherit">Home</a></li>\n' +
    '    <li aria-hidden="true">/</li>\n' +
    '    <li><a href="/nepse-decode/" style="color:inherit">Nepse Decode</a></li>\n' +
    '    <li aria-hidden="true">/</li>\n' +
    '    <li><span aria-current="page" style="color:var(--nd-text);font-weight:600">Corporate actions</span></li>\n' +
    '  </ol>\n</nav>\n' +
    '<div class="na-masthead">\n' +
    '<p class="na-kicker">News · Corporate actions</p>\n' +
    '<h1>Corporate actions, verified</h1>\n' +
    '<p class="na-lede">Dividend, bonus share, right share, promoter-share sale, lock-in and auction notices — each linked to its official NEPSE disclosure PDF. The official record is the NEPSE disclosure archive; this page is a convenience index of notices verified at capture time.</p>\n' +
    '<div class="na-meta-row">\n' +
    '  <span class="na-badge lime"><span id="naFreshDot"></span><span id="naFresh">' + esc(updated ? 'Archive updated ' + updated.slice(0, 10) : 'Archive') + '</span></span>\n' +
    '  <span class="na-badge" id="naTotal">' + items.length + ' verified notices</span>\n' +
    '</div></div>\n' +
    '<div class="na-pills" id="naPills" role="tablist" aria-label="Filter by action type">\n' +
    '  <button class="na-pill" role="tab" data-kind="" aria-selected="true">All</button>\n' +
    kinds.map((k) => '  <button class="na-pill" role="tab" data-kind="' + esc(k) + '" aria-selected="false">' + esc(KIND_LABEL[k]) + '</button>').join('\n') + '\n' +
    '</div>\n' +
    '<div class="na-filters">\n' +
    (years.length > 1
      ? '<select id="na-year" class="na-select" aria-label="Filter by year"><option value="">All years</option>' +
        years.map((y) => '<option value="' + y + '">' + y + '</option>').join('') +
        '</select>\n'
      : '') +
    '  <input id="na-q" class="na-search" type="search" placeholder="Search symbol, e.g. NABIL" aria-label="Search by symbol" autocomplete="off">\n' +
    '  <span class="na-count" id="na-count" aria-live="polite"></span>\n' +
    '</div>\n' +
    '<div id="na-feed" aria-live="polite">\n';

  for (const yr of years.length ? years : ['']) {
    if (yr) h += '<h2 class="na-year">' + yr + '</h2>\n';
    h += '<div class="na-feed">\n';
    for (const it of items) {
      if (yr && String(it.announced || '').slice(0, 4) !== yr) continue;
      h += cardHTML(it);
    }
    h += '</div>\n';
  }
  if (!items.length) {
    h += '<p class="na-empty">No verified notices in the archive yet. New dividend, bonus, right, promoter-share and auction notices are added as they are published and verified.</p>\n';
  }

  h += '</div>\n' +
    '<nav class="na-pager" id="na-pager" aria-label="Notices pages">\n' +
    '  <button type="button" id="na-prev" class="na-page-btn">&larr; Newer</button>\n' +
    '  <span class="na-page-info" id="na-page-info" aria-live="polite"></span>\n' +
    '  <button type="button" id="na-next" class="na-page-btn">Older &rarr;</button>\n' +
    '</nav>\n' +
    '<p class="na-disc">Educational use only, not investment advice. Notices are captured from official NEPSE disclosures; always confirm dates, ratios and book closures against the official NEPSE disclosure archive before acting.</p>\n' +
    '    </main>\n    <div id="nd-footer"></div>\n  </div>\n</div>\n' +
    '<script>\n' +
    '(function () {\n' +
    '  "use strict";\n' +
    '  var esc = function(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };\n' +
    '  var MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];\n' +
    '  var fmtAnnounced = function(d){ var m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(d || ""); if(!m) return esc(d || ""); return String(+m[3]) + " " + MON3[+m[2]-1] + " " + m[1]; };\n' +
    '  var KIND_LABEL = ' + JSON.stringify(KIND_LABEL) + ';\n' +
    '  var feed = document.getElementById("na-feed"),\n' +
    '      year = document.getElementById("na-year"),\n' +
    '      q = document.getElementById("na-q"),\n' +
    '      count = document.getElementById("na-count"),\n' +
    '      pager = document.getElementById("na-pager"),\n' +
    '      prev = document.getElementById("na-prev"),\n' +
    '      next = document.getElementById("na-next"),\n' +
    '      info = document.getElementById("na-page-info"),\n' +
    '      pills = document.querySelectorAll("#naPills .na-pill"),\n' +
    '      PAGE = 6, page = 1, activeKind = "", items = [];\n' +
    '  function cardHTML(it){\n' +
    '    var kind = KIND_LABEL[it.kind] || esc(it.kind || "Notice");\n' +
    '    var dot = \' <span class="na-dot">·</span> \';\n' +
    '    var facts = "";\n' +
    '    if (it.facts && typeof it.facts === "object") {\n' +
    '      var rows = [];\n' +
    '      Object.keys(it.facts).forEach(function(k){\n' +
    '        var v = it.facts[k];\n' +
    '        if (v === null || v === undefined || v === "") return;\n' +
    '        var val = (typeof v === "number" && v >= 1000) ? v.toLocaleString("en-US") : String(v);\n' +
    '        var label = k.replace(/([A-Z])/g, " $1").replace(/^./, function(c){ return c.toUpperCase(); });\n' +
    '        rows.push(\'<div class="na-fact"><dt>\' + esc(label) + "</dt><dd>" + esc(val) + "</dd></div>");\n' +
    '      });\n' +
    '      if (rows.length) facts = \'<dl class="na-facts">\' + rows.join("") + "</dl>";\n' +
    '    }\n' +
    '    return \'<article class="na-card">\' +\n' +
    '      \'<div class="na-top"><span class="na-kind k-\' + esc(it.kind) + \'">\' + esc(kind) + "</span>" +\n' +
    '      (it.symbol ? \'<a class="na-sym" href="/stocks/\' + esc(String(it.symbol).replace(/\\//g, "-")) + \'/">\' + esc(it.symbol) + "</a>" : "") + "</div>" +\n' +
    '      \'<h3 class="na-head">\' + esc(it.headline) + "</h3>" + facts +\n' +
    '      \'<p class="na-meta">\' + (it.company ? esc(it.company) + dot : "") +\n' +
    '      (it.announced ? "Announced " + fmtAnnounced(it.announced) + dot : "") +\n' +
    '      (it.officialPdf ? \'<a href="\' + esc(it.officialPdf) + \'" rel="noopener" target="_blank">Official NEPSE PDF ↗</a>\' : "") + "</p></article>";\n' +
    '  }\n' +
    '  function isMatch(it){\n' +
    '    var y = year ? year.value : "", s = q.value.trim().toLowerCase();\n' +
    '    return (!y || String(it.announced || "").slice(0,4) === y) &&\n' +
    '           (!activeKind || it.kind === activeKind) &&\n' +
    '           (!s || String(it.symbol || "").toLowerCase().indexOf(s) !== -1);\n' +
    '  }\n' +
    '  function render(){\n' +
    '    var filtered = items.filter(isMatch);\n' +
    '    var pages = Math.max(1, Math.ceil(filtered.length / PAGE));\n' +
    '    if (page > pages) page = pages;\n' +
    '    var start = (page - 1) * PAGE, end = Math.min(start + PAGE, filtered.length);\n' +
    '    var years = {};\n' +
    '    filtered.slice(start, end).forEach(function(it){\n' +
    '      var y = String(it.announced || "").slice(0,4) || "";\n' +
    '      (years[y] = years[y] || []).push(it);\n' +
    '    });\n' +
    '    var html = "";\n' +
    '    Object.keys(years).sort().reverse().forEach(function(y){\n' +
    '      if (y) html += \'<h2 class="na-year">\' + esc(y) + "</h2>";\n' +
    '      html += \'<div class="na-feed">\' + years[y].map(cardHTML).join("") + "</div>";\n' +
    '    });\n' +
    '    feed.innerHTML = html || \'<p class="na-empty">No notices match these filters.</p>\';\n' +
    '    count.textContent = filtered.length + " of " + items.length + " notices";\n' +
    '    info.textContent = filtered.length\n' +
    '      ? "Showing " + (start + 1) + "\\u2013" + end + " of " + filtered.length + (pages > 1 ? " \\u00b7 page " + page + " of " + pages : "")\n' +
    '      : "No notices match.";\n' +
    '    prev.disabled = page <= 1;\n' +
    '    next.disabled = page >= pages;\n' +
    '    pager.style.display = pages > 1 ? "" : "none";\n' +
    '  }\n' +
    '  function reset(){ page = 1; render(); }\n' +
    '  pills.forEach(function(btn){\n' +
    '    btn.addEventListener("click", function(){\n' +
    '      activeKind = btn.getAttribute("data-kind");\n' +
    '      pills.forEach(function(b){ b.setAttribute("aria-selected", b === btn ? "true" : "false"); });\n' +
    '      reset();\n' +
    '    });\n' +
    '  });\n' +
    '  if (year) year.addEventListener("change", reset);\n' +
    '  q.addEventListener("input", reset);\n' +
    '  prev.addEventListener("click", function(){ if (page > 1) { page--; render(); } });\n' +
    '  next.addEventListener("click", function(){ if (page < Math.ceil(items.filter(isMatch).length / PAGE)) { page++; render(); } });\n' +
    '  /* Live refresh: the pipeline regenerates this page at market close, but\n' +
    '     a fetch here keeps the archive fresh between runs. Failure keeps the\n' +
    '     baked snapshot on screen. */\n' +
    '  function load(){\n' +
    '    return fetch("/nepse-chart/data/corporate-actions.json", { cache: "no-store" })\n' +
    '      .then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); })\n' +
    '      .then(function(d){\n' +
    '        var fresh = d.items || [];\n' +
    '        if (!fresh.length) return;\n' +
    '        items = fresh.slice().sort(function(a,b){ return String(b.announced||"").localeCompare(String(a.announced||"")); });\n' +
    '        var total = document.getElementById("naTotal");\n' +
    '        if (total) total.textContent = items.length + " verified notices";\n' +
    '        var fr = document.getElementById("naFresh");\n' +
    '        if (fr && d.updated) fr.textContent = "Archive updated " + String(d.updated).slice(0,10);\n' +
    '        render();\n' +
    '      });\n' +
    '  }\n' +
    '  try {\n' +
    '    /* Seed from the baked cards, then refresh from the JSON. */\n' +
    '    load().catch(function(){ render(); });\n' +
    '    setInterval(function(){ if (!document.hidden) load().catch(function(){}); }, 300000);\n' +
    '  } catch(e) { render(); }\n' +
    '})();\n' +
    '</script>\n' +
    '<script src="/js/theme-toggle.js?v=20261002c" defer></script>\n' +
    '<script src="/js/nepse-market-config.js?v=20261002c"></script>\n' +
    '<script src="/js/freshness-badge.js?v=20261002c" defer></script>\n' +
    '<script src="/js/nepse-sidebar.js?v=20261002c" defer></script>\n' +
    '<script src="/js/nd-chrome.js?v=20261003a" defer></script>\n' +
    '</body>\n</html>\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), h);
  console.log(JSON.stringify({ items: items.length, page: 'nepse-actions/index.html' }));
}

main();
