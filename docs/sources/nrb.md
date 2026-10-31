# Source dossier — NRB (Nepal Rastra Bank)

- **Source:** Nepal Rastra Bank (NRB), Nepal's central bank
- **Site:** https://www.nrb.org.np (also served as http://www.nrb.org.np)
- **Researched:** 2026-10-31, read-only (browser text search/fetch only; no login, no form, no email)
- **Status:** DRAFT — gates a retention-roll `phase_b` flip and any Cloudflare Worker fetch.

## What it publishes

NRB publishes macroeconomic and banking-sector statistics and research
as downloadable reports (PDF and, for some series, XLSX), not as a
market-data feed. It publishes no NEPSE prices, no index closes and no
per-listed-company market data. Its value to Nepse Decode is macro and
banking-sector context for fundamentals cross-checks — nothing more.

## (a) Endpoints / publication channel

- **Economic Research Department (RED) archive (verified by direct
  fetch 2026-10-31):** http://www.nrb.org.np/red/ — archive entries
  dated 2026-10-29 and 2026-10-30 at fetch time, including
  "Macroeconomic Indicators of Nepal – Mid July, 2025-26 (xlsx / pdf)"
  (posted 2026-10-16, 507.39 kb / 1.39 mb). The fetch exposed titles
  only for most entries (the archive listing is terse), so individual
  report titles/URLs beyond the macroeconomic-indicators item are not
  enumerated here.
- **Current Macroeconomic and Financial Situation (verified via search
  result):** NRB Research Department report series, e.g.
  https://www.nrb.org.np/red/current-macroeconomic-and-financial-situation-english-based-on-three-months-data-of-2018-19/
  (older edition shown by search; the series continues — the RED archive
  is the current index, not any single edition URL).
- **Banking & Financial Statistics, Monthly (verified via search
  result):** https://www.nrb.org.np/contents/uploads/2025/05/Chaitra_2081_Publish.pdf
  — contents include Major Financial Indicators; Statements of Assets
  & Liabilities and Profit & Loss for Banks & Financial Institutions;
  sector/product/security-wise credit; commercial-bank, development-bank,
  finance-company and microfinance breakdowns; district-wise branch
  lists; and the Interest Rate Structure of Commercial Banks. Based on
  provisional reports submitted by licensed BFIs (per the report's own
  explanatory notes).
- **Monthly Payment Systems Indicators (verified via search results):**
  PDF series under /contents/uploads/, e.g. the Baisakh 2083 (mid-May
  2026) edition — access/usage counts for payment system operators,
  providers, mobile/internet banking and connectIPS users.
- **Nepal Financial Inclusion Portal (secondary description, not
  verified by direct fetch):** emap.nrb.org.np, launched by NRB with
  UNCDF support; per a Khalti blog description it provides financial-
  inclusion indicators and allows data export in Excel and PDF. Treat
  as a lead, not a verified endpoint.
- **Statistics portal / API: NO API FOUND.** No public NRB data API,
  statistics-portal API or machine-readable bulk feed was found in
  search or on the RED archive. (The NRB mobile app's "Support to API
  35" in its Play Store listing is an Android API level, not a data API
  — do not mistake it for one.) The working assumption is PDF/XLSX
  report downloads only.
- **BFI reporting portal (NOT a public source):** NRB supervision
  reports state licensed BFIs report online via reporting.nrb.org.np
  (daily/monthly/quarterly). That is a regulated reporting channel, not
  a public dataset, and must not be approached as a source.

## (b) Rate limit, or terms-of-use clause

- **No published rate limit found.** No rate-limit figure and no
  site-wide NRB terms-of-use page were located.
- **Applicable clause in place of a rate limit:** none found — GAP.
  Report downloads are infrequent by nature (monthly reports); a Worker
  should poll the RED archive rarely and download only new editions.

## (c) robots.txt

- **GAP — fetch failed, stance unverified, NOT retried.**
  The fetch of https://www.nrb.org.np/robots.txt on 2026-10-31 failed
  with a network error (no HTTP status returned), and that request was
  not repeated. This failure does **not** establish that robots.txt is
  absent, blocked or permissive. NRB's robots stance must be recorded
  as UNKNOWN until a fresh, successful fetch is made by a later pass.
  Do not cite NRB as "robots-allowed" or "robots-blocked" on this evidence.

