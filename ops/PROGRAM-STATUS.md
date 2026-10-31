# Program status — Nepse Decode publishing rebuild (P0–P8)

Last updated: 2026-10-31 (Saturday, market closed). Main tip at last
verification: `d6669de9` (#239 merge) — re-read before acting.
Data branch head at last verification: `6b167615` (performance-snapshot
migration; 15 components, 43 files).

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
deploys. First FULLY GREEN workflow run still awaits B3 (purge
secrets) — after B3 lands, the next data push goes green end to
end (deploy + purge + live-verify + workflow tag).

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
| B3 | Repo Settings → Secrets → **CLOUDFLARE_API_TOKEN** + **CLOUDFLARE_ZONE_ID** | Post-flip purge step in the publish workflow; absent secrets fail the job loudly (never silently stale). Interim: purge from the sandbox after deploy | OPEN — CONFIRMED TWICE: (1) from run log (run 41149221033 line 4534, `publish-purge: FAIL CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must both be set`; runner env both empty; NO Cloudflare call made — missing-secret, NOT a Cloudflare rejection); (2) from the USER'S OWN SCREENSHOT of Settings → Secrets and variables → Actions (2026-10-31 06:25): repo secrets are ONLY `ALERT_EMAIL_TO`, `BACKUP_REPO_TOKEN`, `MAIL_PASSWORD`, `MAIL_USERNAME` — both Cloudflare secrets ABSENT. OWNER-UI FIX (already relayed to the user): Repo → Settings → Secrets and variables → Actions → New repository secret, add BOTH: (1) `CLOUDFLARE_API_TOKEN` = Cloudflare API token with Zone → Cache Purge → Purge for the shirjankhadka.com.np zone; (2) `CLOUDFLARE_ZONE_ID` = the zone ID on the domain's Cloudflare Overview page. Then rerun the failed jobs from the UI (API rerun 403s on this token — B4). RERUN VERIFICATION PENDING (worker verifies when the rerun happens): the meaningful rerun is 41150937610 (current snapshot `6b167615`); rerunning 41149221033 would redeploy superseded `2f64a2ed`. Either way, a fully-green run (deploy + purge + live-verify + workflow tag) closes B3. Secret values NEVER go in chat — directly into GitHub's secret form only. No code change needed; do NOT work around it (no secret committed to the repo, no purge step bypassed) |
| B4 | Token scope: **Actions read+write** for this repo (token currently 403s workflow_dispatch) | `workflow_dispatch` is the writer's primary publish trigger; without it, only push-to-data triggers (which work) and UI dispatch (owner clicks Run workflow) can start runs | OPEN — fallback ready (push-to-data) |
| B5 | Repo Settings → Environments → **github-pages** → Deployment branches → add **`data`** | Post-flip deploys from data pushes hit the environment's main-only branch rule (proven: run 41147393968 rejected in 2s, no steps, no runner). Without B5, data-push runs prove the artifact but fail at deploy; main-branch (UI dispatch) runs deploy fine | MOOT — deploy-pages without the job-level environment does NOT hit the branch rule (run 41149221033 step 14 succeeded from branch `data`). No owner action needed. (The job-level environment block was the trigger; #239 removed it.) |

## Program P0–P8

| Item | Status | Evidence |
|---|---|---|
| P0 — deploy-failure classification + gh_client | DONE | Client merged as #212 (`a79b0620`); 16 publishers classified (`fixprog-p0/FAILURE-TABLE.md`) |
| P1a — dynamic universe gate + manifest advance | DONE | #223 (`95c47245`): manifest v105, session 2026-10-30, universe 426 |
| P1b — direct-push publishers get a working path under protection | LIVE (first + second deploy 2026-10-31) | 15/15 publishers migrated (table below, incl. performance-snapshot 2026-10-31); deployed snapshots `2f64a2ed` (42/42 bytes, tag `data-2026-10-31-1`) and `6b167615` (43/43 bytes, tag `data-2026-10-31-2`) |
| P2 — ONE publish workflow (main + data → Pages artifact, no PR per data run) | LIVE (first deploy 2026-10-31) | #238 merged via PUT (200; `b717e48e`, parent `e96fb92d`); #239 environment-block fix merged via PUT (200; `d6669de9`). First live deploy: run 41149221033, snapshot `2f64a2ed`, all 42 files byte-identical live, tag `data-2026-10-31-1`. First fully-green run awaits B3 (purge secrets) |
| P3 — per-component as_of, quarantine-only gates | NOT STARTED (next after P2 proves) | Data-branch `data/_manifest.json` already carries per-component asof (the P3 data shape); gates still global-session |
| P4 — fresh checkout per run, no shared worktree | PARTIAL | Migration was read-only on worktrees; builder worktree hygiene still a per-job follow-up |
| P5 — hashed asset URLs inside the build; post-hoc stamp verifier removed as blocker | NOT STARTED | Stale-token items still open (nd-tokens, nepse-index/compare/floorsheet, brokers.js pins) |
| P6 — vendor login (Capital Max MF): terms-checked re-auth or last-known-good + STALE badge | NOT STARTED | MF snapshot blocked on sign-in wall (2026-10-30 18:45, 2nd consecutive); do-not-re-ask rule stands |
| P7 — ONE events table (actions page + ledger + stock pages + sitemap) | NOT STARTED | Ledger-vs-page gap known (ledger builder doesn't know `outcome=not_distributed`); page is source of truth until P7 |
| P8 — auto-recovery or loud alert per failure class; watchdog; /status rates | PARTIAL | This file is the /status half; watchdog + alert dedup still open |

## Publishers on the data branch (all written + blob-verified)

Data branch head: `6b167615` (performance-snapshot). Manifest:
`data/_manifest.json`, 15 components, 43 files. Both deploys live:
snapshot `2f64a2ed` (42/42 bytes, tag `data-2026-10-31-1`) and
snapshot `6b167615` (43/43 bytes, tag `data-2026-10-31-2`).

| Component | asof | Data commit | Files | Note |
|---|---|---|---|---|
| contributors | 2026-10-30 | `ca4eb9a9` | 2 | History: exactly one Oct-30 entry appended; Oct-29 gap pre-existing, migrated as-is |
| sector-rotation | 2026-10-30 | `3684bd39` | 3 | |
| sim-benchmarks | 2026-10-30 | `2d2fb616` | 1 | Generated 2026-10-30 19:30 NPT; rows run to 2026-10-30 |
| reports-archive | 2026-10-29 | `1c5a85c0` | 1 | Entry session_date 2026-10-29; its market block IS the Oct-30 close (2690.15 / −5.45 / 348). asof kept at the file's own date |
| price-push | 2026-10-30 | `e436a4dc` | 9 | 7 windows + history + manifest |
| broker-zero-sum | 2026-10-30 | `efabc648` | 8 | 7 windows + history |
| broker-smart-money | 2026-10-30 | `3e9d11fe` | 2 | WT untracked `badge-qa/` dirt NOT migrated |
| smart-money-eps | 2026-10-29 | `3fc5c9c2` | 2 | Board asof stays 2026-10-29 (eps_asof 2026-09-30, Q4 FY82/83); Oct-30 run changed 2 lines vs main; label question flagged, not relabeled |
| sector-symbol | 2026-10-30 | `7ed72f52` | 3 | |
| money-flow | 2026-10-30 | `22727982` | 1 | Current board only; archive/cohorts NOT updated by the Oct-30 run (archive last 2026-10-29) — builder-side gap, not fabricated |
| sector-price-rotation | 2026-10-30 | `5d2d32a5` | 3 | |
| sector-seasonality | 2026-10-30 | `1f36c847` | 2 | Keystone update sector-strength waits on — satisfied on the data branch |
| vpi | 2026-10-30 | `b484ff40` | 1 | FINAL board, 279 symbols; archive/cohorts untouched by design |
| technical-signals | 2026-10-30 | `b67894e4` | 4 | |
| performance-snapshot | 2026-10-30 | `6b167615` | 1 | `nepse-chart/data/performance.json`: the job's own stalled payload (Oct-30 23:41 build, 346 symbols, blob `ff84f9da` == WT-perf HEAD file byte-for-byte), replacing main's stale Oct-29 23:41 version. Job state files NOT touched (job owns them); collector `deploy()` reroute to the data-branch writer is Monday-critical (else Monday's in-window run re-opens a PR and the flood resumes). Saturday/Sunday runs are archive-only (non-trading days), so no new perf PRs before Monday 11:00 NPT |

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
| #237 pr-flow-deploy PUT fix | DONE (merged 2026-10-31) | Changes `tools/pr-flow-deploy.py:598` POST→PUT + docstring/comments. All 5 required checks green on head `e0a33806`. Merge commit `e96fb92d` via PUT (first attempt, 200); main tree `b74b7f52` == PR head tree exactly. PROVENANCE VERIFIED 2026-10-31: PR timeline events are only closed/commented/committed/merged — NO `auto_merge_enabled` event; merged 2026-10-30T23:37:07Z by ShirjanKhadka1 = the direct API PUT, NOT auto-merge. Consequence: the fixed HELPER binary's PUT merge path is still unproven (helper runs 1–2 never reached merge: run 1 poller died silently; run 2 died on the empty-diff tree-POST 422). Proof vehicle: THIS program-status PR, merged through the fixed helper end-to-end (creation + poll + PUT merge); its log carries the merge PUT request ID. Duplicate-push guard: check the branch tree before any helper re-run |
| #169, #173, #183, #186, #187 | OPEN — DO NOT HAND-MERGE | Stop rule from the 2026-10-31 04:50 order; parent sequences. NOTE: #173 is ALSO a perf PR (head `deploy/performance-snapshot-20261030-1411`, 13:41 snapshot) — see backlog row; its close needs an explicit parent call, not a blanket one |
| #235 midnight rollover 2026-10-31 | OPEN — DO NOT MERGE, DO NOT CLOSE | Recommendation: close as superseded once P2 proves the rollover path |
| #208 post-close sweep signals | OPEN | Likely superseded by #214/#223 absorption; diff-vs-main verification owed before any disposition (parent call) |
| 40 performance-snapshot PRs (#161–#236, all created 2026-10-30) | OPEN — RECOMMENDATION ONLY, NO MASS-CLOSE | One PR per hourly run (incl. stalled pickups), each running CI that mails on failure — this is the inbox flood. All carry Oct-30 snapshots superseded by the single data-branch landing (Oct-30 23:41, `6b167615`) + the publish workflow (no PR per run). RECOMMENDATION (parent confirmation required): close all 40 as superseded by the data-branch path with a standard comment, #173 called out by name for its explicit confirmation (STOP-protected). Closing stops NEW CI mail; already-sent mail cannot be unsent. The job's own reroute (collector `deploy()` → data-branch writer) must land before Monday 11:00 NPT or the flood resumes |

## Stamp-only PR inventory (P1b item 4)

Swept all 59 open PRs (2026-10-31): 7 excluded (6 stop-rule + #237),
52 reviewed, **0 stamp-only**. Nothing to close under this item.
Method note: the first sweep misflagged #197 (broker matching) —
GitHub omits patches for large files, and a missing patch was
wrongly read as "no data lines". Fixed (missing patch =
unclassifiable = not stamp-only) and re-run: 0 flagged. #197 is a
data PR, not a stamp PR.

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
  `data-YYYY-MM-DD-N` on the deployed snapshot). First live tag
  comes post-flip. The Oct-30 REVIEW flag (daily 347 vs floorsheet
  348 vs monthly 342) and the `data-2026-10-28-1` baseline gap are
  parent-owned resolutions, not closed by this workflow.
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
7. PROGRAM-STATUS lands in the repo (`ops/PROGRAM-STATUS.md` via
   PR merged through the FIXED HELPER — the helper-PUT proof;
   auto-merge now enabled, B1 flipped, but this PR proves the
   helper path per the parent's order). Helper run LAUNCHED
   2026-10-31 (branch `deploy/program-status-20261031`); merge
   PUT request ID lands in its log.
8. Owner adds B3 secrets → next data push goes fully green
   (deploy + purge + live-verify + workflow tag).
9. Reroute the 15 publishers' `run-*.sh` scripts + the perf
   collector's `deploy()` to the data-branch path (Monday runs
   need the new path; perf reroute is flood-critical).
8. Monday 2026-11-02 10:45 NPT deadline: every publisher lands
   without manual merging; live tape moves past the Oct-30 close;
   Monday evening finals show Nov 2.

## Out of scope for this lane (parent/other lanes)

Bearish-pattern Buy classification (user item 6); SBLPNP/MBLPNP
typed-instrument decision (item 7); Capital Max one-step re-login
alert + STALE badge (item 8); naming the Oct-30 REVIEW missing
symbol + tagging the baseline (item 5 beyond the tag-step design).
