#!/usr/bin/env python3
"""Check-and-balance gate for the accumulation/distribution datasets.

Run AFTER any rebuild/patch of nepse-brokers/data/periods/*.json and BEFORE
deploying. On ANY failure it exits non-zero and prints loud FAIL lines — the
caller must then FAIL LOUDLY, keep yesterday's good data live, and NOT deploy.

Checks (accdist keeper, 2026-10-09):
  1. Every period file exists and parses.
  2. accumulation / distribution lists are non-trivial (>= 10 entries each).
  3. No empty/missing stock symbol in any acc/dist entry (the 2026-10-08
     incident: broker-aggregate days produced 182 blank-symbol rows live).
  4. Sign discipline: every accumulation entry net_value > 0, every
     distribution entry net_value < 0.
  5. Trivial-volume floor: every acc/dist entry's broker+symbol flow traded
     at least MIN_FLOW_VALUE (Rs 5 lakh) over the period.
  6. Cross-consistency: each acc/dist entry matches symbols[sym].netflow[broker].
  7. 1D "to" date == expected trading day (--date, defaults to last trading day).
  8. Sanity vs previous deployed version (git HEAD): entry counts and 1D
     turnover within plausible bands (catches half-built exports).

Usage:
    python3 tools/broker/validate-accdist.py [--date YYYY-MM-DD] [--repo PATH]
Exit codes: 0 = pass, 1 = validation failed (do not deploy).
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PERIODS_DIR = os.path.join(REPO, "nepse-brokers", "data", "periods")
PERIODS = ["1D", "2D", "1W", "2W", "1M", "3M", "6M", "1Y", "2Y", "3Y"]
MIN_FLOW_VALUE = 500_000  # must match export_broker_data.py
MIN_ENTRIES = 10
# Symbols that must never appear in acc/dist (broker-day aggregate markers)
BAD_SYMBOLS = {"", "*", "__TOTAL__"}


def log(msg):
    print(f"[accdist-validate] {msg}", flush=True)


def last_trading_day():
    d = date.today()
    while d.weekday() >= 5:  # Sat/Sun
        d -= timedelta(days=1)
    return d.isoformat()


def main():
    ap = argparse.ArgumentParser(description="Validate accumulation/distribution datasets")
    ap.add_argument("--date", default=None,
                    help="expected latest trading day (default: last trading day)")
    ap.add_argument("--repo", default=REPO)
    args = ap.parse_args()
    periods_dir = os.path.join(args.repo, "nepse-brokers", "data", "periods")
    expected = args.date or last_trading_day()

    errors = []

    def fail(msg):
        errors.append(msg)
        log(f"FAIL: {msg}")

    data = {}
    for p in PERIODS:
        path = os.path.join(periods_dir, f"{p}.json")
        if not os.path.exists(path):
            fail(f"{p}.json missing")
            continue
        try:
            with open(path) as f:
                data[p] = json.load(f)
        except Exception as e:
            fail(f"{p}.json unparseable: {e}")

    for p, d in data.items():
        acc = d.get("accumulation") or []
        dist = d.get("distribution") or []
        if len(acc) < MIN_ENTRIES:
            fail(f"{p}: only {len(acc)} accumulation entries (< {MIN_ENTRIES})")
        if len(dist) < MIN_ENTRIES:
            fail(f"{p}: only {len(dist)} distribution entries (< {MIN_ENTRIES})")
        syms = d.get("symbols") or {}
        for name, lst, sign in (("accumulation", acc, 1), ("distribution", dist, -1)):
            for r in lst:
                sym = r.get("symbol")
                if not sym or (sym or "").strip() in BAD_SYMBOLS:
                    fail(f"{p}: {name} entry with aggregate-marker symbol {sym!r} "
                         f"(broker {r.get('broker')})")
                    continue
                nv = r.get("net_value", 0)
                if sign == 1 and nv <= 0:
                    fail(f"{p}: accumulation entry {sym}/{r.get('broker')} net_value={nv} not > 0")
                if sign == -1 and nv >= 0:
                    fail(f"{p}: distribution entry {sym}/{r.get('broker')} net_value={nv} not < 0")
                # cross-consistency with symbols netflow + trivial-volume floor
                nf = syms.get(sym, {}).get("netflow", {}).get(str(r.get("broker")))
                if nf is None:
                    fail(f"{p}: {name} {sym}/{r.get('broker')} missing from symbols netflow")
                else:
                    if abs(nf[1] - nv) > 0.01:
                        fail(f"{p}: {name} {sym}/{r.get('broker')} net_value {nv} != "
                             f"netflow {nf[1]}")
                    traded = (nf[3] or 0) + (nf[5] or 0)
                    if traded < MIN_FLOW_VALUE:
                        fail(f"{p}: {name} {sym}/{r.get('broker')} traded value "
                             f"Rs {traded:,.0f} < floor Rs {MIN_FLOW_VALUE:,.0f}")

    # 1D date + turnover sanity
    d1 = data.get("1D")
    if d1 is not None:
        if d1.get("to") != expected:
            fail(f"1D to-date {d1.get('to')} != expected trading day {expected}")
        turnover = sum((b.get("buy_value") or 0) for b in d1.get("brokers", []))
        if turnover < 1e8:
            fail(f"1D broker turnover suspiciously low: Rs {turnover:,.0f}")
        log(f"1D: to={d1.get('to')}, turnover=Rs {turnover/1e9:.2f}B, "
            f"acc={len(d1.get('accumulation', []))}, dist={len(d1.get('distribution', []))}")

    # sanity vs previous deployed version (git HEAD)
    if d1 is not None:
        try:
            prev_raw = subprocess.run(
                ["git", "show", f"HEAD:nepse-brokers/data/periods/1D.json"],
                cwd=args.repo, capture_output=True, text=True, check=True).stdout
            prev = json.loads(prev_raw)
            for key in ("accumulation", "distribution"):
                old_n, new_n = len(prev.get(key, [])), len(d1.get(key, []))
                if old_n and new_n < 0.3 * old_n:
                    fail(f"1D {key} count collapsed vs deployed: {old_n} -> {new_n}")
            old_t = sum((b.get("buy_value") or 0) for b in prev.get("brokers", []))
            new_t = sum((b.get("buy_value") or 0) for b in d1.get("brokers", []))
            if old_t and not (0.3 * old_t <= new_t <= 3.0 * old_t):
                fail(f"1D turnover implausible vs deployed: Rs {old_t:,.0f} -> Rs {new_t:,.0f}")
            log(f"vs deployed HEAD: counts and turnover within sane bands")
        except subprocess.CalledProcessError as e:
            log(f"WARN: could not read git HEAD version for comparison ({e}); skipping")

    if errors:
        log(f"VALIDATION FAILED: {len(errors)} error(s) — DO NOT DEPLOY, keep yesterday's data live")
        return 1
    log("PASS: all accumulation/distribution checks green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
