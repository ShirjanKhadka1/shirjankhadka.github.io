# Program status — Nepse Decode publishing rebuild (P0–P8)

Last updated: 2026-11-01 (Sunday, market closed). Main tip at last
verification: `d43a9f9b` (#290 baseline-refresh merge) — re-read before acting.
Data branch head at last verification: `8e9ef20f` (advanced by data-branch
writers after the Publish snapshot; see Nov-1 update below). Tags through
`data-2026-11-01-1` on `debee81d` (first Nov-1 tag; the tag job names by RUN
date NPT, so no `data-2026-10-31-11` was ever due).

## Update — Oct-31 evening → Nov-1: Charter v3, P0 green, design complete

Charter v3 (owner order Sat Oct-31 19:50) governs from here: this repo
only; free tier only, nothing paid; branch protection + required
checks stay; PR flow with auto-merge; no bypass of logins/CAPTCHAs/
bot challenges/rate limits/bans; credentials in secrets only; no
fabricated numbers; research framing, no advice. Proof = live bytes
on production, never a run record. This file updates after every
item (Charter Rule 4 resolution stands: render-per-run +
PR-on-merge).

Access emails CANCELLED (owner, Oct-31 20:03): providers charge for
API access and a portfolio site will not get keys — no final email
files created, nothing sent, Phase B drafts remain drafts. P1 leans
on free tiers + adapter + cross-check + derived data.

P0 — the 9-run Publish failure is SOLVED and Publish is GREEN.
Every failure was at "Verify production bytes" on exactly one field,
`nepse-actions/index.html` (component `content`). #272 settle-wait
and #278 (cache-busting `?verify=` token + no-cache headers +
purge-all-variants) did NOT fix it — the never-seen token STILL
returned the wrong hash, refuting the poisoned-cache /
propagation-delay theory. #283 instrumentation captured the
runner's live bytes (artifact `publish-verify-report-41231693412`)
and proved ee56: first 39,179 bytes byte-identical; the ONLY
difference = one extra line before `</body>`, a Cloudflare Web
Analytics beacon script (367 bytes). ee56 was never a stale page —
it is the current page + edge-injected analytics, which is why it
failed every time (actions is the sole verified HTML path; JSON
never gets beacon injection). #288 (merged `c81dfdec`) makes the
verifier beacon-tolerant for .html/.htm only (host/path match,
never rotating token; symmetric strip; raw hashes kept as
evidence; JSON byte-exact; analytics NOT disabled). Fixtures 8/8.
Single dispatch run 41234496960 (head `c81dfdec`, data `debee81d`)
= SUCCESS — the FIRST GREEN PUBLISH (publish: success, tag:
success); runner log: 'beacon-tolerant ok for
nepse-actions/index.html (stripped live=1 artifact=0; all other
bytes identical)'; settle converged 5.4s (was 306s unconverged).
Tag `data-2026-11-01-1` → `debee81d` (NOT -11: the tag job names by
RUN date NPT; the Nov-1 run is the first Nov-1 tag). #289
(merged `53e99c35`) then pinned every publish.yml action to its
commit SHA (checkout 11d5960a, download-artifact d3f86a10,
upload-artifact ea165f8d, deploy-pages d6db9016; zero @v refs
remain); no Publish dispatched from #289 — the next Publish proves
the pinned workflow.

Design-consistency program COMPLETE (Hallmark method, identity
kept: light `#F6F7F9`, dark `#0A0C10`, lime accent, Spectral +
Inter + IBM Plex Mono, 48px controls, 3D rim-lit cards,
pagination, sector blocks showing that sector's stocks). Merged:
#267 tokens-glow, #275 table-system, #280 card-glow-text, #281
stock-sweep, #284 family-tables, #285 utility-chrome, #287
verification fixes, #290 baseline refresh (exactly 16 PNGs from
the pinned Playwright container, reviewed as pictures). Visual
regression GREEN on main (check 'Visual regression (Playwright
container)' = success on `d43a9f9b`) and now REQUIRED: branch
protection flipped 2026-11-01 02:39 (6 required contexts, strict +
enforce_admins unchanged). NOT YET LIVE: main tip `d43a9f9b`
awaits deploy — the last green Publish deployed `c81dfdec`
(live cinema still PR5 pin `059962c7`; new pin `26c53113`). The
deploy is the morning decision, not an overnight unilateral
dispatch. Residuals (not silently fixed): accdist bar-label
truncation at 1440 (electable polish, no data loss); daily
turnover wrap at 1440 dark (daily lane); utility h1 Inter
(utility-prose migration); actions-page generator `stamp()`
reverts sweeps on regeneration (actions pipeline owner).

Daily page: #261 overflow fix, #268 390px fix, #273 CHG fix (pin
`7d942c13`, live), #274 market cap (NEPSE official Oct-30 total
Rs 4,630,727,163,404.20; renderer omits the card when no total
exists), #282 JS pin bump (`5883a188`, live; JS at the new pin
contains `market_cap_total` ×1). Rendered-picture checks still
owed (CHG card 1920/1280/390 light+dark; 390px × 3 sort URLs;
market-cap card-OMITTED, not 'Unavailable', until Monday's first
intraday snapshot, then the Nov-2 total).

Brokers: #270 fixed the stale-stamp verifier failure (baker
re-stamps from shipped bytes); PROOF OWED at brokers-daily Sun
Nov-1 18:20 (expect stamp → `c7c8d184`, PASS 35 / WARN 1 / FAIL 0).
CSP: #276 removed inline handlers (pin `ea2b2579`, 7 HTML files);
flip GATED on live re-verify + one clean Report-Only cycle, then
rename with the 30 script hashes + 'unsafe-inline' in style-src
only. Strategy: #277 `docs/DATA_STRATEGY.md` live via green
deploys. security.txt: #279 fixed the dot-path tar exclusion;
live 200. Rollover: #286 merged, live manifest v106 (today
2026-11-01, session 2026-10-30, CLOSED); #235 closed as
superseded. Sources: #263 comparator + #269 Chukul collector
merged (Oct-30 sample 0 discrepancies; collector verify-only);
#256 dossiers merged (GATE B NOT satisfied); #257 wrap archive
merged (17 entries); #259 content migration merged, run
41193596480 success (announcements 124); #249 news proof landed
(run 41187307563 success, 500 items).

P2: retention dry run on main DONE — run 41241250254 (head
`d43a9f9b`, default inputs, job `roll` success). NO live roll, no
HOT data moved. Next: nightly cron ONLY for Phase-B-allowed
datasets (owned/derived first).

LIVE STATE (verified 2026-11-01, this node): manifest v106,
today 2026-11-01, session 2026-10-30; daily pins CSS `7d942c13` +
JS `5883a188`; JS at new pin contains `market_cap_total` ×1;
live `nepse-actions/index.html` sha `88af99a6d50b` = artifact
hash; security.txt 200.

OWED, stated plainly: main tip `d43a9f9b` NOT live (see deploy
decision above); this file's own live render rides the next
Publish; rendered checks above; brokers-daily 18:20 proof;
Monday Nov-2 acceptance (Worker /health transitions ~05:00 +
~05:15 UTC, ShareSansar 17:30 with 0 unexplained discrepancies,
Nov-2 finals on every board, perf collector first real written
commit 11:00, report at close); PROGRAM-STATUS contents send after
the weekend migration lands and again after Monday's close (not
before).

## LIVE PROOF — first P2 deploy (2026-10-31)

