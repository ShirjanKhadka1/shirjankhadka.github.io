# DRY_RUN Post-Merge Rollout Plan

**Current state:** All workflows default to `DRY_RUN=true` (fail-safe). The repo variable
`DRY_RUN` does not exist yet; the expression `${{ vars.DRY_RUN != 'false' }}` evaluates
to true when the variable is missing.

## Phase 1: Merge (DRY_RUN=true)
- [ ] Shirjan creates repo variable `DRY_RUN=true` (Settings → Secrets and variables → Actions → Variables).
- [ ] Merge PR #37.
- [ ] First scheduled market-close run executes in dry-run mode:
  - Data is fetched and validated.
  - No commit is made. No deployment occurs.
  - Logs show "DRY RUN" mode.
- [ ] Shirjan reviews the dry-run logs and confirms the pipeline behaves correctly.

## Phase 2: Validation (1-2 weeks, DRY_RUN=true)
- [ ] Monitor daily market-close runs (dry-run).
- [ ] Verify Gmail alerts arrive for failures (if any).
- [ ] Confirm no unintended commits or deployments.
- [ ] Check `/status/` page reflects dry-run status.

## Phase 3: Go live (DRY_RUN=false)
**Only when Shirjan explicitly approves.**

- [ ] Shirjan changes repo variable `DRY_RUN` to `false` (Settings → Secrets and variables → Actions → Variables).
  - **Do NOT delete the variable.** Set it to the string `false`.
  - The workflow expression `${{ vars.DRY_RUN != 'false' }}` will then evaluate to false.
- [ ] Next scheduled run will commit and deploy for real.
- [ ] Monitor the first live run closely.

## Emergency: Revert to dry-run
If anything goes wrong after going live:
1. Set `DRY_RUN` back to `true` (or delete the variable — missing defaults to dry-run).
2. The next scheduled run will be dry-run again.
3. No code change needed. No PR needed.

## Why this is safe
- The default is dry-run. You must take explicit action to go live.
- The variable is a simple string comparison. No complex logic.
- Reverting is instant (variable change, no deploy).
- All proofs were done in dry-run mode.
