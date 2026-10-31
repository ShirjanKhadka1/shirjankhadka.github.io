# Source Dossier — Chukul (Pi Tech Public Limited)

- **Research date:** 2026-10-31 (Asia/Kathmandu)
- **Method:** Read-only public web search + text fetch. No sign-in attempted, no purchase, no form submission, no email. One fetch attempt (chukul.com homepage) failed at the fetch layer and was not retried; all findings below rest on pages that did fetch.
- **Status:** DRAFT for Phase B matrix review. Nothing in this dossier is a permission grant.
- **Operator / identity (verified via secondary listings + own FAQ page):** Chukul, a NEPSE research/analytics platform by Pi Tech Public Limited; web + Android app. Own FAQ page: https://chukul.com/feedback ; app listing: https://Www.appbrain.com/app/chukul-nepse-app/com.pitech.portfoliotracker (note the source URL's capitalisation as returned).

## (a) Endpoints — what was actually verified

### Task-supplied pattern — recorded, NOT independently verified from a public Chukul page
- Floorsheet-by-date pattern named in the research brief: `/api/data/v2/floorsheet/bydate/` on the Chukul host. This dossier records the pattern **only as brief-supplied**. No public Chukul API documentation, endpoint catalogue, parameter list, or response schema was found in search or in any fetched Chukul page in this research, so the pattern's host, exact path parameters, auth requirement, pagination, and response shape are **unverified** for dossier purposes and must be confirmed (by a documented reference or by an authorised account-holder inspection) before it enters a retention or Worker source list.
- Indirect support, not documentation: Chukul's robots.txt sitemap points to `https://chukul.com/api/report/blog/sitemap.xml` (see §c), which shows an `/api/` namespace exists on the site. That does not document the floorsheet endpoint.

### Product surface (verified, not endpoints)
- Chukul's own FAQ page (https://chukul.com/feedback) describes the platform as bringing together "live market data, charts, technical signals, scanners, broker and volume analysis, company fundamentals and portfolio tools" on web and Android. No endpoint, download, or export mechanism is described on that page.
- Plans: Diamond, Platinum, Elite, plus paid add-ons (RRG Dashboard, Signal Desk, SMC packs) — same FAQ page. Payment methods at checkout: eSewa, Khalti, ConnectIPS, bank transfer — same page.

### NOT verified
- No public Chukul API reference, bulk-download page, CSV export, or data-dictionary page was found. Historical OHLC, monthly series, corporate actions, and index history are not evidenced as exports; they are evidenced only as on-platform chart/tool features (see above).

## (b) Rate limit / terms clause
- **Documented rate limit: NONE FOUND.** No rate-limit number or quota was found on any Chukul page fetched or returned in search.
- **Terms-of-use clause: NONE FOUND for chukul.com.** A search for Chukul terms/privacy returned only unrelated firms (Chukar Cherries, Chukka, etc.); no Chukul terms, licence, scraping, or redistribution clause was located. This is a GAP, not a permission. In particular, no Chukul text was found that permits copying, republishing, or serving its data on a third-party site.

## (c) robots.txt — verified by fetch
- URL fetched: https://chukul.com/robots.txt (2026-10-31)
- Content in full:
  - Named AI/search-training agents are each `Disallow: /`: GPTBot, ChatGPT-User, Google-Extended, PerplexityBot, Amazonbot, ClaudeBot, Omgilibot, FacebookBot, Applebot, anthropic-ai, Bytespider, Claude-Web, Diffbot, ImagesiftBot, Omgili, YouBot.
  - `User-agent: *` → `Allow: /`
  - `Sitemap: https://chukul.com/api/report/blog/sitemap.xml`
- Reading: general web crawling is allowed for non-listed agents, but AI crawlers are explicitly excluded. robots.txt does not grant API or redistribution rights, and the AI-bot exclusions are a caution against treating the site as open training/feedstock data.

