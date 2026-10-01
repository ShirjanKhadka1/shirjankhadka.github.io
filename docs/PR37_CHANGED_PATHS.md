# PR #37 Changed Paths — Grouped (73 paths)

**Head:** 0c6d00d8 | **Date:** 2026-10-01

Count grew from 61 → 73 due to: S0 remediation docs, visual test stabilization,
scraping attribution, and baseline snapshots.

## Workflows (7)
- `.github/workflows/ci.yml` — added
- `.github/workflows/nepse-content.yml` — added
- `.github/workflows/nepse-data-refresh.yml` — removed
- `.github/workflows/nepse-freshness-watch.yml` — added
- `.github/workflows/nepse-intraday-floorsheet.yml` — modified
- `.github/workflows/nepse-live-quotes.yml` — modified
- `.github/workflows/nepse-market-close.yml` — added

## Tools (9)
- `tools/build-manifest.js` — added
- `tools/check-freshness.js` — added
- `tools/check-source-session.js` — added
- `tools/nepse-holidays.json` — added
- `tools/prerender-freshness.js` — added
- `tools/record-job.js` — added
- `tools/rollback-data.js` — added
- `tools/trading-days.js` — added
- `tools/validate-build.js` — added

## Pages (19)
- `assets/images/blog/nrb-cuts-bank-share-holding-period-45-days.jpg` — added
- `blog/nrb-cuts-bank-share-holding-period-45-days/index.html` — modified
- `data/manifest.json` — added
- `js/freshness-badge.js` — added
- `js/nepse-portfolio.js` — modified
- `js/nepse-sectors.js` — modified
- `nepse-chart/chart.css` — modified
- `nepse-chart/data/manifest.json` — added
- `nepse-chart/data/validation.json` — added
- `nepse-chart/index.html` — modified
- `nepse-decode/index.html` — modified
- `nepse-news/index.html` — modified
- `nepse-reports/index.html` — modified
- `nepse-screener/index.html` — modified
- `nepse-sectors/index.html` — modified
- `nepse-simulator/index.html` — modified
- `nepse-trending/index.html` — modified
- `nepse-value/index.html` — modified
- `status/index.html` — added

## Tests (25)
- `tests/axe-baseline.json` — added
- `tests/axe-scan.js` — added
- `tests/fixtures/manifest.json` — added
- `tests/link-check.js` — added
- `tests/package-lock.json` — added
- `tests/package.json` — added
- `tests/playwright.config.ts` — added
- `tests/smoke.spec.ts` — added
- `tests/visual.spec.ts` — added
- `tests/visual.spec.ts-snapshots/--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-blog--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-blog--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-brokers--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-brokers--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-chart--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-chart--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-decode--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-decode--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-screener--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-screener--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-trending--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-trending--mobile-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-value--desktop-chromium-linux.png` — added
- `tests/visual.spec.ts-snapshots/-nepse-value--mobile-chromium-linux.png` — added

## Docs (9)
- `docs/CLOUDFLARE_MIGRATION.md` — added
- `docs/DATA_SOURCES.md` — added
- `docs/DATA_SOURCES_TOS.md` — added
- `docs/DRY_RUN_ROLLOUT.md` — added
- `docs/PHASE2_STAGING_MODEL.md` — added
- `docs/PIPELINE.md` — added
- `docs/PR37_CHANGED_PATHS.md` — added
- `docs/PR37_S0_FINAL_STATUS.md` — added
- `docs/SECURITY_COUNT_BASELINE.md` — added

## Config (3)
- `.env.example` — added
- `.gitignore` — modified
- `.gitleaks.toml` — added

## Other (1)
- `lighthouserc.json` — added

