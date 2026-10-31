# DATA_SOURCES.md — Phase B source matrix

**Status: Phase B dossiers complete (11/11), GATE B NOT satisfied.**
Research date: 2026-10-31. Dossiers live in `docs/sources/<name>.md`;
this file is the matrix over them. It **supersedes** the short source
inventory previously kept here (git history retains that version).

**Reading rule.** A dataset may be fetched as a primary source only where
this matrix says USE or USE-WITH-ACCOUNT. REQUEST ACCESS means blocked
until the access or licence is granted. CROSS-CHECK ONLY means verification
use, never bulk primary ingest. SKIP means the source is not used for that
dataset. Where a dossier records a GAP, the matrix does not fill it by
assumption — the gap is listed in §5.

## 1. Per-source decisions

Decision vocabulary: USE / USE-WITH-ACCOUNT / CROSS-CHECK ONLY /
REQUEST ACCESS / SKIP. Reasons in full are in each dossier.

| Source | Dataset → decision |
|---|---|
| NEPSE official (`docs/sources/nepse-official.md`) | index-close → REQUEST ACCESS; floorsheet → REQUEST ACCESS; broker-flow → CROSS-CHECK ONLY; daily-ohlc → REQUEST ACCESS; universe/reference → CROSS-CHECK ONLY; corporate-actions → CROSS-CHECK ONLY; news → CROSS-CHECK ONLY |
| SEBON (`docs/sources/sebon.md`) | ipo → USE; news → USE (regulatory only); corporate-actions → CROSS-CHECK ONLY; universe/reference → CROSS-CHECK ONLY; fundamentals → SKIP; index-close → SKIP |
| CDSC (`docs/sources/cdsc.md`) | ipo → CROSS-CHECK ONLY; universe/reference → CROSS-CHECK ONLY; news → CROSS-CHECK ONLY (depository news only); corporate-actions → SKIP; fundamentals → SKIP; index-close → SKIP |
| NRB (`docs/sources/nrb.md`) | fundamentals → CROSS-CHECK ONLY (BFI sector only); universe/reference → CROSS-CHECK ONLY; news → CROSS-CHECK ONLY (macro/monetary only); corporate-actions → SKIP; ipo → SKIP; index-close → SKIP |
| Issuer notices (`docs/sources/issuer-notices.md`) | corporate-actions → USE; fundamentals → USE; ipo → USE; news → USE (issuer-announced events only); universe/reference → CROSS-CHECK ONLY; index-close → SKIP |
| Capital Max (`docs/sources/capital-max.md`) | mf-nav → USE-WITH-ACCOUNT (owner's own saved login only; falls back to CROSS-CHECK ONLY if account terms prohibit republication); index-close → CROSS-CHECK ONLY; daily-ohlc → CROSS-CHECK ONLY; broker-flow → CROSS-CHECK ONLY; fundamentals → CROSS-CHECK ONLY; floorsheet → SKIP; monthly-ohlc → SKIP; corporate-actions → SKIP; news → SKIP |
| Chukul (`docs/sources/chukul.md`) | floorsheet → REQUEST ACCESS; broker-flow → CROSS-CHECK ONLY; index-close → CROSS-CHECK ONLY; daily-ohlc → CROSS-CHECK ONLY; monthly-ohlc → CROSS-CHECK ONLY; fundamentals → CROSS-CHECK ONLY; corporate-actions → SKIP; mf-nav → SKIP; news → SKIP |
| Nepalytix (`docs/sources/nepalytix.md`) | index-close → REQUEST ACCESS; floorsheet → REQUEST ACCESS; broker-flow → REQUEST ACCESS; daily-ohlc → REQUEST ACCESS; monthly-ohlc → REQUEST ACCESS; fundamentals → REQUEST ACCESS; corporate-actions → SKIP; mf-nav → SKIP; news → SKIP |
| ChartNepali (`docs/sources/chartnepali.md`) | index-close → CROSS-CHECK ONLY; daily-ohlc → CROSS-CHECK ONLY; monthly-ohlc → CROSS-CHECK ONLY; broker-flow → CROSS-CHECK ONLY; corporate-actions → CROSS-CHECK ONLY; floorsheet → SKIP; fundamentals → SKIP; mf-nav → SKIP; news → SKIP |
| ShareSansar (`docs/sources/sharesansar.md`) | corporate-actions → CROSS-CHECK ONLY; news → CROSS-CHECK ONLY; fundamentals → CROSS-CHECK ONLY; index-close → CROSS-CHECK ONLY; universe/reference → CROSS-CHECK ONLY; ipo → CROSS-CHECK ONLY |
| MeroLagani (`docs/sources/merolagani.md`) | corporate-actions → REQUEST ACCESS; news → REQUEST ACCESS; fundamentals → REQUEST ACCESS; index-close → REQUEST ACCESS; universe/reference → REQUEST ACCESS; ipo → REQUEST ACCESS (all consent-gated; automated use is SKIP until express written consent is obtained, because the site's terms ban scripts and reproduction) |

Notes on the table:
- Chukul's floorsheet-by-date endpoint pattern is recorded in its dossier
  as **brief-supplied, unverified** (host, parameters, auth, and response
  shape unconfirmed). Its REQUEST ACCESS decision stands regardless.
- ShareSansar publishes floorsheet content per its own description, but its
  dossier assigns no floorsheet decision; §2 treats ShareSansar floorsheet
  pages as human-viewable only, not an automated cross-check, until a
  decision is assigned.
- MeroLagani's REQUEST ACCESS rows are consent gates, not ordinary
  cross-checks: its terms ban scripts and reproduction without express
  written consent, so automated fetching is SKIP until consent lands.

## 2. Per-dataset primary / fallback / cross-check (GATE B)

GATE B requires every dataset to have a permitted primary + fallback +
cross-check. **GATE B is NOT satisfied.** Satisfied: corporate-actions,
fundamentals, ipo. Partial: news. Blocked or conditional: the rest.

| Dataset | Permitted primary | Fallback | Cross-check | Gate |
|---|---|---|---|---|
| index-close | NONE (blocked: NEPSE official REQUEST ACCESS via licensed MDP route or written permission; Nepalytix REQUEST ACCESS via written agreement; MeroLagani consent-gated) | NONE permitted | ShareSansar, ChartNepali, Chukul, Capital Max (all CROSS-CHECK ONLY) | BLOCKED |
| floorsheet | NONE (blocked: Chukul REQUEST ACCESS; NEPSE official REQUEST ACCESS) | NONE permitted | NONE automated (MeroLagani datewise floorsheet is consent-gated; ShareSansar floorsheet pages human-viewable only, no decision assigned) | BLOCKED |
| broker-flow | NONE (derived from floorsheet; no permitted floorsheet primary exists) | NONE permitted | ChartNepali aggregated footprint, Capital Max, NEPSE sampled vs trades (all CROSS-CHECK ONLY) | BLOCKED (follows floorsheet) |
| daily-ohlc | NONE (blocked: NEPSE official REQUEST ACCESS; Nepalytix REQUEST ACCESS) | NONE permitted | Chukul, ChartNepali, Capital Max (all CROSS-CHECK ONLY) | BLOCKED |
| monthly-ohlc | NONE (blocked: Nepalytix REQUEST ACCESS) | NONE permitted | Chukul, ChartNepali (both CROSS-CHECK ONLY) | BLOCKED |
| corporate-actions | Issuer notices (USE) | NEPSE official notices, item-by-item authoritative proof (CROSS-CHECK ONLY) | ShareSansar, SEBON (CROSS-CHECK ONLY); MeroLagani consent-gated | SATISFIED |
| news | SEBON (USE, regulatory only); issuer notices (USE, issuer events only); general market news via RSS feeds (existing mechanism — RSS feed terms NOT covered by these dossiers, GAP) | NONE for general news | NEPSE alerts, ShareSansar, CDSC (depository), NRB (macro) (all CROSS-CHECK ONLY) | PARTIAL (regulatory/issuer satisfied; general RSS terms open) |
| universe/reference | NONE (NEPSE official is per-symbol arbiter, CROSS-CHECK ONLY; no verified list endpoint or bulk licence) | NONE permitted | NEPSE official (arbiter), SEBON, CDSC (all CROSS-CHECK ONLY) | BLOCKED |
| fundamentals | Issuer notices (USE — annuals/quarterlies) | NRB BFI sector data (CROSS-CHECK ONLY) | NRB, ShareSansar, Chukul, Capital Max (CROSS-CHECK ONLY); Nepalytix REQUEST ACCESS | SATISFIED |
| mf-nav | Capital Max (USE-WITH-ACCOUNT — CONDITIONAL on the owner's saved-login exception surviving matrix governance; falls back to CROSS-CHECK ONLY if account terms prohibit republication) | NONE | NONE | CONDITIONAL |
| ipo | SEBON (USE — pipeline/approvals); issuer notices (USE — issuer IPO notices) | CDSC (CROSS-CHECK ONLY) | ShareSansar (CROSS-CHECK ONLY); MeroLagani consent-gated | SATISFIED |

## 3. Consequences (binding until the matrix changes)

- **Retention roll job live mode:** all tabled datasets remain
  `phase_b: pending`. No live roll of any dataset whose primary is BLOCKED,
  CONDITIONAL-unresolved, or PARTIAL-for-that-dataset. Flips require a
  matrix change (granted access, or an owner governance decision).
- **Real-time Worker real sources:** only the USE primaries above
  (issuer notices, SEBON regulatory/issuer-scoped) are permitted primary
  fetches. No market-data primary (index, floorsheet, daily) may be
  fetched by the Worker on these dossiers. The Worker registry stays
  empty for market data until an access request lands.
- **Existing pipelines are not re-judged here.** This matrix governs
  Phase B gating (roll live mode + Worker sources). Whether existing
  publishers' sources satisfy it is a separate governance decision
  (see §4).

## 4. Standing tension — recorded, not resolved

An owner ruling (2026-10-23) said freely accessible Capital Max and
Chukul APIs are fair-game data sources, with NEPSE official as arbiter.
Phase B matrix governance requires each dataset to have a permitted
primary source. These dossiers find direct conflicts, and this matrix
does **not** resolve them:

- **Chukul as broker-collection primary** vs its floorsheet decision
  (REQUEST ACCESS: no API documentation, no redistribution permission,
  account-gated paid product). An endpoint responding is not a permitted
  primary source.
- **Capital Max as fair game** vs no API documentation, no reuse
  permission found, and tools behind a KYC-verified login.
- **NEPSE official as arbiter** vs no documented API, no republication
  licence found, and a paid NEPSE-licensed channel (Source Code MDP)
  for exactly the real-time data a Worker would want. Freely viewable
  is not shown to equal freely reusable as a republished feed.
- **MeroLagani as viewable** vs terms that ban scripts and reproduction
  without express written consent. Freely viewable ≠ licensed for
  automated reuse.
- **ShareSansar** vs its own terms: data "not necessarily real-time or
  accurate", third-party supplied, no republication licence. The
  fair-game ruling does not cure inaccuracy and does not create a
  licence; upgrading ShareSansar needs written permission or a new
  explicit owner order naming it.

**Owner decision owed:** matrix governance vs the 2026-10-23 ruling —
which governs each dataset. Until decided, the stricter reading in §2
applies (REQUEST ACCESS blocks; CROSS-CHECK ONLY never upgrades to
primary by usage alone).

## 5. Gaps register (blocking gaps first)

1. **NEPSE official-register confirmation for NICD88/SBD87** — outstanding
   (see §6). Gates the universe addition, not the dossiers.
2. **NEPSE official: no documented API, no rate limit, no terms/licence,
   robots stance UNKNOWN** (robots.txt fetch failed twice with a network
   error, no HTTP status; not retried further). Specific official paths
   for quotes/indices/floorsheet/universe/history unverified. Frontend
   geo-block (Nepal-IP only) untested for Worker egress.
3. **Chukul floorsheet endpoint pattern unverified** (brief-supplied only);
   no terms/licence; homepage fetch failed (not retried).
4. **Capital Max account terms uninspected** (login-gated); no API
   statement found. Gates the mf-nav USE-WITH-ACCOUNT fallback condition.
5. **Nepalytix endpoint catalogue unpublished**; commercial agreement
   terms beyond Terms §§5/6/9 unknown.
6. **MeroLagani licensing contact unverified** (terms-page address looks
   like a vendor address, not a licensing contact); subdomain robots
   unverified.
7. **ChartNepali data licence not found**; written permission outstanding;
   feed paths are robots-disallowed regardless.
8. **SEBON pipeline URL/cadence, any API/feed, any reuse terms**
   unverified. **CDSC `ipolist` lead unverified; API Procedure circular
   scope unverified (garbled PDF).** **NRB robots stance UNKNOWN**
   (fetch failed, not retried); Financial Inclusion Portal endpoints
   unverified.
9. **Issuer-notices verbatim directive texts not fetched**; per-issuer
   URLs/robots/terms vary by design (per-issuer checks owed before
   polling any issuer site).
10. **ShareSansar page URL patterns and upstream supplier terms**
    unverified; floorsheet decision unassigned (see §1 note).
11. **News RSS feed terms** (Arthasansar, BizMandu, OnlineKhabar,
    MeroLagani feeds) not covered by these dossiers — separate terms
    check owed before treating RSS as a permitted primary.
12. **Exact AD maturity dates:** NICD88 unverified (BS 2088 year only);
    SBD87's 11 January 2031 date is third-party-sourced, re-verify
    before publishing as a maturity date.

## 6. Orphan pages NICD88 / SBD87 — finding + branch

Inside `docs/sources/nepse-official.md` §8. **Official-register
confirmation was NOT obtained** (no official list fetch succeeded).
Best available evidence (two independent third-party mirrors,
cross-checked):

- **NICD88 — 8.5% NIC Asia Debenture 2088**, Non-Convertible Debenture,
  NIC ASIA Bank; 8.5%, 10-year; listed 13 Sep 2021, 15,73,872 units at
  Rs 1,000 face; maturity BS 2088; shown Active, Rs 1,092, traded
  28 Oct 2026.
- **SBD87 — 8.5% Sanima Debenture 2087**, Non-Convertible Debenture,
  Sanima Bank; 8.5%, 10-year; listed 21 Feb 2021, 30,52,404 units at
  Rs 1,000 face; maturity BS 2087; shown Active, Rs 1,105, traded
  28 Oct 2026 (50 units, 1 trade). This corrects any "last traded
  5 Oct" reading: its monthly-archive absence is an updater gap, not
  delisting.

**Branch: add as typed instruments to the universe — for BOTH.**
Neither meets the "mark the page ended (keep history)" branch
(maturities are future, no redemption/delisting notice found, both
traded 28 Oct 2026). **Condition:** gate the addition on the
outstanding official-register confirmation. **No page or universe
change was implemented in this job** — implementation follows the
finding as a follow-up.

## 7. Attribution policy (carried forward)

- Every page that displays market data names its sources in the footer
  or a visible attribution line.
- The `/status/` page lists all active sources and their freshness.
- `data/manifest.json` records the source of every generated file.
- No dataset is attributed to a source for which this matrix says SKIP,
  and no CROSS-CHECK ONLY source is presented as the primary source of
  a displayed figure.
