# Source dossier — SEBON (Securities Board of Nepal)

- **Source:** Securities Board of Nepal (SEBON), the Nepal securities-market regulator
- **Site:** https://sebon.gov.np
- **Researched:** 2026-10-31, read-only (browser text search/fetch only; no login, no form, no email)
- **Status:** DRAFT — gates a retention-roll `phase_b` flip and any Cloudflare Worker fetch. No source is fetched by a Worker without a dossier; this file alone does not authorise a fetch.

## What it publishes

SEBON's homepage (fetched 2026-10-31, https://sebon.gov.np) is organised into
News, Notices, Prospectus, Press Release, Activities/Action and
Report/Consultation Paper sections, plus a "Report Submission Status" block
(e.g. "Annual Report Submission Status of Listed Companies 2081/82",
"Merchant Banking Half yearly Report Submission Status 82/83").
Prospectus items visible on the homepage fetch included, among others:
"Him Parbat Hydro Ltd. — Locals & Foreign Employment", "6% RBBL Debenture 2089",
"NIC Asia Equity Opportunity Fund", "Muktinath Mutual Fund 2" and
"Beni Hydropower Project Limited — General Public".
That is: SEBON publishes regulatory notices, directives, consultation papers,
press releases and issue prospectuses — it is a regulator's publication
channel, not a market-data feed.

## (a) Endpoints / publication channel

- **Homepage / publication hub (verified by direct fetch 2026-10-31):**
  https://sebon.gov.np — News, Notices, Prospectus, Press Release,
  Activities/Action, Report/Consultation Paper.
