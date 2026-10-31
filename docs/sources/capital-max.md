# Source Dossier — Capital Max (Capital Max Securities Ltd., broker no. 62)

- **Research date:** 2026-10-31 (Asia/Kathmandu)
- **Method:** Read-only public web search + text fetch. No sign-in attempted, no purchase, no form submission, no email.
- **Status:** DRAFT for Phase B matrix review. Nothing in this dossier is a permission grant.
- **Operator / identity (verified):** Capital Max Securities Limited, a SEBON-licensed NEPSE member (broker no. 62), established 28 September 2022 under the Companies Act, 2063 — via https://www.financialnotices.com/capital-max-securities-ltd.html and https://capitalmax.com.np/

## (a) Endpoints — what was actually verified

### Public, verified
- Public marketing/broker site: https://capitalmax.com.np/ — fetched 2026-10-31. It describes, in general terms only: stock brokerage service (equity stocks, mutual funds, debentures and bonds listed on NEPSE), depository services via CDS and Clearing Ltd., and customer support. It gives an account-opening flow: submit KYC → verification → "create a trading account with TMS login" → load collateral → trade. It publishes **no API documentation, no endpoint list, and no data-download page** in the text fetched.
- Client tools described (not endpoints): the Financial Notices profile of the same firm lists "lifetime access to fundamental and technical analysis tools", "advanced charting software", "portfolio management tools", "AI-assisted Algorithmic Charting System (ACS)", "TradingView chart integration", a virtual trading platform and a "Capitalize Platform" — https://www.financialnotices.com/capital-max-securities-ltd.html . These are product descriptions, not documented APIs, and no host, path, parameter, or response format was verified for any of them.

### Login-gated (task-supplied host; NOT fetched, NOT signed in)
- Login host named in the research brief: `login.capitalmax.com.np`. This dossier records that host only as brief-supplied. No page on that host was fetched and no credential was used, so this dossier **does not verify** what lives behind it, what its endpoints are, or what its account terms say.
- By the public site's own flow, a TMS login is created only after KYC verification — i.e. charting/portfolio/trading tools sit behind a verified client account, not behind anonymous public access. Which specific data screens are behind the login vs. public could not be verified from public pages and is recorded as a GAP below.

### NOT verified — do not use as a dossier endpoint
- No public Capital Max page fetched in this research confirms a host, path, or auth model for any charting/data API, broker-summary API, or mutual-fund NAV API. In particular, a broker-summary operation name that appears in programme context was **not** confirmed from any public Capital Max page in this research, so it is deliberately **not** recorded here as a verified endpoint. A follow-up verification (account-holder view of the logged-in product, or a written statement from the firm) is required before any such path enters a retention or Worker source list.

## (b) Rate limit / terms clause
- **Documented rate limit: NONE FOUND.** No rate-limit number, quota, or throttling clause was found on any public Capital Max page fetched or returned in search.
- **Terms-of-use clause: NONE FOUND.** Search for Capital Max terms/privacy on its own domain returned no Capital Max terms page (results were unrelated firms / app-store listings). No redistribution, scraping, reuse, or API-use clause for capitalmax.com.np was verified. This is a GAP, not a permission.

## (c) robots.txt — verified by fetch
- URL fetched: https://capitalmax.com.np/robots.txt (2026-10-31)
- Full content:
  - `User-agent: *`
  - `Disallow: /Admin/`
  - `Disallow: /Account/`
  - `Sitemap: https://capitalmax.com.np/sitemap.xml`
- Reading: general crawling is not otherwise disallowed, but `/Admin/` and `/Account/` are disallowed. robots.txt is not a data licence and does not grant API or redistribution rights.

