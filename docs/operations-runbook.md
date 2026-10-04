# Nepse Decode Operations Runbook (P4.6)

## Monitors

### Daily Performance (`daily-performance.yml`)
- **When:** 07:00 NPT daily + after market-close deploy
- **What:** Lighthouse (median of 3) on 8 key pages, computes Site Health Score
- **History:** Artifacts retained 90 days (private, never in repo)
- **Health Score:** Weighted: perf 40%, LCP 30%, CLS 15%, TBT 15%

### Uptime Checks (`uptime-checks.yml`)
- **When:** Every 30 min Mon-Fri 11:00-15:00 NPT, hourly otherwise
- **What:** HTTP 200 + latency + content assertion on home, dashboard, screener, status
- **Alert:** Two consecutive failures → email (via GitHub notification)

### CI Quality Gates (`ci.yml`)
- **When:** Every push to main, PRs, nightly
- **What:** Smoke tests (console errors, failed requests), axe a11y, link check, Lighthouse budgets (warn-level)

## Reading the Digest

The daily performance artifact (`lh-daily/site-health.json`) contains:
```json
{
  "date": "2026-10-05",
  "site_health": 78,
  "pages": {
    "home": { "performance": 96, "lcp_ms": 1811, "cls": 0.0, "tbt_ms": 14, "health": 95 },
    ...
  }
}
```

**Trend arrows:** Compare `site_health` with yesterday's artifact. Down >10 = investigate.

## Responding to Alerts

### Performance regression
1. Download today's and yesterday's `site-health.json` artifacts
2. Identify which page(s) regressed and which metric (LCP? TBT?)
3. Check recent commits to that page's CSS/JS
4. If caused by a PR, revert or fix forward

### Uptime failure
1. Check https://shirjankhadka.com.np manually
2. If GitHub Pages is down, check https://www.githubstatus.com
3. If Cloudflare issue, check Cloudflare dashboard
4. Two consecutive failures = real incident, not flake

### CI budget warning
Budgets are warn-level (not error) for one week. If a page exceeds:
- JS >170KB: Check for duplicate library loads
- Fonts >60KB: Verify unicode-range subsets working
- LCP >2s: Check render-blocking resources, image sizes
- TBT >200ms: Profile long tasks, defer non-critical JS

## Adding a Page or Budget

### Add a page to daily perf
Edit `.github/workflows/daily-performance.yml`, add to `PAGES` variable.

### Add a budget
Edit `.github/workflows/ci.yml`, add to the `warns` array in the Lighthouse summary step.
After one week of warn-level, change `::warning::` to `::error::` to enforce.

## Rollback

### Revert a perf PR
```bash
git revert <commit-sha>  # Creates revert commit
# Or via GitHub: PR → Revert button
```

### Rollback a data deploy
The market-close workflow has automatic rollback on validation failure.
Manual rollback: `workflow_dispatch` with `rollback_to_tag` input.

## External Uptime Monitor (Recommended)

GitHub Actions can fail independently of your site. Set up a free external monitor:

**UptimeRobot (free):**
1. Sign up at uptimerobot.com
2. Add monitor: https://shirjankhadka.com.np/ (HTTP(s), 5-min interval)
3. Add monitor: https://shirjankhadka.com.np/nepse-decode/
4. Set alert contacts (email/SMS)

**Better Stack (free tier):**
1. Sign up at betterstack.com
2. Create uptime monitors for key pages
3. Configure incident alerts

These run independently of GitHub Actions.
