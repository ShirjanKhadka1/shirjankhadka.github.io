#!/usr/bin/env node
/*
 * Nepse Decode — research index sync.
 *
 * Scans blog article directories (index.html) for articles with article:section
 * and regenerates every surface that lists them:
 *   1. /company-analysis/ card grid (between RESEARCH-SYNC:GRID markers)
 *   2. /company-analysis/ ItemList JSON-LD (between RESEARCH-SYNC:ITEMLIST markers)
 *   3. /blog/ "Company analysis" card grid (between RESEARCH-SYNC:BLOG-GRID markers)
 *   4. sitemap.xml upsert for any article URL not yet present
 *   5. SEO index queue append for newly listed articles
 *   6. /blog/ Archive grid (between RESEARCH-SYNC:ARCHIVE markers): a card
 *      for every published article not linked anywhere else on /blog/, so
 *      no post is ever an orphan (Wave E).
 *
 * Idempotent: re-running with no new articles produces byte-identical files.
 * Run after the daily blog pipeline lands a new article.
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://shirjankhadka.com.np';
const HUB = path.join(ROOT, 'company-analysis', 'index.html');
const BLOG = path.join(ROOT, 'blog', 'index.html');
const SM = path.join(ROOT, 'sitemap.xml');
const SEO_QUEUE = '/home/hatch/workspace/goals/finance-portfolio-and-daily-blog/hidden_files/seo-url-queue.txt';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SECTOR_MAP = { Hotels: 'Hotels & Tourism', Hotel: 'Hotels & Tourism' };
const GENERIC_TAGS = new Set(['NEPSE', 'Company Analysis', 'Equity Research', 'Valuation', 'Dividends']);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
/* Article titles/alts are stored in the pages as HTML text, so entities
 * like &#x27; must be decoded on extraction — otherwise esc() would
 * double-encode them (&amp;#x27;) when a card is rendered from them. */
const decode = s => s.replace(/&#x27;|&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');

function meta(html, prop) {
  const m = html.match(new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', 'i'));
  return m ? m[1] : null;
}

/* Parse one article page into the fields the cards need. Returns null
 * when the page carries no article:section (not a standard article).
 * Shared by the company-analysis scan and the all-articles archive scan
 * so both surfaces describe an article identically. */
function parseArticle(slug, html) {
    const section = meta(html, 'article:section');
    if (!section) return null;

    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = h1 ? decode(h1[1].replace(/<[^>]+>/g, '').trim()) : slug;
    const kicker = html.match(/<span class="article-kicker">([\s\S]*?)<\/span>/i);
    const kickerText = kicker ? kicker[1].replace(/<[^>]+>/g, '').trim() : '';
    const symM = kickerText.match(/NEPSE:\s*([A-Z0-9\/]+)/i);
    const sym = symM ? symM[1].toUpperCase() : null;
    const tags = [...html.matchAll(/<meta[^>]+property="article:tag"[^>]+content="([^"]*)"/gi)].map(m => m[1]);
    const pub = meta(html, 'article:published_time') || '';
    const pubDate = pub.slice(0, 10);
    let dateLabel = pubDate;
    const dm = pubDate.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dm) dateLabel = `${MONTHS[+dm[2] - 1]} ${+dm[3]}, ${dm[1]}`;

    const readM = html.match(/(\d+)\s*min read/i);
    const readTime = readM ? readM[1] : null;

    const ogImage = meta(html, 'og:image') || '';
    const imgPath = ogImage.startsWith(SITE) ? ogImage.slice(SITE.length) : ogImage;
    const alt = (() => {
      const fig = html.match(/<figure class="article-hero">([\s\S]*?)<\/figure>/i);
      if (fig) {
        const a = fig[1].match(/<img[^>]+alt="([^"]*)"/i);
        if (a) return decode(a[1]);
      }
      const a = html.match(/<img[^>]+alt="([^"]*)"[^>]*fetchpriority="high"/i);
      return a ? decode(a[1]) : title;
    })();

    let sector = tags.find(t => !GENERIC_TAGS.has(t) && t.toUpperCase() !== sym) || sym || 'Markets';
    sector = SECTOR_MAP[sector] || sector;
    const hasER = tags.some(t => t.toLowerCase() === 'equity research');
    const cardKicker = `${sector} · NEPSE: ${sym || ''}` + (hasER ? ' · Equity Research' : '');

    return {
      slug, url: `${SITE}/blog/${slug}/`, path: `/blog/${slug}/`,
      title, section, cardKicker, dateLabel, pubDate, readTime, imgPath, alt,
    };
}

