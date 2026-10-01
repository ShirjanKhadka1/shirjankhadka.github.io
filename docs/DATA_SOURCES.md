# Data sources

Every number on the site traces to one of the sources below. The canonical
record is `data/manifest.json` (per-file `sources`, plus the `sources` union).

## Source inventory

### 1. NEPSE official site (nepalstock.com)
- **Used for:** index levels, market-open state, today's prices (`live.json`),
  universe of listed securities, floorsheet snapshots.
- **Collected by:** `tools/fetch-nepse-live.js`, `tools/fetch-intraday-floorsheet.js`.
- **Attribution:** "NEPSE official site" in manifest sources and `/status/` footer.

### 2. ShareSansar (sharesansar.com)
- **Used for:** corporate-action history (`corp-history.json`), announcement text.
- **Collected by:** `tools/build-corp-history.js`, `tools/collect-corporate-actions.js`,
  `tools/build-announcements.js`.
- **Attribution:** "ShareSansar company pages" in manifest sources.

### 3. Community NEPSE mirrors
- **Used for:** dividend archive (`div-history-yonepse.json`), universe cross-checks.
- **Sources:** `shubhamnpk.github.io/yonepse`, `samirwagle.github.io/Nepse-All-Scraper`.
- **Attribution:** named in manifest sources where used.

### 4. News RSS feeds
- **Used for:** market news aggregation (`news.json`).
- **Feeds:** Arthasansar, BizMandu, OnlineKhabar, Merolagani.
- **Attribution:** each headline links to its source article.

## Attribution policy
- Every page that displays market data names its sources in the footer or
  a visible attribution line.
- The `/status/` page lists all active sources and their freshness.
- `data/manifest.json` records the source of every generated file.
