#!/usr/bin/env node
/* Wave E — apply the stock-page SEO end state to the already-baked pages.
 *
 * tools/build-symbol-pages.js now emits, for every stock page:
 *   - a static company block (real sentences + key-stats <dl>) composed
 *     ONLY from the batch data the repo already carries,
 *   - the stocks-family og:image (assets/images/og/stocks.png) +
 *     twitter:image,
 *   - a Corporation node in the JSON-LD @graph.
 * A full regeneration is the pipeline's job; this transform brings the
 * baked pages to the IDENTICAL end state with additions only — every
 * existing byte is preserved (verified by text-diff on samples and by
 * re-running the generator into a scratch tree and comparing regions).
 *
 * Pages whose symbols are no longer in universe.json (delisted/renamed
 * instruments that remain live) get their block composed from facts the
 * page itself already prints (h1, kicker, snapshot values) — nothing is
 * fetched or invented.
 *
 * The /stocks/ index gains the same og treatment plus directory entries
 * for those extra baked pages, in the generator's own listing format and
 * sort order, so they stop being orphans.
 *
 * Idempotent: a second run changes nothing.
 * Usage: node tools/apply-stock-seo.js [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gen = require('./build-symbol-pages.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const STOCKS = path.join(ROOT, 'stocks');
const SITE = 'https://shirjankhadka.com.np';
const DRY = process.argv.includes('--dry-run');
const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const text = (s) => String(s || '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const universe = loadJson(path.join(DATA, 'universe.json'), { symbols: [] });
const ver = loadJson(path.join(DATA, 'verdicts.json'), { verdicts: {} });
const fund = loadJson(path.join(DATA, 'fundamentals.json'), null);
const live = loadJson(path.join(DATA, 'live.json'), null);
const verdicts = ver.verdicts || {};
const liveMap = {};
let liveDate = '';
if (live && Array.isArray(live.quotes)) {
  for (const q of live.quotes) { if (q && q.symbol) liveMap[q.symbol] = q; }
  liveDate = String(live.asof || '').slice(0, 10);
}
const bySlug = {};
for (const u of universe.symbols) bySlug[gen.slugOf(u.s)] = u;

/* Mirror of symbolPage()'s headline-price selection, so the facts baked
 * here are the facts a regeneration would print. */
function factsForUniverse(u) {
  const sym = u.s;
  const v = verdicts[sym] || null;
  const liveQ = liveMap[sym];
  const vAsof = (v && v.asof) || '';
  const useLive = !!(liveQ && liveDate && liveDate >= vAsof && Number.isFinite(Number(liveQ.ltp)));
  const pNum = useLive ? Number(liveQ.ltp) : (v && v.p);
  const cNum = (useLive && Number.isFinite(Number(liveQ.percent_change))) ? Number(liveQ.percent_change) : (v && v.ch);
  const asofD = useLive ? liveDate : vAsof;
  const volFmt = gen.fmtNum(useLive && Number.isFinite(Number(liveQ.volume)) ? Number(liveQ.volume) : (v && v.vol));
  const tnoFmt = gen.fmtNum(useLive && Number.isFinite(Number(liveQ.turnover)) ? Math.round(Number(liveQ.turnover)) : null);
  const sector = gen.classifySymbol(u.s, u.n, u.t);
  return gen.blockFacts(u, v, fund, sector, { pNum, cNum, asofD, volFmt, tnoFmt });
}

/* Facts for pages whose symbol left the universe: parsed from the values
 * the baked page itself already prints. Missing pieces stay missing. */
