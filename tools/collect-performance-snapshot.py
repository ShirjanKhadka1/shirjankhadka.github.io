#!/usr/bin/env python3
"""Performance snapshot collector (built 2026-10-23; data-branch
publish since 2026-10-31, P1b/P2).

ONE GET to Chukul's public performance endpoint (one enriched row per
symbol: OHLCV + prev_close + daily/weekly/monthly %/point change + amounts).
Archives EVERY run to ~/workspace/nepse-data-archive/performance/.
Publishes the latest snapshot to nepse-chart/data/performance.json only when:
  - in-session (trading day, 11:00-15:00 NPT), or
  - post-close (trading day, >= 15:05 NPT, no post-close publish yet today).
--force-publish   testing only: publish regardless of window.
Publish only if the content hash changed.

Publish path (P1b/P2): the snapshot is written to the `data` branch
through tools/data-branch-writer.py (component performance-snapshot),
never through a PR. The ONE publish workflow assembles main + data
into the deployed site. data/health.json + status/index.html are NOT
written here: the publish assembler regenerates them and forbids them
as overlaid paths.
--dry-run   print the data-branch write that would happen; write
            nothing, open no PR, touch no state.
"""
import argparse, glob, hashlib, json, os, subprocess, sys, tempfile, urllib.request
from datetime import datetime, timezone, timedelta
try:
    import stalled_publish
except ImportError:  # run from another cwd: script dir is not sys.path[0]
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import stalled_publish

NPT = timezone(timedelta(hours=5, minutes=45))
URL = "https://chukul.com/api/data/historydata/performance/?type=stock"
UA = {"User-Agent": "NepseDecode-Research/1.0 (+https://shirjankhadka.com.np)"}
ARCH_DIR = "/home/hatch/workspace/nepse-data-archive/performance"
HOLIDAYS = "/home/hatch/workspace/nepse-data-archive/nepse-holidays.txt"
STATE = "/home/hatch/workspace/goals/finance-portfolio-and-daily-blog/hidden_files/script-first/state/performance-snapshot.json"
# Stalled-publish record (class 7, 2026-10-29): a failed deploy leaves
# STALLED_PATH (+ the exact unpublished bytes in STALLED_PAYLOAD) so the
# next run picks it up first; see stalled_publish.py for the contract.
STALLED_PATH = "/home/hatch/workspace/goals/finance-portfolio-and-daily-blog/hidden_files/script-first/state/performance-snapshot-stalled.json"
STALLED_PAYLOAD = "/home/hatch/workspace/goals/finance-portfolio-and-daily-blog/hidden_files/script-first/state/performance-snapshot-stalled-payload.json"


def record_stalled_publish(arch, session, content_bytes):
    """Persist the exact unpublished bytes + visible record; returns record."""
    os.makedirs(os.path.dirname(STALLED_PAYLOAD), exist_ok=True)
    with open(STALLED_PAYLOAD, "wb") as f:
        f.write(content_bytes)
    return stalled_publish.record_stalled(
        STALLED_PATH, arch, session,
        stalled_publish.content_hash(content_bytes),
        extra={"payload_path": STALLED_PAYLOAD, "relpath": RELPATH})


def clear_stalled_files(reason):
    """Clear record + payload sibling; True if a record was cleared."""
    cleared = stalled_publish.clear_stalled(STALLED_PATH, reason)
    try:
        if os.path.exists(STALLED_PAYLOAD):
            os.remove(STALLED_PAYLOAD)
    except OSError:
        pass
    return cleared


def pickup_stalled(state, current_hash, do_publish):
    """Next-run pickup, called BEFORE the current publish attempt.

    Returns (action, record-or-None). Actions: no-record,
    already-published, covered-by-current, published-stalled,
    retry-failed, pending-outside-window. A retry-failed record is KEPT
    so the current (newest) publish can still supersede it on success.
    """
    record = stalled_publish.load_stalled(STALLED_PATH)
    if not record:
        return "no-record", None
    resolution = stalled_publish.resolve_stalled(
        record, state.get("last_published_hash"), current_hash)
    if resolution == "already-published":
        clear_stalled_files("already-published")
        print("STALLED-PUBLISH PICKUP: stalled hash already live — "
              "cleared, no duplicate publish", flush=True)
        return "already-published", record
    if resolution == "covered-by-current":
        print("STALLED-PUBLISH PICKUP: stalled hash == current hash — "
              "this run's single publish covers it", flush=True)
        return "covered-by-current", record
    if not do_publish:
        print("STALLED-PUBLISH PENDING: record=%s archive=%s session=%s "
              "— outside publish window, pickup deferred to the next "
              "in-window run" % (STALLED_PATH, record.get("archive_path"),
                                 record.get("session")), flush=True)
        return "pending-outside-window", record
    payload_path = record.get("payload_path") or STALLED_PAYLOAD
    try:
        with open(payload_path, "rb") as f:
            stalled_bytes = f.read()
    except OSError:
        print("STALLED-PUBLISH PICKUP: payload file missing (%s) — "
              "current publish will supersede it" % payload_path, flush=True)
        return "covered-by-current", record
    try:
        deploy(stalled_bytes,
               "Performance snapshot (stalled pickup) %s" % record.get("session"),
               record.get("session"))
    except Exception as e:
        print("STALLED-PUBLISH RETRY-FAILED: %s — record KEPT, "
              "attempting current publish anyway" % e, flush=True)
        return "retry-failed", record
    state["last_published_hash"] = record.get("content_hash")
    clear_stalled_files("published-stalled")
    print("STALLED-PUBLISH PICKUP: stalled output published first "
          "(session=%s)" % record.get("session"), flush=True)
    return "published-stalled", record
