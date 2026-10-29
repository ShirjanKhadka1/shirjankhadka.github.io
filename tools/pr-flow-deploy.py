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
  --max-updates  max update-branch cycles in the merge loop (default 3)

Hardening (2026-10-29, failure-class program):
  * Every print carries flush=True: under cron (non-tty stdout) progress
    must not sit in a buffer during 15-20+ min check polls.
  * Update-branch leases are exact 40-char SHAs, validated before the
    call and re-read from the API immediately before it: a short or
    wrongly expanded SHA fails with a message naming the expected head
    vs the actual head — never a silent wrong update (the #107 fix
    worker's first update-branch attempt 422'd on a wrongly expanded
    short SHA; the lease caught it, but the message path must make a
    lease mismatch unmistakable).
  * API-merge failures (including 404) are reported ONCE with the PR
    state attached and never loop-retried: a merge POST is failed
    loudly, not re-attempted.
  * Check polls are keyed to the exact head SHA being waited on:
    check-runs whose head_sha differs are ignored (a superseded run's
    green is never the current head's green); a run concluded
    "cancelled" counts as pending, never failed (cancel-in-progress
    cancels the old head's run when the new head's run starts); and
    when the branch tip moves mid-poll the poller returns "superseded"
    with the new head so the caller re-polls it instead of failing on
    the cancelled run or timing out on a dead head.
  * Branch fetches use an explicit refspec into
    refs/remotes/origin/<branch> (fetch_branch_ref): a bare
    `git fetch origin <branch>` only updates FETCH_HEAD in
    single-branch clones (refspec covers main only), leaving
    origin/<branch> unknown — which killed the first #124 run at the
    merge-base step after all 5 checks were green. Full clones never
    noticed because their wildcard refspec masks it.

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
  squash-merge, and retry (bounded: --max-updates cycles, default 3).
  A merge that
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
  therefore use GitHub's update-branch API (PUT /pulls/{n}/
  update-branch): GitHub itself creates the merge commit server-side
  with parents [branch-tip, main-tip] — never flattened, never
  force-pushed — and the helper verifies the new head's parents
  contain the main tip before re-polling. Proven 2026-10-29 twice:
  PR #102's update, and this helper's own PR #103 update (server
  merge tree matched a locally computed merge tree exactly).
  (An earlier draft replicated merge commits via the Git Data API;
  abandoned: create-commit 422s "Tree SHA does not exist" because a
  locally computed merge tree is not yet a remote object. Do not
  revive it — update-branch is the proven path.)

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
    print(f"pr-flow-deploy: error: {msg}", file=sys.stderr, flush=True)
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


def fetch_branch_ref(repo_dir, branch):
    """Fetch <branch> into refs/remotes/origin/<branch> explicitly.

    A bare `git fetch origin <branch>` updates only FETCH_HEAD when
    the clone's fetch refspec covers main alone (single-branch
    clones); origin/<branch> then stays unknown and every later
    merge-base / checkout -B origin/<branch> fails. The explicit
    mapping works identically in full clones. Fails loudly if the
    ref still cannot be resolved — never let a later step die on an
    'unknown revision' for a branch that exists remotely."""
    git(["fetch", "origin",
         f"{branch}:refs/remotes/origin/{branch}"], repo_dir)
    resolved = git(["rev-parse", "--verify", "--quiet",
                    f"refs/remotes/origin/{branch}"], repo_dir,
                   check=False).stdout.strip()
    if not resolved:
        fail(f"cannot resolve origin/{branch} after explicit fetch; "
             f"refusing to continue with a stale local ref view")


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


def validate_lease_sha(name, sha):
    """Lease SHAs must be exact 40-char hex. A short prefix (or any
    wrongly expanded value) is refused BEFORE any API call, naming
    what was passed — it must never reach expected_head_sha, where
    GitHub would 422 and the cause would read as a generic failure."""
    if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
        fail(f"lease SHA for {name} is not an exact 40-char SHA: "
             f"got {sha!r}. Pass the full SHA (from the API ref read "
             f"or `git rev-parse`); a short prefix is refused, never "
             f"expanded or guessed", code=2)


