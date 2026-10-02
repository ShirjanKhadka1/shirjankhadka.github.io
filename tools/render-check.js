#!/usr/bin/env node
/**
 * tools/render-check.js — Phase 5 watchdog render verification.
 *
 * Loads the live Nepse Decode page in headless Chromium, waits for the
 * client-side data pipeline to settle, then verifies that market data
 * actually rendered (not just that the JS files exist).
 *
 * Fails (exit 1) if:
 *   - "Market data is temporarily unavailable" is present after settle time
 *   - The NEPSE index value is still a dash/empty
 *   - Any captured window.onerror entries exist
 *
 * Usage: node tools/render-check.js [url]
 * Requires: playwright (npx playwright install chromium) or system chromium.
 */
'use strict';

const URL = process.argv[2] || 'https://shirjankhadka.com.np/nepse-decode/';
const SETTLE_MS = 20000;

async function main() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('render-check: playwright not installed. Run: npm i playwright && npx playwright install chromium');
    process.exit(2);
  }

  const browser = await playwright.chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Capture client-side errors for the report.
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push('pageerror: ' + (err.message || err)));
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push('console.error: ' + msg.text().slice(0, 300));
  });

  // Inject an error collector before page scripts run.
  await page.addInitScript(() => {
    window.__nepseErrors = [];
    window.addEventListener('error', e => {
      window.__nepseErrors.push((e.message || 'unknown') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
    });
  });

  console.log('render-check: loading ' + URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(SETTLE_MS);

  const result = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    const unavailable = body.includes('Market data is temporarily unavailable');
    const idxEl = document.getElementById('d2IdxVal');
    const idxVal = idxEl ? idxEl.textContent.trim() : '';
    const hasIndex = idxVal && idxVal !== '–' && idxVal !== '-' && /\d/.test(idxVal);
    return {
      unavailable,
      idxVal: idxVal.slice(0, 20),
      hasIndex,
      clientErrors: (window.__nepseErrors || []).slice(0, 10),
    };
  });

  await browser.close();

  console.log('render-check result:', JSON.stringify(result, null, 2));
  if (jsErrors.length) {
    console.log('JS errors captured:');
    jsErrors.slice(0, 10).forEach(e => console.log('  - ' + e));
  }

  let failed = false;
  if (result.unavailable) { console.error('FAIL: page shows "temporarily unavailable"'); failed = true; }
  if (!result.hasIndex) { console.error('FAIL: index value missing (got: "' + result.idxVal + '")'); failed = true; }
  if (result.clientErrors.length) { console.error('FAIL: client JS errors: ' + result.clientErrors.join(' | ')); failed = true; }
  if (jsErrors.length) { console.error('FAIL: page/console errors captured'); failed = true; }

  if (failed) {
    console.error('render-check: FAILED');
    process.exit(1);
  }
  console.log('render-check: PASSED');
}

main().catch(e => { console.error('render-check crashed:', e.message); process.exit(2); });
