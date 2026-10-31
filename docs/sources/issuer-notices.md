# Source dossier — Issuer notices (company websites + NEPSE/SEBON disclosure filings)

- **Source:** The listed issuer itself — its official website, its
  notices/press releases, and the disclosure it files with / publishes
  through NEPSE (with SEBON directives setting the disclosure duties)
- **Site:** No single site. The channel is per-issuer: each company's
  official website, plus the NEPSE disclosure channel. (NEPSE itself is
  a separate dossier lane; this file covers the issuer as authenticity
  source.)
- **Researched:** 2026-10-31, read-only (browser text search/fetch only; no login, no form, no email)
- **Status:** DRAFT — gates a retention-roll `phase_b` flip and any Cloudflare Worker fetch.

## Why this dossier exists

Under the portal-manipulation law, a portal-only board-meeting story is
NOT verified by portal agreement: authenticity is the test, and proof
is the company's own notice/press release (website, official social
page) or a NEPSE/SEBON disclosure filing. This dossier is that
authenticity channel. It is not a single API to poll; it is a rule for
which document settles a fact, applied issuer by issuer.

## What the channel publishes

- **Board decisions:** cash dividend, bonus shares, rights shares, new
  share issuances, mergers/acquisitions/spin-offs, major asset
  transactions, changes in CEO/CFO/auditors/board members, major legal
  cases, 5%-or-more acquisitions.
- **Scheduled financial reports:** annual financial reports and
  quarterly financial reports (EPS, P/E, NAV per share, total assets,
  liquidity ratio, etc.).
- **Meeting/book-close machinery:** AGM/SGM notices, book-closure
  dates, record dates.
- **Issue documents:** prospectuses and offering notices (Awhan Patra)
  published by the issuer and its issue manager (merchant banker) in
  national dailies and on the issue manager's / issuer's website.
- **Substantial-shareholder sale notices:** under SEBON's Bhadra 9,
  2083 directive, a substantial shareholder intending to sell 5% or
  more must notify the company at least 15 days in advance; the company
  must arrange public disclosure through NEPSE; the notice remains
  valid for three months. (Reported via ICTFrame/ShareSansar/SEBON
  concept paper, 2026-09-24; see Gaps on the directive text itself.)

## (a) Endpoints / publication channel

- **No single endpoint, no API, no bulk export.** There is no central
  issuer-notice portal verified in this research. Each issuer publishes
  on its own website (URL varies by company) and files with NEPSE.
  A Worker design for this channel is therefore a per-issuer watch
  list, not one endpoint.
- **Disclosure duties that define the channel (secondary reporting of
  NEPSE/SEBON directives — the directive texts themselves were not
  fetched verbatim in this pass):**
  - NEPSE directive (reported 2025-09-08/12, under Regulation 22 of the
    Securities Listing Regulations, 2075 and the Listing Agreement):
    annual reports within five months of fiscal year-end; quarterly
    reports within 30 days of quarter-end; immediate disclosure of
    "sensitive information" / major corporate actions, with notice to
    NEPSE at least seven days prior to or before the trading session
    begins (bonus ratio, new-share count, cash-dividend amount), and
    the same information on the company's official website; at least
    one week's notice before book closure for general meetings;
    monthly NAV/investment reports for mutual funds within 15 days of
    month-end; same-day/before-session notice for mergers, acquisitions
    and spin-offs; prompt notice of 5%+ acquisitions; 19 categories of
    information to be disclosed without delay, including asset
    transactions of Rs 100 million or more and key-personnel changes.
  - SEBON substantial-shareholder directive (Bhadra 9, 2083): 15-day
    advance notice for 5%+ sales, disclosed via NEPSE, valid 3 months.
- **Issue-manager channel (secondary description):** merchant bankers
  (e.g. Global IME Capital, Nabil Investment, NIBL Ace Capital, Sanima
  Capital — named in a secondary IPO guide) publish prospectuses and
  date notices on their own websites. This is a corroborating channel
  for IPO documents, not a substitute for the issuer's own notice.
- **Print channel:** companies are legally bound to publish full
  offering notices in recognised national dailies (e.g. Gorkhapatra,
  Kantipur, The Himalayan Times, per a secondary IPO guide). Print is
  not machine-fetchable and is recorded here only as the legal
  publication route.

## (b) Rate limit, or terms-of-use clause

- **No aggregate rate limit exists or can be stated.** Each issuer
  website has its own terms (if any); no common rate limit, crawl
  policy or terms page covers "issuer notices" as a class.
