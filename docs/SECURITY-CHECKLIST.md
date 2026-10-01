# Manual Security Checklist — for Shirjan only

Things only you can do (I can't see or change repo/account settings).
Work top to bottom; tick each off. ~30 minutes total.

## 1. Repo settings — code security
Repo → **Settings** → **Code security**:

- [ ] **Secret scanning** → Enable (alerts)
- [ ] **Push protection** → Enable (blocks pushes containing secrets)
- [ ] **Private vulnerability reporting** → Enable
- [ ] **Dependabot alerts** → Enable
- [ ] **Dependabot security updates** → Enable
- [ ] **Code scanning** → Set up → **CodeQL** → Default setup → Enable

## 2. Branch protection — main
Repo → **Settings** → **Branches** → **Add classic branch protection rule**
- Branch name pattern: `main`
- [ ] Require a pull request before merging (required approving reviews: 1)
- [ ] Require status checks to pass → add: `sweep` (weekly), plus CI checks
- [ ] Require branches to be up to date before merging
- [ ] Do not allow bypassing the above settings
- [ ] Restrict who can push: nobody directly (all via PR)
- [ ] **Do not** allow force pushes · **Do not** allow deletions
- [ ] Require linear history

## 3. Secrets — verify they exist
Repo → **Settings** → **Secrets and variables** → **Actions** → confirm:
- [ ] `MAIL_USERNAME`, `MAIL_PASSWORD`, `ALERT_EMAIL_TO` (phase-1 pipeline alerts)
- [ ] `BACKUP_REPO_TOKEN` — **you must create this:** GitHub → avatar →
      **Settings** → **Developer settings** → **Personal access tokens** →
      **Fine-grained tokens** → **Generate new token** →
      - Resource owner: your account · Repository access: **Only select
        repositories** → `shirjankhadka-data-backups`
      - Permissions → Repository → **Contents: Read and write**
      - Expiry: 90 days (matches rotation calendar) → copy the token →
        back at repo Secrets → **New repository secret** → name
        `BACKUP_REPO_TOKEN`, paste value

## 4. Cloudflare — security headers (free tier, S3)
- [ ] Add `shirjankhadka.com.np` to Cloudflare (free plan), change
      nameservers at your registrar when asked
- [ ] SSL/TLS → **Full (strict)**
- [ ] Rules → Transform Rules → **Modify Response Header** → add:
      - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
      - `X-Content-Type-Options: nosniff`
      - `Referrer-Policy: strict-origin-when-cross-origin`
      - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
      - `X-Frame-Options: SAMEORIGIN`
- [ ] Start with CSP in **report-only**:
      `Content-Security-Policy-Report-Only: default-src 'self' https:; img-src 'self' https: data:; script-src 'self' https://www.googletagmanager.com https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
- [ ] After 2 weeks with no violations: switch to enforcing CSP,
      then consider HSTS preload

## 5. Account security
- [ ] GitHub: avatar → Settings → **Password and authentication** →
      enable **passkey** + TOTP 2FA; save **recovery codes offline**
- [ ] Domain registrar: enable 2FA
- [ ] DNS provider: enable 2FA
- [ ] Email (Gmail): 2FA on, check recovery options
- [ ] Repo → Settings → **Collaborators**: remove anyone unused
- [ ] Repo → Settings → **Deploy keys**: remove any unused

## 6. Notifications (already your policy)
- [ ] Repo → **Watch** → **Custom** → **Actions** (GitHub emails you on
      workflow failure — this is the alert channel, never Facebook)

---
*Generated 2026-10-01 · S4. Keep this file; re-verify quarterly.*
