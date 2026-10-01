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

- [ ] **Timing:** Flip on a trading day (Mon-Fri) BEFORE 15:20 NPT (before market close).
  This ensures the first live run happens during the next scheduled market-close,
  not immediately.
- [ ] Shirjan changes repo variable `DRY_RUN` to `false` (Settings → Secrets and variables → Actions → Variables).
  - **Do NOT delete the variable.** Set it to the string `false`.
  - The workflow expression `${{ vars.DRY_RUN != 'false' }}` will then evaluate to false.
- [ ] **Verify first real deploy:**
  - [ ] Manifest date: `data/manifest.json` shows today's session date
  - [ ] Data tag: new `data-YYYY-MM-DD-N` tag created (check via `git tag`)
  - [ ] `/status/` page: shows "LIVE" status, not dry-run
  - [ ] No alert: no failure email received (Gmail)
  - [ ] Logs: workflow run shows "LIVE" mode, commit created
- [ ] Monitor the first live run closely.

## Emergency: Rollback
If anything goes wrong after going live:

**Option A — Revert to dry-run (stops future deploys):**
1. Set `DRY_RUN` back to `true` (or delete the variable — missing defaults to dry-run).
2. The next scheduled run will be dry-run again.
3. No code change needed. No PR needed.

**Option B — Rollback data to previous tag (restores last good data):**
1. Identify the previous good data tag: `git tag --list 'data-*' | sort -V | tail -2`
2. Run the rollback workflow: `nepse-market-close.yml` with `rollback_to_tag` input set to the previous tag.
   - The workflow validates the tag format: `^data-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$`
   - It restores the data files from that tag (byte-identical).
3. Verify `/status/` shows the rolled-back session date.

## Why this is safe
- The default is dry-run. You must take explicit action to go live.
- The variable is a simple string comparison. No complex logic.
- Reverting is instant (variable change, no deploy).
- All proofs were done in dry-run mode.
