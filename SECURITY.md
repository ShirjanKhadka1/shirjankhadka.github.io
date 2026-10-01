# Security Policy — shirjankhadka.com.np (Nepse Decode)

## Responsible disclosure

Found a security issue? Email **shirjan.2.khadka@gmail.com** with the subject
`[SECURITY]`. Please include steps to reproduce and do not disclose publicly
until we've had 90 days to fix it. We will acknowledge within 7 days.

**Scope:** the static site, build pipelines (`.github/workflows/`), and
data builders (`tools/`). All published market data is public by design —
"vulnerabilities" in public data are not in scope.

---

## Secret registry

All secrets live **only** in GitHub Actions encrypted secrets
(repo → Settings → Secrets and variables → Actions). **Never** in the repo,
never in front-end code, never in URLs. Names only below — values are never
written down anywhere.

| Name | Purpose | Used by | Owner | Rotation |
|------|---------|---------|-------|----------|
| `MAIL_USERNAME` | SMTP username for pipeline failure-alert emails | phase-1 pipeline (PR #37, unmerged) | Shirjan | Every 90 days |
| `MAIL_PASSWORD` | SMTP app password for failure-alert emails | phase-1 pipeline (PR #37, unmerged) | Shirjan | Every 90 days |
| `ALERT_EMAIL_TO` | Recipient address for failure alerts (low sensitivity) | phase-1 pipeline (PR #37, unmerged) | Shirjan | On change |
| `GITHUB_TOKEN` | Automatic per-run token (GitHub-managed, short-lived) | all workflows | GitHub | Automatic |

> `main` branch workflows currently reference **no** secrets. The `MAIL_*`
> secrets above are referenced by the phase-1 pipeline branch; verify they
> exist at repo → Settings → Secrets and variables → Actions before merging.

### Rotation calendar (90-day)

| Due | Secrets | Status |
|-----|---------|--------|
| 2026-12-30 | `MAIL_USERNAME`, `MAIL_PASSWORD` | ⏳ pending |
| 2027-03-30 | `MAIL_USERNAME`, `MAIL_PASSWORD` | ⏳ pending |
| 2027-06-28 | `MAIL_USERNAME`, `MAIL_PASSWORD` | ⏳ pending |

To rotate: generate a new app password in the mail provider, update the
secret at repo → Settings → Secrets and variables → Actions, then delete the
old credential at the provider. See `INCIDENT.md` for the emergency rotation
runbook.

### Rules

- New secrets are added via the GitHub web UI only — never via CLI, never in chat.
- `::add-mask::` any secret-adjacent value echoed in workflow logs.
- Debug logging (`ACTIONS_STEP_DEBUG`) stays **off** in production.
- Never upload files that could contain secrets as workflow artifacts.
- Local development uses `.env` (git-ignored); `.env.example` in this repo
  lists variable **names only**.

---

## What's public by design

This is a public repo serving a public static site. The following are
intentionally public: all market data JSON, built HTML/JS/CSS, news
headlines, corporate-action records, blog content. Do not file "exposed
data" reports for these.

## Reporting a bad deploy or tampered data

See `INCIDENT.md` — it covers rollback, secret rotation, and taking a page
offline fast.
