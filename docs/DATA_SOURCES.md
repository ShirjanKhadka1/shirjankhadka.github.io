# Data sources — terms, attribution, fallbacks

Every number on the site traces to one of the sources below. The canonical
record is `data/manifest.json` (`sources` per file, plus the `sources` union).
This document records the *terms* each source is used under, where it is
attributed, and what happens when it fails.

## Source inventory

### 1. NEPSE official site (nepalstock.com)
- **Used for:** index levels, market-open state, today's prices (live.json),
  universe of listed securities, floorsheet snapshots.
- **How:** `tools/fetch-nepse-live.js`, `tools/fetch-intraday-floorsheet.js`.
- **Terms — read carefully:** these tools recreate NEPSE's reverse-engineered
  `Salter` authorization flow to obtain API tokens. This circumvents the
  site's access controls; NEPSE's terms of use almost certainly prohibit it.
  Treated as a **Medium risk**: the fetchers are rate-limited (5-min
  floorsheet / 15-min quotes, market hours only), cache aggressively, and are
  fail-safe — any auth change, rate limit or error exits 0 *without touching*
  the published data, so the site keeps serving the last good snapshot.
- **Attribution:** "NEPSE official site" in manifest sources + `/status/` footer.
- **Fallback chain:** community mirrors (§3) → sharehubnepal (§4) → last good
  snapshot (fail-safe, never a partial deploy).

### 2. ShareSansar (sharesansar.com)
- **Used for:** corporate-action history (`corp-history.json`), announcement
  text enrichment.
- **How:** HTML scraping in `tools/build-corp-history.js`,
  `tools/collect-corporate-actions.js`, `tools/build-announcements.js`.
- **Terms:** ShareSansar's terms on automated collection are **unverified**.
  Scrapers use modest request rates with delays; scraped text is sanitized
  (tag-stripped + escaped) before publishing.
- **Attribution:** "ShareSansar company pages" in manifest sources.
- **Fallback:** NEPSE official notices only; gaps are left visible rather than
  filled with guesses (e.g. NBL's 4-FY vs 6-FY history is shown as-is).

### 3. Community NEPSE mirrors (yonepse, Nepse-All-Scraper)
- **Used for:** dividend archive (`div-history-yonepse.json`), universe
  cross-checks.
- **How:** `shubhamnpk.github.io/yonepse`, `samirwagle.github.io/Nepse-All-Scraper`.
- **Terms:** community scrapers with **no verified SLA and no explicit reuse
  license**. Used read-only, at low frequency, never republished verbatim —
  only aggregated figures derived from them.
- **Fallback:** treated as fallbacks themselves; if down, builds proceed
  without the dividend archive rather than failing.

### 4. sharehubnepal.com/nepse/indices
- **Used for:** index-history cross-checks.
- **Terms:** same posture as §3 (community source, no SLA).
- **Fallback:** NEPSE official index endpoint.

### 5. News RSS feeds
- **Used for:** market news aggregation (`news.json`).
- **Feeds:** Arthasansar, BizMandu, OnlineKhabar (Nepali + English), Merolagani.
- **Terms:** standard RSS consumption for headlines + links; full text is never
  republished — every item links to the publisher.
- **Attribution:** publisher name on every news card + link-out.
- **Fallback:** per-feed skip; the aggregator never fails because one feed is down.

### 6. Official documents (SEBON / NRB / NEPSE PDFs)
- **Used for:** breaking-news verification gate, corporate-action archive.
- **Terms:** public regulatory documents; republished facts are cited with
  inline links to the official PDF.
- **Attribution:** inline "Source: <official PDF>" links at the claim.
- **Fallback:** none — **no breaking item publishes without the official PDF**
  (hard gate).

### 7. Company websites (monitor)
- **Used for:** `company-websites.json` — new-document detection for filings.
- **Terms:** polite HEAD/GET polling, batched; unreachable sites are reported,
  never hammered.
- **Fallback:** NEPSE/company announcements feed.

## Attribution placement
- Machine-readable: `data/manifest.json` → `sources[]` per file.
- Human-readable: `/status/` footer lists the source families and links here.
- Articles: inline source links at the claim (house style); photo credits in
  figure captions.

## What we never do
- Never invent a figure when a source is down — the build fails closed and
  the last good data stays live (auto-rollback on validation failure).
- Never republish full article text from RSS publishers.
- Never post pipeline failures to Facebook — alerts go to the owner's email.
