# Nepse Decode — Source Register & Data Contracts (V1)

Private working document. Not linked from the site.
Status: COMPLETE — ready for [GATE] review.
Date: 2026-10-03.

## Source tiers

- **Tier 1 (official):** NEPSE (nepalstock.com), SEBON, NRB, Ministry of Finance, CDSC, company filings, issue-manager notices.
- **Tier 2 (licensed/open):** vendors with open permission. Currently: ShareSansar company pages, yonepse.com dividend archive, samirwagle.github.io/Nepse-All-Scraper (open OHLC archive).
- **Tier 3 (media, headlines only):** Arthasansar RSS, BizMandu RSS, OnlineKhabar RSS — headline + own summary + link. Never a numeric source.
- **Computed:** derived on our pipeline from tier 1/2 inputs. Method documented per output below.

## Update cadence (pipelines)

| Pipeline | Schedule (NPT) | Produces |
|---|---|---|
| nepse-live-quotes | Mon–Fri 10:45–14:00 every 15 min; 15:00–15:20 every 5 min | nepse-chart/data/live.json, intraday tape |
| nepse-intraday-floorsheet | Mon–Fri every 5 min 11:45–14:45 | floorsheet-derived broker flow |
| nepse-market-close | Mon–Fri 15:20, retries 16:10/17:00 | daily close: universe, verdicts, signals, manifest, stock pages |
| nepse-watchdog | every 30 min | health checks, alerts |
| nepse-freshness-watch | Mon–Fri 17:15 | staleness audit |
| nepse-content | daily 06:00 + 18:00 | news, articles |
| market-close staging fix (PR #54) | — | status/index.html staged on close runs |

## Data contracts per surface

Contract fields every surface must eventually expose: value, unit, as_of (NPT, from the data itself), source name, source tier, validation state, measured age.

### nepse-decode/ (homepage)
- Fetches: `/nepse-chart/data/live.json` (quotes), `/nepse-chart/data/index-spark.json` + `/data/index-history.json` (chart), `/data/manifest.json` (freshness).
- Displays: NEPSE index value/change, session state, candlestick chart (1D live candle + daily/monthly history), volume histogram, ticker tape, freshness badge.
- as_of: live.json `asof` (ISO UTC); manifest `session_date`.
- ⚠️ Hardcoded claims: `js/freshness-badge.js` (4 render paths) and `js/nepse-badge.js:107` render "delayed ~15 min" as fixed text — V2 fix.

### nepse-chart/ (Chart & signals / Alpha Lab)
- Fetches: `intraday-index.json`, `live.json`, `universe.json`, `verdicts.json`, `version.json`; third-party `samirwagle.github.io/Nepse-All-Scraper` per-symbol OHLC + latest.json (open archive, tier 2).
- Displays: index chart, per-stock OHLC, 10-factor Alpha Lab verdicts (Strong Buy … Strong Exit), RSI/movers.
- ⚠️ Inaccurate copy: `nepse-chart/index.html:192` FAQ says "free community feed" — actual live source is NEPSE official API via `tools/fetch-nepse-live.js` (token-authenticated). Copy must be corrected.
- ⚠️ `js/nepse-index-chart.js:137` hardcodes "Source: NEPSE · Market data delayed 15 minutes" — V2 fix.

### nepse-screener/
- Fetches: live.json (quotes), `wave1.json` (engine + fundamentals), index-spark.json.
- Displays: sortable table, engine verdicts, fundamentals (wave1 asof 2026-10-02; sources: market=live.json, rsi=verdicts.json, movers=Nepse-All-Scraper).
- ⚠️ Inherits freshness-badge hardcoded delay strings.

### nepse-sectors/
- Fetches: universe.json, verdicts.json, version.json, wave1.json.
- Displays: sector heatmap, breadth, per-sector movers.
- ⚠️ Known bug: intraday tape replaces daily universe; untraded securities vanish (HIDCLP; 186/410 observed 2026-10-02). Fix pending.

### nepse-news/
- Fetches: `announcements.json` (updated 2026-09-29, 10 items), `news.json` (asof 2026-10-02; sources Arthasansar/BizMandu/OnlineKhabar; "headlines only, attributed").
- Displays: headlines + own summaries + links only. No numeric data. Tier 3 respected.

### nepse-watchlist / nepse-portfolio / nepse-simulator
- Fetches: universe.json + verdicts.json (quotes); simulator uses universe.json snapshots.
- User data is localStorage-only (`nl_portfolios_v1` etc.) — no server, no login. Honest by construction.

### nepse-reports/
- Fetches: verdicts.json, wave1.json.
- Displays: daily market reports, seasonality.

### nepse-actions/
- Fully baked by `tools/build-actions-page.js` from `corporate-actions.json` (updated 2026-09-30, 6 items).
- Bakes "Archive updated {date} · {n} verified notices" — date is build-time; refreshes on rebuild. Currently 3 days old.

### nepse-brokers/
- Fetches: `/nepse-brokers/data/meta.json` (earliest 2026-04-24, latest 2026-10-02, 107 trading days), `brokers.json`, `intraday.json`.
- Displays: per-broker net flow, buyers/sellers, per-stock acc/dist.

### nepse-trending/
- Fetches: `trending.json` (asof 2026-10-02, live_asof 2026-10-02T09:15:48Z), lazily `trending-research.json` (top-40 snapshots, "40 of 269").
- Displays: ranked movers by turnover acceleration, volume spikes, 5-day momentum, broker-flow concentration, news mentions.

### nepse-value/
- Fetches: `value.json` (asof 2026-10-02; source "Published quarterly filings via screener").
- Displays: value-ranked stocks from fundamentals.

### nepse-technical/
- Static coming-soon; no data. Full workspace (index.full.html + tv-datafeed.js) awaits TradingView library.

### status/
- Fetches: `/data/health.json`, `/data/manifest.json`, `jobs.json`, `validation.json`; "unavailable" fallbacks.
- Displays: pipeline health, job runs, validation gates, market & data state. Noscript block baked per-run.

### ask/
- Static curated Q&A; no data claims beyond sourced facts.

### stocks/ detail pages (generator: tools/build-symbol-pages.js)
- Bakes: universe.json, verdicts.json, news.json, `fundamentals.json` (asof 2026-09-30), `quarterly.json` (asof 2026-09-30, NPR), corp-history.json, `div-history-yonepse.json` (tier 2: yonepse.com), `div-live.json` (asof 2026-09-30), corporate-actions.json, live.json.
- Runtime: stock-live.js, val-lab.js refresh from baked/relative data.

## Findings requiring action

1. **Source tiering:** Nepse-All-Scraper (tier 2, open archive) and yonepse.com dividend archive (tier 2) must be explicitly tiered in user-facing source labels — currently implied, not stated.
2. **Inaccurate source claim:** nepse-chart FAQ "free community feed" → correct to NEPSE official API (token-authenticated polling).
3. **Hardcoded delay claims (V2):** freshness-badge.js (4 paths), nepse-badge.js:107, nepse-index-chart.js:137 — replace with measured age from data `as_of`.
4. **Stale baked dates:** nepse-actions archive date (2026-09-30) — refreshes on rebuild; consider rebuild cadence.

## Known honesty gaps (V2 scope)

1. Market-status pill is schedule-based only; public holidays not yet reflected (disclosed in chrome).
2. `as_of` display not yet uniform across all surfaces.
3. Measured end-to-end age not yet shown (no hardcoded "15 minutes").
4. HIDCLP sector heatmap bug (intraday tape replaces universe).
5. 24 existing blog posts predate editorial chrome; generator fixed, posts regenerate on republish.

## Change log

- 2026-10-03: skeleton created; full per-page inventory completed; register filled. Ready for [GATE].
