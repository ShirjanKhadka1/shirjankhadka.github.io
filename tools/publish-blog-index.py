#!/usr/bin/env python3
"""publish-blog-index.py — blog index daily rebuild, data-branch path.

2026-11-04 migration (Charter v5 item 6, blog-index lane): the old
runner deployed data/blog-index.json through pr-flow-deploy.py (PR
against protected main + check polls). That path died on 2026-11-03:
the run started 18:05, its PR (#356) got two merge-updates as main
moved underneath it (last branch merge 18:39), and the session was
SIGTERM'd during the third check re-poll with the PR still open and
nothing merged — main's index is still the 2026-11-01 copy (69
articles) while the Nov-2 (70) and Nov-3 (71) rebuilds never landed.
The check-poll loop restarts its clock on every main move, so its
runtime is unbounded on a fast-moving main; this driver replaces it
with a bounded path whose runtime does not depend on main churn:
data-branch writer (rebase-and-retry internally, never force) +
Publish wait on an immutable snapshot + edge purge + served-byte
verification. Worst case is roughly writer 10 min + publish-wait
15 min + purge/verify ~5 min, and no step restarts when main moves.

PIPELINE (all inside one fresh ephemeral checkout, removed on exit
even on failure — never /tmp, which is a 512M tmpfs that does not
reliably fit a full site checkout; cleanup catches BaseException
because SystemExit would otherwise leak the scratch dir):
  1. fresh ephemeral checkout of origin/main;
  2. ownership guard: data/blog-index.json must not already be
     declared under a different manifest component;
  3. tools/build-blog-index.py + tools/verify-blog.py, unchanged
     content logic — this migration touches ONLY the deploy path
     (the blog-index writer is a JOINT lane: the other agent owns
     blog publishing/content; this driver owns index deployment);
  4. no-change gate: rebuilt index normalized (top-level `generated`
     timestamp ignored) equal to main's copy => SILENT, nothing
     staged. NOTE: main's copy goes stale after migration (the
     writer path never writes main), so a second gate applies at
     stage time: writer NO-CHANGES => SILENT too (with a served
     check), so a no-new-article day never triggers a Publish;
  5. stage via the shared data-branch writer (component blog-index,
     single path data/blog-index.json — no other component declares
     it, so no --manifest-paths is needed and no shared multi-writer
     output (health.json, status/index.html, jobs.json, manifests)
     is claimed here);
  6. publish-wait on the staged snapshot (timeout 900, interval 30),
     then purge the index URL + the /blog/ landing, then verify the
     served bytes match the staged bytes (normalized) before
     reporting DEPLOYED. A staged-but-unverified run FAILS loud —
     it is never reported as done.

Deliberately NOT done here: the landing rebuild
(tools/build-blog-landing.py) — the live landing re-renders from
the index client-side, so a new article appears on /blog/ without
a landing rebuild, exactly as the old runner intended. The old
runner's SKIP_SYNC test hook is gone: the checkout is always fresh.
The old runner's pr-flow deploy, main-ref verify, and every
--force path are DELETED, not left as a fallback flag.

Exit codes: 0 with a final `RESULT: SILENT` / `RESULT: DEPLOYED
<count> articles` / `RESULT: DRY-RUN-CHANGE count=<n>` line;
non-zero with a loud failure (the cron wrapper retries once, then
fails loud). --dry-run builds + verifies only: no data-branch
write, no Publish dispatch, no purge.
"""

import argparse
import base64
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
SOURCE_REPO = os.path.join(HOME, "workspace", "wave8-build", "repo")
WRITER = os.path.join(HOME, "workspace", "tools", "data-branch-writer.py")
PUBLISH_WAIT = os.path.join(HOME, "workspace", "tools", "publish-wait.py")
PURGE = os.path.join(HOME, "workspace", "custom-connectors",
                     "custom.cloudflare", "bin", "cloudflare-purge-url.py")
REPO = "ShirjanKhadka1/shirjankhadka.github.io"
DATA_BRANCH = "data"

INDEX = "data/blog-index.json"
COMPONENT = "blog-index"

LIVE_URLS = ["https://shirjankhadka.com.np/data/blog-index.json",
             "https://shirjankhadka.com.np/blog/"]
INDEX_URL = LIVE_URLS[0]

WRITER_ENV = dict(os.environ,
                  PYTHONPATH="/opt/muse/skills/custom-connector-setup/bin")
NPT = dt.timezone(dt.timedelta(hours=5, minutes=45))
UA = "Mozilla/5.0"


def log(msg):
    print(msg, flush=True)


def _git_out(args, cwd):
    r = subprocess.run(["git", "-c", "http.version=HTTP/1.1"] + args,
                       cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed rc={r.returncode}: "
                         f"{r.stdout[-500:]} {r.stderr[-500:]}")
    return r.stdout.strip()


