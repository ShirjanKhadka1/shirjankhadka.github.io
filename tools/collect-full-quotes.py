#!/usr/bin/env python3
"""Full-symbol live quotes collector.

Reuses the proven repo script tools/fetch-nepse-live.js verbatim:
copies it into a scratch directory (structured like the repo root,
with tools/ and nepse-chart/data/), runs it with node there, parses
the resulting live.json, validates the quotes array, and emits it.

Usage:
  python3 tools/collect-full-quotes.py [--scratch DIR] [--out PATH]

- Without --out, the quotes array JSON is printed to stdout.
- With --out, the quotes array JSON is written to that path.
- Exit non-zero with a clear stderr message on any failure.
"""
import argparse
from datetime import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_JS = os.path.join(REPO, "tools", "fetch-nepse-live.js")
MIN_QUOTES = 300
RAMP_FLOOR = 150
RAMP_MINUTES = 60


def min_quotes_for_elapsed(elapsed_min):
    """Session-ramp quote minimum: 150 at the 11:00 open, rising
    linearly to the full 300 by 60 minutes after open, then flat.
    The tape ramps up after open (2026-10-29: 157 quotes at 11:05
    -> 303 by 11:37), so a flat 300 gate fails every healthy early
    session. The gate still rejects partial/truncated feeds: below
    the floor early, below 300 after the first hour. Thin days that
    never reach 300 stay rejected intraday by design; the post-close
    vpi-daily job publishes the FINAL board."""
    if elapsed_min >= RAMP_MINUTES:
        return MIN_QUOTES
    return max(RAMP_FLOOR,
               RAMP_FLOOR + (MIN_QUOTES - RAMP_FLOOR) * elapsed_min // RAMP_MINUTES)


def fail(msg):
    print(f"collect-full-quotes: error: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description="Collect full-symbol live quotes")
    ap.add_argument("--scratch", default=None,
                    help="Scratch directory to use (created if missing); "
                         "default: a temporary directory")
    ap.add_argument("--out", default=None,
                    help="Write quotes JSON to this path instead of stdout")
    args = ap.parse_args()

    if not os.path.isfile(SRC_JS):
        fail(f"source script not found: {SRC_JS}")

    # Resolve scratch dir
    if args.scratch:
        scratch = os.path.abspath(args.scratch)
        os.makedirs(scratch, exist_ok=True)
        cleanup = False
    else:
        scratch = tempfile.mkdtemp(prefix="full-quotes-")
        cleanup = False  # keep temp for debugging; OS cleans /tmp

    try:
        # Structure scratch like repo root: tools/ + nepse-chart/data/
        tools_dir = os.path.join(scratch, "tools")
        data_dir = os.path.join(scratch, "nepse-chart", "data")
        os.makedirs(tools_dir, exist_ok=True)
        os.makedirs(data_dir, exist_ok=True)

        dest_js = os.path.join(tools_dir, "fetch-nepse-live.js")
        shutil.copyfile(SRC_JS, dest_js)

        # The fetcher requires its sibling modules and holiday data, all
        # in REPO/tools/. Staging only the fetcher broke every intraday
        # run (2026-10-26: MODULE_NOT_FOUND for ./trading-days, no
        # live.json produced) — copy the siblings too.
        for sibling in ("trading-days.js", "nepse-api.js", "nepse-holidays.json"):
            src = os.path.join(REPO, "tools", sibling)
            if os.path.isfile(src):
                shutil.copyfile(src, os.path.join(tools_dir, sibling))

        # Run the JS fetcher verbatim
        try:
            result = subprocess.run(
                ["node", dest_js],
                cwd=scratch,
                capture_output=True, text=True, timeout=180,
            )
        except FileNotFoundError:
            fail("node executable not found")
        except subprocess.TimeoutExpired:
            fail("fetch-nepse-live.js timed out after 180s")

        # The JS script is fail-safe: it exits 0 even on abort without
        # touching live.json. So we must validate the output file.
        if result.stdout:
            # Forward JS logs to stderr so stdout stays pure JSON
            print(result.stdout, file=sys.stderr, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")

        live_path = os.path.join(data_dir, "live.json")
        if not os.path.isfile(live_path):
            fail(f"fetch-nepse-live.js did not produce live.json in scratch "
                 f"(exit {result.returncode}); see logs above")

        try:
            with open(live_path) as f:
                live = json.load(f)
        except Exception as e:
            fail(f"could not parse scratch live.json: {e}")

        quotes = live.get("quotes")
        if not isinstance(quotes, list):
            fail(f"live.json quotes is not a list (got {type(quotes).__name__})")
        # Minutes after the 11:00 NPT open, from the tape's own asof
        # (NPT wall time, with or without a +05:45 offset); fall back
        # to the local clock when asof is missing, stale, or unparseable.
        elapsed = None
        asof_raw = live.get("asof")
        if isinstance(asof_raw, str):
            try:
                asof = datetime.fromisoformat(asof_raw.replace("Z", "+00:00"))
                if asof.tzinfo is not None:
                    asof = asof.replace(tzinfo=None)
                if asof.date() == datetime.now().date():
                    open_t = asof.replace(hour=11, minute=0, second=0,
                                          microsecond=0)
                    elapsed = int((asof - open_t).total_seconds() // 60)
            except ValueError:
                elapsed = None
        if elapsed is None:
            now = datetime.now()
            open_t = now.replace(hour=11, minute=0, second=0, microsecond=0)
            elapsed = int((now - open_t).total_seconds() // 60)
        elapsed = max(0, elapsed)
        minimum = min_quotes_for_elapsed(elapsed)
        if len(quotes) < minimum:
            fail(f"quotes count {len(quotes)} below session-ramp minimum "
                 f"{minimum} ({elapsed} min after 11:00 open)")

        for i, row in enumerate(quotes):
            if not isinstance(row, dict):
                fail(f"quote row {i} is not an object")
            sym = row.get("symbol")
            if not sym or not isinstance(sym, str):
                fail(f"quote row {i} missing symbol: {row!r}")
            ltp = row.get("ltp")
            if not isinstance(ltp, (int, float)) or isinstance(ltp, bool):
                fail(f"quote row {i} ({sym}) has non-numeric ltp: {ltp!r}")

        payload = json.dumps(quotes)
        if args.out:
            out_path = os.path.abspath(args.out)
            os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
            with open(out_path, "w") as f:
                f.write(payload)
        else:
            sys.stdout.write(payload)
            sys.stdout.write("\n")
        return 0
    finally:
        # If we created a temp dir and caller gave no --scratch, leave it;
        # /tmp is ephemeral. If explicit scratch, leave it as caller owns it.
        pass


if __name__ == "__main__":
    sys.exit(main())
