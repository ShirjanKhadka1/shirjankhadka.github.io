# Retention roll — runbook (Phase A)

The rolling data window: HOT (the `data` branch + live site) keeps the
last `window_years` of each in-scope dataset plus a `buffer_years`
warm-up tail; older rows move to COLD and leave HOT. Nothing here
deletes anything that is not already verified in COLD first.

## COLD store: an orphan `cold` branch in the same repo

R2 is OPTIONAL scale-out, not a gate. R2 activation genuinely needs a
payment method at checkout even for free-tier usage, and no card is on
file — so COLD lives on an orphan `cold` branch in the site repo
instead. That needs nothing new: no card, no new service, no
token-scope change, no new secrets (GITHUB_TOKEN contents:write
already covers it). Publish never checks out `cold`, so the 800 MB
Pages guard is unaffected. GitHub's file cap is 100 MB (monthly
Parquet partitions are KB-to-MB scale); repo guidance is under 1 GB
recommended / strongly under 5 GB vs 471 MB today, and Parquet
compression means years of headroom — cold-branch size is tracked on
/status alongside repo and data-branch size (a Phase 0 item).

Layout ON the cold branch (branch-relative paths):

- `README.md` — what the branch is, layout, restore procedure.
- `manifest.json` — the REAL cold manifest (version, generated_at,
  per-dataset partitions with path, rows, SHA-256, window_start,
  asof). The manifest is the checkpoint for idempotency and
  resumability (below).
- `<dataset>/<year>/<month>.parquet` — real cold partitions.
- `_simulation/` — GATE A simulation material ONLY (synthetic rows,
  never real data, never in the real manifest).

If the repo ever outgrows comfort, the fallbacks — in order — are
Backblaze B2 (10 GB free, no card required) and then R2, both with
the SAME layout and manifest shape: zero redesign.

## Window math — RESOLVED by user decision 2026-10-31

```
window_start(D) = first trading session on/after (D - window_years)
```

Feb 29 safe: D - window_years clamps Feb 29 to Feb 28, then scans
forward. Trading sessions are regime-aware: Sun–Thu before
2026-04-06, Mon–Fri from 2026-04-06 onward, skipping dates listed as
closed in the holidays file (`tools/nepse-holidays.json` on main;
`--holidays` overrides it; `nepse-holidays.txt` format is also
accepted). NOTE: that file's own comment marks its per-date entries
unverified — the roll logs which holidays it applied, and a real
session (evidence) always wins over the file.

**RESOLVED (user decision 2026-10-31): window_years=3 is CONFIRMED**
(window starts 2023-10-31 on 2026-10-31, 2023-11-01 on 2026-11-01).
The charters' example dates (2024-10-31) were wrong. The earlier
"discrepancy flagged" note in this file and the PR body is superseded
by that decision; nothing in the code changes (it already used the
formula).

## Per-dataset actual start (user decision 2026-10-31)

