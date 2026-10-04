#!/usr/bin/env node
/* tools/ipo-sebon-watch.js — SEBON prospectus watcher (2026-10-04).
 *
 * Checks SEBON's public prospectus listings for new IPO approvals.
 * New entries are added to data/ipo.json as "upcoming" with SEBON
 * as the verified source. Existing entries are never modified.
 *
 * Run: node tools/ipo-sebon-watch.js [--dry-run]
 * Exit 0: success (or dry-run). Exit 1: fetch/parse failure.
 *
 * Sourcing: SEBON (Securities Board of Nepal) public website only.
 * Tier 1 official source per project data rules. No auth, no bypass —
 * plain HTTPS GET of the public homepage.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const DATA_PATH = path.join(__dirname, '..', 'data', 'ipo.json');
const SEBON_URL = 'https://sebon.gov.np/';
const UA = 'NepseDecode-IPO-Watch/1.0 (https://shirjankhadka.com.np; contact: info@shirjankhadka.com.np)';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Extract prospectus entries from SEBON homepage HTML.
// Entries look like: "Beni Hydropower Project Limited;- General Public"
// or "Prospectus of Shikhar Power Development Ltd.( Local & Foreign Emploment.)"
function extractProspectuses(html) {
  const found = [];
  // Match list items / links containing prospectus-like text
  const liRe = /<li[^>]*>([\s\S]{0,400}?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/prospectus/i.test(text) && text.length > 10 && text.length < 200) {
      const href = (m[1].match(/href="([^"]+)"/) || [])[1] || '';
      found.push({ text, href });
    }
  }
  // Also catch anchor texts directly
  const aRe = /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,200})<\/a>/gi;
  while ((m = aRe.exec(html)) !== null) {
    const text = m[2].replace(/\s+/g, ' ').trim();
    if (/prospectus/i.test(text) && !found.some((f) => f.text === text)) {
      found.push({ text, href: m[1] });
    }
  }
  return found;
}

// Categorize a SEBON prospectus title into our 7 categories.
function categorize(text) {
  const t = text.toLowerCase();
  if (/mutual fund|equity opportunity|mutual/.test(t)) return 'mutual-ipo';
  if (/debenture|bond/.test(t)) return null; // not an equity issue we track
  if (/right/.test(t)) return 'right-share';
  if (/fpo|further public/.test(t)) return 'fpo';
  if (/auction/.test(t)) return 'auction';
  if (/local/.test(t) && /foreign|employment/.test(t)) return 'foreign-ipo';
  if (/local/.test(t)) return 'local-ipo';
  if (/foreign|employment/.test(t)) return 'foreign-ipo';
  if (/general public/.test(t)) return 'ipo';
  return 'ipo'; // default: treat as regular IPO
}

// Derive a symbol-ish key from the company name for dedup.
function keyFor(text) {
  return text.toLowerCase()
    .replace(/prospectus of/i, '')
    .replace(/limited|ltd\.?/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
}

async function main() {
  console.log('[ipo-watch] fetching ' + SEBON_URL);
  const html = await fetch(SEBON_URL);
  const prospects = extractProspectuses(html);
  console.log('[ipo-watch] found ' + prospects.length + ' prospectus entries on SEBON homepage');

  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const seen = new Set();
  Object.values(data.categories).forEach((cat) => {
    (cat.items || []).forEach((it) => {
      if (it.symbol) seen.add(String(it.symbol).toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (it.company) seen.add(String(it.company).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24));
    });
  });

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;

  for (const p of prospects) {
    const cat = categorize(p.text);
    if (!cat) continue;
    const key = keyFor(p.text);
    if (!key || seen.has(key)) continue;

    // Clean company name
    const company = p.text
      .replace(/prospectus of/i, '')
      .replace(/;-.*$/, '')
      .replace(/\(.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Skip generic headers / non-company entries
    if (!company || company.length < 8) continue;
    if (/^prospectus$/i.test(company)) continue;

    const entry = {
      symbol: company.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 10) || 'UNKNOWN',
      company,
      units: null,
      opening_date: null,
      closing_date: null,
      listing_date: null,
      status: 'upcoming',
      issue_manager: null,
      source: 'SEBON',
      source_url: p.href.startsWith('http') ? p.href : 'https://sebon.gov.np' + p.href,
      verified_date: today,
      notes: 'Auto-detected from SEBON prospectus listing. Dates and units pending issue-manager notice.',
    };

    if (!data.categories[cat]) continue;
    if (!data.categories[cat].items) data.categories[cat].items = [];
    data.categories[cat].items.push(entry);
    seen.add(key);
    added++;
    console.log('[ipo-watch] +' + cat + ': ' + company);
  }

  if (added > 0) {
    data.updated = today;
    if (!DRY_RUN) {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
      console.log('[ipo-watch] wrote ' + added + ' new entries to data/ipo.json');
    } else {
      console.log('[ipo-watch] DRY RUN — would add ' + added + ' entries');
    }
  } else {
    console.log('[ipo-watch] no new prospectuses found');
  }
}

main().catch((e) => { console.error('[ipo-watch] FATAL: ' + e.message); process.exit(1); });