def pr_state(pr_number):
    """Best-effort compact PR state for failure reports. Never raises:
    a failed state fetch must not mask the original failure."""
    try:
        pr = gh("GET", f"/pulls/{pr_number}")
        return {"number": pr_number, "state": pr.get("state"),
                "merged": pr.get("merged"),
                "mergeable": pr.get("mergeable"),
                "mergeable_state": pr.get("mergeable_state"),
                "head": (pr.get("head") or {}).get("sha"),
                "base": (pr.get("base") or {}).get("sha"),
                "url": pr.get("html_url")}
    except Exception as e:
        return {"number": pr_number, "unavailable": str(e)[:200]}


def api_update_branch(repo_dir, branch, pr_number, old_tip, new_main):
    """Update the PR branch from main via GitHub's update-branch API
    (merge updates ONLY). Plain git push cannot authenticate here,
    the parallel pusher would flatten a merge to a single parent,
    and Git Data API commit replication 422s on the unpushed merge
    tree — so GitHub itself performs the merge server-side. Returns
    the new branch head SHA. The update is lease-checked via
    expected_head_sha, and ancestry is verified: the new head's
    parents MUST contain new_main, else the branch is still not up
    to date and the deploy fails loudly. Never force-push; a 422
    (e.g. merge conflict) fails loudly for manual resolution.

    Lease hardening: both SHAs are validated as exact 40-char values,
    and the live branch tip is re-read immediately before the PUT and
    compared to old_tip. A mismatch fails naming EXPECTED vs ACTUAL —
    the branch moved under this deploy, so updating from the stale
    lease would be a silent wrong update."""
    validate_lease_sha("update-branch expected_head_sha", old_tip)
    validate_lease_sha("update-branch main tip", new_main)
    live_tip = branch_tip(branch)
    if live_tip is None:
        fail(f"refusing update-branch on PR #{pr_number}: cannot read "
             f"the live head of {branch} to verify the lease "
             f"(expected {old_tip}); refusing to update blind, never "
             f"guessing")
    if live_tip != old_tip:
        fail(f"refusing update-branch on PR #{pr_number}: LEASE "
             f"MISMATCH on {branch}: expected head {old_tip} (the head "
             f"this deploy polled), actual remote head {live_tip} — "
             f"the branch moved; refusing a stale-lease update, never "
             f"a silent wrong update")
    try:
        gh("PUT", f"/pulls/{pr_number}/update-branch",
           {"expected_head_sha": old_tip})
    except Exception as e:
        state = pr_state(pr_number)
        actual = branch_tip(branch)
        fail(f"branch update API failed on PR #{pr_number} (reported "
             f"once, not retried): {e}. Lease: expected head "
             f"{old_tip}, actual remote head {actual}. PR state: "
             f"{state}")
    deadline = time.time() + 180
    new_tip = None
    while time.time() < deadline:
        new_tip = branch_tip(branch)
        if new_tip and new_tip != old_tip:
            break
        time.sleep(10)
    if not new_tip or new_tip == old_tip:
        actual = branch_tip(branch)
        fail(f"branch update did not advance {branch} from expected "
             f"head {old_tip} within 180s (actual remote head now "
             f"{actual}); aborting, never force-pushing")
    parents = [p["sha"] for p in
               gh("GET", f"/git/commits/{new_tip}")["parents"]]
    if new_main not in parents:
        fail(f"branch update ancestry wrong: new head {new_tip} "
             f"parents {parents} do not contain main {new_main}")
    print(f"pr-flow-deploy: branch updated via update-branch API -> "
          f"{new_tip[:12]} (parents {[p[:12] for p in parents]})", flush=True)
    # Track the updated branch locally so the next loop iteration's
    # merge-base check reads the new head (whose parents are correct).
    fetch_branch_ref(repo_dir, branch)
    git(["checkout", "-B", branch, f"origin/{branch}"], repo_dir)
    return new_tip


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
    until the caller times out (then reported as missing).

    Poll keying: the endpoint is already scoped to head_sha, but runs
    are ALSO filtered to c["head_sha"] == head_sha, so a superseded
    run's green can never count as this head's green. A run concluded
    "cancelled" counts as PENDING, never failed: under
    cancel-in-progress the old head's run is cancelled the moment the
    new head's run starts, so failing on it would kill a deploy that
    is simply being superseded (the caller detects the supersession
    via the branch tip and re-polls the new head)."""
    runs = gh("GET", f"/commits/{head_sha}/check-runs?per_page=100")
    latest = {}
    for c in runs.get("check_runs", []):
        if c.get("head_sha") and c["head_sha"] != head_sha:
            continue
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
        elif c["conclusion"] == "cancelled":
            pending.append(f"{name}=cancelled (awaiting re-run)")
        elif c["conclusion"] == "success":
            pass
        else:
            failed.append(f"{name}={c['conclusion']}")
    if failed:
        return "failed", "failed: " + ", ".join(failed)
    if missing or pending:
        return "pending", ("waiting: " + ", ".join(missing + pending))
    return "green", "all required checks green"


def poll_checks(head_sha, required, timeout, interval, branch=None):
    """Poll checks for EXACTLY head_sha. Returns (state, detail, head).

    state 'superseded' means the branch tip moved mid-poll: detail
    names old vs new head, and head is the NEW tip for the caller to
    re-poll. It is never a failure (the old head's cancelled run must
    not fail the deploy) and never a green (the new head has its own
    runs to wait on). A None branch tip (transient API failure) is
    ignored, never treated as supersession."""
    deadline = time.time() + timeout
    while True:
        if branch:
            tip = branch_tip(branch)
            if tip and tip != head_sha:
                return ("superseded",
                        f"branch {branch} moved during poll: waited-on "
                        f"head {head_sha} superseded by {tip}; "
                        f"re-polling the new head, never failing on "
                        f"the old head's cancelled run",
                        tip)
        state, detail = check_state(head_sha, required)
        print(f"pr-flow-deploy: checks on {head_sha[:12]}: {detail}", flush=True)
        if state != "pending":
            return state, detail, head_sha
        if time.time() >= deadline:
            return "failed", f"timed out after {timeout}s: {detail}", head_sha
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
    ap.add_argument("--max-updates", type=int, default=3,
                    help="max update-branch cycles in the merge loop "
                         "(default 3; superseded re-polls do not count)")
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

    git(["fetch", "origin", "main"], repo_dir, check=False)
    main_tip = main_branch_tip()
    existing_tip = branch_tip(branch)
    if existing_tip:
        print(f"pr-flow-deploy: reusing remote branch {branch} at "
              f"{existing_tip[:12]}", flush=True)
        fetch_branch_ref(repo_dir, branch)
        git(["checkout", "-B", branch, f"origin/{branch}"], repo_dir)
        base_sha = existing_tip
    else:
        print(f"pr-flow-deploy: creating branch {branch} from main "
              f"{main_tip[:12]}", flush=True)
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
                  "has no commits vs main)", flush=True)
            print("RESULT: PRFLOW-NO-CHANGES", flush=True)
            return 0
        print("pr-flow-deploy: nothing new staged; reusing branch commits", flush=True)
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
          f"tree {local_tree[:12]}", flush=True)

    head_sha = push_branch(repo_dir, branch, base_sha, local_ref,
                           args.message, args.allow_deletions)
    print(f"pr-flow-deploy: branch {branch} pushed -> {head_sha[:12]} "
          f"(twin of local {local_ref[:12]})", flush=True)

    title = args.message.splitlines()[0]
    body = (args.message + "\n\nPR-flow deploy via tools/pr-flow-deploy.py "
            "(branch protection: squash-merge only, no bypass).")
    pr = find_open_pr(branch)
    if pr:
        print(f"pr-flow-deploy: reusing open PR #{pr['number']}: "
              f"{pr['html_url']}", flush=True)
    else:
        pr = create_pr(branch, title, body)
        print(f"pr-flow-deploy: created PR #{pr['number']}: "
              f"{pr['html_url']}", flush=True)
    if args.no_merge:
        print(f"RESULT: PRFLOW-PR {pr['html_url']}", flush=True)
        return 0

    # Merge loop: poll -> up-to-date? -> merge; at most --max-updates
    # branch updates (default 3). A "superseded" poll (branch tip moved
    # mid-poll) re-polls the new head WITHOUT consuming an update
    # cycle; total rounds are bounded so contention cannot loop forever.
    updates = 0
    rounds = 0
    while True:
        rounds += 1
        if rounds > 12:
            fail("merge loop: too many poll/update rounds (contention); "
                 "giving up, never force-push")
        state, detail, polled_head = poll_checks(
            head_sha, args.required_checks, args.timeout,
            args.poll_interval, branch=branch)
        if state == "superseded":
            print(f"pr-flow-deploy: {detail}", flush=True)
            head_sha = polled_head
            print(f"pr-flow-deploy: re-polling new head "
                  f"{head_sha[:12]}", flush=True)
            continue
        if state != "green":
            fail(f"checks not green on {head_sha[:12]}: {detail}")
        git(["fetch", "origin", "main"], repo_dir, check=False)
        fetch_branch_ref(repo_dir, branch)
        new_main = main_branch_tip()
        merge_base = git_out(["merge-base", f"origin/{branch}",
                              "origin/main"], repo_dir)
        if merge_base != new_main:
            if updates >= args.max_updates:
                fail(f"main moved again after {args.max_updates} branch "
                     f"updates; giving up (contention — retry the "
                     f"deploy; never force-push)")
            updates += 1
            print(f"pr-flow-deploy: main moved ({new_main[:12]}); "
                  f"updating branch (cycle {updates}/"
                  f"{args.max_updates})", flush=True)
            old_tip = branch_tip(branch)
            # Merge updates go via GitHub's update-branch API (NOT
            # plain git push — it cannot authenticate here — and NOT
            # the parallel pusher, which would flatten the merge to
            # one parent and fail GitHub's up-to-date check, and NOT
            # Git Data API replication, which 422s on the unpushed
            # merge tree). GitHub merges server-side; no local merge
            # commit is created here.
            head_sha = api_update_branch(repo_dir, branch, pr["number"],
                                         old_tip, new_main)
            print(f"pr-flow-deploy: branch updated -> {head_sha[:12]}; "
                  f"re-polling checks", flush=True)
            continue
        try:
            merged = gh("POST", f"/pulls/{pr['number']}/merge",
                        {"merge_method": "squash"})
        except Exception as e:
            # Report ONCE with the PR state attached; never loop-retry
            # a merge POST. A 404 here is terminal for this run
            # (transient or PR-specific per the #100/#102 evidence) —
            # it is reported, not re-attempted.
            state = pr_state(pr["number"])
            kind = "API squash-merge 404" if "404" in str(e) \
                else "squash-merge API failure"
            fail(f"{kind} on PR #{pr['number']} (reported once, NOT "
                 f"retried): {e}. Waited-on head: {head_sha}. PR "
                 f"state: {state}")
        merge_sha = merged["sha"]
        print(f"pr-flow-deploy: squash-merged PR #{pr['number']} -> "
              f"{merge_sha[:12]}", flush=True)
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
              f"tree={main_tree[:12]} (matches PR head tree)", flush=True)
        print(f"NOTE: HTML purge + live-bytes verification remain the "
              f"caller's job (deploy-procedure §1 steps 4-5).", flush=True)
        print(f"RESULT: PRFLOW-MERGED {pr['html_url']} {merge_sha}", flush=True)
        return 0
    fail("merge loop exhausted (unreachable)")


if __name__ == "__main__":
    sys.exit(main())
