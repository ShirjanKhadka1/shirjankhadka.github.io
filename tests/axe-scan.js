/**
 * tests/axe-scan.js — axe-core accessibility scan with a ratchet.
 *
 * Compares per-page, per-rule violation node counts against
 * tests/axe-baseline.json. FAILS (exit 1) when:
 *   - any rule's node count INCREASED vs baseline, or
 *   - a NEW rule appears on a page, or
 *   - a page fails to scan.
 * Decreases pass (improvement is always welcome).
 *
 * To establish a new baseline: ESTABLISH_BASELINE=1 node axe-scan.js
 * This writes the current results to axe-baseline.json without comparing.
 *
 * Run: BASE_URL=http://localhost:8080 node axe-scan.js
 */
const { chromium } = require('playwright');
const axe = require('axe-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const ESTABLISH = process.env.ESTABLISH_BASELINE === '1';

const PAGES = [
  '/',
  '/nepse-decode/', '/nepse-chart/', '/nepse-screener/', '/nepse-brokers/',
  '/nepse-trending/', '/nepse-value/', '/nepse-news/', '/nepse-sectors/',
  '/nepse-reports/', '/nepse-actions/', '/nepse-alpha/', '/nepse-dashboard/',
  '/nepse-fundamentals/', '/nepse-portfolio/', '/nepse-simulator/', '/nepse-watchlist/',
  '/nepali-date-converter/', '/nepali-date-today/', '/kundali/',
  '/nepse-signals/momentum/', '/nepse-signals/trend-relay/',
  '/nepse-signals/reversal/', '/nepse-signals/methodology/',
  '/blog/',
  '/blog/nepse-capital-gains-tax-cut-explained/',
  '/blog/nepal-bank-nbl-company-analysis/',
  '/stocks/NABIL/', '/stocks/NBL/', '/stocks/SWBBL/',
  '/status/', '/corrections/', '/editorial-standards/', '/ownership/',
];

const baseline = ESTABLISH ? {} : JSON.parse(fs.readFileSync(path.join(__dirname, 'axe-baseline.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch();
  const out = {};
  const regressions = [];
  let scanErrors = 0;
  for (const p of PAGES) {
    const page = await browser.newPage();
    try {
      // Deterministic data: intercept JSON requests and serve frozen fixtures
      // (same pattern as visual.spec.ts). Without this, pages that fetch repo
      // JSON depend on server timing — the heatmap may or may not render,
      // making the scan non-deterministic across environments.
      // NOTE: use regex /\.json(\?|$)/ (not '**/*.json' glob) because data URLs
      // carry cache-busting query strings (?v=...) which the glob does not match.
      await page.route(/\.json(\?|$)/, async (route) => {
        const url = new URL(route.request().url());
        const fixturePath = path.join(
          __dirname, 'fixtures', ...url.pathname.split('/').filter(Boolean)
        );
        if (fs.existsSync(fixturePath)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: fs.readFileSync(fixturePath),
          });
        } else {
          await route.continue();
        }
      });
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1500);
      await page.addScriptTag({ content: axe.source });
      const results = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
      const counts = {};
      for (const v of results.violations) counts[v.id] = (counts[v.id] || 0) + v.nodes.length;
      out[p] = results.violations.map((v) => ({
        id: v.id, impact: v.impact, description: v.description,
        nodes: v.nodes.length, helpUrl: v.helpUrl,
      }));
      if (!ESTABLISH) {
        const base = baseline[p] || {};
        for (const [rule, n] of Object.entries(counts)) {
          const b = base[rule];
          if (b === undefined) regressions.push(`${p}: NEW rule ${rule} (${n} nodes)`);
          else if (n > b) regressions.push(`${p}: ${rule} increased ${b} -> ${n} nodes`);
        }
        const improved = Object.keys(base).filter((r) => (counts[r] || 0) < base[r]);
        console.log(p, 'rules:', Object.keys(counts).length, improved.length ? `(improved: ${improved.join(', ')})` : '');
      } else {
        console.log(p, 'rules:', Object.keys(counts).length, 'nodes:', Object.values(counts).reduce((a,b) => a+b, 0));
      }
    } catch (e) {
      scanErrors++;
      out[p] = [{ id: 'scan-error', impact: 'n/a', description: String(e).slice(0, 200), nodes: 0 }];
      console.error(p, 'SCAN ERROR:', e.message);
    }
    await page.close();
  }
  await browser.close();

  if (ESTABLISH) {
    const newBaseline = {};
    for (const [p, violations] of Object.entries(out)) {
      newBaseline[p] = {};
      for (const v of violations) {
        if (v.id !== 'scan-error') newBaseline[p][v.id] = v.nodes;
      }
    }
    fs.writeFileSync(path.join(__dirname, 'axe-baseline.json'), JSON.stringify(newBaseline, null, 2));
    fs.writeFileSync(path.join(__dirname, 'axe-results.json'), JSON.stringify(out, null, 2));
    console.log(`\nBaseline established: ${Object.keys(newBaseline).length} pages`);
    if (scanErrors) {
      console.error(`WARNING: ${scanErrors} page(s) failed to scan`);
      process.exit(1);
    }
    return;
  }

  fs.writeFileSync(path.join(__dirname, 'axe-results.json'), JSON.stringify(out, null, 2));
  if (scanErrors) {
    console.error(`axe ratchet FAILED: ${scanErrors} page(s) failed to scan`);
    process.exit(1);
  }
  if (regressions.length) {
    console.error('axe ratchet FAILED — regressions vs baseline:');
    for (const r of regressions) console.error('  - ' + r);
    process.exit(1);
  }
  console.log('axe ratchet PASSED: no rule increased vs baseline');
})().catch((e) => { console.error(e); process.exit(1); });
