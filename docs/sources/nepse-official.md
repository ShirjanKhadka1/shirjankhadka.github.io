# Source dossier — NEPSE official (Nepal Stock Exchange)

- **Source:** Nepal Stock Exchange (NEPSE), official site at nepalstock.com / nepalstock.com.np
- **Dossier status:** DRAFT — research only, 31 October 2026 (NPT). No logins, purchases, form submissions, or emails were used.
- **Honesty rule applied:** nothing below is invented. Anything not verified from a fetched page or a search result is marked GAP. Third-party descriptions of NEPSE's site are labelled third-party; they are not NEPSE documentation.

## 1. Endpoints used for market data

### 1a. Documented public API? — NO, none found

No documented public API, developer documentation, API key programme, or endpoint catalogue published by NEPSE itself was found in this research. Searches for NEPSE API documentation returned only:

- unofficial reverse-engineered wrappers (see §1c), and
- a low-weight secondary article (codingasik.com) asserting that nepalstock.com "has an official NEPSE website API, which identifies itself as the NEPSE Website API and supports the systems behind its online market information" — https://www.codingasik.com/2025/09/nepalstock-com.html

That article is **not** NEPSE documentation and does not publish endpoint paths, auth, or terms. It is not treated here as evidence of a documented public API.

**Finding: NEPSE official has NO verified documented public API. Every market-data path below is a frontend-served endpoint that NEPSE's own web pages call, evidenced only indirectly (third-party code samples and republications of NEPSE file links), not by NEPSE's own API docs.**

### 1b. Frontend-served endpoints evidenced (not documented APIs)

| Data | Endpoint / path evidenced | Evidence source | Status |
|---|---|---|---|
| Market summary (index, turnover, breadth) | `https://www.nepalstock.com.np/api/shoper/market-summary` | Code sample in a third-party engineering blog, https://blogs.mausamadhikari.com.np/2026/10/orchestrating-self-healing-multi-agent.html (which calls this URL with `requests.get`) | Frontend-served, NOT documented. Do not treat the blog as NEPSE's documentation. |
| Company / exchange notices (PDF files) | `https://www.nepalstock.com.np/api/nots/news/notice/fetchFiles/<hash>.pdf` | NEPSE notice link quoted in a ShareSansar margin-trading article, e.g. `.../api/nots/news/notice/fetchFiles/58b9968c2a4c721ddc2be46b327f1895.pdf` | File-serving path for published notices, NOT a documented data API. |
| Company disclosures / filings (PDF files) | `https://www.nepalstock.com.np/api/nots/security/fetchFiles?fileLocation=<company>/<date>/<file>.pdf` | Multiple ShareSansar republications of NEPSE filings quoting this pattern, e.g. Union Life bonus-share notice, NMB dividend notice, NIC ASIA book-closure notice | File-serving path for published filings, NOT a documented data API. |
| Index levels (NEPSE + sub-indices) | No specific official path verified in this research | NEPSE's site displays them; third-party wrappers expose them under their own routes (see §1c) but the upstream NEPSE path was not exposed in any fetched page | GAP — do not guess a path |
| Live quotes / today's prices | No specific official path verified in this research | Same as above | GAP — do not guess a path |
| Floorsheet (trade-by-trade) | No specific official path verified in this research | Same as above; floorsheet content (buyer/seller broker, quantity, price, time, contract id) is evidenced from third-party floorsheet pages, not from an official endpoint | GAP — do not guess a path |
| Listed-securities / universe list | No specific official path verified in this research | No official list page or list endpoint was returned by search (see §7 for what was tried) | GAP — do not guess a path |
| Daily OHLC history | No specific official path verified in this research | Third-party wrappers expose history under their own routes; upstream NEPSE path not verified | GAP — do not guess a path |
| Broker-flow summary | No distinct official product verified | Broker attribution exists only inside floorsheet trades; no separate NEPSE broker-summary endpoint was found | GAP / not a distinct dataset (see decision table) |

### 1c. What third-party wrappers say about the frontend layer (NOT NEPSE documentation)