function scanDir() {
  const blogDir = path.join(ROOT, 'blog');
  const out = [];
  for (const slug of fs.readdirSync(blogDir)) {
    const idx = path.join(blogDir, slug, 'index.html');
    if (!fs.existsSync(idx)) continue;
    const a = parseArticle(slug, fs.readFileSync(idx, 'utf8'));
    if (a) out.push(a);
  }
  out.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || '') || a.slug.localeCompare(b.slug));
  return out;
}

function scanArticles() {
  return scanDir().filter(a => a.section.toLowerCase() === 'company analysis');
}

/* Every standard article, any section — the /blog/ archive's source. */
function scanAllArticles() {
  return scanDir();
}

function fimg(a) {
  // Card image: 480/768w WebP variants (see tools/build-images.py + the image
  // pipeline) with a card-sized srcset; never serve the full-size hero as a
  // card thumbnail. Falls back to the original image only when no variant
  // exists yet.
  let base = a.imgPath.replace(/\.(jpe?g|png|webp)$/i, '');
  base = base.replace(/-(480|768|1200)$/, '');
  const widths = [480, 768].filter(w => fs.existsSync(path.join(ROOT, `${base}-${w}.webp`.replace(/^\//, ''))));
  const alt = escAttr(a.alt);
  if (widths.length) {
    const srcset = widths.map(w => `${base}-${w}.webp ${w}w`).join(', ');
    return `<img width="1200" height="630" src="${base}-${widths[0]}.webp" srcset="${srcset}" sizes="(max-width: 640px) 92vw, (max-width: 1100px) 46vw, 400px" alt="${alt}" loading="lazy">`;
  }
  return `<img width="1200" height="630" src="${escAttr(a.imgPath)}" alt="${alt}" loading="lazy">`;
}

function card(a, indent) {
  const meta = a.readTime ? `${a.dateLabel} · ${a.readTime} min read` : a.dateLabel;
  return [
    `${indent}<a class="mag-card reveal" href="${a.path}">`,
    `${indent}  <div class="mag-fimg">`,
    `${indent}    ${fimg(a)}`,
    `${indent}  </div>`,
    `${indent}  <div class="mag-card-body">`,
    `${indent}    <p class="mag-kicker">${esc(a.cardKicker)}</p>`,
    `${indent}    <h3>${esc(a.title)}</h3>`,
    `${indent}    <p class="mag-meta">${meta}</p>`,
    `${indent}  </div>`,
    `${indent}</a>`,
  ].join('\n');
}

function replaceBetween(file, startMarker, endMarker, inner) {
  let html = fs.readFileSync(file, 'utf8');
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker);
  if (s === -1 || e === -1 || e < s) throw new Error(`markers missing in ${file}`);
  const before = html.slice(0, s + startMarker.length);
  const after = html.slice(e);
  return before + '\n' + inner + '\n          ' + after;
}

function itemListScript(articles) {
  // Full <script> block; the RESEARCH-SYNC:ITEMLIST markers sit OUTSIDE it so the JSON stays valid.
  const items = articles.map((a, i) => (
    `      {\n        "@type": "ListItem",\n        "position": ${i + 1},\n` +
    `        "url": "${a.url}",\n        "name": "${a.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n      }`
  )).join(',\n');
  return [
    '  <script type="application/ld+json">',
    '  {',
    '    "@context": "https://schema.org",',
    '    "@type": "ItemList",',
    '    "name": "NEPSE company analyses",',
    '    "itemListElement": [',
    items,
    '    ]',
    '  }',
    '  </script>',
  ].join('\n');
}

function sitemapUpsert(url, lastmod) {
  let xml = fs.readFileSync(SM, 'utf8');
  if (xml.includes(`<loc>${url}</loc>`)) return false;
  const block =
    '  <url>\n' +
    `    <loc>${url}</loc>\n` +
    `    <lastmod>${lastmod}</lastmod>\n` +
    '    <changefreq>monthly</changefreq>\n' +
    '    <priority>0.9</priority>\n' +
    '  </url>';
  const marker = '  <!-- WAVE8-GENERATED-START -->';
  if (xml.includes(marker)) xml = xml.replace(marker, block + '\n' + marker);
  else xml = xml.replace('</urlset>', block + '\n</urlset>');
  fs.writeFileSync(SM, xml);
  return true;
}

function queueSeo(urls) {
  if (!urls.length) return;
  let existing = '';
  try { existing = fs.readFileSync(SEO_QUEUE, 'utf8'); } catch { /* create */ }
  const fresh = urls.filter(u => !existing.includes(u));
  if (fresh.length) fs.appendFileSync(SEO_QUEUE, fresh.join('\n') + '\n');
}

function main() {
  const articles = scanArticles();
  console.log(`found ${articles.length} company-analysis articles: ${articles.map(a => a.slug).join(', ')}`);

  // Previous grid membership (for SEO-queue detection of newly listed articles).
  const prevHub = fs.readFileSync(HUB, 'utf8');
  const prevSlugs = new Set([...prevHub.matchAll(/href="\/blog\/([^"]+)\/"/g)].map(m => m[1]));

  // 1+2. Hub grid + ItemList.
  const grid = articles.map(a => card(a, '            ')).join('\n');

  let hubHtml = fs.readFileSync(HUB, 'utf8');
  hubHtml = replaceBetween(HUB, '<!-- RESEARCH-SYNC:ITEMLIST-START -->', '<!-- RESEARCH-SYNC:ITEMLIST-END -->',
    itemListScript(articles));
  fs.writeFileSync(HUB, hubHtml);

  // Grid replacement on the hub (reuse the computed grid).
  hubHtml = fs.readFileSync(HUB, 'utf8');
  hubHtml = replaceBetween(HUB, '<!-- RESEARCH-SYNC:GRID-START -->', '<!-- RESEARCH-SYNC:GRID-END -->',
    '          <div class="mag-analysis-grid">\n' + grid + '\n          </div>');
  fs.writeFileSync(HUB, hubHtml);

  // 3. Blog grid.
  const blogGrid = articles.map(a => card(a, '          ')).join('\n');
  let blogHtml = fs.readFileSync(BLOG, 'utf8');
  blogHtml = replaceBetween(BLOG, '<!-- RESEARCH-SYNC:BLOG-GRID-START -->', '<!-- RESEARCH-SYNC:BLOG-GRID-END -->',
    '        <div class="mag-analysis-grid">\n' + blogGrid + '\n        </div>');
  fs.writeFileSync(BLOG, blogHtml);

  // 6. Blog archive (Wave E): card every article that nothing else on
  // /blog/ links to, so no post is an orphan. The linked set is computed
  // with the archive region itself removed — otherwise the archive would
  // count as its own inbound link and empty itself on the next run.
  const all = scanAllArticles();
  const blogNow = fs.readFileSync(BLOG, 'utf8');
  const aS = blogNow.indexOf('<!-- RESEARCH-SYNC:ARCHIVE-START -->');
  const aE = blogNow.indexOf('<!-- RESEARCH-SYNC:ARCHIVE-END -->');
  if (aS === -1 || aE === -1 || aE < aS) throw new Error('archive markers missing in blog index');
  const outside = blogNow.slice(0, aS) + blogNow.slice(aE);
  const linked = new Set([...outside.matchAll(/href="\/blog\/([^"]+)\/"/g)].map(m => m[1]));
  const missing = all.filter(a => !linked.has(a.slug));
  const archiveInner = missing.length ? [
    '      <section class="mag-section" aria-label="Archive">',
    '        <div class="mag-head">',
    '          <h2>Archive</h2>',
    '          <p>Every remaining article, newest first</p>',
    '        </div>',
    '        <div class="mag-analysis-grid">',
    missing.map(a => card({ ...a, cardKicker: a.section }, '          ')).join('\n'),
    '        </div>',
    '      </section>',
  ].join('\n') : '';
  const blogSynced = replaceBetween(BLOG, '<!-- RESEARCH-SYNC:ARCHIVE-START -->', '<!-- RESEARCH-SYNC:ARCHIVE-END -->', archiveInner);
  fs.writeFileSync(BLOG, blogSynced);
  console.log(`archive: ${missing.length} article(s) carded${missing.length ? ': ' + missing.map(a => a.slug).join(', ') : ''}`);

  // 4+5. Sitemap + SEO queue for newly listed articles.
  const newly = articles.filter(a => !prevSlugs.has(a.slug));
  for (const a of newly) {
    const added = sitemapUpsert(a.url, a.pubDate || new Date().toISOString().slice(0, 10));
    console.log(added ? `sitemap added: ${a.url}` : `sitemap present: ${a.url}`);
  }
  if (newly.length) {
    queueSeo(newly.map(a => a.url).concat([`${SITE}/company-analysis/`, `${SITE}/blog/`]));
    console.log(`queued ${newly.length} new article URL(s) for indexing`);
  } else {
    console.log('no new articles; nothing queued');
  }
}

main();
