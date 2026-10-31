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
  --report-path PATH   JSON report written on EVERY exit path
                       (default publish-verify-report.json). The
                       workflow uploads this file as an artifact
                       when the live verify step fails, so the exact
                       failing field is retrievable without admin
                       access to the runner's job logs.

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

Report hardening (2026-10-31, Publish runs 41194180358/41198394295/
41198440068/41198769880 — four consecutive failures at this one
step, job logs 403 for the operator token): the same failure
information is now ALSO written to --report-path as JSON (every
checked path + outcome + hashes + attempts + error, and the exact
failing field on failure), so the workflow can upload it as an
artifact on verify failure and the cause can be read via the
artifacts API instead of the admin-only job logs.

Settle hardening (2026-10-31, Publish run 41205788829 — the first
run WITH the report artifact): the artifact named the exact field —
64/65 checks ok, exactly one failure, component "content", path
"nepse-actions/index.html", outcome bytes_differ, HTTP 200, 1
attempt, live=ee56d5f23f07 artifact=7ff6c24d46ed. The purge list
already contains every manifest component path (publish.yml builds
it from the manifest), and the purge step succeeded, so this was
NOT a purge omission: it was edge propagation — the runner's node
still served the pre-deploy actions page minutes after deploy +
purge. Proof: a curl minutes later served exactly the artifact
bytes (7ff6c24d46ed, 39194 bytes), and the actions page is the
SOLE verified HTML path (sitemap.xml is XML; the rest are JSON),
which is why it failed alone, every time, while every deploy was
in fact correct. Fix: live mode now SETTLES before the strict
pass — it polls the live manifest until its snapshot matches, then
polls each component path until its live bytes match the artifact
(or --settle-timeout, default 300s, expires). The strict pass
afterwards is UNCHANGED: a mismatch still fails fast on first
sight. Settle only moves the strict pass to after proven edge
convergence; it never masks a real mismatch (a permanently stale
path still fails the strict pass and is named exactly).

