/* Fetch yonepse's open dividend-history API (MIT-licensed open data on
 * GitHub Pages) and normalize it to our dividend-row shape.
 *
 * This is the SECOND source for the Investment Calendar's Dividends tab,
 * alongside the ShareSansar crawl (tools/build-corp-history.js). The two are
 * unioned (deduped) at page-build time in build-symbol-pages.js, so the
 * calendar never depends on a single source.
 *
 * yonepse record layout: [symbolIndex, bonus, cash, total, announce,
 *   bookclose, fiscalYear]; symbols[] maps index -> symbol.
 *
 * Usage: node tools/fetch-yonepse-dividends.js
 * Output: nepse-chart/data/div-history-yonepse.json
 */
const fs = require('fs');
const path = require('path');

const URL = 'https://shubhamnpk.github.io/yonepse/data/dividend/history.json';
const OUT = path.join(__dirname, '..', 'nepse-chart', 'data', 'div-history-yonepse.json');

async function main() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nepse-decode/1.0)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + URL);
  const d = await res.json();
  if (!Array.isArray(d.symbols) || !Array.isArray(d.records)) {
    throw new Error('unexpected yonepse payload shape');
  }
  const companies = {};
  for (const rec of d.records) {
    const sym = d.symbols[rec[0]];
    if (!sym) continue;
    const row = {
      bonus_share: rec[1] == null ? null : String(rec[1]),
      cash_dividend: rec[2] == null ? null : String(rec[2]),
      total_dividend: rec[3] == null ? null : String(rec[3]),
      announcement_date: rec[4] || null,
      distribution_date: null,
      bookclose_date: rec[5] || null,
      bonus_listing_date: null,
      year: rec[6] || null,
      status: null,
    };
    (companies[sym] = companies[sym] || []).push(row);
  }
  const nRec = Object.values(companies).reduce((n, a) => n + a.length, 0);
  fs.writeFileSync(OUT, JSON.stringify({
    asof: d.scraped_at || new Date().toISOString(),
    source: 'yonepse open API (MIT)',
    companies,
  }, null, 1) + '\n');
  console.log(`[yonepse-dividends] ${Object.keys(companies).length} symbols, ${nRec} records -> ${OUT}`);
}

main().catch((e) => { console.error('[yonepse-dividends] FAILED:', e.message); process.exit(1); });