## (d) Auth model

- **Public, no login** for the RED archive, macroeconomic reports,
  Banking & Financial Statistics and payment-systems indicators.
- **Gated and out of scope:** reporting.nrb.org.np (BFI regulatory
  reporting). No NRB account is needed or appropriate for Nepse Decode's
  datasets.

## (e) Cadence

- **Monthly:** Current Macroeconomic and Financial Situation;
  Banking & Financial Statistics; Monthly Payment Systems Indicators.
- **Quarterly / annual / ad hoc:** Quarterly Economic Bulletin,
  supervision reports, economic activity / study reports, working
  papers. RED archive entries at fetch time show near-daily posting of
  individual items (2026-10-29/30), but that reflects assorted
  publications, not a daily statistical series — do not promise a
  daily NRB series.
- **No real-time or intraday series.** Nothing NRB publishes here is
  suitable for a real-time Worker feed.

## (f) Licence / redistribution terms

- **No site-wide licence or redistribution terms found** for
  nrb.org.np as a website.
- **Per-report terms DO exist and are stricter than "public data".**
  Closely paraphrased from NRB supervision reports found in this
  research (e.g. Non-Bank Financial Institutions Supervision Report
  2022/23): "© Nepal Rastra Bank. All rights reserved. Users are free
  to utilise information directly obtained from the Report, but when
  reproducing or copying any materials from the Report in any form or
  by any means, it is essential to cite Nepal Rastra Bank as the
  source, and the materials must be presented accurately. If any
  information is modified by the user, this alteration must be clearly
  indicated." Other NRB reports carry the shorter form: "All rights
  reserved. No part of this paper may be reproduced or copied … without
  fully acknowledging Nepal Rastra Bank … as a source."
- **Consequence for this dossier:** cite NRB, present figures
  accurately, flag any modification. That per-report wording permits
  cited use of information; it does not grant a bulk-republication
  licence for NRB reports, and it is not a site-wide open-data licence.
  Recorded NRB figures in Nepse Decode's own database, with source
  attribution, fit the cited-use wording; republishing NRB PDFs or
  large report excerpts does not, without permission.

## Per-dataset decisions

- **fundamentals — CROSS-CHECK ONLY.** NRB's Banking & Financial
  Statistics give sector-level and BFI-class financials (assets,
  liabilities, P&L, credit, interest rates) that can corroborate
  banking-sector fundamentals. They are not per-company listed
  fundamentals and cover only licensed BFIs, so they can never be the
  primary fundamentals source.
- **universe/reference — CROSS-CHECK ONLY.** Licensed-BFI counts and
  branch lists corroborate the banking universe only; NRB is not a
  listed-company register.
- **news — CROSS-CHECK ONLY (macro/monetary news only).** Monetary
  policy, macroeconomic situation reports and payment-system releases
  are primary only for central-bank news, not market news.
- **corporate-actions — SKIP.** NRB does not disclose corporate actions.
- **ipo — SKIP.** NRB does not approve or list IPOs (that is SEBON).
- **index-close — SKIP.** NRB publishes no NEPSE index or price data.

## Gaps (explicit, not guesses)

1. NRB robots.txt stance — fetch failed (network error, 2026-10-31),
   not retried; UNKNOWN.
2. Any NRB public API, statistics-portal API or bulk feed — none
   found; absence not confirmed by NRB.
3. Any NRB site-wide terms-of-use / rate limit — none found.
4. Financial Inclusion Portal (emap.nrb.org.np) endpoints, export
   formats and current status — described only secondarily, not
   fetched here.
5. Whether the per-report "cite + present accurately" wording extends
   to the XLSX macroeconomic-indicators dataset specifically — the
   wording was verified on supervision reports, not on that dataset.
   Treat dataset reuse as cited-use only until confirmed.

## Tension flag

None against the 2026-10-23 "fair game" ruling for this source, with
one boundary: the ruling covers freely accessible data; NRB's reports
are freely accessible, but their per-report "all rights reserved +
cite" wording still governs how reproduced material is attributed.
Fact-recording with attribution is consistent with both; bulk
republication is not authorised by either.
