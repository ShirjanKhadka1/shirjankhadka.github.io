# Source Dossier — Nepalytix (Cognify System Pvt. Ltd.)

- **Research date:** 2026-10-31 (Asia/Kathmandu)
- **Method:** Read-only public web search + text fetch. No sign-in attempted, no purchase, no form submission, no email.
- **Status:** DRAFT for Phase B matrix review. This is the strongest terms evidence of the four dossiers — and it points against republication without written agreement (see §f).
- **Operator / identity (verified):** Nepalytix, "a financial data and analytics platform built specifically for the Nepal Stock Exchange (NEPSE)", operated by Cognify System Pvt. Ltd, a company registered in Nepal — https://nepalytix.com/terms §§1, 14 (governing law: Nepal; jurisdiction: Kathmandu courts).

## (a) Endpoints — what was actually verified

### Verified: an API exists, but no endpoint catalogue was published
- Terms §9 (https://nepalytix.com/terms, effective/last updated 7 July 2025): "The Nepalytix REST API is provided for personal and research use." No endpoint path, parameter, response schema, base URL, or authentication header is given on that page or on any other Nepalytix page fetched.
- Pricing page (https://nepalytix.com/pricing, fetched 2026-10-31): "API and bulk data access" is listed **only** under the custom Enterprises tier ("Custom" price, "Contact us"). It is not listed under Free (NPR 0), Basic (NPR 1,999/yr), Pro (NPR 4,999/yr), or Elite (NPR 9,999/lifetime). So API/bulk access is an enterprise feature, not a free-tier entitlement, on the site's own pricing page.

### Product surface (verified, not endpoints)
- Homepage (https://www.nepalytix.com/, fetched 2026-10-31) claims: "Nepal's first open finance data hub. Daily floorsheet, broker data, technical feeds, and historical financials, freely accessible. Built for students, quant researchers, and AI builders." **No hub URL, download link, file list, or API path for that hub was found on the homepage text fetched or in search** — the claim is recorded verbatim, but the access mechanism is a GAP. "Freely accessible" on a marketing page does not override the Terms §§5, 6, 9 restrictions below.
- Live Market page (https://nepalytix.com/live-market, fetched 2026-10-31) displays, for the session shown: NEPSE index, sector heatmap, top gainers/losers, most-active volume/turnover, and a bulk/block-transaction table (buyer/seller broker numbers, quantity, rate, amount, time). This evidences on-page display of index, breadth, and broker-numbered trade data — not an endpoint.
- Pricing tiers evidence the data areas on-platform: free tier includes basic charts, basic fundamentals, basic sector view, selected news; Pro adds "large-scale broker analysis" and "advanced broker flow insights"; Basic adds full fundamental analysis/valuation and full sector analysis. These are feature descriptions, not endpoints or exports.

### NOT verified
- No individual endpoint path for floorsheet, broker flow, OHLC (daily or monthly), fundamentals, index history, corporate actions, MF NAV, or news was found. Do not invent paths from the Terms' mention of a "REST API".

## (b) Rate limit
- **Documented numeric rate limit: NONE.** No requests-per-minute/hour, quota, or burst figure is published anywhere found.
- **Applicable terms clause (verbatim, Terms §9, https://nepalytix.com/terms):** "We reserve the right to rate-limit or revoke API access if usage is deemed excessive or harmful to platform performance." Any Worker polling cadence for Nepalytix would therefore be at the operator's discretion to throttle or revoke, with no published safe threshold to design against — a further reason to agree terms in writing first.

## (c) robots.txt — verified by fetch
- URL fetched: https://nepalytix.com/robots.txt (2026-10-31)
- Full content:
  - `User-Agent: *` → `Allow: /`
  - `Disallow: /dashboard`, `/admin`, `/paper-trading`, `/chart`, `/mobile-charts`, `/playground`, `/v2`, `/login`, `/register`, `/profile`, **`/api`**
  - `Sitemap: https://nepalytix.com/sitemap.xml`
- Reading: general pages are crawlable, but **`/api` is explicitly disallowed to crawlers**, as are account/chart areas. A retention job or Worker must not treat robots-allowed pages as API permission: API use is governed by Terms §9, and crawler access to `/api` is disallowed on the face of robots.txt.

## (d) Auth model
- Account-based (Terms §§3, 9, https://nepalytix.com/terms): users must be 18+, provide accurate registration information, keep credentials confidential, are responsible for all activity under their account, and **may not share an account with another person or use another person's account**.
- Tiered access (https://nepalytix.com/pricing): Free → Basic → Pro → Elite → Institutional → Enterprises (custom). API/bulk access sits at Enterprises only, per the pricing page.
- No API-key format, OAuth flow, or token model is documented on any page found — GAP.

## (e) Cadence / trading-day coverage
- Positioning: "real-time NEPSE analytics" (homepage and live-market page descriptions). The live-market page fetched shows a session's index/breadth/sector data and a bulk-transaction table, but the page text itself mixes dates (index figures matching the 30 Oct 2026 close; bulk-transaction block headed "As of Oct 28, 2026, 2:59 PM"), so **no clean, single cadence or freshness statement can be extracted from that page** — recorded as observed, not as a cadence claim.
- No published poll interval, post-close finalisation time, latency figure, or holiday calendar was found. Trading-day coverage is therefore recorded only as: NEPSE trading sessions as displayed on the live-market page; numeric cadence is a GAP.

## (f) Licence / redistribution terms — quoted from the site's own terms
- **Acceptable use, Terms §5 (https://nepalytix.com/terms):** "You agree not to: … Scrape, copy, redistribute, or resell any data or content from Nepalytix without written permission. … Use automated bots or scripts to access the platform without prior written consent." (Close paraphrase of the full list: unlawful use, unauthorised access, misinformation/market manipulation, reverse engineering, malicious code are also prohibited.)
- **Intellectual property, Terms §6:** "All content on Nepalytix including but not limited to the platform design, code, data visualizations, AI models, reports, and branding is the property of Cognify System Pvt. Ltd. You may not reproduce, distribute, or create derivative works from any content on the platform without express written permission."
- **API access, Terms §9:** "The Nepalytix REST API is provided for personal and research use. Commercial use of the API requires a separate written agreement with Cognify System Pvt. Ltd."
- **Data provenance, Terms §8:** "Nepalytix sources market data from publicly available NEPSE records and third-party data providers. We use TradingView for charting functionality." — i.e. Nepalytix is itself downstream of NEPSE records and third parties; it is not presented as an originator of the underlying market data, and its terms still restrict redistribution of its own content.
- **Consequence for Phase B:** A public website that republishes Nepalytix-derived data (a commercial use, and a redistribution) falls squarely inside the "written permission / separate written agreement" requirement. The homepage's "freely accessible" hub claim does not, on the documents fetched, override §§5, 6, and 9, and no separate open licence was found. The two texts must be reconciled with the operator in writing before any primary-source use.

## GAPS (explicit — not guesses)
1. No endpoint catalogue: no path, parameter, schema, base URL, or auth mechanism published for the REST API.
2. No numeric rate limit — only the discretionary rate-limit/revoke reservation in §9.
3. No access mechanism found for the homepage's "open finance data hub" claim (no hub URL, download, or file list in fetched text).
4. No verified cadence, latency, post-close finalisation, or holiday-calendar statement.
5. No open licence or redistribution permission found; the only redistribution terms found require written permission.
6. No MF NAV, corporate-action, or news endpoint evidenced (news appears only as "selected news" in the free tier feature list).

## Per-dataset decisions
- **index-close: REQUEST ACCESS** — Displayed on-platform, but commercial republication requires a separate written agreement per Terms §9, and no index endpoint is published.
- **floorsheet: REQUEST ACCESS** — Daily floorsheet is claimed as hub content, but no hub access mechanism or endpoint was found and Terms §§5–6 prohibit redistribution without written permission.
- **broker-flow: REQUEST ACCESS** — Broker analysis/flow is a Pro/Enterprise on-platform feature, not a published endpoint; republication needs written agreement.
- **daily-ohlc: REQUEST ACCESS** — Technical feeds/historical data are claimed, but no OHLC endpoint or export was published; same written-agreement requirement.
- **monthly-ohlc: REQUEST ACCESS** — Same reason as daily-ohlc; historical financials are claimed, not published as an endpoint.
- **fundamentals: REQUEST ACCESS** — Full fundamental analysis/valuation is a paid on-platform feature; no fundamentals endpoint published; republication needs written agreement.
- Datasets not listed (corporate-actions, mf-nav, news) are not evidenced as Nepalytix endpoints/exports in this research and are SKIP for this source pending verification. (News in particular: only "selected news" as a free-tier display feature, no news API.)

## Sources verified in this dossier
- https://nepalytix.com/terms (full Terms of Service, fetched 2026-10-31)
- https://nepalytix.com/pricing (fetched 2026-10-31)
- https://nepalytix.com/live-market (fetched 2026-10-31)
- https://www.nepalytix.com/ (homepage, fetched 2026-10-31)
- https://nepalytix.com/robots.txt (fetched 2026-10-31)
