/**
 * tests/visual.spec.ts — visual regression on key pages.
 *
 * Full-page screenshots at desktop (1440x900) and mobile (390x844).
 * Baselines live in tests/visual.spec.ts-snapshots/ and are reviewed in PRs.
 *
 * STABILIZATION (2026-10-01): CI renders were non-deterministic due to:
 * - Web fonts loading late (entire page diffed) → wait for document.fonts.ready
 * - Live timestamps ("X minutes ago") → freeze clock to fixed time
 * - Animations/transitions → disable via CSS
 * - Dynamic regions (tickers, live badges) → mask in screenshots
 * - Data files changing → serve frozen fixtures via route interception
 *
 * DATA FREEZING (2026-10-01): PR runs check out the merge commit, which can
 * carry main's newer data files (e.g. nepse-chart/data/live.json) than the PR
 * branch head that baselines were generated from. To keep renders
 * deterministic across branch-head and merge-commit checkouts, ALL JSON data
 * requests are intercepted and served from tests/fixtures/ (frozen copies).
 * Fixtures are committed files, so they are identical in both checkouts.
 * When data intentionally changes, update fixtures + regenerate baselines.
 *
 * Regenerate baselines intentionally only:
 *   UPDATE_SNAPSHOTS=1 npx playwright test visual --update-snapshots
 * Never blind-update: inspect the diff, confirm the change is intended.
 * Baselines MUST be generated in the official Playwright container image
 * (mcr.microsoft.com/playwright:v1.63.0-noble) to match CI.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PAGES = [
  '/', '/nepse-decode/', '/nepse-chart/', '/nepse-screener/',
  '/nepse-trending/', '/nepse-value/', '/nepse-brokers/', '/blog/',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

// Frozen clock: 2026-09-30 15:00 NPT (after market close, deterministic)
const FROZEN_TIME = new Date('2026-09-30T15:00:00+05:45').getTime();

// CSS to disable all animations and transitions
const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

// Selectors for dynamic regions to mask (tickers, live badges, timestamps)
const DYNAMIC_SELECTORS = [
  '[data-freshness-badge]',           // Freshness badge (JS-driven)
  '[data-ticker]',                     // Ticker tapes
  '.ticker-tape',
  '.nd-ticker',
  '[data-live-clock]',
  '.live-badge',
  '[data-asof]',                       // "as of" timestamps
  '.snap-asof',
];

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    test(`visual ${vp.name} ${p}`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        reducedMotion: 'reduce',
      });

      // 1. Freeze the clock before navigation (deterministic timestamps)
      await page.clock.install({ time: FROZEN_TIME });

      // 2. Serve frozen fixture data (deterministic data files).
      // Intercept every JSON request; when a matching fixture exists under
      // tests/fixtures/ (mirroring the URL path), serve it. Otherwise let
      // the request through. This keeps renders identical whether CI checks
      // out the branch head or the PR merge commit (whose data files may be
      // newer from main).
      await page.route('**/*.json', async (route) => {
        const url = new URL(route.request().url());
        // Map URL path to fixture path, e.g.
        // /nepse-chart/data/live.json -> tests/fixtures/nepse-chart/data/live.json
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

      // 3. Disable animations via CSS (injected before navigation)
      await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });

      await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });

      // 4. Wait for web fonts to load (critical: prevents fallback-font diffs)
      await page.evaluate(() => document.fonts.ready);

      // 5. Let charts/badges settle
      await page.waitForTimeout(2500);

      // 6. Collect dynamic elements to mask
      const maskLocators = [];
      for (const selector of DYNAMIC_SELECTORS) {
        const elements = page.locator(selector);
        const count = await elements.count();
        for (let i = 0; i < count; i++) {
          maskLocators.push(elements.nth(i));
        }
      }

      await expect(page).toHaveScreenshot(
        `${p.replace(/\//g, '_') || 'home'}-${vp.name}.png`,
        {
          fullPage: true,
          maxDiffPixelRatio: 0.02,
          timeout: 30000,
          mask: maskLocators,
        }
      );
      await page.close();
    });
  }
}
