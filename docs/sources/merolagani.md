# Source dossier — MeroLagani (Mero Lagani)

- **Source:** MeroLagani, a Nepal stock-market portal (live trading,
  floorsheet, indices, company announcements and reports, market
  analysis, portfolio tracker)
- **Site:** https://merolagani.com (also https://eng.merolagani.com
  and https://aichart.merolagani.com)
- **Researched:** 2026-10-31, read-only (browser text search/fetch only; no login, no form, no email)
- **Status:** DRAFT — gates a retention-roll `phase_b` flip and any Cloudflare Worker fetch.

## What it publishes

Verified via search results (site pages indexed and summarised, not
all opened individually):

- **Live trading board (homepage):** e.g. for 2026-10-30 — Total
  Turnover 8,891,595,145.90; Total Traded Shares 22,862,554; Total
  Transactions 74,054; Total Scrips Traded 348; Total Market
  Capitalization 4,630,727,163,404.2 — with per-symbol LTP, % change,
  high/low/open/quantity.
- **Datewise floorsheet:** https://merolagani.com/Floorsheet.aspx —
  e.g. 2026-10-30, 74,054 records over 149 pages (500/page), with
  transaction no., symbol, buyer/seller broker codes, quantity, rate,
  amount; broker floorsheets at
  https://aichart.merolagani.com/BrokerFloorsheet.aspx?code=NN.
- **Company announcements:** AnnouncementDetail.aspx pages carrying
  symbol, fiscal year, announcement detail, announcement date,
  book-close date, % cash dividend, % bonus share and right-share
  ratio — including "adjusted base price" notices (e.g. AHPC: price
  adjusted to Rs 260.86 for 5% bonus on a Rs 273.90 close; NLICL:
  Rs 581.73 for 4% bonus on Rs 605.00) and listing notices (e.g. SGHL:
  2,85,00,000 IPO units listed, open price range Rs 100–300).
- **News, indices, IPO table:** homepage IPO table (e.g. HPHL,
  1,690,000 ordinary units, 2026/10/28–2026/11/11, Citizens Capital,
  "Coming Soon") and market news items.
- **Paid product:** "MeroLagani Data Analytics" — a subscription
  web platform (6 months / 1 year; 1 year Rs 4,000, per its marketing
  page) claiming 5 years' financial history for all listed companies,
  digitised quarter reports, a stock screener, intrinsic-value and
  profit-estimate tools, a floorsheet engine and live charts. That is
  a paid product description, not a verified dataset, and its terms
  are the same Terms of Use below.

## (a) Endpoints / publication channel

- **Homepage (verified via search result):** https://eng.merolagani.com/
  — live trading, indices, news, IPO table.
- **Datewise floorsheet (verified via search result):**
  https://merolagani.com/Floorsheet.aspx
- **Broker floorsheet (verified via search result):**
  https://aichart.merolagani.com/BrokerFloorsheet.aspx?code=NN
  (e.g. code=43, 68, 74, 8, 33, 4 in indexed results).
- **Company announcements (verified via search results):**
  https://merolagani.com/AnnouncementDetail.aspx?id=NNNNN
  (e.g. id=66288 SGHL, id=63572 AHPC, id=63549 NLICL) and the
  aichart.merolagani.com mirror of the same pages.
- **Terms page (verified by direct fetch 2026-10-31):**
  https://aichart.merolagani.com/Disclaimer.aspx — "Disclaimer,
  Privacy & Terms of Use". This is the primary evidence for (b)/(f).
