#!/usr/bin/env node
/* Nepse Decode — official announcements collector.
 *
 * Scrapes ShareSansar's /announcement listing (which mirrors official
 * NEPSE company disclosures), matches each item to a listed symbol via
 * universe.json, and writes nepse-chart/data/announcements.json.
 *
 * Each record: { sym, company, title, date, url, src }
 * - url points to the ShareSansar announcement detail page, which embeds
 *   the official NEPSE notice. We attribute; we don't rewrite.
 * - sym may be null when the company name doesn't match the universe;
 *   the UI still shows the item, just without a symbol chip.
 *
 * Node 18+, no npm dependencies. Run: node tools/build-announcements.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'nepse-chart', 'data', 'announcements.json');
const UNIVERSE = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (NepseDecode announcements collector)' };
const SRC_URL = 'https://www.sharesansar.com/announcement';
const MAX_ITEMS = 120;

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: UA, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Company-name core: lowercase, strip suffixes and punctuation.
const SUFFIX = /\b(limited|ltd|bank|finance|hydropower|hydro|power|insurance|microfinance|laghubitta|bittiya|sanstha|capital|securities|investment|company|co|pvt|p\.?ltd)\b\.?/gi;
function coreName(n) {
  return n.toLowerCase().replace(SUFFIX, ' ').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function buildMatcher() {
  const uni = JSON.parse(fs.readFileSync(UNIVERSE, 'utf8'));
  const list = uni.symbols || [];
  return list.map((r) => ({ sym: r.s, name: r.n, core: coreName(r.n) }))
    .filter((r) => r.core.length > 2)
    .sort((a, b) => b.core.length - a.core.length); // longest first
}

function matchSymbol(title, matcher) {
  const t = ' ' + title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ') + ' ';
  for (const m of matcher) {
    if (m.core.length < 3) continue;
    // Whole-phrase match on the core name.
    if (t.includes(' ' + m.core + ' ')) return m;
    // Token-subset match: every significant core token present.
    const toks = m.core.split(' ').filter((w) => w.length > 3);
    if (toks.length >= 2 && toks.every((w) => t.includes(' ' + w))) return m;
  }
  return null;
}

function parseDate(s) {
  // "Tuesday, September 29, 2026" -> 2026-09-29
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const mo = months[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${mo}-${String(m[2]).padStart(2, '0')}`;
}

async function main() {
  const html = await fetch(SRC_URL);
  const matcher = buildMatcher();
  const items = [];
  // Each item: <a href=".../announcementdetail/<slug>"> ... title ... date
  const re = /href="(https:\/\/www\.sharesansar\.com\/announcementdetail\/[^"]+)"[\s\S]{0,2000}?<a[^>]*>([^<]{10,300})<\/a>[\s\S]{0,500}?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})/g;
  // Fallback: find detail links, then nearby title/date.
  const links = [...html.matchAll(/href="(https:\/\/www\.sharesansar\.com\/announcementdetail\/[^"]+)"/g)]
    .map((m) => m[1]);
  const seen = new Set();
  for (const url of links) {
    if (seen.has(url)) continue;
    seen.add(url);
    const pos = html.indexOf(url);
    const window = html.slice(pos, pos + 2500);
    // Title lives in the <a> title attribute or the h4.featured-announcement-title.
    let title = null;
    const attrM = window.match(/title="([^"]{15,400})"/);
    const h4M = window.match(/<h4[^>]*>([^<]{15,400})<\/h4>/);
    if (attrM) title = attrM[1];
    else if (h4M) title = h4M[1];
    if (!title) continue;
    title = stripTags(title);
    if (/fa-bullhorn|announcementdetail/.test(title)) continue;
    const dateM = window.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})/);
    const date = dateM ? parseDate(dateM[1]) : null;
    const hit = matchSymbol(title, matcher);
    items.push({
      sym: hit ? hit.sym : null,
      company: hit ? hit.name : null,
      title,
      date,
      url,
      src: 'ShareSansar',
    });
    if (items.length >= MAX_ITEMS) break;
  }
  // Newest first; undated last.
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // Merge with the existing archive (dedup by URL), keep 90 days.
  let archive = [];
  try { archive = JSON.parse(fs.readFileSync(OUT, 'utf8')).items || []; } catch (e) {}
  const have = new Set(archive.map((i) => i.url));
  for (const it of items) if (!have.has(it.url)) { archive.push(it); have.add(it.url); }
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  archive = archive.filter((i) => !i.date || i.date >= cutoff.toISOString().slice(0, 10));
  archive.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const out = { updated: new Date().toISOString().slice(0, 10), count: archive.length, items: archive.slice(0, 300),
    note: 'Company disclosures mirrored by ShareSansar from official NEPSE notices. Titles and dates as published; symbol matching is best-effort.' };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const matched = items.filter((i) => i.sym).length;
  console.log(`announcements: ${items.length} items, ${matched} symbol-matched -> ${OUT}`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
