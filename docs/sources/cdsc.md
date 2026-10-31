# Source dossier — CDSC (CDS and Clearing Limited)

- **Source:** CDS and Clearing Limited (CDSC), the NEPSE subsidiary that
  runs Nepal's central depository and the MeroShare portal
- **Site:** https://cdsc.com.np
- **Researched:** 2026-10-31, read-only (browser text search/fetch only; no login, no form, no email)
- **Status:** DRAFT — gates a retention-roll `phase_b` flip and any Cloudflare Worker fetch.

## What it publishes — and what it does not

CDSC's homepage (fetched 2026-10-31, https://cdsc.com.np) shows three
public sections: **News & Notices**, **Press Release** and **Circulars**,
plus a Depository Participants (DPs) Networks section. That is the whole
verified public surface: depository/infrastructure notices, not market data.

**Honest core finding:** demat / beneficiary data is account-level and
is NOT public market data. A demat account holds a named investor's
holdings under a 16-digit BOID (Beneficiary Owner ID); holdings, IPO
applications and transfers are visible only to that account holder (via
their DP and MeroShare). CDSC publishes no public per-company holdings,
no prices, no floorsheet and no index. Any dossier or Worker design that
treats CDSC as a market-data source is wrong at the root.

## (a) Endpoints / publication channel

- **Homepage / public notices (verified by direct fetch 2026-10-31):**
  https://cdsc.com.np — News & Notices, Press Release, Circulars,
  DP Networks.
- **Circulars (verified as a section; one item opened):** the homepage
  lists, among others, "Circular regarding API Procedure (2080-08-20)".
  The linked PDF
  (https://cdsc.com.np/downloads_files/2023_12_14_16_23_33_Circular%20regarding%20API%20Procedure%20(2080-08-20).pdf)
  was fetched, but its text extraction is garbled (Devanagari font
  rendering in the text fetch), so its scope — which systems, which
  counterparties, which credentials — is **not verified** and must not be
  paraphrased here. What can be said: an "API Procedure" circular exists
  and is dated 2080-08-20; whether it is a public API, a DP/intermediary
  API, or something else is a GAP.
- **MeroShare portal (described by secondary guides, not verified by
  login — and login was out of scope for this research):**
  meroshare.cdsc.com.np — per multiple independent guides, an investor
  selects their DP, logs in with username/password, uses a separate
  transaction PIN, and can apply for IPOs/FPOs/rights via "My ASBA", see
  holdings and allotment results, update WACC and transfer sold shares
  (EDIS). Secondary guides also cite iporesult.cdsc.com.np for allotment
  results. None of this was verified from CDSC itself in this pass.
- **IPO list — UNVERIFIED LEAD, not a verified endpoint:** a third-party
  app description cites https://cdsc.com.np/ipolist as a source for
  IPO/news data. That URL was not fetched or confirmed in this research
  and must not be used as a Worker endpoint until it is.
- **Aggregate demat statistics — secondary reporting only:** press
  reporting citing CDSC (Peoples' Review, 2026-10-26) put demat accounts
  at 8.098 million, MeroShare registrations at 7.19 million and active
  MeroShare users at 5.12 million. Those figures were not verified on a
  CDSC statistics page in this research; CDSC's homepage fetch exposed
  no statistics/dataset page.
- **API / feed / bulk export for public market data: NONE FOUND.**
  The API Procedure circular (above) is the only API-adjacent item found,
  and its audience/scope are unverified. There is no documented public
  API, feed or bulk export for market data.

## (b) Rate limit, or terms-of-use clause

- **No published rate limit found.** No rate-limit figure and no
  site-wide terms-of-use page for cdsc.com.np were located (homepage
  fetch + targeted search returned only unrelated organisations'
  terms pages).
- **Applicable clause in place of a rate limit:** none found — GAP.
  No automated polling rate may be inferred from silence.

## (c) robots.txt

- **Fetched 2026-10-31:** https://cdsc.com.np/robots.txt
- **Content, verbatim:**
  ```
  User-agent: *
  Disallow:
  ```
  Empty `Disallow:` for all user-agents: no path restriction in
  robots.txt. This is not a licence to republish, and it says nothing
  about the login-gated MeroShare area (robots.txt does not grant
  access to account data).

## (d) Auth model

- **Public, no login** for News & Notices, Press Releases, Circulars and
  the DP network listing.
- **USE-WITH-ACCOUNT (own account only, and not a site data source):**
  MeroShare access requires a demat account via a licensed DP, a
  MeroShare username/password and a transaction PIN (per secondary
  guides). That account shows one investor's own holdings and
  applications. It must never be used as a source of market-wide data,
  and no other person's account data may be collected. For Nepse Decode's
  datasets this is effectively a non-source; it is recorded here only so
  the distinction is explicit.

## (e) Cadence

- **Event-driven.** News, notices, press releases and circulars appear
  when CDSC issues them; no publication schedule was found. Homepage
  items at fetch time included World Investor Week / Global Money Week
  2026 press releases and a 2083-07-12 notice, consistent with
  irregular, event-driven publication.
- Demat aggregate counts (if ever sourced) are point-in-time press
  figures, not a time series — no update cadence was verified.

## (f) Licence / redistribution terms

- **No CDSC licence or redistribution terms found.** No terms,
  copyright or reuse page for cdsc.com.np was located in this research.
- **Consequence:** cite CDSC notices/circulars with attribution and
  link; record facts only. Do not republish CDSC documents wholesale,
  and do not present any account-level data (even the site operator's
  own) as public market data.

## Per-dataset decisions

- **ipo — CROSS-CHECK ONLY.** CDSC/MeroShare is where IPOs are applied
  for, so its public IPO list (unverified URL — see Gap 1) and notices
  can corroborate that an issue is live, but SEBON approval + the
  issue manager's notice are primary. Account-level application data is
  not a source at all.
- **universe/reference — CROSS-CHECK ONLY.** The DP network listing
  and demat-registration status corroborate intermediary/coverage facts
  only. CDSC is not a listed-company universe register.
- **news — CROSS-CHECK ONLY (depository news only).** CDSC press
  releases/notices are primary only for depository events (e.g. demat
  rule changes, MeroShare changes); they are not a general market-news
  source.
- **corporate-actions — SKIP.** CDSC does not disclose corporate
  actions; issuers/NEPSE do. (Bonus/rights shares landing in a demat
  account is a settlement consequence, not a disclosure channel.)
- **fundamentals — SKIP.** No company financial data.
- **index-close — SKIP.** No price or index data.

## Gaps (explicit, not guesses)

1. The cdsc.com.np/ipolist URL — cited only by a third party, not
   fetched/confirmed here.
2. Scope and audience of the 2080-08-20 "API Procedure" circular —
   PDF text extraction was garbled; do not assume a public API exists.
3. Any CDSC rate limit, terms-of-use page, copyright/reuse statement —
   none found.
4. Any CDSC public statistics/dataset page for demat counts — none
   found on the homepage; press figures above are secondary.
5. MeroShare's own terms (account agreement) — login-gated and out of
   scope for this read-only pass; irrelevant to public datasets unless
   an account-based lane is ever proposed, which it should not be.

## Tension flag

None material: the 2026-10-23 "fair game" ruling concerns freely
accessible data; CDSC's market-relevant data is not freely accessible
(account-level) or not published as data at all, so there is nothing
here to claim under that ruling. The ruling must not be used to justify
collecting any other investor's demat data.
