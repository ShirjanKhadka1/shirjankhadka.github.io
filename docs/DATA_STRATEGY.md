# DATA_STRATEGY.md — Free-first data strategy (Charter v3, P1)

**Status:** Charter v3 P1, 2026-10-31. This document states the
enforceable rules for where Nepse Decode's data may come from. The
per-dataset authority remains `docs/DATA_SOURCES.md` (Phase B matrix);
this document does not change any matrix decision. Where the two
conflict, the matrix's stricter reading applies until the owner
decides otherwise.

**Standing rules (Charter v3, carried over):** site repo only; free
tier only, nothing paid; branch protection and the 5 required checks
stay; PR flow with auto-merge; no bypass of logins, CAPTCHAs, bot
challenges, rate limits, or bans; credentials in secrets only; no
fabricated numbers; research/education framing, no advice; proof =
live bytes on production, never a run record.

## 1. Tier 1 — official / open (preferred)

Use official and openly licensed sources first, with attribution and
`as_of` on every figure.

### 1a. NEPSE public pages — only if terms and robots permit

Before ANY use of a NEPSE public page or endpoint, the following check
MUST be performed and recorded in `docs/sources/nepse-official.md`
with the date:

1. Fetch `https://nepalstock.com.np/robots.txt`. Record the HTTP
   status and the Allow/Disallow lines for the exact paths to be used.
2. Locate and read NEPSE's terms of use / data-use terms. Record the
   URL, the date read, and the relevant clauses.
3. Use is authorized ONLY if robots permits the path AND terms permit
   the use. Silence is not permission. If robots cannot be fetched,
   or terms cannot be found, use is NOT authorized until the check
   succeeds — record the failed check with the date and retry.
4. Re-check on any terms/robots change, and whenever a new dataset is
   added from this source.

Known state (2026-10-31): robots stance UNKNOWN (fetch failed twice
with a network error, no HTTP status); no documented API, rate limit,
or terms found. So today, NEPSE public pages are NOT an authorized
Tier 1 source until the check above succeeds. This matches the matrix:
index-close, floorsheet, and daily-ohlc from NEPSE official are
REQUEST ACCESS.

### 1b. SEBON, NRB, CDSC, issuer notices

- SEBON pipeline/approvals and regulatory news: USE (per matrix).
- Issuer notices (annual reports, quarterlies, IPO notices,
  corporate-action notices): corporate-actions, fundamentals, and IPO
  are USE; issuer-announced news is USE for issuer events only.
- NRB: BFI-sector fundamentals and macro/monetary news are
  CROSS-CHECK ONLY.
- CDSC: CROSS-CHECK ONLY (depository news and reference only).
- Every figure carries source attribution, the source document
  reference, and `as_of`.

### 1c. Openly licensed historical datasets (backfill)

EACH licence MUST be verified before use. Record in the source dossier:
licence name and version, licence URL, permitted uses, and attribution
requirement. Unverified licence = no use. Attribution is rendered on
the page that shows the data.

## 2. Tier 2 — owner-account (Capital Max)

- Scope: mutual-fund / NAV data and owner exports only, through the
  owner's own saved login only. Never shared, never proxied live,
  never resold as a feed.
- Within its terms: account terms are login-gated and uninspected
  (Phase B gap). Until the owner inspects them, published Capital Max
  use stays within what the owner has verified. If the terms prohibit
  republication, Capital Max drops to CROSS-CHECK ONLY for that
  dataset (matrix fallback).
- Re-login alert: on any sign-in wall or challenge, stop and alert
  the owner with a one-step re-login. NEVER bypass the challenge, and
  never sign in inside a job.
- Last-known-good + STALE badge: on any interruption, publish
  last-known-good with a visible STALE badge and its `as_of`. Never a
  silent stale number, never a fabricated fresh one.

## 3. Tier 3 — at-risk public endpoints (Chukul floorsheet)

This is the ONLY source in this class today. NO new sources of this
class without an explicit owner order naming the source and datasets.

### 3a. Adapter