WT = "/home/hatch/workspace/wt-perf"
RELPATH = "nepse-chart/data/performance.json"
COMPONENT = "performance-snapshot"

def is_holiday(date_str):
    try:
        with open(HOLIDAYS) as f:
            for line in f:
                if line.startswith(date_str):
                    return True
    except FileNotFoundError:
        pass
    return False

def is_trading_day(now):
    return now.weekday() < 5 and not is_holiday(now.strftime("%Y-%m-%d"))

def deploy(content_bytes, message, asof, dry_run=False):
    """Publish via the data branch (P1b/P2) — never a PR.

    Writes ONLY nepse-chart/data/performance.json through
    tools/data-branch-writer.py (component performance-snapshot, the
    manifest path the publish assembler overlays). data/health.json
    and status/index.html are deliberately NOT written: the assembler
    regenerates them and forbids them as overlaid paths. The data
    push triggers the ONE publish workflow; no commit to protected
    main, no PR per run.

    Returns the writer proof's commit SHA, "NO-CHANGES" when the data
    branch already carries these bytes, or "DRY-RUN" when dry_run
    (prints the exact writer invocation, performs no API write,
    opens no PR).
    """
    if dry_run:
        print(f"DRY-RUN deploy: branch=data component={COMPONENT} "
              f"path={RELPATH} asof={asof} bytes={len(content_bytes)} "
              f"sha256={hashlib.sha256(content_bytes).hexdigest()}",
              flush=True)
        print("DRY-RUN deploy: writer NOT invoked, no PR opened, "
              "no API write", flush=True)
        return "DRY-RUN"
    if not os.path.exists(os.path.join(WT, ".git")):
        subprocess.run(["git", "-C", "/home/hatch/workspace/wave8-build/repo",
                        "worktree", "add", "--detach", WT, "origin/main"],
                       check=True, capture_output=True, timeout=120)
    subprocess.run(["git", "fetch", "origin", "main"], cwd=WT, capture_output=True, timeout=60)
    subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=WT, capture_output=True, timeout=60)
    writer = os.path.join(WT, "tools", "data-branch-writer.py")
    if not os.path.exists(writer):
        raise RuntimeError(f"data-branch writer missing from worktree: {writer}")
    with tempfile.NamedTemporaryFile(prefix="perf-snapshot-",
                                     suffix=".json", delete=False) as tf:
        tf.write(content_bytes)
        tmp = tf.name
    try:
        dep = subprocess.run([sys.executable, writer,
                              "--component", COMPONENT,
                              "--message", message,
                              "--asof", asof,
                              "--file", f"{RELPATH}:{tmp}"],
                             capture_output=True, text=True, timeout=600)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    print(dep.stdout[-2000:] if dep.stdout else "", flush=True)
    if dep.returncode != 0:
        raise RuntimeError(f"data-branch write failed rc={dep.returncode}: {(dep.stderr or dep.stdout)[:400]}")
    proof = None
    for line in (dep.stdout or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                proof = json.loads(line)
            except ValueError:
                pass
    if not proof or proof.get("status") not in ("WRITTEN", "NO-CHANGES"):
        raise RuntimeError("data-branch writer produced no WRITTEN/NO-CHANGES proof")
    if proof["status"] == "NO-CHANGES":
        print(f"deploy: data branch already carries these bytes "
              f"(head={str(proof.get('head', ''))[:12]})", flush=True)
        return "NO-CHANGES"
    print(f"deploy: data-branch commit {proof.get('commit')}", flush=True)
    return proof["commit"]

def fetch_payload():
    # curl-first: urllib truncates chunked responses through this proxy
    # (IncompleteRead false-fails), curl handles them (Phase 7 lesson).
    try:
        out = subprocess.run(["curl", "-sS", "-A", UA["User-Agent"], "--max-time", "60", URL],
                             capture_output=True, check=True, timeout=70)
        return json.loads(out.stdout)
    except Exception as e:
        print(f"curl fetch failed ({e}); falling back to urllib", file=sys.stderr)
    req = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force-publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the data-branch write that would happen; "
                    "write nothing, open no PR, touch no state")
    a = ap.parse_args()
    now = datetime.now(NPT)

    if a.dry_run:
        # No fetch, no archive, no state writes: reuse the newest
        # archive and show exactly what deploy() would invoke.
        files = sorted(glob.glob(os.path.join(ARCH_DIR, "performance-*.json")))
        assert files, "dry-run: no performance archive found"
        payload = json.load(open(files[-1]))
        rows = payload if isinstance(payload, list) else payload.get("data") or payload.get("results") or []
        assert isinstance(rows, list) and len(rows) >= 300, "dry-run: archive shape assert failed"
        symbols = {r["symbol"]: r for r in rows}
        session_date = None
        for r in rows:
            if r.get("date"):
                session_date = r["date"]; break
        published = {"asof": now.isoformat(), "session_date": session_date, "symbols": symbols}
        content = json.dumps(published, separators=(",", ":")).encode()
        print(f"dry-run: newest archive {files[-1]}: {len(rows)} symbols, session_date={session_date}")
        deploy(content,
               f"Performance snapshot {now.strftime('%Y-%m-%d')} {now.strftime('%H:%M')} (dry-run)",
               session_date or now.strftime("%Y-%m-%d"), dry_run=True)
        return 0

    payload = fetch_payload()
    rows = payload if isinstance(payload, list) else payload.get("data") or payload.get("results") or []
    assert isinstance(rows, list) and len(rows) >= 300, f"shape assert: expected >=300 rows, got {len(rows) if isinstance(rows, list) else type(rows)}"
    assert all(isinstance(r, dict) and r.get("symbol") for r in rows), "shape assert: every row needs a symbol"

    os.makedirs(ARCH_DIR, exist_ok=True)
    arch = os.path.join(ARCH_DIR, f"performance-{now.strftime('%Y-%m-%dT%H-%M')}.json")
    with open(arch, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"archived {arch}: {len(rows)} symbols")

    symbols = {r["symbol"]: r for r in rows}
    session_date = None
    for r in rows:
        if r.get("date"):
            session_date = r["date"]; break
    published = {"asof": now.isoformat(), "session_date": session_date, "symbols": symbols}
    content = json.dumps(published, separators=(",", ":")).encode()
    chash = hashlib.sha256(content).hexdigest()

    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    st = {}
    if os.path.exists(STATE):
        st = json.load(open(STATE))
    today = now.strftime("%Y-%m-%d")
    in_session = is_trading_day(now) and (now.hour, now.minute) >= (11, 0) and (now.hour, now.minute) <= (15, 0)
    post_close = is_trading_day(now) and (now.hour, now.minute) >= (15, 5) and st.get("post_close_published_date") != today
    do_publish = a.force_publish or in_session or post_close
    # Class 7 pickup FIRST: a stalled record from a failed deploy is
    # resolved before the current publish can claim success.
    pickup_action, _pickup_record = pickup_stalled(st, chash, do_publish)
    stalled_pending = pickup_action in ("covered-by-current", "retry-failed")
    if not do_publish:
        print("outside publish windows — archive only")
        st["last_archive"] = arch; st["last_hash"] = st.get("last_hash")
        json.dump(st, open(STATE, "w"), indent=1)
        return 0
    if st.get("last_published_hash") == chash and not a.force_publish:
        print("content hash unchanged — no publish")
        if stalled_pending:
            # Current bytes already live, so a covered stalled record is
            # already live too — clear it, publish nothing twice.
            clear_stalled_files("already-live-via-current")
        return 0
    try:
        sha = deploy(content, f"Performance snapshot {today} {now.strftime('%H:%M')}",
                     session_date or today)
    except Exception:
        # Archive already exists (above); leave the VISIBLE stalled
        # record so the next run picks this output up first.
        record_stalled_publish(arch, session_date or today, content)
        raise
    if stalled_pending:
        clear_stalled_files("superseded-by-current-publish")
    st["last_published_hash"] = chash
    st["last_published_at"] = now.isoformat()
    if post_close or (a.force_publish and (now.hour, now.minute) >= (15, 5)):
        st["post_close_published_date"] = today
    json.dump(st, open(STATE, "w"), indent=1)
    print(f"published {RELPATH}: {len(symbols)} symbols, session_date={session_date}, deploy={sha}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
