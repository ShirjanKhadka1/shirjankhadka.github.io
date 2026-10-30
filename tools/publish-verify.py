#!/usr/bin/env python3
"""Publish verifier (P2) — compare deployed bytes to the snapshot.

Two modes:
  --mode artifact: compare a local artifact directory against the
    snapshot manifest it was assembled from. Used pre-flip (no
    production deploy exists yet) as the artifact-byte proof.
  --mode live: fetch production URLs and compare them to the
    artifact. Used post-flip after deploy + purge. Any mismatch
    fails loudly with the exact differing fields (this output IS
    the alert body); the operator then redeploys or rolls back
    (workflow_dispatch with redeploy_run_id).

Inputs:
  --artifact-dir DIR   the assembled tree (or the downloaded
                       artifact for a redeploy)
  --base-url URL       production origin for live mode
                       (default https://shirjankhadka.com.np)

Live mode fetches data/publish-manifest.json first, then every
component file listed in it, and compares SHA-256 bytes to the
artifact. Exit 0 only on full agreement. Exit 1 otherwise.
"""
import argparse
import hashlib
import json
import sys
import urllib.request


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "muse-publish-verify"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # network error etc.
        return 0, str(e).encode()


def main():
    ap = argparse.ArgumentParser(description="P2 publish verifier")
    ap.add_argument("--mode", choices=["artifact", "live"], required=True)
    ap.add_argument("--artifact-dir", required=True)
    ap.add_argument("--base-url", default="https://shirjankhadka.com.np")
    args = ap.parse_args()

    man_path = f"{args.artifact_dir}/data/publish-manifest.json"
    try:
        expected = json.load(open(man_path))
    except Exception as e:
        print(f"publish-verify: FAIL no artifact publish manifest: {e}")
        return 1
    problems = []
    if args.mode == "artifact":
        # Artifact proof: manifest present, snapshot id consistent,
        # every declared file present and non-empty.
        for comp, entry in expected["components"].items():
            for rel in entry["paths"]:
                p = f"{args.artifact_dir}/{rel}"
                try:
                    import os
                    if os.path.getsize(p) == 0:
                        problems.append(f"{rel}: empty in artifact")
                except OSError:
                    problems.append(f"{rel}: missing from artifact")
        if problems:
            print("publish-verify: FAIL artifact incomplete:")
            for p in problems:
                print(f"  - {p}")
            return 1
        print(f"publish-verify: ARTIFACT-OK snapshot="
              f"{expected['snapshot_sha'][:12]} components="
              f"{len(expected['components'])}")
        return 0

    # Live mode.
    base = args.base_url.rstrip("/")
    s, body = fetch(f"{base}/data/publish-manifest.json")
    if s != 200:
        print(f"publish-verify: FAIL live publish-manifest fetch: HTTP {s}")
        return 1
    try:
        live = json.loads(body.decode())
    except ValueError:
        print("publish-verify: FAIL live publish-manifest is not JSON")
        return 1
    if live.get("snapshot_sha") != expected["snapshot_sha"]:
        problems.append(
            f"snapshot_sha: live={live.get('snapshot_sha')} "
            f"expected={expected['snapshot_sha']}")
    for comp, entry in expected["components"].items():
        live_entry = (live.get("components") or {}).get(comp)
        if not live_entry:
            problems.append(f"component {comp}: missing from live manifest")
            continue
        if live_entry.get("asof") != entry["asof"]:
            problems.append(
                f"component {comp} asof: live={live_entry.get('asof')} "
                f"expected={entry['asof']}")
        for rel in entry["paths"]:
            s, body = fetch(f"{base}/{rel}")
            if s != 200:
                problems.append(f"{rel}: live fetch HTTP {s}")
                continue
            live_hash = hashlib.sha256(body).hexdigest()
            try:
                art_hash = sha256(f"{args.artifact_dir}/{rel}")
            except OSError as e:
                problems.append(f"{rel}: artifact unreadable: {e}")
                continue
            if live_hash != art_hash:
                problems.append(
                    f"{rel}: bytes differ live={live_hash[:12]} "
                    f"artifact={art_hash[:12]}")
    if problems:
        print("publish-verify: FAIL production != snapshot:")
        for p in problems:
            print(f"  - {p}")
        print("publish-verify: recovery: redeploy the same snapshot, "
              "then roll back via workflow_dispatch redeploy_run_id, "
              "then alert.")
        return 1
    print(f"publish-verify: LIVE-OK snapshot="
          f"{expected['snapshot_sha'][:12]} components="
          f"{len(expected['components'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
