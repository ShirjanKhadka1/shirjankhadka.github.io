#!/usr/bin/env python3
"""Batched intraday publisher for Nepse Decode (PR-flow era).

PROBLEM: per-tick PRs cannot keep up with the ~20-minute required gate
(quality alone is 15-16 min), and the live-quotes workflow's own timeout is
15 min. Per-tick PRs would pile up and land late/out of order.

MODEL (15-minute batched windows, full gate preserved):
- Tick collectors (nepse-live-quotes.yml) write every fresh snapshot to the
  UNPROTECTED branch `intraday-staging` (fast-forward only, never
  force-push). Staging pushes are not gated by main's protection, so
  collection never blocks on CI.
- This publisher runs every 15 min (goal cron `intraday-batched-publisher`).
  Each run takes the LATEST staged state (ticks inside a window collapse to
  the newest value; intraday files are full snapshots, so nothing is lost)
  and moves it to main through ONE PR under the FULL existing gate.
- ONE-PR-IN-FLIGHT: while a publisher PR is in checks, later runs wait. A
  PR whose checks stay pending >= 45 min is closed UNMERGED and the next
  run proceeds with newer state (full snapshots: closing it loses nothing).
  A PR that goes green is merged by the next run that sees it green (or by
  the same run if it greens inside the poll window).
- NEVER REGRESS: a snapshot is published only if it is strictly newer than
  main's live.json (by data_asof). A PR whose content is older than main's
  (e.g. close-capture landed first) is closed unmerged, never merged.

FRESHNESS GUARDS (normal mode; ALL must pass or the run SKIP, exit 0):
- staged market == "OPEN" (closing snapshots belong to close-capture, which
  validates the close; the publisher never publishes a CLOSED snapshot).
- staged data_asof date == today (Asia/Kathmandu) and time in [10:45, 15:00)
  NPT (intraday window; 15:00+ snapshots are the close's job).
- staged data_asof strictly newer than main's live.json data_asof.
- staged data_asof not more than 10 min in the future (clock sanity).
- staged quotes count >= 150 (early-session ramp floor; a smaller board is
  a broken pull, not a publishable snapshot).
- staged bytes differ from main bytes (else there is nothing to publish).

CLOSE MODE (fallback close publisher — fixes the CLOSED-stage silent skip):
- When the OPEN guards fail AND close_check passes, the run publishes in
  CLOSE mode: same branch/PR/poll flow, but the PR is marked CLOSE
  (provisional — a staged fetcher read, NOT the floorsheet-validated
  close; the validated close supersedes it).
- close_check requires: staged market == "CLOSED", staged session_date ==
  today AND staged asof date == today (a stale tape can never pass as
  fresh), staged asof strictly newer than main, not >10 min in the
  future, quotes >= 150 — AND main must NOT already hold today's close
  (market CLOSED + session_date == today). The last guard is essential:
  a staged close's fetch-time asof runs LATER than a validated close's
  session-time asof, so asof comparison alone would let a provisional
  read overwrite a validated close.
- RACE (documented): publisher CLOSE PR vs close-capture validated PR —
  whoever merges first wins; the publisher's merge-time re-check blocks
  equal/older asofs, and main_holds_todays_close blocks a provisional
  merge over a validated close. A validated close-capture PR can merge
  AFTER a provisional one and overwrite it (desired supersede).
- KNOWN RESIDUAL (documented, not silently fixed): close-capture's no-op
  (close:true + today -> no-op) means automated close-capture will no-op
  after a provisional close merges; a same-evening supersede then needs
  a worker-driven floorsheet correction (which bypasses capture-close.js)
  or the next session.

CLOSE-HANDOFF (OPEN PRs pending at 15:00 close unmerged, never merge
post-bell — enforced at all three merge points):
- main() pre-pass: close_open_prs_post_bell closes any open publisher PR
  whose OWN live.json is OPEN when now >= 15:00 NPT (content-based, so a
  CLOSE-mode run never inherits an OPEN PR).
- handle_open_pr green branch + fresh-PR poll-loop green branch: an
  OPEN-content PR greening post-bell is closed unmerged, never merged.
- CLOSE merge guard: a CLOSE PR is never merged before 15:40 NPT
  (close-capture owns 15:25-15:40: 15:25 run + 10-min retry). A green
  CLOSE PR before 15:40 returns WAIT and stays open green; the 45-min
  stale rule only closes PENDING PRs, so the wait is safe.

PROOF MODE (--proof): bypasses the freshness guards (a fixture snapshot may
be historical) but otherwise runs the identical path: staging read ->
branch -> PR -> poll all 5 required checks -> REQUIRE green -> CLOSE
UNMERGED + delete branch. Proof mode NEVER merges (code-enforced); a proof
PR is mechanics evidence only, never a publish. Exit 0 iff all 5 required
checks went green before the close; exit 1 otherwise.

MERGE PATH: API squash-merge first. A 404 is reported, NOT retried in a
loop and NOT worked around with a UI merge from here: the PR stays open
and green, and the next publisher run retries the merge. Never merge on
red checks, never bypass, never force-push, never push to main directly.

POST-MERGE: verify authenticated main ref == merge commit and main tree ==
PR head tree, purge live.json AND every tape-rendering page URL (TAPE_PAGE_URLS) from edge cache, then live-verify
the served live.json data_asof == staged data_asof (3 attempts, 60 s apart
for edge propagation).

USAGE (run from a checkout of main; the script owns --worktree):
  PYTHONPATH=/opt/muse/skills/custom-connector-setup/bin python3 -u \\
      tools/publish-intraday-batch.py --worktree ~/workspace/wt-intraday-publish
  ... --proof   (fixture proof run; never merges)

EXIT: 0 = MERGED / OPENED / WAIT / SKIP / PROOF-PASS; 1 = FAIL / PROOF-FAIL.
Every run prints exactly one RESULT line as its last line.
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

REPO = "ShirjanKhadka1/shirjankhadka.github.io"
STAGING_BRANCH = "intraday-staging"
PUBLISH_PREFIX = "deploy/intraday-publish-"
LIVE_PATH = "nepse-chart/data/live.json"
LIVE_URL = "https://shirjankhadka.com.np/nepse-chart/data/live.json"
NPT = timezone(timedelta(hours=5, minutes=45))
# Required checks, matched by substring against check-run names (the panel
# shows them as "<workflow> / <job> (pull_request)"; substrings are stable).
REQUIRED_CHECKS = [
    "quality",
    "Screener figures match the archive",
    "Verdict invariants hold on the shipped batch",
    "axe contrast 0 nodes",
    "Lighthouse budgets + Playwright smoke",
]
STALE_MINUTES = 45
POLL_SECONDS = 25 * 60
POLL_INTERVAL = 60
MIN_QUOTES = 150
PUSHER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.legacy-github/bin/github-push-parallel.py"
)
PURGE_HELPER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.cloudflare/bin/cloudflare-purge-url.py"
)

# Tape-rendering pages whose edge HTML copy must be purged when live.json
# moves. These pages render live.json values via JS; their HTML edge copy
# can otherwise lag the tape by the HTML TTL even after the JSON is fresh.
# Purging HTML whose origin did not change is a content no-op, so this is
# belt-and-braces for the edge-HTML/pin edge case; the load-bearing purge
# remains the JSON purge. Stock pages are excluded deliberately: 431
# one-by-one purges per run is infeasible, and their live line is a JSON
# fetch with a short TTL, so no HTML purge is needed there.
TAPE_PAGE_URLS = [
    "https://shirjankhadka.com.np/nepse-decode/",
    "https://shirjankhadka.com.np/nepse-decode/index.html",
    "https://shirjankhadka.com.np/nepse-daily/",
    "https://shirjankhadka.com.np/nepse-daily/index.html",
    "https://shirjankhadka.com.np/nepse-sectors/",
    "https://shirjankhadka.com.np/nepse-sectors/index.html",
]
# Close-handoff: a CLOSE-mode PR is never merged before 15:40 NPT, so the
# 15:25 close-capture (plus its 10-min retry) owns the close window first.
CLOSE_MERGE_AFTER = (15, 40)
# Close-handoff: an OPEN-content PR still pending at 15:00 NPT is closed
# unmerged, never merged post-bell. Post-bell, only the close publishes.
OPEN_PR_BELL = (15, 0)




def log(msg):
    print(f"[intraday-publish] {msg}", flush=True)


def gh(method, path, data=None, ok=(200, 201, 202, 204)):
    req = urllib.request.Request(
        "https://api.github.com" + path,
        method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "NepseDecode"},
    )
    add_surrogate_to_request(req, "custom.github", allowed_hosts=["api.github.com"])
    try:
        with urllib.request.urlopen(req) as r:
            body = read_json_response(r) if r.status != 204 else None
            return r.status, body
    except urllib.error.HTTPError as e:
        raw = e.read().decode()[:400]
        if e.code in ok:
            return e.code, None
        return e.code, raw


def gh_or_die(method, path, data=None):
    status, body = gh(method, path, data)
    if status not in (200, 201, 202, 204):
        raise RuntimeError(f"GitHub {method} {path} -> {status}: {body}")
    return body


def sh(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def npt_now():
    return datetime.now(timezone.utc).astimezone(NPT)


def parse_snapshot(raw):
    """Return (asof_datetime_utc, market, n_quotes) or raise ValueError."""
    d = json.loads(raw.decode())
    asof = datetime.fromisoformat(d["asof"].replace("Z", "+00:00"))
    if asof.tzinfo is None:
        asof = asof.replace(tzinfo=timezone.utc)
    quotes = d.get("quotes") or []
    return asof, d.get("market"), len(quotes)


def parse_tape(raw):
    """Parse a live.json snapshot into a dict (asof, market, session_date,
    n_quotes, close) or raise ValueError. session_date falls back to the
    asof NPT date when the field is missing (old snapshots)."""
    d = json.loads(raw.decode())
    asof = datetime.fromisoformat(d["asof"].replace("Z", "+00:00"))
    if asof.tzinfo is None:
        asof = asof.replace(tzinfo=timezone.utc)
    sess = d.get("session_date") or asof.astimezone(NPT).date().isoformat()
    quotes = d.get("quotes") or []
    return {"asof": asof, "market": d.get("market"), "session_date": sess,
            "n_quotes": len(quotes), "close": d.get("close")}


def main_holds_todays_close(main_raw):
    """True iff main already carries TODAY's close (market CLOSED with
    session_date == today NPT). A publisher CLOSE publish must never
    overwrite it: the validated close wins, and a later staged fetch-time
    asof must not outrank it (fetch-time asofs run later than the session
    close-time asof a validated close carries)."""
    try:
        m = parse_tape(main_raw)
    except Exception:
        return False
    return m["market"] == "CLOSED" and m["session_date"] == npt_now().date().isoformat()


def close_check(staged_raw, main_raw):
    """Return None if the staged snapshot qualifies as a CLOSE publish,
    else a SKIP reason string. CLOSE mode is the FALLBACK close publisher:
    it fires only when close-capture has not landed a validated close.
    It NEVER publishes a stale tape as fresh: session_date AND asof date
    must both be today, and main must not already hold today's close."""
    if staged_raw == main_raw:
        return "staged bytes equal main bytes (nothing to publish)"
    try:
        s = parse_tape(staged_raw)
    except Exception as e:
        return f"staged live.json unparsable ({e})"
    now = npt_now()
    today = now.date().isoformat()
    if s["market"] != "CLOSED":
        return f"staged market is {s['market']!r}, not CLOSED (not a closing snapshot)"
    if s["session_date"] != today:
        return f"staged session_date {s['session_date']} != today {today}"
    if s["asof"].astimezone(NPT).date().isoformat() != today:
        return f"staged asof date {s['asof'].astimezone(NPT).date()} != today {today}"
    if main_holds_todays_close(main_raw):
        return "main already holds today's close (validated close wins; not overwriting)"
    try:
        m_asof, _, _ = parse_snapshot(main_raw)
    except Exception:
        m_asof = datetime(1970, 1, 1, tzinfo=timezone.utc)
    if s["asof"] <= m_asof:
        return f"staged asof {s['asof'].isoformat()} not newer than main {m_asof.isoformat()}"
    if s["asof"] > datetime.now(timezone.utc) + timedelta(minutes=10):
        return "staged asof more than 10 min in the future (clock sanity)"
    if s["n_quotes"] < MIN_QUOTES:
        return f"staged quotes {s['n_quotes']} < floor {MIN_QUOTES}"
    return None


