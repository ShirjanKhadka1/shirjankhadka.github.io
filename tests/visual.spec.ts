/**
 * tests/visual.spec.ts — visual regression on key pages.
 *
 * Full-page screenshots at desktop (1440x900) and mobile (390x844).
 * Baselines live in tests/__snapshots__/ and are reviewed in PRs.
 *
 * Regenerate baselines intentionally only:
 *   UPDATE_SNAPSHOTS=1 npx playwright test visual --update-snapshots
 * Never blind-update: inspect the diff, confirm the change is intended.
 */
import { test, expect } from '@playwright/test';

const PAGES = [
  '/', '/nepse-decode/', '/nepse-chart/', '/nepse-screener/',
  '/nepse-trending/', '/nepse-value/', '/nepse-brokers/', '/blog/',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    test(`visual ${vp.name} ${p}`, async ({ browser }) => {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
      // let charts/badges settle; hide the live clock-ish bits that flake
      await page.waitForTimeout(2500);
      await expect(page).toHaveScreenshot(
        `${p.replace(/\//g, '_') || 'home'}-${vp.name}.png`,
        { fullPage: true, maxDiffPixelRatio: 0.02, timeout: 30000 }
      );
      await page.close();
    });
  }
}