- **Applicable clause in place of a rate limit:** none — GAP at the
  aggregate level. Per-issuer terms must be checked when an issuer is
  added to a watch list, and polling must be infrequent and
  event-driven (a notice, once published, does not change).

## (c) robots.txt

- **Not a single stance — GAP by structure.** robots.txt varies by
  issuer website and cannot be summarised for the channel as a whole.
  Rule for any future Worker: fetch and record the robots.txt of each
  issuer site before polling it, and honour per-site disallows. Do not
  carry another issuer's robots stance over to a new issuer.

## (d) Auth model

- **Public, no login, for notices and reports** as described in the
  directive reporting (publication on the company website + NEPSE
  disclosure is a public-disclosure duty).
- **GAP:** whether any individual issuer gates particular PDFs or
  reports behind a login was not checked issuer-by-issuer in this pass.
  If a gated document is encountered, it is out of scope for automated
  collection unless access is separately authorised — do not
  circumvent a login.

## (e) Cadence

- **Event-driven for decisions:** board meetings, book closures,
  mergers and personnel changes are disclosed immediately / same-day /
  before the next trading session, per the directive reporting above.
- **Scheduled for reports:** annual within 5 months of year-end;
  quarterly within 30 days of quarter-end; mutual-fund NAV monthly
  within 15 days of month-end.
- **Practical consequence:** this channel has no "refresh interval".
  A watch job should check for new notices on a slow, regular cadence
  and treat a new notice as an event, not as a tick.

## (f) Licence / redistribution terms

- **No blanket licence exists.** Each issuer's documents are that
  issuer's copyrighted publications; no common redistribution licence
  was found or can be asserted for the channel.
- **Dossier position (recommendation, not a quoted term):** record the
  facts of the notice (decision, ratio, dates, amounts) with a citation
  and link to the original notice/filing. Do not republish notice PDFs
  wholesale, and do not present an issuer's notice as Nepse Decode's
  own content. Where a notice document itself is the evidence (e.g. a
  disputed dividend rate), link to it rather than copying it.
- **GAP:** no per-issuer terms page was reviewed in this pass; the
  position above is a conservative default, not a verified term.

## Per-dataset decisions

- **corporate-actions — USE.** The issuer's own notice / NEPSE filing
  is the authenticity source for dividends, bonuses, rights, book
  closures, AGMs and mergers. This is the dataset this channel exists
  for. A corporate action is not "recorded" until this channel (or a
  NEPSE filing of it) confirms it.
- **fundamentals — USE.** Annual and quarterly reports published by
  the issuer are the primary fundamentals source (audited annuals
  within 5 months; quarterlies within 30 days). Figures must come from
  the report document, not from a portal's summary of it.
- **ipo — USE.** The issuer's prospectus and offering notice (Awhan
  Patra), via the issuer / issue manager, are primary for IPO terms
  and dates, alongside SEBON approval (see `sebon.md`).
- **news — USE (issuer-announced events only).** Issuer notices and
  press releases are primary for news that is the issuer's own
  announcement. They are not a source for market-wide or other
  companies' news.
- **universe/reference — CROSS-CHECK ONLY.** An issuer's own site
  confirms its own name, sector and contact facts, but it is not an
  authoritative universe register; listing status must come from the
  exchange register.
- **index-close — SKIP.** Issuers publish no index or closing-price data.

## Gaps (explicit, not guesses)

1. Verbatim texts of the NEPSE disclosure directive (Regulation 22 /
   Listing Agreement, Sept 2025) and the SEBON Bhadra 9, 2083
   substantial-shareholder directive — duties above are from
   secondary reporting (ICTFrame, CEO Tab, ShareSansar, BankingNews),
   not from fetched directive documents.
2. Per-issuer website URLs, robots stances, terms pages and login
   gates — not surveyed; each issuer needs its own mini-check before
   being added to a watch list.
3. Whether NEPSE offers a single public disclosure listing page/API
   that aggregates these filings — that belongs to the NEPSE dossier
   lane, not this one, and was not verified here.
4. No per-issuer redistribution term was verified; the conservative
   facts-only position above is a recommendation, not a quoted licence.

## Tension flag

None: this channel is the authenticity standard itself, so it does not
conflict with the "fair game" ruling — the ruling governs taking freely
accessible data, while this dossier governs which document proves a
fact. Both point the same way: use the issuer's own public notice, with
attribution, and do not launder a portal copy into a primary source.
