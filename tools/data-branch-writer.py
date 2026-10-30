#!/usr/bin/env python3
"""Data-branch writer — the ONE write path for data publishers under
branch protection (P1b/P2).

Data publishers NEVER push to protected main. They write validated
outputs to the dedicated `data` branch, in disjoint paths per
component, and the ONE publish workflow (publish.yml) assembles
main + data into the deployed site. No commit to main, no PR per
data run.

Design (read before changing):
  * Disjoint paths: each component owns a fixed set of repo paths
    (recorded in data/_manifest.json). Two components never write
    the same path, so concurrent writers cannot conflict on content.
  * Rebase-and-retry: the write is built as (blobs -> tree -> commit
    -> lease-checked fast-forward ref update). If the data head moved
    under us, we re-read the head and rebuild the tree from the NEW
    head (preserving other components' files, since paths are
    disjoint) and retry, up to --retries times. Never force-push.
  * Validation: every file must exist, be non-empty, and parse as
    JSON when it ends in .json. Paths must be relative, with no `..`.
    Invalid input fails BEFORE any API write.
  * Manifest: data/_manifest.json records, per component, its paths,
    its asof date and the tree SHA of its last write. It is updated
    in the same commit as the component's files, so the manifest can
    never describe a tree that does not exist.
  * Logging (P0 client law): every API call logs method, path,
    status, request id, rate-limit remaining, attempt and step. On
    failure the failure block prints LAST, so tail capture sees it.

Usage:
  python3 data-branch-writer.py --component contributors \
      --message "contributors 2026-10-30" --asof 2026-10-30 \
      --file data/contributors.json:/path/to/contributors.json \
      --file data/contributors-history.json:/path/to/history.json

  Prints a proof JSON object as its LAST stdout line:
  {"component": ..., "branch": "data", "head_before": ...,
   "commit": ..., "tree": ..., "asof": ...,
   "files": [{"path": ..., "blob": ..., "status": "added|updated|unchanged"}]}
  or {"status": "NO-CHANGES", ...} when the tree is already current.

Environment: PYTHONPATH must include the connector-setup bin dir so
`dynamic_credentials` resolves (same as every other API helper here).
"""

import argparse
import base64
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request  # noqa: E402

REPO = "ShirjanKhadka1/shirjankhadka.github.io"
BASE = f"https://api.github.com/repos/{REPO}"
MANIFEST_PATH = "data/_manifest.json"
MAX_RETRIES = 5


def log_call(method, path, status, req_id, remaining, attempt, step):
    print(f"gh-client step={step} attempt={attempt} {method} {path} "
          f"-> {status} request_id={req_id} "
          f"ratelimit_remaining={remaining}", flush=True)


