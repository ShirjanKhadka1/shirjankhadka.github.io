# Phase 2 Staging-Branch Model — Design

**Goal:** Enable "require pull request" branch protection on `main` without breaking
the pipeline's need to commit automatically.

**Current (Phase 1):** Workflows commit directly to `main`.
- Branch protection on `main`: **no-force-push** + **no-deletion** only (Shirjan enables).
- "Require pull request" is OFF because the pipeline needs direct push access.

## Phase 2 Design

### Branches
- `main` — production. Protected: require PR + no-force-push + no-deletion.
- `staging` — pipeline target. Protected: no-force-push + no-deletion (same as main today).
  The pipeline commits here freely, no PR required.

### Workflow changes
1. All data workflows (`nepse-market-close`, `nepse-live-quotes`, `nepse-intraday-floorsheet`,
   `nepse-content`, `nepse-freshness-watch`) change their push target from `main` to `staging`:
   - `git push origin staging` instead of `git push origin main`
   - The `concurrency` groups remain (they prevent overlapping runs).
2. New workflow `promote-staging.yml`:
   - Trigger: `push` to `staging` (or scheduled, e.g. every 30 min).
   - Steps:
     a. Checkout `main` and `staging`.
     b. Create a PR `staging` → `main` (via `gh pr create`, or update existing open PR).
     c. If CI passes on the PR, auto-merge (squash or merge commit).
   - Alternatively: manual promotion — Shirjan merges the staging PR when ready.

### Why this works
- The pipeline never needs PR approval; it pushes to `staging` freely.
- `main` gets full PR protection: every change is reviewed (by CI, and optionally by Shirjan).
- The promotion PR gives a single, auditable gate for production deploys.
- Rollback: revert the promotion merge on `main`, or fast-forward `main` to the previous
  promotion commit (no-force-push still allows revert commits).

### Migration steps (Phase 2 PR)
1. Create `staging` branch from `main`.
2. Update the 5 data workflows to push to `staging`.
3. Add `promote-staging.yml`.
4. Merge Phase 2 PR.
5. Shirjan enables "require pull request" on `main` (keep no-force-push + no-deletion).
6. Verify: trigger a dry-run workflow, confirm it pushes to `staging`, confirm promotion PR opens.

### Rollback
- If promotion breaks: disable `promote-staging.yml`, revert workflows to push to `main`,
  disable "require PR" on `main`. The site stays up because `main` is untouched until promotion.