## (d) Auth model
- Account-based. The FAQ page states feedback requires login ("Log in to send feedback, so we can reply to you"), profiles show active packages/expiry and signed-in devices, and a new sign-in beyond a plan's device limit requires a one-time code sent to the phone — all from https://chukul.com/feedback.
- App-store description (secondary source): "The registered user with valid phone number can access chukul either through web app or mobile app… The basic features are available free of cost to registered users while specific packages… must subscribe" — i.e. registration (phone) gates even basic use; richer tools are paid.
- **GAP:** Whether the floorsheet-by-date pattern requires a session, token, or subscription, and which plan (if any) unlocks it, was not verified from any public page.

## (e) Cadence / trading-day coverage
- Verified from the FAQ page (Q13, https://chukul.com/feedback): "During NEPSE trading hours prices, indices and market desks update live. Outside trading hours Chukul shows the latest closing data."
- No numeric latency, poll interval, post-close finalisation time, or holiday calendar statement was verified. Trading-day coverage is therefore recorded only as "live in NEPSE trading hours; latest close otherwise" — the site's own wording, not a measured cadence.

## (f) Licence / redistribution terms
- **NONE FOUND.** No Chukul licence or redistribution terms were located. The platform is a paid subscription product (Diamond/Platinum/Elite + paid add-ons), which cuts against assuming its data is open for republication, but that commercial framing is not itself a licence term and is not presented as one.
- The FAQ's investment-advice disclaimer (Q14, same page) — signals/scanners/backtests are analytical tools, past results do not guarantee future returns — governs use of its signals, not redistribution of its market data.

## Governance flag — owner ruling vs. Phase B governance (recorded, not resolved)
- There is a standing owner ruling (programme context, not a Chukul document) that freely accessible Chukul APIs are fair-game data sources, and programme context names Chukul's public raw-floorsheet API as a broker-collection primary. Against it stands this dossier's finding: **no Chukul document was found that permits third-party reuse or republication, no public API documentation was found at all, and the product is account-gated (phone registration) with paid tiers.**
- The conflict is direct for Phase B governance: "an endpoint responds" is not "the source permits this dataset as a primary source." Until Chukul's terms are located or written permission is obtained, Chukul cannot be recorded as a permitted primary source, however useful it is as a cross-check. This dossier therefore holds floorsheet at REQUEST ACCESS rather than USE, and everything else at cross-check only.

## GAPS (explicit — not guesses)
1. No public Chukul API documentation; the floorsheet-by-date pattern is brief-supplied only (host, parameters, auth, pagination, response shape all unverified).
2. No Chukul terms of use, licence, redistribution, scraping, or rate-limit clause found.
3. Auth requirement and plan gating for any data API unverified.
4. No verified export/download mechanism for daily-OHLC, monthly-OHLC, index history, or fundamentals.
5. No verified post-close finalisation time or numeric latency.
6. Chukul homepage text fetch failed once (fetch-layer failure, not a site verdict) and was not retried; homepage claims beyond the FAQ page are therefore not relied on here.

## Per-dataset decisions
- **floorsheet: REQUEST ACCESS** — The brief-supplied pattern may serve this dataset, but with no public API documentation and no redistribution terms found, written permission / terms clarification from Chukul must precede any primary-source or republication use.
- **broker-flow: CROSS-CHECK ONLY** — Broker/volume analysis is an on-platform feature (FAQ page), but no broker-flow endpoint or export was verified; usable only to compare against a permitted primary source.
- **index-close: CROSS-CHECK ONLY** — Live indices are displayed on-platform, but no index endpoint or export was verified.
- **daily-ohlc: CROSS-CHECK ONLY** — Charts/history are on-platform features; no OHLC endpoint or export was verified.
- **monthly-ohlc: CROSS-CHECK ONLY** — Same reason; no monthly export or endpoint verified.
- **fundamentals: CROSS-CHECK ONLY** — Company fundamentals are listed as an on-platform feature only; no fundamentals endpoint or export verified.
- Datasets not listed (corporate-actions, mf-nav, news) are not evidenced for Chukul in this research and are SKIP for this source pending verification.

## Sources verified in this dossier
- https://chukul.com/feedback (FAQ + product/plan/auth description, fetched 2026-10-31)
- https://chukul.com/robots.txt (fetched 2026-10-31)
- https://Www.appbrain.com/app/chukul-nepse-app/com.pitech.portfoliotracker (app listing, secondary source for registration/subscription framing)
