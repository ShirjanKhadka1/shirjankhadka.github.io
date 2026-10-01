/**
 * tests/smoke.spec.ts — hard quality gates (no failure masking).
 *
 * - HTTP 200 on every in-scope page
 * - zero pageerrors / console errors / failed SAME-ORIGIN requests
 * - no residual "Loading..." text after the page settles
 * - no horizontal overflow at 320/360/390/768/1024/1440/1920 px
 * - any SSR session date on a page must equal the manifest session date
 *   (pages without an SSR date marker are REPORTED, not failed — Phase 2
 *   adds manifest-derived SSR dates everywhere)
 *
 * Any failure fails the test run. A JSON report is always written for the
 * CI artifact upload.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';

const PAGES = [
  '/', '/nepse-decode/', '/nepse-chart/', '/nepse-screener/', '/nepse-trending/',
  '/nepse-value/', '/nepse-brokers/', '/nepse-sectors/', '/nepse-news/',
  '/nepse-watchlist/', '/nepse-portfolio/', '/nepse-simulator/', '/nepse-reports/',
  '/nepse-actions/', '/nepse-signals/momentum/', '/nepse-signals/trend-relay/',
  '/nepse-signals/reversal/', '/nepse-signals/methodology/',
  '/stocks/', '/stocks/NBL/',
  '/blog/', '/blog/nepse-three-day-slide-explained/', '/blog/nepal-bank-nbl-company-analysis/',
  '/status/',
];
const WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];

const report: Record<string, any> = { base: BASE, pages: {} };

function pageReport(p: string) {
  if (!report.pages[p]) report.pages[p] = { errors: [], warnings: [] };
  return report.pages[p];
}

function writeReport() {
  fs.writeFileSync(path.join(__dirname, 'smoke-report.json'), JSON.stringify(report, null, 2));
}

test.afterAll(() => writeReport());

test('all in-scope pages return HTTP 200', async ({ request }) => {
  for (const p of PAGES) {
    const res = await request.get(p);
    expect(res.status(), `${p} HTTP status`).toBe(200);
  }
});

test('zero pageerrors, console errors and failed same-origin requests', async ({ browser }) => {
  test.setTimeout(300000); // 24 pages x (networkidle + 2s settle); 60s default is too small
  const page = await browser.newPage();
  const failures: string[] = [];
  for (const p of PAGES) {
    const errors: string[] = [];
    page.removeAllListeners('console');
    page.removeAllListeners('pageerror');
    page.removeAllListeners('requestfailed');
    page.removeAllListeners('response');
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const loc = msg.location();
        const url = loc && loc.url ? loc.url : '';
        // Ignore 404 console noise for optional data files (handled gracefully by the page)
        if (/404/.test(text) && /(intraday\.json|jobs\.json)/.test(url)) return;
        // Ignore third-party resource load failures (fonts, CDNs) — environmental, not site defects.
        if (/Failed to load resource/.test(text)) {
          if (url && !url.startsWith(BASE) && !url.includes('localhost') && !url.includes('127.0.0.1')) return;
          if (!url && /fonts\.googleapis|fonts\.gstatic|jsdelivr|unpkg|cloudflare/i.test(text)) return;
        }
        errors.push('console.error: ' + text.slice(0, 300));
      }
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 300)));
    page.on('requestfailed', (req) => {
      const u = req.url();
      if (u.startsWith(BASE)) errors.push('requestfailed: ' + u.slice(0, 200));
      else pageReport(p).warnings.push('third-party requestfailed: ' + u.slice(0, 120));
    });
    page.on('response', (res) => {
      const u = res.url();
      // Optional data files (e.g. intraday.json before the market-hours poller runs,
      // jobs.json pipeline status) 404 gracefully with user-friendly messages; not defects.
      if (u.startsWith(BASE) && res.status() >= 400 && !/\/(data\/intraday\.json|data\/jobs\.json)$/.test(u)) {
        errors.push(`HTTP ${res.status()}: ` + u.slice(0, 200));
      }
    });
    await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    pageReport(p).errors.push(...errors);
    if (errors.length) failures.push(`${p}:\n  - ` + errors.join('\n  - '));
  }
  await page.close();
  expect(failures, 'pages with JS/network errors').toEqual([]);
});

test('no residual "Loading..." text after settle', async ({ browser }) => {
  test.setTimeout(300000); // 24 pages x (networkidle + 2s settle)
  const page = await browser.newPage();
  const stuck: string[] = [];
  for (const p of PAGES) {
    await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText || '');
    // "Loading…" / "Loading..." left visible means client JS never resolved data
    if (/Loading[….]{1,3}/.test(text)) stuck.push(p);
  }
  await page.close();
  expect(stuck, 'pages with residual Loading text').toEqual([]);
});

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px`, async ({ browser }) => {
    test.setTimeout(300000); // 24 pages x (networkidle + 1.2s settle)
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const bad: string[] = [];
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > width + 1) bad.push(`${p}: scrollWidth=${sw}`);
    }
    await page.close();
    expect(bad, `horizontal overflow at ${width}px`).toEqual([]);
  });
}

test('SSR session dates match the manifest session date', async ({ request, browser }) => {
  test.setTimeout(180000); // 24 page loads
  const mres = await request.get('/data/manifest.json');
  expect(mres.status(), 'canonical manifest reachable').toBe(200);
  const manifest = await mres.json();
  const session: string = manifest.session_date;
  expect(session, 'manifest has session_date').toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const page = await browser.newPage();
  const mismatched: string[] = [];
  const noMarker: string[] = [];
  // SSR date patterns currently seen on data pages
  const patterns = [
    /session\s+(\d{4}-\d{2}-\d{2})/i,
    /data as of\s+(\d{4}-\d{2}-\d{2})/i,
    /as of\s+(\d{4}-\d{2}-\d{2})/i,
  ];
  for (const p of PAGES) {
    await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const html = await page.content();
    // strip client-rendered badge output: only the raw SSR HTML counts
    const ssr = html.replace(/<div data-freshness-badge[\s\S]*?<\/div>/g, '');
    let found: string | null = null;
    for (const re of patterns) {
      const m = ssr.match(re);
      if (m) { found = m[1]; break; }
    }
    if (!found) { noMarker.push(p); continue; }
    if (found !== session) mismatched.push(`${p}: SSR date ${found} != manifest ${session}`);
  }
  await page.close();
  console.log('pages without an SSR date marker (Phase 2 adds them):', noMarker);
  expect(mismatched, 'SSR dates disagreeing with manifest').toEqual([]);
});
