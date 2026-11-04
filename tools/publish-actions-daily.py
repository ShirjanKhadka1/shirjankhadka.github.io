#!/usr/bin/env python3
"""Nepse Decode — corporate-actions daily publisher (Charter v5 item 6).

Replaces the old PR-path deploy (run-actions-daily.sh + pr-flow-deploy.py
+ squash-merge to protected main) with the data-branch writer path.
Nothing here commits to or pushes to protected main, and there is no
--force path anywhere.

OWNERSHIP — read before changing (verified 2026-11-04 against the live
data-branch manifest + Publish assembler):
  * nepse-chart/data/corporate-actions.json (notice archive) and
    nepse-actions/index.html (baked page) are OWNED by the `content`
    component (GitHub Actions content pipeline, 06:00 + 18:00 NPT,
    tools/content-data-writer.py). They are NEVER claimed under a new
    component: the assembler overlays components in sorted order, so a
    duplicate claim would either shadow or be shadowed silently.
    This driver stages archive + page through the `content` component
    with data-branch-writer --manifest-paths carrying the component's
    FULL live path list (read from data/_manifest.json at run time,
    never hard-coded), so the overlay set can never shrink.
  * data/corporate-actions-ledger.json (session ledger) is UNCLAIMED
    (no component declares it; the data branch holds only a stale
    Oct-30 orphan from pre-migration PRs). This driver owns it under
    the new component `actions-daily`.
  * The baked page is first paint only: js/nepse-actions.js re-renders
    from the published archive JSON every 5 minutes, so staging the
    archive is what makes new notices live; staging the bake keeps
    first paint current too.

SEEDING (divergence is the failure this migration fixes — main's
archive had 33 items incl. the Nov-3 NWCL notice while the served
data-branch copy had 32):
  * Archive + page gate references come from the DATA branch (the
    served copies), never main's stale-or-ahead copies — EXCEPT the
    first writer-path run, which RECONCILES main's archive into the
    seed (see reconcile_first_run): the Nov-3 PR #364 record (33
    items) was stranded on main by content shadowing while the served
    copy held 32, and the evening collector's 4-day portal window has
    already moved past the Nov-3 notice, so no future collector run
    would re-find it. Reconciliation is a pure UNION by storyKey —
    it never drops an item from either side; on a conflict the later
    verifiedAt wins, ties go to the served (data) copy — and it
    self-disables once `actions-daily` exists in the manifest.
  * Previous ledger: from the DATA branch once `actions-daily` exists
    in the manifest, else from MAIN (main holds the authoritative
    runs history until the first writer-path write lands; the data
    orphan is never used as a seed).
  * div-live / verdicts / universe / stocks / page assets come from
    the ephemeral main checkout (inputs owned by other lanes,
    read-only here).

PIPELINE (all inside one fresh ephemeral checkout, removed on exit):
  1. seed archive (data) + page (data) + prev ledger (rule above)
  2. node tools/collect-corporate-actions.js (fail on non-zero exit
     or on all 9 portal fetches failing — a blind "nothing new" is
     worse than a loud miss, as before)
  3. node tools/build-actions-page.js
  4. ledger build (verifier skip) -> verify -> ledger build
     (verifier pass) -> verify (the verifier never writes data)
  5. NO-CHANGE GATE: rebuilt archive + page byte-identical to the
     data-branch seeds => SILENT, everything discarded (the ledger
     drifts daily by design — built_at, days_from_build, runs — and
     is NEVER the no-change signal, as before).
  6. On change: stage ledger (component actions-daily) then
     archive + page (component content, full --manifest-paths),
     wait for Publish on the last WRITTEN commit, purge the three
     served URLs, verify served bytes (archive count + newest
     storyKey, ledger items_total, page first-paint headline or
     session button). Served verification retries 3x; a failure
     after that fails LOUD — a staged-but-unverified run is never
     reported as done.
  7. No-change days still run a served-sanity check (served archive
     must match the seeded copy): a transport error only warns and
     stays SILENT (transient), but served bytes OBSERVABLY OLDER
     than the seed fail LOUD — otherwise a stale edge would never
     alarm on no-change days.

Modes: default publishes; --dry-run builds + verifies + reports
what WOULD stage, and writes nothing to the data branch (safe proof
mode — no data-branch write, no Publish dispatch).

Exit codes: 0 with a final `RESULT: SILENT` / `RESULT: DEPLOYED ...`
line; non-zero on any gate/deploy/verify failure.
"""

