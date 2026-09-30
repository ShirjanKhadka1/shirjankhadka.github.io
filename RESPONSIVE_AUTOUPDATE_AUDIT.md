# Responsive + Auto-Update Audit — shirjankhadka.com.np
Date: 2026-10-01 · Branch: `feature/responsive-autoupdate` · Auditor: subagent (overnight program)
Scope: static GitHub Pages site, ~476 HTML pages. Free stack only — no backend, no paid services.

## Method
- Static analysis of every page type: script includes, fetch targets, cache mode, refresh timers, loading/error/as-of states.
- CSS inventory: breakpoints, table overflow handling, fixed-width risks.
- Rebuild pipeline inventory: which GitHub Actions workflow rebuilds which JSON, and on what cadence.
- No live browser available to this agent; visual verification delegated to the parent's QA browser task.

## Page-type inventory

| Page type | Pages | Market data? | Data source on load | Refresh while open | Rebuild cadence | Responsive notes |
|---|---|---|---|---|---|---|
| Homepage `/` | 1 | No (portfolio intro) | none | n/a | n/a | `css/style.css` (14 media queries), viewport OK |
| `/nepse-decode/` dashboard | 1 | Yes — index, OHLC, breadth, turnover, news, verdicts | `live.json`, `news.json`, verdicts (fetch, no-store) | **60s re-fetch** (skips when tab hidden; repaints only on change) | `nepse-live-quotes.yml` every 15 min market hours; news via `build-nepse-news.js` in daily refresh | design-system CSS, viewport OK |
| `/nepse-chart/` chart app | 1 | Yes — candles, indicators | `live.json`, `universe.json`, `verdicts.json`, `version.json` via `nepse-lab.js` | setInterval present | live-quotes workflow | design-system + chart.css |
| `/stocks/*` stock pages | 411 | Yes — live price strip; fundamentals baked | `live.json` via `stock-live.js` (no-store) | **60s re-fetch** | fundamentals baked at build; `build-symbol-pages.js` in daily refresh + dividend watcher rebuilds single pages on new dividends | luxury/wave7/wave8/brand CSS; "Data as of" stamp present |
| `/nepse-screener/` | 1 | Yes — verdicts table | `verdicts.json` + `universe.json` (no-store) | none (daily data) | `build-nepse-universe.js` in daily refresh | design-system + screener.css |
| `/nepse-signals/momentum|trend-relay|reversal/` | 3 | Yes — open alerts + backtest | `signals/<sys>.json` on load | **none — GAP** | design-system; loading state yes; **no error state; no as-of stamp — GAP** |
| `/nepse-brokers/` | 1 | Yes — broker tables, intraday | `brokers.json`, `intraday.json`, `meta.json` on load | **none — GAP** (intraday rebuilds every 5 min) | `nepse-intraday-floorsheet.yml` every 5 min market hours; daily refresh | design-system; loading yes; **no error state — GAP** |
| `/nepse-trending/` | 1 | Yes — trending table | `trending.json` on load | **none — GAP** | `build_trending_value.py` (manual rebuild) | design-system; loading/error/as-of all present |
| `/nepse-value/` | 1 | Yes — value table | `value.json` on load | **none — GAP** | `build_trending_value.py` (manual rebuild) | design-system; loading/error/as-of all present |
| `/nepse-news/` | 1 | Yes — headlines | `news.json` + `announcements.json` on load | **none — GAP** (breaking news is the point) | `build-nepse-news.js` in daily refresh + realtime-news-bridge on breaking | loading/error yes; **no as-of stamp — GAP** |
| `/nepse-watchlist/` | 1 | Yes — watchlist prices | `universe.json`, `verdicts.json` via `nepse-live.js` | via nepse-live.js intervals | daily refresh | design-system |
| `/nepse-portfolio/` | 1 | Yes — holdings | `universe.json`, `verdicts.json` | none (daily data) | daily refresh | design-system |
| `/nepse-sectors/`, `/nepse-reports/` | 2 | Yes | via `nepse-live.js` | via nepse-live.js intervals | daily refresh | design-system |
| `/nepse-simulator/` | 1 | Yes — sim prices | via `nepse-simulator.js` | none (session-based sim) | n/a (simulation) | design-system |
| `/nepse-actions/` | 1 | Archive (historical, not live) | baked at build (correct for a durable archive; also in JSON-LD for SEO) | n/a | `build-actions-page.js` in daily refresh + corporate-actions outbox sync | — |
| `/blog/*` articles | 16 | No — point-in-time editorial figures (correct as snapshots) | none | n/a | n/a | `style.css`, viewport OK |
| `/kundali/`, `/nepali-date-converter/` | 2 | No (calculators) | none | n/a | n/a | own CSS |
| Redirects (`/nepse-alpha/`, `/nepse-dashboard/`, `/nepse-fundamentals/`) | 3 | n/a | n/a | n/a | n/a | n/a |

