# Nepse Decode — Pipeline Runbook (Phase 1)

## Architecture
Static site on GitHub Pages. All market data lives as JSON under
`nepse-chart/data/`. GitHub Actions rebuild the JSON, validate it, and push
to `main`. No server, no database.

## Schedule (NEPSE trades Mon–Fri, 11:00–15:00 NPT)

| Job | Workflow | Cron (UTC) | NPT | What it does |
|---|---|---|---|---|
| Market close | `nepse-market-close.yml` | `35 9`, `25 10`, `15 11` `* * 1-5` | 15:20 / 16:10 / 17:00 Mon–Fri | full data rebuild → manifest → **validate** → atomic commit + `data-YYYY-MM-DD-N` tag |
| Content | `nepse-content.yml` | `15 0`, `15 12 * * *` | 06:00 / 18:00 daily | news, announcements, corporate actions, sitemap + staleness sentinel |
| Freshness watch | `nepse-freshness-watch.yml` | `30 11 * * 1-5` | 17:15 Mon–Fri | dead-man's-switch: checks the LIVE site's manifest; emails if stale even when no pipeline ran |
| Live quotes | `nepse-live-quotes.yml` | every 15 min (existing) | market hours | intraday quote snapshot |
| Floorsheet | `nepse-intraday-floorsheet.yml` | every 5 min (existing) | market hours | intraday floorsheet |
| CI quality | `ci.yml` | push/PR + `0 1 * * *` | — | Playwright smoke + axe ratchet + link check + Lighthouse (3 runs/page, median) + gitleaks |

Retries at 16:10/17:00 run the market-close build again; an idempotency
check skips them if the session already deployed successfully.

## The validation gate (hard — blocks deploy)
`tools/validate-build.js` runs after every market-close and content build.
Any failed gate → data is NOT committed; only `jobs.json` + `validation.json`
are pushed, and a failure alert fires. Gates:

1. manifest present · 2. live session == expected trading-day session
3. universe session == expected · 4. quote count within ±5% of last build
5. no duplicate symbols · 6. LTP/OHLC sane · 7. no dup universe symbols
8–10. signals (momentum/trend-relay/reversal) current · 11. all manifest files parse

Results are public at `/status/` (jobs, gates, market state).

## Freshness model
- `data/manifest.json` — canonical build contract: `generated_at_npt`,
  `session_date`, `market_state`, `is_holiday_closure`, `build_commit`,
  per-file rows/bytes/full-SHA-256, embedded job status. File keys are
  repo-relative (e.g. `nepse-chart/data/live.json`).
- `nepse-chart/data/manifest.json` — legacy copy, generated at build time by
  `tools/build-manifest.js` for cached clients, then removed after one
  release. Marked deprecated INSIDE the file (`"_deprecated": true` +
  `"_deprecated_note"`); no new readers. Readers try the canonical path first.
- `js/freshness-badge.js` — shared badge on the 9 data pages; reads
  `/data/manifest.json` client-side and shows LIVE / as-of / stale states.
  Pages never show a hardcoded session date (injected by
  `tools/prerender-freshness.js`).
- The badge counts weekdays only for "sessions behind" (holiday-aware
  refinement is a Phase 2 item).

## Alerts (email — never Facebook)
Pipeline failures alert the owner by **email** via an explicit SMTP step
(`dawidd6/action-send-mail`, pinned to commit SHA `4226df7daafa6fc901a43789c49bf7ab309066e7`)
through Brevo's free SMTP relay (`smtp-relay.brevo.com:587`, STARTTLS),
plus a readable GitHub Actions job summary. Failures are NEVER posted to
Facebook. Needs three repo secrets:

- `MAIL_USERNAME` — the Gmail address the mail is sent from (must be a
  verified sender in Brevo)
- `MAIL_PASSWORD` — the Brevo **SMTP key** (Brevo dashboard → Settings →
  SMTP & API → SMTP keys; not the Brevo login password)
- `ALERT_EMAIL_TO` — where alerts go

Add at: repo → Settings → Secrets and variables → Actions → New repository secret.
Subject format: `[NEPSE ALERT] <job>: <what failed / which page is stale>`.

### Brevo setup (one-time, free tier)
1. Sign up at brevo.com with the Gmail address that will send the alerts.
2. Verify that same Gmail address as a sender: Brevo → Settings → Senders,
   add it and click the verification link.