Publish run 41149221033 (push, branch=data, snapshot `2f64a2ed`):
assemble ✓, artifact verify ✓, proof artifact ✓, Pages artifact
✓, **Deploy to GitHub Pages ✓**, purge ✗ (B3 secrets absent —
the run's only failure; live-verify + tag job skipped because of
it). Sandbox interim purge done (44 URLs, 2 batches ≤30,
stable-verified 3 consecutive identical fetches each). Live bytes
then verified: `data/publish-manifest.json` on production carries
snapshot `2f64a2ed`, main `d6669de9`, all 14 components with the
data-branch asof values; **all 42 component files byte-identical
to the data branch (42/42, 0 mismatches)**. Tag
`data-2026-10-31-1` created on `2f64a2ed` manually (the workflow's
tag job was skipped by the purge failure; future tags come from
the workflow once B3 lands). NOTE: this tag marks the P2 deploy
snapshot; it does NOT resolve the Oct-30 REVIEW flag (daily 347
vs floorsheet 348) or the missed-day-catchup baseline gap — those
stay parent-owned. B5 is MOOT: deploy-pages without the job-level
environment does NOT hit the github-pages branch rule (step 14
succeeded from branch `data`), so no owner action is needed for
deploys. First FULLY GREEN workflow run: DONE (run 41159785960,
see third proof section below).

## LIVE PROOF — second P2 deploy, performance-snapshot (2026-10-31)

Publish run 41150937610 (push, branch=data, snapshot `6b167615`,
triggered by the performance-snapshot migration): same signature
as the first — every step green through Deploy to GitHub Pages,
purge ✗ (B3, same cause), live-verify + tag skipped. Sandbox
interim purge done (45 URLs: 43 component files +
`data/publish-manifest.json` + `status/program-status.html`, 2
batches 30+15, both `LIVE-VERIFIED-STABLE`, exit 0). Live bytes
then verified: `data/publish-manifest.json` on production carries
snapshot `6b167615`, main `d6669de9`, all 15 components
(performance-snapshot asof 2026-10-30); **all 43 component files
byte-identical to the data branch (43/43, 0 mismatches)**. Tag
`data-2026-10-31-2` created on `6b167615` manually (workflow tag
skipped by the purge failure, as before). Performance-snapshot is
therefore LIVE at its Oct-30 23:41 content (346 symbols),
replacing main's stale Oct-29 23:41 version.

## LIVE PROOF — third P2 deploy, fully green (2026-10-31)

