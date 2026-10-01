# PR #37 Changed Paths — Grouped (63 paths)

**Base:** 658ae1c | **Head:** 749d0a0 | **Stat:** +4181/−85 (approx; includes 3 S0 commits)

## Workflows (7 paths)
- `.github/workflows/ci.yml` — **added** (quality gates: smoke, visual, axe, lighthouse)
- `.github/workflows/nepse-content.yml` — **added** (daily blog/content pipeline)
- `.github/workflows/nepse-data-refresh.yml` — **deleted** (obsolete; replaced by specific workflows)
- `.github/workflows/nepse-freshness-watch.yml` — **added** (stale-data watchdog)
- `.github/workflows/nepse-intraday-floorsheet.yml` — **modified** (hardened: SHA pins, perms, concurrency)
- `.github/workflows/nepse-live-quotes.yml` — **modified** (hardened)
- `.github/workflows/nepse-market-close.yml` — **added** (market-close pipeline with rollback)

## Pipeline tools (10 paths)
- `tools/build-manifest.js` — **added** (builds data/manifest.json)
- `tools/check-freshness.js` — **added** (freshness watchdog logic)
- `tools/check-source-session.js` — **added** (NEPSE session detection)
- `tools/nepse-holidays.json` — **added** (holiday list; Oct–Dec 2026 unverified)
- `tools/prerender-freshness.js` — **added** (bakes freshness into HTML)
- `tools/record-job.js` — **added** (job run ledger)
- `tools/rollback-data.js` — **added** (byte-identical rollback)
- `tools/trading-days.js` — **added** (NEPSE trading calendar)
- `tools/validate-build.js` — **added** (build validator with gates)

## Site JS (3 paths)
- `js/freshness-badge.js` — **added** (stale-data badge UI)
- `js/nepse-portfolio.js` — **modified** (null-element guards ported from main)
- `js/nepse-sectors.js` — **modified** (null-element guards ported from main)

## Site pages (13 paths)
- `nepse-chart/index.html` — **modified** (freshness badge, esc() sanitizer)
- `nepse-chart/data/manifest.json` — **added** (data manifest)
- `nepse-chart/data/validation.json` — **added** (validation results)
- `nepse-decode/index.html` — **modified** (freshness integration)
- `nepse-news/index.html` — **modified**
- `nepse-reports/index.html` — **modified**
- `nepse-screener/index.html` — **modified**
- `nepse-sectors/index.html` — **modified**
- `nepse-simulator/index.html` — **modified**
- `nepse-trending/index.html` — **modified**
- `nepse-value/index.html` — **modified**
- `status/index.html` — **modified** (esc() sanitizer for JSON-derived values)
- `data/manifest.json` — **added**

## Tests (24 paths)
- `tests/package.json`, `tests/package-lock.json` — **added** (pinned deps)
- `tests/playwright.config.ts` — **added**
- `tests/smoke.spec.ts` — **added** (24-page smoke: overflow, console errors)
- `tests/visual.spec.ts` — **added** (visual regression)
- `tests/axe-scan.js`, `tests/axe-baseline.json` — **added** (accessibility)
- `tests/link-check.js` — **added** (internal link validation)
- `tests/visual.spec.ts-snapshots/` (16 PNGs) — **added** (baseline snapshots)

## Docs & config (6 paths)
- `docs/PIPELINE.md` — **added** (DRY_RUN procedure, pipeline docs)
- `docs/DATA_SOURCES.md` — **added** (data source documentation)
- `lighthouserc.json` — **added** (Lighthouse CI config)
- `.gitleaks.toml` — **added** (S0: allowlist for JKEY false positive)
- `.gitignore` — **modified** (S0 finding 8: .env*, *.pem, *.key, credentials*, *secret*)
- `.env.example` — **added** (S0 finding 8: secret names only)

## Blog (2 paths — pushed to main separately, not part of PR diff)
*Note: These were pushed directly to main (160ea63, 133a392), not via PR #37:*
- `assets/images/blog/nrb-cuts-bank-share-holding-period-45-days.jpg`
- `blog/nrb-cuts-bank-share-holding-period-45-days/index.html`
