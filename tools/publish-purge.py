#!/usr/bin/env python3
"""Cloudflare purge for P2 deploys (post-flip only).

Reads one URL per line from a file (or stdin) and purges them via
the Cloudflare API in batches of at most 30 (the repo's standing
purge discipline). Credentials come from the environment:
  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID
(both must be set as repository secrets for the publish workflow;
the sandbox's connector token is NOT available inside CI, so the
workflow fails loudly — not silently stale — when they are absent).

Exit 0 only when every batch reports success. Exit 1 otherwise,
printing the failing batch's response (the alert body).
"""
import json
import os
import sys
import urllib.request


def purge_batch(urls, token, zone):
    body = json.dumps({"files": urls}).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache",
        method="POST", data=body, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except ValueError:
            return e.code, {"raw": "unparsable"}


def main():
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    zone = os.environ.get("CLOUDFLARE_ZONE_ID", "")
    if not token or not zone:
        print("publish-purge: FAIL CLOUDFLARE_API_TOKEN and "
              "CLOUDFLARE_ZONE_ID must both be set (repository secrets; "
              "see ops/PROGRAM-STATUS.md blockers). Refusing to call "
              "a deploy verified while edge nodes may serve stale "
              "bytes.", flush=True)
        return 1
    src = sys.argv[1] if len(sys.argv) > 1 else "-"
    if src == "-":
        urls = [l.strip() for l in sys.stdin if l.strip()]
    else:
        urls = [l.strip() for l in open(src) if l.strip()]
    urls = sorted(set(urls))
    if not urls:
        print("publish-purge: nothing to purge", flush=True)
        return 0
    failed = []
    for i in range(0, len(urls), 30):
        batch = urls[i:i + 30]
        status, body = purge_batch(batch, token, zone)
        ok = status == 200 and body.get("success") is True
        print(f"publish-purge: batch {i // 30 + 1} ({len(batch)} URLs) "
              f"-> {status} success={body.get('success')}", flush=True)
        if not ok:
            failed.append((batch, body))
    if failed:
        print("publish-purge: FAIL batches failed:", flush=True)
        for batch, body in failed:
            print(f"  {batch[:3]}... -> {json.dumps(body)[:400]}",
                  flush=True)
        return 1
    print(f"publish-purge: OK {len(urls)} URLs in "
          f"{(len(urls) + 29) // 30} batches", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
