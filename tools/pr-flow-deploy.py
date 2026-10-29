#!/usr/bin/env python3
"""PR-flow deploy helper — the ONE deploy path under branch protection.

Branch protection on main (classic rule, 2026-10-29) requires a pull
request, branches up to date, 5 required checks, no bypass, and no
force pushes or deletions. Direct pushes to main fail for everyone,
including automation. Every deploy therefore goes:

  branch (deploy/<job>-<date>) -> push branch -> PR -> poll 5 required
  checks green -> update branch from main if main moved -> squash-merge
  -> verify via authenticated ref read + tree-SHA match.

Usage:
  python3 tools/pr-flow-deploy.py --repo-dir WT --branch deploy/<job>-<date>
      --message "Title\n\nBody" (--files PATH... | --all)
      [--no-merge] [--allow-deletions]
      [--timeout SECONDS] [--poll-interval SECONDS]

Inputs:
  --repo-dir   worktree containing the changes (required)
  --branch     PR branch; must match deploy/<name>; NEVER phase* or main
  --message    commit message AND PR title (first line) + body
  --files      paths to stage (repeatable); or --all for every change
  --no-merge   stop after creating (or reusing) the PR; print its URL
  --allow-deletions  pass --force to the branch pusher for deleted paths
  --timeout    seconds to wait for checks per poll round (default 1800)
  --poll-interval  seconds between check polls (default 60)

Required checks (job names as shown in GitHub's picker):
  quality, Screener figures match the archive,
  Verdict invariants hold on the shipped batch,
  axe contrast 0 nodes (5 pages x dark/light),
  Lighthouse budgets + Playwright smoke.

Contention design (read this before "optimizing" it):
  ~29 jobs land in the 16:38-19:10 evening window, and the up-to-date
  rule means each merge invalidates other open PRs. There is NO global
  lock: serializing whole flows (including 10-20 min check polls)
  would blow the evening window. Instead, jobs run builds + PRs +
  check polls CONCURRENTLY on separate branches, and the helper
  serializes only the merge itself through GitHub's atomic merge:
  update the branch from main, re-poll on the new SHA, attempt the
  squash-merge, and retry (bounded: 3 update cycles). A merge that
  still cannot land fails LOUDLY with the reason — it is never
  force-pushed, bypassed, or pushed direct-to-main instead. Order
  between dependent jobs comes from their schedules (later jobs build
  on earlier jobs' merged output), not from this helper. The structural
  fix for contention is the Phase D single orchestrator (one PR per
  window); this helper is the correct transition path, not a queue.

  Main moves every ~1 min during market hours (Alpha Lab snapshots),
  so midday merges may need several cycles; evening merges (after
  snapshots stop) have a much wider window. Never "fix" a slow merge
  by weakening a check, bypassing protection, or pushing to main.

  Push mechanics (ancestry matters): content pushes go through the
  parallel pusher (proven for big pushes; it creates a twin commit
  with a single parent, which is correct for a fresh branch or a
  linear commit). Merge-update pushes MUST NOT use plain `git push`:
  it cannot authenticate from this environment (probe 2026-10-29:
  `could not read Username for 'https://github.com'`, rc 128; the
  #96 worker proved 4 auth methods fail here). They MUST NOT use the
  parallel pusher either: it would flatten a merge commit to a single
  parent and the branch would no longer CONTAIN the main tip, so
  GitHub would still report it as not up to date. Merge updates
  therefore replicate via the Git Data API: create a commit with the
  merge result's exact tree and message and parents
  [branch-tip, main-tip] (NEVER one parent — that fails GitHub's
  up-to-date check), then a lease-checked NON-FORCE fast-forward ref
  update (never force-push). The API twin differs from the local
  merge commit only in timestamps, never in tree or parents.

  After a merge, HTML purge + live-bytes verification remain the
  CALLER's job (deploy-procedure §1 steps 4-5): this helper verifies
  ref + tree only, never live bytes.

Exit codes: 0 merged (or PR created with --no-merge, or NO-CHANGES),
  1 deploy failed (reason printed), 2 usage/validation error.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
import dynamic_credentials  # noqa: F401  (pin known-good module: gh_api
# inserts a templates path that lacks it, so resolve it first or the
# import fails whenever PYTHONPATH is unset, e.g. under cron runners)
sys.path.insert(0, "/home/hatch/workspace/custom-connectors/custom.legacy-github/bin")
from gh_api import api  # noqa: E402  (surrogate-authenticated, custom.github)

REPO = "ShirjanKhadka1/shirjankhadka.github.io"
OWNER = "ShirjanKhadka1"
PUSHER = "/home/hatch/workspace/custom-connectors/custom.legacy-github/bin/github-push-parallel.py"
DEFAULT_CHECKS = [
    "quality",
    "Screener figures match the archive",
    "Verdict invariants hold on the shipped batch",
    "axe contrast 0 nodes (5 pages x dark/light)",
    "Lighthouse budgets + Playwright smoke",
]
BRANCH_RE = re.compile(r"^deploy/[A-Za-z0-9][A-Za-z0-9._-]*$")


def fail(msg, code=1):
    print(f"pr-flow-deploy: error: {msg}", file=sys.stderr)
    sys.exit(code)


def sh(args, cwd, check=True, input_text=None):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                       input=input_text)
    if check and r.returncode != 0:
        fail(f"command failed ({r.returncode}): {' '.join(args)}\n"
             f"stdout: {r.stdout[-1000:]}\nstderr: {r.stderr[-1000:]}")
    return r


def git(args, cwd, check=True):
    return sh(["git", "-c", "http.version=HTTP/1.1"] + args, cwd, check)


def git_out(args, cwd):
    return git(args, cwd).stdout.strip()


def gh(method, path, data=None):
    return api(method, f"/repos/{REPO}{path}", data)


def main_branch_tip():
    return gh("GET", "/git/ref/heads/main")["object"]["sha"]


def branch_tip(branch):
    try:
        return gh("GET", f"/git/ref/heads/{branch}")["object"]["sha"]
    except Exception:
        return None


def commit_tree(sha):
    return gh("GET", f"/git/commits/{sha}")["tree"]["sha"]


def push_branch(repo_dir, branch, base_sha, local_ref, message, allow_deletions):
    """Push local_ref's exact tree onto branch via the parallel pusher.
    Returns the remote (twin) commit SHA. The pusher cannot CREATE a
    branch, so a missing branch is first created at the base tip."""
    env = dict(os.environ,
               PYTHONPATH="/opt/muse/skills/custom-connector-setup/bin")
    cmd = [sys.executable, PUSHER, "--repo", REPO, "--branch", branch,
           "--base-sha", base_sha, "--local-ref", local_ref,
           "--message", message]
    if allow_deletions:
        cmd.append("--force")
    r = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True,
                       env=env, timeout=900)
    if r.returncode != 0:
        fail(f"branch push failed (rc={r.returncode}):\n"
             f"stdout: {r.stdout[-1500:]}\nstderr: {r.stderr[-1500:]}")
    twin = r.stdout.strip().splitlines()[-1].strip()
    if not re.fullmatch(r"[0-9a-f]{40}", twin):
        fail(f"branch push did not report a commit SHA; output:\n{r.stdout[-1500:]}")
    return twin


def api_push_merge(repo_dir, branch, old_tip, new_main):
    """Replicate the local merge commit onto the remote branch via the
    Git Data API (merge updates ONLY). Plain git push cannot
    authenticate here, and the parallel pusher would flatten the merge
    to a single parent. Returns the remote (twin) merge commit SHA.
    The twin carries the merge result's exact tree and message with
    parents [old_tip, new_main], so the branch CONTAINS the main tip
    and GitHub's up-to-date check passes. Ref update is a lease-checked
    non-force fast-forward; never force-push."""
    local_tree = git_out(["rev-parse", "HEAD^{tree}"], repo_dir)
    message = git_out(["log", "-1", "--format=%B", "HEAD"], repo_dir)
    lease = branch_tip(branch)
    if lease != old_tip:
        fail(f"merge-update lease broken: remote branch moved "
             f"({lease[:12] if lease else None} != expected "
             f"{old_tip[:12]}); aborting, never force-pushing")
    twin = gh("POST", "/git/commits",
              {"message": message, "tree": local_tree,
               "parents": [old_tip, new_main]})
    twin_sha = twin["sha"]
    if twin["tree"]["sha"] != local_tree:
        fail(f"merge-update tree mismatch: API commit tree "
             f"{twin['tree']['sha'][:12]} != local merge tree "
             f"{local_tree[:12]}")
    try:
        gh("PATCH", f"/git/refs/heads/{branch}",
           {"sha": twin_sha, "force": False})
    except Exception as e:
        fail(f"merge-update ref update failed (API commit {twin_sha[:12]} "
             f"exists but is not the branch tip): {e}")
    new_tip = branch_tip(branch)
    if new_tip != twin_sha:
        fail(f"merge-update push mismatch: remote {new_tip[:12] if new_tip else None} "
             f"!= API merge {twin_sha[:12]}")
    print(f"pr-flow-deploy: merge replicated via API -> {twin_sha[:12]} "
          f"(tree {local_tree[:12]}, parents {old_tip[:12]}, "
          f"{new_main[:12]})")
    # Track the remote twin locally so the next loop iteration's
    # merge-base check reads the twin (whose parents are correct).
    git(["fetch", "origin", branch], repo_dir, check=False)
    git(["checkout", "-B", branch, f"origin/{branch}"], repo_dir)
    return twin_sha


def find_open_pr(branch):
    prs = gh("GET", f"/pulls?head={OWNER}:{branch}&base=main&state=open")
    return prs[0] if prs else None


def create_pr(branch, title, body):
    pr = gh("POST", "/pulls", {"title": title, "head": branch, "base": "main",
                               "body": body})
    return pr


def check_state(head_sha, required):
    """Aggregate latest check-run per required name -> (state, detail).
    state: 'green' | 'pending' | 'failed'. Missing names count as pending
    until the caller times out (then reported as missing)."""
    runs = gh("GET", f"/commits/{head_sha}/check-runs?per_page=100")
    latest = {}
    for c in runs.get("check_runs", []):
        name = c["name"]
        if name not in latest or c["id"] > latest[name]["id"]:
            latest[name] = c
    missing, pending, failed = [], [], []
    for name in required:
        c = latest.get(name)
        if c is None:
            missing.append(name)
        elif c["status"] in ("queued", "in_progress", "waiting"):
            pending.append(name)
        elif c["conclusion"] == "success":
            pass
        else:
            failed.append(f"{name}={c['conclusion']}")
    if failed:
        return "failed", "failed: " + ", ".join(failed)
    if missing or pending:
        return "pending", ("waiting: " + ", ".join(missing + pending))
    return "green", "all required checks green"


def poll_checks(head_sha, required, timeout, interval):
    deadline = time.time() + timeout
    while True:
        state, detail = check_state(head_sha, required)
        print(f"pr-flow-deploy: checks on {head_sha[:12]}: {detail}")
        if state != "pending":
            return state, detail
        if time.time() >= deadline:
            return "failed", f"timed out after {timeout}s: {detail}"
        time.sleep(min(interval, max(1, deadline - time.time())))


def main():
    ap = argparse.ArgumentParser(description="PR-flow deploy helper")
    ap.add_argument("--repo-dir", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--message", required=True)
    ap.add_argument("--files", nargs="*", default=[])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--no-merge", action="store_true")
    ap.add_argument("--allow-deletions", action="store_true")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--poll-interval", type=int, default=60)
    ap.add_argument("--required-checks", nargs="*", default=DEFAULT_CHECKS)
    args = ap.parse_args()
    repo_dir = os.path.abspath(args.repo_dir)
    branch = args.branch

    if not BRANCH_RE.match(branch):
        fail(f"branch must match deploy/<name> (got {branch!r}); "
             f"never phase* branches, never main", code=2)
    if not args.files and not args.all:
        fail("pass --files PATH... or --all", code=2)
    if not os.path.isdir(os.path.join(repo_dir, ".git")) and not \
            os.path.isfile(os.path.join(repo_dir, ".git")):
        fail(f"not a git worktree: {repo_dir}", code=2)
    if not git_out(["config", "user.name"], repo_dir):
        fail("git user.name not configured", code=2)

    git(["fetch", "origin", "main", branch], repo_dir, check=False)
    main_tip = main_branch_tip()
    existing_tip = branch_tip(branch)
    if existing_tip:
        print(f"pr-flow-deploy: reusing remote branch {branch} at "
              f"{existing_tip[:12]}")
        git(["checkout", "-B", branch, f"origin/{branch}"], repo_dir)
        base_sha = existing_tip
    else:
        print(f"pr-flow-deploy: creating branch {branch} from main "
              f"{main_tip[:12]}")
        gh("POST", "/git/refs",
           {"ref": f"refs/heads/{branch}", "sha": main_tip})
        git(["checkout", "-B", branch, "origin/main"], repo_dir)
        base_sha = main_tip

    # Stage + commit (refuse 100755: the branch pusher hardcodes 100644).
    if args.all:
        git(["add", "-A"], repo_dir)
    else:
        git(["add", "--"] + args.files, repo_dir)
    staged = git_out(["diff", "--cached", "--name-only"], repo_dir)
    if not staged:
        # Nothing new; if the branch already carries commits vs main, the
        # caller may still want the PR merged (retry path). Otherwise noop.
        ahead = git_out(["rev-list", "--count",
                         f"origin/main..HEAD"], repo_dir)
        if ahead == "0":
            print("pr-flow-deploy: NO-CHANGES (nothing staged, branch "
                  "has no commits vs main)")
            print("RESULT: PRFLOW-NO-CHANGES")
            return 0
        print("pr-flow-deploy: nothing new staged; reusing branch commits")
        local_ref = git_out(["rev-parse", "HEAD"], repo_dir)
    else:
        modes = git_out(["ls-files", "-s"], repo_dir)
        bad = [l for l in modes.splitlines()
               if l.split()[0] == "100755"
               and l.split("\t", 1)[1] in staged.splitlines()]
        if bad:
            fail("refusing 100755 file(s) (branch pusher hardcodes 100644; "
                 "chmod -x first): " + ", ".join(
                     l.split("\t", 1)[1] for l in bad), code=2)
        deleted = git_out(["diff", "--cached", "--diff-filter=D",
                           "--name-only"], repo_dir)
        if deleted and not args.allow_deletions:
            fail("deletion(s) staged without --allow-deletions: " + deleted,
                 code=2)
        git(["commit", "-m", args.message], repo_dir)
        local_ref = git_out(["rev-parse", "HEAD"], repo_dir)
    local_tree = git_out(["rev-parse", "HEAD^{tree}"], repo_dir)
    print(f"pr-flow-deploy: local commit {local_ref[:12]} "
          f"tree {local_tree[:12]}")

    head_sha = push_branch(repo_dir, branch, base_sha, local_ref,
                           args.message, args.allow_deletions)
    print(f"pr-flow-deploy: branch {branch} pushed -> {head_sha[:12]} "
          f"(twin of local {local_ref[:12]})")

    title = args.message.splitlines()[0]
    body = (args.message + "\n\nPR-flow deploy via tools/pr-flow-deploy.py "
            "(branch protection: squash-merge only, no bypass).")
    pr = find_open_pr(branch)
    if pr:
        print(f"pr-flow-deploy: reusing open PR #{pr['number']}: "
              f"{pr['html_url']}")
    else:
        pr = create_pr(branch, title, body)
        print(f"pr-flow-deploy: created PR #{pr['number']}: "
              f"{pr['html_url']}")
    if args.no_merge:
        print(f"RESULT: PRFLOW-PR {pr['html_url']}")
        return 0

    # Merge loop: poll -> up-to-date? -> merge; at most 3 branch updates.
    for cycle in range(4):
        state, detail = poll_checks(head_sha, args.required_checks,
                                    args.timeout, args.poll_interval)
        if state != "green":
            fail(f"checks not green on {head_sha[:12]}: {detail}")
        git(["fetch", "origin", "main", branch], repo_dir, check=False)
        new_main = main_branch_tip()
        merge_base = git_out(["merge-base", f"origin/{branch}",
                              "origin/main"], repo_dir)
        if merge_base != new_main:
            if cycle == 3:
                fail("main moved again after 3 branch updates; giving up "
                     "(contention — retry the deploy; never force-push)")
            print(f"pr-flow-deploy: main moved ({new_main[:12]}); "
                  f"updating branch (cycle {cycle + 1}/3)")
            git(["checkout", "-B", branch, f"origin/{branch}"], repo_dir)
            old_tip = branch_tip(branch)
            m = git(["merge", "--no-edit", "origin/main"], repo_dir,
                    check=False)
            if m.returncode != 0:
                git(["merge", "--abort"], repo_dir, check=False)
                fail("merge conflict updating branch from main; "
                     "resolve manually, never force-push")
            merge_commit = git_out(["rev-parse", "HEAD"], repo_dir)
            # Merge updates go via Git Data API replication (NOT plain
            # git push — it cannot authenticate here — and NOT the
            # parallel pusher, which would flatten the merge to one
            # parent and fail GitHub's up-to-date check).
            head_sha = api_push_merge(repo_dir, branch, old_tip, new_main)
            print(f"pr-flow-deploy: branch updated (local merge "
                  f"{merge_commit[:12]} replicated as {head_sha[:12]}); "
                  f"re-polling checks")
            continue
        try:
            merged = gh("POST", f"/pulls/{pr['number']}/merge",
                        {"merge_method": "squash"})
        except Exception as e:
            fail(f"squash-merge API failed: {e}")
        merge_sha = merged["sha"]
        print(f"pr-flow-deploy: squash-merged PR #{pr['number']} -> "
              f"{merge_sha[:12]}")
        ref_main = main_branch_tip()
        if ref_main != merge_sha:
            fail(f"post-merge ref mismatch: main={ref_main[:12]} "
                 f"merge={merge_sha[:12]}")
        main_tree = commit_tree(merge_sha)
        head_tree = commit_tree(head_sha)
        if main_tree != head_tree:
            fail(f"post-merge tree mismatch: main tree {main_tree[:12]} "
                 f"PR head tree {head_tree[:12]}")
        print(f"pr-flow-deploy: verified main={merge_sha[:12]} "
              f"tree={main_tree[:12]} (matches PR head tree)")
        print(f"NOTE: HTML purge + live-bytes verification remain the "
              f"caller's job (deploy-procedure §1 steps 4-5).")
        print(f"RESULT: PRFLOW-MERGED {pr['html_url']} {merge_sha}")
        return 0
    fail("merge loop exhausted (unreachable)")


if __name__ == "__main__":
    sys.exit(main())
