# Incident Runbook — shirjankhadka.com.np

For: leaked secret, tampered data, bad deploy, defaced/taken-over page.
Keep calm. Work top to bottom. Times are targets, not guarantees.

---

## 1. Leaked secret (API key, token, password in repo/logs)

**Target: rotate within 1 hour. Removing it from git does NOT make it safe —
assume it is compromised the moment it was exposed.**

1. **Rotate FIRST, clean second.** Go to the provider (mail provider,
   Facebook, etc.) and revoke/regenerate the credential immediately.
2. Update the GitHub Actions secret: repo → Settings → Secrets and variables
   → Actions → update the value.
3. Purge from git history only after rotation: `git filter-repo` or BFG on a
   fresh clone, then force-push (this rewrites history — coordinate first).
4. Check workflow run logs for the value; delete the run logs if exposed
   (Actions → run → ⋯ → Delete workflow run).
5. Update the rotation table in `SECURITY.md`.

Per-secret steps:

| Secret | Rotate at |
|--------|-----------|
| `MAIL_PASSWORD` | Mail provider → app passwords → revoke old, create new → update Actions secret |
| `MAIL_USERNAME` / `ALERT_EMAIL_TO` | Update Actions secret value directly |
| `GITHUB_TOKEN` | Automatic; nothing to do |

## 2. Bad or tampered data deploy

1. Identify the bad commit: `git log --oneline -5` on `main`.
2. Roll back: `git revert <sha>` on a new branch → PR → merge
   (or fast revert via GitHub UI: commit → ⋯ → Revert).
   Never force-push `main`.
3. Verify the live site: fetch the affected page/data file, confirm the
   expected content hash (see `manifest.json`, S3).
4. Find the cause: check the workflow run that produced the bad data
   (Actions → run → logs), fix the builder, re-run.

## 3. Take a page offline fast

GitHub Pages has no per-page kill switch. Fastest options:

1. **Blank the page:** commit a minimal `index.html` ("Temporarily
   unavailable") over the affected path and push — live in ~1–2 min.
2. **Full-site stop:** repo → Settings → Pages → Build and deployment →
   Source → select "Disable" (or point at an empty branch).
3. **Nuclear:** make the repo private (Settings → Danger Zone → Change
   visibility). The site goes dark immediately; flip back to public after
   the fix.

## 4. After any incident

- [ ] Write a dated entry in `memory/` (what happened, root cause, fix).
- [ ] Update this runbook if a step was wrong or missing.
- [ ] Rotate any secret that *might* have been exposed.
- [ ] Confirm the weekly security workflow is green.

---

**Contacts:** Shirjan (owner) — shirjan.2.khadka@gmail.com
**Backups:** last 30 daily data builds in private storage (see S3 backup notes).
