#!/usr/bin/env python3
"""Content data-branch writer — the write path for the NEPSE content
pipeline under branch protection (GH006 fix, mirrors PR #249's news
migration).

The content workflow runs in GitHub Actions, where the VM-only
surrogate credential (dynamic_credentials) does not exist, so this
writer authenticates with the workflow's GITHUB_TOKEN
(contents:write), which CAN write to the unprotected `data` branch
(branch protection covers main only). It mirrors the algorithm of
tools/news-data-writer.py, generalized to several files:

  * Data publishers NEVER push to protected main. Validated content
    output goes to the `data` branch, and the Publish (P2) workflow
    assembles main + data into the deployed site. No commit to main,
    no PR per data run.
  * Disjoint paths: this component owns exactly the paths listed in
    --manifest-paths (default: the --file paths), recorded in
    data/_manifest.json. It NEVER writes nepse-chart/data/news.json:
    news is owned by news-refresh (tools/news-data-writer.py), and a
    content run that rewrites news.json is a failure of this
    migration, not a success. The workflow therefore does not build
    news.json at all, and this writer refuses it outright.
  * No-change detection is by CONTENT hash, not raw bytes: the
    announcements builder stamps a fresh generated_at on every run,
    so a byte comparison would "change" every run. For JSON files
    the hash is taken over the canonical dump with volatile
    timestamp keys stripped (generated_at, generated_at_npt,
    ran_at_npt, timestamp, updated_at, last_updated, build_time,
    fetched_at, published_at); everything else — items, gates,
    checksums, counts — is content. Non-JSON files (the actions
    page, sitemap.xml) are deterministic given their inputs and
    are hashed raw. When every staged file's content hash matches
    the data branch AND the component is already registered with
    the same path list, the writer prints NO-CHANGES and writes
    nothing — healthy no-change ticks stay silent. First
    registration always writes, even with unchanged content, so
    the assembler picks the files up.
  * Rebase-and-retry: the write is built as (blobs -> tree ->
    commit -> fast-forward ref update, force=false). If the data
    head moved under us, we re-read the head and rebuild from the
    NEW head (preserving other components' files) and retry, up to
    --retries times. Never force-push.
  * Manifest: data/_manifest.json is updated in the SAME commit as
    the component's files, so the manifest can never describe a
    tree that does not exist. The manifest dump style (indent=2,
    sorted keys, trailing newline) round-trips the existing file
    byte-identically, so an update touches only this component's
    entry. --manifest-paths lets the validation-failure path stage
    only jobs.json + validation.json while keeping the component's
    full path list registered, so a failure record can never
    shrink the overlay set and drop live data on the next Publish.
  * Validation: every file must exist, be non-empty, and parse as
    JSON when it ends in .json. Paths must be relative, with no
    `..`. Invalid input fails BEFORE any API write.
  * Logging: every API call logs method, path, status, request id,
    rate-limit remaining, attempt and step. On failure the failure
    block prints LAST, so tail capture sees it.

Seeding (the workflow's job, not this writer's): builders that
MERGE into an existing file must build on the data branch's copy,
never main's stale copy — announcements.json (90-day archive
merge), corporate-actions.json (storyKey dedup store), jobs.json
(record-job preserves other jobs). sitemap.xml is the exception:
its preserved-entry set lives on main (blog posts land via PRs),
so the workflow keeps main's copy as the sitemap seed. The
workflow also builds data/manifest.json for its validation gates
but does NOT stage it: that manifest describes the whole main
checkout, and staging it would mis-describe other components'
data-branch files (notably news.json).

Usage (from the nepse-content workflow):
  python3 tools/content-data-writer.py \
      --asof 2026-10-31 \
      --message "content: announcements/actions refresh (validated)" \
      --file nepse-chart/data/announcements.json:nepse-chart/data/announcements.json \
      --file nepse-chart/data/corporate-actions.json:nepse-chart/data/corporate-actions.json \
      --file nepse-chart/data/jobs.json:nepse-chart/data/jobs.json \
      --file nepse-chart/data/validation.json:nepse-chart/data/validation.json \
      --file nepse-actions/index.html:nepse-actions/index.html \
      --file sitemap.xml:sitemap.xml

Prints a proof JSON object as its LAST stdout line:
  {"component": ..., "branch": "data", "head_before": ...,
   "commit": ..., "tree": ..., "asof": ...,
   "files": [{"path": ..., "blob": ..., "status": ...}]}
or {"status": "NO-CHANGES", ...} when content is unchanged and the
component is already registered with the same paths.

Environment: GITHUB_TOKEN is required.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

REPO = os.environ.get("CONTENT_REPO", "ShirjanKhadka1/shirjankhadka.github.io")
BASE = f"https://api.github.com/repos/{REPO}"
COMPONENT = "content"
MANIFEST_PATH = "data/_manifest.json"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_RETRIES = 5

# Timestamp-shaped metadata keys: stripped at every depth before the
# content hash. Everything else (items, gates, checksums, counts,
# dates that describe the data itself such as `updated` day stamps
# and action dates) is content and must survive.
VOLATILE_KEYS = {
    "generated_at", "generated_at_npt", "ran_at_npt", "timestamp",
    "updated_at", "last_updated", "build_time", "fetched_at",
    "published_at",
}

# news.json is owned by news-refresh. Refuse it even if a caller
# passes it by mistake: a content write touching news.json must
# fail loudly here, never silently overwrite the news component.
FORBIDDEN_PATHS = {"nepse-chart/data/news.json"}


def log_call(method, path, status, req_id, remaining, attempt, step):
    print(f"gh-client step={step} attempt={attempt} {method} {path} "
          f"-> {status} request_id={req_id} "
          f"ratelimit_remaining={remaining}", flush=True)


def fail_block(method, path, status, body, req_id, step):
    print(f"CONTENT-WRITE-FAILURE method={method} path={path} step={step} "
          f"status={status} request_id={req_id} "
          f"body={json.dumps(body)[:500]}", flush=True)


def api(method, path, token, body=None, step="content-write", attempt=1):
    """One API call. Returns (status, parsed, headers)."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "nepse-content-data-writer",
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


def strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: strip_volatile(v) for k, v in obj.items()
                if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [strip_volatile(v) for v in obj]
    return obj


def content_hash(path, raw):
    """Content hash: canonical JSON minus volatile keys, else raw."""
    if path.endswith(".json"):
        parsed = json.loads(raw.decode())
        canon = json.dumps(strip_volatile(parsed), sort_keys=True,
                           ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(canon.encode()).hexdigest()
    return hashlib.sha256(raw).hexdigest()


def validate_inputs(files):
    contents = {}
    for path, local in files:
        if path in FORBIDDEN_PATHS:
            raise SystemExit(
                f"refusing forbidden path (owned by news-refresh): {path}")
        if path.startswith("/") or ".." in path.split("/"):
            raise SystemExit(f"refusing unsafe path: {path}")
        try:
            with open(local, "rb") as f:
                data = f.read()
        except OSError as e:
            raise SystemExit(f"cannot read {local}: {e}")
        if not data:
            raise SystemExit(f"refusing empty file: {local} -> {path}")
        if path.endswith(".json"):
            try:
                json.loads(data.decode())
            except (ValueError, UnicodeDecodeError) as e:
                raise SystemExit(f"invalid JSON {local} -> {path}: {e}")
        contents[path] = data
    return contents


def get_blob_bytes(token, sha, step, attempt):
    s, d, _h = api("GET", f"/git/blobs/{sha}", token,
                   step=step, attempt=attempt)
    if s != 200:
        fail_block("GET", f"/git/blobs/{sha}", s, d, None, step)
        raise SystemExit(f"blob read failed: {s}")
    return base64.b64decode(d["content"])


def main():
    ap = argparse.ArgumentParser(description="Content data-branch writer")
    ap.add_argument("--branch", default="data")
    ap.add_argument("--component", default=COMPONENT)
    ap.add_argument("--message", required=True, help="commit message")
    ap.add_argument("--asof", required=True,
                    help="YYYY-MM-DD (Asia/Kathmandu date of the write)")
    ap.add_argument("--file", action="append", default=[],
                    help="PATH:LOCALFILE (repeatable)")
    ap.add_argument("--manifest-paths", default="",
                    help="comma-separated full component path list "
                         "registered in data/_manifest.json "
                         "(default: the --file paths)")
    ap.add_argument("--retries", type=int, default=MAX_RETRIES)
    args = ap.parse_args()

    if not DATE_RE.match(args.asof or ""):
        raise SystemExit(f"asof must be YYYY-MM-DD, got {args.asof!r}")
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN is required")
    files = []
    for spec in args.file:
        if ":" not in spec:
            raise SystemExit(f"--file needs PATH:LOCAL, got {spec!r}")
        path, local = spec.split(":", 1)
        files.append((path, local))
    if not files:
        raise SystemExit("at least one --file is required")
    manifest_paths = sorted(
        p.strip() for p in args.manifest_paths.split(",") if p.strip()
    ) if args.manifest_paths else sorted(p for p, _ in files)
    for p in manifest_paths:
        if p in FORBIDDEN_PATHS:
            raise SystemExit(
                f"refusing forbidden manifest path: {p}")
    contents = validate_inputs(files)
    new_hashes = {p: content_hash(p, contents[p]) for p in contents}
    print(f"content-write: files={len(contents)} "
          f"asof={args.asof} manifest_paths={len(manifest_paths)}",
          flush=True)

    for attempt in range(1, args.retries + 1):
        # 1. Read the data head + its tree.
        s, ref, _h = api("GET", f"/git/refs/heads/{args.branch}", token,
                         step="ref-read", attempt=attempt)
        if s != 200:
            fail_block("GET", f"/git/refs/heads/{args.branch}", s, ref,
                       None, "ref-read")
            raise SystemExit(f"data ref read failed: {s}")
        head = ref["object"]["sha"]
        s, tree, _h = api("GET", f"/git/trees/{head}?recursive=1", token,
                          step="tree-read", attempt=attempt)
        if s != 200:
            fail_block("GET", f"/git/trees/{head}", s, tree, None,
                       "tree-read")
            raise SystemExit(f"data tree read failed: {s}")
        head_tree = tree["sha"]
        blobs = {e["path"]: e["sha"] for e in tree.get("tree", [])
                 if e.get("type") == "blob"}

        # 2. Current manifest + current content hashes.
        if MANIFEST_PATH not in blobs:
            fail_block("GET", MANIFEST_PATH, 404, {}, None,
                       "manifest-read")
            raise SystemExit("data branch has no data/_manifest.json; "
                             "refusing to publish an unmanifested write")
        man_raw = get_blob_bytes(token, blobs[MANIFEST_PATH],
                                 "manifest-read", attempt)
        manifest = json.loads(man_raw.decode())
        registered_before = args.component in manifest
        entry_before = manifest.get(args.component)
        cur_hashes = {}
        for path in contents:
            if path in blobs:
                cur_raw = get_blob_bytes(token, blobs[path],
                                         "current-read", attempt)
                try:
                    cur_hashes[path] = content_hash(path, cur_raw)
                except (ValueError, UnicodeDecodeError):
                    cur_hashes[path] = None
        unchanged = all(cur_hashes.get(p) == new_hashes[p]
                        for p in contents)
        entry_ok = (registered_before and entry_before
                    and entry_before.get("paths") == manifest_paths)
        if registered_before and unchanged and entry_ok:
            print(json.dumps({"status": "NO-CHANGES",
                              "component": args.component,
                              "branch": args.branch,
                              "head": head,
                              "asof": args.asof,
                              "reason": "content unchanged and component "
                                        "already registered"}),
                  flush=True)
            return 0
        reason = ("first registration" if not registered_before
                  else "content changed" if not unchanged
                  else "manifest paths changed")
        print(f"content-write: attempt {attempt} head={head[:12]} "
              f"registered={registered_before} unchanged={unchanged} "
              f"reason={reason}", flush=True)

        # 3. Blobs (changed files only) -> tree -> commit -> FF ref update.
        entries = []
        file_status = []
        for path, data in contents.items():
            if blobs.get(path) is not None and \
                    cur_hashes.get(path) == new_hashes[path]:
                file_status.append({"path": path, "blob": blobs[path],
                                    "status": "unchanged"})
                continue
            s, b, _h = api("POST", "/git/blobs", token,
                           body={"content": base64.b64encode(data)
                                  .decode(),
                                 "encoding": "base64"},
                           step="blob-create", attempt=attempt)
            if s != 201:
                fail_block("POST", "/git/blobs", s, b, None,
                           "blob-create")
                raise SystemExit(f"blob create failed: {s}")
            entries.append({"path": path, "mode": "100644",
                            "type": "blob", "sha": b["sha"]})
            file_status.append({"path": path, "blob": b["sha"],
                                "status": "updated" if path in blobs
                                else "added"})
        new_entry = {"paths": manifest_paths, "asof": args.asof,
                     "updated_via": "content-data-writer"}
        if entry_before != new_entry:
            manifest[args.component] = new_entry
            mdata = (json.dumps(manifest, indent=2, sort_keys=True)
                     + "\n").encode()
            s, b, _h = api("POST", "/git/blobs", token,
                           body={"content": base64.b64encode(mdata)
                                  .decode(),
                                 "encoding": "base64"},
                           step="blob-create", attempt=attempt)
            if s != 201:
                fail_block("POST", "/git/blobs", s, b, None,
                           "blob-create")
                raise SystemExit(f"manifest blob create failed: {s}")
            entries.append({"path": MANIFEST_PATH, "mode": "100644",
                            "type": "blob", "sha": b["sha"]})
            file_status.append({"path": MANIFEST_PATH, "blob": b["sha"],
                                "status": "updated"})
        if not entries:
            # Defensive: hashes differed only in a way the manifest
            # already covers (should not happen given the checks
            # above) — report NO-CHANGES rather than an empty commit.
            print(json.dumps({"status": "NO-CHANGES",
                              "component": args.component,
                              "branch": args.branch,
                              "head": head,
                              "asof": args.asof,
                              "reason": "no blob or manifest change"}),
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
        s, upd, _h = api("PATCH", f"/git/refs/heads/{args.branch}",
                         token, body={"sha": cm["sha"]},
                         step="ref-update", attempt=attempt)
        if s == 200:
            print(json.dumps({"component": args.component,
                              "branch": args.branch,
                              "head_before": head,
                              "commit": cm["sha"],
                              "tree": nt["sha"],
                              "asof": args.asof,
                              "reason": reason,
                              "files": file_status}),
                  flush=True)
            return 0
        # Head-moved failure means the head moved: rebuild from the
        # new head on the next attempt. Anything else is fatal.
        if s in (409, 422):
            print(f"content-write: ref update {s}, head moved under us, "
                  f"retrying (attempt {attempt})", flush=True)
            time.sleep(2 * attempt)
            continue
        fail_block("PATCH", f"/git/refs/heads/{args.branch}", s, upd,
                   None, "ref-update")
        raise SystemExit(f"data ref update failed: {s}")

    raise SystemExit(f"data write failed after {args.retries} attempts")


if __name__ == "__main__":
    main()