def close_open_prs_post_bell(open_prs):
    """Close-handoff pre-pass (content-based): at/after 15:00 NPT, any open
    publisher PR whose OWN live.json is an OPEN snapshot is closed
    unmerged, never merged post-bell. CLOSE-content PRs stand. Before
    15:00 the list is returned untouched. Returns the PRs left standing."""
    now = npt_now()
    if (now.hour, now.minute) < OPEN_PR_BELL:
        return open_prs
    standing = []
    for pr in open_prs:
        market = None
        try:
            live = get_branch_file(pr["head"]["sha"], LIVE_PATH)
            market = parse_tape(live)["market"] if live is not None else None
        except Exception:
            market = None
        if market == "OPEN":
            log(f"close-handoff: PR #{pr['number']} carries an OPEN snapshot post-bell; closing unmerged")
            close_pr(pr)
        else:
            standing.append(pr)
    return standing


def freshness_check(staged_raw, main_raw):
    """Return None if publishable, else a SKIP reason string."""
    try:
        s_asof, s_market, s_n = parse_snapshot(staged_raw)
    except Exception as e:
        return f"staged live.json unparsable ({e})"
    try:
        m_asof, _, _ = parse_snapshot(main_raw)
    except Exception:
        m_asof = datetime(1970, 1, 1, tzinfo=timezone.utc)
    now = npt_now()
    s_npt = s_asof.astimezone(NPT)
    if s_market != "OPEN":
        return f"staged market is {s_market!r}, not OPEN (closing snapshots belong to close-capture)"
    if s_npt.date() != now.date():
        return f"staged asof date {s_npt.date()} != today {now.date()}"
    if not ((10, 45) <= (s_npt.hour, s_npt.minute) < (15, 0)):
        return f"staged asof time {s_npt.strftime('%H:%M')} outside intraday window 10:45-15:00 NPT"
    if s_asof <= m_asof:
        return f"staged asof {s_asof.isoformat()} not newer than main {m_asof.isoformat()}"
    if s_asof > datetime.now(timezone.utc) + timedelta(minutes=10):
        return "staged asof more than 10 min in the future (clock sanity)"
    if s_n < MIN_QUOTES:
        return f"staged quotes {s_n} < floor {MIN_QUOTES}"
    return None