Publish run 41159785960 (push, branch=data, snapshot `37cacfe6`,
triggered by the market-regime Oct-30 refresh): EVERY step green,
including **Purge changed URLs ✓**, **Verify production bytes ✓**,
and the tag job ✓. Tag `data-2026-10-31-3` created on `37cacfe6`
BY THE WORKFLOW (first workflow tag, not manual). This closes B3:
the purge step ran against the owner-added secrets with no
Cloudflare rejection, and the user's UI rerun of 41150937610 is NO
LONGER NEEDED (a fresh push proved the path instead). Deployed
main `1d190674` (incl. #242 broker-hub bake) + data `37cacfe6`
(market-regime Oct-30 refresh: NEPSE 2690.15 BEAR, Banking BULL,
calls ledger Oct-30 entry). Live-verified after: broker hub header
2026-10-30 · 68 days, Naasa 62.4/67.9/−5.5 Cr == daily file;
market-regime.json asof 2026-10-30 (NEPSE 2690.15, 37 days in
regime, breadth 58.36%, n=269). Later workflow tags on the same
green path: `data-2026-10-31-4` on `40b30342` (sector boards with
the Trading bucket + Bikas family moved), `data-2026-10-31-5` on
`2f110da8` (regime consistency rebuild, Others n=5), and
`data-2026-10-31-6`, also on `2f110da8` (a later Publish re-tagged
the same snapshot).

Legend: **LIVE** = verified on `shirjankhadka.com.np` bytes.
**ARTIFACT** = proven on the data branch / workflow artifact; live
proof pending the Pages flip (blocker B2). **NOT LIVE** = not on
production in any form. Nothing in this file is claimed live without
bytes.

## Owner-UI blockers (need the owner's hand; API writes 403)

| # | Setting needed | Why | Status |
|---|---|---|---|
| B1 | Repo Settings → General → Pull Requests → **Allow auto-merge** | Code PRs merge themselves once green; until then, PUT merge only, never hand-polling | FLIPPED by owner in UI (verified via API: `allow_auto_merge=true`) |
| B2 | Repo Settings → Pages → Build and deployment → Source → **GitHub Actions** | The P2 publish workflow deploys nothing servable while Pages serves from the branch; pre-flip runs prove the artifact only | FLIPPED by owner in UI (verified via API: `build_type=workflow`). Live site still serves the last branch deployment (homepage 200, live.json asof 2026-10-30T15:00 — no outage from the flip) until the first Actions deploy succeeds |
| B3 | Repo Settings → Secrets → **CLOUDFLARE_API_TOKEN** + **CLOUDFLARE_ZONE_ID** | Post-flip purge step in the publish workflow; absent secrets fail the job loudly (never silently stale) | CLOSED 2026-10-31: owner added both secrets in UI (~06:33–06:34 NPT); proven by Publish run 41159785960 (purge step success, no Cloudflare rejection) + workflow tag `data-2026-10-31-3`. UI rerun of 41150937610 no longer needed |
| B4 | Token scope: **Actions read+write** for this repo (token previously 403d workflow_dispatch) | `workflow_dispatch` is the writer's primary publish trigger | CLOSED 2026-11-01: token now dispatches workflows — proven by Publish dispatch 41234496960 (success) and retention dispatch 41241250254 (success). Token Repo_Auto carries Contents R/W, Pull requests R/W, Workflows R/W, Metadata RO + Administration R/W (Administration granted by owner in UI 2026-10-31 19:56, verified via protection GET 200) |
| B5 | Repo Settings → Environments → **github-pages** → Deployment branches → add **`data`** | Post-flip deploys from data pushes hit the environment's main-only branch rule (proven: run 41147393968 rejected in 2s, no steps, no runner). Without B5, data-push runs prove the artifact but fail at deploy; main-branch (UI dispatch) runs deploy fine | MOOT — deploy-pages without the job-level environment does NOT hit the branch rule (run 41149221033 step 14 succeeded from branch `data`). No owner action needed. (The job-level environment block was the trigger; #239 removed it.) |

## Program P0–P8

| Item | Status | Evidence |
|---|---|---|
| P0 — deploy-failure classification + gh_client | DONE | Client merged as #212 (`a79b0620`); 16 publishers classified (`fixprog-p0/FAILURE-TABLE.md`) |
| P1a — dynamic universe gate + manifest advance | DONE | #223 (`95c47245`): manifest v105, session 2026-10-30, universe 426 |
| P1b — direct-push publishers get a working path under protection | LIVE (fully-green deploys from 2026-10-31) | 16/16 components on the data branch (table below, incl. market-regime refresh `37cacfe6`); first fully-green run 41159785960 (deploy + purge + live-verify + workflow tag `data-2026-10-31-3`); data head `2f110da8`, tags through `data-2026-10-31-6` (on `2f110da8`) |
| P2 — ONE publish workflow (main + data → Pages artifact, no PR per data run) | LIVE (first fully-green run 2026-10-31) | #238 merged via PUT (200; `b717e48e`, parent `e96fb92d`); #239 environment-block fix merged via PUT (200; `d6669de9`). Fully-green run 41159785960: snapshot `37cacfe6`, purge ✓, live-verify ✓, workflow tag `data-2026-10-31-3`. B3 closed; UI rerun moot |
| P3 — per-component as_of, quarantine-only gates | NOT STARTED (next now that P2 is proven fully green) | Data-branch `data/_manifest.json` already carries per-component asof (the P3 data shape); gates still global-session |
| P4 — fresh checkout per run, no shared worktree | PARTIAL | Migration was read-only on worktrees; builder worktree hygiene still a per-job follow-up |
| P5 — hashed asset URLs inside the build; post-hoc stamp verifier removed as blocker | NOT STARTED | Stale-token items still open (nd-tokens, nepse-index/compare/floorsheet, brokers.js pins) |
| P6 — vendor login (Capital Max MF): terms-checked re-auth or last-known-good + STALE badge | NOT STARTED | MF snapshot blocked on sign-in wall (2026-10-30 18:45, 2nd consecutive); do-not-re-ask rule stands |
| P7 — ONE events table (actions page + ledger + stock pages + sitemap) | NOT STARTED | Ledger-vs-page gap known (ledger builder doesn't know `outcome=not_distributed`); page is source of truth until P7 |
| P8 — auto-recovery or loud alert per failure class; watchdog; /status rates | PARTIAL | This file is the /status half; standing live gate built + scheduled (30-min cron; 2026-10-31 08:48 run GATE OK, 28 pass, 0 fail, 2 by-design skips); watchdog + alert dedup for other jobs still open |

### P0–P8 deltas — Nov-1 (appended 2026-11-01; table above kept intact)

- P2: Publish fully green on the new path (run 41234496960, head
  `c81dfdec`, tag `data-2026-11-01-1`); the ee56 verifier failure
  class is closed by #288 (beacon tolerance, analytics kept).
- P5: hashed asset URLs STILL NOT STARTED; the pin-convergence run
  (normalizing `ea2b2579`-style plain cache-busters to content
  hashes) is still owed.
- Phase D / design: visual regression is now a REQUIRED check (6
  contexts); the design-lane gate migration to gate.yml is still
  pending.
- Publishers table below is current through data head `2f110da8`
  (Oct-31); the data branch has since advanced to `8e9ef20f`
  (verified Nov-1) and the tagged Publish snapshot is `debee81d`.
  Component-level asof refresh for the new head is NOT itemized
  here — it rides the next full manifest read, not a guess.

## Publishers on the data branch (all written + blob-verified)

Data branch head: `2f110da8` (regime consistency rebuild). Manifest:
`data/_manifest.json`, 16 components. Fully-green deploys from run
41159785960 onward (purge + live-verify + workflow tag); tags
`data-2026-10-31-3` (`37cacfe6`), `data-2026-10-31-4` (`40b30342`),
`data-2026-10-31-5` (`2f110da8`), `data-2026-10-31-6` (also `2f110da8`).

| Component | asof | Data commit | Files | Note |
|---|---|---|---|---|
| contributors | 2026-10-30 | `ca4eb9a9` | 2 | History: exactly one Oct-30 entry appended; Oct-29 gap pre-existing, migrated as-is |
| sector-rotation | 2026-10-30 | `3684bd39` | 3 | Boards rebuilt with Trading bucket [BBC, STC] + Bikas family of 8 → Development Bank (tag -4) |
| sim-benchmarks | 2026-10-30 | `2d2fb616` | 1 | Generated 2026-10-30 19:30 NPT; rows run to 2026-10-30 |
| reports-archive | 2026-10-29 | `1c5a85c0` | 1 | Entry session_date 2026-10-29; its market block IS the Oct-30 close (2690.15 / −5.45 / 348). asof kept at the file's own date |
| price-push | 2026-10-30 | `e436a4dc` | 9 | 7 windows + history + manifest |
| broker-zero-sum | 2026-10-30 | `efabc648` | 8 | 7 windows + history |
| broker-smart-money | 2026-10-30 | `3e9d11fe` | 2 | WT untracked `badge-qa/` dirt NOT migrated |
| smart-money-eps | 2026-10-29 | `3fc5c9c2` | 2 | Board asof stays 2026-10-29 (eps_asof 2026-09-30, Q4 FY82/83); Oct-30 run changed 2 lines vs main; label question flagged, not relabeled |
| sector-symbol | 2026-10-30 | `7ed72f52` | 3 | |
| money-flow | 2026-10-30 | `22727982` | 1 | Current board only; archive/cohorts NOT updated by the Oct-30 run (archive last 2026-10-29) — builder-side gap, not fabricated |
| sector-price-rotation | 2026-10-30 | `5d2d32a5` | 3 | Boards rebuilt with Trading bucket [BBC, STC] + Bikas family of 8 → Development Bank (tag -4) |
| sector-seasonality | 2026-10-30 | `1f36c847` | 2 | Keystone update sector-strength waits on — satisfied on the data branch. Trading is in data; the seasonality dropdown gains Trading via #244 (merged `c63a7755`) on the next Publish |
| vpi | 2026-10-30 | `b484ff40` | 1 | FINAL board, 279 symbols; archive/cohorts untouched by design |
| technical-signals | 2026-10-30 | `b67894e4` | 4 | |
| performance-snapshot | 2026-10-30 | `6b167615` | 1 | `nepse-chart/data/performance.json`: the job's own stalled payload (Oct-30 23:41 build, 346 symbols, blob `ff84f9da` == WT-perf HEAD file byte-for-byte), replacing main's stale Oct-29 23:41 version. Job state files NOT touched (job owns them); collector `deploy()` reroute to the data-branch writer LANDED via #241 (`ee9a83d7`); first real written data commit proven only at the Monday 11:00 NPT in-window run (forced publish deliberately avoided Saturday). Saturday/Sunday runs are archive-only (non-trading days), so no new perf PRs before Monday 11:00 NPT |
| market-regime | 2026-10-30 | `37cacfe6` | 2 | The missed 15th component (never among the 14 migrations); NEPSE 2690.15 BEAR, Banking BULL, calls ledger Oct-30 entry. Live-verified Oct-30 |

Not on the data branch (separate paths, not P1b migrations):
sector-strength (gate-correct refusal; clears once seasonality is
LIVE, not merely on the data branch); trade-history (runner fix +
#198 reconciliation still owed); sentiment #193, broker-matching
#197, blog-index #205 (PR-queue items, not data-branch
publishers); noscript baker #206 (closed, superseded by P2's
same-snapshot render).

## Code PRs

| PR | Status | Note |
|---|---|---|
| #237 pr-flow-deploy PUT fix | DONE (merged 2026-10-31) | Changes `tools/pr-flow-deploy.py:598` POST→PUT + docstring/comments. All 5 required checks green on head `e0a33806`. Merge commit `e96fb92d` via PUT (first attempt, 200); main tree `b74b7f52` == PR head tree exactly. PROVENANCE VERIFIED 2026-10-31: PR timeline events are only closed/commented/committed/merged — NO `auto_merge_enabled` event; merged 2026-10-30T23:37:07Z by ShirjanKhadka1 = the direct API PUT, NOT auto-merge. Consequence: the fixed HELPER binary's PUT merge path is still unproven (helper runs 1–2 never reached merge: run 1 poller died silently; run 2 died on the empty-diff tree-POST 422). Helper-PUT proof CLOSED by #240 (merged `efa34923` via the fixed helper PUT, request `7721:1F73A7:168DA57:4AA464C:6AE53D5C`). Duplicate-push guard: check the branch tree before any helper re-run |
| #241 performance-snapshot data-branch reroute | DONE (merged 2026-10-31, auto-merge) | Collector `deploy()` writes ONLY `nepse-chart/data/performance.json` via `tools/data-branch-writer.py`; health.json + status/index.html deliberately NOT written (publish assembler regenerates them). Merge `ee9a83d7`, parent `efa34923`. First real written commit proven only Monday 11:00 NPT in-window run |
| #242 broker-hub Oct-30 bake | DONE (merged 2026-10-31, auto-merge) | Bake via `tools/bake-broker-snapshot.py`: hub HTML + `DAILY_END` 2026-10-29 → 2026-10-30 in `js/nepse-brokers.js` (2 files, 7+/7-). Merge `1d190674`, update-branched past #241 to `2d691d5e`. Live-verified: header 2026-10-30 · 68 days, Naasa 62.4/67.9/−5.5 Cr == daily file |
| #243 sector map: Bikas → Development Bank + Trading bucket | DONE (merged 2026-10-31, auto-merge) | Map + all four sector boards: Bikas family of 8 (GBBL, JBBL, KSBBL, LBBL, MLBL, MNBBL, SABBL, SINDU) Banking → Development Bank (Banking 27→19, Dev Bank 9→17); Trading bucket [BBC, STC] on boards. Merge `314919d3`. Live-verified: map + boards |
| #244 seasonality dropdown: Trading sector | DONE (merged 2026-10-31, auto-merge) | One-line dropdown change; merged via its own auto-merge (not touched by this lane). Deployed by Publish 41162382486; dropdown verified live (ORDER includes Trading) |
| #245 BPCL blog post | DONE (merged 2026-10-31) | Blog lane (other agent); merge `eede963d`; deployed by the green Publish on `6dfc578` |
| #246 program status: #241/#242/#243 + B3 closed + live gate | DONE (merged 2026-10-31, auto-merge) | Merge `ab11e0bc`; file verified on main (blob `cb3adc3c`); renders to `/status/program-status.html` on the next Publish (not `/status/`, which is the pipeline-health page) |
| #247 corporate-actions display: withdrawn vs no-declaration split | DONE (merged 2026-10-31, auto-merge) | Merge `b227c039`; vocabulary split (withdrawn → Closed; no_declaration → '- -' + 'No dividend'; announced rights → Pending); SMFBS template verified live; site-wide audit in the PR (div-live 45/46, corp-actions 28, rights 104 symbols, auctions 137; IPO/auction action items zero on file) |
| #248 BPCL financials expansion | DONE (merged 2026-10-31) | Blog lane (other agent); merge `6dfc5788`; Publish on `6dfc578` green |
| #249 news refresh: publish via data branch (GH006 fix) | DONE (merged 2026-10-31, auto-merge; proof LANDED) | Merge `f10d6161`; new `tools/news-data-writer.py` + rewritten `nepse-news-refresh.yml` (seed from data branch + stage via writer; items-hash no-change detection; SMTP alert unchanged). PROOF LANDED 2026-10-31: run 41187307563 success (500 items); live via the green Publish deploys. Component registration in `data/_manifest.json` still to confirm on the next manifest read (16 components at last update). |
| #256 Phase B dossiers | DONE (merged 2026-10-31) | 11 dossiers `docs/sources/` + `docs/DATA_SOURCES.md` + `docs/source-matrix.json` (13 files); merge `4d7f611c`. GATE B NOT SATISFIED: corporate-actions, fundamentals, ipo satisfied; news partial; mf-nav conditional (Capital Max use-with-account); index-close, floorsheet, broker-flow, daily-ohlc, monthly-ohlc, universe/reference BLOCKED (no permitted primary); CDSC/NRB/ChartNepali/ShareSansar cross-check only |
| #257 wrap archive | DONE (merged 2026-10-31) | Merge `47143e88`; live wrap Oct-30 first, Oct-29 second; archive 17 entries. Follow-up owed: data branch still mirrors the Oct-28 wrap copy (wrap NOT a manifest component — registering it / teaching Publish to bake wrap = decision, not smuggled) |
| #259 content via data branch | DONE (merged 2026-10-31; proof LANDED) | Merge `fa42106d`; `tools/content-data-writer.py`; run 41193596480 success; announcements 124. Old content pipeline GH006 failure resolved by migration |
| #261 daily overflow | DONE (merged 2026-10-31) | Merge `dbdaf46e`; `minmax(0,1fr)` grid tracks (specificity bug in media rules fixed), sticky turnover bar, 3D glow cards, turnover wraps via `<wbr>` |
| #263 ShareSansar comparator | DONE (merged 2026-10-31) | Merge `6741d5b4`; weekdays 17:30 NPT; artifact log only; Oct-30 sample 0 discrepancies. First scheduled run Mon Nov-2 17:30 |
| #267 tokens-glow (design PR1) | DONE (merged 2026-10-31) | Merge `8f21b1c4`; tokens file + `--nd-glow-lime`, 591 files pin-only |
| #268 390px turnover clipping | DONE (merged 2026-10-31) | Merge `f6749650`; shared `nd-chrome.css` sticky symbol column painting over text; page-scoped fix. Rendered 390px verification STILL OWED (live browser, 3 sort URLs) |
| #269 Chukul collector | DONE (merged 2026-10-31) | Merge `2668f0c8`; workflow_dispatch ONLY, verify-only, stages nothing; Oct-30: 74,054 trades / 348 symbols / Rs 8,891,595,145.90 / 0 duplicates. COLLISION open: data branch already stages this dataset (`nepse-floorsheet/data/<date>/`, Oct 26–30) — consolidation decision owed |
| #270 broker stamp | DONE (merged 2026-10-31) | Merge `47b8d11e`; baker now computes sha1[:8] of final shipped JS and rewrites the page reference (exactly-one assertion, fails loud); runs even on no-change days (self-heals). Root cause: #242 advanced DAILY_END but never re-stamped `?v=`. PROOF OWED: brokers-daily Sun Nov-1 18:20 — expect 'JS stamp refreshed to c7c8d184', verifier PASS 35 / WARN 1 / FAIL 0 |
| #272 settle-wait | DONE (merged 2026-10-31) | Merge `1e085cff`; verifier waits for edge settle before strict live check. Did NOT fix ee56 (see Nov-1 update) |
| #273 CHG fix | DONE (merged 2026-10-31) | Merge `19c0008f`; `.ds-overview.ds-ov-card.v { white-space: normal; }` (page-scoped; `nd-cinema.css:231` nowrap at equal specificity was winning); pin → `7d942c13`, live. Rendered-picture verification OWED (1920/1280/390, light+dark) |
| #274 market cap | DONE (merged 2026-10-31) | Merge `94a1c2b7`; NEPSE official Oct-30 total Rs 4,630,727,163,404.20; fetcher writes `market_cap_total` only when summary turnover (0.1%) + transactions (1%) match snapshot sums; renderer prefers session total → per-quote sum → OMITS card when neither exists. JS pin bumped separately by #282 |
| #275 table-system (design PR2) | DONE (merged 2026-10-31) | Merge `25611f40`; unified table section in `css/nd-cinema.css` + 83-file cinema pin sweep |
| #276 CSP prereq | DONE (merged 2026-10-31) | Merge `3bc27a56`; `js/nepse-logos.js` no longer emits onerror/onload attributes (capture-phase document listeners); pin → `ea2b2579` in exactly 7 HTML files. #271 closed unmerged (superseded). FLIP GATED: live re-verify + one Report-Only cycle with no new violations, then rename Report-Only → CSP with the 30 script hashes + 'unsafe-inline' in style-src only |
| #277 data strategy | DONE (merged 2026-10-31) | Merge `32babcbe`; one file `docs/DATA_STRATEGY.md` (10,626 bytes). Tiers: official/open only if terms+robots permit (currently NOT authorized — robots unknown, no documented API/terms); Capital Max conditional; Chukul floorsheet behind adapter + kill switch; ShareSansar cross-check only; derived aggregates published, never raw vendor rows. Market-cap durable path = versioned human-verified listed-shares dataset × price (schema only; dataset does not exist yet) |
| #278 charter P0 spec | DONE (merged 2026-10-31) | Merge `3353a5ac`; cache-busting `?verify=` token + no-cache headers + purge-all-variants. Did NOT fix ee56 — the never-seen token STILL returned the wrong hash, refuting the poisoned-cache theory |
| #279 security.txt artifact fix | DONE (merged 2026-10-31) | Merge `e706f5ad`; `upload-pages-artifact` tar `--exclude=".[^/]*"` was dropping every top-level dot-path; replaced with manual tar + `upload-artifact` as `github-pages` (+ `include-hidden-files: true` + fail-loud tar check). security.txt LIVE 200 (166 bytes, correct content) |
| #280 card-glow-text (design PR3) | DONE (merged 2026-10-31) | Merge `6be65f3a`; kit tokenization, stat Spectral, reveal JS-scoping, hover guards, `transition:all` + reduced-motion fixes, 597 files |
| #281 stock sweep (design PR4) | DONE (merged 2026-10-31) | Merge `6a662ad7`; generator template figure/num nowrap + 435 baked stock files (434 stock pages + `stocks/index.html`) + pin literal sync |
| #282 JS pin bump | DONE (merged 2026-10-31) | Merge `1e808235`; one line: `nd-daily.js` pin → `5883a188` (= sha1[:8] of blob `ae6d0fb9`). #274 changed the JS but never updated its `?v=` pin; live JS at old pin `99df961b` had ZERO `market_cap_total`. Live since the #283 dispatch deploy; JS at new pin contains `market_cap_total` ×1. Rendered card-OMITTED check owed (card should be OMITTED, not 'Unavailable', until Monday's first intraday snapshot, then Nov-2 total) |
| #283 verifier instrumentation | DONE (merged 2026-10-31) | Merge `7e59d66a`; verifier captures `live_body_b64` + `live_headers` + `live_final_url` on mismatch (diagnostic only, no pass/fail change). Its single dispatch (41231693412) captured the runner's live bytes and PROVED ee56: first 39,179 bytes byte-identical; the ONLY difference = one extra line before `</body>`, a Cloudflare Web Analytics beacon script (367 bytes) — edge-injected analytics, not a stale page |
| #284 family tables (design PR5) | DONE (merged 2026-10-31) | Merge `3654c35e`; 19 cinema rules converging broker/signal/moneyflow/volume tables + 83-file sweep |
| #285 utility chrome (design PR6) | DONE (merged 2026-10-31) | Merge `f67aeb6a`; privacy + data-terms onto shared chrome (about/contact excluded as portfolio; 404 already on shared chrome) |
| #286 midnight rollover | DONE (merged 2026-10-31) | Merge `43b5a6aa`; Nov-1 00:05 run pushed via PR flow; live manifest v106, today_npt 2026-11-01 after the #283 dispatch deploy. Rollover workflow-proven end-to-end (merge + live) |
| #287 verification fixes (design PR7) | DONE (merged 2026-10-31) | Merge `b796708b`; cinema PR7 section (+11 lines; `main.sig-wrap table.sig-table th` mono rule beating kit R2) + template peer-th mono + 435 stock files + 83-file sweep to cinema pin `26c53113` |
| #288 beacon-tolerant verifier | DONE (merged 2026-11-01) | Merge `c81dfdec`; one file `tools/publish-verify.py`. For .html/.htm only, strips the single script element referencing `static.cloudflareinsights.com/beacon.min.js` (host/path match, never rotating token; empty body only) symmetrically from live AND artifact bytes before hashing, in settle and strict pass alike; raw hashes stay as evidence + stripped counts + 'beacon-tolerant ok' line; JSON byte-exact; unmatched beacon fails closed; Web Analytics NOT disabled. Fixtures 8/8 (incl. real ee56 pair → exit 0; JSON+beacon → fails; beacon+real-change → fails). FIRST GREEN PUBLISH: run 41234496960 (head c81dfdec, data debee81d) = SUCCESS (publish: success, tag: success); runner log 'beacon-tolerant ok for nepse-actions/index.html (stripped live=1 artifact=0; all other bytes identical)'; settle converged 5.4s (was 306s unconverged). Tag `data-2026-11-01-1` → debee81d (NOT -11: tag job names by RUN date NPT) |
| #289 SHA-pinning publish.yml | DONE (merged 2026-11-01) | Merge `53e99c35`; exactly one file `.github/workflows/publish.yml`, 7 lines. Pinned: checkout ×2 @11d5960a, download-artifact ×1 @d3f86a10, upload-artifact ×3 @ea165f8d, deploy-pages ×1 @d6db9016 — each SHA API-resolved and equal to its v4 tag target (pure hardening, no behavior change); upload-pages-artifact needed no pin (replaced by manual tar in #279); zero @v refs remain (main blob `7546d478`). NO Publish dispatched from this PR (next Publish proves the pinned workflow) |
| #290 baseline refresh | DONE (merged 2026-11-01) | Merge `d43a9f9b` (current main tip); exactly 16 PNGs, nothing else. Baselines generated in the pinned Playwright container (dispatch run 41236682898, artifact `visual-baselines-2751`, 15.5 MB), reviewed as pictures and approved. Visual regression GREEN on main (check 'Visual regression (Playwright container)' = success on d43a9f9b). VISUAL NOW REQUIRED: parent flipped branch protection 2026-11-01 02:39 (PUT contexts 200; verified 6 required contexts, strict + enforce_admins unchanged) |
| #169, #173, #183, #186, #187 | OPEN — DO NOT HAND-MERGE | Stop rule from the 2026-10-31 04:50 order; parent sequences. NOTE: #173 is ALSO a perf PR (head `deploy/performance-snapshot-20261030-1411`, 13:41 snapshot) — see backlog row; its close needs an explicit parent call, not a blanket one |
| #235 midnight rollover 2026-10-31 | CLOSED 2026-11-01 as superseded | Closed via API with comment citing #286 merged + live manifest v106; the rollover path is proven end-to-end (merge + live) |
| #208 post-close sweep signals | OPEN | Likely superseded by #214/#223 absorption; diff-vs-main verification owed before any disposition (parent call) |
| 40 performance-snapshot PRs (#161–#236, all created 2026-10-30) | OPEN — RECOMMENDATION ONLY, NO MASS-CLOSE | One PR per hourly run (incl. stalled pickups), each running CI that mails on failure — this is the inbox flood. All carry Oct-30 snapshots superseded by the single data-branch landing (Oct-30 23:41, `6b167615`) + the publish workflow (no PR per run). RECOMMENDATION (parent confirmation required): close all 40 as superseded by the data-branch path with a standard comment, #173 called out by name for its explicit confirmation (STOP-protected). Closing stops NEW CI mail; already-sent mail cannot be unsent. The job's own reroute LANDED via #241; first real written commit proven only Monday 11:00 NPT in-window run (forced publish deliberately avoided Saturday) |

## Stamp-only PR inventory (P1b item 4)

Swept all 59 open PRs (2026-10-31): 7 excluded (6 stop-rule + #237),
52 reviewed, **0 stamp-only**. Nothing to close under this item.
Method note: the first sweep misflagged #197 (broker matching) —
GitHub omits patches for large files, and a missing patch was
wrongly read as "no data lines". Fixed (missing patch =
unclassifiable = not stamp-only) and re-run: 0 flagged. #197 is a
data PR, not a stamp PR.

## Standing live gate (2026-10-31)

Script `live_gate.py` (workspace goal hidden_files, not in the repo),
30-min runtime cron, state-change-only reports (GATE OK stays
silent). Checks live facts: board asof vs live manifest session,
baked snapshots vs source files, sector taxonomy vs the live map.
Dry run 07:52: 23 pass, 16 fail, 2 skip — the 16 were the regime
Oct-29 lag, the broker-hub Oct-29 bake, and the taxonomy family
(8 Bikas + BBC/STC). All cleared by #242, #243, and data
`37cacfe6`/`40b30342`/`2f110da8`: manual run 08:48 GATE OK,
28 pass, 0 failures, 2 by-design skips (sim-benchmarks: no asof
field; smart-money-eps: EPS vintage by design). Limits (v1):
symbol stamps sampled (5 pages); actions/signal/verdict/blog baked
pages not gated yet.

## P2 proof notes (pre-flip)

- Assemble dry-run (local, real data-branch files for contributors +
  vpi, reduced 2-component manifest): exit 0, publish manifest
  written (`snapshot_sha b67894e4`, main `31029dc5`), overlaid files
  carry asof 2026-10-30, health regenerated by `build-health.js`,
  noscript present in baked status page, artifact verify OK.
  Negative control: a manifest declaring a file absent from the
  snapshot fails exit 1 with the exact path (fail-loud proven).
- Renderer fallback proven: missing `ops/PROGRAM-STATUS.md` renders
  a placeholder, never fails the publish.
- Workflow YAML parses (pyyaml). #238 merged; data branch code-synced
  (`59a1ddf2`, manifest untouched) so push-to-data triggers.
  NEW HELPER FINDING (P0 hardening follow-up, not fixed here):
  pr-flow-deploy pushes even when 'nothing new staged', and the
  tree POST 422s deterministically on an empty diff (same class as
  #232's push step). Fix: skip the push when nothing is staged.
- Dispatch proof: FAILED at dispatch (403, blocker B4 — token
  lacks Actions:write). Data is safe on the data branch regardless.
- Push-trigger proof: the code-sync push DID trigger publish run
  41147393968 (event=push, branch=data, sha=`59a1ddf2`) — the
  trigger path works. The run FAILED in 2s with no steps and no
  runner: annotations on check run 124375583813 prove the cause —
  the job-level `environment: github-pages` block + the
  environment's main-only branch rule reject every data-branch run
  at job start. Fix PR #239 (remove the environment block) MERGED
  (`d6669de9`).
- First live deploy (run 41149221033, snapshot `2f64a2ed`): every
  step green through Deploy to GitHub Pages; purge failed loudly
  on absent B3 secrets (as designed); live-verify + tag skipped.
  Sandbox interim purge + live-byte verification done (see LIVE
  PROOF header). Deploy-pages does NOT hit the branch rule
  without the job-level environment (B5 moot).
- PURGE CAUSE CONFIRMED FROM THE RUN LOG (2026-10-31, not
  inferred): run 41149221033's job log (downloaded via the API
  302 → blob URL fetched WITHOUT the Authorization header — the
  parent's 401 was the forwarded auth header, not a permission
  problem; blob URLs are pre-signed and reject auth headers)
  shows step 16 at 2026-10-31T00:17:26Z: `publish-purge: FAIL
  CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must both be set
  (repository secrets; see ops/PROGRAM-STATUS.md blockers).
  Refusing to call a deploy verified while edge nodes may serve
  stale bytes.` Runner env showed both secrets empty, and the
  script made NO Cloudflare API call — missing-secret, NOT a
  Cloudflare rejection (no Cloudflare error body, no request ID,
  because no request was made). Step 15 (purge URL list) had
  already succeeded: 44 URLs. Log saved at
  `fixprog-p1bp2/run41149221033.log` (297,783 bytes).
- CI-mail note (user's own opened mail, 2026-10-31): quality
  16m14s green, secret scan 25s green, visual regression 9m49s
  red — visual-only, noise, not blocks. CI failure mails remain
  noise under the agent split (visual regression is Muse's
  design gate).
- Data tag: designed in the workflow (tag job, post-flip only,
  `data-YYYY-MM-DD-N` on the deployed snapshot). First workflow tag
  landed 2026-10-31 (`data-2026-10-31-3` on `37cacfe6`, run
  41159785960); tags -4/-5 followed on the same green path. The
  Oct-30 REVIEW flag (daily 347 vs floorsheet 348 vs monthly 342)
  and the `data-2026-10-28-1` baseline gap are parent-owned
  resolutions, not closed by this workflow.
- v1 honest limits: baked HTML pages lag the snapshot by one full
  rebuild (full_rebuild input fails fast until builders are
  CI-proven); noscript fallback is asserted present, not current;
  auto-rollback on verify failure is a P8 follow-up (v1 fails loud
  with the redeploy/rollback command).

## Reroute wrapper (P2 follow-up, built + tested, not yet deployed)

`reroute-publish.py` (work dir; ships after #239): runs a builder
with --publish, treats the protection 422 as expected when WT files
changed, and publishes to the data branch with ledger-safe merging
(boards replace; list accumulations union by exact equality with
date-key conflict → fail loud; dict accumulations superset-or-fail;
health/status/manifest never written). Proven: dry-run NO-CHANGES
on real contributors state; merge test preserved Oct-30 + added
Nov-02 with no duplicates; conflict test raised; live write on
scratch branch `data-test` (commit `ac2d296f`, read-back verified)
then the scratch branch was deleted (404 confirmed). Dispatch step
is implemented but BLOCKED (B4: token 403s workflow_dispatch);
push-to-data trigger is the working path. Per-script edits
(`run-*.sh` → wrapper call) are NOT done yet; until they land,
Monday runs must use the migration pattern (builder --publish,
extract WT diff, writer) — never a naive copy, which would clobber
data-branch ledger entries (see ledger rule above). Builder
data-base changes (build on data-branch ledger state, not main's)
are the permanent fix for dict accumulations.

## Unified program matrix — P0–P8 + DATA ARCHIVE Phases 0/A–D (2026-10-31)

This section unifies the original P0–P8 rebuild program with the
DATA ARCHIVE, ACQUISITION AND SELF-VERIFICATION PROGRAM (second
charter, 2026-10-31; one program, not two — it supersedes earlier
data prompts; the Monday 2026-11-02 10:45 NPT deadline, the actions
display law, and the agent split still stand). Status vocabulary
matches the P0–P8 table above. Owner actions for the new program
live in BLOCKERS.md (token Actions read/write, visual
required-vs-remove, Phase B governance, sequencing) — they are
pointed to, not duplicated, here. Live render note: this file
renders to `/status/program-status.html` via the Publish
workflow's render step (NOT `/status/`, which is the
pipeline-health page); the live page updates on the NEXT Publish
after a merge, not at merge time. This update's live render is
therefore owed on the next Publish.

| Item | Status | Evidence / next |
|---|---|---|
| P0 — deploy-failure classification | DONE | #212; see table above |
| P1a — universe gate + manifest | DONE | #223, manifest v105, session 2026-10-30 CLOSED, universe 426 |
| P1b — publishers under protection | LIVE | 16/16 components on data; fully-green deploys from 41159785960; tags through -6 |
| P2 — ONE publish workflow | LIVE | #238 + #239; Publish green on `6dfc578`; renders this file per run (see Rule-4 resolution below) |
| P3 — per-component as_of + per-component gates | NOT STARTED | Manifest already carries per-component asof; gates still global-session; one lane's update must never be blocked by another lane's date |
| P4 — fresh checkout per run | PARTIAL | Worktree hygiene still per-job follow-up |
| P5 — hashed asset URLs | NOT STARTED | Stale-token items open; content-hashed asset URL generation NOT implemented (charter 2 item — new build work, not a verifier fix) |
| P6 — vendor login (Capital Max MF) | NOT STARTED | MF snapshot login-blocked before deploy (see Phase 0 note: NOT a migration target — P6 STALE-badge + one-step re-login path) |
| P7 — ONE events table | NOT STARTED | Ledger-vs-page gap known; page is source of truth; #247 fixed the display vocabulary, not the ledger |
| P8 — auto-recovery / watchdog / /status | PARTIAL | This file + standing live gate (agent cron, 30-min, 08:48 GATE OK); watchdog + alert dedup for other jobs open; gate migration to Actions pending (Phase D) |
| Phase 0 — emergency decoupling | IN PROGRESS | Inventory DONE 2026-10-31 (section below); 5 OPEN writers; content migration CHAINED after news proof (NOT started); news migration DONE-code, proof PENDING |
| Phase A — 3-year window + COLD archive | NOT STARTED — storage path decided, roll job owed | COLD = orphan `cold` branch in this repo (Parquet, dataset/year/month + checksum manifest + backup bundles, same API pattern as the data-branch writer); R2 = OPTIONAL future scale-out (same layout/manifest); Backblaze B2 (10 GB free, no card) = second fallback. NO live roll has happened; no live window shrink until the roll job (retention.py + retention.yaml + Parquet writer + restore test) is built and GATE A is simulated |
| Phase B — source dossiers + acquisition | NOT STARTED — governance owed | Dossiers + matrix owed; NO source reclassified in this update; matrix-vs-Oct-23-API-ruling decision owed (see below) |
| Phase C — audit resolutions | PENDING | REVIEW missing symbol unnamed; bearish ×9 unclassified; dynamic universe gate not implemented; SBLPNP/MBLPNP typing EVIDENCE-OWED (see below) |
| Phase D — design / speed / monitoring | PARTIAL (bundle PASS; gate migration PENDING) | Bundle ~400 MB vs 800 MB guard = PASS today; design tokens = other agent's lane (PR coordination); gate.yml migration pending; concurrency proposal + content-hash URLs below |

### Phase 0 inventory (2026-10-31, read-only, API + grep evidence)

OPEN live writers still pushing to protected `main` (5):

| Writer | Mechanism | Schedule / last run |
|---|---|---|
| NEPSE content pipeline (GH 371904582) | `nepse-content.yml:152,209` — `git push origin main` | 06:00 + 18:00 NPT; run 41173970474 FAILED 2026-10-31 11:32 NPT at 'Commit content refresh' (4th consecutive; last success 2026-10-29 05:51Z). Writes announcements, actions page, sitemap, `news.json`. CHAINED after news proof — NOT started |
| NEPSE intraday floorsheet (GH 371427898) | `nepse-intraday-floorsheet.yml:93` — `pull --rebase origin main && git push origin main`, DRY_RUN-gated but live | Every 5 min, market hours; run 41054577148 FAILED 2026-10-30 (GH006). Overlaps agent intraday-staging files — migration must reconcile, not duplicate |
| NEPSE market-close pipeline (GH 371904584) | `nepse-market-close.yml:142,173,273,347` — `git push origin main` | 15:20 / 16:10 / 17:00 NPT; run 41094868272 FAILED 2026-10-30 (GH006, 3rd that day). Arguably superseded by P1b/P2 close-capture + data publishers — MIGRATE-OR-DISABLE decision owed, not assumed |
| IPO SEBON Watch (GH 374332113) | `nepse-ipo-watch.yml:46` — bare `git push` on a default `main` checkout | Daily 07:00 NPT; run 41017748432 SUCCESS 2026-10-30. LATENT: push skipped on no-change days, so it succeeds by no-op and fails GH006-style the first day a real IPO entry appears |
| postclose-thorough-check (agent cron, Mon–Fri 18:38) | Repair deploys via `github-push-parallel.py` with NO `--branch` — the script defaults to `--branch main` (`:227`); the job body contains zero `branch` mentions | Repair-only; LATENT: normally a no-op, but any triggered repair attempts a direct-`main` push |

Disabled direct-`main` texts (migrate before ANY re-enable): research-index-sync, seo-index-watch, daily-finance-blog-post, nepse-intraday-poll. Dormant orphan definition (trap if re-registered): universe-refresh 17:30 file, no registered schedule (67 unregistered .md files total: 52 archived, 13 expired runonce, 1 past timer). Unclassified (per-file deploy-path audit owed): floorsheet-daily 15:35, ohlc-archive-updater, nepse-eod-totals, intraday-broker-flow (disabled), workspace `tools/` PUSH constants (possibly dead code).

Schedules to move to Actions/Cron: 64 live agent schedules (63 finance + learning-loop-weekly) + 14 GH scheduled workflows. Heartbeat: essentially NONE — live-gate state file + email-watch watermark only; the freshness watch is the closest dead-man alert; no missed-runs alert exists. MF snapshot is NOT a direct-`main` writer (PR-flow body, login-blocked before deploy) — it stays on the P6 path, not a migration.

Sizes (API tree data): main 400.2 MB, data 400.1 MB — the data branch is a near-full copy of main (only 1 data-only file, `data/_manifest.json`). Pages artifact ~400 MB = ~40% of the 1 GB limit; the 800 MB guard is clear (~400 MB headroom). Growth vector: nepse-brokers 141 MB + data 99.1 MB + nepse-floorsheet 26.2 MB = 266 MB (66%). Largest file: technical-signals-board-archive 23.9 MB, growing every session. Environment gotcha: /tmp on the VM is a 512 MB tmpfs — a full clone fills it; use the API or workspace disk.

### Phase A detail — rolling window + COLD (design decided, build owed)

Window math: `window_start(D) = D - 3 years` (Feb 29 safe); 2026-10-31 → 2023-10-31; 2026-11-01 → 2023-11-01. The earlier example dates (2024-10-31) were wrong; corrected per user decision 2026-10-31 (window_years = 3). If the start is a non-trading day, forward-adjust to the first trading day on or after it from the regime-aware calendar (Sun–Thu before 2026-04-06, Mon–Fri after). The roll job runs nightly after FINAL, including weekends and holidays. COLD layout: Parquet partitioned `dataset/year/month/` + checksum manifest + backup bundles on the orphan `cold` branch (same API write pattern as the data-branch writer; Publish never checks out `cold`, so the Pages guard is unaffected). R2 is an OPTIONAL future scale-out with the same layout/manifest (NOT a gate — the earlier R2/payment-card block is retired by the cold-branch alternative); Backblaze B2 (10 GB free, no card required) is the second fallback. Roll safety (unchanged): snapshot → write expiring rows to COLD → verify counts + checksums → restore-test a sample → only then remove from HOT → rebuild → verify every page shows the new window start; idempotent, resumable, never during a session, alerts on mismatch. PERMANENT exemptions (never roll off): prediction ledger + forward-accuracy history; corporate-action / dividend adjustment factors; 1-year indicator lookback buffer (200-day / EMA / 52-week exactness at the boundary). Raw series are never overwritten; adjusted series recompute from CA factors. Phase B licensing governs whether raw rows may be archived at all — still owed per dataset. UI: every page/chart shows `Data Window: <start> - <end>` + source + as_of per component; stock pages, screener and charts read only the window. Per-dataset actual start: for datasets with shorter history (e.g., floorsheet/broker since 2026-07-15) the window starts at the first real date, and every page shows each dataset's actual start. GATE A (owed): simulate 2026-10-31 → 2026-11-01 end to end including the restore test; live pages show the new window start. NO live roll has happened and none happens until the roll job is built and GATE A is simulated — 2023-10-31 does NOT leave HOT tonight on its own.

### Phase B detail — dossiers + acquisition (not started)

Dossiers owed at `docs/sources/<name>.md` for NEPSE official, SEBON, CDSC, NRB, issuer notices, Capital Max, Chukul, Nepalytix, ChartNepali, ShareSansar, MeroLagani: datasets, cadence, latency, timestamps shown to visitors, documented API/export/RSS/feed, licence, terms, robots rules, rate limits, auth model — from PUBLIC material only. Matrix owed (`DATA_SOURCES.md` / `source-matrix.json`): per source and dataset, USE / USE-WITH-ACCOUNT / CROSS-CHECK ONLY / REQUEST ACCESS / SKIP with reasons. Consensus rule (charter 2): for index, close and turnover, compare official vs secondary feeds; discrepancy > 0.1% → log to `exceptions.json` and default to official NEPSE values. Adaptive scheduling: poll tightly around each source's predicted next update, back off when idle; the charter's 5–15s CONTINUOUS polling is NOT feasible in Actions — a Worker-style path is an architecture decision owed, not assumed. Login/bot walls: never bypass; ask for an official API/export or build an owner-triggered upload (CSV + schema + checksum validation); publish last-known-good with a visible STALE badge + one-step re-login alert meanwhile. GOVERNANCE OWED (not decided here): the matrix vs the 2026-10-23 ruling that free Capital Max/Chukul APIs are fair-game sources — if the matrix governs, a re-audit may stop republishing some currently-used free endpoints. NO source is reclassified in this update.

### Phase C detail — audit resolutions (pending)

- Oct-30 REVIEW: daily 347 vs floorsheet 348 vs monthly 342 — the missing symbol is STILL UNNAMED. Resolution (name it, fix or document it, then tag) is owed; it is not closed by any tag.
- Bearish-pattern Buys ×9: classification owed — forming-label cases or a regression of the earlier invariant. Invariant to enforce: confirmed bearish patterns must never emit a BUY recommendation.
- Dynamic universe gate: replace the hard-coded 400–420 bounds with a check against the official NEPSE listed-securities register count ±2%. NOT implemented.
- SBLPNP/MBLPNP typing: EVIDENCE-OWED. The charter asserts DEBENTURE, but typing must be verified against the official register before it is baked in — preference shares take PREFERENCE_SHARE, not DEBENTURE. Typed instruments (preference shares + debentures) are excluded from equity rankings but remain accessible on stock pages. Do NOT treat DEBENTURE as fact until the register check lands.

### Phase D detail — design / speed / monitoring

- Design tokens (3D soft-glow tables, cards, sparklines, pagination, WCAG AA): the OTHER agent's lane — coordination via PR, not built here.
- Bundle: ~400 MB vs the 800 MB guard = PASS today (see Phase 0 sizes); the guard itself (fail before deploy above 80% of 1 GB) is still to be added to the Publish workflow.
- Standing gate migration: the live gate runs today as an agent cron (30-min, state-change-only; 08:48 GATE OK). Migration to `.github/workflows/gate.yml` is PENDING: all ~426 stock pages (not a 5-page sample), every baked page vs its source file, every board date vs the session engine, taxonomy vs the official classification, the data window on each page, archive health, size budgets, publisher heartbeats; report once per new failure/recovery; self-heal by triggering a republish on staleness; escalate by email only if self-heal fails; weekly negative-control test.
- Publish concurrency: group `publish` exists, but `cancel-in-progress` is TRUE today. The charter proposes FALSE (queue instead of supersede) — recorded as a proposed workflow change, NOT flipped in this update (it changes deploy semantics).
- Content-hashed asset URLs: NOT implemented (zero hits in the build) — new build work, not a verifier fix.
- Charter Rule 4 resolution (recorded): 'every run commits PROGRAM-STATUS.md' is incompatible with branch protection + the no-PR-per-run rule — the standing resolution is render-per-run (Publish renders this file into the artifact) + PR-on-merge (this file updates via code PR when the program state changes). The workflow renders but does not commit this file.

### Data-branch topology note

The data branch is described in the charters as 'orphan'. That topology is UNVERIFIED (the GitHub compare API 422s 'diff taking too long') and is NOT claimed here — it is to be established during compaction design. What is functionally true and verified: publishers write disjoint component paths to the `data` branch; Publish overlays main + data into one artifact. The data branch is currently a near-full copy of main (see sizes above), not a slim data-only branch — compaction design must account for that.

## Next steps (in order)

1. #237 merges via PUT (DONE: `e96fb92d`, tree-verified).
2. Workflow PR #238 → 5 checks → PUT merge (DONE: `b717e48e`).
3. Fix PR #239 → 5 checks → PUT merge (DONE: `d6669de9`).
4. Code-sync workflow + tools onto the data branch (DONE:
   `59a1ddf2`, then `2f64a2ed` with the #239 fix; no manifest touch).
5. First live deploy (DONE: run 41149221033, snapshot `2f64a2ed`,
   42/42 bytes live, tag `data-2026-10-31-1`).
6. Performance-snapshot migrated to the data branch (DONE:
   `6b167615`, Oct-30 23:41 stalled payload, 346 symbols) +
   backlog disposition recommended (40 PRs, parent confirmation
   required, #173 explicit). Purge cause CONFIRMED from run log
   (missing-secret, not Cloudflare rejection) + B3 relay
   instruction prepared for the owner.
7. PROGRAM-STATUS lands in the repo (DONE: #240, `efa34923`,
   merged through the FIXED HELPER PUT — the helper-PUT proof,
   request `7721:1F73A7:168DA57:4AA464C:6AE53D5C`).
8. Owner adds B3 secrets → next data push goes fully green
   (DONE: secrets added ~06:33–06:34; run 41159785960 fully green,
   workflow tag `data-2026-10-31-3`; UI rerun no longer needed).
9. Perf collector `deploy()` reroute to the data-branch path
   (DONE: #241, `ee9a83d7`; first real written commit proven only
   at the Monday 11:00 NPT in-window run).
10. Broker-hub Oct-30 bake (DONE: #242, `1d190674`; live-verified
    2026-10-30 · 68 days, Naasa == daily file).
11. Sector-map fix + Trading bucket + Bikas family (DONE: #243,
    `314919d3`; boards + map live; tags -4/-5).
12. Standing live gate (DONE: built + scheduled; 08:48 GATE OK,
    28 pass, 0 failures, 2 by-design skips).
13. #244 seasonality Trading dropdown (DONE: merged `c63a7755`
    via its own auto-merge; rides the next Publish).
14. Monday 2026-11-02 10:45 NPT deadline: every publisher lands
    without manual merging; live tape moves past the Oct-30 close;
    Monday evening finals show Nov 2.
15. News proof: re-dispatch (or next scheduled tick) → verify data
    head moves + green Publish + live news.json newer than
    2026-10-30T13:02:12Z + news-refresh component in manifest →
    then content migration starts (chained authorization
    2026-10-31 12:21; news.json ownership stays with news-refresh).
16. Phase 0: migrate the remaining OPEN writers one at a time
    (intraday floorsheet with staging reconciliation; market-close
    migrate-or-disable decision; IPO Watch latent fix; postclose
    repair branch fix), each proven by new data live; trace the 5
    unclassified items; migrate-or-delete the 4 disabled texts +
    dormant orphan before any re-enable.
17. Phase A: build the roll job (retention.py + retention.yaml +
    Parquet writer + restore test) on the `cold` branch; simulate
    GATE A (2026-10-31 → 2026-11-01); no live roll before that
    simulation passes.
18. Phase B: write the source dossiers + matrix; settle the
    matrix-vs-Oct-23 governance decision; settle the Worker-style
    path for sub-minute polling.
19. Phase C: name the REVIEW missing symbol; classify the 9
    bearish Buys; implement the dynamic universe gate; verify
    SBLPNP/MBLPNP types against the official register.
20. Phase D: migrate the standing gate to gate.yml (all pages +
    self-heal); add the 800 MB size guard to Publish; decide the
    concurrency proposal; implement content-hashed asset URLs.
21. Program-status contents send: after the weekend migration
    lands, and again after Monday's close (not before) — per the
    standing send rule.

### Next steps — Nov-1 addendum (appended 2026-11-01; original list above kept intact)

22. Deploy decision (morning): dispatch one Publish to deploy main tip
    `d43a9f9b` (design PR7 + #289 + #290) live, or wait for the next
    data-triggered Publish. Live still serves `c81dfdec` (cinema PR5
    pin `059962c7`; new pin `26c53113`). Per the deploy rule, purge
    each changed HTML page's URL before calling it live-verified.
23. This file's live render (`/status/program-status.html`) rides the
    next Publish — verify it then, not at merge time.
24. Brokers-daily Sun Nov-1 18:20: #270 proof (stamp → `c7c8d184`,
    verifier PASS 35 / WARN 1 / FAIL 0).
25. Rendered-picture checks (live browser): #273 CHG card
    (1920/1280/390, light+dark); #268 390px × 3 sort URLs; #274
    market-cap card-OMITTED.
26. P2: retention dry run on main DONE (run 41241250254, job `roll`
    success, head `d43a9f9b`, default inputs). Next: nightly cron
    ONLY for Phase-B-allowed datasets (owned/derived first).
27. Monday Nov-2 acceptance + report at close: green Publish + tag;
    Worker /health CLOSED→PRE_OPEN (~05:00 UTC) +
    PRE_OPEN→CONTINUOUS (~05:15 UTC); Nov-2 finals on every board;
    ShareSansar comparator 17:30 with 0 unexplained discrepancies;
    no manual merge or dispatch; perf collector first real written
    data commit 11:00; held queue (#169/#173/gates) + perf backlog
    disposition via auto-merge/P2, never hand-merged.
28. P1 remainders: listed-shares dataset build (human verification
    is the bottleneck); Monday Chukul intraday measurement (does
    by-date update intraday?); Capital Max tier-2 posture (never
    bypass; re-login alert; last-known-good + STALE badge).
29. Design residuals (electable / lane-owned, not silently fixed):
    Finding 2 accdist bar-label truncation (no data loss — full
    names in tables below); daily turnover wrap at 1440 dark
    (daily lane); utility h1 Inter (utility-prose migration);
    actions-page generator `stamp()` reverts sweeps on regeneration
    (process fix belongs to the actions pipeline owner).

## Out of scope for this lane (parent/other lanes)

Bearish-pattern Buy classification (user item 6); SBLPNP/MBLPNP
typed-instrument decision (item 7); Capital Max one-step re-login
alert + STALE badge (item 8); naming the Oct-30 REVIEW missing
symbol + tagging the baseline (item 5 beyond the tag-step design).
