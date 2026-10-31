# COLD archive branch (`cold`)

This branch is the COLD tier of the NEPSE Decode rolling data window
(Phase A). It is an ORPHAN branch: its root commit has no parents and
it shares no history with `main` or `data`. That is deliberate — COLD
is never checked out by the Publish workflow, so it never affects the
Pages artifact or the 800 MB guard.

## Layout (branch-relative paths)

- `README.md` — this file.
- `manifest.json` — the REAL cold manifest: version, generated_at,
  and per-dataset partition lists. Each partition records its path,
  row count, SHA-256, window_start, and asof. The manifest is the
  checkpoint that makes rolls idempotent and resumable: re-adding an
  identical partition is a no-op; a conflicting re-add is refused.
- `<dataset>/<year>/<month>.parquet` — real cold partitions, one
  Parquet file per dataset-month, written by the retention-roll
  workflow (`.github/workflows/retention-roll.yml` on main).
- `_simulation/` — GATE A simulation material ONLY. Synthetic rows,
  never real data, never in the real manifest. Kept as the permanent
  record that the machinery was proven before any live roll.

## What lives here, and what does not

COLD holds rows that rolled off the 3-year HOT window, in the exact
partitioning the charter specified (dataset/year/month) — only the
store changed: this branch replaces R2 (no card, no new service, no
token change). R2 remains an optional future scale-out with the same
layout and manifest shape.

COLD never holds: the prediction ledger, CA/dividend adjustment
factors, or the 1-year indicator warm-up buffer — those are exempt
from rolling and stay in HOT. Whether RAW third-party rows may be
archived at all is governed by the Phase B source matrix, not by this
branch: aggregates only, unless a dataset's licence permits raw rows.

## Restore procedure

1. Download a partition via the API (contents endpoint, `ref=cold`),
   base64-decode it, and recompute its SHA-256.
2. Compare rows + SHA-256 against `manifest.json` (or
   `_simulation/manifest.json` for simulation partitions).
3. Decode with `tools/to_parquet.py check --input <file>
   --expect-rows <manifest rows>` — it exits non-zero on any mismatch.
4. A restore-test sample MUST pass before any HOT removal in a roll
   (the retention-roll workflow enforces this order; see
   `ops/RETENTION.md` on main).

## Rules

- Writers use blobs -> tree -> commit -> lease-checked fast-forward
  ref update, rebase-and-retry, never force-push
  (`tools/cold-branch-writer.py` on main).
- Never push to this branch by hand outside the retention workflow
  or a documented simulation. Never delete history from it: COLD is
  never deleted unless the owner sets a purge policy.
- This branch is not deployed, not assembled, and not read by the
  site. The site reads HOT (`data` branch) only.
