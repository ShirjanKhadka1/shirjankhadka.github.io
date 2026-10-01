# DRY_RUN Post-Merge Rollout Plan

**Default:** All workflows run in dry-run mode unless the repo variable
`DRY_RUN` is explicitly set to the string `false`.

## Timeline

### Friday after 15:30 NPT — Merge
- [ ] Shirjan creates repo variable `DRY_RUN=true`
      (Settings → Secrets and variables → Actions → Variables).
- [ ] Merge PR #37 after 15:30 NPT (market closed, no pipeline pressure).

### Saturday — Manual dry-run dispatch
- [ ] Manually dispatch `nepse-market-close.yml` via workflow_dispatch
      with `dry_run=true`.
- [ ] Check the run logs: confirm "DRY RUN" mode, data fetched and
      validated, **no commit created, no deployment**.
- [ ] Verify `/status/` reflects dry-run state.

### Monday before 15:20 NPT — Go live
- [ ] **Only with Shirjan's explicit approval:** change `DRY_RUN` to `false`.
- [ ] Observe the 15:20 NPT scheduled run: confirm it fetches, validates,
      commits, tags `data-YYYY-MM-DD-N`, and deploys.
- [ ] Verify: manifest `session_date` = today; new data tag exists;
      `/status/` shows LIVE; no alert email.

### Monday 17:15 NPT — Freshness watch
- The `nepse-freshness-watch.yml` runs at 17:15 Mon–Fri.
- **If the DRY_RUN flip is delayed:** the watch will detect stale data
  (no fresh deploy happened) and **email an alert**.
  This is the safety net — a missed flip cannot go unnoticed.

## Dry-run behavior by workflow

| Workflow | Dry-run behavior |
|----------|-----------------|
| `nepse-market-close.yml` | Fetches + validates; **no commit, no tag, no push**. Logs "DRY RUN". |
| `nepse-intraday-floorsheet.yml` | Fetches floorsheet; **no commit, no push**. Data discarded. |
| `nepse-live-quotes.yml` | Fetches quotes; **no commit, no push**. Data discarded. |
| `nepse-content.yml` | Builds content; **no commit, no push**. |
| `nepse-freshness-watch.yml` | Always live (checks the site, not the branch). Not affected by DRY_RUN. |

During dry-run, **no workflow writes to the repo**. The site serves the
last deployed data until the first live run.

## Emergency procedures

**Stop deploys:** Set `DRY_RUN=true` (or delete the variable).
The next scheduled run will be dry-run. No code change needed.

**Rollback data:** Run `nepse-market-close.yml` with `rollback_to_tag`
set to the previous good `data-*` tag. The tag format is validated:
`^data-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$`.