function factsFromPage(html) {
  const h1 = html.match(/<h1>([\s\S]*?)\(([^()]*)\)<\/h1>/);
  if (!h1) return null;
  const f = { sym: text(h1[2]), name: text(h1[1]), type: null, sector: null,
    asof: null, price: null, chg: null, h52: null, l52: null, vol: null,
    turnover: null, period: null, paidup: null, netprofit: null, eps: null,
    pe: null, verdict: null, verdictAsof: null };
  const kick = html.match(/sig-kicker">([\s\S]*?) · NEPSE</);
  if (kick) f.type = text(kick[1]) || null;
  const sec = html.match(/More in the ([\s\S]*?) sector/);
  if (sec) f.sector = text(sec[1]) || null;
  const asof = html.match(/Data as of (\d{4}-\d{2}-\d{2})/);
  if (asof) f.asof = asof[1];
  const price = html.match(/sp-price">Rs ([\d,.]+)</);
  if (price) f.price = price[1];
  const chg = html.match(/sp-chg[^>]*>([\s\S]*?)<\/div>/);
  if (chg) { const pct = text(chg[1]).match(/[+-]?[\d.]+%/); if (pct) f.chg = pct[0]; }
  const range = html.match(/sp-stat-v">Rs ([\d,.]+) – Rs ([\d,.]+)</);
  if (range) { f.l52 = range[1]; f.h52 = range[2]; }
  const vol = html.match(/data-live-vol>([\d,]+)</);
  if (vol) f.vol = vol[1];
  const tno = html.match(/data-live-turnover>Rs ([\d,]+)</);
  if (tno) f.turnover = tno[1];
  return f;
}

const NOTE = '<p class="sp-note">Price snapshot above. Switch tabs for engine signals, published fundamentals, latest headlines and corporate actions.</p>';
const LIGHT_ANCHOR = '/* light theme: token-driven components (tabs, tables) flip with the';

function addOg(html) {
  let out = html.replace(/(<meta property="og:image" content=")[^"]*(")/,
    (m, a, b) => a + gen.OG_STOCKS + b);
  if (!/name="twitter:image"/.test(out)) {
    const tw = '<meta name="twitter:image" content="' + gen.OG_STOCKS + '">';
    if (/<meta name="twitter:description" content="[^"]*">/.test(out)) {
      out = out.replace(/(<meta name="twitter:description" content="[^"]*">)/, '$1\n' + tw);
    } else {
      out = out.replace(/(<meta property="og:image" content="[^"]*">)/, '$1\n' + tw);
    }
  }
  return out;
}

function addCorporation(html, name, sym, url) {
  const m = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .find((x) => x[1].includes('"@graph"'));
  if (!m) return { html, added: false, reason: 'no @graph' };
  let j;
  try { j = JSON.parse(m[1]); } catch { return { html, added: false, reason: 'unparseable ld' }; }
  if (JSON.stringify(j) !== m[1]) return { html, added: false, reason: 'reserialize differs' };
  if (j['@graph'].some((n) => n && n['@type'] === 'Corporation')) return { html, added: false, reason: 'present' };
  j['@graph'].push({ '@type': 'Corporation', name, tickerSymbol: sym, url });
  return { html: html.replace(m[0], '<script type="application/ld+json">' + JSON.stringify(j) + '</script>'), added: true };
}

function processPage(dir) {
  const file = path.join(STOCKS, dir, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const orig = html;
  const u = bySlug[dir];
  const report = { dir, block: false, css: false, og: false, corp: null, note: '' };

  /* 1 — company block */
  if (!html.includes('data-seo-block="company"')) {
    const f = u ? factsForUniverse(u) : factsFromPage(html);
    if (!f) { report.note = 'no facts (h1 unparseable)'; }
    else if (!html.includes(NOTE)) { report.note = 'overview anchor missing'; }
    else {
      html = html.replace(NOTE, NOTE + gen.companyBlock(f));
      report.block = true;
      /* CSS: current-template pages carry the inline SP_STYLES block —
       * insert the rules exactly where the generator puts them (just
       * before the light-theme section). Legacy pages get a style tag. */
      if (html.includes('.sp-snap{')) {
        if (!html.includes('.sp-about{')) {
          html = html.replace(LIGHT_ANCHOR, gen.SP_ABOUT_CSS + LIGHT_ANCHOR);
          report.css = true;
        }
      } else if (!html.includes('.sp-about{')) {
        html = html.replace('</head>', '<style>\n' + gen.SP_ABOUT_CSS + '</style>\n</head>');
        report.css = true;
      }
    }
  }

  /* 2 — social images */
  const ogged = addOg(html);
  if (ogged !== html) { html = ogged; report.og = true; }

  /* 3 — Corporation JSON-LD */
  const name = u ? u.n : (factsFromPage(html) || {}).name;
  const sym = u ? u.s : (factsFromPage(html) || {}).sym;
  if (name && sym) {
    const r = addCorporation(html, name, sym, SITE + '/stocks/' + dir + '/');
    html = r.html;
    report.corp = r.added ? 'added' : r.reason;
  } else report.corp = 'no name/sym';

  if (html !== orig && !DRY) fs.writeFileSync(file, html);
  report.changed = html !== orig;
  return report;
}

function processIndex() {
  const file = path.join(STOCKS, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const orig = html;
  const report = { index: true, og: false, addedLis: [], countFrom: null, countTo: null };

  const ogged = addOg(html);
  if (ogged !== html) { html = ogged; report.og = true; }

  /* Directory entries for baked pages the universe no longer lists. */
  const listedSlugs = new Set([...html.matchAll(/href="\/stocks\/([^"]+)\/"/g)].map((m) => m[1]));
  const extras = gen.scanBakedExtras(new Set([...Object.keys(bySlug), ...listedSlugs]));
  const liFor = (e) => '<li><a href="/stocks/' + gen.slugOf(e.s) + '/">' + gen.esc(e.n) +
    ' (' + gen.esc(e.s) + ')</a> <span class="sp-type">' + gen.esc(e.t || '') + '</span></li>\n';
  for (const e of extras) {
    const li = liFor(e);
    /* Positions shift with every insertion — rescan the list each time. */
    const lis = [...html.matchAll(/<li><a href="\/stocks\/[^"]+\/">[\s\S]*?\(([^()]*)\)<\/a>/g)]
      .map((m) => ({ sym: m[1], end: m.index + m[0].length }));
    const after = lis.find((x) => String(x.sym).localeCompare(String(e.s)) > 0);
    if (after) {
      const nl = html.indexOf('\n', after.end);
      html = html.slice(0, nl + 1) + li + html.slice(nl + 1);
    } else {
      html = html.replace('</ul></section>', li + '</ul></section>');
    }
    report.addedLis.push(e.s);
  }
  const total = (html.match(/<li><a href="\/stocks\//g) || []).length;
  const cm = html.match(/(\d+) instruments/);
  if (cm) {
    report.countFrom = cm[1];
    if (Number(cm[1]) !== total) html = html.replace(/(\d+) instruments/, total + ' instruments');
    report.countTo = total;
  }
  if (html !== orig && !DRY) fs.writeFileSync(file, html);
  report.changed = html !== orig;
  return report;
}

function main() {
  const dirs = fs.readdirSync(STOCKS, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const summary = { pages: 0, changed: 0, blocks: 0, css: 0, og: 0, corpAdded: 0, notes: [] };
  for (const dir of dirs) {
    const r = processPage(dir);
    summary.pages++;
    if (r.changed) summary.changed++;
    if (r.block) summary.blocks++;
    if (r.css) summary.css++;
    if (r.og) summary.og++;
    if (r.corp === 'added') summary.corpAdded++;
    if (r.note || (r.corp && r.corp !== 'added' && r.corp !== 'present')) {
      summary.notes.push(dir + ': ' + [r.note, 'corp=' + r.corp].filter(Boolean).join(' '));
    }
  }
  const idx = processIndex();
  console.log(JSON.stringify({ dryRun: DRY, ...summary, index: idx }, null, 1));
}

main();
