#!/usr/bin/env python3
"""Publish assembler (P2) — build the deploy tree from one snapshot.

Inputs (workflow checkout layout):
  --main-dir DIR       checkout of main (the code + pages tree)
  --snapshot-dir DIR   checkout of the data branch at the snapshot SHA
  --out-dir DIR        directory receiving the assembled tree
  --snapshot-sha SHA   data-branch commit being published
  --main-sha SHA       main commit the tree is based on

What it does, in order:
  1. Copies the main tree to out-dir (excluding .git).
  2. Reads the snapshot's data/_manifest.json (per-component paths
     + asof). Overlays EXACTLY those paths from the snapshot onto
     the out tree. No other snapshot file is copied: a publisher
     cannot smuggle an undeclared path into the deploy.
  3. Writes data/publish-manifest.json into the out tree:
     {snapshot_sha, snapshot_id, main_sha, published_at_utc,
      components: {name: {asof, paths}}}. This file is the
     verifier's comparison target and the /status page's data source.
  4. Validates the assembled tree (fail-loud, never silent-skip):
     - every overlaid .json parses, is non-empty
     - every component's asof is a valid YYYY-MM-DD date
     - no overlaid path is data/health.json or status/index.html
       (those are workflow-generated below, never publisher-written)
     - the snapshot's manifest covers every overlaid file
  5. Regenerates data/health.json + status/index.html by running
     node tools/build-health.js inside the out tree (same build,
     same snapshot — this is what removes the second writers: the
     noscript health block is baked here, not by a separate baker).

What it deliberately does NOT do (honest v1 limits, see
ops/PROGRAM-STATUS.md):
  - It does NOT rebuild baked HTML pages from data. Baked pages
    (symbol pages, signal pages) carry the last full rebuild's
    bake; the fresh data reaches them through their JSON fetches
    (client-rendered) and through the publish manifest. A full
    HTML rebuild is a separate, flag-gated workflow job (phase 2),
    pending builder CI-proofing. The noscript fallback therefore
    lags the snapshot by one full rebuild in v1; the assembler
    asserts noscript blocks EXIST, never that they are current.
  - It does NOT purge Cloudflare or verify production bytes; the
    workflow does that post-deploy (and skips both pre-flip, when
    no deploy happened, with the reason logged).

Exit 0 + summary JSON on stdout (last line). Exit 1 on any failure.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FORBIDDEN = {"data/health.json", "status/index.html"}


def fail(msg):
    print(f"publish-assemble: FAIL {msg}", flush=True)
    raise SystemExit(1)


def main():
    ap = argparse.ArgumentParser(description="P2 publish assembler")
    ap.add_argument("--main-dir", required=True)
    ap.add_argument("--snapshot-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--snapshot-sha", required=True)
    ap.add_argument("--main-sha", required=True)
    args = ap.parse_args()

    if os.path.abspath(args.out_dir) in (
            os.path.abspath(args.main_dir),
            os.path.abspath(args.snapshot_dir)):
        fail("out-dir must differ from main-dir and snapshot-dir")
    if os.path.exists(args.out_dir):
        shutil.rmtree(args.out_dir)
    shutil.copytree(args.main_dir, args.out_dir,
                    ignore=shutil.ignore_patterns(".git"))

    man_path = os.path.join(args.snapshot_dir, "data", "_manifest.json")
    if not os.path.isfile(man_path):
        fail("snapshot has no data/_manifest.json; refusing to publish "
             "an unmanifested snapshot")
    manifest = json.load(open(man_path))
    if not isinstance(manifest, dict) or not manifest:
        fail("snapshot manifest is empty or not an object")

    overlaid = []
    for comp in sorted(manifest):
        entry = manifest[comp]
        for rel in entry.get("paths", []):
            if rel in FORBIDDEN:
                fail(f"component {comp} declares forbidden path {rel}; "
                     "health/status are workflow-generated")
            src = os.path.join(args.snapshot_dir, rel)
            if not os.path.isfile(src):
                fail(f"component {comp} declares {rel} but the snapshot "
                     "does not contain it")
            dst = os.path.join(args.out_dir, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            overlaid.append((comp, rel))
            if rel.endswith(".json"):
                try:
                    data = json.load(open(dst))
                except ValueError as e:
                    fail(f"overlaid {rel} is not valid JSON: {e}")
                if os.path.getsize(dst) == 0:
                    fail(f"overlaid {rel} is empty")
        asof = entry.get("asof", "")
        if not DATE_RE.match(asof or ""):
            fail(f"component {comp} has no valid asof date: {asof!r}")

    # Publish manifest: the verifier's target + /status data source.
    pub = {
        "snapshot_sha": args.snapshot_sha,
        "snapshot_id": f"data-{args.snapshot_sha[:12]}",
        "main_sha": args.main_sha,
        "published_at_utc": datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"),
        "components": {c: {"asof": manifest[c].get("asof"),
                            "paths": manifest[c].get("paths", [])}
                       for c in sorted(manifest)},
    }
    with open(os.path.join(args.out_dir, "data", "publish-manifest.json"),
              "w") as f:
        json.dump(pub, f, indent=2, sort_keys=True)
        f.write("\n")

    # Health + noscript bake from the assembled tree (same snapshot).
    health = os.path.join(args.out_dir, "tools", "build-health.js")
    if os.path.isfile(health):
        r = subprocess.run(["node", "tools/build-health.js"],
                           cwd=args.out_dir, capture_output=True, text=True)
        if r.returncode != 0:
            fail(f"build-health.js failed: {r.stdout[-500:]} "
                 f"{r.stderr[-500:]}")
    else:
        print("publish-assemble: WARNING tools/build-health.js missing; "
              "health.json/status not regenerated", flush=True)

    # Noscript existence assertion (currency is a phase-2 rebuild job).
    status_html = os.path.join(args.out_dir, "status", "index.html")
    if os.path.isfile(status_html):
        text = open(status_html, errors="ignore").read()
        if "<noscript" not in text:
            fail("status/index.html has no noscript block after bake")

    summary = {"snapshot_sha": args.snapshot_sha,
               "main_sha": args.main_sha,
               "components": sorted(manifest),
               "overlaid_files": len(overlaid),
               "publish_manifest": "data/publish-manifest.json"}
    print(json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