def get_branch_file(branch, path):
    status, body = gh("GET", f"/repos/{REPO}/contents/{path}?ref={branch}")
    if status != 200:
        return None
    return base64.b64decode(body["content"])


def get_main_tip():
    return gh_or_die("GET", f"/repos/{REPO}/commits/main")["sha"]


def get_commit_tree(sha):
    return gh_or_die("GET", f"/repos/{REPO}/git/commits/{sha}")["tree"]["sha"]


def list_open_publisher_prs():
    prs = gh_or_die("GET", f"/repos/{REPO}/pulls?state=open&per_page=100")
    return [p for p in prs if p["head"]["ref"].startswith(PUBLISH_PREFIX)]


def check_states(head_sha):
    """Map each required check -> 'green' | 'pending' | 'failed' | 'missing'."""
    runs = gh_or_die(
        "GET", f"/repos/{REPO}/commits/{head_sha}/check-runs?per_page=100"
    )["check_runs"]
    out = {}
    for want in REQUIRED_CHECKS:
        matches = [r for r in runs if want in r["name"]]
        if not matches:
            out[want] = "missing"
            continue
        # Latest run wins (highest id).
        r = max(matches, key=lambda x: x["id"])
        if r["status"] != "completed":
            out[want] = "pending"
        elif r["conclusion"] == "success":
            out[want] = "green"
        else:
            out[want] = "failed"
    return out