def prepare_ephemeral_worktree():
    """Fresh ephemeral checkout of origin/main. Mirrors the
    contributors/actions-daily publishers (NOT /tmp: /tmp is a 512M
    tmpfs and a full site checkout does not fit reliably). Cleanup
    catches BaseException: SystemExit would otherwise leak the
    scratch dir on exactly the loud-failure path."""
    base = os.path.join(HOME, "workspace", ".ephemeral-checkouts")
    os.makedirs(base, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="blog-index-", dir=base)
    try:
        last = None
        for attempt in (1, 2, 3):
            try:
                _git_out(["fetch", "origin", "main"], SOURCE_REPO)
                break
            except SystemExit as e:
                last = e
                if attempt < 3:
                    time.sleep(10 * attempt)
        else:
            raise last
        tip = _git_out(["rev-parse", "origin/main"], SOURCE_REPO)
        _git_out(["worktree", "add", "--detach", tmp, "origin/main"],
                 SOURCE_REPO)
        head = _git_out(["rev-parse", "HEAD"], tmp)
        if head != tip:
            raise SystemExit(f"ephemeral checkout HEAD {head} != "
                             f"origin/main {tip}")
        log(f"ephemeral checkout {tmp} at origin/main {tip[:8]}")
        return tmp
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        subprocess.run(["git", "-c", "http.version=HTTP/1.1",
                        "worktree", "prune"],
                       cwd=SOURCE_REPO, capture_output=True, text=True)
        raise


def remove_ephemeral_worktree(tmp):
    # No --force anywhere: delete the scratch dir, prune metadata
    # (prune only drops entries whose dir no longer exists).
    shutil.rmtree(tmp, ignore_errors=True)
    subprocess.run(["git", "-c", "http.version=HTTP/1.1",
                    "worktree", "prune"],
                   cwd=SOURCE_REPO, capture_output=True, text=True)


def _gh_api(method, path):
    """Authenticated read via the surrogate credential (keyword-only
    allowed_hosts is REQUIRED). Returns (status, parsed-or-None)."""
    sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
    from dynamic_credentials import add_surrogate_to_request
    url = f"https://api.github.com/repos/{REPO}{path}"
    req = urllib.request.Request(
        url, method=method,
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "muse-blog-index"})
    add_surrogate_to_request(req, "custom.github",
                             allowed_hosts=["api.github.com"])
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}
        except ValueError:
            return e.code, {}


def get_data_manifest():
    s, b = _gh_api("GET", f"/contents/data/_manifest.json?ref={DATA_BRANCH}")
    if s != 200 or not isinstance(b, dict) or "content" not in b:
        raise SystemExit(f"manifest: data-branch fetch failed (HTTP {s}); "
                         "refusing to stage on a guess")
    try:
        man = json.loads(base64.b64decode(b["content"]))
    except ValueError as e:
        raise SystemExit(f"manifest: not valid JSON ({e})")
    if not isinstance(man, dict) or not man:
        raise SystemExit("manifest: empty or not an object")
    return man


def run_tool(args, cwd, what):
    """Run a builder/verifier step, streaming nothing but logging the
    outcome. Output is printed in full (flush) so a later kill never
    leaves a black hole like the Nov-3 log, which ended at the
    verifier because pr-flow's output was captured and only flushed
    on success."""
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.stdout:
        log(f"{what} stdout:\n{r.stdout}")
    if r.stderr:
        log(f"{what} stderr:\n{r.stderr}")
    if r.returncode != 0:
        raise SystemExit(f"{what} failed rc={r.returncode}")
    log(f"{what}: ok")


def norm_doc(doc):
    d = dict(doc)
    d.pop("generated", None)
    return d


