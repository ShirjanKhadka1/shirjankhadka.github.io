#!/usr/bin/env python3
"""News data-branch writer — the write path for the NEPSE news refresh
publisher under branch protection (P1b/P2, GH006 fix).

The news refresh workflow runs in GitHub Actions, where the
VM-only surrogate credential (dynamic_credentials) does not exist,
so this writer authenticates with the workflow's GITHUB_TOKEN
(contents:write), which CAN write to the unprotected `data` branch
(branch protection covers main only). It mirrors the algorithm of
tools/data-branch-writer.py without touching that shared file:

  * Data publishers NEVER push to protected main. Validated news
    output goes to the `data` branch, and the Publish (P2) workflow
    assembles main + data into the deployed site. No commit to main,
    no PR per data run.
  * Disjoint paths: this component owns exactly one path,
    nepse-chart/data/news.json, recorded in data/_manifest.json.
  * No-change detection is by ITEMS, not bytes: the builder stamps
    a fresh generated_at on every run, so a byte comparison would
    "change" every 30 minutes and trigger a Publish every tick.
    When the items array is unchanged AND the component is already
    registered, the writer prints NO-CHANGES and writes nothing —
    healthy no-change ticks stay silent. (First registration always
    writes, even with unchanged items, so the assembler picks the
    file up.)
  * Rebase-and-retry: the write is built as (blobs -> tree ->
    commit -> lease-checked fast-forward ref update). If the data
    head moved under us, we re-read the head and rebuild from the
    NEW head (preserving other components' files) and retry, up to
    --retries times. Never force-push.
  * Manifest: data/_manifest.json is updated in the SAME commit as
    the news file, so the manifest can never describe a tree that
    does not exist. The manifest dump style (indent=2, sorted keys,
    trailing newline) round-trips the existing file byte-identically,
    so an update touches only this component's entry.
  * Validation: the file must exist, be non-empty, parse as JSON,
    carry a non-empty items list, and every item in the first 50
    must have title, link, src. Invalid input fails BEFORE any API
    write.
  * Logging: every API call logs method, path, status, request id,
    rate-limit remaining, attempt and step. On failure the failure
    block prints LAST, so tail capture sees it.

Usage (from the news-refresh workflow):
  python3 tools/news-data-writer.py \
      --file nepse-chart/data/news.json \
      --asof 2026-10-31 \
      --message "news: refresh 2026-10-31T05:30 (500 items)"

Prints a proof JSON object as its LAST stdout line:
  {"component": ..., "branch": "data", "head_before": ...,
   "commit": ..., "tree": ..., "asof": ...,
   "files": [{"path": ..., "blob": ..., "status": ...}]}
or {"status": "NO-CHANGES", ...} when the items are unchanged and
the component is already registered.

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

REPO = os.environ.get("NEWS_REPO", "ShirjanKhadka1/shirjankhadka.github.io")
BASE = f"https://api.github.com/repos/{REPO}"
COMPONENT = "news-refresh"
NEWS_PATH = "nepse-chart/data/news.json"
MANIFEST_PATH = "data/_manifest.json"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_RETRIES = 5


def log_call(method, path, status, req_id, remaining, attempt, step):
    print(f"gh-client step={step} attempt={attempt} {method} {path} "
          f"-> {status} request_id={req_id} "
          f"ratelimit_remaining={remaining}", flush=True)


def fail_block(method, path, status, body, req_id, step):
    print(f"NEWS-WRITE-FAILURE method={method} path={path} step={step} "
          f"status={status} request_id={req_id} "
          f"body={json.dumps(body)[:500]}", flush=True)


def api(method, path, token, body=None, step="news-write", attempt=1):
    """One API call. Returns (status, parsed, headers)."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "nepse-news-data-writer",
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


