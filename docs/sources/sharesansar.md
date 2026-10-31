# Source dossier — ShareSansar (IMS Investment Management Services Pvt. Ltd.)

- **Source:** ShareSansar, described on its own site as "No.1 online
  financial portal of Nepal" for share-market information
- **Site:** https://www.sharesansar.com (terms page served as
  http://www.sharesansar.com/terms-and-conditions)
- **Researched:** 2026-10-31, read-only (browser text search/fetch only; no login, no form, no email)
- **Status:** DRAFT — gates a retention-roll `phase_b` flip and any Cloudflare Worker fetch.

## What it publishes

ShareSansar's own self-description (via search results) covers:
"Today's Share Price, Floor-sheet, Indices, Dividend, AGM, Book
closure, Bonus, IPO, FPO, Right Share, Cash, Updated, Mutual fund,
IPO, Company, Banks, Hydro power, Online Portfolio Tracker, Insurance,
Finance and whole detail information of investment in context of
Nepal." In other words: company pages, daily prices, floorsheet,
indices, dividend/AGM/book-closure/bonus/rights/IPO/FPO tables, news
and a portfolio tracker. It is a third-party aggregator portal, not a
primary publisher: its own terms say its stock-market data "is provided
by a third party" (see (f)).

## (a) Endpoints / publication channel

- **Website (verified as a live site via its terms page fetch
  2026-10-31):** https://www.sharesansar.com — company, price,
  floorsheet, indices, dividend/AGM/book-closure, IPO/FPO/right-share
  and news sections, per its self-description above.
- **Terms page (verified by direct fetch 2026-10-31):**
  http://www.sharesansar.com/terms-and-conditions — the primary
  evidence for (b) and (f) below.
- **Specific company-page / data-page URLs: NOT verified in this
  pass.** Search for ShareSansar company/dividend pages returned
  unrelated (Indian-market) results, and no ShareSansar company-page
  URL was fetched. Do not point a Worker at a guessed ShareSansar
  company URL; the page pattern is a GAP.
- **API / feed: NONE FOUND.** No public API, data feed or bulk export
  was found on the terms page or in search. The terms page describes
  a website and a mobile app ("the Service"), not an API product.

## (b) Rate limit, or terms-of-use clause

- **No published rate limit found.** No numeric rate limit appears on
  the fetched terms page or in search.
- **Applicable terms clause (in place of a rate limit, quoted from the
  fetched terms page):** the page's opening disclaimer, not a rate
  clause, is the governing term for automated use — see (f). The terms
  page as fetched is predominantly a Privacy Policy (IMS Investment
  Management Services Pvt. Ltd. as owner; account registration asks
  for full name, email, password and phone number for certain parts of
  the Service). No crawl, scraping, API-use or republication clause
  was found in the fetched text.

## (c) robots.txt

- **Fetched 2026-10-31:** https://www.sharesansar.com/robots.txt
- **Content, verbatim:**
  ```
  User-agent: *
  Disallow:
  ```
  Empty `Disallow:` for all user-agents: no path restriction in
  robots.txt. As with the other dossiers, this permits crawling in the
  robots sense; it is not a licence to republish, and it does not
  override the accuracy/reliability limits in the site's own terms.

## (d) Auth model

- **Public browsing** for the portal's market content as described.
- **Account for certain parts:** per the fetched terms/privacy text,
  creating an Account (full name, email, password, phone number) is
  "required to access certain parts of the Service" (e.g. portfolio
  tracker features). No account is needed for the cross-check use
  proposed below, and no ShareSansar account should be used to obtain
  market data for republication — the account is a personal-user
  feature, not a data licence.

## (e) Cadence

- **Daily / as-published.** "Today's Share Price" and floorsheet
  content implies daily market-day updates; news and dividend/AGM
  tables update as events are published. No update schedule, refresh
  interval or real-time guarantee is stated on the fetched terms page
  — indeed the terms disclaim real-time status (see (f)).
- **Not real-time by its own terms:** the disclaimer below explicitly
  says data "is not necessarily real-time or accurate", so no Worker
  may treat ShareSansar as a live feed.

## (f) Licence / redistribution terms