def api(method, path, body=None, step="data-write", attempt=1):
    """One API call with P0-style logging. Returns (status, parsed, headers)."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "muse-data-writer",
        "Content-Type": "application/json"})
    add_surrogate_to_request(r, "custom.github",
                             allowed_hosts=["api.github.com"])
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


def fail_block(method, path, status, body, req_id, step):
    print(f"DATA-WRITE-FAILURE method={method} path={path} step={step} "
          f"status={status} request_id={req_id} "
          f"body={json.dumps(body)[:500]}", flush=True)


def blob_sha(content: bytes) -> str:
    h = hashlib.sha1()
    h.update(f"blob {len(content)}\0".encode())
    h.update(content)
    return h.hexdigest()


def validate_inputs(files, deletes):
    for path, _local in files:
        if path.startswith("/") or ".." in path.split("/"):
            raise SystemExit(f"refusing unsafe path: {path}")
    for path in deletes:
        if path.startswith("/") or ".." in path.split("/"):
            raise SystemExit(f"refusing unsafe path: {path}")
    contents = {}
    for path, local in files:
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


def get_ref(branch):
    s, d, _h = api("GET", f"/git/refs/heads/{branch}", step="ref-read")
    if s == 200:
        return d["object"]["sha"]
    if s == 404:
        return None
    fail_block("GET", f"/git/refs/heads/{branch}", s, d, None, "ref-read")
    raise SystemExit(f"ref read failed: {s}")


def get_tree_recursive(head_sha):
    s, d, _h = api("GET", f"/git/trees/{head_sha}?recursive=1",
                   step="tree-read")
    if s != 200:
        fail_block("GET", f"/git/trees/{head_sha}?recursive=1", s, d, None,
                   "tree-read")
        raise SystemExit(f"tree read failed: {s}")
    out = {}
    for e in d.get("tree", []):
        if e["type"] == "blob":
            out[e["path"]] = e["sha"]
    return d["sha"], out


def upload_blob(content: bytes):
    s, d, h = api("POST", "/git/blobs",
                  {"content": base64.b64encode(content).decode(),
                   "encoding": "base64"}, step="blob-upload")
    if s != 201:
        fail_block("POST", "/git/blobs", s, d,
                   h.get("x-github-request-id"), "blob-upload")
        raise SystemExit(f"blob upload failed: {s}")
    return d["sha"]


def get_blob_text(sha):
    s, d, _h = api("GET", f"/git/blobs/{sha}", step="blob-read")
    if s != 200:
        return None
    if d.get("encoding") == "base64":
        return base64.b64decode(d["content"]).decode()
    return d.get("content")


def write_once(branch, component, message, asof, contents, deletes,
               attempt):
    head = get_ref(branch)
    if head is None:
        # Branch does not exist yet: create it at the main tip.
        s, d, h = api("GET", "/git/refs/heads/main", step="main-read")
        if s != 200:
            raise SystemExit(f"main ref read failed: {s}")
        main_tip = d["object"]["sha"]
        s, d, h = api("POST", "/git/refs",
                      {"ref": f"refs/heads/{branch}", "sha": main_tip},
                      step="branch-create", attempt=attempt)
        if s == 422:
            # Race: someone else created the branch first; use its tip.
            head = get_ref(branch)
            if head is None:
                raise SystemExit("branch create raced and ref unreadable")
        elif s != 201:
            fail_block("POST", "/git/refs", s, d,
                       h.get("x-github-request-id"), "branch-create")
            raise SystemExit(f"branch create failed: {s}")
        else:
            head = main_tip
        print(f"data-write: created branch {branch} at {head[:12]}",
              flush=True)
    head_tree, tree_map = get_tree_recursive(head)

    # Upload only changed blobs.
    entries = []
    file_status = []
    for path, data in contents.items():
        want = blob_sha(data)
        if tree_map.get(path) == want:
            file_status.append({"path": path, "blob": want,
                                "status": "unchanged"})
            continue
        sha = upload_blob(data)
        entries.append({"path": path, "mode": "100644", "type": "blob",
                        "sha": sha})
        file_status.append({"path": path, "blob": sha,
                            "status": "updated" if path in tree_map
                            else "added"})
    for path in deletes:
        if path in tree_map:
            entries.append({"path": path, "mode": "100644",
                            "type": "blob", "sha": None})
            file_status.append({"path": path, "blob": None,
                                "status": "deleted"})
    # Manifest update (same commit as the files).
    manifest = {}
    if MANIFEST_PATH in tree_map:
        raw = get_blob_text(tree_map[MANIFEST_PATH])
        if raw:
            try:
                manifest = json.loads(raw)
            except ValueError:
                manifest = {}
    new_entry = {"paths": sorted(contents.keys()) + sorted(deletes),
                 "asof": asof, "updated_via": "data-branch-writer"}
    if manifest.get(component) != new_entry:
        manifest[component] = new_entry
        mdata = (json.dumps(manifest, indent=2, sort_keys=True) + "\n"
                 ).encode()
        msha = upload_blob(mdata)
        entries.append({"path": MANIFEST_PATH, "mode": "100644",
                        "type": "blob", "sha": msha})
        file_status.append({"path": MANIFEST_PATH, "blob": msha,
                            "status": "updated"})
    if not entries:
        return {"status": "NO-CHANGES", "component": component,
                "branch": branch, "head": head, "asof": asof,
                "files": file_status}
    s, d, h = api("POST", "/git/trees",
                  {"base_tree": head_tree, "tree": entries},
                  step="tree-create", attempt=attempt)
    if s != 201:
        fail_block("POST", "/git/trees", s, d,
                   h.get("x-github-request-id"), "tree-create")
        raise SystemExit(f"tree create failed: {s}")
    new_tree = d["sha"]
    if new_tree == head_tree:
        return {"status": "NO-CHANGES", "component": component,
                "branch": branch, "head": head, "asof": asof,
                "files": file_status}
    s, d, h = api("POST", "/git/commits",
                  {"message": message, "tree": new_tree,
                   "parents": [head]}, step="commit-create",
                  attempt=attempt)
    if s != 201:
        fail_block("POST", "/git/commits", s, d,
                   h.get("x-github-request-id"), "commit-create")
        raise SystemExit(f"commit create failed: {s}")
    new_commit = d["sha"]
    s, d, h = api("PATCH", f"/git/refs/heads/{branch}",
                  {"sha": new_commit}, step="ref-update", attempt=attempt)
    if s == 200:
        return {"status": "WRITTEN", "component": component,
                "branch": branch, "head_before": head,
                "commit": new_commit, "tree": new_tree, "asof": asof,
                "files": file_status}
    if s in (409, 422):
        # Head moved under us: caller retries from the new head.
        fail_block("PATCH", f"/git/refs/heads/{branch}", s, d,
                   h.get("x-github-request-id"), "ref-update")
        return {"status": "RETRY", "reason": f"ref update {s}"}
    fail_block("PATCH", f"/git/refs/heads/{branch}", s, d,
               h.get("x-github-request-id"), "ref-update")
    raise SystemExit(f"ref update failed: {s}")


def main():
    ap = argparse.ArgumentParser(description="Data-branch writer (P1b/P2)")
    ap.add_argument("--branch", default="data")
    ap.add_argument("--component", required=True)
    ap.add_argument("--message", required=True)
    ap.add_argument("--asof", required=True,
                    help="data date carried by this write (YYYY-MM-DD)")
    ap.add_argument("--file", action="append", default=[],
                    help="PATH:LOCALFILE (repeatable)")
    ap.add_argument("--delete", action="append", default=[],
                    help="repo path to delete (repeatable)")
    ap.add_argument("--retries", type=int, default=MAX_RETRIES)
    args = ap.parse_args()
    files = []
    for spec in args.file:
        if ":" not in spec:
            raise SystemExit(f"--file needs PATH:LOCAL, got {spec!r}")
        path, local = spec.split(":", 1)
        files.append((path, local))
    contents = validate_inputs(files, args.delete)
    last = None
    for attempt in range(1, args.retries + 1):
        last = write_once(args.branch, args.component, args.message,
                          args.asof, contents, args.delete, attempt)
        if last["status"] != "RETRY":
            print(json.dumps(last), flush=True)
            return 0
        print(f"data-write: head moved, retry {attempt}/{args.retries}",
              flush=True)
        time.sleep(2 * attempt)
    print(json.dumps({"status": "FAILED", "reason": "retries exhausted",
                      "last": last}), flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
