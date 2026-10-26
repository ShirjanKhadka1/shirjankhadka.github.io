#!/usr/bin/env python3
"""Build the watchlist family's Python-owned data files.

Outputs (into the repo's data/ dir):
  data/watchlist-sessions.json — NEPSE session closes, one row per
      trading session, the slim series the watchlist page's
      "Tracked sessions" line chart reads (the full portfolio
      benchmark file is 385KB; this file carries only what the
      watchlist page needs).
  data/watchlist-forward.json — per-symbol forward-outcome
      categorization: for each symbol, over the trailing 252
      resolved windows per horizon (5 / 10 / 20 sessions), the
      share of windows in which the symbol BEAT the NEPSE index
      over the same window, and the mean spread in percentage
      points. This is the "upcoming data categorized by upcoming
      results" rule: as each new session lands, windows resolve
      and the categorization updates — no prediction, only
      observed forward outcomes.

Sources (no new external fetch — design-master law 3):
  - data/index-history.json (NEPSE closes; owned archive)
  - data/portfolio-benchmark.json (canonical session grid;
      the builder FAILS unless its grid matches this exactly)
  - ~/workspace/nepse-data-archive/ohlc-db/*.json (symbol closes)
  - ~/workspace/nepse-data-archive/nepse-holidays.txt (carried-
      forward holiday-row exclusion, same rule as the benchmark)

Holiday-stub rule: a row is dropped when its date is a listed
holiday AND its OHLC is carried forward verbatim from the previous
session (open == prev close, high == prev high, low == prev low).
2026-10-19 (Maha Nawami, Dashain) is the known case.

Usage: python3 tools/build-watchlist-forward.py [--worktree DIR]
  Writes the two files into <worktree>/data/. Deterministic
  except the `generated` timestamp line.
"""
import argparse
import datetime as dt
import json
import os
import sys

HORIZONS = (5, 10, 20)
WINDOW_SESSIONS = 252  # trailing resolved windows per horizon


def load_json(path):
    with open(path) as f:
        return json.load(f)


