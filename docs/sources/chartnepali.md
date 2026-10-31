# Source Dossier — ChartNepali™

- **Research date:** 2026-10-31 (Asia/Kathmandu)
- **Method:** Read-only public web search + text fetch. No sign-in attempted, no purchase, no form submission, no email.
- **Status:** DRAFT for Phase B matrix review. Nothing in this dossier is a permission grant.
- **Operator / identity (verified via own pages + business profile):** ChartNepali™, "a Nepal-focused financial technology company. We turn 25+ years of Nepal Stock Exchange (NEPSE) data into a fast, professional platform for charting, market intelligence and investment research" — business profile via search; own site confirms the 25+-year history claim on chart pages (see §a).

## (a) Endpoints — what was actually verified

### Verified: a datafeed exists, but it is not a public API
- Chart page (https://www.chartnepali.com/chart/MEN, fetched 2026-10-31): "Charting technology by TradingView, running on ChartNepali™'s own NEPSE datafeed. Prices may lag the official close." The datafeed is therefore an internal feed powering the site's TradingView charts. **No datafeed endpoint, documentation, API key, or access programme is published on any ChartNepali page fetched.**
- Robots.txt (see §c) confirms the point from the other side: `/datafeeds/` and `/api/` are disallowed to crawlers, with only `/api/chart-room/preview/` allowed. The internal feed paths are not a public API surface.

### Verified page surface (not endpoints)
- Homepage (https://www.chartnepali.com/, fetched 2026-10-31): today's board for 2026-10-30 — NEPSE 2,690.15 (−5.45, −0.20%), 102 up / 8 flat / 169 down / 348 traded, turnover Rs 8,891,595,145.90 — plus top gainers/turnover tables, market heat map, sector rotation (RRG Dashboard), and "The Ledger" data stories. All of this is rendered page content, not a documented endpoint or export.
- Per-symbol chart pages, pattern `https://www.chartnepali.com/chart/<SYMBOL>` (verified instance: `/chart/MEN` for Mountain Energy Nepal Ltd.): interactive candlestick chart, "minute candles through the session for intraday trading, 25+ years of daily history, drawing tools and 100+ indicators" (page text), plus a "Broker footprint · last 90 trading days" table (net shares/value, days buying/selling per broker) explicitly labelled "Floorsheet-derived" — i.e. an aggregated, windowed broker view, not a raw floorsheet feed.
- Index history claim (homepage metadata, fetched 2026-10-31): "Daily open, high, low, close and turnover for the Nepal Stock Exchange (NEPSE) index and its sector sub-indices, from 1997 to the present." A data-letter page (search result, https://www.chartnepali.com/reports/rasuwa-flood-hydropower) likewise states: "We hold the NEPSE index back to 1997 and the hydropower sub-index back to 2011."
- Pine Script page (https://www.chartnepali.com/pine-script, fetched 2026-10-31): a Pine Script v5/v6 editor under every chart, running in the visitor's own browser on the bars visible; strategies run in the Strategy Tester; alerts are nightly on the last closed daily bar. This is a client-side charting feature, not a data API.
- Dividend/corporate-action tracking is claimed in the business profile ("dividend and corporate-action tracking, portfolio and weighted-average-cost tools, and a searchable profile for every listed company") but was **not** verified on any ChartNepali page fetched in this research — recorded here as a secondary-source claim only.

### NOT verified
- No public API, bulk download, CSV export, or data-dictionary page. No endpoint for index history, OHLC, broker footprint, or corporate actions was published. Do not infer TradingView UDF paths (`/history`, `/config`, etc.) for ChartNepali: those are generic TradingView protocol shapes, not ChartNepali-published endpoints, and its robots.txt disallows `/datafeeds/` in any case.

## (b) Rate limit / terms clause
- **Documented API rate limit: NONE FOUND.** No API quota or throttling figure is published anywhere found.
- **Closest applicable clause — robots.txt crawl-delay (not an API limit):** `User-Agent: bingbot` → `Crawl-delay: 5` (https://www.chartnepali.com/robots.txt). That is a crawler politeness delay for Bing, not a data-API rate limit, and it is not presented as one.
- **Terms-of-use clause: NONE FOUND.** A search for ChartNepali terms/privacy returned no ChartNepali terms page (results were unrelated firms and ChartNepali feature pages). No redistribution, scraping, or reuse clause for chartnepali.com was verified. This is a GAP, not a permission.

## (c) robots.txt — verified by fetch
- URL fetched: https://www.chartnepali.com/robots.txt (2026-10-31)
- Content (general agents):
  - `User-Agent: *` (and same for bingbot) → `Allow: /`, `Allow: /api/chart-room/preview/`
  - `Disallow: /admin`, `/api/`, `/lab`, `/account`, `/charting_library/`, `/datafeeds/`
  - bingbot additionally: `Crawl-delay: 5`
  - A long list of AI/training/scraping agents (GPTBot, OAI-SearchBot, ChatGPT-User, CCBot, ClaudeBot, Claude-Web, anthropic-ai, Google-Extended, Applebot-Extended, PerplexityBot, Bytespider, Amazonbot, DataForSeoBot, Diffbot, ImagesiftBot, Scrapy, SemrushBot, AhrefsBot, MJ12bot, DotBot) are each `Disallow: /`
  - `Host: https://www.chartnepali.com`; sitemaps for the main site, wrap, ledger, Nepali edition, and glossary.
- Reading: ordinary pages are crawlable, but **the entire `/api/` tree and `/datafeeds/` are disallowed**, and AI crawlers are excluded wholesale. A retention job or Worker must not fetch ChartNepali's internal feed paths: they are both undocumented and robots-disallowed. The single allowed API exception (`/api/chart-room/preview/`) is a preview surface, not a data endpoint, and was not investigated further in this read-only research.

## (d) Auth model
- Charts are free to view without sign-in: Pine Script page states running a pasted script does not require sign-in; the chart pages themselves render without an account in the fetched text.
- Sign-in is required only for account features: "Ctrl+S saves it to your account. Saving asks you to sign in" (https://www.chartnepali.com/pine-script); `/account` is robots-disallowed, consistent with account areas being non-public.
- No API-key, OAuth, or data-access programme is documented — GAP.

## (e) Cadence / trading-day coverage
- Verified from the Pine Script page (https://www.chartnepali.com/pine-script): "NEPSE has one session, 11:00 to 15:00 Kathmandu time" and charts carry "minute candles through the session for intraday trading" plus daily history (chart page text).
- Verified disclaimer from the chart page (https://www.chartnepali.com/chart/MEN): "Prices may lag the official close." No numeric latency, poll interval, or post-close finalisation time is published.
- History depth (verified claims, not exports): index from 1997, hydropower sub-index from 2011 (data-letter page); per-symbol pages show trading-day counts (e.g. MEN: "1,333 trading days" as of 2026-10-30 on the fetched page).
- Broker footprint window: last 90 trading days (chart page) — a rolling window, not a full history export.

## (f) Licence / redistribution terms
- **Site-wide data licence: NONE FOUND.** No ChartNepali terms page or data-redistribution statement was located.
- **Licences that were found — and what they do NOT cover:**
  - PineTS engine licence (https://www.chartnepali.com/pine-script §5): the Pine editor "runs on PineTS, open-source software by LuxAlgo, released under the GNU Affero General Public License (AGPL-3.0)… Your own scripts are yours; the licence is the engine's, not your code's." This licences the charting engine software, not ChartNepali's market data.
  - TradingView trademark note (same page): "Pine Script and TradingView are trademarks of TradingView, Inc. ChartNepali is not affiliated with TradingView." This is a trademark disclaimer, not a data licence.
  - Content footer on data stories: "Data, not tips. Not investment advice." (observed on a ChartNepali market-close graphic via search) — an advice disclaimer, not a reuse permission.
- In short: the only licences verified on the site govern software (PineTS) and disclaim advice; **no term was found permitting third-party copying, republication, or serving of ChartNepali's own NEPSE database.**

## GAPS (explicit — not guesses)
1. No public API documentation or endpoint for any dataset; the datafeed is internal and robots-disallowed.
2. No site-wide terms of use, data licence, redistribution, or scraping clause found.
3. No numeric API rate limit (only a bingbot crawl-delay of 5).
4. No verified export/download mechanism for index history, OHLC, broker footprint, or corporate actions.
5. Dividend/corporate-action tracking verified only as a business-profile claim, not on a fetched ChartNepali page.
6. No verified latency figure beyond "prices may lag the official close"; no post-close finalisation time.

## Per-dataset decisions
- **index-close: CROSS-CHECK ONLY** — Index history (1997–present) is displayed on-site, but no endpoint, export, or reuse permission was verified; usable only to compare against a permitted primary source.
- **daily-ohlc: CROSS-CHECK ONLY** — 25+ years of daily candles are charted on-site, but no OHLC endpoint/export or permission was verified, and `/datafeeds/` is robots-disallowed.
- **monthly-ohlc: CROSS-CHECK ONLY** — Monthly aggregation could be derived from displayed daily history, but that would still be republication of ChartNepali's database without a verified permission; cross-check only.
- **broker-flow: CROSS-CHECK ONLY** — The 90-trading-day broker footprint is floorsheet-derived and displayed per symbol, but it is an aggregated window, not a raw feed, with no endpoint or permission verified.
- **corporate-actions: CROSS-CHECK ONLY** — Tracking is claimed only in a secondary business profile and was not verified on a fetched site page; no endpoint or permission verified.
- Datasets not listed (floorsheet, fundamentals, mf-nav, news) are not evidenced as ChartNepali endpoints/exports in this research and are SKIP for this source pending verification. (Fundamentals in particular: model values shown in "The Ledger" are ChartNepali's own derived analysis, not a fundamentals dataset to republish.)

## Sources verified in this dossier
- https://www.chartnepali.com/ (homepage, fetched 2026-10-31)
- https://www.chartnepali.com/chart/MEN (chart + broker-footprint page, fetched 2026-10-31)
- https://www.chartnepali.com/pine-script (fetched 2026-10-31)
- https://www.chartnepali.com/robots.txt (fetched 2026-10-31)
- https://www.chartnepali.com/reports/rasuwa-flood-hydropower (index-history depth claim, search result)
- Business profile for ChartNepali (search result; secondary source for dividend-tracking claim only)