## Rebuild pipelines (all free: GitHub Actions cron)
- `nepse-live-quotes.yml` — `0,15,30,45 5-8 * * 1-5` + `0,15,20,25 9 * * 1-5` (NPT market hours) → `live.json`
- `nepse-intraday-floorsheet.yml` — `*/5 6-9 * * 1-5` → `intraday.json`
- `nepse-data-refresh.yml` — `35 9 * * 1-5` (15:20 NPT) → universe, news, wave1, symbol pages, sitemap, actions page
- `broker-daily-refresh` cron (external) — Mon–Fri 16:45 NPT → broker floorsheet scrape + re-export

## Gaps found (actionable)
### Auto-update
1. `/nepse-brokers/` — no periodic re-fetch; intraday.json rebuilds every 5 min. **Fix: 60s re-fetch.**
2. `/nepse-news/` — no periodic re-fetch; breaking news lands via realtime bridge. **Fix: 60s re-fetch.** Also missing as-of stamp.
3. `/nepse-trending/`, `/nepse-value/` — no periodic re-fetch. **Fix: 60s re-fetch** (cheap; data changes on rebuild).
4. `/nepse-signals/*` — no periodic re-fetch; no as-of stamp. **Fix: 60s re-fetch + as-of.** (The signals pages *do* have a failed-initial-load error row — only the refresh and as-of were missing.)
5. ~~`/nepse-brokers/` — no error state on fetch failure.~~ **Struck 2026-10-01:** verified the page *does* show `'Broker data is temporarily unavailable...'` on failed initial load. The real gap was the missing refresh (fixed in §1).
2b. ~~`/nepse-news/` — missing as-of stamp.~~ **Struck 2026-10-01:** verified the page *does* show freshness via `#pageFresh` ("Updated …") and `#annUpdated` on both feeds. Only the announcements error state and the 60s refresh were missing (both fixed).
### Responsive
6. CSS is fragmented across 9 stylesheets with 47 media queries total — generally responsive-aware, but no single global safety net. Tables use `min-width` + (mostly) scroll wrappers; a few inline-script-rendered tables need wrapper verification.
7. No global `overflow-x` guard against accidental horizontal page scroll on small screens from wide injected content.

## Deliberately out of scope
- NEPSE market data is PUBLIC data — no effort spent "protecting" it. Freshness is the goal.
- Blog articles keep point-in-time figures (editorial snapshots, not live data).
- `/nepse-actions/` archive stays baked (durable archive + SEO JSON-LD).
- No changes to light-mode appearance; no `[data-theme]` regions touched (dark-mode agent's territory).
- No deploy, no push — branch only.

## Fixes applied (2026-10-01, this branch)

- Gap 1 ✅ `/nepse-brokers/`: 60s silent refresh (`load(silent)`), `cache:'no-store'`,
  `document.hidden` gate, as-of from `meta.generated_at`, init-guarded tab wiring.
- Gap 2 ✅ `/nepse-news/`: announcements IIFE wrapped in `loadAnn()` with the same
  silent-refresh pattern; both feeds keep last good render on failed background
  refresh.)
- Gap 3 ✅ `/nepse-trending/` + `/nepse-value/`: 60s silent refresh; `initTabs` and
  dropdown/sort-handler setup guarded by init-once flags (they previously
  re-bound listeners and duplicated dropdown options on every refresh).
- Gap 4 ✅ `/nepse-signals/*` (all three): 60s silent refresh + visible
  "Signals generated … NPT · refreshes automatically" line from `generated_at`.
- Gap 6/7 ✅ Responsive safety net appended to `css/nepse-design-system.css`
  (additive only): `overflow-x: clip` guard ≤760px, 44px tap targets, table
  cell-padding floor, section-rhythm rule. CSS version bumped to `?v=20261001a`
  on all 16 referencing pages.
- Verified: `node --check` on all modified inline scripts; HTTP 200 on all
  touched pages; JSON payloads aggregated (largest 172KB); no render-blocking
  data fetches; loading placeholders paint instantly.

Design decisions recorded in `DESIGN_NOTES.md`; implementation detail in
`IMPLEMENTATION_NOTES.md`.