`tools/collect-chukul-floorsheet.py` (PR #269) is the adapter's core
and the SINGLE call site for the floorsheet-by-date endpoint. Rules:

- Public endpoint only, User-Agent header only. No token, session,
  or key.
- Transport-only retries with backoff. Shape-asserts on every
  response (`data` list, `last_page`, per-row fields). Dedupe by
  transaction, first-wins.
- STOP LOUD (exit 2) on any 401/403/CAPTCHA/new-gate signal.
- No other script calls the endpoint directly. Every call goes
  through the adapter.

### 3b. Licence gap (stated plainly)

No terms or licence were found for chukul.com, and no permission was
obtained. The collector runs under the owner's runs=free order
(public, no-auth, no ban found) with this gap disclosed. It is NOT
decided as "licensed". Revert = delete the script + workflow.

### 3c. Kill switch

The adapter MUST refuse to run while the kill flag is set. The flag
is set automatically on any gate signal and manually by any lane on
suspicion. The workflow is dispatch-only (no schedule), so killing
means: flag set + workflow disabled. Clearing the flag requires an
explicit owner order. Fail-closed, always.

### 3d. Documented fallback (in order)

1. The existing data-branch staging `nepse-floorsheet/data`
   (agent-run, rolling last-5-sessions window) serves last-known-good
   aggregates with STALE badge + `as_of`.
2. If staging is also stale, components show UNKNOWN.
3. Broker-flow aggregates degrade to last-known-good, never to
   another source's rows relabeled as Chukul.

### 3e. Staging-consolidation decision OPEN (not decided here)

The existing staging is not registered in `data/_manifest.json`, and
its ownership and Publish path are undocumented. Whether to keep both
staging and the collector, migrate staging onto the collector, or
retire the collector once staging documents its own call is an open
owner decision. This document documents around it; it does not choose.

### 3f. Publish rule

The adapter is verify-only today: no data-branch write, no Publish
path by construction. Any future write path needs its own PR, and
this document updated with it.

## 4. Tier 4 — cross-check only (ShareSansar)

- Comparator: `tools/sharesansar-crosscheck.py` (PR #263), weekdays
  17:30 NPT, log as a workflow artifact only (never committed or
  published).
- Rule: 0 unexplained discrepancies required. Any discrepancy is
  investigated, never averaged away, never published as data.
- Never primary ingest. The licence gap stands: no republication
  licence, data disclaimed as "not necessarily real-time or
  accurate", unnamed third-party supplier. Upgrading ShareSansar needs
  written permission or a new explicit owner order naming it and
  accepting the risk.

## 5. Tier 5 — derived data we own

- Definition: aggregates computed from permitted inputs — flows,
  rankings, indicators, ratios, verdicts, signals, forward-ledger
  entries, sector boards.
- RULE: publish derived aggregates, NOT raw vendor rows. Vendor rows
  may exist in staging/cold only where permitted; they are never
  republished verbatim on a page.
- Derived figures carry their own `as_of` and method note. A derived
  figure whose inputs go stale carries the STALE badge with it.

## 6. Market-cap durable path (dataset specified, not built)

This section specifies the dataset. It does not build it, and it
states no shares figures — the dataset does not exist yet.

- Dataset (future P1 build; versioned listed-shares table). Fields:
  `symbol`; `listed_shares` (units, integer); `source_document`
  (issuer report title + date + URL or filing reference);
  `verified_by`; `verified_at`; `version`; `status`
  (`verified` | `unverified`).
- Verification process (human): each row traced to an issuer report
  (annual report, prospectus, or NEPSE filing); a second-document
  check on any large change; a version bump + changelog entry on any
  change; unverified rows are never counted.
- Computation: `total_market_cap(session) = SUM(listed_shares x
  close_price)` over VERIFIED symbols only.
- Display: the total plus a coverage line (verified count / universe
  count); symbols with unverified shares shown UNKNOWN individually.
  If zero symbols are verified, the total is UNKNOWN — never zero,
  never a partial total presented as complete.
- Do not wait for a feed: the NEPSE market-summary endpoint attempt
  (daily-page fix lane) is not the durable path. If that endpoint
  goes away, this dataset is the path. Building it is future P1 work;
  the human verification is the bottleneck, not code.

## 7. Access-request emails — CANCELLED (owner decision 2026-10-31 20:03 NPT)

The owner cancelled finalizing and sending access-request emails.
Reason: these providers charge money for API access, and Nepse Decode
is a portfolio website, so keys will not be provided.

The Phase B drafts (`~/workspace/phase-b-dossiers/emails/` — NEPSE,
Chukul, Capital Max, plus Nepalytix, MeroLagani, ChartNepali) remain
drafts, were never sent, and MUST NOT be finalized or sent under this
document. No reply tracker is built: nothing was sent, so nothing is
to track.

Consequence: P1 leans on the free tiers (Tier 1), the at-risk
adapter (Tier 3), cross-check (Tier 4), and owned derived data
(Tier 5). Reversing this cancellation requires a new explicit owner
order.

## 8. Real-time rule (Worker)

- Monday measurement (2026-11-02 session): probe the Chukul by-date
  endpoint at a bounded cadence (no faster than the existing verify
  cadence; backoff on any error; stop loud on any gate signal) and
  record whether the day's rows change during the session
  (snapshot-compare row count + turnover + last transaction id).
- Positive (rows update intraday): the Worker adapter MAY derive
  intraday broker flow + tape aggregates from it (min interval,
  circuit breaker, STALE badge, fail-closed).
- Negative: publish at close only.
- Register NO source in the Worker without a dossier AND
  owner-approved status. The Worker registry stays empty for market
  data until a positive measurement + approval. (Registry empty
  today; Phase B dossiers gate every real source.)

## 9. Governance

- `docs/DATA_SOURCES.md` remains the per-dataset authority; this
  document is the strategy rules. Conflicts go to the owner; until
  then the stricter reading applies.
- Changes to this document go through PR flow (branch, PR, 5
  required checks, auto-merge).
- Review triggers: any terms/robots change, any gate signal, any new
  source proposal.

---

Charter v3 P1 · 2026-10-31 · free tier only · no fabricated numbers.