def pr_age_minutes(pr):
    created = datetime.fromisoformat(pr["created_at"].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - created).total_seconds() / 60.0


def close_pr(pr):
    gh_or_die("PATCH", f"/repos/{REPO}/pulls/{pr['number']}", {"state": "closed"})
    # Best-effort branch cleanup; a leftover branch is harmless.
    gh("DELETE", f"/repos/{REPO}/git/refs/heads/{pr['head']['ref']}")
    log(f"closed PR #{pr['number']} unmerged")


def update_branch(pr):
    head = pr["head"]["sha"]
    status, body = gh(
        "POST",
        f"/repos/{REPO}/pulls/{pr['number']}/update-branch",
        {"expected_head_sha": head},
    )
    if status == 202:
        log(f"update-branch accepted for PR #{pr['number']}")
        return True
    log(f"update-branch for PR #{pr['number']} -> {status}: {body}")
    return False


def merge_pr(pr):
    status, body = gh(
        "PUT",
        f"/repos/{REPO}/pulls/{pr['number']}/merge",
        {"merge_method": "squash"},
    )
    if status == 200:
        return body["sha"]
    log(f"merge PR #{pr['number']} -> {status}: {body}")
    return None


def ensure_branch(branch, base_sha):
    """The parallel pusher 404s on a nonexistent branch ref, so create it at
    `base_sha` first (tonight's proven pattern). Idempotent for fresh names."""
    status, _ = gh("GET", f"/repos/{REPO}/git/refs/heads/{branch}")
    if status == 200:
        return
    status, body = gh(
        "POST",
        f"/repos/{REPO}/git/refs",
        {"ref": f"refs/heads/{branch}", "sha": base_sha},
    )
    if status != 201:
        raise RuntimeError(f"create branch ref {branch} -> {status}: {body}")