def dstr(yyyymmdd):
    s = str(yyyymmdd)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", default=os.getcwd())
    ap.add_argument("--ohlc-dir",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/ohlc-db"))
    ap.add_argument("--holidays",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/nepse-holidays.txt"))
    a = ap.parse_args()

    hist = load_json(os.path.join(a.worktree, "data/index-history.json"))
    bench = load_json(os.path.join(a.worktree, "data/portfolio-benchmark.json"))
    grid = list(bench["sessions"])
    nepse = dict(bench["nepse"])  # date -> close

    holidays = set()
    if os.path.exists(a.holidays):
        with open(a.holidays) as f:
            for line in f:
                line = line.strip()
                if len(line) >= 10 and line[4] == "-" and line[7] == "-":
                    holidays.add(line[:10])

    cleaned = []  # [(date, close)] — full history, holiday stubs dropped
    prev = None  # (open, high, low, close) of the previous kept row
    dropped = []
    for row in hist["rows"]:
        date = dstr(row[0])
        o, h, l, c = float(row[1]), float(row[2]), float(row[3]), float(row[4])
        # Carried-forward signature: on a listed holiday, the intraday
        # range repeats the previous session verbatim (high/low to the
        # paisa). The close alone is NOT the test: the Oct-16 stored
        # close (2634.16) differs by 0.01 from the stub's 2634.17, the
        # known close/previousClose field shift.
        if prev is not None and date in holidays and h == prev[1] and l == prev[2]:
            dropped.append(date)
            continue
        cleaned.append((date, c))
        prev = (o, h, l, c)
    # The benchmark grid is the trailing window (2021-10-26..); the
    # watchlist files use exactly that grid, never the full history.
    try:
        start = [d for d, _ in cleaned].index(grid[0])
    except ValueError:
        raise SystemExit(f"gate: benchmark grid start {grid[0]} not in cleaned sessions")
    sessions = cleaned[start:start + len(grid)]
    grid2 = [d for d, _ in sessions]
    if grid2 != grid:
        raise SystemExit(
            f"gate: session grid mismatch vs portfolio-benchmark: "
            f"built {len(grid2)} sessions, benchmark {len(grid)}; "
            f"first diff at "
            f"{next((i for i, (x, y) in enumerate(zip(grid2, grid)) if x != y), min(len(grid2), len(grid)))}")
    nepse_map = dict(sessions)
    for d in grid:
        if abs(nepse_map[d] - float(nepse[d])) > 1e-9:
            raise SystemExit(f"gate: NEPSE close mismatch on {d}: index-history {nepse_map[d]} vs benchmark {nepse[d]}")

    # Symbol closes aligned to the grid.
    sym_close = {}  # sym -> {date: close}
    for fn in sorted(os.listdir(a.ohlc_dir)):
        if not fn.endswith(".json"):
            continue
        doc = load_json(os.path.join(a.ohlc_dir, fn))
        sym = doc.get("symbol") or fn[:-5]
        m = {}
        for bar in doc.get("bars", []):
            if bar["date"] in nepse_map and bar.get("close") is not None:
                m[bar["date"]] = float(bar["close"])
        if m:
            sym_close[sym] = m

    n = len(grid)
    out_symbols = {}
    for sym, m in sorted(sym_close.items()):
        entry = {"close": m.get(grid[-1]), "close_asof": grid[-1] if grid[-1] in m else None}
        for hz in HORIZONS:
            wins = []
            # Trailing WINDOW_SESSIONS resolved windows: start indices
            # i with i + hz < n, newest WINDOW_SESSIONS of them.
            starts = range(max(0, n - hz - WINDOW_SESSIONS), n - hz)
            for i in starts:
                d0, d1 = grid[i], grid[i + hz]
                c0, c1 = m.get(d0), m.get(d1)
                if c0 is None or c1 is None or not c0:
                    continue
                n0, n1 = nepse_map[d0], nepse_map[d1]
                if not n0:
                    continue
                spread = (c1 / c0 - 1) * 100 - (n1 / n0 - 1) * 100
                wins.append(spread)
            if wins:
                entry[f"h{hz}"] = {
                    "n": len(wins),
                    "beat": round(sum(1 for w in wins if w > 0) / len(wins), 4),
                    "mean": round(sum(wins) / len(wins), 2),
                }
        if any(f"h{hz}" in entry for hz in HORIZONS):
            out_symbols[sym] = entry

    generated = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=45))).isoformat(timespec="seconds")
    asof = grid[-1]
    sessions_doc = {
        "schema": "nd-watchlist-sessions/v1",
        "generated": generated,
        "asof": asof,
        "sessions": [[d, c] for d, c in sessions],
        "_meta": {
            "sources": ["data/index-history.json (NEPSE closes)",
                        "data/portfolio-benchmark.json (canonical session grid)"],
            "dropped_holiday_rows": dropped,
            "note": "NEPSE closes only; symbol closes live in the ohlc-db archive.",
        },
    }
    forward_doc = {
        "schema": "nd-watchlist-forward/v1",
        "generated": generated,
        "asof": asof,
        "horizons": list(HORIZONS),
        "window_sessions": WINDOW_SESSIONS,
        "symbols": out_symbols,
        "_meta": {
            "sources": ["ohlc-db symbol closes", "index-history NEPSE closes"],
            "note": ("Trailing resolved forward windows: beat = symbol return "
                     "minus NEPSE return over the same window > 0. Observed "
                     "outcomes only — never a prediction."),
        },
    }
    out_dir = os.path.join(a.worktree, "data")
    with open(os.path.join(out_dir, "watchlist-sessions.json"), "w") as f:
        json.dump(sessions_doc, f, indent=1)
        f.write("\n")
    with open(os.path.join(out_dir, "watchlist-forward.json"), "w") as f:
        json.dump(forward_doc, f, indent=1)
        f.write("\n")
    print(f"sessions: {len(sessions)} rows, asof {asof}, dropped holidays {dropped}")
    print(f"forward: {len(out_symbols)} symbols with resolved windows")
    for sym in ("NABIL", "NICA", "NIFRA"):
        if sym in out_symbols:
            print(f"  {sym}: " + json.dumps(out_symbols[sym]))
    print("RESULT: SILENT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
