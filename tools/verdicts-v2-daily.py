#!/usr/bin/env python3
"""Nepse Decode: daily Verdict Engine v2 (Warning Radar) pipeline.

Runs every trading day after market close (cron v2-verdicts-daily, 16:00 NPT).
MUST run from a clean worktree checked out at origin/main (~/workspace/wt-verdicts)
— never from the feature-branch working tree.

Pipeline:
  1. Read session_date from the worktree's nepse-chart/data/live.json
     (authoritative trading day; the market-close pipeline keeps it fresh).
     Skip (exit 0) when data/verdicts-v2-summary.json already carries this
     session, unless --force.
  2. Append the session's bar to the own OHLC DB from live.json quotes.
  3. Rebuild ~/workspace/v2-mirror from the OHLC DB.
  4. Run node tools/build-verdicts-v2.js --mirror <mirror> (own data only;
     the builder merges the official close from live.json when needed).
  5. Run node tools/build-health.js (session-data deploy bake).
  6. Run python3 tools/track-warning-radar.py (ledger + track record).
  7. Deploy via the PR-flow helper (tools/pr-flow-deploy.py: branch + PR +
     required checks + API squash-merge; never pre-commit).

Usage:
    python3 tools/verdicts-v2-daily.py [--force] [--no-deploy]
"""
import argparse
import glob
import json
import os
import subprocess
import sys
from datetime import datetime

WORKTREE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OHLC_DB = os.environ.get("OHLC_DB", "/home/hatch/workspace/nepse-data-archive/ohlc-db")
V2_MIRROR = os.environ.get("V2_MIRROR", "/home/hatch/workspace/v2-mirror")
REPO_SLUG = "ShirjanKhadka1/shirjankhadka.github.io"

DATA_FILES = [
    "data/verdicts-v2.json",
    "data/verdicts-v2-summary.json",
    "data/verdicts-v2-history.json",
    "data/warning-ledger.json",
    "data/verdicts-v2-track-record.json",
    "data/health.json",
    "status/index.html",
]


def log(msg):
    print(f"[verdicts-v2-daily] {msg}", flush=True)