def items_hash(items):
    """Canonical hash of the items array only (ignores generated_at)."""
    canon = json.dumps(items, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


def validate_news_file(path):
    """Read + validate the rebuilt file. Returns (raw_bytes, parsed)."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        raise SystemExit(f"cannot read {path}: {e}")
    if not raw:
        raise SystemExit(f"refusing empty file: {path}")
    try:
        parsed = json.loads(raw.decode())
    except (ValueError, UnicodeDecodeError) as e:
        raise SystemExit(f"invalid JSON {path}: {e}")
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list) or not items:
        raise SystemExit("news.json has no items")
    for it in items[:50]:
        if not isinstance(it, dict) or not it.get("title") \
                or not it.get("link") or not it.get("src"):
            raise SystemExit(
                f"bad item: {json.dumps(it)[:100]}")
    return raw, parsed


def update_manifest_text(raw_manifest_text, asof):
    """Return (new_text, registered_before). Only the news-refresh
    entry is added/changed; the dump style round-trips the existing
    file byte-identically otherwise."""
    manifest = json.loads(raw_manifest_text)
    registered_before = COMPONENT in manifest
    manifest[COMPONENT] = {
        "asof": asof,
        "paths": [NEWS_PATH],
        "updated_via": "news-data-writer",
    }
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            registered_before)


def get_blob_text(token, sha, step, attempt):
    s, d, _h = api("GET", f"/git/blobs/{sha}", token,
                   step=step, attempt=attempt)
    if s != 200:
        fail_block("GET", f"/git/blobs/{sha}", s, d, None, step)
        raise SystemExit(f"blob read failed: {s}")
    return base64.b64decode(d["content"]).decode()


def main():
    ap = argparse.ArgumentParser(description="News data-branch writer")
    ap.add_argument("--file", required=True,
                    help="local rebuilt nepse-chart/data/news.json")
    ap.add_argument("--asof", required=True,
                    help="YYYY-MM-DD (Asia/Kathmandu date of the write)")
    ap.add_argument("--message", required=True, help="commit message")
    ap.add_argument("--retries", type=int, default=MAX_RETRIES)
    args = ap.parse_args()

    if not DATE_RE.match(args.asof or ""):
        raise SystemExit(f"asof must be YYYY-MM-DD, got {args.asof!r}")
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN is required")

    raw, parsed = validate_news_file(args.file)
    new_hash = items_hash(parsed["items"])
    print(f"news-write: local items={len(parsed['items'])} "
          f"items_hash={new_hash[:12]} asof={args.asof}", flush=True)

    for attempt in range(1, args.retries + 1):
        # 1. Read the data head + its tree.
        s, ref, _h = api("GET", "/git/refs/heads/data", token,
                         step="ref-read", attempt=attempt)
        if s != 200:
            fail_block("GET", "/git/refs/heads/data", s, ref, None,
                       "ref-read")
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

        # 2. Current manifest + current news (if any).
        if MANIFEST_PATH not in blobs:
            fail_block("GET", MANIFEST_PATH, 404, {}, None,
                       "manifest-read")
            raise SystemExit("data branch has no data/_manifest.json; "
                             "refusing to publish an unmanifested write")
        man_text = get_blob_text(token, blobs[MANIFEST_PATH],
                                 "manifest-read", attempt)
        cur_hash = None
        if NEWS_PATH in blobs:
            cur_text = get_blob_text(token, blobs[NEWS_PATH],
                                     "current-read", attempt)
            try:
                cur_items = json.loads(cur_text).get("items")
                cur_hash = items_hash(cur_items) \
                    if isinstance(cur_items, list) else None
            except ValueError:
                cur_hash = None
        new_man_text, registered = update_manifest_text(man_text,
                                                        args.asof)
        if registered and cur_hash == new_hash:
            print(json.dumps({"status": "NO-CHANGES",
                              "component": COMPONENT,
                              "branch": "data",
                              "head": head,
                              "asof": args.asof,
                              "reason": "items unchanged and component "
                                        "already registered"}),
                  flush=True)
            return 0
        reason = ("first registration" if not registered
                  else "items changed")
        print(f"news-write: attempt {attempt} head={head[:12]} "
              f"registered={registered} reason={reason}", flush=True)

        # 3. Blobs -> tree -> commit -> lease-checked ref update.
        entries = []
        for path, content in ((NEWS_PATH, raw),
                              (MANIFEST_PATH, new_man_text.encode())):
            s, b, _h = api("POST", "/git/blobs", token,
                           body={"content": base64.b64encode(content)
                                  .decode(),
                                 "encoding": "base64"},
                           step="blob-create", attempt=attempt)
            if s != 201:
                fail_block("POST", "/git/blobs", s, b, None,
                           "blob-create")
                raise SystemExit(f"blob create failed: {s}")
            entries.append({"path": path, "mode": "100644",
                            "type": "blob", "sha": b["sha"]})
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
        s, upd, _h = api("PATCH", "/git/refs/heads/data", token,
                         body={"sha": cm["sha"]},
                         step="ref-update", attempt=attempt)
        if s == 200:
            print(json.dumps({"component": COMPONENT,
                              "branch": "data",
                              "head_before": head,
                              "commit": cm["sha"],
                              "tree": nt["sha"],
                              "asof": args.asof,
                              "reason": reason,
                              "files": [
                                  {"path": NEWS_PATH,
                                   "blob": entries[0]["sha"],
                                   "status": "updated"},
                                  {"path": MANIFEST_PATH,
                                   "blob": entries[1]["sha"],
                                   "status": "updated"}]}),
                  flush=True)
            return 0
        # Head-moved failure means the head moved: rebuild from the
        # new head on the next attempt. Anything else is fatal.
        if s in (409, 422):
            print(f"news-write: ref update {s}, head moved under us, "
                  f"retrying (attempt {attempt})", flush=True)
            time.sleep(2 * attempt)
            continue
        fail_block("PATCH", "/git/refs/heads/data", s, upd, None,
                   "ref-update")
        raise SystemExit(f"data ref update failed: {s}")

    raise SystemExit(f"data write failed after {args.retries} attempts")


if __name__ == "__main__":
    main()
