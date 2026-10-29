# Deploy procedure — Nepse Decode site (Round 2, R7)

Site: https://shirjankhadka.com.np (LIVE DOMAIN ONLY — the github.io
domain 404s for everything; verify live bytes on the custom domain only).
Repo: ShirjanKhadka1/shirjankhadka.github.io, branch `main`.

## 1. The rule: twin-verified deploys, no exceptions

Every deploy is complete ONLY when all five steps below have passed, in
order. A deploy that skipped a step is not "live" — it is unverified,
whatever a run record or a push script printed.

1. **Push with the parallel pusher, lease-checked fast-forward.**
   `github-push-parallel.py` (custom.legacy-github bin) uploads blobs in
   parallel, then ONE tree POST + ONE commit POST + a NON-FORCE ref PATCH.
   It aborts — never proceeds — when the remote tip moved past the base
   snapshot, or when the deployed tree SHA differs from the local tree
   SHA. The sequential pusher is retired: it fails outright on this
   egress proxy (422/504 mid-upload) and stranded deploys in Oct 2026.
   - `--base-sha` takes the FULL 40-char SHA (`git rev-parse origin/main`
     first; a short prefix aborts).
   - Never force-push `main`. A moved tip means: fetch, rebase cleanly
     onto the new tip, retry with fresh refs.
   - Never push from a stale checkout. Never deploy from
     `~/workspace/portfolio` (a stale working copy, not a git repo).
   - New files ship mode 100644. Never ship a 100755 file through the
     parallel pusher (it hardcodes 100644 and aborts on tree mismatch).
   - Branch names: never a `phase*` name (the pusher refuses those
     without a special flag, for PR-branch protection).
   - Deletions: pass `--force` ONLY to allow `{"sha": null}` tree
     entries for genuinely deleted paths; `--force` never skips a
     staleness check and never force-pushes. After a push containing
     deletions, diff the local tree against the remote tree.
2. **Authenticated ref read MUST equal the pushed SHA.**
   After the push, read `GET /repos/{repo}/git/refs/heads/main` through
   the authenticated connector (never an unauthenticated read — it can
   lag behind the authenticated one and must never certify a deploy).
   The remote ref must equal the pushed commit SHA. Replication lag or
   rate limiting that shows the old ref means NOT VERIFIED YET, not
   verified. This is the PUSH-VERIFY RULE: a printed push success with
   the old ref still showing is not a live deploy.