def run(cmd, cwd=None, timeout=600):
    r = subprocess.run(cmd, cwd=cwd or WORKTREE, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        log(f"CMD FAILED: {' '.join(cmd[:5])}\n{(r.stderr or r.stdout)[-800:]}")
        raise SystemExit(1)
    return r


def load_json(path):
    with open(path) as f:
        return json.load(f)


def update_ohlc_db(live):
    session = live.get("session_date")
    quotes = live.get("quotes") or []
    qmap = {q["symbol"]: q for q in quotes if isinstance(q, dict) and q.get("symbol")}
    log(f"session {session}, {len(qmap)} quotes")
    updated = 0
    for symbol, q in qmap.items():
        safe = symbol.replace("/", "-")
        db_path = os.path.join(OHLC_DB, f"{safe}.json")
        if os.path.exists(db_path):
            d = load_json(db_path)
        else:
            d = {"symbol": symbol, "bars": [], "provenance": {"sources": {}}}
        bars = d.get("bars", [])
        if bars and bars[-1].get("date") == session:
            continue
        ltp = q.get("ltp") or 0
        if not ltp:
            continue
        bars.append({
            "date": session,
            "open": q.get("previous_close") or ltp,
            "high": q.get("high") or ltp,
            "low": q.get("low") or ltp,
            "close": ltp,
            "volume": q.get("volume", 0) or 0,
            "turnover": q.get("turnover", 0) or 0,
        })
        prov = d.get("provenance", {})
        sources = prov.get("sources", {})
        sources["own-live"] = sources.get("own-live", 0) + 1
        prov["sources"] = sources
        prov["bar_count"] = len(bars)
        if bars:
            prov["date_range"] = [bars[0].get("date"), bars[-1].get("date")]
        d["provenance"] = prov
        d["bars"] = bars
        with open(db_path, "w") as f:
            json.dump(d, f, separators=(",", ":"))
        updated += 1
    log(f"OHLC DB updated: {updated} symbols")
    return updated


def rebuild_mirror():
    os.makedirs(V2_MIRROR, exist_ok=True)
    files = glob.glob(os.path.join(OHLC_DB, "*.json"))
    count = 0
    for f in files:
        d = load_json(f)
        symbol = d.get("symbol")
        if not symbol:
            continue
        v2_bars = []
        for b in d.get("bars", []):
            date = b.get("date", "")
            ymd = int(date.replace("-", "")) if date else 0
            v2_bars.append({
                "ymd": ymd, "date": date,
                "open": b.get("open", 0), "high": b.get("high", 0),
                "low": b.get("low", 0), "close": b.get("close", 0),
                "volume": b.get("volume", 0), "turnover": b.get("turnover", 0),
            })
        v2_bars.sort(key=lambda x: x["ymd"])
        with open(os.path.join(V2_MIRROR, symbol.replace("/", "-") + ".json"), "w") as out:
            json.dump({"symbol": symbol, "bars": v2_bars}, out, separators=(",", ":"))
        count += 1
    log(f"mirror rebuilt: {count} files")
    return count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="rebuild even if session already current")
    ap.add_argument("--no-deploy", action="store_true", help="build only, do not push")
    args = ap.parse_args()

    os.chdir(WORKTREE)
    live = load_json(os.path.join(WORKTREE, "nepse-chart", "data", "live.json"))
    session = live.get("session_date")
    if not session:
        log("FATAL: live.json has no session_date")
        return 2
    log(f"live session_date={session} market={live.get('market')}")

    # holiday guard (2026-10-19 fix): never append bars for a holiday session.
    try:
        hol = load_json(os.path.join(WORKTREE, "tools", "nepse-holidays.json"))
        hdays = {h.get("date") if isinstance(h, dict) else h for h in hol.get("holidays", [])}
        if session in hdays:
            log(f"holiday session {session}; skipping OHLC append and rebuild")
            return 0
    except Exception as e:
        log(f"holiday check unreadable ({e}); proceeding")

    # freshness gate
    summ_path = os.path.join(WORKTREE, "data", "verdicts-v2-summary.json")
    if os.path.exists(summ_path) and not args.force:
        cur = load_json(summ_path).get("session_date")
        if cur == session:
            log(f"summary already current for {session} — nothing to do")
            return 0

    update_ohlc_db(live)
    rebuild_mirror()

    log("running build-verdicts-v2.js ...")
    run(["node", "tools/build-verdicts-v2.js", "--mirror", V2_MIRROR], timeout=1200)

    log("running build-health.js ...")
    run(["node", "tools/build-health.js"], timeout=300)

    log("running track-warning-radar.py ...")
    run(["python3", "tools/track-warning-radar.py", "--repo", WORKTREE], timeout=600)

    log("running track-verdict-persistence.py ...")
    run(["python3", "tools/track-verdict-persistence.py", "--repo", WORKTREE], timeout=300)

    # stage only our files
    existing = [p for p in DATA_FILES if os.path.exists(os.path.join(WORKTREE, p))]
    run(["git", "add"] + existing)
    diff = subprocess.run(["git", "diff", "--cached", "--name-only"],
                          cwd=WORKTREE, capture_output=True, text=True).stdout.strip()
    if not diff:
        log("no changes to deploy")
        return 0
    log(f"changed files:\n{diff}")

    msg = f"v2 Warning Radar: daily rebuild {session} (ledger + track record)"
    if args.no_deploy:
        log(f"--no-deploy: built {session}, not pushed")
        return 0
    # PR-flow deploy (since PR #103): never pre-commit — the helper stages
    # + commits from uncommitted worktree changes, polls the 5 required
    # checks, updates the branch if main moves, and squash-merges via API.
    helper = os.path.join(WORKTREE, "tools", "pr-flow-deploy.py")
    dep = subprocess.run([sys.executable, "-u", helper, "--repo-dir", WORKTREE,
                          "--branch", f"deploy/v2-verdicts-{session}",
                          "--message", msg, "--files"] + existing,
                         cwd=WORKTREE, capture_output=True, text=True, timeout=1800)
    if dep.returncode != 0:
        log(f"DEPLOY FAILED:\n{(dep.stdout + dep.stderr)[-1000:]}")
        return 1
    merged = None
    for line in (dep.stdout or "").splitlines():
        if line.startswith("RESULT: PRFLOW-MERGED"):
            merged = line.split()[-1]
    if not merged:
        log("DEPLOY FAILED: helper output shows no RESULT: PRFLOW-MERGED line")
        return 1
    log(f"deployed {merged}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