import argparse
import base64
import datetime as dt
import html as htmlmod
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
MAIN_BRANCH = "main"

ARCHIVE = "nepse-chart/data/corporate-actions.json"
PAGE = "nepse-actions/index.html"
LEDGER = "data/corporate-actions-ledger.json"
CONTENT_COMPONENT = "content"
ACTIONS_COMPONENT = "actions-daily"

LIVE_URLS = ["https://shirjankhadka.com.np/nepse-actions/",
             "https://shirjankhadka.com.np/nepse-chart/data/"
             "corporate-actions.json",
             "https://shirjankhadka.com.np/data/"
             "corporate-actions-ledger.json"]
ARCHIVE_URL = LIVE_URLS[1]
LEDGER_URL = LIVE_URLS[2]
PAGE_URL = LIVE_URLS[0]

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
    contributors publisher (NOT /tmp: /tmp is a 512M tmpfs and a full
    site checkout does not fit reliably). Cleanup catches
    BaseException: SystemExit would otherwise leak the scratch dir
    on exactly the loud-failure path."""
    base = os.path.join(HOME, "workspace", ".ephemeral-checkouts")
    os.makedirs(base, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="actions-daily-", dir=base)
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
                 "User-Agent": "muse-actions-daily"})
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


def _fetch_repo_bytes(repo_path, ref):
    """Exact bytes of a file at a ref (byte-preserving: the gate
    compares rebuilt bytes against these seeds)."""
    s, b = _gh_api("GET", f"/contents/{repo_path}?ref={ref}")
    if s != 200 or not isinstance(b, dict) or "content" not in b:
        raise SystemExit(f"seed: fetch failed for {repo_path}@{ref} "
                         f"(HTTP {s}); refusing to build on a guess")
    try:
        return base64.b64decode(b["content"])
    except Exception as e:
        raise SystemExit(f"seed: {repo_path}@{ref} is not valid "
                         f"base64 ({e})")


def get_data_manifest():
    raw = _fetch_repo_bytes("data/_manifest.json", DATA_BRANCH)
    try:
        man = json.loads(raw)
    except ValueError as e:
        raise SystemExit(f"seed: data manifest is not valid JSON ({e})")
    if not isinstance(man, dict) or not man:
        raise SystemExit("seed: data manifest is empty or not an object")
    return man


def seed_bytes(wt, repo_path, ref, dest_rel, expect_json_keys=()):
    data = _fetch_repo_bytes(repo_path, ref)
    if expect_json_keys:
        try:
            doc = json.loads(data)
        except ValueError as e:
            raise SystemExit(f"seed: {repo_path}@{ref} is not valid "
                             f"JSON ({e})")
        for k in expect_json_keys:
            if k not in doc:
                raise SystemExit(f"seed: {repo_path}@{ref} lacks key {k!r}")
    dest = os.path.join(wt, dest_rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    log(f"seeded {repo_path} from {ref} ({len(data)} bytes)")
    return data


def story_key(item):
    return item.get("storyKey") or \
        (item.get("kind") + "|" + (item.get("symbol") or ""))


def reconcile_first_run(wt, seeded_archive_doc):
    """First-run-only union of main's archive into the data seed.

    Returns the merged doc (also written back to wt/ARCHIVE so the
    collector dedups against it). Pure union: every storyKey from
    either side survives; on a conflict the later verifiedAt wins,
    ties go to the data (served) copy. Every main-won key is logged.
    A missing main archive (404) means nothing to reconcile; any
    other fetch failure FAILS (never silently skip reconciliation).
    """
    s, b = _gh_api("GET", f"/contents/{ARCHIVE}?ref={MAIN_BRANCH}")
    if s == 404:
        log("reconcile: no main archive; data seed stands alone")
        return seeded_archive_doc
    if s != 200 or not isinstance(b, dict) or "content" not in b:
        raise SystemExit(f"reconcile: main archive fetch failed "
                         f"(HTTP {s}); refusing to run unreconciled")
    try:
        main_doc = json.loads(base64.b64decode(b["content"]))
    except ValueError as e:
        raise SystemExit(f"reconcile: main archive is not valid "
                         f"JSON ({e})")
    data_items = seeded_archive_doc.get("items", [])
    main_items = main_doc.get("items", [])
    merged = {story_key(i): i for i in data_items}
    for item in main_items:
        k = story_key(item)
        if k not in merged:
            merged[k] = item
            log(f"reconcile: ADD main-only {k} announced "
                f"{item.get('announced')}")
        else:
            old, new = merged[k], item
            if str(new.get("verifiedAt") or "") > \
                    str(old.get("verifiedAt") or ""):
                merged[k] = new
                diffs = [f for f in set(old) | set(new)
                         if old.get(f) != new.get(f)]
                log(f"reconcile: main wins {k} (later verifiedAt) "
                    f"fields={diffs}")
    items = sorted(merged.values(),
                   key=lambda i: str(i.get("announced") or ""),
                   reverse=True)
    doc = dict(seeded_archive_doc)
    doc["items"] = items
    doc["count"] = len(items)
    # Newest verification timestamp of either side (the collector
    # rewrites `updated` only when it adds an item, so this stamp
    # survives a no-new-item run and stays honest).
    doc["updated"] = max(str(seeded_archive_doc.get("updated") or ""),
                         str(main_doc.get("updated") or ""))
    with open(os.path.join(wt, ARCHIVE), "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    log(f"reconcile: data {len(data_items)} + main {len(main_items)} "
        f"-> merged {len(items)} items")
    return doc


def run_tool(args, cwd, what):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                       timeout=1200)
    log(f"--- {what} (rc={r.returncode}) ---")
    if r.stdout:
        log(r.stdout[-4000:])
    if r.stderr:
        log(r.stderr[-2000:])
    if r.returncode != 0:
        raise SystemExit(f"{what} failed rc={r.returncode}")
    return r


def writer_stage(component, asof, message, files, manifest_paths=None):
    """One data-branch-writer call. Returns its proof dict."""
    args = [sys.executable, WRITER, "--component", component,
            "--asof", asof, "--message", message]
    if manifest_paths is not None:
        args += ["--manifest-paths", ",".join(manifest_paths)]
    for rp, local in files:
        args += ["--file", f"{rp}:{local}"]
    r = subprocess.run(args, capture_output=True, text=True,
                       timeout=600, env=WRITER_ENV)
    log(f"deploy: writer({component}) stdout:\n{r.stdout}")
    if r.stderr:
        log(f"deploy: writer({component}) stderr:\n{r.stderr}")
    if r.returncode != 0:
        raise SystemExit(f"writer({component}) failed rc={r.returncode}")
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
        raise SystemExit(f"writer({component}): no proof JSON")
    if proof.get("status") not in ("WRITTEN", "NO-CHANGES"):
        raise SystemExit(f"writer({component}): status="
                         f"{proof.get('status')!r}; refusing to publish")
    return proof


def curl_bytes(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Cache-Control": "no-cache",
                      "Pragma": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def served_archive_matches(seeded_doc, label):
    """True when the served archive carries exactly the seeded items
    (count + storyKey set). Transport/parse trouble raises, so the
    caller can tell 'unreachable' apart from 'observably older'."""
    raw = curl_bytes(ARCHIVE_URL)
    doc = json.loads(raw)
    seeded_keys = {i.get("storyKey") or
                   (i.get("kind") + "|" + (i.get("symbol") or ""))
                   for i in seeded_doc.get("items", [])}
    live_keys = {i.get("storyKey") or
                 (i.get("kind") + "|" + (i.get("symbol") or ""))
                 for i in doc.get("items", [])}
    ok = (doc.get("count") == seeded_doc.get("count") and
          live_keys == seeded_keys)
    log(f"served check [{label}]: live count={doc.get('count')} "
        f"want={seeded_doc.get('count')} keys_match="
        f"{live_keys == seeded_keys}")
    return ok


def page_shows_newest(page_html, newest):
    """First-paint check for the newest item: its escaped headline
    (builder algorithm mirrored: decode entities once, then escape),
    or — for a brand-new session — its session-strip button."""
    head = newest.get("headline") or ""
    decoded = re.sub(r"&#(\d+);",
                     lambda m: chr(int(m.group(1))), head)
    decoded = re.sub(r"&#x([0-9a-fA-F]+);",
                     lambda m: chr(int(m.group(1), 16)), decoded)
    for ent, ch in (("&quot;", '"'), ("&apos;", "'"), ("&#39;", "'"),
                    ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")):
        decoded = decoded.replace(ent, ch)
    esc = (decoded.replace("&", "&amp;").replace("<", "&lt;")
           .replace(">", "&gt;").replace('"', "&quot;"))
    if esc and esc in page_html:
        return True
    ann = str(newest.get("announced") or "")[:10]
    if ann and f'data-session="{ann}"' in page_html:
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="build + verify only; stage nothing, dispatch "
                         "no Publish (safe proof mode)")
    args = ap.parse_args()
    today = dt.datetime.now(NPT).date().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", today):
        raise SystemExit(f"bad asof {today!r}")

    wt = prepare_ephemeral_worktree()
    try:
        manifest = get_data_manifest()
        content_entry = manifest.get(CONTENT_COMPONENT)
        if not isinstance(content_entry, dict):
            raise SystemExit("seed: manifest has no content component; "
                             "ownership changed — refusing to guess")
        content_paths = content_entry.get("paths", [])
        for must in (ARCHIVE, PAGE):
            if must not in content_paths:
                raise SystemExit(
                    f"seed: content component no longer declares {must}; "
                    "ownership changed — refusing to stage it")
        log(f"content component paths ({len(content_paths)}): "
            f"{content_paths}")

        seeded_archive = seed_bytes(wt, ARCHIVE, DATA_BRANCH, ARCHIVE,
                                    expect_json_keys=("items", "count"))
        seeded_page = seed_bytes(wt, PAGE, DATA_BRANCH, PAGE)
        seeded_archive_doc = json.loads(seeded_archive)
        if seeded_archive_doc.get("count") != \
                len(seeded_archive_doc.get("items", [])):
            raise SystemExit("seed: data archive count != len(items)")

        # First writer-path run (actions-daily not yet in the manifest):
        # reconcile main's stranded record into the seed + seed the
        # previous ledger from main. Later runs seed everything from
        # data and never touch main's copies again.
        first_run = ACTIONS_COMPONENT not in manifest
        if first_run:
            reconcile_first_run(wt, seeded_archive_doc)
        if not first_run:
            seed_bytes(wt, LEDGER, DATA_BRANCH, LEDGER,
                       expect_json_keys=("items", "meta"))
            log("prev ledger seeded from data (actions-daily exists)")
        else:
            seed_bytes(wt, LEDGER, MAIN_BRANCH, LEDGER,
                       expect_json_keys=("items", "meta"))
            log("prev ledger seeded from main (first writer-path run)")

        # --- collect + build + verify (same order as the old script)
        coll = run_tool(["node", "tools/collect-corporate-actions.js"],
                        wt, "collector")
        failed = coll.stdout.count("portal fetch failed")
        if failed >= 9:
            raise SystemExit("collector: ALL 9 portal fetches failed — "
                             "refusing to call this a clean no-change day")
        run_tool(["node", "tools/build-actions-page.js"], wt,
                 "page builder")
        run_tool([sys.executable, "tools/build-actions-ledger.py",
                  "--root", ".", "--verifier", "skip",
                  "--page-rebuilt", "1"], wt, "ledger builder (skip)")
        run_tool([sys.executable, "tools/verify-actions.py",
                  "--ledger", LEDGER], wt, "verifier")
        run_tool([sys.executable, "tools/build-actions-ledger.py",
                  "--root", ".", "--verifier", "pass",
                  "--page-rebuilt", "1"], wt, "ledger builder (pass)")
        run_tool([sys.executable, "tools/verify-actions.py",
                  "--ledger", LEDGER], wt, "verifier (final)")

        with open(os.path.join(wt, ARCHIVE), "rb") as f:
            new_archive = f.read()
        with open(os.path.join(wt, PAGE), "rb") as f:
            new_page = f.read()
        new_doc = json.loads(new_archive)
        log(f"archive: seeded count={seeded_archive_doc.get('count')} "
            f"rebuilt count={new_doc.get('count')} "
            f"page bytes seeded={len(seeded_page)} "
            f"rebuilt={len(new_page)}")

        if new_archive == seeded_archive and new_page == seeded_page:
            log("no change (archive + page byte-identical to the "
                "served data-branch copies; ledger drift discarded)")
            # Served-sanity: served must match the seed. Transport
            # trouble only warns (transient); observably older bytes
            # fail LOUD — a stale edge must never hide behind SILENT.
            try:
                if not served_archive_matches(seeded_archive_doc,
                                              "no-change"):
                    raise SystemExit(
                        "served archive DIFFERS from the data-branch "
                        "seed on a no-change day (older, or newer via "
                        "another writer) — refusing SILENT")
            except SystemExit:
                raise
            except Exception as e:
                log(f"WARNING: no-change served check unreachable "
                    f"({e}); staying SILENT on transport trouble only")
            print("RESULT: SILENT")
            return 0

        newest = None
        if new_doc.get("items"):
            newest = sorted(new_doc["items"],
                            key=lambda i: str(i.get("announced") or ""),
                            reverse=True)[0]
        log(f"change: newest item "
            f"{(newest or {}).get('storyKey')} announced "
            f"{(newest or {}).get('announced')}")
        if args.dry_run:
            log("DRY-RUN: would stage ledger (actions-daily) + "
                "archive + page (content, full manifest-paths); "
                "no data-branch write, no Publish dispatch")
            print(f"RESULT: DRY-RUN-CHANGE count={new_doc.get('count')}")
            return 0

        # --- stage: ledger first, then content (the content commit's
        # tree then contains both, so it is the Publish snapshot).
        snap = None
        proof_ledger = writer_stage(
            ACTIONS_COMPONENT, today,
            f"Corporate actions ledger {today}",
            [(LEDGER, os.path.join(wt, LEDGER))])
        if proof_ledger.get("status") == "WRITTEN":
            snap = proof_ledger.get("commit")
        proof_content = writer_stage(
            CONTENT_COMPONENT, today,
            f"Corporate actions daily: {new_doc.get('count')} "
            "verified notices",
            [(ARCHIVE, os.path.join(wt, ARCHIVE)),
             (PAGE, os.path.join(wt, PAGE))],
            manifest_paths=content_paths)
        if proof_content.get("status") == "WRITTEN":
            snap = proof_content.get("commit")
        if snap is None:
            # Post-gate both NO-CHANGES: another writer just landed
            # the same bytes. Nothing new to publish, but the served
            # bytes still get verified below (they may be queued
            # behind the other writer's Publish).
            log("deploy: both writers NO-CHANGES (another writer "
                "landed the same bytes); skipping Publish wait")
        else:
            log(f"deploy: staged data commit {snap}; waiting for "
                "Publish")
            pw = subprocess.run(
                [sys.executable, PUBLISH_WAIT, "--snapshot", snap,
                 "--timeout", "900", "--interval", "30"],
                capture_output=True, text=True, timeout=1200,
                env=WRITER_ENV)
            log(f"deploy: publish-wait stdout:\n{pw.stdout}")
            if pw.stderr:
                log(f"deploy: publish-wait stderr:\n{pw.stderr}")
            if pw.returncode != 0:
                raise SystemExit("publish-wait failed "
                                 f"rc={pw.returncode}")
            published = [ln for ln in pw.stdout.splitlines()
                         if ln.startswith("PUBLISHED ")]
            if not published:
                raise SystemExit("deploy: no PUBLISHED line from "
                                 "publish-wait")
            tag = published[-1].split()[-1]
            log(f"deploy: {published[-1]}")
        pg = subprocess.run([sys.executable, PURGE] + LIVE_URLS,
                            capture_output=True, text=True, timeout=300,
                            env=WRITER_ENV)
        log(f"deploy: purge rc={pg.returncode} out={pg.stdout.strip()} "
            f"err={pg.stderr.strip()}")
        time.sleep(30)
        for attempt in (1, 2, 3):
            try:
                ok_archive = served_archive_matches(new_doc,
                                                    f"publish {attempt}")
                live_ledger = json.loads(curl_bytes(LEDGER_URL))
                ok_ledger = (live_ledger.get("meta", {}).get(
                    "items_total") == new_doc.get("count"))
                log(f"served check {attempt}: ledger items_total="
                    f"{live_ledger.get('meta', {}).get('items_total')} "
                    f"want={new_doc.get('count')}")
                page_html = curl_bytes(PAGE_URL).decode("utf-8", "ignore")
                ok_page = (page_shows_newest(page_html, newest)
                           if newest else True)
                log(f"served check {attempt}: page newest shown="
                    f"{ok_page}")
                if ok_archive and ok_ledger and ok_page:
                    log(f"deploy: LIVE VERIFIED count="
                        f"{new_doc.get('count')}")
                    print(f"RESULT: DEPLOYED {new_doc.get('count')} "
                          "notices")
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
