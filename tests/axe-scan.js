/**
 * tests/axe-scan.js — axe-core accessibility scan with a ratchet.
 *
 * Compares per-page, per-rule violation node counts against
 * tests/axe-baseline.json (the Phase 0 baseline). FAILS (exit 1) when:
 *   - any rule's node count INCREASED vs baseline, or
 *   - a NEW rule appears on a page, or
 *   - a page fails to scan.
 * Decreases pass (improvement is always welcome). Final DoD is zero
 * violations; the ratchet only prevents regressions until Phase 7.
 *
 * Run: BASE_URL=http://localhost:8080 node axe-scan.js
 */
const { chromium } = require('playwright');
const axe = require('axe-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const PAGES = ['/', '/nepse-decode/', '/nepse-chart/', '/nepse-screener/', '/nepse-brokers/', '/blog/', '/status/'];
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'axe-baseline.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch();
  const out = {};
  const regressions = [];
  let scanErrors = 0;
  for (const p of PAGES) {
    const page = await browser.newPage();
    try {
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
      const base = baseline[p] || {};
      for (const [rule, n] of Object.entries(counts)) {
        const b = base[rule];
        if (b === undefined) regressions.push(`${p}: NEW rule ${rule} (${n} nodes)`);
        else if (n > b) regressions.push(`${p}: ${rule} increased ${b} -> ${n} nodes`);
      }
      const improved = Object.keys(base).filter((r) => (counts[r] || 0) < base[r]);
      console.log(p, 'rules:', Object.keys(counts).length, improved.length ? `(improved: ${improved.join(', ')})` : '');
    } catch (e) {
      scanErrors++;
      out[p] = [{ id: 'scan-error', impact: 'n/a', description: String(e).slice(0, 200), nodes: 0 }];
      console.error(p, 'SCAN ERROR:', e.message);
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'axe-results.json'), JSON.stringify(out, null, 2));
  if (scanErrors) {
    console.error(`axe ratchet FAILED: ${scanErrors} page(s) failed to scan`);
    process.exit(1);
  }
  if (regressions.length) {
    console.error('axe ratchet FAILED — regressions vs Phase 0 baseline:');
    for (const r of regressions) console.error('  - ' + r);
    process.exit(1);
  }
  console.log('axe ratchet PASSED: no rule increased vs baseline');
})().catch((e) => { console.error(e); process.exit(1); });