CHARTER v3 P0 (2026-10-31, Publish run 41209812356 — the first run
WITH settle): settle did NOT converge. The second artifact showed
settle_converged=False after the full 306s budget, still unsettled
on the same single path with the SAME live hash ee56d5f23f07, while
a curl from another route served the artifact bytes throughout.
That hash matches NO committed version of the page (last 15 commits
on main and data checked) — so this is not propagation delay on a
known version but a deterministic per-route difference (a stale
non-git edge entry or a transformation on the runner's route).
Settle-wait alone cannot fix a difference that never converges.
P0 therefore stops trusting the edge cache for verification: every
live fetch now carries a UNIQUE per-run cache-busting query string
(`?verify=<token>`) plus `Cache-Control: no-cache` / `Pragma:
no-cache` request headers, so the verifier reads origin bytes, not
whatever a node cached. The companion purge change (publish.yml +
publish-purge.py) purges every URL variant users actually fetch, so
users get fresh bytes too. Settle stays as the retry layer (spec:
retry up to N minutes for propagation; fail ONLY on a real
mismatch) — with busting it should converge on the first round.

Mismatch instrumentation (2026-10-31, Publish run 41222569853 —
the first run WITH busting): busting did NOT clear the one
permanent field (nepse-actions/index.html, live=ee56d5f23f07 vs
artifact=7ff6c24d46ed, 65/66 ok, settle 306s unconverged). A
unique never-seen ?verify= token plus no-cache headers still
returned ee56, and ee56 is unreproducible from any other route and
matches no committed version — so the cache/propagation theory is
dead and the cause is a serving-side divergence on the runner's
route. Hashes alone cannot identify it. On a strict-pass
bytes_differ, the check entry therefore ALSO captures the live
bytes (base64, capped), the response headers, and the final URL
after redirects. This changes NO pass/fail behavior: the strict
pass still fails fast on first sight, and the captured bytes are
diagnostic evidence for the next diff, nothing more.

Beacon tolerance (2026-11-01, Publish run 41231693412 — the first
run WITH mismatch capture): the captured bytes SOLVED ee56. Diff
vs the deployed artifact bytes (data branch's
nepse-actions/index.html at the pinned snapshot, 88af99a6d50b):
first 39,179 bytes byte-identical; the ONLY difference is ONE
extra line inserted before </body> — a Cloudflare Web Analytics
beacon script (static.cloudflareinsights.com/beacon.min.js, 367
bytes). The runner's headers confirm the edge path (cf-cache-status
HIT, Server cloudflare, IAD region); other nodes serve pristine
artifact bytes. ee56 was therefore never a stale page, a poisoned
cache entry, or propagation delay: it is the current page plus
edge-injected analytics, failing every time because
nepse-actions/index.html is the sole verified HTML path (JSON
responses never get beacon injection). The verifier now tolerates
EXACTLY this element for HTML paths: strip_beacon() removes the
single script element referencing
static.cloudflareinsights.com/beacon.min.js (matched by host/path,
never by token or integrity hash, which rotate; empty body only)
together with its own line break, symmetrically from live AND
artifact bytes, before hashing — for the settle comparison and the
strict pass alike. Any other byte difference still fails, JSON and
all non-HTML paths stay byte-exact, and a beacon the pattern does
not match fails closed (loud failure, never a silent pass). The
report keeps RAW live/artifact hashes as evidence and adds
live_beacon_stripped / artifact_beacon_stripped counts so a
beacon-tolerant pass is transparent, never hidden. Disabling Web
Analytics was rejected (dashboard hand, loses analytics); the gate
itself is not weakened — it now compares authored bytes, which is
what it always meant to compare.
"""
import argparse
import base64
import datetime
import hashlib
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid


# Bounded retry for transport failures only. Attempts = 3 total;
# sleeps between attempts 1->2 and 2->3.
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_S = (2, 5)
# Transient edge statuses worth one more fetch (purge propagation,
# edge overload). Any other HTTP status fails fast.
TRANSIENT_HTTP = {429, 502, 503, 504}
# Mismatch evidence cap: live bytes captured on a bytes_differ are
# base64-embedded in the report JSON (which the workflow uploads as
# an artifact). Cap at 1 MiB so a multi-MB component cannot blow up
# the report; the failing HTML page is ~39 KiB, so it is captured
# whole, and truncation is flagged explicitly when it ever applies.
MAX_LIVE_CAPTURE_BYTES = 1_048_576


def live_capture(body, meta):
    """Diagnostic capture for a strict-pass bytes_differ.

    Returns the report fields for the live response: base64 body
    (capped), full byte length, truncation flag, response headers,
    and the final URL after redirects. No pass/fail input — the
    caller already decided the outcome before calling this.
    """
    truncated = len(body) > MAX_LIVE_CAPTURE_BYTES
    kept = body[:MAX_LIVE_CAPTURE_BYTES]
    return {
        "live_body_b64": base64.b64encode(kept).decode("ascii"),
        "live_body_bytes": len(body),
        "live_body_truncated": truncated,
        "live_headers": (meta or {}).get("headers") or {},
        "live_final_url": (meta or {}).get("final_url"),
    }


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# Cloudflare Web Analytics beacon element (see module docstring):
# one <script> line injected by the edge before </body> into HTML
# responses on some nodes. Matched by host/path only — the src
# carries a version path segment, the integrity hash rotates with
# beacon releases, and the data-cf-beacon token is zone-specific —
# so none of those are part of the pattern. The body must be empty
# (a src script has no inline body), so the pattern can never eat
# authored content past the element; the trailing line break is
# consumed only when the element occupies its own line (the real
# injection shape), otherwise only adjacent spaces/tabs go with it.
BEACON_SCRIPT_RE = re.compile(
    rb"[ \t]*<script\b[^>]*static\.cloudflareinsights\.com/"
    rb"beacon\.min\.js[^>]*>\s*</script>[ \t]*\r?\n?",
    re.IGNORECASE)


def strip_beacon(body):
    """Remove Cloudflare beacon script element(s) from HTML bytes.

    Returns (stripped_bytes, count_removed). Only the beacon
    element above is removed; every other byte is kept exact.
    """
    return BEACON_SCRIPT_RE.subn(b"", body)


def is_html_path(rel):
    return rel.lower().endswith((".html", ".htm"))


def comparable_hash(rel, body):
    """(comparable_sha256, beacon_elements_stripped) for live bytes.

    HTML paths hash beacon-stripped bytes; every other path hashes
    raw bytes (identical to sha256 for those paths).
    """
    if is_html_path(rel):
        stripped, n = strip_beacon(body)
        return hashlib.sha256(stripped).hexdigest(), n
    return hashlib.sha256(body).hexdigest(), 0


def artifact_hash(rel, path):
    """(raw_sha256, comparable_sha256, beacon_elements_stripped) for
    an artifact file. Same beacon tolerance as comparable_hash,
    applied symmetrically so an artifact that itself carries the
    beacon compares equal to a live copy carrying it. Non-HTML
    files stream exactly as sha256() does."""
    if is_html_path(rel):
        with open(path, "rb") as f:
            data = f.read()
        stripped, n = strip_beacon(data)
        return (hashlib.sha256(data).hexdigest(),
                hashlib.sha256(stripped).hexdigest(), n)
    h = sha256(path)
    return h, h, 0


def bust_url(url, token):
    """Append the run's cache-bust token (None = URL unchanged).

    Static origins (GitHub Pages) ignore the query string, so the
    served bytes are the file's bytes — but edge caches key on the
    full URL, so a never-before-seen query string cannot hit a stale
    entry. Combined with the no-cache request headers below, the
    verifier reads origin bytes even when a node holds a poisoned
    entry for the clean URL (CHARTER v3 P0).
    """
    if not token:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}verify={token}"


def _fetch_once(url):
    """One fetch. Returns (status, body, error, meta).

    status 0 + error text means a TRANSPORT failure (connection drop,
    timeout, incomplete read); the caller decides whether to retry.
    An HTTP response — even an error status — returns its status with
    error None: HTTP statuses are not transport failures.
    No-cache request headers: the verifier must never accept a cached
    answer for a deploy it is gating (CHARTER v3 P0).
    meta carries the diagnostic evidence for a mismatch: the
    response headers as a plain dict and the final URL after
    redirects (urllib follows them silently, so the fetched URL and
    the served URL can differ — that difference is itself evidence).
    Transport failures carry empty headers and final_url None.
    """
    req = urllib.request.Request(url, headers={
        "User-Agent": "muse-publish-verify",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read(), None, {
                "headers": dict(resp.headers),
                "final_url": resp.geturl()}
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        try:
            headers = dict(e.headers)
        except Exception:
            headers = {}
        try:
            final_url = e.geturl()
        except Exception:
            final_url = None
        return e.code, body, None, {
            "headers": headers, "final_url": final_url}
    except (urllib.error.URLError, http.client.HTTPException,
            OSError, TimeoutError) as e:
        return 0, b"", f"{type(e).__name__}: {e}", {
            "headers": {}, "final_url": None}


def fetch(url):
    """Fetch with bounded retry on TRANSPORT failures only.

    Retried: connection/timeout/incomplete-read exceptions, and
    transient edge statuses (429/502/503/504). Never retried: other
    HTTP statuses, and (by the caller) byte mismatches.
    Returns (status, body, error, attempts, meta): error is None on a
    clean non-transient response, else the transport error text or
    the transient "HTTP <status>" label after the final attempt.
    meta is the final attempt's diagnostic evidence (headers +
    final URL); callers that do not need it ignore it.
    """
    status, body, error, meta = 0, b"", "no attempt made", {
        "headers": {}, "final_url": None}
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        status, body, error, meta = _fetch_once(url)
        if error is None and status not in TRANSIENT_HTTP:
            return status, body, None, attempt, meta
        detail = error if error is not None else f"HTTP {status}"
        if attempt < RETRY_ATTEMPTS:
            print(f"publish-verify: retry {url} attempt "
                  f"{attempt}/{RETRY_ATTEMPTS} after transport failure: "
                  f"{detail}; sleeping {RETRY_BACKOFF_S[attempt - 1]}s",
                  flush=True)
            time.sleep(RETRY_BACKOFF_S[attempt - 1])
    return status, body, detail, RETRY_ATTEMPTS, meta


def run(args, report):
    """The check itself. Fills report['checks']/['problems'] and
    returns the exit code. Stdout text is unchanged from before the
    report hardening: the report is additive, never a replacement.
    """
    man_path = f"{args.artifact_dir}/data/publish-manifest.json"
    try:
        expected = json.load(open(man_path))
    except Exception as e:
        report["problems"].append(f"no artifact publish manifest: {e}")
        print(f"publish-verify: FAIL no artifact publish manifest: {e}")
        return 1
    report["expected_snapshot_sha"] = expected.get("snapshot_sha")
    problems = report["problems"]
    if args.mode == "artifact":
        # Artifact proof: manifest present, snapshot id consistent,
        # every declared file present and non-empty.
        for comp, entry in expected["components"].items():
            for rel in entry["paths"]:
                p = f"{args.artifact_dir}/{rel}"
                try:
                    if os.path.getsize(p) == 0:
                        problems.append(f"{rel}: empty in artifact")
                        report["checks"].append({
                            "component": comp, "path": rel, "url": None,
                            "outcome": "empty", "http_status": None,
                            "attempts": 0, "error": "empty in artifact",
                            "live_sha256": None, "artifact_sha256": None})
                    else:
                        report["checks"].append({
                            "component": comp, "path": rel, "url": None,
                            "outcome": "ok", "http_status": None,
                            "attempts": 0, "error": None,
                            "live_sha256": None,
                            "artifact_sha256": sha256(p)})
                except OSError:
                    problems.append(f"{rel}: missing from artifact")
                    report["checks"].append({
                        "component": comp, "path": rel, "url": None,
                        "outcome": "missing", "http_status": None,
                        "attempts": 0, "error": "missing from artifact",
                        "live_sha256": None, "artifact_sha256": None})
        if problems:
            print("publish-verify: FAIL artifact incomplete:")
            for p in problems:
                print(f"  - {p}")
            return 1
        print(f"publish-verify: ARTIFACT-OK snapshot="
              f"{expected['snapshot_sha'][:12]} components="
              f"{len(expected['components'])}")
        return 0

    # Live mode. Every live URL carries the run's cache-bust token
    # (CHARTER v3 P0): the token is generated once per run in main()
    # and shared by the manifest fetch, the settle polls, and the
    # strict pass, so all three read the same origin-backed entry.
    base = args.base_url.rstrip("/")
    token = getattr(args, "cache_bust", None)
    manifest_url = bust_url(f"{base}/data/publish-manifest.json", token)
    s, body, err, attempts, _meta = fetch(manifest_url)
    if s != 200:
        detail = f"HTTP {s}" if s else f"transport error: {err}"
        problems.append(
            f"live publish-manifest fetch failed: url={manifest_url} "
            f"{detail} after {attempts} attempt(s)")
        report["checks"].append({
            "component": None, "path": "data/publish-manifest.json",
            "url": manifest_url, "outcome": "fetch_failed",
            "http_status": s if s else None, "attempts": attempts,
            "error": detail, "live_sha256": None, "artifact_sha256": None})
        print(f"publish-verify: FAIL live publish-manifest fetch: "
              f"url={manifest_url} {detail} after {attempts} attempt(s)")
        return 1
    try:
        live = json.loads(body.decode())
    except ValueError:
        problems.append(
            f"live publish-manifest is not JSON: url={manifest_url} "
            f"first-bytes={body[:120]!r}")
        report["checks"].append({
            "component": None, "path": "data/publish-manifest.json",
            "url": manifest_url, "outcome": "not_json",
            "http_status": s, "attempts": attempts,
            "error": f"first-bytes={body[:120]!r}",
            "live_sha256": hashlib.sha256(body).hexdigest(),
            "artifact_sha256": None})
        print("publish-verify: FAIL live publish-manifest is not JSON: "
              f"url={manifest_url} first-bytes={body[:120]!r}")
        return 1
    # Settle phase 1: edge propagation. The live manifest may still be
    # the pre-flip copy when verify starts (deploy + purge precede
    # this step by ~1 min). Poll until its snapshot matches, or the
    # settle budget expires — then the strict pass below reports the
    # mismatch exactly as before.
    settle_started = time.monotonic()
    settle_timeout = args.settle_timeout
    settle_interval = args.settle_interval
    manifest_settled = (live.get("snapshot_sha") == expected["snapshot_sha"])
    while not manifest_settled:
        if time.monotonic() - settle_started >= settle_timeout:
            break
        print(f"publish-verify: settle: live manifest snapshot "
              f"{live.get('snapshot_sha')} != expected "
              f"{expected['snapshot_sha']}; sleeping "
              f"{settle_interval}s", flush=True)
        time.sleep(settle_interval)
        s_try, body_try, err_try, attempts_try, _m = fetch(manifest_url)
        if s_try != 200:
            continue
        try:
            live_try = json.loads(body_try.decode())
        except ValueError:
            continue
        s, body, attempts, live = s_try, body_try, attempts_try, live_try
        manifest_settled = (live.get("snapshot_sha")
                            == expected["snapshot_sha"])
    report["live_snapshot_sha"] = live.get("snapshot_sha")
    report["checks"].append({
        "component": None, "path": "data/publish-manifest.json",
        "url": manifest_url, "outcome": "ok",
        "http_status": s, "attempts": attempts, "error": None,
        "live_sha256": hashlib.sha256(body).hexdigest(),
        "artifact_sha256": None})
    if live.get("snapshot_sha") != expected["snapshot_sha"]:
        problems.append(
            f"snapshot_sha: live={live.get('snapshot_sha')} "
            f"expected={expected['snapshot_sha']}")
        report["checks"].append({
            "component": None, "path": "data/publish-manifest.json#snapshot_sha",
            "url": manifest_url, "outcome": "snapshot_mismatch",
            "http_status": s, "attempts": attempts,
            "error": problems[-1], "live_sha256": None,
            "artifact_sha256": None})
    # Settle phase 2: poll each component path's live bytes until
    # they match the artifact (or the budget expires). Paths already
    # matching are not re-fetched in later rounds. Artifact-
    # unreadable paths are left for the strict pass to report.
    # The strict pass below still re-fetches everything and fails
    # fast on any mismatch — settle never masks a real difference.
    art_hashes = {}
    for comp, entry in expected["components"].items():
        for rel in entry["paths"]:
            try:
                art_hashes[rel] = artifact_hash(
                    rel, f"{args.artifact_dir}/{rel}")[1]
            except OSError:
                pass
    unsettled = set(art_hashes)
    first_round = True
    while unsettled:
        if not first_round:
            if time.monotonic() - settle_started >= settle_timeout:
                break
            print(f"publish-verify: settle: {len(unsettled)} path(s) "
                  f"not yet converged; sleeping {settle_interval}s",
                  flush=True)
            time.sleep(settle_interval)
        first_round = False
        for rel in sorted(unsettled):
            s2, body2, err2, attempts2, _m2 = fetch(bust_url(f"{base}/{rel}",
                                                       token))
            if s2 == 200 and (comparable_hash(rel, body2)[0]
                              == art_hashes[rel]):
                unsettled.discard(rel)
    report["settle_converged"] = manifest_settled and not unsettled
    report["settle_waited_seconds"] = round(
        time.monotonic() - settle_started, 3)
    report["settle_unsettled"] = sorted(unsettled)
    if report["settle_converged"]:
        print(f"publish-verify: settle: converged in "
              f"{report['settle_waited_seconds']}s", flush=True)
    else:
        print(f"publish-verify: settle: TIMEOUT after "
              f"{report['settle_waited_seconds']}s; still unsettled: "
              f"{sorted(unsettled)}; strict pass will report them",
              flush=True)
    for comp, entry in expected["components"].items():
        live_entry = (live.get("components") or {}).get(comp)
        if not live_entry:
            problems.append(f"component {comp}: missing from live manifest")
            report["checks"].append({
                "component": comp, "path": None, "url": manifest_url,
                "outcome": "component_missing", "http_status": s,
                "attempts": attempts,
                "error": f"component {comp}: missing from live manifest",
                "live_sha256": None, "artifact_sha256": None})
            continue
        if live_entry.get("asof") != entry["asof"]:
            problems.append(
                f"component {comp} asof: live={live_entry.get('asof')} "
                f"expected={entry['asof']}")
            report["checks"].append({
                "component": comp, "path": None, "url": manifest_url,
                "outcome": "asof_mismatch", "http_status": s,
                "attempts": attempts, "error": problems[-1],
                "live_sha256": None, "artifact_sha256": None})
        for rel in entry["paths"]:
            url = bust_url(f"{base}/{rel}", token)
            s, body, err, attempts, meta = fetch(url)
            if s != 200:
                detail = f"HTTP {s}" if s else f"transport error: {err}"
                problems.append(
                    f"{rel}: live fetch failed url={url} {detail} "
                    f"after {attempts} attempt(s)")
                report["checks"].append({
                    "component": comp, "path": rel, "url": url,
                    "outcome": "fetch_failed",
                    "http_status": s if s else None, "attempts": attempts,
                    "error": detail, "live_sha256": None,
                    "artifact_sha256": None})
                continue
            live_hash = hashlib.sha256(body).hexdigest()
            live_cmp_hash, live_stripped = comparable_hash(rel, body)
            try:
                art_hash, art_cmp_hash, art_stripped = artifact_hash(
                    rel, f"{args.artifact_dir}/{rel}")
            except OSError as e:
                problems.append(f"{rel}: artifact unreadable: {e}")
                report["checks"].append({
                    "component": comp, "path": rel, "url": url,
                    "outcome": "artifact_unreadable", "http_status": s,
                    "attempts": attempts, "error": str(e),
                    "live_sha256": live_hash, "artifact_sha256": None})
                continue
            if live_cmp_hash != art_cmp_hash:
                problems.append(
                    f"{rel}: bytes differ live={live_hash[:12]} "
                    f"artifact={art_hash[:12]}")
                # Mismatch instrumentation (2026-10-31): capture the
                # live bytes + headers + final URL into the report
                # so the next diff names the cause. Diagnostic only;
                # the outcome above is already decided.
                check = {
                    "component": comp, "path": rel, "url": url,
                    "outcome": "bytes_differ", "http_status": s,
                    "attempts": attempts,
                    "error": problems[-1], "live_sha256": live_hash,
                    "artifact_sha256": art_hash,
                    "live_beacon_stripped": live_stripped,
                    "artifact_beacon_stripped": art_stripped}
                check.update(live_capture(body, meta))
                report["checks"].append(check)
                print(f"publish-verify: captured live bytes for {rel} "
                      f"({check['live_body_bytes']} bytes, "
                      f"truncated={check['live_body_truncated']}) "
                      f"into the report", flush=True)
            else:
                if live_stripped or art_stripped:
                    print(f"publish-verify: beacon-tolerant ok for "
                          f"{rel} (stripped live={live_stripped} "
                          f"artifact={art_stripped} beacon element(s); "
                          f"all other bytes identical)", flush=True)
                report["checks"].append({
                    "component": comp, "path": rel, "url": url,
                    "outcome": "ok", "http_status": s, "attempts": attempts,
                    "error": None, "live_sha256": live_hash,
                    "artifact_sha256": art_hash,
                    "live_beacon_stripped": live_stripped,
                    "artifact_beacon_stripped": art_stripped})
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


def main():
    ap = argparse.ArgumentParser(description="P2 publish verifier")
    ap.add_argument("--mode", choices=["artifact", "live"], required=True)
    ap.add_argument("--artifact-dir", required=True)
    ap.add_argument("--base-url", default="https://shirjankhadka.com.np")
    ap.add_argument("--report-path", default="publish-verify-report.json")
    ap.add_argument("--settle-timeout", type=float, default=300,
                    help="live mode only: max seconds to wait for edge "
                    "convergence (manifest snapshot + component bytes) "
                    "before the strict pass; 0 = check once, do not wait")
    ap.add_argument("--settle-interval", type=float, default=15,
                    help="live mode only: seconds between settle polls")
    ap.add_argument("--no-cache-bust", action="store_true",
                    help="live mode only: do NOT append the per-run "
                    "cache-bust query string (debugging only; default "
                    "is busting ON)")
    args = ap.parse_args()

    # CHARTER v3 P0: one unique token per live run, shared by every
    # fetch in the run (manifest, settle polls, strict pass).
    if args.mode == "live" and not args.no_cache_bust:
        args.cache_bust = uuid.uuid4().hex[:16]
    else:
        args.cache_bust = None

    report = {
        "tool": "publish-verify.py",
        "mode": args.mode,
        "base_url": args.base_url,
        "started_utc": datetime.datetime.now(
            datetime.timezone.utc).isoformat(),
        "finished_utc": None,
        "expected_snapshot_sha": None,
        "live_snapshot_sha": None,
        "result": "fail",
        "problems": [],
        "fatal_error": None,
        "checks": [],
        "settle_converged": None,
        "settle_waited_seconds": 0,
        "settle_unsettled": [],
        "cache_bust": args.cache_bust,
    }
    if args.cache_bust:
        print(f"publish-verify: cache-bust token={args.cache_bust}",
              flush=True)
    code = 1
    try:
        code = run(args, report)
    except Exception as e:
        report["fatal_error"] = f"{type(e).__name__}: {e}"
        print(f"publish-verify: FATAL {type(e).__name__}: {e}", flush=True)
        code = 1
    finally:
        report["finished_utc"] = datetime.datetime.now(
            datetime.timezone.utc).isoformat()
        report["result"] = "ok" if code == 0 else "fail"
        try:
            with open(args.report_path, "w") as f:
                json.dump(report, f, indent=2)
                f.write("\n")
            print(f"publish-verify: report written to {args.report_path}",
                  flush=True)
        except OSError as e:
            print(f"publish-verify: WARN report not written: {e}", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