def build_and_push_branch(worktree, branch_prefix, live_bytes):
    """Create a local commit (main tree + staged live.json) and push it to a
    fresh timestamped branch via the parallel pusher (lease-checked
    fast-forward). Returns (branch, local_commit, tree_sha). Retries once
    with a NEW branch name if main moved mid-run (a reused name would trip
    the pusher's tip==base lease check after the first attempt created it)."""
    for attempt in (1, 2):
        sh(["git", "fetch", "origin", "main"], cwd=worktree)
        sh(["git", "reset", "--hard", "HEAD"], cwd=worktree)
        base = sh(["git", "rev-parse", "origin/main"], cwd=worktree)
        branch = branch_prefix + npt_now().strftime("%Y%m%d-%H%M%S")
        sh(["git", "checkout", "-B", "publish-tmp", base], cwd=worktree)
        target = os.path.join(worktree, LIVE_PATH)
        with open(target, "wb") as f:
            f.write(live_bytes)
        sh(["git", "add", LIVE_PATH], cwd=worktree)
        # diff --cached --quiet exits 0 = NO differences, 1 = differences.
        # Commit only when the staged snapshot actually differs from HEAD.
        if subprocess.run(
            ["git", "diff", "--cached", "--quiet"], cwd=worktree
        ).returncode != 0:
            sh(
                ["git", "commit", "-m", "Intraday: live snapshot (batched publish)"],
                cwd=worktree,
            )
        else:
            raise RuntimeError("staged bytes equal main bytes at build time; nothing to publish")
        local = sh(["git", "rev-parse", "HEAD"], cwd=worktree)
        ensure_branch(branch, base)
        env = dict(os.environ, PYTHONPATH="/opt/muse/skills/custom-connector-setup/bin")
        proc = subprocess.run(
            [
                sys.executable,
                PUSHER,
                "--repo",
                REPO,
                "--branch",
                branch,
                "--base-sha",
                base,
                "--local-ref",
                local,
                "--message",
                "Intraday: live snapshot (batched publish)",
            ],
            cwd=worktree,
            env=env,
            capture_output=True,
            text=True,
        )
        tail = (proc.stdout.strip().splitlines() or [""]) [-1]
        log(f"pusher: {tail}")
        # The pusher prints "Deployed <branch> -> <sha>" to STDERR and the
        # bare commit SHA to STDOUT. Trust neither string alone: verify the
        # branch ref actually points at the pushed commit.
        if proc.returncode == 0:
            pushed_sha = (proc.stdout.strip().splitlines() or [""]) [-1].strip()
            status, ref = gh("GET", f"/repos/{REPO}/git/refs/heads/{branch}")
            if status == 200 and ref["object"]["sha"] == pushed_sha:
                tree = sh(["git", "rev-parse", f"{local}^{{tree}}"], cwd=worktree)
                return branch, local, tree
            log(f"pusher ref verification failed: ref={ref}")
        else:
            log(f"pusher attempt {attempt} failed: {proc.stderr.strip()[-300:]}")
    raise RuntimeError("parallel pusher failed twice; aborting (main may be moving fast)")


def open_pr(branch, asof_npt, draft=False, mode="OPEN"):
    body = (
        "Batched intraday publish: latest staged live snapshot "
        f"(asof {asof_npt} NPT, PROVISIONAL) through the full required gate. "
        "Ticks inside the window collapse to the newest value; intraday files "
        "are full snapshots. Closing snapshots are NOT published by this job "
        "(close-capture owns the validated close)."
    )
    if mode == "CLOSE":
        body = (
            "CLOSE (provisional): latest staged CLOSED snapshot "
            f"(asof {asof_npt} NPT) through the full required gate. This is "
            "a staged fetcher read, NOT the floorsheet-validated close; the "
            "validated close supersedes it when it lands. Fires only because "
            "close-capture has not landed today's validated close yet."
        )
    if draft:
        body = ("[PROOF RUN — DO NOT MERGE] Mechanics proof only; this PR is "
                "opened as a draft and will be closed unmerged by the proof "
                "run itself. It must never be merged.\n\n" + body)
    pr = gh_or_die(
        "POST",
        f"/repos/{REPO}/pulls",
        {
            "title": ("[PROOF — DO NOT MERGE] " if draft else "")
            + (f"Close: live snapshot {asof_npt} (provisional close, batched publish)"
               if mode == "CLOSE" else f"Intraday: live snapshot {asof_npt} (batched publish)"),
            "head": branch,
            "base": "main",
            "body": body,
            "draft": draft,
        },
    )
    return pr