- **Quoted from the fetched terms page (2026-10-31), opening
  disclaimer, verbatim:**
  > "Sharesansar reminds the user that the data contained in its app
  > and website is not necessarily real-time or accurate. All stock
  > market data is provided by a third party. Sharesansar or anyone
  > involved with Sharesansar will not accept any liability for loss or
  > damage as a result of reliance on the information including data,
  > quotes, charts, and buy/sell signals contained within the platform."
- **What was NOT found:** no redistribution, republication, scraping
  or reuse licence appears in the fetched terms text; the page is a
  disclaimer + privacy policy, not a data licence. The owner is
  identified as IMS Investment Management Services Pvt. Ltd.,
  Dhalko Linkroad-17, Kathmandu (contact sharesansar@gmail.com,
  977-01-5359786/5365399, Editor: Usha Shakya, Dept. of Information
  Regd No. 669/074-75 — from the fetched page footer).
- **Consequence:** third-party-supplied, not-guaranteed-accurate data
  with no republication licence cannot be a primary source and cannot
  be republished as Nepse Decode data. At most it can prompt a check
  against a primary source.

## Per-dataset decisions — expectation tested, not just asserted

The prior expectation was CROSS-CHECK ONLY for ShareSansar. **That
expectation is CONFIRMED by the evidence, and the evidence makes it
stronger than a preference:** the site's own disclaimer (third-party
data, "not necessarily real-time or accurate", no liability) rules
out primary use on accuracy grounds alone, and the absence of any
republication licence rules out republishing its tables as site data.
Cross-check use below means: a human or job may compare a
primary-source figure against ShareSansar to spot a discrepancy, and
must then resolve the discrepancy from the primary source — never by
adopting ShareSansar's figure.

- **corporate-actions — CROSS-CHECK ONLY.** Dividend/AGM/book-closure/
  bonus/rights tables can flag a missing or mismatched action; the
  issuer notice / NEPSE filing settles it.
- **news — CROSS-CHECK ONLY.** Portal news can surface a story lead;
  authenticity still requires the issuer/SEBON/NEPSE document.
- **fundamentals — CROSS-CHECK ONLY.** Company financial summaries
  can flag a discrepancy; the issuer's annual/quarterly report settles it.
- **index-close — CROSS-CHECK ONLY.** Index/price tables can flag a
  mismatch; the exchange close settles it. Never a live or close source
  (disclaimed as not necessarily real-time).
- **universe/reference — CROSS-CHECK ONLY.** Company listings can
  corroborate coverage; the exchange register is authoritative.
- **ipo — CROSS-CHECK ONLY.** IPO/FPO tables (including its SEBON-
  pipeline reporting, e.g. its 2026-07-06 pipeline analysis) can
  corroborate pipeline/approval status; SEBON + the prospectus settle it.

## Gaps (explicit, not guesses)

1. ShareSansar company-page / price-page / data-page URL patterns —
   not fetched or verified in this pass.
2. Any ShareSansar API, feed, bulk export or rate limit — none found;
   absence not confirmed by the operator.
3. Any ShareSansar redistribution / scraping / reuse clause — none
   found in the fetched terms text (which is disclaimer + privacy
   policy only). If a separate terms page exists, it was not located.
4. Whether ShareSansar's data supplier (the "third party" in its
   disclaimer) imposes its own terms that flow through — unknown.
5. Account-gated features' terms (portfolio tracker) — not reviewed;
   irrelevant to the cross-check decisions above.

## Tension flag

**Real tension with the 2026-10-23 "fair game" ruling — resolved in
favour of this dossier's terms evidence, not the ruling.** The ruling
says freely accessible data from named portals may be taken
exhaustively for a real-time site. ShareSansar's own terms say its
data is third-party-supplied and not necessarily accurate, and grant
no republication right. "Freely accessible" does not cure
"not necessarily accurate", and it does not create a licence the
operator never granted. This dossier therefore keeps ShareSansar at
CROSS-CHECK ONLY. If the parent wants to upgrade it, that needs either
a written permission from IMS Investment Management Services or a
new, explicit user order that names ShareSansar and accepts the
accuracy/licence risk — it cannot be done by citing the general
ruling alone.
