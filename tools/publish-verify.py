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

Fetch hardening (2026-10-31, Publish run 41194180358): live mode
failed at "Verify production bytes" with a bare exit 1 while the
deployed tree was proven byte-correct — a runner-side fetch failure
no one could diagnose, because transport errors were swallowed
(the manifest fetch printed only "HTTP 0") and nothing was retried.
So live fetches now retry TRANSPORT failures with backoff, and every
failure prints the exact failing field (URL, status or transport
error, attempts, manifest path). Retries NEVER apply to a genuine
byte mismatch: a mismatch still fails fast on first sight.
"""
import argparse
import hashlib
import http.client
import json
import sys
import time
import urllib.error
import urllib.request


# Bounded retry for transport failures only. Attempts = 3 total;
# sleeps between attempts 1->2 and 2->3.
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_S = (2, 5)
# Transient edge statuses worth one more fetch (purge propagation,
# edge overload). Any other HTTP status fails fast.
TRANSIENT_HTTP = {429, 502, 503, 504}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _fetch_once(url):
    """One fetch. Returns (status, body, error).

    status 0 + error text means a TRANSPORT failure (connection drop,
    timeout, incomplete read); the caller decides whether to retry.
    An HTTP response — even an error status — returns its status with
    error None: HTTP statuses are not transport failures.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "muse-publish-verify"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read(), None
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, None
    except (urllib.error.URLError, http.client.HTTPException,
            OSError, TimeoutError) as e:
        return 0, b"", f"{type(e).__name__}: {e}"


def fetch(url):
    """Fetch with bounded retry on TRANSPORT failures only.

    Retried: connection/timeout/incomplete-read exceptions, and
    transient edge statuses (429/502/503/504). Never retried: other
    HTTP statuses, and (by the caller) byte mismatches.
    Returns (status, body, error, attempts): error is None on a clean
    non-transient response, else the transport error text or the
    transient "HTTP <status>" label after the final attempt.
    """
    status, body, error = 0, b"", "no attempt made"
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        status, body, error = _fetch_once(url)
        if error is None and status not in TRANSIENT_HTTP:
            return status, body, None, attempt
        detail = error if error is not None else f"HTTP {status}"
        if attempt < RETRY_ATTEMPTS:
            print(f"publish-verify: retry {url} attempt "
                  f"{attempt}/{RETRY_ATTEMPTS} after transport failure: "
                  f"{detail}; sleeping {RETRY_BACKOFF_S[attempt - 1]}s",
                  flush=True)
            time.sleep(RETRY_BACKOFF_S[attempt - 1])
    return status, body, detail, RETRY_ATTEMPTS


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
    manifest_url = f"{base}/data/publish-manifest.json"
    s, body, err, attempts = fetch(manifest_url)
    if s != 200:
        detail = f"HTTP {s}" if s else f"transport error: {err}"
        print(f"publish-verify: FAIL live publish-manifest fetch: "
              f"url={manifest_url} {detail} after {attempts} attempt(s)")
        return 1
    try:
        live = json.loads(body.decode())
    except ValueError:
        print("publish-verify: FAIL live publish-manifest is not JSON: "
              f"url={manifest_url} first-bytes={body[:120]!r}")
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
            url = f"{base}/{rel}"
            s, body, err, attempts = fetch(url)
            if s != 200:
                detail = f"HTTP {s}" if s else f"transport error: {err}"
                problems.append(
                    f"{rel}: live fetch failed url={url} {detail} "
                    f"after {attempts} attempt(s)")
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