def verify_pr_files(pr_number):
    files = gh_or_die("GET", f"/repos/{REPO}/pulls/{pr_number}/files?per_page=100")
    names = [f["filename"] for f in files]
    if names != [LIVE_PATH]:
        raise RuntimeError(f"publisher PR touches unexpected files: {names}")


def purge_and_live_verify(staged_raw):
    # live.json first (load-bearing), then every tape-rendering page
    # (belt-and-braces for the edge-HTML/pin edge case). Purge failure
    # stays non-gating, logged only.
    for url in [LIVE_URL] + TAPE_PAGE_URLS:
        proc = subprocess.run(
            [sys.executable, PURGE_HELPER, url],
            capture_output=True,
            text=True,
        )
        log(f"purge {url} exit {proc.returncode}: {proc.stdout.strip()[-200:]}")
    want_asof, _, _ = parse_snapshot(staged_raw)
    for i in (1, 2, 3):
        try:
            with urllib.request.urlopen(
                urllib.request.Request(LIVE_URL, headers={"User-Agent": "NepseDecode"})
            ) as r:
                live_raw = r.read()
            live_asof, _, _ = parse_snapshot(live_raw)
            if live_asof == want_asof:
                log(f"live-verify PASS (attempt {i}): data_asof == staged asof")
                return True
            log(f"live-verify attempt {i}: live asof {live_asof} != staged {want_asof}")
        except Exception as e:
            log(f"live-verify attempt {i} error: {e}")
        time.sleep(60)
    return False