The planner reports `window_start` per dataset as max(formula
window_start, first real date in that dataset's rows). A dataset with
shorter history (e.g. floorsheet/broker since 2026-07-15) therefore
starts at its first real date. The plan/extract output carries all
three values: `window_start_formula`, `first_date`, and `window_start`
(the EFFECTIVE start). The manifest records the effective start.

**UI contract:** every page must show each dataset's ACTUAL
(effective) start — never the formula date alone. The retention job
computes and reports the effective start per dataset; consuming it on
the pages (the "Data window:" line per component) is a follow-up for
the page builders, listed below. Until then, the plan output is the
source of truth for a dataset's actual start.

## Phase B gate (user decision 2026-10-31, HARD, fail safe)

Live mode rolls ONLY datasets whose `config/retention.yaml` entry is
explicitly marked `phase_b: allowed`. The workflow enforces this with
the `phase-b-gate` step (live mode only, so dry-run previews still
work for any tabled dataset). All three tabled datasets are currently
`phase_b: pending` — so live mode presently refuses all of them, by
design. **No live roll or cron until GATE A (including the restore
test) AND Phase B licensing allow archiving EACH dataset.** Flip a
dataset to `allowed` only when Phase B licensing permits archiving
it, per the source matrix. Cron stays OUT of this job regardless.

## Cold-storage trigger: 2 GB (user decision 2026-10-31)

If the repo size passes `cold_storage_trigger_gb` (2 GB, set in
`config/retention.yaml`), cold-branch writes STOP: the workflow's
live-mode repo-size guard (which reads the GitHub API's repo `size`
field in KB and compares it to the trigger) fails the run with
"migrate cold storage to R2/B2" before any cold push. The migration
itself is a follow-up, not this job; repo-size tracking on /status is
a separate follow-up. Current repo size (2026-10-31, API): 482,451 KB
(471.1 MB) — about 1.6 GB of headroom to the trigger.

Row buckets (per dataset; see `ops/retention.py`):

- `expiring`: date < threshold — moves to COLD.
- `buffer_kept`: threshold <= date < window_start — stays in HOT
  (indicator warm-up tail). Only for roll_rule `window_minus_buffer`.
- `retained`: date >= window_start — stays in HOT, displayed window.

where threshold = window_start - buffer_years for
`window_minus_buffer`, else threshold = window_start.

## Datasets in scope (the whole table — everything else is out)

| dataset | HOT path | shape / date field | roll rule | builder window-aware |
|---|---|---|---|---|
| index-history | data/index-history.json | rows array, element 0 = YYYYMMDD int | window_minus_buffer | unknown — CONFIRM before any live roll |
| contributors-history | data/contributors-history.json | entries list, `asof` | window | true (append-only; file's own note: entries never edited, same-day rebuild replaces only that day's entry) |
| sector-rotation-history | data/sector-rotation-history.json | entries list, `date` | window | true (file declares `append_only: true`) |

Every other dataset is OUT OF SCOPE until added to
`config/retention.yaml` with its shape, date field, roll rule, and a
builder-window-aware confirmation. Live mode REFUSES any dataset not
in the table (`ops/retention.py` exits non-zero).

**Pruning stickiness (read before rolling a dataset).** A roll's HOT
pruning sticks only if the dataset's owning builder applies the same
window or builds incrementally from the data-branch file. An
append-only builder (contributors, sector-rotation) is safe by
construction. A builder that rebuilds full history from source
archives (index-history's builder is unconfirmed) would RESTORE pruned
rows on its next run — so index-history must NOT roll live until its
builder is confirmed window-aware. The roll job proves the MECHANISM;
landing a dataset needs its builder confirmed first.

**Exemptions (never rolled, never pruned):** the prediction ledger
(forward-tracking entries), CA/dividend adjustment factors, and the
1-year indicator warm-up buffer (which is why `window_minus_buffer`
datasets keep an extra year in HOT).

## How to run

The workflow (`.github/workflows/retention-roll.yml`) is DISPATCH
ONLY — no cron in this PR. Dispatch from the GitHub UI (Actions →
Retention roll → Run workflow) until the token gains Actions write;
the parent token currently cannot dispatch via API (403), which is a
recorded follow-up, not a workaround target.

Inputs: `dry_run` (boolean, default true), `asof` (YYYY-MM-DD,
default today NPT), `dataset` (default `index-history`).

- **Dry run (default):** computes the plan, extracts kept + expiring
  months, writes Parquet locally, verifies every partition locally
  (decode + row count + SHA-256), builds the manifest locally — and
  pushes NOTHING. This is the safe way to preview any roll.
- **Live run (`dry_run=false`):** session-guard first (refuses a
  trading day before 16:00 NPT, and any future roll date), Phase B
  gate (refuses any dataset not marked `phase_b: allowed`), repo-size
  guard (refuses if the repo passed 2 GB), then the roll safety
  sequence below, then stops and reports. It does NOT
  dispatch Publish itself.

## Roll safety sequence (live mode, enforced by the workflow)

0. Guards: session guard, Phase B gate, repo-size guard (all fail
   the run before any write if tripped).
1. Snapshot: the dataset file is fetched read-only from the `data`
   branch; the plan is computed and printed.
2. Write COLD: expiring rows are split by month, converted to
   Parquet, recorded in the cold manifest, and pushed to `cold` via
   `tools/cold-branch-writer.py` (blobs -> tree -> commit ->
   lease-checked fast-forward ref update, rebase-and-retry, never
   force-push).
3. Verify counts/checksums: every partition is decoded locally and
   matched against its manifest entry.
4. Restore-test a sample: the FIRST partition is downloaded back from
   `cold` via the API, decoded, and matched on rows + SHA-256. If
   this fails, the run STOPS — HOT is untouched.
5. Only then remove from HOT: the kept file (buffer + retained rows)
   is pushed to the `data` branch via the same writer (dataset file
   ONLY — the roll never writes `data/_manifest.json`, because it
   owns no component).
6. Publish: a `data`-branch push auto-triggers Publish (see below).
7. Verify: watch the Publish run, then verify live pages show the
   new window start. A roll is not done until live bytes prove it.

## Idempotency and resumability

The cold manifest is the checkpoint. Re-adding an identical partition
(same path, rows, SHA-256) is a no-op (`already-present`). Re-adding
the same path with different rows or SHA-256 is REFUSED (never
silently overwritten). The writer retries on head-moves
(rebase-and-retry) and never force-pushes. Re-running a roll for a
date whose months are already in the manifest therefore converges
instead of duplicating. If a run dies mid-sequence, the next run
recomputes the plan from the current HOT file and the manifest: months
already in COLD are skipped, months not yet written are written, and
HOT is pruned only after the restore test passes.

## Never during a session

Live rolls run nightly after FINAL only. The workflow's session-guard
step enforces it: a roll date of today on a trading day before 16:00
NPT is refused, as is any future roll date. Dry runs are exempt (they
push nothing).

## Publish trigger finding (verified 2026-10-31)

`publish.yml` triggers on `push: branches: [data]` AND the data branch
carries `publish.yml` (blob `adfdd2d2`, identical to main's). So a
data-branch push auto-triggers Publish — no workflow dispatch is
needed for the roll's Publish step, and the token's lack of Actions
write does NOT block it. Caveat: the push-triggered run uses the DATA
branch's copy of `publish.yml` — if main's copy changes, sync it to
`data` before relying on the push trigger again.

## GATE A simulation report (actually run 2026-10-31, not just written)

**Cold branch creation.** `cold` was created as a TRUE orphan via the
API: root commit `6983eefe0b1cb0b6d923a9037dd486777c85a703` with NO
parents, tree `8c468e9c679f0247e6fe0af7c51125bc90b3136f`, containing
only `README.md` (blob `0eb998c2`) + `manifest.json` (blob `ddd07219`,
empty datasets). After the simulation push, head is
`9c80c8f32a5875a434ad86fbbba58db8c50bd139` (parent = the orphan root),
and the tree holds the root files plus `_simulation/` only — the real
manifest was not touched.

**Window math (3-year default, proven by executed runs).**
2026-10-31 → raw 2023-10-31 (Tuesday) → window_start 2023-10-31.
2026-11-01 → raw 2023-11-01 (Wednesday) → window_start 2023-11-01.
No holidays applied (neither boundary date is in
`tools/nepse-holidays.json`, 25 closed entries). Edge cases proven:
2028-02-29 → raw clamped 2025-02-28 (Friday, non-trading under the
pre-2026-04-06 Sun–Thu regime) → window_start 2025-03-02 (Sunday).
2026-04-03 → raw 2023-04-03 (Monday) → window_start 2023-04-03.
Note on the per-dataset actual-start rule (user decision 2026-10-31):
the simulation is unaffected — its synthetic first date (2023-10-30)
precedes both formula windows, so effective start = formula window
for both dates, and the transition row is still 2023-10-31.

**Simulation partitions** (synthetic rows shaped like index-history
dicts, under `_simulation/gate-a-2026-10-31/`, 5 rows total):

- `index-history/2023/10.parquet` — 2 rows (2023-10-30, 2023-10-31),
  SHA-256 `441758e9c6ba163e5cb58f7016217348f194afd1d7d333db1f07b9e66470946e`
- `index-history/2023/11.parquet` — 1 row (2023-11-01),
  SHA-256 `ec57978c13f83f6859f8dbd7a45a3a1848cbd91b1d5fd5ecc1a79f740b658869`
- `index-history/2024/10.parquet` — 1 row (2024-10-31),
  SHA-256 `23f238b7fe999e968db31a5a2ac05a7889050adaf3fe3a8fe7e4547805e01a12`
- `index-history/2026/10.parquet` — 1 row (2026-10-30),
  SHA-256 `759c950f6c2a42f1ce96200bb037dfe27ca8fd3ff93fd0ba4d5fd65c97bd00b9`

Row classification (rule `window`): 2023-10-30 expired under BOTH
windows (control); **2023-10-31 retained under the 2026-10-31 window
and expiring under the 2026-11-01 window — the transition row**;
2023-11-01, 2024-10-31, 2026-10-30 retained under both (controls).
The simulation manifest (`_simulation/manifest.json`) records all of
this; it never enters the real manifest.

**Restore test (the proof).** The 2023/10 partition was downloaded
back from `cold` via the API (1,947 bytes), decoded with pyarrow
26.0.0, and verified: downloaded SHA-256
`441758e9…66470946e` == manifest SHA-256 (match), rows 2 ==
manifest rows 2 (match). The restore path is proven end to end.

**Read-only real-data plan** (no writes; `data/index-history.json`
from the data branch, asof 2026-11-01, rule `window_minus_buffer`):
total 5,353 rows; expiring 4,442 (2003-07-17 → 2022-10-31);
buffer_kept 232 (2022-11-01 → 2023-10-31); retained 679
(2023-11-01 → 2026-10-30); threshold 2022-11-01. The extract step
produced 231 expiring month files and a kept file of 911 rows
(2022-11-01 → 2026-10-30). The first real roll of this dataset would
therefore write 231 monthly partitions — later rolls write ~1 month
per dataset per night.

**Other locally proven behavior.** Config subset-parser (against the
real `retention.yaml`, including the Feb-29/regime cases above);
unknown-dataset refusal (non-zero exit, names the fix); session guard
(past session day OK, future date refused exit 2); Parquet
write/check (including a deliberately wrong expected row count, which
the check correctly rejected — the check bites); manifest add /
already-present no-op / conflict refusal on both rows and SHA-256;
cold-branch-writer pre-flight validation (unsafe path, missing file,
invalid JSON all fail before any API call; a valid map with a dummy
token fails only at API auth).

**Explicitly NOT done by this simulation: NO live roll has happened
and no HOT data has moved.** The data branch head is unchanged, the
live site is unchanged, and the only branches touched are `cold`
(new) and the PR branch for this job. The simulation proves the
machinery; the first live roll still needs its own dispatch, its own
restore test, and its own live-byte verification.

## Open follow-ups (in order)

1. **Cron enablement** — add the nightly-after-FINAL schedule to
   `retention-roll.yml` AFTER a dispatched dry run passes on main
   AND Phase B licensing allows archiving each dataset (this PR is
   dispatch-only by design, and the Phase B gate refuses live mode
   until then).
2. **Full dataset table** — every remaining dataset needs its shape,
   date field, roll rule, and builder-window-aware confirmation before
   it enters `config/retention.yaml`.
3. **index-history builder confirmation** — its window-awareness is
   unknown; no live roll of it until confirmed (see stickiness above).
4. **Phase B flips** — each dataset's `phase_b` moves from `pending`
   to `allowed` only when Phase B licensing permits archiving it, per
   the source matrix. Until then live mode refuses it.
5. **UI actual-start consumption** — pages must show each dataset's
   effective (actual) start from the plan output; the retention job
   computes it, the page builders consume it.
6. **Cold-storage migration (on trigger)** — when the repo-size guard
   trips (repo past 2 GB), migrate cold storage to R2/B2 with the
   same layout and manifest shape. Repo-size tracking on /status is
   a separate follow-up.
7. **Writer GITHUB_TOKEN path** — the writer script authenticates
   with GITHUB_TOKEN, which exists only in Actions; its API sequence
   is proven here via the surrogate-authenticated equivalent, but the
   literal GITHUB_TOKEN path is first exercised on the first live
   dispatch (dry-run default protects against accidents).
8. **Token Actions write** — needed for API dispatch of this workflow
   (and Publish); until then, dispatch from the GitHub UI. Owner-UI
   action; the roll does not work around it.
