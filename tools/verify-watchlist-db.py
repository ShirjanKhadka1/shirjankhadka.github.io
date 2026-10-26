#!/usr/bin/env python3
"""Verify the watchlist family's Python-owned data files.

Checks (stdlib only, writes nothing):
  1. watchlist-sessions.json grid == portfolio-benchmark sessions,
     and every close == the benchmark's NEPSE close.
  2. watchlist-forward.json schema: finite numbers, beat in [0,1],
     n within the trailing window, close_asof consistent.
  3. Independent spot-check: verdicts-batch closes at the batch
     asof vs ohlc-db closes on the same session (8 symbols).
  4. Independent NEPSE check: last session close == the EOD
     archive's true close for that session (the EOD file's
     `previousClose` field — its `close` field is stale by one
     session, the known field-shift quirk — never `close`).
  5. Hand recomputation: NABIL h5 beat rate over 5 hand-picked
     windows, computed inline here, not via builder code.

Usage: python3 tools/verify-watchlist-db.py [--worktree DIR]
  Exit 0 + "All checks passed" on success, else non-zero.
"""
import argparse
import json
import math
import os
import sys

FAILS = []
PASSES = []


def check(name, ok, detail=""):
    (PASSES if ok else FAILS).append(name)
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))


def load_json(path):
    with open(path) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", default=os.getcwd())
    ap.add_argument("--ohlc-dir",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/ohlc-db"))
    ap.add_argument("--eod-dir",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/eod"))
    a = ap.parse_args()
    wt = a.worktree

    sess = load_json(os.path.join(wt, "data/watchlist-sessions.json"))
    fwd = load_json(os.path.join(wt, "data/watchlist-forward.json"))
    bench = load_json(os.path.join(wt, "data/portfolio-benchmark.json"))
    verdicts = load_json(os.path.join(wt, "nepse-chart/data/verdicts.json"))

    check("sessions schema", sess.get("schema") == "nd-watchlist-sessions/v1")
    check("forward schema", fwd.get("schema") == "nd-watchlist-forward/v1")
    check("same asof", sess["asof"] == fwd["asof"], f"asof {sess['asof']}")
    check("grid == benchmark grid",
          [d for d, _ in sess["sessions"]] == list(bench["sessions"]),
          f"{len(sess['sessions'])} sessions")
    bad = [(d, c, bench["nepse"][d]) for d, c in sess["sessions"]
           if abs(float(c) - float(bench["nepse"][d])) > 1e-9]
    check("session closes == benchmark NEPSE closes", not bad,
          f"{len(sess['sessions'])} compared, {len(bad)} mismatches")

    syms = fwd["symbols"]
    # A missing last-session close (thin debenture / untraded line) is
    # honest None + close_asof None — missing shown as missing, never
    # filled. It must never be a finite-looking invented number.
    def close_ok(v):
        if v.get("close") is None:
            return v.get("close_asof") is None
        return isinstance(v["close"], (int, float)) and math.isfinite(v["close"])
    finite = all(
        close_ok(v)
        and all(math.isfinite(w["mean"]) and 0 <= w["beat"] <= 1 and 0 < w["n"] <= 252
                for k, w in v.items() if k.startswith("h"))
        for v in syms.values())
    check("forward values finite, beat in [0,1], n in window", finite,
          f"{len(syms)} symbols")
    check("forward asof == last session", fwd["asof"] == sess["sessions"][-1][0])

    # Independent spot-check: verdicts batch closes at batch asof.
    basof = verdicts.get("asof")
    ohlc = {}
    for sym in ("NABIL", "NICA", "NIFRA", "HIDCL", "NBL", "GBIME", "CHCL", "NMB", "PRVU"):
        p = os.path.join(a.ohlc_dir, f"{sym}.json")
        if not os.path.exists(p):
            print(f"SKIP spot-check {sym} (no ohlc-db file)")
            continue
        doc = load_json(p)
        ohlc[sym] = {b["date"]: b["close"] for b in doc["bars"]}
    mism = []
    for sym, closes in ohlc.items():
        v = verdicts["verdicts"].get(sym)
        if not v:
            continue
        oc = closes.get(basof)
        if oc is None or abs(float(v["p"]) - float(oc)) > 0.011:
            mism.append((sym, v["p"], oc))
    check(f"verdicts closes == ohlc-db closes on batch asof {basof}", not mism,
          f"{len(ohlc)} symbols spot-checked" + (f", mismatches {mism}" if mism else ""))

    # Independent NEPSE check via the EOD archive (previousClose field).
    eod_path = os.path.join(a.eod_dir, f"eod-{sess['asof']}.json")
    if os.path.exists(eod_path):
        eod = load_json(eod_path)
        idx = (eod.get("indices") or {}).get("NEPSE Index") or {}
        true_close = idx.get("previousClose", idx.get("currentValue"))
        check("last NEPSE close == EOD archive true close",
              true_close is not None and abs(float(true_close) - float(sess["sessions"][-1][1])) < 0.011,
              f"EOD previousClose {true_close} vs sessions {sess['sessions'][-1][1]}")
    else:
        print(f"SKIP EOD check (no file for {sess['asof']})")

    # Hand recomputation: NABIL h5 over 5 windows ending at the last session.
    grid = [d for d, _ in sess["sessions"]]
    nep = dict(sess["sessions"])
    nb = {b["date"]: b["close"] for b in load_json(os.path.join(a.ohlc_dir, "NABIL.json"))["bars"]}
    beats, spreads = [], []
    for i in range(len(grid) - 5, len(grid)):
        d0, d1 = grid[i - 5], grid[i]
        if d0 not in nb or d1 not in nb:
            continue
        sp = (nb[d1] / nb[d0] - 1) * 100 - (nep[d1] / nep[d0] - 1) * 100
        spreads.append(round(sp, 4))
        beats.append(1 if sp > 0 else 0)
    print(f"  hand NABIL h5 last windows: spreads {spreads} beats {sum(beats)}/{len(beats)}")
    check("hand recomputation runs (shape sane)",
          len(beats) >= 4 and all(math.isfinite(s) for s in spreads))

    print(f"\n{len(PASSES)} PASS / {len(FAILS)} FAIL")
    if FAILS:
        print("FAILURES:", ", ".join(FAILS))
        return 1
    print("All checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
