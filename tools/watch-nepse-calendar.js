#!/usr/bin/env node
/* Nepse Decode — NEPSE calendar watcher (V3).
 *
 * Daily: fetches official NEPSE notice sources politely, scans for
 * holiday/closure/special-session announcements, diffs against
 * tools/nepse-holidays.json, and writes a findings report.
 *
 * NEVER auto-applies: every finding is status=unverified and requires the
 * owner's confirmation. The GitHub workflow opens a PR + sends [NEPSE NOTICE]
 * when findings exist.
 *
 * Sources (polite: identifying UA, single fetch per source, backoff):
 *  - ShareSansar announcement mirror (established pattern in
 *    tools/build-announcements.js) for NEPSE holiday notices.
 *  - Direct NEPSE site as fallback.
 * Safety: the calendar INFORMS labels; it never decides whether to fetch.
 * Evidence wins: the pipeline still checks for a real session every weekday.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOLIDAYS = path.join(ROOT, 'tools', 'nepse-holidays.json');
const REPORT = path.join(ROOT, 'tools', 'calendar-watch-report.json');
const UA = 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)';

const SOURCES = [
  'https://www.sharesansar.com/announcement',
];

// English + Nepali holiday/closure keywords.
const KEYWORDS = [
  /holiday/i, /closed/i, /closure/i, /market\s+closed/i, /no\s+trading/i,
  /special\s+session/i, /half[\s-]?day/i, /early\s+close/i,
  /बिदा/, /बन्द/, /सार्वजनिक\s*बिदा/,
];
const FESTIVALS = [
  'dashain', 'tihar', 'chhath', 'christmas', 'lhosar', 'udhauli',
  'dashain', 'tihar', 'छठ', 'दशैं', 'तिहार',
];

function log(...a) { console.log('[calendar-watch]', ...a); }

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

// Very defensive: extract (date-ish, title) pairs near holiday keywords.
function scanNotices(html, sourceUrl) {
  const findings = [];
  // Split into rough item blocks.
  const blocks = html.split(/<tr|<div class="(?:announcement|notice|news)[^"]*"/i).slice(1);
  for (const b of blocks.slice(0, 60)) {
    const text = b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!KEYWORDS.some((re) => re.test(text))) continue;
    // Look for a date near the match.
    const dm = text.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i);
    const link = (b.match(/href="([^"]+)"/) || [])[1] || null;
    findings.push({
      title: text.slice(0, 200),
      date_hint: dm ? dm[0] : null,
      link: link ? new URL(link, sourceUrl).href : null,
      source_url: sourceUrl,
      status: 'unverified',
      notes: 'Keyword match — requires human confirmation against the official NEPSE notice.',
    });
  }
  return findings;
}

function loadHolidays() {
  return JSON.parse(fs.readFileSync(HOLIDAYS, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : REPORT;
  const holidays = loadHolidays();
  const knownDates = new Set((holidays.holidays || []).map((h) => h.date_ad));

  return (async () => {
    const candidates = [];
    const errors = [];
    for (const url of SOURCES) {
      try {
        log('fetching', url);
        const html = await fetchText(url);
        const found = scanNotices(html, url);
        log(`  ${found.length} keyword matches`);
        for (const f of found) candidates.push(f);
      } catch (e) {
        errors.push(`${url}: ${e.message}`);
        log('  ERROR', e.message);
      }
      // polite: pause between sources
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Stale-entry check: unverified entries whose date has passed.
    const today = new Date().toISOString().slice(0, 10);
    const stale = (holidays.holidays || [])
      .filter((h) => h.date_ad < today && h.status === 'unverified')
      .map((h) => h.date_ad);

    const report = {
      checked_at: new Date().toISOString(),
      sources: SOURCES,
      errors,
      candidates: candidates.filter((c) => c.date_hint && !knownDates.has(c.date_hint)),
      stale_unverified: stale,
      weekend_rule: holidays.weekend_rule,
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 1) + '\n');
    const actionable = report.candidates.length + report.stale_unverified.length;
    log(`report written: ${report.candidates.length} new candidates, ${stale.length} stale entries, ${errors.length} errors`);
    // Exit 2 = findings need human review (workflow opens PR + emails).
    process.exit(actionable > 0 ? 2 : 0);
  })().catch((e) => { console.error('WATCHER FAILED:', e.message); process.exit(1); });
}

if (require.main === module) main();
module.exports = { scanNotices };