- **IPO pipeline / Public Issue section (described by secondary sources, exact
  SEBON path NOT verified):** secondary guides describe a "Public Issue" /
  "Pipeline" section on sebon.gov.np listing pending applications by stage
  (Preliminary Review, Reviewed & Comments Sent, Replied & Under Review).
  Corroborating counts from secondary reporting: 117 companies in the
  pipeline, 510,981,946 units, over Rs 71.42 billion
  (MeroLagani news report on SEBON's six-stage classification; NepseBajar
  report citing SEBON's FY 2083/84 figures to 2083 Kartik/Oct 27).
  The exact pipeline URL was not exposed by the homepage text fetch, so it
  is recorded here as a lead, not a verified endpoint.
- **Public-issue approvals (secondary compilation, not a SEBON page):**
  Investopaper's compilation of SEBON approvals for FY 2082/83
  (e.g. 24 IPO approvals, 7 right-share approvals, 32 mutual-fund schemes,
  1 FPO in the first 11 months) is useful corroboration, but it is not SEBON
  itself and must not be cited as a SEBON endpoint.
- **API / feed / bulk export: NONE FOUND.** No API, RSS feed or bulk
  download was found on the homepage fetch or in search for
  "sebon.gov.np API OR feed OR RSS". That is a negative search result, not
  proof of non-existence — see Gaps. The working assumption for any Worker
  design is therefore: HTML publication pages + PDF prospectuses/notices
  only, no machine-readable feed.
- **Disclosure filings by listed companies: NOT a SEBON channel.**
  Listed-company disclosures are filed with / published through NEPSE and
  the issuer (see `issuer-notices.md`). SEBON's own filings channel is its
  prospectus/notice publication above. Do not treat SEBON as the
  company-disclosure database.
- **Contact / staff channels (not data endpoints):** homepage lists
  support@sebon.gov.np, gunaso@sebon.gov.np (grievances) and a separate
  E-attendance subdomain (sebon.officehrm.com). These are not data sources.

## (b) Rate limit, or terms-of-use clause

- **No published rate limit found.** No rate-limit figure, no API terms page
  and no site-wide terms-of-use / copyright page were located on
  sebon.gov.np in this research (homepage fetch + targeted search).
- **Applicable clause in place of a rate limit:** none found — GAP.
  A Worker fetch must therefore be conservative by design (low frequency,
  event-driven polling only) and must not be justified by "no limit published".

## (c) robots.txt

- **Fetched 2026-10-31:** https://sebon.gov.np/robots.txt
- **Content, verbatim:**
  ```
  User-agent: *
  Disallow:
  ```
  An empty `Disallow:` for all user-agents: robots.txt imposes no
  path restriction. (This permits crawling; it is not a licence to
  republish — see (f).)

## (d) Auth model

- **Public, no login** for the News / Notices / Prospectus / Press Release
  material fetched. No account is needed to read the publication hub.
- Separate staff systems (E-attendance, career portal) are irrelevant to
  data and are out of scope; do not use them.

## (e) Cadence

- **Event-driven / as published.** Prospectuses, notices, directives and
  press releases appear when SEBON issues them; no publication schedule,
  update interval or "updated daily" claim was found on the site.
- **Caution from the record:** a contemporaneous third-party report
  (ShareHub, 2026-10-06) noted that a SEBON IPO approval (Him Parbat
  Hydropower) had no formal announcement on SEBON's own website at the
  time of reporting. Pipeline/approval data from SEBON must therefore be
  checked against the actual prospectus/notice document, not assumed
  complete from a summary table.

## (f) Licence / redistribution terms

- **No site-wide licence or redistribution terms found.** The homepage
  fetch exposed no terms, copyright or "reuse" page, and targeted search
  found no SEBON website terms page.
- **Consequence:** do not assert a public-domain or open-licence status.
  The safe dossier position is: cite SEBON as the source, link to the
  original notice/prospectus, and record only the facts (company, issue
  size, approval/pipeline stage, dates) in Nepse Decode's own database.
  Bulk republication of SEBON PDFs, or presenting SEBON documents as
  Nepse Decode's own content, is not authorised by anything found here.
  If bulk republication is ever wanted, that is a REQUEST ACCESS item
  (written permission), not a USE item.

## Per-dataset decisions

- **ipo — USE.** SEBON is the approving regulator and the prospectus /
  pipeline publisher. Use for IPO pipeline stage, approvals and issue
  details, always anchored to a specific SEBON notice/prospectus document.
  Reason: primary regulator source; no competing primary exists.
- **corporate-actions — CROSS-CHECK ONLY.** SEBON approves public issues
  (IPO/FPO/rights/debentures/mutual funds), which corroborates an action,
  but the action itself (dividend/bonus/book-close/AGM) is decided by the
  issuer and disclosed via NEPSE/issuer notice. SEBON alone never settles
  a corporate action.
- **news — USE (regulatory news only).** SEBON press releases, directives
  and consultation papers are primary for regulatory/market-structure
  news. Not a source for company or market-price news.
- **universe/reference — CROSS-CHECK ONLY.** Intermediary lists and
  report-submission status pages corroborate who is licensed / reporting,
  but they are not a listed-company universe register.
- **fundamentals — SKIP.** SEBON publishes no company financial
  statements or fundamentals dataset.
- **index-close — SKIP.** SEBON publishes no index or closing-price data.

## Gaps (explicit, not guesses)

1. Exact SEBON pipeline / Public Issue page URL and its update
   cadence — not exposed by the homepage text fetch; needs a live-browser
   or site-navigation check before any Worker is pointed at it.
2. Whether any SEBON API, RSS feed or bulk export exists — none found,
   but absence was not confirmed by SEBON.
3. Any SEBON rate limit, terms-of-use page, copyright/reuse statement —
   none found.
4. Whether SEBON prospectus PDFs have stable, citable URLs over time —
   homepage links were not resolved to individual document URLs in this
   read-only pass.

## Tension flag

None against the 2026-10-23 "fair game" ruling for this source: SEBON is
a public regulator publication, and this dossier's USE decisions are for
facts with attribution, not bulk republication. The licence gap above is
the binding constraint on republication, not on fact-recording.