- `nepseman-api` (PyPI, https://pypi.org/project/nepseman-api/1.0.0/) describes itself as: "Unofficial, reverse-engineered REST + WebSocket API for Nepal Stock Exchange (NEPSE) market data. Not affiliated with NEPSE or nepalstock.com.np." It says it "reverse-engineers the authentication layer of nepalstock.com.np — including WASM-based token obfuscation and salt-based payload signing". Its own routes (`/api/v1/market/status`, `/api/v1/prices/today`, `/api/v1/indices/nepse`, `/api/v1/securities/{symbol}`, `/api/v1/floorsheet/`, etc.) are **the wrapper's routes, not NEPSE's**. They are listed here only to show what data categories the frontend serves, not as NEPSE endpoints to call.
- `nepse-data-api` (PyPI, https://pypi.org/project/nepse-data-api/) similarly says it "handles authentication, token management, and data scrambling automatically" and lists "27+ API Endpoints (Live Market, Floorsheets, Depth, Market Cap, etc.)" — again a wrapper, not NEPSE documentation.

**Consequence for Phase B governance:** because the only machine-readable NEPSE paths are undocumented frontend endpoints protected by token obfuscation, fetching them directly from a Worker is **not** a documented-API use. It is at best an undocumented-frontend use, and at worst a use NEPSE's licensing model reserves to licensed distributors (see §5).

## 2. Rate limit

**GAP — no documented rate limit published by NEPSE was found.**

- No rate-limit figure (requests/second, per-IP, per-day) appears in any NEPSE page or search result found in this research.
- Do NOT attribute wrapper behaviour to NEPSE: `nepseman-api` caches "live data 30s, stable data 10 min" and applies "per-IP rate limits via slowapi" — those are the wrapper's own limits, not NEPSE's. `nepse-data-api` likewise describes its own caching layer ("built-in caching layer … to respect NEPSE's server load") — again the wrapper's choice, not a published NEPSE limit.
- Third-party dashboards report their own refresh cadences (e.g. "every 30 seconds", "every 10 seconds", "about every 15 seconds" via a paid MDP feed) — those are the dashboards' poll rates, not NEPSE's published limit.

**Applicable terms clause in place of a rate limit: none found on NEPSE's own site (see §5).** The absence of a published limit is itself the finding; it does not imply unlimited or permitted use.

## 3. robots.txt stance

**UNKNOWN — not verified in this research session.**

- Attempted fetch: `https://www.nepalstock.com/robots.txt` via the text-fetch tool on 31 October 2026.
- Result: fetch failed with a network error ("Page not found … network error (DNS, timeout, or connection refused)"), with no HTTP status returned. The fetch was not repeated (per tool guidance on a failed fetch).
- Second attempt (parent synthesis pass, same day): same URL, same network-error failure, no HTTP status. Not retried further. Stance remains UNKNOWN.
- Therefore this dossier does **not** claim robots.txt is absent, and does **not** claim any allow/disallow stance. A live-browser or direct re-check is still owed before any crawler decision relies on robots.txt.
- No robots.txt content for nepalstock.com / nepalstock.com.np was returned by any search result in this research either.

## 4. Auth model

- **Public market data (website display): no account required to view.** NEPSE's market pages are public-facing; no login is evidenced for viewing indices, prices, floorsheets, or notices.
- **Frontend-endpoint session token: required in practice, undocumented.** Per the `nepseman-api` description (third-party, not NEPSE docs): the frontend uses "WASM-based token obfuscation and salt-based payload signing", sessions re-authenticate automatically (the wrapper notes "Token expired errors | NEPSE session TTL | Automatic — session re-authenticates every 45s"), and the wrapper's troubleshooting notes "`403` / connection refused | Foreign IP geo-blocked | Run from a Nepal network". Treat all three points as **wrapper-reported behaviour, not NEPSE-published auth documentation**. In particular, the possible Nepal-IP geo-block is a material risk for a Cloudflare Worker (whose egress IPs are not Nepal IPs) and must be tested, not assumed away.
- **Trading (NOTS/TMS): account required, out of scope.** NEPSE's online trading system requires a broker-issued username/password. That is trading access, not market-data access, and is not a route to market data for this programme.
- **No API key / OAuth programme for market data was found.** There is no verified "sign up for an API key" flow on NEPSE's own site.

## 5. Licence / republication terms

**No NEPSE terms-of-use, licence, or republication clause was found on NEPSE's own site in this research.**

- Searches for NEPSE terms returned only unrelated sites (Nepalytix's own terms, a Nepal Share app's terms, etc.) — none of them is NEPSE's terms, and none is quoted here as NEPSE's.
- No copyright footer, data-use policy, or "you may republish" statement from nepalstock.com / nepalstock.com.np was retrieved, because the official site's pages were not successfully text-fetched in this session (see §3 and §8).
- **What IS evidenced about NEPSE's licensing model — from a licensed distributor, not from NEPSE itself:**
  - Source Code Pvt. Ltd.'s Market Data Provider (MDP), https://data.smartwealthpro.com/about/ and https://data.smartwealthpro.com/, describes itself as "officially licensed by NEPSE" / "NEPSE-Licensed Market Data & Financial Intelligence API", offering "real-time stock prices, corporate actions, and financial reports" through a "customizable API" with "flexible pricing". A downstream product (NChartPro, https://nchartpro.com/) states its prices, indices, and floorsheet "come from the MDP (Market Data Provider) API by Source Code Pvt. Ltd., under a paid contract".
  - This shows NEPSE operates (or authorises) a **paid, licensed distribution channel** for real-time market data. It does not, by itself, prove that unlicensed republication is prohibited — but it is strong evidence that a permitted commercial route exists and that direct frontend scraping is not the licensed route.

**Close paraphrase of the only on-point terms-adjacent statement found:** none from NEPSE itself exists in this dossier. The MDP pages' claim is paraphrased above and is attributed to Source Code, not to NEPSE.

### Standing tension — recorded, not resolved (as instructed)

- **Owner ruling (standing context):** freely accessible APIs are fair-game data sources for a real-time auto-updating site, with NEPSE official as arbiter.
- **Phase B matrix governance:** each dataset needs a permitted primary source; no source is fetched by the real-time Worker without a dossier.
- **Conflict point found in this research:** NEPSE official's market data is freely *viewable* on its website, but (a) no documented public API was found, (b) no republication licence was found, and (c) a paid NEPSE-licensed distribution channel (MDP) exists for exactly the real-time data a Worker would want. "Freely viewable in a browser" and "freely reusable as a machine-ingested, republished feed" are therefore **not shown to be the same thing** for NEPSE official. This dossier does not resolve the tension; it flags it for the programme owner. The per-dataset decisions in §6 follow the stricter reading (licensed access for primary ingest; official site retained as verification arbiter) until NEPSE's own terms or a licence are produced.

## 6. Source cadence

- **Trading week (current): Monday to Friday.** Multiple September–October 2026 sources agree the week changed in April 2026 from the old Sunday–Thursday week to Monday–Friday, e.g. https://punji.app/learn/nepse-trading-hours ("NEPSE trades Monday to Friday, 11:00 AM to 3:00 PM Nepal Standard Time… The exchange is closed on Saturday, Sunday and Nepali public holidays") and https://kharchapatra.com/blog/nepse-settlement-t2-circuit-breaker-nepal (same change, April 2026).
  - **Conflicting older sources still in circulation** say Sunday–Thursday (e.g. https://wilson.com.np/nepse-online-trading/, https://merokalam.com/blog/nepal-share-market/). Those are treated as stale, not as evidence of the current week.
  - **Corroboration:** Friday 30 October 2026 was a trading day (348 scrips traded, NEPSE close 2,690.15, turnover Rs 8.89bn — reported by multiple dashboards the same day), which is consistent with Monday–Friday and inconsistent with the old Sunday–Thursday week.
- **Sessions (NPT, UTC+5:45):** pre-open approx. 10:30–11:00; continuous trading 11:00–15:00. (Pre-open order-entry window is variously given as 10:30–10:45 with matching at 11:00; the 11:00–15:00 continuous session is consistent across sources.)
- **Closed:** Saturdays, Sundays, and Nepali public holidays (exact annual calendar published by NEPSE; not retrieved in this research — GAP for the specific holiday list).
- **Intraday update frequency on NEPSE's own site:** GAP — no official refresh interval was verified. Third-party dashboards poll at 10–30 seconds; that is their cadence, not NEPSE's published cadence.
- **Final close data:** continuous trading ends 15:00 NPT; the day's final index/turnover figures are the 15:00 close values. The exact time at which NEPSE's site marks the session "final" (as opposed to last intraday tick) was **not verified from an official source** — GAP. Do not import any internal post-close timing rule into this dossier as if it were NEPSE's.
- **Settlement (context only):** T+2 via CDS and Clearing Ltd (CDSC) — not a data-cadence fact, recorded only because it explains why same-day re-trading does not occur.

## 7. Per-dataset decisions

Decision vocabulary used: exactly one of USE / USE-WITH-ACCOUNT / CROSS-CHECK ONLY / REQUEST ACCESS / SKIP.

| Dataset | Decision | Reason |
|---|---|---|
| index-close | REQUEST ACCESS | NEPSE is the arbiter for the close, but there is no documented public API and no republication licence, and a paid NEPSE-licensed channel (MDP) exists for real-time data. Primary ingest should go through that licensed route (or a written NEPSE permission); until then NEPSE official may only be used to verify a close obtained elsewhere. |
| floorsheet | REQUEST ACCESS | Same as index-close, and stronger: floorsheet is the highest-volume, most commercially sensitive feed (trade-by-trade, broker-attributed). No documented endpoint or licence was found. Primary bulk ingest requires licensed access; sampled verification against the public floorsheet display is not primary ingest. |
| broker-flow | CROSS-CHECK ONLY | No distinct NEPSE broker-flow product or endpoint was verified; broker attribution exists only inside floorsheet trades. Do not treat broker-flow as a separate NEPSE dataset. Sampled broker totals may be validated against floorsheet trades, but broker-flow's primary source must be a floorsheet source that is itself permitted. |
| daily-ohlc | REQUEST ACCESS | History is served by the frontend (per wrappers) but no documented history endpoint or licence was found. Primary daily-OHLC ingest requires licensed access; NEPSE official remains the cross-check for closes. |
| universe/reference | CROSS-CHECK ONLY | The official list is the arbiter for whether a symbol exists and what type it is (see §8), but no verified public list endpoint or bulk-reuse licence was found. Use NEPSE official to validate universe membership symbol-by-symbol; do not bulk-scrape it as the primary universe feed. |
| corporate-actions | CROSS-CHECK ONLY | Official NEPSE notices/filings (the `/api/nots/.../fetchFiles` PDFs) are the authoritative proof for an individual action — this is the verification use the programme's own portal-manipulation law requires. But bulk republication of the notice archive as a primary feed is not licensed by anything found here, so the dataset's primary feed must come from a permitted source, verified item-by-item against NEPSE notices. |
| news | CROSS-CHECK ONLY | NEPSE alerts/notices are official announcements and may verify a news item, but no documented news API or republication licence was found. NEPSE official is not a permitted primary news feed for the Worker. |

**Worker implication (for the parent to apply, not implemented here):** no dataset above is USE or USE-WITH-ACCOUNT. The real-time Worker must not fetch nepalstock.com / nepalstock.com.np as a primary source on the basis of this dossier. REQUEST ACCESS items are blocked on licensed/written access; CROSS-CHECK ONLY items may be consulted for verification, not bulk ingest.

## 8. Orphan-securities check — NICD88 and SBD87 (section inside this dossier)

### 8a. Official-register check — NOT directly verified

**The official NEPSE register / listed-securities list could not be checked directly in this research. This is stated exactly, as instructed, and the finding below is NOT presented as an official-register confirmation.**

What was tried:

1. `https://www.nepalstock.com/robots.txt` text-fetch — failed with a network error (DNS/timeout/connection refused), no HTTP status (see §3). Not repeated.
2. Web searches for an official listed-securities list page or list endpoint on nepalstock.com / nepalstock.com.np (queries including `site nepalstock.com.np listed companies securities`, NEPSE API endpoint queries, and symbol-specific queries) — returned no official list page or list URL. Results were third-party mirrors (ShareSansar, ShareHub), wrapper documentation, and NEPSE notice PDFs quoted by third parties.
3. Symbol-specific searches for NICD88 and SBD87 — returned third-party company pages and listing news, not an official register entry.

**What is still owed for a true official-register confirmation:** a successful fetch of NEPSE's listed-companies/securities page (or its list endpoint, once identified) showing NICD88 and SBD87 present or absent, or a NEPSE delisting/redemption notice for either symbol. Neither was obtained here.

### 8b. Best available evidence (third-party, cross-checked across two independent mirrors)

Both symbols show as **Active and recently traded** in late October 2026, with maturities years in the future. That combination is inconsistent with "matured / redeemed / delisted" and consistent with "still listed, omitted from the site's 426-symbol universe by a universe-construction gap".

#### NICD88

- **Full security name:** 8.5% NIC Asia Debenture 2088 — also styled "NIC ASIA Rinpatra 2088" (ShareHub) / "NIC ASIA Bank Rinpatra 2088" (ShareSansar listing news).
- **Type:** Non-Convertible Debenture (ShareHub sector classification); Corporate Debentures in ShareSansar's listing coverage. Issuer: NIC ASIA Bank Limited.
- **Coupon / tenor:** 8.5% per annum; 10-year tenor. Issue opened 6 Ashar 2078, closed Ashar 20, 2078; allotted 25 Ashar 2078. Total issue 30,00,000 units at Rs 1,000 face value (12 lakh public + 18 lakh private placement); **listed units 15,73,872** (ShareSansar listing news, 13 September 2021, and ShareHub — the listed figure is the listed tranche, not the full 30 lakh issue).
- **Listing date:** 13 September 2021 (ShareHub).
- **Maturity:** BS year **2088** (in the name and in every issue report). **Exact AD maturity date: GAP** — no exact date was verified for NICD88 (the BS 2088 year spans roughly April 2031–April 2032; do not convert it to a single AD date without a dated source).
- **Still listed? (corroborating evidence, not official register):** ShareHub shows NICD88 as **Active, Rs 1,092, 28 October 2026 01:46 PM** (https://sharehubnepal.com/company/NICD88/news), with trades also on 27 October (Rs 1,077.10) and 14 October 2026. A matured/redeemed security would not trade in October 2026.
- **Sources:** https://sharehubnepal.com/company/NICD88/news ; https://www.sharesansar.com/newsdetail/these-two-debentures-are-now-listed-in-nepse-2021-09-13?skip=true ; https://www.sharesansar.com/newsdetail/public-issue-of-85-nic-asia-debenture-2088-open-from-today-2021-06-20?skip=true

#### SBD87

- **Full security name:** 8.5% Sanima Debenture 2087.
- **Type:** Non-Convertible Debenture (ShareHub) / Corporate Debentures (ShareSansar). Issuer: Sanima Bank Limited.
- **Coupon / tenor:** 8.5% per annum; 10-year tenor ("will mature 10 years from now, i.e. in the year 2087"). Issue to the public from 1 Poush 2077, allotted 21 Poush 2077. Issue 40,00,000 units at Rs 1,000 face value; **listed units 30,52,404** (ShareSansar listing news, 21 February 2021, and ShareHub).
- **Listing date:** 21 February 2021 (ShareHub; ShareSansar listing news same date).
- **Maturity:** BS year **2087** (in the name and in every issue report). Third-party debenture guidance (Nepalytix, https://nepalytix.com/blog/how-to-invest-in-debentures-in-nepal-a-complete-guide) cites ShareSansar's debenture register as giving SBD87's exact maturity as **11 January 2031** — recorded here as a **third-party-sourced exact date, not an official-register date**, and to be re-verified before it is published as a maturity date.
- **Still listed? (corroborating evidence, not official register):** ShareHub shows SBD87 as **Active, Rs 1,105, 28 October 2026 01:06 PM**, 50 units, 1 trade, turnover Rs 55,250 (https://sharehubnepal.com/company/SBD87). This also corrects any reading of SBD87 as "last traded 5 October": it traded on 28 October 2026. Its absence from a monthly archive is therefore an updater/coverage gap, not evidence of delisting.
- **Sources:** https://sharehubnepal.com/company/SBD87 ; https://www.sharesansar.com/newsdetail/3052404-units-of-85-sanima-debenture-2087-now-listed-in-nepse-2021-02-21 ; https://nepalytix.com/blog/how-to-invest-in-debentures-in-nepal-a-complete-guide (exact-date claim only)

### 8c. Branch determination

**Branch = add as typed instruments to the universe — for BOTH symbols.**

- Neither symbol meets the "mark the page ended (keep history)" branch: neither has matured (maturities BS 2087 / 2088 are in the future), neither shows a redemption/delisting notice in any source found, and both traded on 28 October 2026.
- The applicable branch under the task's own definitions is therefore: **if still listed → add as typed instruments** — i.e. NICD88 and SBD87 as Non-Convertible Debenture / Corporate Debenture instruments, with the names, coupons, listing dates, listed units, and BS maturity years above.
- **Condition attached:** because the official register itself was not directly verified (§8a), the universe addition should be gated on the outstanding official-register confirmation (one successful official list fetch, or absence of any NEPSE delisting notice) before it is treated as closed. The evidence for "still listed" is strong (two independent mirrors + live October 2026 trades + future maturities), but it is not, by itself, an official-register check.
- **No page or universe change was implemented in this research.** This dossier only reports the finding and the branch.

## 9. Gaps — everything not verified (consolidated)

1. **robots.txt stance** — fetch failed with a network error; stance unknown, not "absent".
2. **No documented NEPSE public API** — no endpoint catalogue, auth docs, or API-key flow found on NEPSE's own site.
3. **Specific official paths** for live quotes, indices, floorsheet, universe list, and daily-OHLC history — not verified; do not guess them. Only `api/shoper/market-summary` and the two `api/nots/.../fetchFiles` file paths are evidenced, and only via third parties.
4. **Published rate limit** — none found; wrapper caching/poll rates are not NEPSE's limit.
5. **NEPSE's own terms / licence / republication clause** — none found on NEPSE's site; the MDP licensed channel is evidenced only via the distributor's own pages.
6. **Official refresh interval and official "final close" finalisation time** — not verified from an official source.
7. **Official annual holiday calendar** — not retrieved.
8. **Official-register confirmation for NICD88 and SBD87** — not obtained (see §8a); corroborating third-party evidence only.
9. **Exact AD maturity date for NICD88** — not verified (BS 2088 year only).
10. **Exact AD maturity date for SBD87 from an official source** — only a third-party-sourced 11 January 2031 date; re-verify before publishing.
11. **Whether the frontend geo-block (Nepal-IP only) applies to Worker egress** — wrapper-reported only; untested.
12. **Whether NEPSE's site was reachable at all in this session** — the single robots.txt fetch failed with a network error; no successful official-site fetch was achieved in this research, so no claim is made here about current official-site reachability from this environment.

## 10. Sources consulted (verbatim URLs)

- https://pypi.org/project/nepseman-api/1.0.0/ (wrapper description, auth, routes, geo-block note)
- https://pypi.org/project/nepse-data-api/ (wrapper description)
- https://blogs.mausamadhikari.com.np/2026/10/orchestrating-self-healing-multi-agent.html (`api/shoper/market-summary` code sample)
- https://www.codingasik.com/2025/09/nepalstock-com.html ("official NEPSE website API" claim — low weight, not NEPSE docs)
- https://data.smartwealthpro.com/about/ and https://data.smartwealthpro.com/ (MDP licensed-distributor claim)
- https://nchartpro.com/ (MDP under paid contract)
- https://punji.app/learn/nepse-trading-hours and https://kharchapatra.com/blog/nepse-settlement-t2-circuit-breaker-nepal (Mon–Fri week, April 2026 change, 11:00–15:00)
- https://sharehubnepal.com/company/SBD87 and https://sharehubnepal.com/company/NICD88/news (Active status, Oct 2026 trades, listing data)
- https://www.sharesansar.com/newsdetail/3052404-units-of-85-sanima-debenture-2087-now-listed-in-nepse-2021-02-21
- https://www.sharesansar.com/newsdetail/these-two-debentures-are-now-listed-in-nepse-2021-09-13?skip=true
- https://www.sharesansar.com/newsdetail/public-issue-of-85-nic-asia-debenture-2088-open-from-today-2021-06-20?skip=true
- https://nepalytix.com/blog/how-to-invest-in-debentures-in-nepal-a-complete-guide (SBD87 exact-maturity claim only)
- Attempted, failed: https://www.nepalstock.com/robots.txt (network error, no HTTP status)