def curl_bytes(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA,
                      "Cache-Control": "no-cache",
                      "Pragma": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def served_matches(want_doc, label):
    """Served index normalized-equal to the staged doc? Transport
    trouble raises (caller decides warn vs fail); a parsed but
    different document returns False."""
    raw = curl_bytes(INDEX_URL)
    live = json.loads(raw)
    ok = norm_doc(live) == norm_doc(want_doc)
    log(f"served check {label}: live count={live.get('count')} "
        f"want={want_doc.get('count')} match={ok}")
    return ok


def writer_stage(asof, message, local_path):
    args = [sys.executable, WRITER, "--component", COMPONENT,
            "--asof", asof, "--message", message,
            "--file", f"{INDEX}:{local_path}"]
    r = subprocess.run(args, capture_output=True, text=True,
                       timeout=600, env=WRITER_ENV)
    log(f"deploy: data-branch-writer stdout:\n{r.stdout}")
    if r.stderr:
        log(f"deploy: data-branch-writer stderr:\n{r.stderr}")
    if r.returncode != 0:
        raise SystemExit(f"writer failed rc={r.returncode}")
    proof = None
    for line in reversed(r.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                proof = json.loads(line)
                break
            except ValueError:
                continue
    if proof is None:
        raise SystemExit("deploy: no proof JSON from data-branch-writer")
    if proof.get("status") not in ("WRITTEN", "NO-CHANGES"):
        raise SystemExit(f"deploy: writer status={proof.get('status')!r}; "
                         "refusing to publish")
    return proof


def publish_wait_streaming(snap):
    """publish-wait with line-streamed output (never capture-then-
    print: a kill mid-wait must leave the snapshot + run id in the
    log, not in a lost buffer). Returns the Publish tag."""
    proc = subprocess.Popen(
        [sys.executable, PUBLISH_WAIT, "--snapshot", snap,
         "--timeout", "900", "--interval", "30"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, env=WRITER_ENV)
    published = []
    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            log(f"publish-wait: {line}")
            if line.startswith("PUBLISHED "):
                published.append(line)
    finally:
        proc.wait()
    if proc.returncode != 0:
        raise SystemExit(f"publish-wait failed rc={proc.returncode}")
    if not published:
        raise SystemExit("deploy: no PUBLISHED line from publish-wait")
    tag = published[-1].split()[-1]
    log(f"deploy: {published[-1]}")
    return tag


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="build + verify only; stage nothing, dispatch "
                         "no Publish, no purge (safe proof mode)")
    args = ap.parse_args()
    today = dt.datetime.now(NPT).date().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", today):
        raise SystemExit(f"bad asof {today!r}")

    wt = prepare_ephemeral_worktree()
    try:
        # --- ownership guard: no other component may already claim
        # this lane's single path (a second claimant would mean the
        # manifest — and therefore Publish assembly — is contested).
        manifest = get_data_manifest()
        for comp, entry in manifest.items():
            if comp != COMPONENT and isinstance(entry, dict) \
                    and INDEX in entry.get("paths", []):
                raise SystemExit(
                    f"manifest: {INDEX} already declared under "
                    f"component {comp!r}; ownership changed — "
                    "refusing to stage it")
        log(f"manifest guard ok (blog-index entry present: "
            f"{COMPONENT in manifest})")

        index_path = os.path.join(wt, INDEX)
        with open(index_path, "rb") as f:
            old_bytes = f.read()
        old_doc = json.loads(old_bytes)
        log(f"old index: count={old_doc.get('count')} "
            f"generated={old_doc.get('generated')}")

        # --- build + verify (content logic untouched by migration)
        run_tool([sys.executable, "tools/build-blog-index.py",
                  "--worktree", wt], wt, "builder")
        run_tool([sys.executable, "tools/verify-blog.py",
                  "--worktree", wt], wt, "verifier")

        with open(index_path, "rb") as f:
            new_doc = json.loads(f.read())
        count = new_doc.get("count")
        log(f"rebuilt index: count={count}")

        if norm_doc(new_doc) == norm_doc(old_doc):
            log("no change (normalized, ignoring `generated` "
                "timestamp) vs main's copy")
            try:
                if not served_matches(new_doc, "no-change"):
                    raise SystemExit(
                        "served index DIFFERS from the rebuilt index "
                        "on a no-change day (stale edge, or a newer "
                        "staged copy not yet published) — refusing "
                        "SILENT")
            except SystemExit:
                raise
            except Exception as e:
                log(f"WARNING: no-change served check unreachable "
                    f"({e}); staying SILENT on transport trouble only")
            print("RESULT: SILENT")
            return 0

        log(f"change: main copy count={old_doc.get('count')} -> "
            f"rebuilt count={count}")
        if args.dry_run:
            log("DRY-RUN: would stage data/blog-index.json under "
                "component blog-index; no data-branch write, no "
                "Publish dispatch, no purge")
            print(f"RESULT: DRY-RUN-CHANGE count={count}")
            return 0

        # --- stage via the data-branch writer
        proof = writer_stage(
            today, f"Blog index rebuild ({count} articles)", index_path)
        tag = None
        if proof.get("status") == "WRITTEN":
            snap = proof.get("commit")
            if not snap:
                raise SystemExit("deploy: writer proof has no commit SHA")
            log(f"deploy: staged data commit {snap}; waiting for Publish")
            tag = publish_wait_streaming(snap)
        else:
            # NO-CHANGES: main's copy is stale (writer path never
            # writes main), but the data branch already holds these
            # exact bytes — another run landed them. Nothing new to
            # publish, but the served bytes still get verified below.
            log("deploy: writer NO-CHANGES (data branch already holds "
                "these bytes); skipping Publish wait")

        pg = subprocess.run([sys.executable, PURGE] + LIVE_URLS,
                            capture_output=True, text=True, timeout=300,
                            env=WRITER_ENV)
        log(f"deploy: purge rc={pg.returncode} "
            f"out={pg.stdout.strip()} err={pg.stderr.strip()}")
        time.sleep(30)
        for attempt in (1, 2, 3):
            try:
                if served_matches(new_doc, f"publish {attempt}"):
                    if tag:
                        log(f"deploy: LIVE VERIFIED count={count} "
                            f"(Publish tag {tag})")
                    else:
                        log(f"deploy: LIVE VERIFIED count={count} "
                            "(already staged, no new Publish)")
                    print(f"RESULT: DEPLOYED {count} articles"
                          if tag else "RESULT: SILENT")
                    return 0
            except Exception as e:
                log(f"deploy: served check {attempt} failed: {e}")
            if attempt < 3:
                time.sleep(45)
        raise SystemExit("deploy: served verification failed after "
                         "3 attempts")
    finally:
        remove_ephemeral_worktree(wt)


if __name__ == "__main__":
    main()