3. Create an SMTP key: Settings → SMTP & API → generate a key, copy it.
4. Add the three repo secrets above (`MAIL_USERNAME` = the Gmail address,
   `MAIL_PASSWORD` = the SMTP key).
5. The free tier allows 300 emails/day — far above the handful of failure
   alerts these pipelines can generate.

Fires on: market-close validation failure (after auto-rollback), content
validation failure, stale data (>1 trading day behind, from the content
sentinel or the 17:15 NPT dead-man's-switch), intraday/live workflow errors.

**Not a failure — `[NEPSE NOTICE]`:** if the market-close pipeline finds no
new session at the source after the final retry (17:00 NPT), the day is
treated as **market closed** (likely an unlisted public holiday missing from
the calendar) and a LOW-PRIORITY notice email goes out with the subject
`[NEPSE NOTICE] market-close: no new session for <date> — treated as market
closed`. It is never `[NEPSE ALERT]` and never a failure alert: nothing is
deployed, the job is recorded as `skipped`, and the manifest's
`session_date` is pinned to the last real session so the dead-man's-switch
stays honest. Earlier retries (15:20 / 16:10) end quietly in this case —
slow NEPSE publishing never raises a false alarm.

The 17:15 NPT freshness watch runs even when no pipeline ran — it catches the
case where a scheduled job silently never started.

## Rollback
Every successful market-close deploy tags `data-YYYY-MM-DD-N`.

- **Automatic:** if validation fails, the workflow restores `nepse-chart/data/`
  + `data/` from the most recent `data-*` tag, commits, pushes, records the
  failure, and emails `[NEPSE ALERT] market-close: validation failed …,
  auto-rolled back to <tag>`. The system acts before the owner has to.
- **Manual:** Actions → "NEPSE market-close pipeline" → Run workflow →
  fill `rollback_to_tag` (must match `data-YYYY-MM-DD-N`, validated).
  The data files are restored from the tag, committed, pushed, and recorded.

## Holiday calendar
`tools/nepse-holidays.json` + `tools/trading-days.js` — Mon–Fri trading days,
Sat/Sun closed, market hours 11:00–15:00 NPT. ⚠️ EVERY Oct–Dec 2026 entry is
marked `"status": "unverified"` — the dates were assembled from public
lists, NOT verified against an official NEPSE/government calendar, and no
dates were guessed. The owner will supply official holiday notices.
`tools/check-freshness.js` and `tools/trading-days.js` are holiday-aware
(expected-session and behind-day counting skip listed holidays).
Missing-holiday handling: the calendar is fail-open for builds (an unlisted
day is treated as a trading day, so data is never silently suppressed), and
if no new session appears after the final retry the day is treated as
market closed with a low-priority `[NEPSE NOTICE]` email — never a failure
alert. If the market stays closed for a day, add the official date to
`tools/nepse-holidays.json` promptly so the dead-man's-switch keeps
counting behind-days correctly.

## CI (Phase 1 — honest gates)
`ci.yml` runs on push to main, on PRs, and nightly:
Playwright smoke tests (HTTP 200s, zero console/page/network errors, no
residual "Loading…", no horizontal overflow at 320–1920px, SSR dates vs the
manifest), the axe ratchet (fails on any NEW violation vs the Phase 0
baseline in `tests/axe-baseline.json`), the internal link checker (zero
broken links), visual regression on 8 key pages (desktop + mobile
baselines), Lighthouse mobile (no `--preset` flag — mobile is the v12
default; 3 runs per URL, median reported), and a gitleaks full-history scan.

No `|| true` anywhere: tool failures fail CI. Lighthouse budgets stay
**warn-level** for the baseline (numbers in artifacts); everything else is a
hard gate. The raw Lighthouse CLI is used in Phase 1; migrating to LHCI is
planned for Phase 2 CI hardening (after this PR merges) — budgets move to
error-level only after the owner approves the Phase 1 baseline numbers.
Visual baselines regenerate intentionally only, via the
`update_snapshots` dispatch input — never blind-update.

## Manual checklist for the owner
- [ ] Add `MAIL_USERNAME` + `MAIL_PASSWORD` (Brevo SMTP key) + `ALERT_EMAIL_TO` repo secrets (failure emails are silent without them)
- [ ] Verify Oct–Dec 2026 holidays against the official calendar; update `tools/nepse-holidays.json`
- [ ] Review CI baseline numbers from the first green run; approve tightening Lighthouse budgets to error
- [ ] Confirm the daily finance-blog cron still deploys from its own working tree (it can carry unrelated changes)
