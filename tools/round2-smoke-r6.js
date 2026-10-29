// ROUND 2 / R6 — Playwright smoke check (localhost only).
//
// Loads each of the 5 core pages in dark + light from a static server
// rooted at the repo and asserts: HTTP 200, a rendered body (visible
// text), and no page crash. It does NOT assert zero console errors:
// these data pages legitimately log missing-optional-data warnings.
//   node tools/round2-smoke-r6.js [baseUrl]
// Exit 0 = all 10 loads pass; anything else exits 1 with the failure.
const PAGES = [
  ['decode', '/nepse-decode/'],
  ['screener', '/nepse-screener/'],
  ['sectors', '/nepse-sectors/'],
  ['brokers', '/nepse-brokers/'],
  ['daily', '/nepse-daily/'],
];

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8901';
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    ({ chromium } = require('playwright-core'));
  }
  const launchOpts = { args: ['--no-sandbox'] };
  if (process.env.CHROME_EXE) launchOpts.executablePath = process.env.CHROME_EXE;
  const browser = await chromium.launch(launchOpts);
  let failures = 0;
  for (const [name, p] of PAGES) {
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.addInitScript((t) => {
        try { localStorage.setItem('sk-theme', t); } catch (e) {}
        document.documentElement.setAttribute('data-theme', t);
        if (t === 'light') document.documentElement.setAttribute('data-nd-ed', 'light');
      }, theme);
      try {
        const resp = await page.goto(base + p, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2000);
        const text = (await page.evaluate(() => document.body.innerText.length)) || 0;
        const ok = resp && resp.status() === 200 && text > 500;
        console.log(`${name}/${theme} status=${resp && resp.status()} bodyChars=${text} ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) failures++;
      } catch (e) {
        console.log(`${name}/${theme} ERROR ${String(e).slice(0, 200)}`);
        failures++;
      }
      await ctx.close();
    }
  }
  await browser.close();
  if (failures) { console.log(`SMOKE FAIL: ${failures} failing load(s)`); process.exit(1); }
  console.log('SMOKE PASS: 10/10 loads');
})();