## (d) Auth model
- Public site: no auth (marketing + KYC forms).
- Client product: account created after KYC verification, with a TMS login (public homepage, https://capitalmax.com.np/). The login subdomain is account-gated.
- No API-key, OAuth, or public-token model is documented anywhere found. Whether any data endpoint accepts an API key, a session cookie, or nothing at all is a GAP.

## (e) Cadence / trading-day coverage
- **No data cadence published and verified for Capital Max.** The public site does not state update frequency, session times, or trading-day coverage for any charting/data feed. Do not attribute NEPSE session hours from another source's page to Capital Max.
- The firm is a live NEPSE broker, so its client tools presumably track trading days, but that is inference, not a verified cadence statement, and is not recorded as one.

## (f) Licence / redistribution terms
- **NONE FOUND.** No Capital Max terms, licence, or redistribution statement was located on its public site in this research. The absence of a prohibition in the material fetched is **not** a permission to copy, republish, or serve its data.
- The Google Play listing for the firm's app (developer: Source Code Pvt. Ltd.) declares "No data shared with third parties / No data collected" for the app itself — https://play.google.com/store/apps/details?id=com.sourcecode.capitalmax&hl=en_US — but that is an app-privacy declaration, not a data-redistribution licence, and it is not relied on here as one.

## Governance flag — owner ruling vs. Phase B governance (recorded, not resolved)
- There is a standing owner ruling (programme context, not a Capital Max document) that freely accessible Capital Max APIs are fair-game data sources. Against it stands this dossier's finding: **no public Capital Max document was found that permits third-party reuse or redistribution, and the data tools themselves sit behind a KYC-verified client login.**
- The two readings conflict precisely at the login boundary: treating a login-gated client tool as "freely accessible" because an account holder can reach it is not the same as the source permitting republication. Under Phase B matrix governance (each dataset needs a permitted primary source), Capital Max cannot be recorded as a permitted primary source on the basis of this dossier. Resolution requires either (i) a Capital Max terms/API statement that permits the use, or (ii) a written access agreement. Until then, cross-check use only, and any account-based use must stay inside the account holder's own account terms (which themselves were not verified here).

## GAPS (explicit — not guesses)
1. No public API documentation, endpoint path, parameter, or response format verified for any Capital Max data service.
2. No Capital Max terms of use, privacy policy, rate limit, or redistribution clause found.
3. What is public vs. login-gated beyond "TMS login after KYC verification" is unverified; the login host's contents were not fetched and no sign-in was attempted.
4. No verified cadence, latency, or trading-day coverage statement.
5. No verified mutual-fund NAV endpoint, broker-summary endpoint, or chart-data endpoint — any such path in programme context remains unverified for dossier purposes.
6. Whether the account holder's own account terms permit fetching data for republication on another site is unverified.

## Per-dataset decisions
- **index-close: CROSS-CHECK ONLY** — Charting tools exist for clients, but no public endpoint or reuse permission was verified; usable only to compare against a permitted primary source.
- **daily-ohlc: CROSS-CHECK ONLY** — Same reason; no verified OHLC endpoint or export.
- **broker-flow: CROSS-CHECK ONLY** — No verified broker-summary endpoint or redistribution permission; login-gated area, so it cannot be a permitted primary source on this evidence.
- **fundamentals: CROSS-CHECK ONLY** — Fundamental-analysis tools are described for clients only; no verified fundamentals endpoint or reuse permission.
- **mf-nav: USE-WITH-ACCOUNT** — Only under the owner's own saved Capital Max login and only within whatever that account's terms allow (terms unverified — see GAP 6); this is the narrow account-based exception, not a public-fetch permission, and it must not be presented as a publicly permitted source. If the account terms on inspection prohibit republication, this decision falls back to CROSS-CHECK ONLY.
- Datasets not listed (floorsheet, monthly-ohlc, corporate-actions, news) are not evidenced for Capital Max in this research and are SKIP for this source pending verification.

## Sources verified in this dossier
- https://capitalmax.com.np/ (homepage, fetched 2026-10-31)
- https://capitalmax.com.np/robots.txt (fetched 2026-10-31)
- https://www.financialnotices.com/capital-max-securities-ltd.html (firm profile, search result)
- https://play.google.com/store/apps/details?id=com.sourcecode.capitalmax&hl=en_US (app listing, search result; privacy declaration only)