- **API / feed: NONE FOUND.** No public API, data feed or bulk export
  was found on the terms page or in search. MeroLagani's charting
  feed is referenced by third parties (e.g. a Nepalytix article says
  it matched rights issues to "daily prices from merolagani's charting
  feed"), but no documented public API endpoint was located, and an
  undocumented charting feed must not be treated as a documented API.

## (b) Rate limit, or terms-of-use clause

- **No published numeric rate limit found.**
- **Applicable terms clause (governing, quoted from the fetched Terms
  of Use — this clause is stricter than any rate limit):**
  > "You will not employ or allow the use of your account for the
  > purpose of executing scripts, programs, or other technologies
  > designed or intended to create copies or otherwise reproduce the
  > content on the Site."
  (Terms of Use, "Personal Use of the Service" section, fetched
  2026-10-31.) A Worker that fetches MeroLagani pages by script to
  copy their content into Nepse Decode's database is exactly what
  this clause forbids. No polling rate can cure a script ban.

## (c) robots.txt

- **Fetched 2026-10-31:** https://merolagani.com/robots.txt
- **Result:** the fetch returned a "Page not found" page — i.e. **no
  robots.txt at that host/path**. (Not a permissive robots file, and
  not a disallow: it is absent.)
- **GAP:** robots.txt on the aichart.merolagani.com and
  eng.merolagani.com subdomains was not fetched in this pass.
  Absence on the main host does not authorise anything: the Terms of
  Use script ban (above) governs regardless of robots.txt.

## (d) Auth model

- **Public browsing** for the homepage, floorsheet, broker floorsheet,
  announcements and news pages indexed above.
- **Account / paid subscription** for portfolio features and the
  Data Analytics product (Login.aspx / Sign Up; subscription activated
  via the MeroLagani office after payment, per its marketing page).
  No account tier was verified to grant a data-reuse right, and the
  Terms of Use licence below is personal/noncommercial in any case —
  a paid subscription must not be assumed to be a republication licence.

## (e) Cadence

- **Live / intraday for the trading board** (homepage totals match
  the 2026-10-30 session), **daily for floorsheets** (datewise pages
  stamped e.g. "As of 2026/10/30 03:00:00"), and **as-published for
  announcements and news**. No refresh interval or update schedule is
  stated in the fetched terms; the timestamps above are observed page
  stamps, not a promised cadence.
- **Cadence is moot for automated use** given the script ban: however
  fresh the data is, a Worker may not copy it under the current terms.

## (f) Licence / redistribution terms

Quoted or closely paraphrased from the Terms of Use fetched
2026-10-31 (https://aichart.merolagani.com/Disclaimer.aspx):

- **Disclaimer:** "We rely on financial data, including stock prices,
  provided by 3rd parties. The data is believed to be accurate, but is
  not guaranteed or warranted by Mero Lagani." The site is
  "intended only as an informational tool" and "should not in any way
  be construed as investment advice". Service is provided "AS IS"
  without warranties of accuracy, omissions, completeness or delays.
- **Licence granted:** "a limited, personal, non-exclusive,
  non-transferable license to use the Service for personal,
  noncommercial purposes" only; MeroLagani "retain[s] all right, title,
  and interest in and to the Website, including all related
  intellectual property rights".
- **Prohibited reproduction:** users will not "reproduce, modify,
  translate, enhance, decompile, disassemble, reverse engineer, or
  create derivative works of the Website", and (see (b)) will not use
  scripts/programs/technologies "designed or intended to create copies
  or otherwise reproduce the content on the Site". "Any other use
  violates the terms and conditions of this Agreement and is strictly
  prohibited."
- **Copyright notice:** "Except as otherwise noted on this Website,
  the contents of this Website are copyrighted © 2014 by mero lagani.
  All rights are reserved. No part of the information on this Website,
  including text, graphics and html code, may be reproduced or
  transmitted in any form by any means, without the express written
  consent of mero lagani."
- **Governing law:** "governed by and construed under the legal act
  of Nepal".

## Per-dataset decisions — expectation CHALLENGED, not confirmed

The prior expectation was CROSS-CHECK ONLY for MeroLagani. **That
expectation is confirmed as "never primary", but challenged as still
too permissive for automated use.** A Worker performing cross-checks
by fetching MeroLagani pages would breach the express script ban and
the reproduction ban, even if its figures were never published. The
only cross-check use consistent with these terms is a **human**
spot-check (a person reading a page and comparing it with a primary
source) — which is not a Worker source and not a retention-roll input.
For every dataset below, therefore, the machine decision is
REQUEST ACCESS (express written consent from MeroLagani), with manual
human cross-checking as the interim, non-automated practice. If
consent is refused or never sought, the decision falls to SKIP for
automated purposes — it does not fall back to silent fetching.

- **corporate-actions — REQUEST ACCESS.** Announcement pages are
  rich (ratios, book-close, adjusted prices) but are third-party-
  supplied, not guaranteed, and script-copying them is banned. The
  issuer notice / NEPSE filing settles every action; MeroLagani may
  only corroborate it after written consent, or by human reading.
- **news — REQUEST ACCESS.** Same reasoning; portal news is a lead
  only, and automated ingestion is banned without consent.
- **fundamentals — REQUEST ACCESS.** The Data Analytics 5-year
  history is a paid, personal-use product; its figures are
  third-party-supplied and not warranted. No automated fundamentals
  ingestion without written consent.
- **index-close — REQUEST ACCESS.** Live/close tables are
  third-party data, not warranted, and script-copying is banned.
  Never a close source without consent.
- **universe/reference — REQUEST ACCESS.** Symbol/company coverage
  can corroborate a universe only after consent; the exchange
  register is authoritative in the meantime.
- **ipo — REQUEST ACCESS.** IPO tables and listing notices can
  corroborate pipeline/issue status only after consent; SEBON +
  prospectus settle it.

## Gaps (explicit, not guesses)

1. Any MeroLagani public API or documented feed — none found; the
   third-party reference to a "charting feed" is not a documented
   endpoint and was not verified.
2. robots.txt on aichart.merolagani.com and eng.merolagani.com —
   not fetched.
3. Whether a paid Data Analytics subscription grants any reuse right
   beyond personal/noncommercial use — the fetched terms say the
   licence is personal/noncommercial; no subscription-specific reuse
   term was located.
4. The operator's contact for a written-consent request — the terms
   page names support@asteriskt.com for account-security notices
   (an address that looks like a vendor/operator address, not a
   licensing contact); a correct licensing contact was not verified
   and no email was sent in this read-only research. The access-
   request email for this source must confirm the right recipient
   before it is drafted, let alone sent.
5. Company-page (profile) URL pattern on merolagani.com — not
   verified in this pass; announcements/floorsheet patterns above
   are the verified ones.

## Tension flag

**Direct tension with the 2026-10-23 "fair game" ruling — resolved
in favour of the operator's own terms, not the ruling.** The ruling
treats freely accessible APIs/data as fair game for a real-time site.
MeroLagani's data is freely viewable but expressly NOT freely
copyable: personal/noncommercial licence only, scripted copying
banned, reproduction without express written consent prohibited.
"Accessible in a browser" is not "licensed for automated reuse".
Upgrading any MeroLagani dataset to USE or to automated
CROSS-CHECK ONLY would require either (a) express written consent
from MeroLagani (the REQUEST ACCESS path in the decisions above), or
(b) a new, explicit user order that names MeroLagani, acknowledges
this clause, and accepts the terms risk. Neither exists at the time
of writing, so no Worker may fetch MeroLagani.