3. **Live-bytes check on the custom domain.**
   Fetch each changed page/data file from https://shirjankhadka.com.np
   and compare bytes (SHA-1 first-8, the fleet's stamp regime) against
   the local file. Stamp STRINGS (`?v=...`) are never the evidence: a
   new `?v=` URL can serve old bytes for minutes at the edge.
4. **Single-URL Cloudflare purge for every changed HTML page — BEFORE
   calling it live-verified.** Edge HTML cache is per-node with a ~4h
   TTL: a curl check from one node showing fresh bytes does NOT prove
   other nodes are fresh. Purge each changed page URL
   (`bin/cloudflare-purge-url.py`), then re-verify. If no HTML page
   changed, no purge is needed — say so explicitly.
5. **Post-purge re-verification.** Re-fetch the purged URLs and confirm
   fresh bytes. Only then may a deploy be reported as live.

## 2. The scripted verifier (do not duplicate it — reference it)

`hidden_files/script-first/audit-deploy-verify.py` (goal workspace,
script-first fleet) implements steps 2–3 with three outcomes that must
not be flattened:

- `RESULT: VERIFIED` — ref matches AND all bytes match (exit 0).
- `RESULT: EDGE-LAGGING` — ref matches but some bytes are old (exit 0).
  This is a PASS with a re-check duty, not a failure: re-run after
  ~10 min; only a genuine ref mismatch fails.
- `RESULT: ALERT` — ref mismatch, bytes still old on re-check with
  `--fail-on-lag`, or auth unavailable (exit 1).

If the connector auth helper is unavailable the script exits 2 LOUD
("auth unavailable") rather than silently downgrading to an
unauthenticated read.

The CI tripwire in `.github/workflows/round2-r7-deploy-tripwire.yml`
guards this document's presence and mandatory-step keywords on every
push to main and every PR touching the document. It is a guard, not a
substitute for steps 1–5: the full verifier needs connector auth, which
GitHub runners do not have, so it runs at deploy time, not in CI.

## 3. Current status, stated plainly (R7, 2026-10-29)

Until the PR flow is fully enforced (branch protection + required
checks, §4), deploys stay **twin-verified direct-to-main**: the parallel
pusher + authenticated ref read + live-bytes check + purge-before-
verified above. The PR flow in §4 is the path TO enforcement, not a
claim that enforcement exists. Do not call a check "required", "gating"
or "blocking" until branch protection lists it — the R1/R2/R6 workflows
run on push and on PRs today, but as tripwires, not gates.

History that motivates this procedure (do not reintroduce these):

- Sequential-pusher deploys stranded computed boards locally while run
  records read "succeeded" (sentiment Oct-28, signals Oct-26).
- A builder that compared the new payload to the WORKTREE file (not to
  what is published on `origin/main`) concluded "already published"
  after a stranded push and silently no-op'd. Published-state tests
  must compare against `origin/main`'s payload, never the worktree.
- A "succeeded" run record, a local commit, and a schedule's existence
  are each NOT proof of publication. "Automated" means ONLY that a
  scheduled run happened AND the live page/data shows the new session.

## 4. The PR flow (path to enforcement)

1. Build on a branch (never `phase*`), push with the parallel pusher.
2. Create the PR via the GitHub API with the fine-grained connector
   token (Contents + Pull requests + Workflows, site repo only).
   The OLD runtime token could not change PR state (403); PR-write is
   proven only by a real created PR, never by a permission listing.
3. Record which checks ran on the PR and their outcomes, honestly —
   including a red check for a genuine pre-existing reason. Never
   weaken a check to make a PR green.
4. Merge via the API only when the change is safe (docs + read-only
   workflow changes). After merge, the twin-verification of §1 still
   applies (ref read + live bytes).
5. Never force-merge, bypass, or push the same change direct-to-main to
   "complete" a PR step. If a merge fails, the PR stays open for the
   site owner and the failure is reported exactly.

## 5. What remains for enforcement (USER account actions — agents cannot set these)

- **Branch protection on `main`** (repository Settings → Branches →
  Add rule for `main`): require a pull request before merging; require
  status checks to pass before merging, with these exact checks:
  `CI quality gates` (ci.yml), `R1 screener claims check`
  (round2-r1-claims.yml), `R2 verdict invariants check`
  (round2-r2-invariants.yml), `R6 axe contrast check`
  (round2-r6-a11y.yml), `R6 Lighthouse budgets + smoke`
  (round2-r6-perf.yml) — plus the existing tests, freshness gate,
  visual regression, Lighthouse and axe jobs as named by their workflow
  job names once protection is configured; require branches to be up to
  date before merging; do NOT allow force pushes; do NOT allow
  deletions of `main`.
- **Cloudflare Pages preview deployments per PR: BLOCKED.** There is no
  Pages project and no GitHub connection for this site (user account
  action: create the Pages project and connect the repo). Until then,
  do NOT fake a preview: PR workflows run against localhost builds
  only, and live verification stays the deploy-time ref read + curl
  byte check of §1, never CI against the live domain.

## 6. Standing deploy rules collected here (do not drift)

- Cache tokens are RAW-CONTENT SHA-1 first-8 — re-stamp any CSS/JS pin
  you change.
- After ANY deploy that changes an HTML page, purge that page before
  calling it live-verified (§1 step 4).
- Worktree hygiene: a worktree sitting on a PR branch is a trap for any
  worker that derives `--branch` from the checkout. Keep PR work in a
  dedicated worktree; move shared/old worktrees off PR branches when
  done.
- Token values are never printed in any output. PR URLs, SHAs and
  check names are fine; token values are never printed.
- Cross-dataset gates are evaluated on the COMBINED tree only. Any
  gate that compares two datasets — SSR session markers vs the
  manifest session date, a baked page vs its batch payload, an
  archive vs live bytes — can pass only on a tree containing ALL
  compared sides. A single-lane PR that moves only one side is
  EXPECTED to fail that gate (2026-10-29: universe PR #111 failed
  the SSR-session smoke test while signals PR #109 failed the
  mirror way; neither lane alone could ever go green). The correct
  response is a combined PR carrying every side, never re-running
  the check hoping for a pass and never merging on red.
- Verifier pins are content-agreement checks, never literals. A
  verifier must compare the page's stamp to the SHA-1 first-8 of
  the file it names (or the value computed from the same source
  the page uses); a literal hash, date, or token that a legitimate
  re-stamp, rebuild, or re-issue changes is a stale pin, not a
  gate (2026-10-29: the brokers verifier once demanded literal
  e2586480 while the page correctly carried fe4f1d6e; the same
  69b323cf chrome literal was removed from five sibling verifiers
  the same night).
