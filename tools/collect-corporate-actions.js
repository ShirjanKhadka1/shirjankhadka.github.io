#!/usr/bin/env node
/* Nepse Decode — repo-side corporate-action collector.
 *
 * Runs inside the daily data workflow (GitHub Actions). Scans the same
 * official-notice mirrors and portals as the workspace breaking-news
 * watcher, enriches official announcement pages, verifies each official
 * NEPSE PDF downloads, and appends NEW verified items to
 * nepse-chart/data/corporate-actions.json (durable, append-only).
 *
 * Archive rule: an item enters only with a verified official NEPSE PDF.
 * Portal-only stories without a retrievable official notice are skipped.
 * Dedup is by story key (kind|symbol, else kind|title-fragment), so this
 * never duplicates what the backfill or an earlier run captured.
 *
 * Fails soft: a dead portal or a bad PDF never aborts the run; the JSON
 * is rewritten only when at least one new item was verified.
 *
 * Node 18+, no npm dependencies (uses curl for fetching).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'nepse-chart', 'data', 'corporate-actions.json');
const UNI = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
const UA = 'Mozilla/5.0 (NepseDecode archive collector)';

const CORE_RE = /(dividend|bonus|right[-_ ]?shares?|promoter|lock[-_ ]?in|advance[-_ ]?notice|prior[-_ ]?notice|intention[-_ ]?of[-_ ]?sale|sale[-_ ]?of[-_ ]?shares?|auction|agm|sgm|egm|साधारण[- ]?सभा|book[- ]?closure|लाभांश|बोनस|हकप्रद|प्रमोटर|लिलाम|लक[- ]?इन|अग्रिम[-_ ]?सूचना|शेयर[- ]?बिक्री|सेयर[- ]?बिक्री|बिक्री[- ]?गर्ने[- ]?मनसाय)/i;
const DIVIDEND_TIED_RE = /(dividend|bonus|right|लाभांश|बोनस|हकप्रद)/i;
const NON_NEWS_TITLE_RE = /^(featured|opinion|editorial|interview|analysis)\b|बहस|अन्तर्वार्ता/i;

// BS calendar for converting Nepali event dates to AD (loaded from the
// site's own bs-calendar.js so there is a single canonical dataset).
let BSCal = null;
function bsCal() {
  if (BSCal) return BSCal;
  const src = fs.readFileSync(path.join(ROOT, 'js', 'bs-calendar.js'), 'utf8');
  const window = {};
  (new Function('window', src))(window);
  BSCal = window.BSCal;
  return BSCal;
}
function bsToAdStr(y, m, d) {
  try {
    const ad = bsCal().bsToAd(y, m, d);
    return ad.y + '-' + String(ad.m).padStart(2, '0') + '-' + String(ad.d).padStart(2, '0');
  } catch { return null; }
}
function currentBsYear() {
  // today in NPT -> BS year, used when a notice gives month+day without a year
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number);
  return bsCal().adToBs(y, m, d).y;
}
const BS_MONTHS = ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const BS_MONTH_RE = new RegExp('\\b(' + BS_MONTHS.join('|') + ')\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?', 'gi');

// Pull the actionable event date out of a notice page: book-closure date,
// application deadline, or meeting date. Prefers dates sitting next to the
// relevant keyword; converts BS dates to AD. Returns { date, type, label }
// or null when nothing reliable is found.
function extractEventDate(pageText, kind) {
  const text = ' ' + pageText.replace(/\s+/g, ' ') + ' ';
  const cands = [];
  let m;
  BS_MONTH_RE.lastIndex = 0;
  while ((m = BS_MONTH_RE.exec(text))) {
    const mi = BS_MONTHS.indexOf(m[1]);
    const day = parseInt(m[2], 10);
    if (mi < 0 || day < 1 || day > 32) continue;
    let year = m[3] ? parseInt(m[3], 10) : currentBsYear();
    if (year < 2000) year += 2000; // 2-digit year guard
    if (year < 2070 || year > 2090) continue;
    const ad = bsToAdStr(year, mi + 1, day);
    if (!ad) continue;
    const ctx = text.slice(Math.max(0, m.index - 120), m.index + 120).toLowerCase();
    let type = null;
    if (/book[- ]?closure/.test(ctx)) type = 'book-closure';
    else if (/deadline|last date|closing date|apply|application/i.test(ctx)) type = 'deadline';
    else if (/meeting|\bagm\b|\bsgm\b|\begm\b|सभा/.test(ctx)) type = 'meeting';
    cands.push({ date: ad, type, idx: m.index, raw: m[0].trim() });
  }
  // AD dates, only when tied to an event keyword nearby
  const adRe = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = adRe.exec(text))) {
    const ctx = text.slice(Math.max(0, m.index - 120), m.index + 120).toLowerCase();
    if (!/book[- ]?closure|deadline|last date|meeting|\bagm\b|\bsgm\b|closing date/.test(ctx)) continue;
    let type = null;
    if (/book[- ]?closure/.test(ctx)) type = 'book-closure';
    else if (/deadline|last date|closing date/.test(ctx)) type = 'deadline';
    else type = 'meeting';
    cands.push({ date: m[0], type, idx: m.index, raw: m[0] });
  }
  if (!cands.length) return null;
  // prefer a candidate whose type matches the notice kind
  const want = kind === 'right-share' ? 'deadline' : kind === 'agm-sgm' ? 'meeting' : 'book-closure';
  cands.sort((a, b) => ((b.type === want) - (a.type === want)) || (a.idx - b.idx));
  const best = cands[0];
  const labels = { 'book-closure': 'Book closure', 'deadline': 'Deadline', 'meeting': 'Meeting' };
  return { date: best.date, type: best.type || want, label: (labels[best.type || want] || 'Date') + ': ' + best.date };
}

const NEWS_PORTALS = [
  { source: 'sharesansar', url: 'https://www.sharesansar.com/' },
  { source: 'arthasansar', url: 'https://www.arthasansar.com/' },
  { source: 'bizmandu', url: 'https://www.bizmandu.com/' },
  { source: 'onlinekhabar-en', url: 'https://english.onlinekhabar.com/' },
  { source: 'onlinekhabar-np', url: 'https://www.onlinekhabar.com/' },
  { source: 'merolagani', url: 'https://merolagani.com/' },
  { source: 'gdpnepal', url: 'https://gdpnepal.com/' },
  { source: 'aarthikvoice', url: 'https://aarthikvoice.com/' },
  { source: 'bittiyapost', url: 'https://bittiyapost.com/' },
];
const ARTICLE_URL_RE = {
  'sharesansar': /\/(newsdetail|eventdetail|announcementdetail)\//,
  'arthasansar': /\/news\//,
  'bizmandu': /\/content\//,
  'onlinekhabar-en': /\/20\d\d\//,
  'onlinekhabar-np': /\/20\d\d\/\d\d\/\d{4,}\//,
  'merolagani': /NewsDetail\.aspx\?newsID=\d+/i,
  'gdpnepal': /\/archives\/\d+\/?$/,
  'aarthikvoice': /\/[^/"]+-\d{4,}\/?$/,
  'bittiyapost': /\/news\/20\d\d\//,
};
const FRESH_DAYS = 4;

function curl(url, binary) {
  const args = ['-sL', '--max-time', '35', '-A', UA, url];
  const buf = execFileSync('curl', args, { maxBuffer: 8 * 1024 * 1024 });
  return binary ? buf : buf.toString('utf8');
}
const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

function isTriggerText(text) {
  return CORE_RE.test(text);
}
function kindOf(text) {
  const divTied = DIVIDEND_TIED_RE.test(text);
  if (/right|हकप्रद/i.test(text)) return 'right-share';
  if (/bonus|बोनस/i.test(text)) return 'bonus-share';
  if (/\b(agm|sgm|egm)\b|साधारण[- ]?सभा/i.test(text) && !divTied) return 'agm-sgm';
  if (/promoter|प्रमोटर|lock[-_ ]?in|लक[- ]?इन|advance[-_ ]?notice|prior[-_ ]?notice|अग्रिम[- ]?सूचना|intention[-_ ]?of[-_ ]?sale|sale[-_ ]?of[-_ ]?shares?|शेयर[- ]?बिक्री|सेयर[- ]?बिक्री|बिक्री[- ]?गर्ने[- ]?मनसाय/i.test(text)) return 'promoter-share';
  if (/auction|लिलाम/i.test(text)) return 'auction';
  if (/book[- ]?closure/i.test(text) && !divTied) return 'book-closure';
  return 'dividend';
}
function slugTitle(abs) {
  try {
    const seg = new URL(abs).pathname.split('/').filter(Boolean).pop() || '';
    const words = seg.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/[_-]+/g, ' ').trim();
    return words.length > 15 ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  } catch { return ''; }
}
function storyKeyOf(item) {
  if (item.symbol) return item.kind + '|' + item.symbol;
  const t = (item.title || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]/gi, '').slice(0, 50);
  return item.kind + '|t:' + t;
}
function extractEventLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /\/eventdetail\/([a-z0-9-]+?)-(\d{4}-\d{2}-\d{2})/g;
  let m;
  while ((m = re.exec(html))) {
    const key = m[1] + '|' + m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slug: m[1], date: m[2], url: `https://www.sharesansar.com/eventdetail/${m[1]}-${m[2]}` });
  }
  return out;
}
function extractPortalNews(html, portal) {
  const out = [];
  const seen = new Set();
  const urlRe = ARTICLE_URL_RE[portal.source] || /./;
  const re = /<a[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]{1,1200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[2].trim();
    if (!href || /^(javascript:|mailto:|#)/i.test(href)) continue;
    let abs;
    try { abs = new URL(href, portal.url).href; } catch { continue; }
    if (!/^https?:/i.test(abs)) continue;
    try {
      const base = new URL(portal.url).hostname.replace(/^www\./, '');
      if (!new URL(abs).hostname.replace(/^www\./, '').endsWith(base)) continue;
    } catch { continue; }
    if (!urlRe.test(abs)) continue;
    const text0 = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^[0-9१२३४५६७८९०]+\s*[.)]\s*/, '');
    let text = text0;
    if (text.length < 30) { const st = slugTitle(abs); if (st) text = st; }
    if (text.length < 15) continue;
    if (NON_NEWS_TITLE_RE.test(text)) continue;
    const hay = abs + ' ' + text;
    if (!isTriggerText(hay)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const symM = text.match(/[[(]([A-Z0-9]{2,12})[\])]\s*$/) || text.match(/[[(]([A-Z0-9]{2,12})[\])]/);
    out.push({
      source: portal.source, url: abs, title: text.slice(0, 220),
      symbol: symM ? symM[1] : null, kind: kindOf(hay), officialPdf: null,
    });
  }
  return out;
}
function enrichPage(ev) {
  const html = curl(ev.url, false);
  const titleM = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s*-\s*\|\|\s*ShareSansar\s*\|\|.*$/i, '').trim() : (ev.slug || ev.url);
  const symM = title.match(/\[([A-Z0-9]{2,12})\]\s*$/) || title.match(/\[([A-Z0-9]{2,12})\]/);
  const pdfs = html.match(/https:\/\/www\.nepalstock\.com\/api\/nots\/[^\s"'<>]+/g) || [];
  const full = pdfs.filter((u) => !u.includes('...')).sort((a, b) => b.length - a.length)[0] || null;
  const kind = kindOf(ev.slug || ev.url);
  const pageText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const evt = extractEventDate(pageText, kind);
  return {
    ...ev, kind, title,
    symbol: symM ? symM[1] : null,
    officialPdf: full ? full.replace(/&amp;/g, '&') : null,
    facts: evt ? { eventDate: evt.date, eventDateType: evt.type, eventDateLabel: evt.label } : {},
  };
}
function pdfOk(url) {
  try {
    const buf = curl(url, true);
    return buf.length > 1000 && buf.slice(0, 5).toString() === '%PDF-';
  } catch { return false; }
}

function main() {
  const store = loadJson(STORE, { updated: null, count: 0, items: [] });
  const seenKeys = new Set((store.items || []).map((i) => i.storyKey).filter(Boolean));
  const universe = loadJson(UNI, null);
  const names = {};
  if (universe && universe.symbols) for (const u of universe.symbols) names[u.s] = u.n;

  const cutoff = new Date(Date.now() - FRESH_DAYS * 864e5).toISOString().slice(0, 10);
  const events = [];
  for (const portal of NEWS_PORTALS) {
    let html;
    try { html = curl(portal.url, false); }
    catch (e) { console.error('portal fetch failed:', portal.source, e.message); continue; }
    if (portal.source === 'sharesansar') {
      for (const ev of extractEventLinks(html)) {
        if (ev.date < cutoff) continue;
        if (isTriggerText(ev.slug)) {
          ev.source = 'sharesansar';
          events.push(ev);
        }
      }
    }
    // Portal news items are only useful if they are announcementdetail
    // mirrors carrying an official PDF.
    for (const n of extractPortalNews(html, portal)) {
      if (!/\/announcementdetail\//.test(n.url)) continue;
      events.push({ ...n, slug: n.url, date: n.foundAt ? n.foundAt.slice(0, 10) : null });
    }
  }

  let added = 0;
  const now = new Date().toISOString();
  for (const ev of events) {
    let item;
    try { item = enrichPage(ev); }
    catch (e) { console.error('enrich failed:', ev.url, e.message); continue; }
    if (!item.officialPdf) continue;
    const sk = storyKeyOf(item);
    if (seenKeys.has(sk)) continue;
    if (!pdfOk(item.officialPdf)) { console.error('pdf not verified:', item.title.slice(0, 60)); continue; }
    store.items.push({
      kind: item.kind, symbol: item.symbol,
      company: (item.symbol && names[item.symbol]) || null,
      headline: item.title,
      announced: item.date || now.slice(0, 10),
      officialPdf: item.officialPdf,
      source: 'ShareSansar official-notice mirror', sourceUrl: item.url,
      facts: item.facts || {}, seenKey: null, storyKey: sk, verifiedAt: now,
    });
    seenKeys.add(sk);
    added++;
    console.log('ADDED', item.kind, item.symbol || '-', item.title.slice(0, 60));
  }
  store.items.sort((a, b) => String(b.announced).localeCompare(String(a.announced)));
  if (added) {
    store.updated = now;
    store.count = store.items.length;
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
  }
  console.log(JSON.stringify({ added, total: store.items.length }));
}

if (require.main === module) main();

module.exports = { enrichPage, extractEventDate, kindOf, bsToAdStr };
