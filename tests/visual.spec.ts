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

// Frozen clock: derived from the live.json fixture's `asof` (+2h), so the
// fixture data is never "in the future" relative to the frozen clock.
// (PR #66 routes page data through NepseData.whenReady(), which validates
// that asof <= now; a hardcoded frozen time older than the fixture makes
// validation reject the fixture and pages render without data.)
// Falls back to a fixed date if the fixture is unreadable.
const FROZEN_TIME = (() => {
  try {
    const asof = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'nepse-chart', 'data', 'live.json'), 'utf8')
    ).asof;
    const t = new Date(asof).getTime();
    if (isFinite(t)) return t + 2 * 3600 * 1000;
  } catch { /* fall through to default */ }
  return new Date('2026-09-30T15:00:00+05:45').getTime();
})();

// CSS to disable all animations and transitions
const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
  /* The closed mobile nav drawer (#nd-drawer) is position:fixed +
     translateX(100%). Chrome counts its off-canvas bounds toward
     body.scrollWidth, so fullPage screenshots come out 340px too wide
     (1780px desktop / 730px mobile) and the page re-lays out at the wrong
     viewport. The drawer is visibility:hidden when closed (invisible in
     every shot), so remove it from the render for deterministic widths. */
  #nd-drawer{ display: none !important; }
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

// RETRY (2026-10-09): /blog/ intermittently crashes the CI renderer's
// screencast during fullPage capture ("screencast.showOverlays: Target
// page, context or browser has been closed"). The page itself renders
// fine — the crash is environmental. Scoped here (not in the shared
// config) so smoke.spec.ts keeps zero retries and still fails fast.
test.describe.configure({ retries: 2 });

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    test(`visual ${vp.name} ${p}`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        reducedMotion: 'reduce',
        // THEME DETERMINISM (2026-10-07): the <head> theme snippet falls back
        // to prefers-color-scheme when no saved preference exists. Fresh CI
        // contexts default to light, so /nepse-brokers/ (the only tested page
        // that neither loads nd-chrome.js nor defaults dark) rendered light
        // against dark baselines. Pin dark so every page renders deterministically.
        colorScheme: 'dark',
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
      // js/nepse-daily.js ships inline index history (not JSON) that also
      // drives rendered dates — freeze it the same way. The page loads it
      // with a ?v= cache-buster; use a regex so the query string matches.
      await page.route(/\/js\/nepse-daily\.js(\?.*)?$/, async (route) => {
        const fixturePath = path.join(__dirname, 'fixtures', 'js', 'nepse-daily.js');
        if (fs.existsSync(fixturePath)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: fs.readFileSync(fixturePath),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });

      // 3. Disable animations via CSS.
      // MUST run after goto: addStyleTag injects into the current document,
      // and navigation to a new document discards it (injecting before goto
      // silently does nothing).
      await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });

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
