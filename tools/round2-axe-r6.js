// ROUND 2 / R6 — axe color-contrast runner (localhost only).
//
// Serves NO pages itself: point it at a static server rooted at the repo
// (e.g. `python3 -m http.server 8901` from the repo root) and it loads
// each of the 5 core pages in dark + light, runs axe-core's
// color-contrast rule only, and writes a JSON report.
//
//   node tools/round2-axe-r6.js [baseUrl] [outJson]
//
// Local (this VM): playwright-core + a cached Chromium headless shell
//   CHROME_EXE=/home/hatch/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell \
//     node tools/round2-axe-r6.js http://127.0.0.1:8901 /tmp/r6axe/axe.json
// CI (.github/workflows/round2-r6-a11y.yml): `playwright` package +
// `npx playwright install chromium`; no CHROME_EXE needed.
//
// Theme control: the site's pre-paint snippet reads localStorage
// "sk-theme", so the runner presets it AND sets data-theme/data-nd-ed
// before first paint via addInitScript. Dark is the default; light is
// the explicit opt-in. Versions are printed for the evidence record.
const fs = require('fs');

const PAGES = [
  ['decode', '/nepse-decode/'],
  ['screener', '/nepse-screener/'],
  ['sectors', '/nepse-sectors/'],
  ['brokers', '/nepse-brokers/'],
  ['daily', '/nepse-daily/'],
];

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8901';
  const out = process.argv[3] || 'axe-r6.json';
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    ({ chromium } = require('playwright-core'));
  }
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  console.log('axe-core', require('axe-core/package.json').version);
  const launchOpts = { args: ['--no-sandbox'] };
  if (process.env.CHROME_EXE) launchOpts.executablePath = process.env.CHROME_EXE;
  const browser = await chromium.launch(launchOpts);
  const results = {};
  for (const [name, p] of PAGES) {
    for (const theme of ['dark', 'light']) {
      const key = `${name}/${theme}`;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.addInitScript((t) => {
        try { localStorage.setItem('sk-theme', t); } catch (e) {}
        document.documentElement.setAttribute('data-theme', t);
        if (t === 'light') document.documentElement.setAttribute('data-nd-ed', 'light');
      }, theme);
      try {
        await page.goto(base + p, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(4000);
        await page.evaluate(axeSource + '\nwindow.__axeReady = true;');
        const res = await page.evaluate(async () => axe.run(document, { runOnly: ['color-contrast'] }));
        const nodes = [];
        for (const v of (res.violations || []).filter((x) => x.id === 'color-contrast')) {
          for (const n of v.nodes) {
            const d = (n.any || []).map((a) => a.data).filter(Boolean);
            nodes.push({ target: n.target, html: (n.html || '').slice(0, 200),
              fg: d.map((x) => x.fgColor).join(','), bg: d.map((x) => x.bgColor).join(','),
              ratio: d.map((x) => x.contrastRatio).join(','), fontSize: d.map((x) => x.fontSize).join(','),
              expected: d.map((x) => x.expectedContrastRatio).join(',') });
          }
        }
        results[key] = { url: base + p, theme, violations: nodes.length ? 1 : 0, nodes: nodes.length, nodeList: nodes, error: null };
        console.log(key, 'nodes=', nodes.length);
      } catch (e) {
        results[key] = { url: base + p, theme, violations: -1, nodes: -1, nodeList: [], error: String(e).slice(0, 500) };
        console.log(key, 'ERROR', String(e).slice(0, 200));
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  await browser.close();
  console.log('wrote', out);
})();
