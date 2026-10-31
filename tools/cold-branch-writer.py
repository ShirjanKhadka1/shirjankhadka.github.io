#!/usr/bin/env python3
"""Cold-branch writer — the write path for the COLD archive (Phase A)
under branch protection.

COLD is an orphan `cold` branch in the SAME repo (R2 is optional
scale-out, not a gate). This writer mirrors the proven data-branch
writer pattern (tools/data-branch-writer.py, tools/news-data-writer.py)
without touching those files:

  * Blobs -> tree -> commit -> lease-checked fast-forward ref update.
    If the branch head moved under us, re-read the head and rebuild
    from the NEW head and retry, up to --retries times. Never
    force-push.
  * Disjoint paths: on the cold branch, the root holds README.md +
    manifest.json; partitions live under <dataset>/<year>/<month>.parquet;
    simulation partitions live ONLY under _simulation/ and never enter
    the real manifest.
  * Validation: every file must exist and be non-empty; .json files
    must parse; .parquet files are written as binary blobs. Paths must
    be relative, with no `..`. Invalid input fails BEFORE any API write.
  * --init-orphan: creates the branch as a TRUE orphan — a root commit
    (no parents) whose tree is built from the empty tree. Used once
    for the cold branch itself (and for the GATE A simulation setup).
  * --branch defaults to `cold`. The retention workflow reuses this
    same writer with --branch data for the HOT-removal commit (the
    rewritten dataset file ONLY — the roll never writes
    data/_manifest.json, because it owns no component).

Usage:
  python3 tools/cold-branch-writer.py --branch cold \
      --message "cold: index-history 2022-10" \
      --map '{"index-history/2022/10.parquet": "out/10.parquet", "manifest.json": "out/manifest.json"}'

  python3 tools/cold-branch-writer.py --init-orphan --branch cold \
      --message "cold: branch init" \
      --map '{"README.md": "cold-README.md", "manifest.json": "cold-manifest.json"}'

Prints a proof JSON object as its LAST stdout line:
  {"branch": ..., "head_before": ..., "commit": ..., "tree": ...,
   "files": [{"path": ..., "blob": ..., "status": ...}]}
or {"status": "NO-CHANGES", ...} when the tree is already current.

Environment: GITHUB_TOKEN is required.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

REPO = os.environ.get("COLD_REPO", "ShirjanKhadka1/shirjankhadka.github.io")
BASE = f"https://api.github.com/repos/{REPO}"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
MAX_RETRIES = 5


def log_call(method, path, status, req_id, remaining, attempt, step):
    print(f"gh-client step={step} attempt={attempt} {method} {path} "
          f"-> {status} request_id={req_id} "
          f"ratelimit_remaining={remaining}", flush=True)


def fail_block(method, path, status, body, req_id, step):
    print(f"COLD-WRITE-FAILURE method={method} path={path} step={step} "
          f"status={status} request_id={req_id} "
          f"body={json.dumps(body)[:500]}", flush=True)


def api(method, path, token, body=None, step="cold-write", attempt=1):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "nepse-cold-branch-writer",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(r)
        raw = resp.read().decode()
        log_call(method, path, resp.status,
                 resp.headers.get("x-github-request-id"),
                 resp.headers.get("x-ratelimit-remaining"),
                 attempt, step)
        return resp.status, json.loads(raw) if raw else {}, resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        log_call(method, path, e.code,
                 e.headers.get("x-github-request-id"),
                 e.headers.get("x-ratelimit-remaining"),
                 attempt, step)
        try:
            parsed = json.loads(raw) if raw else {}
        except ValueError:
            parsed = {"raw": raw[:500]}
        return e.code, parsed, e.headers


def validate_map(file_map):
    """Returns [(repo_path, local_path, raw_bytes), ...]."""
    out = []
    for repo_path, local_path in file_map.items():
        if not repo_path or repo_path.startswith("/") \
                or ".." in repo_path.split("/"):
            raise SystemExit(f"refusing unsafe repo path: {repo_path!r}")
        if not os.path.exists(local_path):
            raise SystemExit(f"local file not found: {local_path}")
        with open(local_path, "rb") as f:
            raw = f.read()
        if not raw:
            raise SystemExit(f"refusing empty file: {local_path}")
        if repo_path.endswith(".json"):
            try:
                json.loads(raw.decode())
            except (ValueError, UnicodeDecodeError) as e:
                raise SystemExit(f"invalid JSON {local_path}: {e}")
        out.append((repo_path, local_path, raw))
    if not out:
        raise SystemExit("empty --map: nothing to write")
    return out


def create_blobs(token, files, attempt):
    entries = []
    for repo_path, _local, raw in files:
        s, b, _h = api("POST", "/git/blobs", token,
                       body={"content": base64.b64encode(raw).decode(),
                             "encoding": "base64"},
                       step="blob-create", attempt=attempt)
        if s != 201:
            fail_block("POST", "/git/blobs", s, b, None, "blob-create")
            raise SystemExit(f"blob create failed: {s}")
        entries.append({"path": repo_path, "mode": "100644",
                        "type": "blob", "sha": b["sha"]})
    return entries


def main():
    ap = argparse.ArgumentParser(description="Cold-branch writer")
    ap.add_argument("--branch", default="cold")
    ap.add_argument("--message", required=True)
    ap.add_argument("--map", required=True,
                    help="JSON object: repo path -> local file path")
    ap.add_argument("--retries", type=int, default=MAX_RETRIES)
    ap.add_argument("--init-orphan", action="store_true",
                    help="create the branch as a root commit (no "
                         "parents) instead of updating an existing ref")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN is required")
    try:
        file_map = json.loads(args.map)
    except ValueError as e:
        raise SystemExit(f"--map is not valid JSON: {e}")
    if not isinstance(file_map, dict):
        raise SystemExit("--map must be a JSON object")
    files = validate_map(file_map)
    print(f"cold-write: branch={args.branch} files={len(files)} "
          f"orphan={args.init_orphan}", flush=True)

    if args.init_orphan:
        s, ref, _h = api("GET", f"/git/refs/heads/{args.branch}", token,
                         step="ref-read", attempt=1)
        if s == 200:
            raise SystemExit(f"branch {args.branch} already exists "
                             f"({ref['object']['sha']}) — refusing to "
                             f"re-init an orphan over it")
        entries = create_blobs(token, files, 1)
        s, nt, _h = api("POST", "/git/trees", token,
                        body={"base_tree": EMPTY_TREE, "tree": entries},
                        step="tree-create", attempt=1)
        if s != 201:
            fail_block("POST", "/git/trees", s, nt, None, "tree-create")
            raise SystemExit(f"tree create failed: {s}")
        s, cm, _h = api("POST", "/git/commits", token,
                        body={"message": args.message,
                              "tree": nt["sha"], "parents": []},
                        step="commit-create", attempt=1)
        if s != 201:
            fail_block("POST", "/git/commits", s, cm, None,
                       "commit-create")
            raise SystemExit(f"commit create failed: {s}")
        s, cr, _h = api("POST", "/git/refs", token,
                        body={"ref": f"refs/heads/{args.branch}",
                              "sha": cm["sha"]},
                        step="ref-create", attempt=1)
        if s != 201:
            fail_block("POST", "/git/refs", s, cr, None, "ref-create")
            raise SystemExit(f"ref create failed: {s}")
        print(json.dumps({
            "branch": args.branch, "head_before": None,
            "commit": cm["sha"], "tree": nt["sha"], "orphan": True,
            "files": [{"path": e["path"], "blob": e["sha"],
                       "status": "added"} for e in entries]}),
            flush=True)
        return 0

    for attempt in range(1, args.retries + 1):
        s, ref, _h = api("GET", f"/git/refs/heads/{args.branch}", token,
                         step="ref-read", attempt=attempt)
        if s != 200:
            fail_block("GET", f"/git/refs/heads/{args.branch}", s, ref,
                       None, "ref-read")
            raise SystemExit(f"branch ref read failed: {s}")
        head = ref["object"]["sha"]
        s, tree, _h = api("GET", f"/git/trees/{head}?recursive=1", token,
                          step="tree-read", attempt=attempt)
        if s != 200:
            fail_block("GET", f"/git/trees/{head}", s, tree, None,
                       "tree-read")
            raise SystemExit(f"branch tree read failed: {s}")
        head_tree = tree["sha"]
        blobs = {e["path"]: e["sha"] for e in tree.get("tree", [])
                 if e.get("type") == "blob"}
        entries = create_blobs(token, files, attempt)
        unchanged = all(blobs.get(e["path"]) == e["sha"]
                        for e in entries)
        if unchanged:
            print(json.dumps({"status": "NO-CHANGES",
                              "branch": args.branch, "head": head}),
                  flush=True)
            return 0
        s, nt, _h = api("POST", "/git/trees", token,
                        body={"base_tree": head_tree, "tree": entries},
                        step="tree-create", attempt=attempt)
        if s != 201:
            fail_block("POST", "/git/trees", s, nt, None, "tree-create")
            raise SystemExit(f"tree create failed: {s}")
        s, cm, _h = api("POST", "/git/commits", token,
                        body={"message": args.message,
                              "tree": nt["sha"], "parents": [head]},
                        step="commit-create", attempt=attempt)
        if s != 201:
            fail_block("POST", "/git/commits", s, cm, None,
                       "commit-create")
            raise SystemExit(f"commit create failed: {s}")
        s, upd, _h = api("PATCH", f"/git/refs/heads/{args.branch}", token,
                         body={"sha": cm["sha"]},
                         step="ref-update", attempt=attempt)
        if s == 200:
            print(json.dumps({
                "branch": args.branch, "head_before": head,
                "commit": cm["sha"], "tree": nt["sha"],
                "files": [{"path": e["path"], "blob": e["sha"],
                           "status": "updated"} for e in entries]}),
                flush=True)
            return 0
        if s in (409, 422):
            print(f"cold-write: ref update {s}, head moved under us, "
                  f"retrying (attempt {attempt})", flush=True)
            time.sleep(2 * attempt)
            continue
        fail_block("PATCH", f"/git/refs/heads/{args.branch}", s, upd,
                   None, "ref-update")
        raise SystemExit(f"branch ref update failed: {s}")

    raise SystemExit(f"cold write failed after {args.retries} attempts")


if __name__ == "__main__":
    main()