def handle_open_pr(pr, staged_raw, main_raw, proof, worktree, mode="OPEN"):
    """Deal with an already-open publisher PR. Returns a RESULT string or
    None if the caller should proceed to open a fresh PR."""
    head = pr["head"]["sha"]
    # Never merge content older than main's.
    pr_live = get_branch_file(head, LIVE_PATH)
    if pr_live is not None:
        try:
            pr_asof, _, _ = parse_snapshot(pr_live)
            m_asof, _, _ = parse_snapshot(main_raw)
            if pr_asof <= m_asof:
                log(f"PR #{pr['number']} content older than main; closing as superseded")
                close_pr(pr)
                return None
        except Exception as e:
            log(f"could not compare PR #{pr['number']} content ({e}); treating as pending")
    states = check_states(head)
    log(f"PR #{pr['number']} checks: {states}")
    if all(v == "green" for v in states.values()):
        base_sha = pr["base"]["sha"]
        if base_sha != get_main_tip():
            log(f"PR #{pr['number']} green but out-of-date; updating branch")
            if not update_branch(pr):
                return "RESULT: FAIL update-branch rejected for green PR"
            return "RESULT: WAIT updated green PR, re-poll next run"
        if proof:
            log("proof mode: green PR closed unmerged (never merged)")
            close_pr(pr)
            return "RESULT: PROOF-PASS"
        # Re-check freshness at merge time: main may have moved since the
        # content comparison above. Merging older content would REGRESS main.
        pr_live2 = get_branch_file(head, LIVE_PATH)
        cur_main = get_branch_file("main", LIVE_PATH)
        try:
            pr_asof2, _, _ = parse_snapshot(pr_live2)
            m_asof2, _, _ = parse_snapshot(cur_main)
            if pr_asof2 <= m_asof2:
                log("PR content no longer newer than main at merge time; closing")
                close_pr(pr)
                return None
        except Exception as e:
            log(f"merge-time re-check failed ({e}); refusing merge")
            return "RESULT: FAIL merge-time freshness re-check error; PR left open"
        # Close-handoff (content-based, mode-independent): an OPEN-content
        # PR must never merge post-bell, whatever the run's mode.
        try:
            pr_market = parse_tape(pr_live2)["market"]
        except Exception:
            pr_market = None
        if pr_market == "OPEN" and (npt_now().hour, npt_now().minute) >= OPEN_PR_BELL:
            log(f"close-handoff: PR #{pr['number']} carries an OPEN snapshot post-bell; closing unmerged")
            close_pr(pr)
            return None
        if mode == "CLOSE":
            # Merge-time close re-check: a validated close on main wins
            # over a provisional staged close even when the staged
            # fetch-time asof is later (see close_check).
            if main_holds_todays_close(cur_main):
                log("validated close already on main; provisional CLOSE PR closed unmerged")
                close_pr(pr)
                return None
            if (npt_now().hour, npt_now().minute) < CLOSE_MERGE_AFTER:
                log("CLOSE PR green before 15:40; waiting (close-capture owns 15:25-15:40)")
                return "RESULT: WAIT CLOSE PR green, waiting for 15:40 close-handoff"
        merged = merge_pr(pr)
        if merged is None:
            return "RESULT: FAIL api merge 404/failed; PR left open green for next run"
        head_tree = get_commit_tree(head)
        if get_main_tip() != merged or get_commit_tree(merged) != head_tree:
            return "RESULT: FAIL post-merge ref/tree mismatch"
        if not purge_and_live_verify(staged_raw):
            return "RESULT: FAIL merged but live-verify did not converge"
        gh("DELETE", f"/repos/{REPO}/git/refs/heads/{pr['head']['ref']}")
        return f"RESULT: MERGED {merged}"
    if any(v in ("failed",) for v in states.values()):
        log(f"PR #{pr['number']} has a failed required check; closing")
        close_pr(pr)
        return None
    # Pending (or missing = still starting).
    if pr_age_minutes(pr) >= STALE_MINUTES:
        log(f"PR #{pr['number']} pending >= {STALE_MINUTES} min; closing as stale")
        close_pr(pr)
        return None
    return "RESULT: WAIT publisher PR in checks"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", required=True)
    ap.add_argument("--proof", action="store_true")
    args = ap.parse_args()
    worktree = os.path.expanduser(args.worktree)

    try:
        staged_raw = get_branch_file(STAGING_BRANCH, LIVE_PATH)
        if staged_raw is None:
            print("RESULT: SKIP no staging branch or no staged live.json")
            return 0
        main_raw = get_branch_file("main", LIVE_PATH)
        if main_raw is None:
            print("RESULT: FAIL main live.json unreadable")
            return 1
        mode = "OPEN"
        if not args.proof:
            reason = freshness_check(staged_raw, main_raw)
            if reason:
                close_reason = close_check(staged_raw, main_raw)
                if close_reason is None:
                    mode = "CLOSE"
                    log("mode=CLOSE: staged CLOSED snapshot qualifies as fallback close publish")
                else:
                    print(f"RESULT: SKIP {reason} (close check: {close_reason})")
                    return 0
        elif staged_raw == main_raw:
            print("RESULT: FAIL proof needs staged != main (nothing to publish)")
            return 1

        # One-PR-in-flight: handle any open publisher PR first.
        open_prs = list_open_publisher_prs()
        if not args.proof:
            # Close-handoff pre-pass: never inherit an OPEN PR post-bell.
            open_prs = close_open_prs_post_bell(open_prs)
        if args.proof and open_prs:
            # A proof run must prove ITS OWN fresh PR, never inherit or close
            # a real publisher PR that might be in flight.
            print("RESULT: FAIL proof refused: open publisher PR(s) already exist")
            return 1
        if len(open_prs) > 1:
            log(f"WARNING: {len(open_prs)} open publisher PRs; handling newest")
        if open_prs:
            newest = max(open_prs, key=lambda p: p["created_at"])
            res = handle_open_pr(newest, staged_raw, main_raw, args.proof, worktree, mode=mode)
            if res is not None:
                print(res)
                return 0 if res.startswith(("RESULT: MERGED", "RESULT: WAIT", "RESULT: PROOF-PASS")) else 1
            # Closed (superseded/failed/stale) -> fall through to fresh PR.
            main_raw = get_branch_file("main", LIVE_PATH) or main_raw

        if args.proof and staged_raw == get_branch_file("main", LIVE_PATH):
            print("RESULT: FAIL staged == main after handling open PRs")
            return 1
        if not args.proof:
            # Main may have moved since the first read; never open a PR for
            # content that is no longer newer than main.
            fresh_main = get_branch_file("main", LIVE_PATH)
            if fresh_main is not None and staged_raw == fresh_main:
                print("RESULT: SKIP staged == main on re-check (main moved first)")
                return 0
            if mode == "CLOSE":
                # Main may have gained the validated close since the first
                # read; never open a provisional CLOSE PR over it.
                cur_main = get_branch_file("main", LIVE_PATH)
                if cur_main is not None and main_holds_todays_close(cur_main):
                    print("RESULT: SKIP validated close already on main; no provisional CLOSE PR")
                    return 0

        # Open a fresh PR with exactly the staged bytes.
        branch, _, tree = build_and_push_branch(worktree, PUBLISH_PREFIX, staged_raw)
        s_asof, _, _ = parse_snapshot(staged_raw)
        pr = open_pr(branch, s_asof.astimezone(NPT).strftime("%Y-%m-%d %H:%M"),
                     draft=args.proof, mode=mode)
        log(f"opened PR #{pr['number']} on {branch}")
        verify_pr_files(pr["number"])

        # Poll up to POLL_SECONDS; merge (normal) or close (proof) on green.
        head = pr["head"]["sha"]
        updates = 0
        deadline = time.time() + POLL_SECONDS
        while time.time() < deadline:
            states = check_states(head)
            log(f"PR #{pr['number']} checks: {states}")
            if all(v == "green" for v in states.values()):
                cur = gh_or_die("GET", f"/repos/{REPO}/pulls/{pr['number']}")
                if args.proof:
                    # Proof PRs are never merged, so up-to-date-ness is
                    # irrelevant — and update-branch 404s on draft PRs.
                    # Green is the whole proof: close and pass.
                    close_pr(cur)
                    print("RESULT: PROOF-PASS")
                    return 0
                if cur["base"]["sha"] != get_main_tip():
                    if updates < 2 and update_branch(cur):
                        updates += 1
                        head = gh_or_die("GET", f"/repos/{REPO}/pulls/{pr['number']}")["head"]["sha"]
                        time.sleep(POLL_INTERVAL)
                        continue
                    print("RESULT: WAIT green PR out-of-date; update cycles used")
                    return 0
                # Merge-time freshness re-check: main may have moved during
                # the poll (e.g. close-capture landed a newer live.json).
                # Merging older content would REGRESS main — close instead.
                cur_main = get_branch_file("main", LIVE_PATH)
                try:
                    s_asof, _, _ = parse_snapshot(staged_raw)
                    m_asof, _, _ = parse_snapshot(cur_main)
                    if s_asof <= m_asof:
                        close_pr(cur)
                        print("RESULT: SKIP staged no longer newer than main at merge time; PR closed")
                        return 0
                except Exception as e:
                    log(f"merge-time freshness re-check failed ({e}); refusing merge")
                    print("RESULT: FAIL merge-time freshness re-check error; PR left open")
                    return 1
                # Close-handoff (content-based): an OPEN snapshot must never
                # merge post-bell.
                if mode == "OPEN" and (npt_now().hour, npt_now().minute) >= OPEN_PR_BELL:
                    close_pr(cur)
                    print("RESULT: SKIP close-handoff: OPEN PR closed unmerged post-bell; next run handles the close")
                    return 0
                if mode == "CLOSE":
                    cur_main2 = get_branch_file("main", LIVE_PATH)
                    if cur_main2 is not None and main_holds_todays_close(cur_main2):
                        close_pr(cur)
                        print("RESULT: SKIP validated close already on main; provisional CLOSE PR closed unmerged")
                        return 0
                    if (npt_now().hour, npt_now().minute) < CLOSE_MERGE_AFTER:
                        print("RESULT: WAIT CLOSE PR green, waiting for 15:40 close-handoff")
                        return 0
                merged = merge_pr(cur)
                if merged is None:
                    print("RESULT: FAIL api merge failed; PR left open green for next run")
                    return 1
                if get_main_tip() != merged or get_commit_tree(merged) != get_commit_tree(head):
                    print("RESULT: FAIL post-merge ref/tree mismatch")
                    return 1
                if not purge_and_live_verify(staged_raw):
                    print("RESULT: FAIL merged but live-verify did not converge")
                    return 1
                gh("DELETE", f"/repos/{REPO}/git/refs/heads/{branch}")
                print(f"RESULT: MERGED {merged}")
                return 0
            if any(v == "failed" for v in states.values()):
                if args.proof:
                    print("RESULT: PROOF-FAIL a required check failed")
                    return 1
                close_pr(pr)
                print("RESULT: FAIL fresh PR failed a required check; closed, next window retries")
                return 1
            if args.proof and pr_age_minutes(pr) >= STALE_MINUTES:
                print("RESULT: PROOF-FAIL checks did not go green in time")
                return 1
            time.sleep(POLL_INTERVAL)
        print("RESULT: WAIT checks still pending at poll cap; next run handles it")
        return 0
    except Exception as e:
        print(f"RESULT: FAIL {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
